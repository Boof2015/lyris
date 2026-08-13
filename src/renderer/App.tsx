import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AudioSelection, ExportFormat, LyrisProject, RecentProject } from '../types/project'
import { serializeLyrics } from '../shared/formats'
import { useEditorStore } from './store/editorStore'
import { EditorWorkspace } from './components/EditorWorkspace'
import { AudioIcon, CheckIcon, ExportIcon, FolderIcon, ImportIcon, WarningIcon } from './components/Icons'

interface Notice {
  id: number
  message: string
  kind: 'info' | 'warning' | 'success'
}

interface LyricsSuggestion {
  sidecarPath: string | null
  embeddedLyrics: string | null
}

const audioExtensions = new Set(['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'aif'])
const lyricExtensions = new Set(['txt', 'lrc', 'elrc', 'xlrc'])

function fileExtension(name: string): string {
  return name.toLowerCase().split('.').at(-1) ?? ''
}

function recentLocation(path: string): string {
  const parts = path.replace(/\\/gu, '/').split('/').filter(Boolean)
  const folder = parts.at(-2)
  return folder ? `In ${folder}` : 'Lyris project'
}

function recentWhen(value: string): string {
  const opened = new Date(value)
  const elapsedDays = Math.floor((Date.now() - opened.getTime()) / 86_400_000)
  if (elapsedDays <= 0) return 'Today'
  if (elapsedDays === 1) return 'Yesterday'
  if (elapsedDays < 7) return `${elapsedDays} days ago`
  return opened.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: opened.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

function EmptyState({ recent, recovery, onOpenProject, onOpenPath, onOpenAudio, onRecover, onDiscardRecovery }: {
  recent: RecentProject[]
  recovery: LyrisProject | null
  onOpenProject: () => void
  onOpenPath: (path: string) => void
  onOpenAudio: () => void
  onRecover: () => void
  onDiscardRecovery: () => void
}): React.ReactElement {
  return <main className="empty-app">
    <header className="empty-titlebar">
      <div className="brand"><div className="brand-mark">L</div><div><strong>LYRIS</strong><span>LYRIC WORKSTATION</span></div></div>
      <div className="empty-header-meta"><span><i />Local-first</span><span>Works with LRC, Enhanced LRC, and XLRC</span></div>
    </header>
    <section className="home-content">
      {recovery && <div className="recovery-card"><WarningIcon /><div><span className="eyebrow">RECOVERY</span><strong>Continue unsaved work</strong><span>{recovery.document.metadata.title || recovery.audio?.fileName || 'Untitled project'} · {recovery.document.lines.length} lines</span></div><button type="button" onClick={onRecover}>Recover</button><button type="button" className="quiet" onClick={onDiscardRecovery}>Discard</button></div>}
      <div className="home-grid">
        <section className="home-start">
          <span className="eyebrow">Create</span>
          <h1>Start a lyric project.</h1>
          <p>Choose the song first, or continue an existing Lyris workspace.</p>
          <div className="home-actions">
            <button type="button" className="home-primary" onClick={onOpenAudio}><span className="home-action-icon"><AudioIcon /></span><span><strong>New from audio</strong><small>Attach a song and begin timing</small></span><kbd>⇧⌘O</kbd></button>
            <button type="button" onClick={onOpenProject}><span className="home-action-icon"><FolderIcon /></span><span><strong>Open project</strong><small>Continue from an existing .lyris file</small></span><kbd>⌘O</kbd></button>
          </div>
          <div className="home-local-note"><i /><span>Projects stay local. Audio remains external to the project file.</span></div>
        </section>
        <section className="recent-section">
          <header><div><span className="eyebrow">Recent projects</span><h2>Pick up where you left off</h2></div>{recent.length > 0 && <small>{recent.length}</small>}</header>
          {recent.length === 0 ? <div className="recent-empty"><div className="recent-icon"><FolderIcon /></div><strong>No recent projects</strong><span>Your saved Lyris projects will collect here.</span></div> : <div className="recent-list">{recent.map((entry) => <button type="button" key={entry.path} onClick={() => onOpenPath(entry.path)} aria-label={`Open ${entry.name}`} title={entry.path}>
            <span className="recent-icon"><FolderIcon /></span>
            <span className="recent-copy"><strong>{entry.name}</strong><small>{recentLocation(entry.path)}</small></span>
            <time dateTime={entry.lastOpenedAt}>{recentWhen(entry.lastOpenedAt)}</time>
            <span className="recent-arrow" aria-hidden="true">→</span>
          </button>)}</div>}
        </section>
      </div>
    </section>
    <footer className="empty-footer"><span>Local-first lyric editing</span><span className="footer-version">Lyris 0.1 alpha</span></footer>
  </main>
}

function ExportDialog({ onClose, onExported }: { onClose: () => void; onExported: (path: string) => void }): React.ReactElement {
  const project = useEditorStore((state) => state.project)
  const [format, setFormat] = useState<ExportFormat>(project.exportPreferences.format)
  const [busy, setBusy] = useState(false)
  const serialized = useMemo(() => serializeLyrics(project.document, format, project.exportPreferences.includeMetadata), [format, project])
  const baseName = (project.document.metadata.title || 'lyrics').replace(/[\\/:*?"<>|]/gu, '-').trim() || 'lyrics'
  const extension = format === 'xlrc' ? 'xlrc' : 'lrc'
  const formatName = format === 'elrc' ? 'Enhanced LRC' : format.toUpperCase()
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <header><div><span className="eyebrow">Ready to share</span><h2 id="export-title">Export lyrics</h2><p>Choose how much lyric detail to include.</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="Close export dialog">×</button></header>
      <div className="format-grid">
        {(['lrc', 'elrc', 'xlrc'] as const).map((item) => <button type="button" key={item} className={format === item ? 'selected' : ''} aria-pressed={format === item} onClick={() => setFormat(item)}><span className="format-choice-heading"><strong>{item === 'elrc' ? 'Enhanced LRC' : item.toUpperCase()}</strong><i><CheckIcon /></i></span><span>{item === 'lrc' ? 'Line timing and plain text' : item === 'elrc' ? 'Line and word timing' : 'Every supported lyric field'}</span></button>)}
      </div>
      <div className="export-summary"><div><span>File</span><strong>{baseName}.{extension}</strong></div><div><span>Timed rows</span><strong>{project.document.lines.filter((line) => line.startMs !== null).length} / {project.document.lines.length}</strong></div></div>
      {serialized.notices.length > 0 ? <div className="downgrade-notices"><strong><WarningIcon />This format cannot represent everything</strong>{serialized.notices.map((notice) => <p key={notice.code}>{notice.message}</p>)}</div> : <div className="lossless-notice">All supported project lyric fields will be included.</div>}
      <footer><button type="button" onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={busy} onClick={async () => {
        setBusy(true)
        try {
          const result = await window.lyris.lyrics.export({ suggestedName: `${baseName}.${extension}`, format, content: serialized.content })
          if (result) onExported(result.path)
        } finally { setBusy(false) }
      }}><ExportIcon />{busy ? 'Exporting…' : `Export ${formatName}`}</button></footer>
    </section>
  </div>
}

export default function App(): React.ReactElement {
  const project = useEditorStore((state) => state.project)
  const projectPath = useEditorStore((state) => state.projectPath)
  const audioUrl = useEditorStore((state) => state.audioUrl)
  const dirty = useEditorStore((state) => state.dirty)
  const newProject = useEditorStore((state) => state.newProject)
  const loadProject = useEditorStore((state) => state.loadProject)
  const restoreProject = useEditorStore((state) => state.restoreProject)
  const markSaved = useEditorStore((state) => state.markSaved)
  const attachAudio = useEditorStore((state) => state.attachAudio)
  const importText = useEditorStore((state) => state.importText)
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [recovery, setRecovery] = useState<LyrisProject | null>(null)
  const [suggestion, setSuggestion] = useState<LyricsSuggestion | null>(null)
  const [notices, setNotices] = useState<Notice[]>([])
  const [exportOpen, setExportOpen] = useState(false)
  const hasWorkspace = Boolean(projectPath || audioUrl || project.audio || project.document.lines.length)

  const notify = useCallback((message: string, kind: Notice['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setNotices((items) => [...items, { id, message, kind }])
    window.setTimeout(() => setNotices((items) => items.filter((item) => item.id !== id)), 4200)
  }, [])

  const refreshRecent = useCallback(() => { void window.lyris.project.recent().then(setRecent) }, [])

  useEffect(() => {
    const savedScale = Number(window.localStorage.getItem('lyris.interfaceScale'))
    if (Number.isFinite(savedScale) && savedScale >= 75 && savedScale <= 200) window.lyris.window.setZoomFactor(savedScale / 100)
    refreshRecent()
    void window.lyris.project.loadRecovery().then(setRecovery)
  }, [refreshRecent])

  const guardUnsaved = useCallback((): boolean => !dirty || window.confirm('Discard unsaved changes to this project?'), [dirty])

  const openPath = useCallback(async (path: string) => {
    if (!guardUnsaved()) return
    try { loadProject(await window.lyris.project.openPath(path)); setSuggestion(null); refreshRecent() }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not open project.', 'warning') }
  }, [guardUnsaved, loadProject, notify, refreshRecent])

  useEffect(() => window.lyris.project.onOpenRequested((path) => { void openPath(path) }), [openPath])

  useEffect(() => {
    void window.lyris.project.consumeOpenRequest().then((path) => { if (path) void openPath(path) })
  }, [openPath])

  const openProject = useCallback(async () => {
    if (!guardUnsaved()) return
    try { const result = await window.lyris.project.open(); if (result) { loadProject(result); setSuggestion(null); refreshRecent() } }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not open project.', 'warning') }
  }, [guardUnsaved, loadProject, notify, refreshRecent])

  const consumeAudioSelection = useCallback((selection: AudioSelection) => {
    attachAudio(selection)
    setSuggestion(selection.sidecarPath || selection.embeddedLyrics ? { sidecarPath: selection.sidecarPath, embeddedLyrics: selection.embeddedLyrics } : null)
  }, [attachAudio])

  const openAudio = useCallback(async () => {
    try { const selection = await window.lyris.audio.select(projectPath); if (selection) consumeAudioSelection(selection) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not open audio.', 'warning') }
  }, [consumeAudioSelection, notify, projectPath])

  const importDroppedFiles = useCallback(async (files: File[]) => {
    const resolved = files.map((file) => ({ file, extension: fileExtension(file.name), path: window.lyris.files.pathForFile(file) }))
    const audioFiles = resolved.filter((entry) => audioExtensions.has(entry.extension) && entry.path)
    const lyricFiles = resolved.filter((entry) => lyricExtensions.has(entry.extension) && entry.path)
    const unsupported = resolved.length - audioFiles.length - lyricFiles.length
    if (!audioFiles.length && !lyricFiles.length) {
      notify(files.some((file) => fileExtension(file.name) === 'lyris')
        ? 'Open .lyris projects from Home or File → Open Project.'
        : 'Drop a supported audio file or TXT, LRC, Enhanced LRC, or XLRC lyrics.', 'warning')
      return
    }
    try {
      const messages: string[] = []
      let warning = unsupported > 0 || audioFiles.length > 1 || lyricFiles.length > 1
      if (audioFiles[0]) {
        consumeAudioSelection(await window.lyris.audio.openPath(audioFiles[0].path, projectPath))
        messages.push(`Attached ${audioFiles[0].file.name}.`)
      }
      if (lyricFiles[0]) {
        const imported = await window.lyris.lyrics.readPath(lyricFiles[0].path)
        const warnings = importText(imported.text)
        warning ||= warnings.length > 0
        messages.push(`Imported ${imported.fileName}${warnings.length ? ` with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}.`)
      }
      const ignored = unsupported + Math.max(0, audioFiles.length - 1) + Math.max(0, lyricFiles.length - 1)
      if (ignored) messages.push(`Ignored ${ignored} additional file${ignored === 1 ? '' : 's'}.`)
      notify(messages.join(' '), warning ? 'warning' : 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not import the dropped files.', 'warning')
    }
  }, [consumeAudioSelection, importText, notify, projectPath])

  const importLyricsFile = useCallback(async () => {
    try {
      const imported = await window.lyris.lyrics.import()
      if (!imported) return
      const warnings = importText(imported.text)
      notify(warnings.length ? `Imported ${imported.fileName} with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.` : `Imported ${imported.fileName}.`, warnings.length ? 'warning' : 'success')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not import lyrics.', 'warning') }
  }, [importText, notify])

  const save = useCallback(async (saveAs = false) => {
    try {
      const state = useEditorStore.getState()
      const result = await window.lyris.project.save({ project: state.project, path: saveAs ? null : state.projectPath, sourcePath: state.projectPath })
      if (!result) return
      markSaved(result.path, result.project)
      await window.lyris.project.clearRecovery()
      setRecovery(null)
      refreshRecent()
      notify('Project saved.', 'success')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not save project.', 'warning') }
  }, [markSaved, notify, refreshRecent])

  const goHome = useCallback(async () => {
    const state = useEditorStore.getState()
    try {
      if (state.dirty && state.projectPath) {
        await window.lyris.project.autosave({ project: state.project, path: state.projectPath, sourcePath: state.projectPath })
      } else if (state.dirty) {
        await window.lyris.project.writeRecovery(state.project)
        setRecovery(state.project)
      }
      setSuggestion(null)
      setExportOpen(false)
      newProject()
      refreshRecent()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not preserve the current project before returning home.', 'warning')
    }
  }, [newProject, notify, refreshRecent])

  useEffect(() => {
    window.lyris.window.setDocumentEdited(dirty)
    const title = project.document.metadata.title || project.audio?.fileName || 'Untitled'
    window.lyris.window.setTitle(`${dirty ? '● ' : ''}${title} — Lyris`)
  }, [dirty, project.audio?.fileName, project.document.metadata.title])

  useEffect(() => {
    if (!dirty) return
    const revision = project.revision
    const timer = window.setTimeout(async () => {
      try {
        if (projectPath) {
          const result = await window.lyris.project.autosave({ project, path: projectPath, sourcePath: projectPath })
          if (result && useEditorStore.getState().project.revision === revision) markSaved(result.path, result.project)
        } else {
          await window.lyris.project.writeRecovery(project)
          setRecovery(project)
        }
      } catch { /* an explicit save will surface storage errors */ }
    }, 900)
    return () => window.clearTimeout(timer)
  }, [dirty, markSaved, project, projectPath])

  useEffect(() => {
    const handlers: Array<[string, EventListener]> = [
      ['lyris-menu-open-project', () => void openProject()],
      ['lyris-menu-open-audio', () => void openAudio()],
      ['lyris-menu-import-lyrics', () => void importLyricsFile()],
      ['lyris-menu-save', () => void save(false)],
      ['lyris-menu-save-as', () => void save(true)],
    ]
    handlers.forEach(([name, handler]) => window.addEventListener(name, handler))
    return () => handlers.forEach(([name, handler]) => window.removeEventListener(name, handler))
  }, [importLyricsFile, openAudio, openProject, save])

  const importSuggestion = async (kind: 'sidecar' | 'embedded'): Promise<void> => {
    if (!suggestion) return
    try {
      const text = kind === 'embedded'
        ? suggestion.embeddedLyrics
        : suggestion.sidecarPath ? (await window.lyris.lyrics.readPath(suggestion.sidecarPath)).text : null
      if (!text) return
      const warnings = importText(text)
      notify(`Imported ${kind === 'embedded' ? 'embedded lyrics' : 'the discovered sidecar'}${warnings.length ? ` with ${warnings.length} warnings` : ''}.`, warnings.length ? 'warning' : 'success')
      setSuggestion(null)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not import suggested lyrics.', 'warning') }
  }

  const banner = suggestion ? <div className="workspace-banner info"><ImportIcon /><div><strong>Lyrics found with this audio</strong><span>Import them as a new undoable document change, or keep the current draft.</span></div>{suggestion.sidecarPath && <button type="button" onClick={() => void importSuggestion('sidecar')}>Import sidecar</button>}{suggestion.embeddedLyrics && <button type="button" onClick={() => void importSuggestion('embedded')}>Import embedded</button>}<button type="button" className="quiet" onClick={() => setSuggestion(null)}>Dismiss</button></div> : undefined

  return <>
    {!hasWorkspace ? <EmptyState
      recent={recent}
      recovery={recovery}
      onOpenProject={() => void openProject()}
      onOpenPath={(path) => void openPath(path)}
      onOpenAudio={() => { newProject(); void openAudio() }}
      onRecover={() => { if (recovery) { restoreProject(recovery); setRecovery(null) } }}
      onDiscardRecovery={() => { void window.lyris.project.clearRecovery(); setRecovery(null) }}
    /> : <EditorWorkspace
      onHome={() => void goHome()}
      onDropFiles={(files) => void importDroppedFiles(files)}
      onOpenAudio={() => void openAudio()}
      onImportLyrics={() => void importLyricsFile()}
      onSave={(saveAs) => void save(saveAs)}
      onExport={() => setExportOpen(true)}
      onRelocateAudio={async () => {
        if (!project.audio) return
        try { const selection = await window.lyris.audio.relocate(project.audio, projectPath); if (selection) consumeAudioSelection(selection) }
        catch (error) { notify(error instanceof Error ? error.message : 'Could not relocate audio.', 'warning') }
      }}
      banner={banner}
      onNotice={notify}
    />}
    {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} onExported={(path) => { setExportOpen(false); notify(`Exported ${path.split(/[\\/]/u).at(-1)}.`, 'success') }} />}
    <div className="toast-stack" aria-live="polite">{notices.map((notice) => <div className={`toast ${notice.kind}`} key={notice.id}>{notice.kind === 'warning' && <WarningIcon />}<span>{notice.message}</span><button type="button" onClick={() => setNotices((items) => items.filter((item) => item.id !== notice.id))}>×</button></div>)}</div>
  </>
}
