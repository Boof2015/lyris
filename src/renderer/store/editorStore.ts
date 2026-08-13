import { create } from 'zustand'
import type {
  AudioSelection,
  DocumentOperation,
  LyrisProject,
  LyricLine,
  LyricsDocument,
  OpenProjectResult,
  TrackMetadata,
} from '../../types/project'
import { importLyrics, reconcileSourceDocument, serializeLyrics } from '../../shared/formats'
import { createId } from '../../shared/ids'
import { createLine, createProject } from '../../shared/project'
import { applyTransaction } from '../../shared/transactions'

interface HistoryFrame {
  document: LyricsDocument
  audio: LyrisProject['audio']
  label: string
}

interface SourceApplyResult {
  applied: boolean
  warnings: string[]
  error?: string
}

interface EditorState {
  project: LyrisProject
  projectPath: string | null
  audioUrl: string | null
  missingAudio: boolean
  selectedLineId: string | null
  history: HistoryFrame[]
  future: HistoryFrame[]
  dirty: boolean
  lastAction: string
  newProject: () => void
  loadProject: (result: OpenProjectResult) => void
  restoreProject: (project: LyrisProject) => void
  markSaved: (path: string, project: LyrisProject) => void
  attachAudio: (selection: AudioSelection) => void
  commit: (label: string, operations: DocumentOperation[]) => void
  updateMetadata: (patch: Partial<TrackMetadata>) => void
  selectLine: (lineId: string | null) => void
  updateLine: (lineId: string, patch: Partial<Omit<LyricLine, 'id'>>, label?: string) => boolean
  addLine: (afterLineId?: string, patch?: Partial<LyricLine>) => void
  deleteLine: (lineId: string) => void
  moveLine: (lineId: string, delta: -1 | 1) => void
  moveLineTo: (lineId: string, toIndex: number) => void
  splitLine: (lineId: string, offset: number) => void
  mergeLine: (lineId: string) => void
  sortByTime: () => void
  stampSelected: (timeMs: number) => void
  nudgeSelected: (deltaMs: number) => void
  importText: (text: string) => string[]
  sourceText: () => string
  applySource: (source: string) => SourceApplyResult
  undo: () => void
  redo: () => void
}

function snapshot(project: LyrisProject, label: string): HistoryFrame {
  return { document: structuredClone(project.document), audio: structuredClone(project.audio), label }
}

function restoreFrame(project: LyrisProject, frame: HistoryFrame): LyrisProject {
  return {
    ...project,
    document: structuredClone(frame.document),
    audio: structuredClone(frame.audio),
    revision: project.revision + 1,
    updatedAt: new Date().toISOString(),
  }
}

function mergeImportedMetadata(current: TrackMetadata, imported: TrackMetadata): TrackMetadata {
  return {
    ...current,
    ...Object.fromEntries(Object.entries(imported).filter(([, value]) => (
      Array.isArray(value) ? value.length > 0 : value !== '' && value !== null
    ))),
    extra: { ...current.extra, ...imported.extra },
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  project: createProject(),
  projectPath: null,
  audioUrl: null,
  missingAudio: false,
  selectedLineId: null,
  history: [],
  future: [],
  dirty: false,
  lastAction: 'Ready',

  newProject: () => set({
    project: createProject(), projectPath: null, audioUrl: null, missingAudio: false,
    selectedLineId: null, history: [], future: [], dirty: false, lastAction: 'New project',
  }),

  loadProject: (result) => set({
    project: result.project, projectPath: result.path, audioUrl: result.audioUrl,
    missingAudio: result.missingAudio, selectedLineId: result.project.document.lines[0]?.id ?? null,
    history: [], future: [], dirty: false, lastAction: `Opened ${result.path.split(/[\\/]/u).at(-1)}`,
  }),

  restoreProject: (project) => set({
    project, projectPath: null, audioUrl: null, missingAudio: Boolean(project.audio),
    selectedLineId: project.document.lines[0]?.id ?? null, history: [], future: [], dirty: true,
    lastAction: 'Recovered unsaved project',
  }),

  markSaved: (path, project) => set({ projectPath: path, project, dirty: false, lastAction: 'Saved' }),

  attachAudio: (selection) => {
    const state = get()
    const metadataPatch = Object.fromEntries(Object.entries(selection.metadata).filter(([, value]) => value !== '' && value !== null)) as Partial<TrackMetadata>
    const before = snapshot(state.project, 'Attach audio')
    const transaction = {
      id: createId('transaction'), label: 'Attach audio', baseRevision: state.project.revision,
      createdAt: new Date().toISOString(), operations: [{ type: 'update-metadata' as const, patch: metadataPatch }],
    }
    const next = applyTransaction(state.project, transaction)
    next.audio = selection.reference
    if (selection.reference.durationMs !== null) next.document.metadata.durationMs = selection.reference.durationMs
    set({ project: next, audioUrl: selection.sourceUrl, missingAudio: false, history: [...state.history, before], future: [], dirty: true, lastAction: 'Attached audio' })
  },

  commit: (label, operations) => {
    if (!operations.length) return
    const state = get()
    const transaction = { id: createId('transaction'), label, baseRevision: state.project.revision, operations, createdAt: new Date().toISOString() }
    const next = applyTransaction(state.project, transaction)
    set({ project: next, history: [...state.history, snapshot(state.project, label)], future: [], dirty: true, lastAction: label })
  },

  updateMetadata: (patch) => get().commit('Edit track metadata', [{ type: 'update-metadata', patch }]),
  selectLine: (lineId) => set({ selectedLineId: lineId }),

  updateLine: (lineId, patch, label = 'Edit lyric line') => {
    const line = get().project.document.lines.find((candidate) => candidate.id === lineId)
    if (!line) return false
    let invalidated = false
    let effectivePatch = patch
    if (patch.text !== undefined && patch.text !== line.text && (line.words.length > 0 || line.furigana.length > 0)) {
      invalidated = true
      effectivePatch = { ...patch, words: [], furigana: [], confidence: undefined, reviewState: 'needs-review' }
    }
    const changed = Object.entries(effectivePatch).some(([key, value]) => !Object.is(line[key as keyof LyricLine], value))
    if (!changed) return invalidated
    get().commit(label, [{ type: 'update-line', lineId, patch: effectivePatch }])
    return invalidated
  },

  addLine: (afterLineId, patch = {}) => {
    const state = get()
    const index = afterLineId ? state.project.document.lines.findIndex((line) => line.id === afterLineId) + 1 : state.project.document.lines.length
    const line = createLine(patch)
    state.commit('Add lyric line', [{ type: 'insert-line', index: Math.max(0, index), line }])
    set({ selectedLineId: line.id })
  },

  deleteLine: (lineId) => {
    const state = get()
    const index = state.project.document.lines.findIndex((line) => line.id === lineId)
    if (index < 0) return
    state.commit('Delete lyric line', [{ type: 'delete-line', lineId }])
    const remaining = get().project.document.lines
    set({ selectedLineId: remaining[Math.min(index, remaining.length - 1)]?.id ?? null })
  },

  moveLine: (lineId, delta) => {
    const state = get()
    const index = state.project.document.lines.findIndex((line) => line.id === lineId)
    const toIndex = index + delta
    if (index < 0 || toIndex < 0 || toIndex >= state.project.document.lines.length) return
    state.commit('Reorder lyric line', [{ type: 'move-line', lineId, toIndex }])
  },

  moveLineTo: (lineId, toIndex) => {
    const state = get()
    const index = state.project.document.lines.findIndex((line) => line.id === lineId)
    const boundedIndex = Math.max(0, Math.min(toIndex, state.project.document.lines.length - 1))
    if (index < 0 || index === boundedIndex) return
    state.commit('Reorder lyric line', [{ type: 'move-line', lineId, toIndex: boundedIndex }])
  },

  splitLine: (lineId, offset) => {
    const state = get()
    const index = state.project.document.lines.findIndex((line) => line.id === lineId)
    const line = state.project.document.lines[index]
    if (!line || offset <= 0 || offset >= line.text.length) return
    const firstText = line.text.slice(0, offset).trimEnd()
    const secondText = line.text.slice(offset).trimStart()
    const next = createLine({ text: secondText, startMs: null, sectionBreakBefore: false, reviewState: line.reviewState })
    state.commit('Split lyric line', [
      { type: 'update-line', lineId, patch: { text: firstText, words: [], furigana: [], confidence: undefined } },
      { type: 'insert-line', index: index + 1, line: next },
    ])
    set({ selectedLineId: next.id })
  },

  mergeLine: (lineId) => {
    const state = get()
    const index = state.project.document.lines.findIndex((line) => line.id === lineId)
    if (index <= 0) return
    const previous = state.project.document.lines[index - 1]
    const current = state.project.document.lines[index]
    state.commit('Merge lyric lines', [
      { type: 'update-line', lineId: previous.id, patch: { text: `${previous.text}${previous.text && current.text ? ' ' : ''}${current.text}`, words: [], furigana: [], confidence: undefined } },
      { type: 'delete-line', lineId },
    ])
    set({ selectedLineId: previous.id })
  },

  sortByTime: () => {
    const state = get()
    const lines = [...state.project.document.lines].sort((left, right) => (
      (left.startMs ?? Number.POSITIVE_INFINITY) - (right.startMs ?? Number.POSITIVE_INFINITY)
    ))
    state.commit('Sort lines by time', [{ type: 'replace-document', document: { ...state.project.document, lines } }])
  },

  stampSelected: (timeMs) => {
    const state = get()
    const index = state.project.document.lines.findIndex((line) => line.id === state.selectedLineId)
    if (index < 0) return
    state.updateLine(state.project.document.lines[index].id, { startMs: Math.max(0, Math.round(timeMs)) }, 'Stamp line timing')
    set({ selectedLineId: get().project.document.lines[index + 1]?.id ?? state.selectedLineId })
  },

  nudgeSelected: (deltaMs) => {
    const state = get()
    const line = state.project.document.lines.find((candidate) => candidate.id === state.selectedLineId)
    if (!line) return
    state.updateLine(line.id, { startMs: Math.max(0, (line.startMs ?? 0) + deltaMs) }, 'Nudge line timing')
  },

  importText: (text) => {
    const state = get()
    const result = importLyrics(text)
    result.document.metadata = mergeImportedMetadata(state.project.document.metadata, result.document.metadata)
    state.commit('Import lyrics', [{ type: 'replace-document', document: result.document }])
    set({ selectedLineId: result.document.lines[0]?.id ?? null })
    return result.warnings.map((warning) => `Line ${warning.line}: ${warning.message}`)
  },

  sourceText: () => serializeLyrics(get().project.document, 'xlrc', true).content,

  applySource: (source) => {
    try {
      const state = get()
      const result = reconcileSourceDocument(state.project.document, source)
      const blocking = result.warnings.filter((warning) => ['malformed-timestamp', 'unrecognized-line', 'orphan-translation'].includes(warning.code))
      if (blocking.length) return { applied: false, warnings: result.warnings.map((warning) => warning.message), error: blocking[0].message }
      result.document.metadata = mergeImportedMetadata(state.project.document.metadata, result.document.metadata)
      state.commit('Apply source changes', [{ type: 'replace-document', document: result.document }])
      return { applied: true, warnings: result.warnings.map((warning) => warning.message) }
    } catch (error) {
      return { applied: false, warnings: [], error: error instanceof Error ? error.message : 'Could not parse source.' }
    }
  },

  undo: () => {
    const state = get()
    const frame = state.history.at(-1)
    if (!frame) return
    set({
      project: restoreFrame(state.project, frame),
      history: state.history.slice(0, -1),
      future: [...state.future, snapshot(state.project, frame.label)],
      dirty: true,
      selectedLineId: frame.document.lines.some((line) => line.id === state.selectedLineId) ? state.selectedLineId : frame.document.lines[0]?.id ?? null,
      lastAction: `Undo ${frame.label.toLowerCase()}`,
    })
  },

  redo: () => {
    const state = get()
    const frame = state.future.at(-1)
    if (!frame) return
    set({
      project: restoreFrame(state.project, frame),
      history: [...state.history, snapshot(state.project, frame.label)],
      future: state.future.slice(0, -1),
      dirty: true,
      lastAction: `Redo ${frame.label.toLowerCase()}`,
    })
  },
}))
