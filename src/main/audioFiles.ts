import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { open, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import * as musicMetadata from 'music-metadata'
import type { AudioFingerprint, AudioReference, AudioSelection, TrackMetadata } from '../types/project'

const AUDIO_MIMES: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aiff': 'audio/aiff', '.aif': 'audio/aiff',
}

export function mimeFor(path: string): string | null {
  return AUDIO_MIMES[extname(path).toLowerCase()] ?? null
}

export async function fingerprintAudio(path: string): Promise<AudioFingerprint> {
  const info = await stat(path)
  const chunkSize = 64 * 1024
  const positions = Array.from(new Set([
    0,
    Math.max(0, Math.floor(info.size / 2) - Math.floor(chunkSize / 2)),
    Math.max(0, info.size - chunkSize),
  ]))
  const handle = await open(path, 'r')
  const hash = createHash('sha256')
  hash.update(String(info.size))
  try {
    for (const position of positions) {
      const buffer = Buffer.alloc(Math.min(chunkSize, Math.max(0, info.size - position)))
      if (!buffer.length) continue
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    await handle.close()
  }
  return { algorithm: 'sha256-windowed-v1', value: hash.digest('hex'), size: info.size }
}

async function discoverSidecar(path: string): Promise<string | null> {
  const stem = path.slice(0, path.length - extname(path).length)
  for (const extension of ['.xlrc', '.elrc', '.lrc', '.txt']) {
    const candidate = `${stem}${extension}`
    if (existsSync(candidate)) return candidate
  }
  return null
}

function embeddedLyricsFrom(metadata: musicMetadata.IAudioMetadata): string | null {
  const common = metadata.common as musicMetadata.ICommonTagsResult & { lyrics?: unknown }
  if (typeof common.lyrics === 'string') return common.lyrics
  if (Array.isArray(common.lyrics)) {
    const lyric = common.lyrics.find((entry) => typeof entry === 'string')
    if (typeof lyric === 'string') return lyric
  }
  for (const tags of Object.values(metadata.native)) {
    for (const tag of tags) {
      const id = tag.id.toLowerCase()
      if (id.includes('lyrics') || id === 'uslt' || id === 'sylt' || id === '©lyr') {
        if (typeof tag.value === 'string') return tag.value
        if (tag.value && typeof tag.value === 'object' && 'text' in tag.value && typeof tag.value.text === 'string') return tag.value.text
      }
    }
  }
  return null
}

function metadataPatch(metadata: musicMetadata.IAudioMetadata): Partial<TrackMetadata> {
  return {
    title: metadata.common.title ?? '',
    artist: metadata.common.artist ?? metadata.common.albumartist ?? '',
    album: metadata.common.album ?? '',
    durationMs: metadata.format.duration ? Math.round(metadata.format.duration * 1000) : null,
  }
}

export class AudioRegistry {
  private readonly paths = new Map<string, string>()

  register(path: string): string {
    const token = randomUUID()
    this.paths.set(token, resolve(path))
    return `lyris-media://audio/${token}`
  }

  resolve(url: string): string | null {
    try {
      const parsed = new URL(url)
      const token = parsed.pathname.replace(/^\//u, '')
      return parsed.hostname === 'audio' ? this.paths.get(token) ?? null : null
    } catch {
      return null
    }
  }

  stream(path: string, start = 0, end?: number): NodeJS.ReadableStream {
    return createReadStream(path, { start, ...(end === undefined ? {} : { end }) })
  }

  async select(path: string, projectPath: string | null): Promise<AudioSelection> {
    const absolute = resolve(path)
    const [fingerprint, metadata, sidecarPath] = await Promise.all([
      fingerprintAudio(absolute),
      musicMetadata.parseFile(absolute, { skipCovers: true }),
      discoverSidecar(absolute),
    ])
    const durationMs = metadata.format.duration ? Math.round(metadata.format.duration * 1000) : null
    const relativePath = projectPath ? relative(dirname(projectPath), absolute) : ''
    const useRelative = Boolean(projectPath && relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath))
    const reference: AudioReference = {
      path: useRelative ? relativePath : absolute,
      pathKind: useRelative ? 'relative' : 'absolute',
      fileName: basename(absolute),
      mimeType: mimeFor(absolute),
      fingerprint,
      durationMs,
    }
    return {
      reference,
      sourceUrl: this.register(absolute),
      metadata: metadataPatch(metadata),
      sidecarPath,
      embeddedLyrics: embeddedLyricsFrom(metadata),
    }
  }

  async relocate(path: string, expected: AudioReference, projectPath: string | null): Promise<AudioSelection> {
    const selection = await this.select(path, projectPath)
    if (selection.reference.fingerprint.value !== expected.fingerprint.value || selection.reference.fingerprint.size !== expected.fingerprint.size) {
      throw new Error('That file does not match the audio fingerprint stored in this project.')
    }
    return selection
  }

  async readSidecar(path: string): Promise<string> {
    return readFile(path, 'utf8')
  }
}
