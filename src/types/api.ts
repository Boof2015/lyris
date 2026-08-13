import type {
  AudioReference,
  AudioSelection,
  ExportRequest,
  ExportResult,
  ImportedLyricsFile,
  LyrisProject,
  OpenProjectResult,
  RecentProject,
  SaveProjectRequest,
  SaveProjectResult,
} from './project'

export interface LyrisApi {
  platform: NodeJS.Platform
  project: {
    open: () => Promise<OpenProjectResult | null>
    openPath: (path: string) => Promise<OpenProjectResult>
    save: (request: SaveProjectRequest) => Promise<SaveProjectResult | null>
    autosave: (request: SaveProjectRequest) => Promise<SaveProjectResult | null>
    loadRecovery: () => Promise<LyrisProject | null>
    writeRecovery: (project: LyrisProject) => Promise<void>
    clearRecovery: () => Promise<void>
    recent: () => Promise<RecentProject[]>
    consumeOpenRequest: () => Promise<string | null>
    onOpenRequested: (callback: (path: string) => void) => () => void
  }
  audio: {
    select: (projectPath: string | null) => Promise<AudioSelection | null>
    relocate: (reference: AudioReference, projectPath: string | null) => Promise<AudioSelection | null>
  }
  lyrics: {
    import: () => Promise<ImportedLyricsFile | null>
    readPath: (path: string) => Promise<ImportedLyricsFile>
    export: (request: ExportRequest) => Promise<ExportResult | null>
  }
  window: {
    setDocumentEdited: (edited: boolean) => void
    setTitle: (title: string) => void
    setZoomFactor: (factor: number) => void
  }
}
