import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { Readable } from 'node:stream'
import { basename, extname, resolve } from 'node:path'
import type { ExportRequest, SaveProjectRequest } from '../types/project'
import { AudioRegistry, mimeFor } from './audioFiles'
import { ProjectStorage } from './projectStorage'

protocol.registerSchemesAsPrivileged([{
  scheme: 'lyris-media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}])

let mainWindow: BrowserWindow | null = null
const audioRegistry = new AudioRegistry()
let projectStorage: ProjectStorage
let pendingProjectPath = process.argv.find((argument) => argument.toLowerCase().endsWith('.lyris') && existsSync(argument)) ?? null
const audioExtensions = new Set(['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'aif'])

interface ByteRange {
  start: number
  end: number
}

function requestedByteRange(value: string | null, size: number): ByteRange | null | 'invalid' {
  if (!value) return null
  const match = value.match(/^bytes=(\d*)-(\d*)$/u)
  if (!match || (!match[1] && !match[2]) || size <= 0) return 'invalid'
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid'
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }
  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) return 'invalid'
  return { start, end: Math.min(requestedEnd, size - 1) }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 640,
    title: 'Lyris',
    backgroundColor: '#111315',
    show: false,
    webPreferences: {
      preload: resolve(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(resolve(__dirname, '../renderer/index.html'))
  }
  mainWindow.on('closed', () => { mainWindow = null })
}

function installMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu:open-project') },
        { label: 'Open Audio…', accelerator: 'CmdOrCtrl+Shift+O', click: () => mainWindow?.webContents.send('menu:open-audio') },
        { label: 'Import Lyrics…', accelerator: 'CmdOrCtrl+I', click: () => mainWindow?.webContents.send('menu:import-lyrics') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow?.webContents.send('menu:save-as') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Increase Interface Size', accelerator: 'CmdOrCtrl+Plus', click: () => mainWindow?.webContents.send('menu:scale-in') },
        { label: 'Decrease Interface Size', accelerator: 'CmdOrCtrl+-', click: () => mainWindow?.webContents.send('menu:scale-out') },
        { label: 'Actual Interface Size', accelerator: 'CmdOrCtrl+0', click: () => mainWindow?.webContents.send('menu:scale-reset') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc(): void {
  ipcMain.handle('project:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'], filters: [{ name: 'Lyris Project', extensions: ['lyris'] }] })
    return result.canceled || !result.filePaths[0] ? null : projectStorage.open(result.filePaths[0])
  })
  ipcMain.handle('project:open-path', (_event, path: string) => projectStorage.open(path))
  ipcMain.handle('project:save', async (_event, request: SaveProjectRequest) => {
    let path = request.path
    if (!path) {
      const suggested = `${request.project.document.metadata.title || 'Untitled'}.lyris`
      const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: suggested, filters: [{ name: 'Lyris Project', extensions: ['lyris'] }] })
      if (result.canceled || !result.filePath) return null
      path = result.filePath
    }
    return projectStorage.save(request.project, path, request.sourcePath)
  })
  ipcMain.handle('project:autosave', (_event, request: SaveProjectRequest) => request.path ? projectStorage.save(request.project, request.path, request.sourcePath) : null)
  ipcMain.handle('project:load-recovery', () => projectStorage.loadRecovery())
  ipcMain.handle('project:write-recovery', (_event, project) => projectStorage.writeRecovery(project))
  ipcMain.handle('project:clear-recovery', () => projectStorage.clearRecovery())
  ipcMain.handle('project:recent', () => projectStorage.recent())
  ipcMain.handle('project:consume-open-request', () => {
    const path = pendingProjectPath ? resolve(pendingProjectPath) : null
    pendingProjectPath = null
    return path
  })

  ipcMain.handle('audio:select', async (_event, projectPath: string | null) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'aif'] }],
    })
    return result.canceled || !result.filePaths[0] ? null : audioRegistry.select(result.filePaths[0], projectPath)
  })
  ipcMain.handle('audio:open-path', (_event, path: string, projectPath: string | null) => {
    const absolute = resolve(path)
    const extension = extname(absolute).slice(1).toLowerCase()
    if (!audioExtensions.has(extension)) throw new Error('That dropped file is not a supported audio format.')
    return audioRegistry.select(absolute, projectPath)
  })
  ipcMain.handle('audio:relocate', async (_event, reference, projectPath: string | null) => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'] })
    return result.canceled || !result.filePaths[0] ? null : audioRegistry.relocate(result.filePaths[0], reference, projectPath)
  })

  ipcMain.handle('lyrics:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'], filters: [{ name: 'Lyrics', extensions: ['txt', 'lrc', 'elrc', 'xlrc'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const path = result.filePaths[0]
    return { path, fileName: basename(path), text: await readFile(path, 'utf8') }
  })
  ipcMain.handle('lyrics:read-path', async (_event, path: string) => ({ path, fileName: basename(path), text: await readFile(path, 'utf8') }))
  ipcMain.handle('lyrics:export', async (_event, request: ExportRequest) => {
    const extension = request.format === 'xlrc' ? 'xlrc' : 'lrc'
    const filterName = request.format === 'elrc' ? 'Enhanced LRC' : request.format.toUpperCase()
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: request.suggestedName,
      filters: [{ name: filterName, extensions: [extension] }],
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, request.content, 'utf8')
    return { path: result.filePath }
  })
  ipcMain.on('window:set-document-edited', (_event, edited: boolean) => mainWindow?.setDocumentEdited(edited))
  ipcMain.on('window:set-title', (_event, title: string) => { if (mainWindow) mainWindow.title = title })
  ipcMain.on('window:set-zoom-factor', (_event, factor: number) => mainWindow?.webContents.setZoomFactor(Math.max(0.5, Math.min(2, factor))))
}

app.whenReady().then(async () => {
  projectStorage = new ProjectStorage((path) => audioRegistry.register(path))
  protocol.handle('lyris-media', async (request) => {
    const filePath = audioRegistry.resolve(request.url)
    if (!filePath) return new Response('Not found', { status: 404 })
    try {
      const info = await stat(filePath)
      const range = requestedByteRange(request.headers.get('range'), info.size)
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Type': mimeFor(filePath) ?? 'application/octet-stream',
      })
      if (range === 'invalid') {
        headers.set('Content-Range', `bytes */${info.size}`)
        return new Response(null, { status: 416, headers })
      }
      const start = range?.start ?? 0
      const end = range?.end ?? Math.max(0, info.size - 1)
      headers.set('Content-Length', String(Math.max(0, end - start + 1)))
      if (range) headers.set('Content-Range', `bytes ${start}-${end}/${info.size}`)
      if (request.method === 'HEAD' || info.size === 0) return new Response(null, { status: range ? 206 : 200, headers })
      const body = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>
      return new Response(body, { status: range ? 206 : 200, headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; media-src 'self' lyris-media:; connect-src 'self' lyris-media:",
      ],
    },
  }))
  registerIpc()
  installMenu()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('open-file', (event, path) => {
  event.preventDefault()
  if (!path.toLowerCase().endsWith('.lyris')) return
  if (mainWindow) mainWindow.webContents.send('project:open-requested', resolve(path))
  else pendingProjectPath = path
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
