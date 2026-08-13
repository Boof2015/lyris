import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { RecentProject } from '../../src/types/project'

function silentWav(durationSeconds = 4, sampleRate = 8_000): Buffer {
  const samples = durationSeconds * sampleRate
  const dataSize = samples * 2
  const output = Buffer.alloc(44 + dataSize)
  output.write('RIFF', 0)
  output.writeUInt32LE(36 + dataSize, 4)
  output.write('WAVEfmt ', 8)
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(1, 20)
  output.writeUInt16LE(1, 22)
  output.writeUInt32LE(sampleRate, 24)
  output.writeUInt32LE(sampleRate * 2, 28)
  output.writeUInt16LE(2, 32)
  output.writeUInt16LE(16, 34)
  output.write('data', 36)
  output.writeUInt32LE(dataSize, 40)
  return output
}

async function fixture(): Promise<{ directory: string; audioPath: string; projectPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'lyris-e2e-'))
  const audioPath = join(directory, 'example.wav')
  const projectPath = join(directory, 'example.lyris')
  await writeFile(audioPath, silentWav())
  await writeFile(projectPath, `${JSON.stringify({
    schema: 'dev.astramusic.lyris/project', version: 1, id: 'project_e2e',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 0,
    audio: {
      path: audioPath, pathKind: 'absolute', fileName: 'example.wav', mimeType: 'audio/wav',
      fingerprint: { algorithm: 'sha256-windowed-v1', value: 'e2e', size: 64044 }, durationMs: 4000,
    },
    document: {
      id: 'document_e2e',
      metadata: { title: 'Example Song', artist: 'Lyris Test', album: '', primaryLanguage: 'en', languages: ['en', 'es'], durationMs: 4000, extra: {} },
      lines: [
        { id: 'line_one', kind: 'lyric', sectionBreakBefore: false, text: 'Hello world', startMs: 1000, endMs: null, voice: null, translations: [{ id: 'translation_one', language: 'es', text: 'Hola mundo' }], furigana: [], words: [], reviewState: 'unreviewed' },
        { id: 'line_two', kind: 'lyric', sectionBreakBefore: false, text: 'Second line', startMs: 2000, endMs: null, voice: null, translations: [], furigana: [], words: [
          { id: 'word_second', text: 'Second ', startMs: 2000, endMs: 2500, furigana: [] },
          { id: 'word_line', text: 'line', startMs: 2500, endMs: null, furigana: [] },
        ], reviewState: 'needs-review' },
      ],
    },
    exportPreferences: { format: 'xlrc', includeMetadata: true },
  }, null, 2)}\n`)
  return { directory, audioPath, projectPath }
}

async function realFixture(): Promise<{ directory: string; projectPath: string }> {
  const fixtureRoot = resolve('test/fixtures/real-project')
  const directory = await mkdtemp(join(tmpdir(), 'lyris-real-e2e-'))
  const projectPath = join(directory, 'BALALAIKA.lyris')
  const project = JSON.parse(await readFile(join(fixtureRoot, 'BALALAIKA.lyris'), 'utf8')) as {
    audio: { path: string; pathKind: 'absolute' | 'relative' }
  }
  project.audio.path = join(fixtureRoot, '4. 9Lana - BALALAIKA.flac')
  project.audio.pathKind = 'absolute'
  await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`)
  return { directory, projectPath }
}

async function launch(projectPath?: string, recents?: RecentProject[]): Promise<ElectronApplication> {
  const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  const userDataPath = await mkdtemp(join(tmpdir(), 'lyris-electron-data-'))
  if (recents) await writeFile(join(userDataPath, 'recent-projects.json'), `${JSON.stringify(recents, null, 2)}\n`)
  delete environment.ELECTRON_RUN_AS_NODE
  return electron.launch({
    args: [process.cwd(), `--user-data-dir=${userDataPath}`, ...(projectPath ? [projectPath] : [])],
    env: environment,
  })
}

async function homeRecents(): Promise<RecentProject[]> {
  const directory = await mkdtemp(join(tmpdir(), 'lyris-home-e2e-'))
  const names = ['BALALAIKA', 'Bibbidi-Bobbidi-Boo', 'Midnight Draft', 'Paper Moon', 'Afterglow', 'Untitled Session']
  return Promise.all(names.map(async (name, index) => {
    const path = join(directory, `${name.replaceAll(' ', '-')}.lyris`)
    await writeFile(path, '{}\n')
    return { path, name, lastOpenedAt: new Date(Date.now() - index * 86_400_000).toISOString() }
  }))
}

test('presents a focused, responsive project launcher', async () => {
  const app = await launch(undefined, await homeRecents())
  const page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: 'Start a lyric project.' })).toBeVisible()
  await expect(page.getByRole('button', { name: /New from audio/u })).toBeVisible()
  await expect(page.getByRole('button', { name: /Open project/u })).toBeVisible()
  await expect(page.locator('.recent-list > button')).toHaveCount(6)
  await expect(page.locator('.recent-copy small').first()).toContainText('In lyris-home-e2e-')
  await expect(page.getByText(/\/var\/folders/u)).toHaveCount(0)
  await page.screenshot({ path: join(tmpdir(), 'lyris-home-desktop.png'), fullPage: true })

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(940, 640))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(940)
  const viewport = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.body.scrollWidth }))
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width)
  await page.screenshot({ path: join(tmpdir(), 'lyris-home-minimum.png'), fullPage: true })
  await app.close()
})

test('opens, edits, times, autosaves, reopens, and prepares export', async () => {
  const { directory, audioPath, projectPath } = await fixture()
  const droppedLyricsPath = join(directory, 'dropped.lrc')
  await writeFile(droppedLyricsPath, '[00:00.50]Dropped lyric\n')
  let app = await launch(projectPath)
  let page = await app.firstWindow()
  await page.getByRole('button', { name: 'Edit track details' }).click()
  await expect(page.getByPlaceholder('Untitled track')).toHaveValue('Example Song')
  await page.screenshot({ path: join(tmpdir(), 'lyris-metadata-popover.png'), fullPage: true })
  await page.getByRole('button', { name: 'Close track details' }).click()
  await expect(page.getByRole('textbox', { name: 'Lyric line 1', exact: true })).toHaveValue('Hello world')

  await page.getByRole('button', { name: 'Go to Lyris home' }).click()
  await expect(page.getByRole('heading', { name: 'Start a lyric project.' })).toBeVisible()
  await page.getByRole('button', { name: 'Open Example Song' }).click()
  await expect(page.getByRole('textbox', { name: 'Lyric line 1', exact: true })).toHaveValue('Hello world')

  await page.evaluate(() => {
    const input = document.createElement('input')
    input.id = 'e2e-drop-files'
    input.type = 'file'
    input.multiple = true
    input.hidden = true
    document.body.append(input)
  })
  await page.locator('#e2e-drop-files').setInputFiles([audioPath, droppedLyricsPath])
  await page.evaluate(() => {
    const transfer = new DataTransfer()
    const input = document.querySelector<HTMLInputElement>('#e2e-drop-files')!
    Array.from(input.files ?? []).forEach((file) => transfer.items.add(file))
    ;(window as Window & { __lyrisTestDrop?: DataTransfer }).__lyrisTestDrop = transfer
    document.querySelector('.workspace')!.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await expect(page.getByRole('status', { name: 'Drop files to import' })).toBeVisible()
  await page.screenshot({ path: join(tmpdir(), 'lyris-drop-import.png'), fullPage: true })
  await page.evaluate(() => {
    const state = window as Window & { __lyrisTestDrop?: DataTransfer }
    document.querySelector('.workspace')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: state.__lyrisTestDrop }))
    delete state.__lyrisTestDrop
  })
  await expect(page.getByRole('status', { name: 'Drop files to import' })).toBeHidden()
  await expect(page.getByRole('textbox', { name: 'Lyric line 1', exact: true })).toHaveValue('Dropped lyric')
  await expect(page.locator('.toast.success')).toContainText('Attached example.wav. Imported dropped.lrc.')
  await page.keyboard.press('Meta+z')
  await expect(page.getByRole('textbox', { name: 'Lyric line 1', exact: true })).toHaveValue('Hello world')

  const separator = page.getByRole('separator', { name: 'Resize editor and preview' })
  await expect(separator).toHaveAttribute('aria-valuenow', '56')
  const editorBeforeResize = await page.locator('.editor-pane').boundingBox()
  const separatorBox = await separator.boundingBox()
  expect(editorBeforeResize).not.toBeNull()
  expect(separatorBox).not.toBeNull()
  await page.mouse.move(separatorBox!.x + separatorBox!.width / 2, separatorBox!.y + separatorBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(separatorBox!.x + separatorBox!.width / 2 + 80, separatorBox!.y + separatorBox!.height / 2)
  await page.mouse.up()
  await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(56)
  const editorAfterResize = await page.locator('.editor-pane').boundingBox()
  expect(editorAfterResize!.width).toBeGreaterThan(editorBeforeResize!.width)
  await page.screenshot({ path: join(tmpdir(), 'lyris-resized-panes.png'), fullPage: true })
  await separator.dblclick()
  await expect(separator).toHaveAttribute('aria-valuenow', '56')
  await separator.focus()
  await page.keyboard.press('ArrowRight')
  await expect(separator).toHaveAttribute('aria-valuenow', '57')
  await separator.dblclick()

  const defaultViewportWidth = await page.evaluate(() => innerWidth)
  await page.getByRole('button', { name: 'Interface scale', exact: true }).click()
  const interfaceScale = page.getByRole('slider', { name: 'Interface scale', exact: true })
  await interfaceScale.fill('125')
  await expect(page.locator('.workspace')).toHaveAttribute('data-interface-scale', '125')
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(defaultViewportWidth)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lyris.interfaceScale'))).toBe('125')
  const scaledLayout = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.project-header')!
    const panel = document.querySelector<HTMLElement>('.scale-popover')!.getBoundingClientRect()
    return { viewportWidth: innerWidth, headerWidth: header.clientWidth, headerScrollWidth: header.scrollWidth, panelLeft: panel.left, panelRight: panel.right }
  })
  expect(scaledLayout.headerScrollWidth).toBeLessThanOrEqual(scaledLayout.headerWidth)
  expect(scaledLayout.panelLeft).toBeGreaterThanOrEqual(0)
  expect(scaledLayout.panelRight).toBeLessThanOrEqual(scaledLayout.viewportWidth)
  // A viewport capture reflects Electron's physical window at non-default zoom;
  // Playwright's full-page canvas is expressed in zoomed CSS pixels and crops it.
  await page.screenshot({ path: join(tmpdir(), 'lyris-interface-scale.png') })
  await interfaceScale.fill('100')
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(defaultViewportWidth)
  await page.getByRole('button', { name: 'Close interface scale settings' }).click()

  await page.locator('[data-line-id="line_one"]').hover()
  await expect(page.getByRole('button', { name: 'Reorder lyric line 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Options for lyric line 1' }).click()
  await expect(page.getByRole('menuitem', { name: 'Add translation' })).toBeVisible()
  await page.keyboard.press('Escape')

  const inlineTime = page.getByRole('textbox', { name: 'Start time for lyric line 1' })
  const inlineTimeBox = await inlineTime.boundingBox()
  expect(inlineTimeBox).not.toBeNull()
  await page.mouse.move(inlineTimeBox!.x + inlineTimeBox!.width / 2, inlineTimeBox!.y + inlineTimeBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(inlineTimeBox!.x + inlineTimeBox!.width / 2 + 20, inlineTimeBox!.y + inlineTimeBox!.height / 2)
  await page.mouse.up()
  await expect(inlineTime).toHaveValue('00:01.100')

  const waveform = page.getByRole('slider', { name: 'Waveform seek' })
  await expect(waveform).toHaveAttribute('aria-valuemax', '4000')
  const waveformBox = await waveform.boundingBox()
  expect(waveformBox).not.toBeNull()
  const canvasBox = await page.locator('.waveform-canvas').boundingBox()
  expect(canvasBox).not.toBeNull()
  expect(canvasBox!.y + canvasBox!.height).toBeLessThanOrEqual(waveformBox!.y + waveformBox!.height)
  const firstMarker = page.getByRole('button', { name: 'Move marker for Hello world' })
  await expect(firstMarker).not.toHaveAttribute('title')
  await firstMarker.hover()
  const markerPreview = page.getByLabel('Lyric marker preview')
  await expect(markerPreview).toBeVisible()
  await expect(markerPreview).toContainText('Line 01')
  await expect(markerPreview).toContainText('00:01.100')
  await expect(markerPreview).toContainText('Hello world')
  await expect(markerPreview).toContainText('Hola mundo')
  const markerPreviewBox = await markerPreview.boundingBox()
  expect(markerPreviewBox).not.toBeNull()
  expect(markerPreviewBox!.y + markerPreviewBox!.height).toBeLessThan(waveformBox!.y)
  await page.screenshot({ path: join(tmpdir(), 'lyris-marker-preview.png'), fullPage: true })
  await page.getByRole('button', { name: 'Move marker for Second line' }).click()
  await expect(page.locator('[data-line-id="line_two"]')).toHaveClass(/selected/u)
  await expect.poll(() => page.locator('audio').evaluate((audio) => Math.round((audio as HTMLAudioElement).currentTime * 1000))).toBe(2000)
  await waveform.click({ position: { x: Math.round(waveformBox!.width * 0.65), y: Math.round(waveformBox!.height / 2) } })
  await expect.poll(() => page.locator('audio').evaluate((audio) => (audio as HTMLAudioElement).currentTime)).toBeGreaterThan(2.4)
  await expect(page.locator('[data-line-id="line_two"]')).toHaveClass(/active-playback/u)
  const beforePlay = await page.locator('audio').evaluate((audio) => (audio as HTMLAudioElement).currentTime)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await expect.poll(() => page.locator('audio').evaluate((audio) => (audio as HTMLAudioElement).currentTime)).toBeGreaterThan(beforePlay + 0.1)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()

  const speed = page.getByRole('slider', { name: 'Playback speed', exact: true })
  await speed.fill('0.75')
  await expect.poll(() => page.locator('audio').evaluate((audio) => (audio as HTMLAudioElement).playbackRate)).toBe(0.75)
  await page.getByRole('button', { name: 'Reset playback speed' }).click()
  await expect(speed).toHaveValue('1')
  const zoom = page.getByRole('slider', { name: 'Waveform zoom', exact: true })
  await zoom.fill('2')
  await expect.poll(() => page.locator('.waveform-timeline').evaluate((timeline) => timeline.getBoundingClientRect().width / timeline.parentElement!.clientWidth)).toBeGreaterThan(1.9)

  await page.getByRole('button', { name: 'Audio settings' }).click()
  await page.getByLabel('Playback gain').fill('150')
  await expect(page.getByLabel('Playback gain')).toHaveValue('150')
  const normalize = page.getByRole('button', { name: /Normalize/u })
  await expect(normalize).toHaveAttribute('aria-pressed', 'true')
  await normalize.click()
  await expect(normalize).toHaveAttribute('aria-pressed', 'false')
  await page.screenshot({ path: join(tmpdir(), 'lyris-audio-settings.png'), fullPage: true })
  await page.getByRole('button', { name: 'Close audio settings' }).click()

  await page.getByRole('textbox', { name: 'Lyric line 1', exact: true }).fill('Hello edited')
  await page.getByRole('textbox', { name: 'Lyric line 1', exact: true }).blur()
  await page.getByLabel('Translation es for lyric line 1').fill('Hola editado')
  await page.getByLabel('Translation es for lyric line 1').blur()
  await page.getByRole('textbox', { name: 'Lyric line 2', exact: true }).click()
  await page.getByRole('button', { name: '+100' }).click()
  await expect(page.getByLabel('Start time for lyric line 2')).toHaveValue('00:02.100')

  await page.getByRole('button', { name: 'Edit 2 words' }).click()
  const wordTiming = page.getByLabel('Selected word timing')
  await expect(wordTiming).toBeVisible()
  await expect(page.locator('[data-line-id="line_two"]')).toHaveClass(/word-timing-open/u)
  await expect(page.locator('[data-line-id="line_two"]')).toContainText('Selected')
  await expect(page.locator('.timeline-dock > .timing-strip')).toHaveCount(0)
  await expect(page.locator('.transport')).toHaveAttribute('data-word-timing', 'true')
  await expect(page.locator('.word-marker')).toHaveCount(2)
  await expect(page.locator('.word-source-unit')).toHaveCount(2)
  await page.getByRole('button', { name: 'Select word line' }).click()
  const wordStart = wordTiming.getByRole('textbox', { name: 'Start time for word line', exact: true })
  await expect(wordStart).toHaveValue('00:02.600')
  await wordTiming.getByRole('button', { name: '+100' }).click()
  await expect(wordStart).toHaveValue('00:02.700')
  const selectedWordUnit = page.locator('.word-source-unit.selected')
  const selectedTimeBox = await selectedWordUnit.locator('.word-source-time').boundingBox()
  const selectedTextBox = await selectedWordUnit.locator('.word-source-text').boundingBox()
  const selectedRowBox = await page.locator('[data-line-id="line_two"]').boundingBox()
  const transportBox = await page.locator('.transport').boundingBox()
  expect(selectedTimeBox).not.toBeNull()
  expect(selectedTextBox).not.toBeNull()
  expect(selectedRowBox).not.toBeNull()
  expect(transportBox).not.toBeNull()
  expect(selectedTimeBox!.y + selectedTimeBox!.height).toBeLessThanOrEqual(selectedTextBox!.y)
  expect(selectedTimeBox!.height).toBeGreaterThanOrEqual(20)
  expect(selectedTextBox!.height).toBeGreaterThanOrEqual(28)
  expect(selectedRowBox!.y + selectedRowBox!.height).toBeLessThan(transportBox!.y)
  await page.screenshot({ path: join(tmpdir(), 'lyris-word-timing.png'), fullPage: true })
  const wordTimingViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(940, 640))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(940)
  const wordTimingMinimum = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.body.scrollWidth, scrollHeight: document.body.scrollHeight }))
  expect(wordTimingMinimum.scrollWidth).toBeLessThanOrEqual(wordTimingMinimum.width)
  expect(wordTimingMinimum.scrollHeight).toBeLessThanOrEqual(wordTimingMinimum.height)
  await page.screenshot({ path: join(tmpdir(), 'lyris-word-timing-minimum.png'), fullPage: true })
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height), wordTimingViewport)
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(wordTimingViewport.width)

  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('.word-marker')).toHaveCount(0)
  await expect(zoom).toHaveValue('2')

  await page.getByRole('textbox', { name: 'Lyric line 1', exact: true }).click()
  await page.getByRole('button', { name: 'Time words' }).click()
  const segmentInput = page.getByRole('textbox', { name: 'Word segments' })
  await expect(segmentInput).toHaveValue('Hello edited')
  await expect(page.locator('.word-marker')).toHaveCount(0)
  await segmentInput.fill('Hello |edited')
  await page.getByRole('button', { name: 'Start timing 2 parts' }).click()
  await expect(page.locator('.word-marker')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Select word Hello' })).toBeVisible()
  const wordFollow = page.getByLabel('Selected word timing')
  const editorPane = page.locator('.editor-pane')
  await expect(editorPane).toHaveAttribute('data-following-playback', 'false')
  await expect(wordFollow).toHaveAttribute('data-follow-state', 'paused')
  await page.getByRole('button', { name: 'Resume editor playback follow' }).click()
  await expect(wordFollow).toHaveAttribute('data-follow-state', 'following')
  await expect(editorPane).toHaveAttribute('data-following-playback', 'true')
  await page.locator('audio').evaluate((audio) => {
    ;(audio as HTMLAudioElement).currentTime = 2.8
    audio.dispatchEvent(new Event('seeked', { bubbles: true }))
  })
  await expect(page.locator('[data-line-id="line_two"]')).toHaveClass(/word-timing-open/u)
  await expect(page.locator('.word-source-unit.selected .word-source-text')).toHaveText('line')
  await page.getByRole('textbox', { name: 'Start time for word line', exact: true }).focus()
  await expect(wordFollow).toHaveAttribute('data-follow-state', 'paused')
  await expect(editorPane).toHaveAttribute('data-following-playback', 'false')
  await page.locator('audio').evaluate((audio) => {
    ;(audio as HTMLAudioElement).currentTime = 1.2
    audio.dispatchEvent(new Event('seeked', { bubbles: true }))
  })
  await expect(page.locator('[data-line-id="line_two"]')).toHaveClass(/word-timing-open/u)
  await page.getByRole('button', { name: 'Resume editor playback follow' }).click()
  await expect(wordFollow).toHaveAttribute('data-follow-state', 'following')
  await expect(editorPane).toHaveAttribute('data-following-playback', 'true')
  await expect(page.locator('[data-line-id="line_one"]')).toHaveClass(/word-timing-open/u)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(editorPane).toHaveAttribute('data-following-playback', 'true')

  await page.getByRole('button', { name: 'Source' }).click()
  await expect(page.locator('.source-line.active')).toHaveCount(1)
  await expect(page.locator('.source-token.time').first()).toHaveCSS('color', 'rgb(56, 189, 248)')
  await page.screenshot({ path: join(tmpdir(), 'lyris-source-editor.png'), fullPage: true })
  const source = page.getByLabel('XLRC source')
  await expect(source).toHaveCSS('scroll-behavior', 'smooth')
  await source.fill(`${await source.inputValue()}[00:03.00]Last line\n`)
  await page.getByRole('button', { name: 'Apply source' }).click()
  await expect(page.getByText('Source changes applied.')).toBeVisible()

  await page.getByRole('button', { name: 'Lines' }).click()
  await expect(page.getByRole('textbox', { name: 'Lyric line 3', exact: true })).toHaveValue('Last line')
  await page.screenshot({ path: join(tmpdir(), 'lyris-editor-foundation.png'), fullPage: true })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(940, 640))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(940)
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.body.scrollWidth, scrollHeight: document.body.scrollHeight }))
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width)
  expect(viewport.scrollHeight).toBeLessThanOrEqual(viewport.height)
  await page.screenshot({ path: join(tmpdir(), 'lyris-editor-minimum.png'), fullPage: true })

  await page.waitForTimeout(1200)
  const saved = JSON.parse(await readFile(projectPath, 'utf8')) as { document: { lines: Array<{ text: string; startMs: number; translations: Array<{ text: string }>; words: Array<{ startMs: number }> }> } }
  expect(saved.document.lines.map((line) => line.text)).toContain('Hello edited')
  expect(saved.document.lines[0].startMs).toBe(1100)
  expect(saved.document.lines[0].words.map((word) => word.startMs)).toEqual([1100, 1100])
  expect(saved.document.lines[1].startMs).toBe(2100)
  expect(saved.document.lines[1].words[1].startMs).toBe(2700)
  expect(saved.document.lines[0].translations[0].text).toBe('Hola editado')

  await app.close()
  app = await launch(projectPath)
  page = await app.firstWindow()
  await expect(page.getByRole('textbox', { name: 'Lyric line 1', exact: true })).toHaveValue('Hello edited')
  await expect(page.getByLabel('Translation es for lyric line 1')).toHaveValue('Hola editado')
  await expect(page.getByRole('textbox', { name: 'Lyric line 3', exact: true })).toHaveValue('Last line')

  await page.getByRole('button', { name: 'Export' }).click()
  const enhancedLrc = page.getByRole('button', { name: /^Enhanced LRC/u })
  await enhancedLrc.click()
  await expect(enhancedLrc).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Example Song.lrc')).toBeVisible()
  await expect(page.getByText('Example Song.elrc')).toHaveCount(0)
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(tmpdir(), 'lyris-export-dialog.png'), fullPage: true })
  await page.getByRole('button', { name: /^LRC/u }).click()
  await expect(page.getByText('Timed rows', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await app.close()
})

test('renders the real XLRC project cleanly at desktop and minimum sizes', async () => {
  const { projectPath } = await realFixture()
  const app = await launch(projectPath)
  const page = await app.firstWindow()

  await expect(page.getByRole('button', { name: 'Edit track details' })).toContainText('BALALAIKA')
  await expect(page.locator('.lyric-row')).toHaveCount(49)
  await expect(page.locator('.line-translation')).toHaveCount(78)
  await expect(page.locator('.section-divider')).toHaveCount(0)
  await expect(page.locator('.line-list')).toHaveCSS('scroll-behavior', 'smooth')
  await expect(page.getByRole('slider', { name: 'Waveform seek' })).toHaveAttribute('aria-valuemax', '190033')
  await expect(page.locator('.transport')).toHaveAttribute('data-waveform-ready', 'true', { timeout: 15_000 })

  const waveform = page.getByRole('slider', { name: 'Waveform seek' })
  const box = await waveform.boundingBox()
  expect(box).not.toBeNull()
  const seekPosition = { x: Math.round(box!.width * 0.43), y: Math.round(box!.height / 2) }
  await waveform.click({ position: seekPosition })
  await expect.poll(() => page.locator('audio').evaluate((audio) => Math.round((audio as HTMLAudioElement).currentTime * 1000))).toBeGreaterThan(0)
  await expect(page.locator('.lyric-row.active-playback')).toHaveCount(1)
  await expect(page.locator('.preview-line.active')).toHaveCount(1)
  await page.waitForTimeout(500)
  await page.locator('.wave-marker').nth(16).hover()
  await expect(page.getByLabel('Lyric marker preview')).toBeVisible()
  await page.screenshot({ path: join(tmpdir(), 'lyris-real-marker-preview.png'), fullPage: true })
  await page.locator('.preview-pane').hover()
  await page.screenshot({ path: join(tmpdir(), 'lyris-real-desktop.png'), fullPage: true })

  const editorPane = page.locator('.editor-pane')
  await expect(editorPane).toHaveAttribute('data-following-playback', 'true')
  await page.getByRole('button', { name: 'Lines', exact: true }).click()
  await expect(editorPane).toHaveAttribute('data-following-playback', 'true')
  await page.locator('.lyric-row.active-playback').click()
  await expect(editorPane).toHaveAttribute('data-following-playback', 'false')
  const editorScrollBeforeSeek = await page.locator('.line-list').evaluate((list) => list.scrollTop)
  await waveform.click({ position: { x: Math.round(box!.width * 0.92), y: Math.round(box!.height / 2) } })
  await expect.poll(() => page.locator('audio').evaluate((audio) => (audio as HTMLAudioElement).currentTime)).toBeGreaterThan(170)
  await expect(page.getByRole('button', { name: 'Return to current line' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Follow' })).toBeChecked()
  await expect.poll(() => page.locator('.line-list').evaluate((list) => list.scrollTop)).toBe(editorScrollBeforeSeek)
  await page.screenshot({ path: join(tmpdir(), 'lyris-editor-follow-paused.png'), fullPage: true })
  await page.getByRole('button', { name: 'Return to current line' }).click()
  await expect(editorPane).toHaveAttribute('data-following-playback', 'true')
  await expect(page.getByRole('button', { name: 'Return to current line' })).toBeHidden()
  await expect.poll(async () => page.locator('.lyric-row.active-playback').evaluate((row) => {
    const bounds = row.getBoundingClientRect()
    const viewport = row.parentElement!.getBoundingClientRect()
    return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom
  })).toBe(true)

  await page.getByRole('textbox', { name: 'Lyric line 4', exact: true }).click()
  await page.getByRole('button', { name: 'Time words' }).click()
  const zoom = page.getByRole('slider', { name: 'Waveform zoom', exact: true })
  await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(25)
  const waveformScroll = page.locator('.waveform-scroll')
  const canvasDimensions = await page.locator('.waveform-canvas').evaluate((canvas) => ({
    bitmapWidth: (canvas as HTMLCanvasElement).width,
    viewportWidth: canvas.parentElement!.parentElement!.clientWidth,
  }))
  expect(canvasDimensions.bitmapWidth).toBeLessThanOrEqual(canvasDimensions.viewportWidth * 2)
  await page.screenshot({ path: join(tmpdir(), 'lyris-real-word-timing.png'), fullPage: true })
  const initialWordFocus = await waveformScroll.evaluate((scroll) => scroll.scrollLeft)
  await page.getByRole('textbox', { name: 'Lyric line 21', exact: true }).click()
  await expect(page.locator('[data-line-id]').nth(20)).toHaveClass(/word-timing-open/u)
  await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(25)
  await page.waitForTimeout(120)
  const transitioningWordFocus = await waveformScroll.evaluate((scroll) => scroll.scrollLeft)
  await page.waitForTimeout(350)
  const finalWordFocus = await waveformScroll.evaluate((scroll) => scroll.scrollLeft)
  expect(transitioningWordFocus).toBeGreaterThan(initialWordFocus)
  expect(finalWordFocus).toBeGreaterThan(transitioningWordFocus)
  await page.getByRole('button', { name: 'Done' }).click()

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(940, 640))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(940)
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.body.scrollWidth, scrollHeight: document.body.scrollHeight }))
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width)
  expect(viewport.scrollHeight).toBeLessThanOrEqual(viewport.height)
  await page.screenshot({ path: join(tmpdir(), 'lyris-real-minimum.png'), fullPage: true })
  await app.close()
})
