export type Milliseconds = number

export type ReviewState = 'unreviewed' | 'needs-review' | 'reviewed'
export type ProvenanceKind = 'manual' | 'import' | 'asr' | 'alignment' | 'translation' | 'romanization'

export interface Provenance {
  kind: ProvenanceKind
  provider?: string
  model?: string
  jobId?: string
  createdAt: string
}

export interface LyricFurigana {
  start: number
  end: number
  base: string
  reading: string
}

export interface LyricWord {
  id: string
  text: string
  startMs: Milliseconds
  endMs: Milliseconds | null
  furigana: LyricFurigana[]
  confidence?: number
  provenance?: Provenance
}

export interface LyricTranslation {
  id: string
  language: string
  text: string
  provenance?: Provenance
}

export interface LyricLine {
  id: string
  kind: 'lyric' | 'instrumental'
  sectionBreakBefore: boolean
  text: string
  startMs: Milliseconds | null
  endMs: Milliseconds | null
  voice: string | null
  translations: LyricTranslation[]
  furigana: LyricFurigana[]
  words: LyricWord[]
  reviewState: ReviewState
  confidence?: number
  provenance?: Provenance
}

export interface TrackMetadata {
  title: string
  artist: string
  album: string
  primaryLanguage: string
  languages: string[]
  durationMs: Milliseconds | null
  extra: Record<string, string | number | string[]>
}

export interface LyricsDocument {
  id: string
  metadata: TrackMetadata
  lines: LyricLine[]
}

export interface AudioFingerprint {
  algorithm: 'sha256-windowed-v1'
  value: string
  size: number
}

export interface AudioReference {
  path: string
  pathKind: 'relative' | 'absolute'
  fileName: string
  mimeType: string | null
  fingerprint: AudioFingerprint
  durationMs: Milliseconds | null
}

export type ExportFormat = 'lrc' | 'elrc' | 'xlrc'

export interface ExportPreferences {
  format: ExportFormat
  includeMetadata: boolean
}

export interface LyrisProjectV1 {
  schema: 'dev.astramusic.lyris/project'
  version: 1
  id: string
  createdAt: string
  updatedAt: string
  revision: number
  audio: AudioReference | null
  document: LyricsDocument
  exportPreferences: ExportPreferences
}

export type LyrisProject = LyrisProjectV1

export type DocumentOperation =
  | { type: 'replace-document'; document: LyricsDocument }
  | { type: 'insert-line'; index: number; line: LyricLine }
  | { type: 'update-line'; lineId: string; patch: Partial<Omit<LyricLine, 'id'>> }
  | { type: 'delete-line'; lineId: string }
  | { type: 'move-line'; lineId: string; toIndex: number }
  | { type: 'update-metadata'; patch: Partial<TrackMetadata> }

export interface DocumentTransaction {
  id: string
  label: string
  baseRevision: number
  operations: DocumentOperation[]
  createdAt: string
}

export interface ProposalDiagnostic {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  lineId?: string
}

export interface DocumentProposal extends DocumentTransaction {
  provenance: Provenance
  jobId?: string
  diagnostics: ProposalDiagnostic[]
}

export interface DocumentIssue extends ProposalDiagnostic {
  field?: string
}

export interface RecentProject {
  path: string
  name: string
  lastOpenedAt: string
}

export interface AudioSelection {
  reference: AudioReference
  sourceUrl: string
  metadata: Partial<TrackMetadata>
  sidecarPath: string | null
  embeddedLyrics: string | null
}

export interface OpenProjectResult {
  path: string
  project: LyrisProject
  audioUrl: string | null
  missingAudio: boolean
}

export interface SaveProjectRequest {
  project: LyrisProject
  path: string | null
  sourcePath: string | null
}

export interface SaveProjectResult {
  path: string
  project: LyrisProject
}

export interface ImportedLyricsFile {
  path: string
  fileName: string
  text: string
}

export interface ExportRequest {
  suggestedName: string
  format: ExportFormat
  content: string
}

export interface ExportResult {
  path: string
}

export interface DowngradeNotice {
  code: string
  count: number
  message: string
}

export interface SerializedLyrics {
  content: string
  notices: DowngradeNotice[]
}
