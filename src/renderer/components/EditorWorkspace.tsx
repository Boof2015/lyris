import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LyricFurigana, LyricLine, LyricTranslation, TrackMetadata } from '../../types/project'
import { createId } from '../../shared/ids'
import { validateProject } from '../../shared/project'
import { sourceLineTimestamp, tokenizeSourceLine } from '../../shared/sourceHighlight'
import { formatTimestamp, parseTimestamp } from '../../shared/time'
import { useEditorStore } from '../store/editorStore'
import { AudioTransport, type TransportHandle } from './AudioTransport'
import {
  AudioIcon, CheckIcon, DownIcon, ExportIcon, GripIcon, ImportIcon, MoreIcon, PlusIcon,
  RedoIcon, SaveIcon, TrashIcon, UndoIcon, UpIcon, WarningIcon,
} from './Icons'

interface EditorWorkspaceProps {
  onOpenAudio: () => void
  onImportLyrics: () => void
  onSave: (saveAs?: boolean) => void
  onExport: () => void
  onRelocateAudio: () => void
  banner?: React.ReactNode
  onNotice: (message: string, kind?: 'info' | 'warning' | 'success') => void
}

const DEFAULT_SPLIT = 56
const MIN_SPLIT = 38
const MAX_SPLIT = 65
const DEFAULT_SCALE = 100
const MIN_SCALE = 75
const MAX_SCALE = 200

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function storedNumber(key: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(window.localStorage.getItem(key))
  return Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback
}

function playbackScrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

function MetadataField({ label, value, placeholder, onCommit }: {
  label: string
  value: string
  placeholder: string
  onCommit: (value: string) => void
}): React.ReactElement {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return <label className="metadata-field"><span>{label}</span><input value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== value) onCommit(draft) }} onKeyDown={(event) => {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') { setDraft(value); event.currentTarget.blur() }
  }} /></label>
}

function MetadataPopover({ metadata, audioName, projectPath, onCommit, onClose }: {
  metadata: TrackMetadata
  audioName: string | null
  projectPath: string | null
  onCommit: (patch: Partial<TrackMetadata>) => void
  onClose: () => void
}): React.ReactElement {
  const popoverRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const closeOutside = (event: PointerEvent): void => {
      if (!popoverRef.current?.contains(event.target as Node)) onClose()
    }
    const closeEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', closeEscape)
    }
  }, [onClose])
  return <section ref={popoverRef} className="metadata-popover" role="dialog" aria-label="Track details" onPointerDown={(event) => event.stopPropagation()}>
    <header><div><span className="eyebrow">Project</span><strong>Track details</strong></div><button type="button" onClick={onClose} aria-label="Close track details">×</button></header>
    <div className="metadata-grid">
      <MetadataField label="Title" value={metadata.title} placeholder="Untitled track" onCommit={(title) => onCommit({ title })} />
      <MetadataField label="Artist" value={metadata.artist} placeholder="Unknown artist" onCommit={(artist) => onCommit({ artist })} />
      <MetadataField label="Album" value={metadata.album} placeholder="No album" onCommit={(album) => onCommit({ album })} />
      <MetadataField label="Primary language" value={metadata.primaryLanguage} placeholder="e.g. ja" onCommit={(primaryLanguage) => onCommit({ primaryLanguage })} />
    </div>
    <footer><div><AudioIcon /><span><strong>{audioName ?? 'No audio attached'}</strong><small>External audio</small></span></div><span title={projectPath ?? undefined}>{projectPath?.split(/[\\/]/u).at(-1) ?? 'Not saved yet'}</span></footer>
  </section>
}

function TimestampInput({ value, onCommit, label }: { value: number | null; onCommit: (value: number | null) => void; label: string }): React.ReactElement {
  const [draft, setDraft] = useState(value === null ? '' : formatTimestamp(value))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => { setDraft(value === null ? '' : formatTimestamp(value)); setInvalid(false) }, [value])
  const commit = (): void => {
    if (!draft.trim()) { setInvalid(false); onCommit(null); return }
    const parsed = parseTimestamp(draft)
    if (parsed === null) { setInvalid(true); return }
    setInvalid(false)
    setDraft(formatTimestamp(parsed))
    onCommit(parsed)
  }
  return <label className={`timestamp-input ${invalid ? 'invalid' : ''}`}><span>{label}</span><input value={draft} placeholder="00:00.000" onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
}

function renderRuby(text: string, furigana: LyricFurigana[]): React.ReactNode {
  if (!furigana.length) return text
  const ordered = [...furigana].sort((left, right) => left.start - right.start)
  const output: React.ReactNode[] = []
  let cursor = 0
  ordered.forEach((entry, index) => {
    if (entry.start < cursor || entry.end > text.length) return
    if (entry.start > cursor) output.push(text.slice(cursor, entry.start))
    output.push(<ruby key={`${entry.start}-${index}`}>{text.slice(entry.start, entry.end)}<rt>{entry.reading}</rt></ruby>)
    cursor = entry.end
  })
  if (cursor < text.length) output.push(text.slice(cursor))
  return output
}

function RichLine({ line, currentMs }: { line: LyricLine; currentMs: number }): React.ReactElement {
  if (line.kind === 'instrumental') return <span className="instrumental-label">Instrumental</span>
  if (!line.words.length) return <>{renderRuby(line.text, line.furigana)}</>
  return <>{line.words.map((word) => (
    <span key={word.id} className={currentMs >= word.startMs ? 'word-passed' : 'word-pending'}>{renderRuby(word.text, word.furigana)}</span>
  ))}</>
}

function InlineLineTimestamp({ value, label, onCommit, onPreview }: {
  value: number | null
  label: string
  onCommit: (value: number | null) => void
  onPreview: (value: number | null) => void
}): React.ReactElement {
  const [draft, setDraft] = useState(value === null ? '' : formatTimestamp(value))
  const [invalid, setInvalid] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  const pointerRef = useRef<{ id: number; startX: number; startMs: number; latestMs: number; dragging: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  useEffect(() => {
    if (pointerRef.current?.dragging) return
    setDraft(value === null ? '' : formatTimestamp(value))
    setInvalid(false)
  }, [value])

  const commitDraft = (): void => {
    if (!draft.trim()) { setInvalid(false); onCommit(null); return }
    const parsed = parseTimestamp(draft)
    if (parsed === null) { setInvalid(true); return }
    setInvalid(false)
    setDraft(formatTimestamp(parsed))
    onCommit(parsed)
  }

  const finishScrub = (input: HTMLInputElement, pointerId: number): void => {
    const pointer = pointerRef.current
    if (!pointer || pointer.id !== pointerId) return
    if (input.hasPointerCapture(pointerId)) input.releasePointerCapture(pointerId)
    if (pointer.dragging) {
      suppressClickRef.current = true
      onCommit(pointer.latestMs)
      onPreview(null)
    }
    pointerRef.current = null
    setScrubbing(false)
    document.body.classList.remove('time-scrubbing')
  }

  return <input
    className={`inline-line-time ${invalid ? 'invalid' : ''} ${scrubbing ? 'scrubbing' : ''}`}
    value={draft}
    placeholder="UNTIMED"
    aria-label={label}
    title="Click to type · drag horizontally to fine-tune · Shift for coarse · Option for fine"
    onFocus={(event) => event.currentTarget.select()}
    onChange={(event) => { setDraft(event.target.value); setInvalid(false) }}
    onBlur={commitDraft}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Enter') event.currentTarget.blur()
      if (event.key === 'Escape') {
        setDraft(value === null ? '' : formatTimestamp(value))
        setInvalid(false)
        event.currentTarget.blur()
      }
    }}
    onPointerDown={(event) => {
      if (event.button !== 0) return
      const startMs = value ?? parseTimestamp(draft) ?? 0
      pointerRef.current = { id: event.pointerId, startX: event.clientX, startMs, latestMs: startMs, dragging: false }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => {
      const pointer = pointerRef.current
      if (!pointer || pointer.id !== event.pointerId) return
      const distance = event.clientX - pointer.startX
      if (!pointer.dragging && Math.abs(distance) < 4) return
      pointer.dragging = true
      setScrubbing(true)
      document.body.classList.add('time-scrubbing')
      const millisecondsPerPixel = event.altKey ? 1 : event.shiftKey ? 25 : 5
      const next = Math.max(0, Math.round(pointer.startMs + distance * millisecondsPerPixel))
      pointer.latestMs = next
      setDraft(formatTimestamp(next))
      setInvalid(false)
      onPreview(next)
    }}
    onPointerUp={(event) => finishScrub(event.currentTarget, event.pointerId)}
    onPointerCancel={(event) => finishScrub(event.currentTarget, event.pointerId)}
    onClick={(event) => {
      if (!suppressClickRef.current) return
      suppressClickRef.current = false
      event.preventDefault()
    }}
  />
}

function TranslationSourceLine({ translation, lineNumber, onSelect, onUpdate, onRemove }: {
  translation: LyricTranslation
  lineNumber: number
  onSelect: () => void
  onUpdate: (patch: Partial<LyricTranslation>) => void
  onRemove: () => void
}): React.ReactElement {
  const [language, setLanguage] = useState(translation.language)
  const [text, setText] = useState(translation.text)
  useEffect(() => setLanguage(translation.language), [translation.language])
  useEffect(() => setText(translation.text), [translation.text])
  const reset = (): void => { setLanguage(translation.language); setText(translation.text) }
  return <div className="line-translation">
    <span className="translation-token">
      <i>[</i><b>&gt;</b><input
        className="translation-language"
        style={{ width: `${Math.max(2, Math.min(12, language.length || 4))}ch` }}
        value={language}
        aria-label={`Translation language ${translation.language || 'unset'} for lyric line ${lineNumber}`}
        placeholder="lang"
        spellCheck={false}
        onFocus={onSelect}
        onChange={(event) => setLanguage(event.target.value)}
        onBlur={() => { if (language !== translation.language) onUpdate({ language: language.trim() }) }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') { reset(); event.currentTarget.blur() }
        }}
      /><i>]</i>
    </span>
    <textarea
      rows={1}
      value={text}
      aria-label={`Translation ${translation.language || 'unset'} for lyric line ${lineNumber}`}
      placeholder="Translation"
      onFocus={onSelect}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => { if (text !== translation.text) onUpdate({ text }) }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur() }
        if (event.key === 'Escape') { reset(); event.currentTarget.blur() }
      }}
    />
    <button type="button" className="translation-remove" onClick={onRemove} aria-label={`Remove ${translation.language || 'unset'} translation from lyric line ${lineNumber}`} title="Remove translation"><span>×</span></button>
  </div>
}

type DropPosition = 'before' | 'after' | null

function LineRow({ line, index, selected, active, issueCount, languages, dragging, dropPosition, onDragStart, onDragOver, onDrop, onDragEnd, onPreviewTime, onNotice }: {
  line: LyricLine
  index: number
  selected: boolean
  active: boolean
  issueCount: number
  languages: string[]
  dragging: boolean
  dropPosition: DropPosition
  onDragStart: () => void
  onDragOver: (position: Exclude<DropPosition, null>) => void
  onDrop: () => void
  onDragEnd: () => void
  onPreviewTime: (lineId: string, timeMs: number | null) => void
  onNotice: EditorWorkspaceProps['onNotice']
}): React.ReactElement {
  const selectLine = useEditorStore((state) => state.selectLine)
  const updateLine = useEditorStore((state) => state.updateLine)
  const deleteLine = useEditorStore((state) => state.deleteLine)
  const moveLine = useEditorStore((state) => state.moveLine)
  const addLine = useEditorStore((state) => state.addLine)
  const splitLine = useEditorStore((state) => state.splitLine)
  const mergeLine = useEditorStore((state) => state.mergeLine)
  const [draft, setDraft] = useState(line.text)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => setDraft(line.text), [line.text])
  useEffect(() => {
    if (!menuOpen) return
    const closeOutside = (event: PointerEvent): void => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false) }
    const closeEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeEscape)
    return () => { window.removeEventListener('pointerdown', closeOutside); window.removeEventListener('keydown', closeEscape) }
  }, [menuOpen])

  const commitText = (): void => {
    if (draft === line.text) return
    const invalidated = updateLine(line.id, { text: draft })
    if (invalidated) onNotice('Word timing and furigana were cleared because this line’s text changed.', 'warning')
  }

  const updateTranslation = (translationId: string, patch: Partial<LyricTranslation>): void => {
    updateLine(line.id, { translations: line.translations.map((translation) => translation.id === translationId ? { ...translation, ...patch, id: translation.id } : translation) }, 'Edit translation')
  }
  const addTranslation = (): void => {
    const used = new Set(line.translations.map((translation) => translation.language.toLowerCase()))
    const language = languages.find((candidate) => candidate.toLowerCase() !== languages[0]?.toLowerCase() && !used.has(candidate.toLowerCase())) ?? ''
    const translation: LyricTranslation = { id: createId('translation'), language, text: '', provenance: { kind: 'manual', createdAt: new Date().toISOString() } }
    updateLine(line.id, { translations: [...line.translations, translation] }, 'Add translation')
    selectLine(line.id)
  }
  const runMenuAction = (action: () => void): void => { setMenuOpen(false); action() }

  return <div
    className={`lyric-row ${selected ? 'selected' : ''} ${active ? 'active-playback' : ''} ${line.sectionBreakBefore ? 'section-break' : ''} ${dragging ? 'dragging' : ''} ${dropPosition ? `drop-${dropPosition}` : ''}`}
    onClick={() => selectLine(line.id)}
    onDragOver={(event) => {
      if (dragging) return
      event.preventDefault()
      const bounds = event.currentTarget.getBoundingClientRect()
      onDragOver(event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after')
    }}
    onDrop={(event) => { event.preventDefault(); onDrop() }}
    data-line-id={line.id}
    data-active={active || undefined}
  >
    {line.sectionBreakBefore && <div className="section-divider" />}
    <button
      type="button"
      className="line-drag-handle"
      draggable
      aria-label={`Reorder lyric line ${index + 1}`}
      title="Drag to reorder"
      onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', line.id); onDragStart() }}
      onDragEnd={onDragEnd}
    ><GripIcon /></button>
    <div className="line-index"><span>{String(index + 1).padStart(2, '0')}</span><i className={`review-dot ${line.reviewState}`} title={line.reviewState.replace('-', ' ')} /></div>
    <span className="line-time-token"><i>[</i><InlineLineTimestamp
        value={line.startMs}
        label={`Start time for lyric line ${index + 1}`}
        onCommit={(startMs) => updateLine(line.id, { startMs }, 'Set line start')}
        onPreview={(timeMs) => onPreviewTime(line.id, timeMs)}
      /><i>]</i></span>
    <div className="line-copy">
      <textarea
        rows={1}
        value={draft}
        aria-label={`Lyric line ${index + 1}`}
        placeholder={line.kind === 'instrumental' ? 'Instrumental break' : 'Lyric text'}
        onFocus={() => selectLine(line.id)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitText}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            commitText()
            splitLine(line.id, event.currentTarget.selectionStart)
          } else if (event.key === 'Backspace' && draft.length === 0 && index > 0) {
            event.preventDefault()
            mergeLine(line.id)
          } else if (event.key === 'Escape') {
            setDraft(line.text)
            event.currentTarget.blur()
          }
        }}
      />
    </div>
    {(line.voice || line.translations.length > 0 || line.words.length > 0) && <div className="line-supporting">
      {(line.voice || line.words.length > 0) && <div className="line-annotations">
        {line.voice && <span className="line-chip">[voice:{line.voice}]</span>}
        {line.words.length > 0 && <span className="line-chip">[word-timed]</span>}
      </div>}
      {line.translations.map((translation) => <TranslationSourceLine
        key={translation.id}
        translation={translation}
        lineNumber={index + 1}
        onSelect={() => selectLine(line.id)}
        onUpdate={(patch) => updateTranslation(translation.id, patch)}
        onRemove={() => updateLine(line.id, { translations: line.translations.filter((candidate) => candidate.id !== translation.id) }, 'Remove translation')}
      />)}
    </div>}
    <button type="button" className="add-translation" onClick={(event) => { event.stopPropagation(); addTranslation() }}><PlusIcon />Translation</button>
    <div ref={menuRef} className="row-context">
      {issueCount > 0 && <WarningIcon className="row-warning" />}
      <button type="button" className="row-more" onClick={(event) => { event.stopPropagation(); setMenuOpen((value) => !value) }} aria-expanded={menuOpen} aria-label={`Options for lyric line ${index + 1}`}><MoreIcon /></button>
      {menuOpen && <div className="row-menu" role="menu" onClick={(event) => event.stopPropagation()}>
        <button type="button" role="menuitem" onClick={() => runMenuAction(() => addLine(line.id))}><PlusIcon />Insert line below</button>
        <button type="button" role="menuitem" onClick={() => runMenuAction(addTranslation)}><PlusIcon />Add translation</button>
        <span />
        <button type="button" role="menuitem" disabled={index === 0} onClick={() => runMenuAction(() => moveLine(line.id, -1))}><UpIcon />Move up</button>
        <button type="button" role="menuitem" onClick={() => runMenuAction(() => moveLine(line.id, 1))}><DownIcon />Move down</button>
        <button type="button" role="menuitem" disabled={index === 0} onClick={() => runMenuAction(() => mergeLine(line.id))}>Merge with previous</button>
        <span />
        <button type="button" role="menuitem" onClick={() => runMenuAction(() => updateLine(line.id, { kind: line.kind === 'instrumental' ? 'lyric' : 'instrumental' }, line.kind === 'instrumental' ? 'Mark line as lyric' : 'Mark line as instrumental'))}>{line.kind === 'instrumental' ? 'Mark as lyric' : 'Mark as instrumental'}</button>
        <button type="button" role="menuitem" onClick={() => runMenuAction(() => updateLine(line.id, { sectionBreakBefore: !line.sectionBreakBefore }, line.sectionBreakBefore ? 'Remove section break' : 'Add section break'))}>{line.sectionBreakBefore ? 'Remove section break' : 'Section break before'}</button>
        <button type="button" role="menuitem" className="danger" onClick={() => runMenuAction(() => deleteLine(line.id))}><TrashIcon />Delete line</button>
      </div>}
    </div>
    <button type="button" className="row-insert" onClick={(event) => { event.stopPropagation(); addLine(line.id) }} aria-label={`Insert lyric line after line ${index + 1}`} title="Insert line"><PlusIcon /></button>
  </div>
}

function TimingStrip({ line, index, looping, onLoop, onReveal, onEditorIntent }: { line: LyricLine; index: number; looping: boolean; onLoop: () => void; onReveal: () => void; onEditorIntent: () => void }): React.ReactElement {
  const updateLine = useEditorStore((state) => state.updateLine)
  const nudgeSelected = useEditorStore((state) => state.nudgeSelected)
  return <div className="timing-strip" aria-label="Selected line timing" onPointerDownCapture={onEditorIntent} onFocusCapture={onEditorIntent}>
    <button type="button" className="timing-heading" onClick={onReveal} title="Reveal selected line"><span>Line {String(index + 1).padStart(2, '0')}</span><strong>{line.text || 'Instrumental break'}</strong></button>
    <div className="timing-controls">
      <TimestampInput label="End" value={line.endMs} onCommit={(endMs) => updateLine(line.id, { endMs }, 'Set line end')} />
      <div className="nudge-group"><span>Nudge</span><div><button type="button" onClick={() => nudgeSelected(-100)}>−100</button><button type="button" onClick={() => nudgeSelected(-10)}>−10</button><button type="button" onClick={() => nudgeSelected(10)}>+10</button><button type="button" onClick={() => nudgeSelected(100)}>+100</button></div></div>
      <button className={`strip-button ${looping ? 'active' : ''}`} type="button" onClick={onLoop}>Loop</button>
      <label className="review-select"><span>Review</span><select value={line.reviewState} onChange={(event) => updateLine(line.id, { reviewState: event.target.value as LyricLine['reviewState'] }, 'Set review state')}><option value="unreviewed">Unreviewed</option><option value="needs-review">Needs review</option><option value="reviewed">Reviewed</option></select></label>
      {line.confidence !== undefined && <div className="confidence"><span>Confidence</span><strong>{Math.round(line.confidence * 100)}%</strong></div>}
    </div>
  </div>
}

function SourceEditor({ onNotice, activeStartMs, follow }: {
  onNotice: EditorWorkspaceProps['onNotice']
  activeStartMs: number | null
  follow: boolean
}): React.ReactElement {
  const sourceText = useEditorStore((state) => state.sourceText)
  const applySource = useEditorStore((state) => state.applySource)
  const untimedCount = useEditorStore((state) => state.project.document.lines.filter((line) => line.startMs === null).length)
  const [baseline, setBaseline] = useState(() => sourceText())
  const [draft, setDraft] = useState(baseline)
  const [error, setError] = useState<string | null>(null)
  const [caretLine, setCaretLine] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const lines = useMemo(() => draft.split(/\r?\n/u), [draft])
  const activeLineIndexes = useMemo(() => new Set(lines.flatMap((line, index) => sourceLineTimestamp(line) === activeStartMs && activeStartMs !== null ? [index] : [])), [activeStartMs, lines])
  const syncScroll = (textarea: HTMLTextAreaElement): void => {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop
      highlightRef.current.scrollLeft = textarea.scrollLeft
    }
    if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop
  }
  const syncCaret = (textarea: HTMLTextAreaElement): void => setCaretLine(textarea.value.slice(0, textarea.selectionStart).split('\n').length - 1)
  useEffect(() => {
    if (!follow || activeLineIndexes.size === 0 || !textareaRef.current) return
    const textarea = textareaRef.current
    const line = [...activeLineIndexes][0]
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 23
    const nextScroll = Math.max(0, line * lineHeight - textarea.clientHeight / 2 + lineHeight / 2)
    textarea.scrollTo({ top: nextScroll, behavior: playbackScrollBehavior() })
  }, [activeLineIndexes, follow])
  const reset = (): void => { const next = sourceText(); setBaseline(next); setDraft(next); setError(null) }
  return <section className="source-editor">
    <div className="source-note"><div><strong>Canonical XLRC source</strong><span>{untimedCount ? `${untimedCount} untimed row${untimedCount === 1 ? ' is' : 's are'} omitted; time every row before applying source.` : 'Applying source replaces the structured document as one undoable change. Formatting may be normalized.'}</span></div><span className={draft === baseline ? 'source-clean' : 'source-dirty'}>{untimedCount ? 'READ ONLY' : draft === baseline ? 'IN SYNC' : 'UNAPPLIED'}</span></div>
    <div className="source-code">
      <div ref={gutterRef} className="source-gutter" aria-hidden="true">{lines.map((_, index) => <span key={index} className={`${activeLineIndexes.has(index) ? 'active' : ''} ${caretLine === index ? 'current' : ''}`}>{index + 1}</span>)}</div>
      <div className="source-input">
        <pre ref={highlightRef} className="source-highlight" aria-hidden="true">{lines.map((line, index) => <span key={index} className={`source-line ${activeLineIndexes.has(index) ? 'active' : ''} ${caretLine === index ? 'current' : ''}`}>{tokenizeSourceLine(line).map((token, tokenIndex) => <span key={`${tokenIndex}-${token.kind}`} className={`source-token ${token.kind}`}>{token.value}</span>)}{index < lines.length - 1 ? '\n' : null}</span>)}</pre>
        <textarea
          ref={textareaRef}
          spellCheck={false}
          readOnly={untimedCount > 0}
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setError(null); syncCaret(event.currentTarget) }}
          onScroll={(event) => syncScroll(event.currentTarget)}
          onSelect={(event) => syncCaret(event.currentTarget)}
          aria-label="XLRC source"
        />
      </div>
    </div>
    {error && <div className="source-error"><WarningIcon />{error}</div>}
    <div className="source-actions"><button type="button" onClick={reset} disabled={draft === baseline}>Revert</button><button type="button" className="primary" disabled={draft === baseline || untimedCount > 0} onClick={() => {
      const result = applySource(draft)
      if (!result.applied) { setError(result.error ?? 'Source could not be applied.'); return }
      const next = sourceText()
      setBaseline(next); setDraft(next); setError(null)
      onNotice(result.warnings.length ? `Source applied with ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}.` : 'Source changes applied.', result.warnings.length ? 'warning' : 'success')
    }}>Apply source</button></div>
  </section>
}

function PreviewPane({ lines, activeIds, currentMs, follow, onFollow, onSeek, onSelect }: {
  lines: LyricLine[]
  activeIds: Set<string>
  currentMs: number
  follow: boolean
  onFollow: (value: boolean) => void
  onSeek: (timeMs: number) => void
  onSelect: (lineId: string) => void
}): React.ReactElement {
  const activeRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef(0)
  const activeKey = [...activeIds].join(':')
  useEffect(() => {
    if (!follow || !listRef.current) return
    const centerActive = (behavior: ScrollBehavior): void => {
      const list = listRef.current
      const active = activeRef.current
      if (!list || !active) return
      const listBounds = list.getBoundingClientRect()
      const activeBounds = active.getBoundingClientRect()
      const top = list.scrollTop + activeBounds.top - listBounds.top - (list.clientHeight - activeBounds.height) / 2
      list.scrollTo({ top: Math.max(0, top), behavior })
    }
    cancelAnimationFrame(animationRef.current)
    animationRef.current = requestAnimationFrame(() => centerActive('smooth'))
    const observer = new ResizeObserver(() => centerActive('auto'))
    observer.observe(listRef.current)
    return () => { cancelAnimationFrame(animationRef.current); observer.disconnect() }
  }, [activeKey, follow])
  return <section className="preview-pane">
    <header className="pane-header preview-pane-header"><div><strong>Preview</strong><span>Playback rendering</span></div><label className="follow-toggle"><input type="checkbox" checked={follow} onChange={(event) => onFollow(event.target.checked)} />Follow</label></header>
    <div ref={listRef} className={`preview-list ${activeIds.size ? 'synced' : ''}`}>
      {lines.length === 0 && <div className="pane-empty"><span>No lyrics yet</span><p>Import a file or add the first line.</p></div>}
      {lines.map((line) => {
        const active = activeIds.has(line.id)
        return <button
          ref={active ? activeRef : undefined}
          key={line.id}
          type="button"
          className={`preview-line ${active ? 'active' : ''} ${line.sectionBreakBefore ? 'section' : ''}`}
          onClick={() => { onSelect(line.id); if (line.startMs !== null) onSeek(line.startMs) }}
        >
          {line.voice && <span className="voice-label">{line.voice}</span>}
          <span className="preview-original"><RichLine line={line} currentMs={currentMs} /></span>
          {line.translations.map((translation) => <span className="preview-translation" key={translation.id}><em>{translation.language}</em>{translation.text}</span>)}
        </button>
      })}
    </div>
  </section>
}

function PaneResizer({ value, onChange }: { value: number; onChange: (value: number) => void }): React.ReactElement {
  const beginResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const shell = event.currentTarget.parentElement
    if (!shell) return
    const bounds = shell.getBoundingClientRect()
    document.body.classList.add('pane-resizing')
    const move = (moveEvent: PointerEvent): void => {
      const percent = ((moveEvent.clientX - bounds.left) / bounds.width) * 100
      onChange(Math.round(clamp(percent, MIN_SPLIT, MAX_SPLIT) * 10) / 10)
    }
    const finish = (): void => {
      document.body.classList.remove('pane-resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }
  return <div
    className="pane-resizer"
    role="separator"
    tabIndex={0}
    aria-label="Resize editor and preview"
    aria-orientation="vertical"
    aria-valuemin={MIN_SPLIT}
    aria-valuemax={MAX_SPLIT}
    aria-valuenow={Math.round(value)}
    title="Drag to resize · double-click to reset"
    onPointerDown={beginResize}
    onDoubleClick={() => onChange(DEFAULT_SPLIT)}
    onKeyDown={(event) => {
      if (event.key === 'Home') { event.preventDefault(); onChange(MIN_SPLIT); return }
      if (event.key === 'End') { event.preventDefault(); onChange(MAX_SPLIT); return }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const amount = event.shiftKey ? 5 : 1
      onChange(clamp(value + (event.key === 'ArrowLeft' ? -amount : amount), MIN_SPLIT, MAX_SPLIT))
    }}
  ><span /></div>
}

function InterfaceScalePopover({ scale, onScale, onClose }: { scale: number; onScale: (scale: number) => void; onClose: () => void }): React.ReactElement {
  const popoverRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const closeOutside = (event: PointerEvent): void => { if (!popoverRef.current?.contains(event.target as Node)) onClose() }
    const closeEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeEscape)
    return () => { window.removeEventListener('pointerdown', closeOutside); window.removeEventListener('keydown', closeEscape) }
  }, [onClose])
  const adjust = (amount: number): void => onScale(clamp(scale + amount, MIN_SCALE, MAX_SCALE))
  return <section ref={popoverRef} className="scale-popover" role="dialog" aria-label="Interface scale settings" onPointerDown={(event) => event.stopPropagation()}>
    <header><div><span className="eyebrow">Accessibility</span><strong>Interface size</strong></div><button type="button" aria-label="Close interface scale settings" onClick={onClose}>×</button></header>
    <div className="scale-stepper"><button type="button" onClick={() => adjust(-10)} disabled={scale <= MIN_SCALE} aria-label="Decrease interface scale">A−</button><output>{scale}%</output><button type="button" onClick={() => adjust(10)} disabled={scale >= MAX_SCALE} aria-label="Increase interface scale">A+</button></div>
    <input type="range" min={MIN_SCALE} max={MAX_SCALE} step="5" value={scale} onChange={(event) => onScale(Number(event.target.value))} aria-label="Interface scale" />
    <footer><span>⌘ / Ctrl + / −</span><button type="button" onClick={() => onScale(DEFAULT_SCALE)} disabled={scale === DEFAULT_SCALE}>Reset</button></footer>
  </section>
}

export function EditorWorkspace({ onOpenAudio, onImportLyrics, onSave, onExport, onRelocateAudio, banner, onNotice }: EditorWorkspaceProps): React.ReactElement {
  const project = useEditorStore((state) => state.project)
  const projectPath = useEditorStore((state) => state.projectPath)
  const audioUrl = useEditorStore((state) => state.audioUrl)
  const missingAudio = useEditorStore((state) => state.missingAudio)
  const selectedLineId = useEditorStore((state) => state.selectedLineId)
  const history = useEditorStore((state) => state.history)
  const future = useEditorStore((state) => state.future)
  const dirty = useEditorStore((state) => state.dirty)
  const lastAction = useEditorStore((state) => state.lastAction)
  const updateMetadata = useEditorStore((state) => state.updateMetadata)
  const updateLine = useEditorStore((state) => state.updateLine)
  const selectLine = useEditorStore((state) => state.selectLine)
  const addLine = useEditorStore((state) => state.addLine)
  const sortByTime = useEditorStore((state) => state.sortByTime)
  const moveLineTo = useEditorStore((state) => state.moveLineTo)
  const stampSelected = useEditorStore((state) => state.stampSelected)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const [mode, setMode] = useState<'lines' | 'source'>('lines')
  const [currentMs, setCurrentMs] = useState(0)
  const [previewFollow, setPreviewFollow] = useState(true)
  const [editorFollow, setEditorFollow] = useState(true)
  const [activeEditorLineOffscreen, setActiveEditorLineOffscreen] = useState(false)
  const [looping, setLooping] = useState(false)
  const [metadataOpen, setMetadataOpen] = useState(false)
  const [scaleOpen, setScaleOpen] = useState(false)
  const [splitPercent, setSplitPercent] = useState(() => storedNumber('lyris.editorSplit', DEFAULT_SPLIT, MIN_SPLIT, MAX_SPLIT))
  const [interfaceScale, setInterfaceScale] = useState(() => storedNumber('lyris.interfaceScale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE))
  const [draggedLineId, setDraggedLineId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ lineId: string; position: Exclude<DropPosition, null> } | null>(null)
  const [inlineTimePreview, setInlineTimePreview] = useState<{ lineId: string; timeMs: number } | null>(null)
  const transportRef = useRef<TransportHandle>(null)
  const editorPaneRef = useRef<HTMLElement>(null)
  const lineListRef = useRef<HTMLDivElement>(null)
  const issues = useMemo(() => validateProject(project), [project])
  const selected = project.document.lines.find((line) => line.id === selectedLineId) ?? null
  const selectedIndex = project.document.lines.findIndex((line) => line.id === selectedLineId)
  const issueCounts = useMemo(() => new Map(project.document.lines.map((line) => [line.id, issues.filter((issue) => issue.lineId === line.id).length])), [issues, project.document.lines])

  const activeIds = useMemo(() => {
    let activeStart: number | null = null
    for (const line of project.document.lines) {
      if (line.startMs !== null && line.startMs <= currentMs && (activeStart === null || line.startMs > activeStart)) activeStart = line.startMs
    }
    return new Set(activeStart === null ? [] : project.document.lines.filter((line) => line.startMs === activeStart).map((line) => line.id))
  }, [currentMs, project.document.lines])
  const activeStartMs = useMemo(() => project.document.lines.find((line) => activeIds.has(line.id))?.startMs ?? null, [activeIds, project.document.lines])

  useEffect(() => {
    window.localStorage.setItem('lyris.editorSplit', String(splitPercent))
  }, [splitPercent])

  useEffect(() => {
    window.localStorage.setItem('lyris.interfaceScale', String(interfaceScale))
    window.lyris.window.setZoomFactor(interfaceScale / 100)
  }, [interfaceScale])

  useEffect(() => {
    const increase = (): void => setInterfaceScale((value) => clamp(value + 10, MIN_SCALE, MAX_SCALE))
    const decrease = (): void => setInterfaceScale((value) => clamp(value - 10, MIN_SCALE, MAX_SCALE))
    const reset = (): void => setInterfaceScale(DEFAULT_SCALE)
    window.addEventListener('lyris-menu-scale-in', increase)
    window.addEventListener('lyris-menu-scale-out', decrease)
    window.addEventListener('lyris-menu-scale-reset', reset)
    return () => {
      window.removeEventListener('lyris-menu-scale-in', increase)
      window.removeEventListener('lyris-menu-scale-out', decrease)
      window.removeEventListener('lyris-menu-scale-reset', reset)
    }
  }, [])

  const suspendEditorFollow = useCallback((): void => setEditorFollow(false), [])
  const measureActiveEditorLine = useCallback((): void => {
    if (editorFollow || activeStartMs === null || !editorPaneRef.current) {
      setActiveEditorLineOffscreen(false)
      return
    }
    const viewport = mode === 'lines'
      ? lineListRef.current
      : editorPaneRef.current.querySelector<HTMLElement>('.source-code')
    const active = mode === 'lines'
      ? viewport?.querySelector<HTMLElement>('[data-active="true"]')
      : editorPaneRef.current.querySelector<HTMLElement>('.source-line.active')
    if (!viewport || !active) {
      setActiveEditorLineOffscreen(false)
      return
    }
    const viewportBounds = viewport.getBoundingClientRect()
    const activeBounds = active.getBoundingClientRect()
    setActiveEditorLineOffscreen(activeBounds.bottom <= viewportBounds.top + 4 || activeBounds.top >= viewportBounds.bottom - 4)
  }, [activeStartMs, editorFollow, mode])

  useEffect(() => {
    const frame = requestAnimationFrame(measureActiveEditorLine)
    return () => cancelAnimationFrame(frame)
  }, [measureActiveEditorLine])

  useEffect(() => {
    if (!editorFollow || mode !== 'lines' || !lineListRef.current) return
    const list = lineListRef.current
    const centerActive = (behavior: ScrollBehavior): void => {
      const active = list.querySelector<HTMLElement>('[data-active="true"]')
      if (!active) return
      const listBounds = list.getBoundingClientRect()
      const activeBounds = active.getBoundingClientRect()
      const top = list.scrollTop + activeBounds.top - listBounds.top - (list.clientHeight - activeBounds.height) / 2
      list.scrollTo({ top: Math.max(0, top), behavior })
    }
    const frame = requestAnimationFrame(() => centerActive(playbackScrollBehavior()))
    // ResizeObserver reports immediately when attached. Waiting until the
    // transition finishes prevents that initial report from turning it into a snap.
    let observer: ResizeObserver | null = null
    const observerDelay = window.setTimeout(() => {
      observer = new ResizeObserver(() => centerActive('auto'))
      observer.observe(list)
    }, 450)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(observerDelay)
      observer?.disconnect()
    }
  }, [activeStartMs, editorFollow, mode])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const editing = target?.matches('input, textarea, select, [contenteditable="true"]')
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); if (event.shiftKey) redo(); else undo(); return
      }
      if (event.altKey && event.key === 'Enter') { event.preventDefault(); transportRef.current?.stamp(); return }
      if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault()
        const amount = event.shiftKey ? 100 : 10
        useEditorStore.getState().nudgeSelected(event.key === 'ArrowLeft' ? -amount : amount)
        return
      }
      if (!editing && event.code === 'Space') { event.preventDefault(); transportRef.current?.toggle() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [redo, undo])

  const metadata = project.document.metadata
  const translationLanguages = [metadata.primaryLanguage, ...metadata.languages].filter((language, index, items) => language && items.findIndex((candidate) => candidate.toLowerCase() === language.toLowerCase()) === index)
  const projectName = metadata.title || project.audio?.fileName || 'Untitled project'
  const issueTotal = issues.filter((issue) => issue.severity !== 'info').length
  const timedTotal = project.document.lines.filter((line) => line.startMs !== null).length
  return <main className="workspace" data-interface-scale={interfaceScale}>
    <header className="project-header">
      <div className="header-brand"><div className="brand-mark">L</div><strong>LYRIS</strong></div>
      <div className="header-divider" />
      <div className="metadata-anchor">
        <button type="button" className="project-summary" onClick={() => setMetadataOpen((value) => !value)} aria-expanded={metadataOpen} aria-label="Edit track details">
          <span><strong>{projectName}</strong></span>
          <small>{metadata.artist || 'Unknown artist'}{metadata.album ? ` · ${metadata.album}` : ''}<em>{metadata.primaryLanguage || '—'}</em></small>
        </button>
        {metadataOpen && <MetadataPopover metadata={metadata} audioName={project.audio?.fileName ?? null} projectPath={projectPath} onCommit={updateMetadata} onClose={() => setMetadataOpen(false)} />}
      </div>
      <nav className="project-tools" aria-label="Project tools">
        <button type="button" className="header-action" onClick={onOpenAudio} title={audioUrl ? 'Replace audio' : 'Open audio'}><AudioIcon /><span>{audioUrl ? 'Audio' : 'Open audio'}</span></button>
        <button type="button" className="header-action" onClick={onImportLyrics} title="Import lyrics"><ImportIcon /><span>Lyrics</span></button>
      </nav>
      <div className="header-spacer" />
      <div className={`save-state ${dirty ? 'dirty' : ''}`} title={lastAction}>{!dirty && <CheckIcon />}<span>{dirty ? 'Unsaved' : 'Saved'}</span></div>
      <div className="history-actions">
        <button type="button" className="icon-button" onClick={undo} disabled={!history.length} title="Undo"><UndoIcon /></button>
        <button type="button" className="icon-button" onClick={redo} disabled={!future.length} title="Redo"><RedoIcon /></button>
      </div>
      <div className="scale-anchor">
        <button type="button" className={`header-action scale-action ${scaleOpen ? 'active' : ''}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => setScaleOpen((value) => !value)} aria-expanded={scaleOpen} aria-label="Interface scale" title={`Interface scale · ${interfaceScale}%`}>Aa</button>
        {scaleOpen && <InterfaceScalePopover scale={interfaceScale} onScale={setInterfaceScale} onClose={() => setScaleOpen(false)} />}
      </div>
      <button type="button" className="header-action save-action" onClick={() => onSave(false)}><SaveIcon /><span>Save</span></button>
      <button type="button" className="header-action primary" onClick={onExport}><ExportIcon /><span>Export</span></button>
    </header>

    {missingAudio && <div className="workspace-banner warning"><WarningIcon /><div><strong>Audio file not found</strong><span>The lyrics remain editable. Locate the original audio to restore playback.</span></div><button type="button" onClick={onRelocateAudio}>Locate audio</button></div>}
    {banner}

    <section className="editor-shell" style={{ gridTemplateColumns: `${splitPercent}fr 5px ${100 - splitPercent}fr` }}>
      <section
        ref={editorPaneRef}
        className="editor-pane"
        data-following-playback={editorFollow}
        onPointerDownCapture={suspendEditorFollow}
        onFocusCapture={suspendEditorFollow}
        onWheelCapture={suspendEditorFollow}
        onTouchMoveCapture={suspendEditorFollow}
        onScrollCapture={() => requestAnimationFrame(measureActiveEditorLine)}
      >
        <header className="pane-header editor-pane-header">
          <div className="segmented"><button type="button" className={mode === 'lines' ? 'active' : ''} onClick={() => setMode('lines')}>Lines</button><button type="button" className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')}>Source</button></div>
          <div className="pane-summary"><span>{project.document.lines.length} lines</span><span>{timedTotal} timed</span>{issueTotal > 0 && <span className="issue-count"><WarningIcon />{issueTotal}</span>}</div>
          <div className="pane-tools"><button type="button" onClick={() => addLine(selectedLineId ?? undefined)}><PlusIcon />Add</button><button type="button" onClick={sortByTime} disabled={!issues.some((issue) => issue.code === 'decreasing-time')}>Sort</button></div>
        </header>
        {mode === 'source' ? <SourceEditor onNotice={onNotice} activeStartMs={activeStartMs} follow={editorFollow} /> : <div ref={lineListRef} className="line-list">
          {project.document.lines.length === 0 && <div className="pane-empty"><span>Start the lyric draft</span><p>Import plain or timed lyrics, or add lines and stamp them during playback.</p><button type="button" onClick={() => addLine()}><PlusIcon />Add first line</button></div>}
          {project.document.lines.map((line, index) => <LineRow
            key={line.id}
            line={line}
            index={index}
            selected={line.id === selectedLineId}
            active={activeIds.has(line.id)}
            issueCount={issueCounts.get(line.id) ?? 0}
            languages={translationLanguages}
            dragging={draggedLineId === line.id}
            dropPosition={dropTarget?.lineId === line.id ? dropTarget.position : null}
            onDragStart={() => { setDraggedLineId(line.id); setDropTarget(null); selectLine(line.id) }}
            onDragOver={(position) => setDropTarget({ lineId: line.id, position })}
            onDrop={() => {
              if (!draggedLineId || draggedLineId === line.id || !dropTarget) return
              const remaining = project.document.lines.filter((candidate) => candidate.id !== draggedLineId)
              const targetIndex = remaining.findIndex((candidate) => candidate.id === line.id)
              if (targetIndex >= 0) moveLineTo(draggedLineId, targetIndex + (dropTarget.position === 'after' ? 1 : 0))
              setDraggedLineId(null)
              setDropTarget(null)
            }}
            onDragEnd={() => { setDraggedLineId(null); setDropTarget(null) }}
            onPreviewTime={(lineId, timeMs) => {
              setInlineTimePreview(timeMs === null ? null : { lineId, timeMs })
              if (timeMs !== null) transportRef.current?.seek(timeMs)
            }}
            onNotice={onNotice}
          />)}
        </div>}
        {activeEditorLineOffscreen && <button
          type="button"
          className="editor-follow-return"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setEditorFollow(true)}
          title="Editor scrolling paused after your interaction"
        ><i />Return to current line</button>}
      </section>
      <PaneResizer value={splitPercent} onChange={setSplitPercent} />
      <PreviewPane lines={project.document.lines} activeIds={activeIds} currentMs={currentMs} follow={previewFollow} onFollow={setPreviewFollow} onSeek={(time) => transportRef.current?.seek(time)} onSelect={selectLine} />
    </section>

    <section className="timeline-dock">
      {selected && <TimingStrip line={selected} index={selectedIndex} looping={looping} onLoop={() => setLooping((value) => !value)} onEditorIntent={suspendEditorFollow} onReveal={() => lineListRef.current?.querySelector<HTMLElement>(`[data-line-id="${selected.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />}
      <AudioTransport
        ref={transportRef}
        sourceUrl={audioUrl}
        lines={project.document.lines}
        selectedLineId={selectedLineId}
        loop={looping}
        onSelectLine={selectLine}
        onTime={setCurrentMs}
        onStamp={stampSelected}
        onMoveMarker={(lineId, startMs) => updateLine(lineId, { startMs }, 'Move timing marker')}
        previewMarker={inlineTimePreview}
      />
    </section>
  </main>
}
