import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { LyrisApi } from '../types/api'

const api: LyrisApi = {
  platform: process.platform,
  files: {
    pathForFile: (file) => webUtils.getPathForFile(file),
  },
  project: {
    open: () => ipcRenderer.invoke('project:open'),
    openPath: (path) => ipcRenderer.invoke('project:open-path', path),
    save: (request) => ipcRenderer.invoke('project:save', request),
    autosave: (request) => ipcRenderer.invoke('project:autosave', request),
    loadRecovery: () => ipcRenderer.invoke('project:load-recovery'),
    writeRecovery: (project) => ipcRenderer.invoke('project:write-recovery', project),
    clearRecovery: () => ipcRenderer.invoke('project:clear-recovery'),
    recent: () => ipcRenderer.invoke('project:recent'),
    consumeOpenRequest: () => ipcRenderer.invoke('project:consume-open-request'),
    onOpenRequested: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, path: string): void => callback(path)
      ipcRenderer.on('project:open-requested', handler)
      return () => ipcRenderer.removeListener('project:open-requested', handler)
    },
  },
  audio: {
    select: (projectPath) => ipcRenderer.invoke('audio:select', projectPath),
    openPath: (path, projectPath) => ipcRenderer.invoke('audio:open-path', path, projectPath),
    relocate: (reference, projectPath) => ipcRenderer.invoke('audio:relocate', reference, projectPath),
  },
  lyrics: {
    import: () => ipcRenderer.invoke('lyrics:import'),
    readPath: (path) => ipcRenderer.invoke('lyrics:read-path', path),
    export: (request) => ipcRenderer.invoke('lyrics:export', request),
  },
  window: {
    setDocumentEdited: (edited) => ipcRenderer.send('window:set-document-edited', edited),
    setTitle: (title) => ipcRenderer.send('window:set-title', title),
    setZoomFactor: (factor) => ipcRenderer.send('window:set-zoom-factor', factor),
  },
}

contextBridge.exposeInMainWorld('lyris', api)

const menuChannels = ['open-project', 'open-audio', 'import-lyrics', 'save', 'save-as', 'scale-in', 'scale-out', 'scale-reset'] as const
for (const channel of menuChannels) {
  ipcRenderer.on(`menu:${channel}`, () => window.dispatchEvent(new CustomEvent(`lyris-menu-${channel}`)))
}
