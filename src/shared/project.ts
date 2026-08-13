import type {
  DocumentIssue,
  LyrisProject,
  LyrisProjectV1,
  LyricLine,
  LyricsDocument,
  TrackMetadata,
} from '../types/project'
import { createId } from './ids'

const PROJECT_SCHEMA = 'dev.astramusic.lyris/project' as const

export function emptyMetadata(): TrackMetadata {
  return {
    title: '',
    artist: '',
    album: '',
    primaryLanguage: '',
    languages: [],
    durationMs: null,
    extra: {},
  }
}

export function createLine(patch: Partial<LyricLine> = {}): LyricLine {
  return {
    id: patch.id ?? createId('line'),
    kind: patch.kind ?? 'lyric',
    sectionBreakBefore: patch.sectionBreakBefore ?? false,
    text: patch.text ?? '',
    startMs: patch.startMs ?? null,
    endMs: patch.endMs ?? null,
    voice: patch.voice ?? null,
    translations: patch.translations ?? [],
    furigana: patch.furigana ?? [],
    words: patch.words ?? [],
    reviewState: patch.reviewState ?? 'unreviewed',
    ...(patch.confidence === undefined ? {} : { confidence: patch.confidence }),
    ...(patch.provenance === undefined ? {} : { provenance: patch.provenance }),
  }
}

export function createDocument(metadata: Partial<TrackMetadata> = {}): LyricsDocument {
  return {
    id: createId('document'),
    metadata: { ...emptyMetadata(), ...metadata },
    lines: [],
  }
}

export function createProject(now = new Date().toISOString()): LyrisProjectV1 {
  return {
    schema: PROJECT_SCHEMA,
    version: 1,
    id: createId('project'),
    createdAt: now,
    updatedAt: now,
    revision: 0,
    audio: null,
    document: createDocument(),
    exportPreferences: { format: 'xlrc', includeMetadata: true },
  }
}

export function cloneProject(project: LyrisProject): LyrisProject {
  return structuredClone(project)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
}

function normalizeLine(value: unknown): LyricLine {
  if (!isRecord(value)) return createLine()
  const translations = Array.isArray(value.translations)
    ? value.translations.filter(isRecord).map((entry) => ({
        id: stringOr(entry.id, createId('translation')),
        language: stringOr(entry.language),
        text: stringOr(entry.text),
        ...(isRecord(entry.provenance) ? { provenance: entry.provenance as never } : {}),
      }))
    : []
  const furigana = Array.isArray(value.furigana)
    ? value.furigana.filter(isRecord).map((entry) => ({
        start: Number(entry.start) || 0,
        end: Number(entry.end) || 0,
        base: stringOr(entry.base),
        reading: stringOr(entry.reading),
      }))
    : []
  const words = Array.isArray(value.words)
    ? value.words.filter(isRecord).map((entry) => ({
        id: stringOr(entry.id, createId('word')),
        text: stringOr(entry.text),
        startMs: numberOrNull(entry.startMs) ?? 0,
        endMs: numberOrNull(entry.endMs),
        furigana: Array.isArray(entry.furigana)
          ? entry.furigana.filter(isRecord).map((ruby) => ({
              start: Number(ruby.start) || 0,
              end: Number(ruby.end) || 0,
              base: stringOr(ruby.base),
              reading: stringOr(ruby.reading),
            }))
          : [],
        ...(typeof entry.confidence === 'number' ? { confidence: entry.confidence } : {}),
        ...(isRecord(entry.provenance) ? { provenance: entry.provenance as never } : {}),
      }))
    : []

  return createLine({
    id: stringOr(value.id, createId('line')),
    kind: value.kind === 'instrumental' ? 'instrumental' : 'lyric',
    sectionBreakBefore: value.sectionBreakBefore === true,
    text: stringOr(value.text),
    startMs: numberOrNull(value.startMs),
    endMs: numberOrNull(value.endMs),
    voice: typeof value.voice === 'string' ? value.voice : null,
    translations,
    furigana,
    words,
    reviewState: value.reviewState === 'reviewed' || value.reviewState === 'needs-review'
      ? value.reviewState
      : 'unreviewed',
    ...(typeof value.confidence === 'number' ? { confidence: value.confidence } : {}),
    ...(isRecord(value.provenance) ? { provenance: value.provenance as never } : {}),
  })
}

export function migrateProject(value: unknown): LyrisProject {
  if (!isRecord(value)) throw new Error('The selected file is not a Lyris project.')
  if (value.schema !== PROJECT_SCHEMA) throw new Error('This file does not use the Lyris project schema.')
  if (value.version !== 1) throw new Error(`Unsupported Lyris project version: ${String(value.version)}`)
  if (!isRecord(value.document)) throw new Error('The project is missing its lyric document.')

  const rawMetadata = isRecord(value.document.metadata) ? value.document.metadata : {}
  const metadata: TrackMetadata = {
    title: stringOr(rawMetadata.title),
    artist: stringOr(rawMetadata.artist),
    album: stringOr(rawMetadata.album),
    primaryLanguage: stringOr(rawMetadata.primaryLanguage),
    languages: Array.isArray(rawMetadata.languages) ? rawMetadata.languages.filter((item): item is string => typeof item === 'string') : [],
    durationMs: numberOrNull(rawMetadata.durationMs),
    extra: isRecord(rawMetadata.extra) ? rawMetadata.extra as TrackMetadata['extra'] : {},
  }
  const normalized: LyrisProject = {
    schema: PROJECT_SCHEMA,
    version: 1,
    id: stringOr(value.id, createId('project')),
    createdAt: stringOr(value.createdAt, new Date().toISOString()),
    updatedAt: stringOr(value.updatedAt, new Date().toISOString()),
    revision: typeof value.revision === 'number' && value.revision >= 0 ? Math.floor(value.revision) : 0,
    audio: isRecord(value.audio) ? value.audio as unknown as LyrisProject['audio'] : null,
    document: {
      id: stringOr(value.document.id, createId('document')),
      metadata,
      lines: Array.isArray(value.document.lines) ? value.document.lines.map(normalizeLine) : [],
    },
    exportPreferences: isRecord(value.exportPreferences) && (
      value.exportPreferences.format === 'lrc' || value.exportPreferences.format === 'elrc' || value.exportPreferences.format === 'xlrc'
    ) ? {
      format: value.exportPreferences.format,
      includeMetadata: value.exportPreferences.includeMetadata !== false,
    } : { format: 'xlrc', includeMetadata: true },
  }

  // Early alpha imports incorrectly promoted every formatting blank line in
  // XLRC to a section break. Repair only the unmistakable signature: several
  // imported rows where every row, including the first, was marked as a break.
  const hasLegacyImportedBreaks = normalized.document.lines.length >= 3 && normalized.document.lines.every((line) => (
    line.sectionBreakBefore && line.provenance?.kind === 'import'
  ))
  if (hasLegacyImportedBreaks) {
    normalized.document.lines = normalized.document.lines.map((line) => ({ ...line, sectionBreakBefore: false }))
  }

  const fatal = validateProject(normalized).find((issue) => issue.severity === 'error' && issue.code === 'duplicate-line-id')
  if (fatal) throw new Error(fatal.message)
  return normalized
}

export function validateProject(project: LyrisProject): DocumentIssue[] {
  const issues: DocumentIssue[] = []
  const ids = new Set<string>()
  const duration = project.audio?.durationMs ?? project.document.metadata.durationMs
  let latestStart = -Infinity

  for (const line of project.document.lines) {
    if (ids.has(line.id)) {
      issues.push({ severity: 'error', code: 'duplicate-line-id', message: 'Two lyric rows share the same internal ID.', lineId: line.id })
    }
    ids.add(line.id)
    if (line.startMs !== null) {
      if (line.startMs < 0) issues.push({ severity: 'error', code: 'negative-time', message: 'Line timing cannot be negative.', lineId: line.id })
      if (duration !== null && line.startMs > duration) issues.push({ severity: 'warning', code: 'past-duration', message: 'Line begins after the audio ends.', lineId: line.id })
      if (line.startMs < latestStart) issues.push({ severity: 'warning', code: 'decreasing-time', message: 'Line starts before an earlier row. Row order is preserved.', lineId: line.id })
      latestStart = Math.max(latestStart, line.startMs)
    }
    if (line.endMs !== null && (line.startMs === null || line.endMs <= line.startMs)) {
      issues.push({ severity: 'error', code: 'invalid-end', message: 'Line end must be later than its start.', lineId: line.id })
    }
    for (let index = 0; index < line.words.length; index += 1) {
      const word = line.words[index]
      if (word.endMs !== null && word.endMs <= word.startMs) {
        issues.push({ severity: 'error', code: 'invalid-word-end', message: 'A word end is not later than its start.', lineId: line.id })
      }
      if (index > 0 && word.startMs < line.words[index - 1].startMs) {
        issues.push({ severity: 'error', code: 'decreasing-word-time', message: 'Word timings are not ordered.', lineId: line.id })
      }
      if (line.startMs !== null && word.startMs < line.startMs) {
        issues.push({ severity: 'warning', code: 'word-before-line', message: 'A word begins before its line.', lineId: line.id })
      }
      if (line.endMs !== null && word.startMs >= line.endMs) {
        issues.push({ severity: 'warning', code: 'word-after-line', message: 'A word begins after its line ends.', lineId: line.id })
      }
    }
  }
  if (project.audio === null) {
    issues.push({ severity: 'info', code: 'missing-audio-reference', message: 'No audio is attached to this project.' })
  }
  return issues
}

export function deriveLineEnd(lines: LyricLine[], index: number, durationMs: number | null): number | null {
  const line = lines[index]
  if (!line || line.startMs === null) return null
  if (line.endMs !== null) return line.endMs
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const next = lines[cursor]
    if (next.startMs !== null && next.startMs > line.startMs) return next.startMs
  }
  return durationMs
}
