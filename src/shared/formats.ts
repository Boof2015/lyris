import {
  parseXLRC,
  serializeXLRC,
  validateXLRC,
  type ValidationWarning,
  type XLRCFile,
  type XLRCLine,
  type XLRCMeta,
} from '@boof2015/xlrc'
import type {
  DowngradeNotice,
  ExportFormat,
  LyricLine,
  LyricsDocument,
  SerializedLyrics,
  TrackMetadata,
} from '../types/project'
import { createId } from './ids'
import { createDocument, createLine, emptyMetadata } from './project'
import { formatTimestamp } from './time'

export interface LyricsImportResult {
  document: LyricsDocument
  warnings: ValidationWarning[]
  detectedFormat: 'plain' | 'lrc' | 'elrc' | 'xlrc'
}

function metadataFromXLRC(meta: XLRCMeta): TrackMetadata {
  const known = new Set(['ti', 'ar', 'al', 'length', 'by', 'offset', 'lang', 'langs', 'xlrc'])
  const extra: TrackMetadata['extra'] = {}
  for (const [key, value] of Object.entries(meta)) {
    if (!known.has(key) && value !== undefined) extra[key] = value
  }
  if (meta.by !== undefined) extra.by = String(meta.by)
  if (meta.offset !== undefined) extra.offset = Number(meta.offset)
  if (meta.xlrc !== undefined) extra.xlrc = String(meta.xlrc)
  return {
    ...emptyMetadata(),
    title: typeof meta.ti === 'string' ? meta.ti : '',
    artist: typeof meta.ar === 'string' ? meta.ar : '',
    album: typeof meta.al === 'string' ? meta.al : '',
    primaryLanguage: typeof meta.lang === 'string' ? meta.lang : '',
    languages: Array.isArray(meta.langs) ? meta.langs : [],
    extra,
  }
}

function lineFromXLRC(line: XLRCLine): LyricLine {
  return createLine({
    kind: line.isEmpty ? 'instrumental' : 'lyric',
    // XLRC explicitly defines blank lines as non-semantic formatting. Section
    // breaks are therefore a Lyris project feature, never inferred on import.
    sectionBreakBefore: false,
    text: line.text,
    startMs: line.timestamp,
    voice: line.voice,
    translations: line.translations.map((translation) => ({
      id: createId('translation'),
      language: translation.lang,
      text: translation.text,
      provenance: { kind: 'import', createdAt: new Date().toISOString() },
    })),
    furigana: line.furigana.map(({ start, end, base, reading }) => ({ start, end, base, reading })),
    words: line.words.map((word, index, words) => ({
      id: createId('word'),
      text: word.text,
      startMs: word.timestamp,
      endMs: words[index + 1]?.timestamp ?? null,
      furigana: word.furigana.map(({ start, end, base, reading }) => ({ start, end, base, reading })),
      provenance: { kind: 'import', createdAt: new Date().toISOString() },
    })),
    reviewState: 'unreviewed',
    provenance: { kind: 'import', createdAt: new Date().toISOString() },
  })
}

function importPlainText(source: string): LyricsImportResult {
  const document = createDocument()
  let sectionBreakBefore = false
  for (const raw of source.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const text = raw.trim()
    if (!text) {
      if (document.lines.length) sectionBreakBefore = true
      continue
    }
    document.lines.push(createLine({
      text,
      sectionBreakBefore,
      provenance: { kind: 'import', createdAt: new Date().toISOString() },
    }))
    sectionBreakBefore = false
  }
  return { document, warnings: [], detectedFormat: 'plain' }
}

export function importLyrics(source: string): LyricsImportResult {
  const parsed = parseXLRC(source)
  if (parsed.lines.length === 0 && !/^\s*\[[A-Za-z][\w-]*:/mu.test(source)) return importPlainText(source)

  const validation = validateXLRC(parsed)
  const document = createDocument(metadataFromXLRC(parsed.meta))
  document.lines = parsed.lines.map(lineFromXLRC)
  const hasRich = document.lines.some((line) => line.voice || line.translations.length || line.furigana.length)
  const hasWords = document.lines.some((line) => line.words.length)
  return {
    document,
    warnings: [...parsed.warnings, ...validation.warnings],
    detectedFormat: hasRich ? 'xlrc' : hasWords ? 'elrc' : 'lrc',
  }
}

function metadataToXLRC(metadata: TrackMetadata, includeMetadata: boolean): XLRCMeta {
  if (!includeMetadata) return {}
  const meta: XLRCMeta = {}
  if (metadata.title) meta.ti = metadata.title
  if (metadata.artist) meta.ar = metadata.artist
  if (metadata.album) meta.al = metadata.album
  if (metadata.durationMs !== null) {
    const totalSeconds = Math.round(metadata.durationMs / 1000)
    meta.length = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
  }
  if (metadata.primaryLanguage) meta.lang = metadata.primaryLanguage
  if (metadata.languages.length) meta.langs = metadata.languages
  for (const [key, value] of Object.entries(metadata.extra)) meta[key] = value
  return meta
}

function lineToXLRC(line: LyricLine): XLRCLine | null {
  if (line.startMs === null) return null
  return {
    timestamp: line.startMs,
    text: line.kind === 'instrumental' ? '' : line.text,
    sourceText: undefined,
    rawText: undefined,
    voice: line.voice,
    isEmpty: line.kind === 'instrumental' || line.text.length === 0,
    words: line.words.map((word) => ({
      timestamp: word.startMs,
      text: word.text,
      sourceText: undefined,
      furigana: word.furigana.map((entry) => ({ ...entry })),
    })),
    furigana: line.furigana.map((entry) => ({ ...entry })),
    translations: line.translations.map((translation) => ({ lang: translation.language, text: translation.text })),
  }
}

function addNotice(notices: DowngradeNotice[], code: string, count: number, message: string): void {
  if (count > 0) notices.push({ code, count, message })
}

function headersForText(metadata: TrackMetadata, includeMetadata: boolean): string[] {
  if (!includeMetadata) return []
  const meta = metadataToXLRC(metadata, true)
  const order = ['ti', 'ar', 'al', 'length', 'by', 'offset', 'lang', 'langs', 'xlrc']
  const keys = Object.keys(meta).sort((left, right) => {
    const li = order.indexOf(left)
    const ri = order.indexOf(right)
    return (li < 0 ? 999 : li) - (ri < 0 ? 999 : ri) || left.localeCompare(right)
  })
  return keys.map((key) => `[${key}:${Array.isArray(meta[key]) ? meta[key].join(',') : String(meta[key])}]`)
}

function serializeSimple(document: LyricsDocument, format: 'lrc' | 'elrc', includeMetadata: boolean): SerializedLyrics {
  const notices: DowngradeNotice[] = []
  const timed = document.lines.filter((line) => line.startMs !== null)
  const untimedCount = document.lines.length - timed.length
  const translations = timed.reduce((sum, line) => sum + line.translations.length, 0)
  const voices = timed.filter((line) => line.voice).length
  const furigana = timed.reduce((sum, line) => sum + line.furigana.length + line.words.reduce((wordSum, word) => wordSum + word.furigana.length, 0), 0)
  const wordLines = timed.filter((line) => line.words.length).length
  addNotice(notices, 'untimed-lines', untimedCount, `${untimedCount} untimed row${untimedCount === 1 ? '' : 's'} will not be exported.`)
  addNotice(notices, 'translations', translations, `${translations} translation${translations === 1 ? '' : 's'} are only represented by XLRC.`)
  addNotice(notices, 'voices', voices, `${voices} voice label${voices === 1 ? '' : 's'} are only represented by XLRC.`)
  addNotice(notices, 'furigana', furigana, `${furigana} furigana annotation${furigana === 1 ? '' : 's'} are only represented by XLRC.`)
  if (format === 'lrc') addNotice(notices, 'word-timing', wordLines, `${wordLines} word-timed row${wordLines === 1 ? '' : 's'} will use line timing only.`)

  const rows = headersForText(document.metadata, includeMetadata)
  if (rows.length && timed.length) rows.push('')
  for (const line of timed) {
    if (line.sectionBreakBefore && rows.length && rows[rows.length - 1] !== '') rows.push('')
    const body = line.kind === 'instrumental'
      ? ''
      : format === 'elrc' && line.words.length > 0
        ? line.words.map((word) => `<${formatTimestamp(word.startMs, 'centisecond')}>${word.text}`).join('')
        : line.text
    rows.push(`[${formatTimestamp(line.startMs, 'centisecond')}]${body}`)
  }
  return { content: `${rows.join('\n')}\n`, notices }
}

export function serializeLyrics(
  document: LyricsDocument,
  format: ExportFormat,
  includeMetadata = true,
): SerializedLyrics {
  if (format !== 'xlrc') return serializeSimple(document, format, includeMetadata)
  const notices: DowngradeNotice[] = []
  const untimedCount = document.lines.filter((line) => line.startMs === null).length
  addNotice(notices, 'untimed-lines', untimedCount, `${untimedCount} untimed row${untimedCount === 1 ? '' : 's'} will not be exported.`)
  const file: XLRCFile = {
    meta: metadataToXLRC(document.metadata, includeMetadata),
    lines: document.lines.map(lineToXLRC).filter((line): line is XLRCLine => line !== null),
    warnings: [],
  }
  let content = serializeXLRC(file)
  if (document.lines.some((line) => line.sectionBreakBefore)) {
    const sourceRows = content.trimEnd().split('\n')
    const headerEnd = sourceRows.findIndex((row) => /^\[\d+:\d{2}/u.test(row))
    if (headerEnd >= 0) {
      const body: string[] = sourceRows.slice(0, headerEnd)
      let parsedLineIndex = 0
      for (const row of sourceRows.slice(headerEnd)) {
        if (/^\[\d+:\d{2}/u.test(row)) {
          const line = file.lines[parsedLineIndex]
          const original = document.lines.find((candidate) => candidate.startMs === line?.timestamp && candidate.text === line?.text)
          if (original?.sectionBreakBefore && body.at(-1) !== '') body.push('')
          parsedLineIndex += 1
        }
        body.push(row)
      }
      content = `${body.join('\n')}\n`
    }
  }
  return { content, notices }
}

function semanticKey(line: LyricLine): string {
  return JSON.stringify([line.kind, line.text, line.startMs, line.voice, line.translations.map((item) => [item.language, item.text])])
}

export function reconcileSourceDocument(current: LyricsDocument, source: string): LyricsImportResult {
  const result = importLyrics(source)
  const exact = new Map<string, LyricLine[]>()
  const text = new Map<string, LyricLine[]>()
  for (const line of current.lines) {
    const exactKey = semanticKey(line)
    exact.set(exactKey, [...(exact.get(exactKey) ?? []), line])
    const textKey = JSON.stringify([line.kind, line.text, line.voice])
    text.set(textKey, [...(text.get(textKey) ?? []), line])
  }
  const used = new Set<string>()
  result.document.id = current.id
  result.document.lines = result.document.lines.map((line) => {
    const exactMatch = exact.get(semanticKey(line))?.find((candidate) => !used.has(candidate.id))
    const textKey = JSON.stringify([line.kind, line.text, line.voice])
    const textMatch = text.get(textKey)?.find((candidate) => !used.has(candidate.id))
    const match = exactMatch ?? textMatch
    if (!match) return line
    used.add(match.id)
    return exactMatch
      ? { ...line, id: match.id, reviewState: match.reviewState, confidence: match.confidence, provenance: match.provenance }
      : { ...line, id: match.id, reviewState: 'unreviewed', confidence: undefined, provenance: { kind: 'manual', createdAt: new Date().toISOString() } }
  })
  return result
}
