import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { LyricLine } from '../../types/project'
import { gainToDecibels, normalizationGain } from '../../shared/audio'
import { deriveLineEnd } from '../../shared/project'
import { formatClock, formatTimestamp } from '../../shared/time'
import { PauseIcon, PlayIcon, SettingsIcon } from './Icons'

export interface TransportHandle {
  toggle: () => void
  stamp: () => void
  seek: (timeMs: number) => void
  currentTimeMs: () => number
}

interface AudioTransportProps {
  sourceUrl: string | null
  lines: LyricLine[]
  selectedLineId: string | null
  wordTimingActive: boolean
  selectedWordId: string | null
  loop: boolean
  onSelectLine: (lineId: string) => void
  onTime: (timeMs: number) => void
  onStamp: (timeMs: number) => void
  onMoveMarker: (lineId: string, timeMs: number) => void
  onSelectWord: (wordId: string) => void
  onMoveWord: (lineId: string, wordId: string, timeMs: number) => void
  onTimingIntent: () => void
  previewMarker: { lineId: string; timeMs: number } | null
}

interface WaveformAnalysis {
  peaks: number[]
  normalizationGain: number
}

const MAX_AUTOMATIC_WORD_ZOOM = 40
const MINIMUM_AUTOMATIC_WORD_WINDOW_MS = 6_000
const AUTOMATIC_WORD_CONTEXT_MULTIPLIER = 1.6

function buildWaveformAnalysis(buffer: AudioBuffer, count = Math.max(900, Math.min(12_000, Math.ceil(buffer.duration * 40)))): WaveformAnalysis {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
  const block = Math.max(1, Math.floor(buffer.length / count))
  let globalPeak = 0
  let sumSquares = 0
  let sampleCount = 0
  const analysisStride = Math.max(1, Math.floor(buffer.length / 4_000_000))
  for (let cursor = 0; cursor < buffer.length; cursor += analysisStride) {
    let framePower = 0
    for (const channel of channels) {
      const sample = channel[cursor] ?? 0
      globalPeak = Math.max(globalPeak, Math.abs(sample))
      framePower += sample * sample
    }
    sumSquares += framePower / Math.max(1, channels.length)
    sampleCount += 1
  }
  const peaks = Array.from({ length: count }, (_, index) => {
    let peak = 0
    const start = index * block
    const end = Math.min(buffer.length, start + block)
    for (let cursor = start; cursor < end; cursor += Math.max(1, Math.floor(block / 80))) {
      for (const channel of channels) peak = Math.max(peak, Math.abs(channel[cursor] ?? 0))
    }
    return peak
  })
  return {
    peaks,
    normalizationGain: normalizationGain({
      peak: globalPeak,
      rms: sampleCount ? Math.sqrt(sumSquares / sampleCount) : 0,
    }),
  }
}

export const AudioTransport = forwardRef<TransportHandle, AudioTransportProps>(function AudioTransport({
  sourceUrl, lines, selectedLineId, wordTimingActive, selectedWordId, loop, onSelectLine, onTime, onStamp, onMoveMarker, onSelectWord, onMoveWord, onTimingIntent, previewMarker,
}, forwardedRef) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef(0)
  const scrubbingRef = useRef(false)
  const draggingMarkerRef = useRef<string | null>(null)
  const suppressMarkerClickRef = useRef<string | null>(null)
  const suppressWordClickRef = useRef<string | null>(null)
  const wordFocusRestoreRef = useRef<{ zoom: number; centerMs: number } | null>(null)
  const focusAnimationRef = useRef(0)
  const animatedCenterRef = useRef<number | null>(null)
  const graphRef = useRef<{ context: AudioContext; gain: GainNode } | null>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const [durationMs, setDurationMs] = useState(0)
  const [currentMs, setCurrentMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [peaks, setPeaks] = useState<number[]>([])
  const [measuredGain, setMeasuredGain] = useState(1)
  const [normalize, setNormalize] = useState(true)
  const [gainPercent, setGainPercent] = useState(100)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dragMarker, setDragMarker] = useState<{ lineId: string; timeMs: number } | null>(null)
  const [dragWord, setDragWord] = useState<{ wordId: string; timeMs: number } | null>(null)
  const [hoverMarkerId, setHoverMarkerId] = useState<string | null>(null)
  const [waveformWidth, setWaveformWidth] = useState(0)
  const [waveformScrollLeft, setWaveformScrollLeft] = useState(0)

  const selectedIndex = lines.findIndex((line) => line.id === selectedLineId)
  const selected = lines[selectedIndex]
  const loopEnd = deriveLineEnd(lines, selectedIndex, durationMs || null)
  const effectiveGain = (gainPercent / 100) * (normalize ? measuredGain : 1)
  const rateLabel = rate === 1 ? '1×' : `${rate.toFixed(2).replace(/0$/u, '')}×`
  const zoomLabel = Number.isInteger(zoom) ? `${zoom}×` : `${zoom.toFixed(2).replace(/0$/u, '')}×`
  const zoomMaximum = wordTimingActive ? 64 : Math.max(8, Math.ceil(zoom))

  const waveformCenterMs = (atZoom = zoom): number => {
    const scroll = scrollRef.current
    if (!scroll || !durationMs || !atZoom) return 0
    const timelinePixels = scroll.clientWidth * atZoom
    return Math.max(0, Math.min(durationMs, ((scroll.scrollLeft + scroll.clientWidth / 2) / timelinePixels) * durationMs))
  }

  const animateWaveformView = (targetZoom: number, targetCenterMs: number): void => {
    const scroll = scrollRef.current
    if (!scroll || !durationMs) return
    cancelAnimationFrame(focusAnimationRef.current)
    const startZoom = zoom
    const startCenterMs = waveformCenterMs(startZoom)
    const startedAt = performance.now()
    const motionDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 360
    const step = (now: number): void => {
      const progress = motionDuration === 0 ? 1 : Math.min(1, (now - startedAt) / motionDuration)
      const eased = 1 - ((1 - progress) ** 3)
      const nextCenterMs = startCenterMs + (targetCenterMs - startCenterMs) * eased
      const nextZoom = startZoom + (targetZoom - startZoom) * eased
      animatedCenterRef.current = nextCenterMs
      setZoom(nextZoom)
      // Center movement must not depend on a zoom state update: adjacent lyric
      // lines commonly share the automatic zoom cap, so React may bail out of
      // rendering while the viewport still needs to travel horizontally.
      const timelinePixels = scroll.clientWidth * nextZoom
      scroll.scrollLeft = Math.max(0, (nextCenterMs / durationMs) * timelinePixels - scroll.clientWidth / 2)
      if (progress < 1) focusAnimationRef.current = requestAnimationFrame(step)
      else window.setTimeout(() => { animatedCenterRef.current = null }, 0)
    }
    focusAnimationRef.current = requestAnimationFrame(step)
  }

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const centerMs = animatedCenterRef.current
    if (!scroll || centerMs === null || !durationMs) return
    const timelinePixels = scroll.clientWidth * zoom
    scroll.scrollLeft = Math.max(0, (centerMs / durationMs) * timelinePixels - scroll.clientWidth / 2)
  }, [durationMs, zoom])

  const changeRate = (raw: number): void => {
    const next = Math.abs(raw - 1) <= 0.025 ? 1 : Math.max(0.1, Math.min(1.25, raw))
    setRate(next)
    if (audioRef.current) audioRef.current.playbackRate = next
  }

  const ensureAudioGraph = (): AudioContext | null => {
    const audio = audioRef.current
    if (!audio) return null
    if (!graphRef.current) {
      try {
        const context = new AudioContext()
        const source = context.createMediaElementSource(audio)
        const gain = context.createGain()
        source.connect(gain).connect(context.destination)
        graphRef.current = { context, gain }
      } catch {
        return null
      }
    }
    const graph = graphRef.current
    graph.gain.gain.setValueAtTime(effectiveGain, graph.context.currentTime)
    if (graph.context.state === 'suspended') void graph.context.resume()
    return graph.context
  }

  const updateClock = (): void => {
    const audio = audioRef.current
    if (!audio) return
    const next = Math.round(audio.currentTime * 1000)
    if (loop && selected?.startMs !== null && loopEnd !== null && next >= loopEnd) {
      audio.currentTime = selected.startMs / 1000
    }
    const actual = Math.round(audio.currentTime * 1000)
    setCurrentMs(actual)
    onTime(actual)
    if (!audio.paused) frameRef.current = requestAnimationFrame(updateClock)
  }

  const toggle = (): void => {
    const audio = audioRef.current
    if (!audio || !sourceUrl) return
    ensureAudioGraph()
    if (audio.paused) void audio.play().catch(() => undefined)
    else audio.pause()
  }

  const seek = (timeMs: number): void => {
    const audio = audioRef.current
    if (!audio) return
    const availableDuration = durationMs || (Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0)
    if (!availableDuration) return
    audio.currentTime = Math.max(0, Math.min(timeMs, availableDuration)) / 1000
    setCurrentMs(Math.round(audio.currentTime * 1000))
    onTime(Math.round(audio.currentTime * 1000))
  }

  useImperativeHandle(forwardedRef, () => ({
    toggle,
    stamp: () => onStamp(Math.round((audioRef.current?.currentTime ?? 0) * 1000)),
    seek,
    currentTimeMs: () => Math.round((audioRef.current?.currentTime ?? 0) * 1000),
  }))

  useEffect(() => {
    setPeaks([])
    setMeasuredGain(1)
    setCurrentMs(0)
    setDurationMs(0)
    if (!sourceUrl) return
    let cancelled = false
    const context = new AudioContext()
    void fetch(sourceUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Audio request failed (${response.status})`)
        return response.arrayBuffer()
      })
      .then((bytes) => context.decodeAudioData(bytes))
      .then((buffer) => {
        if (cancelled) return
        const analysis = buildWaveformAnalysis(buffer)
        setPeaks(analysis.peaks)
        setMeasuredGain(analysis.normalizationGain)
      })
      .catch(() => undefined)
      .finally(() => void context.close())
    return () => { cancelled = true }
  }, [sourceUrl])

  useEffect(() => {
    const graph = graphRef.current
    if (graph) graph.gain.gain.setTargetAtTime(effectiveGain, graph.context.currentTime, 0.015)
  }, [effectiveGain])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const scroll = scrollRef.current
    if (!canvas || !scroll) return
    const draw = (): void => {
      const width = Math.max(1, scroll.clientWidth)
      const timelineWidth = Math.max(width, width * zoom)
      const scrollLeft = scroll.scrollLeft
      const height = Math.max(24, scroll.clientHeight)
      setWaveformWidth((current) => current === scroll.clientWidth ? current : scroll.clientWidth)
      const dpr = Math.min(devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      const context = canvas.getContext('2d')
      if (!context) return
      context.scale(dpr, dpr)
      context.clearRect(0, 0, width, height)
      const markerRailHeight = 15
      const waveformHeight = Math.max(12, height - markerRailHeight - 4)
      const mid = markerRailHeight + waveformHeight / 2
      context.fillStyle = 'rgba(117,128,135,.16)'
      context.fillRect(0, markerRailHeight, width, 1)
      if (!peaks.length) {
        context.fillStyle = '#343a3f'
        context.fillRect(0, mid, width, 1)
        return
      }
      const barWidth = timelineWidth / peaks.length
      const progress = durationMs ? currentMs / durationMs : 0
      const startIndex = Math.max(0, Math.floor((scrollLeft / timelineWidth) * peaks.length) - 1)
      const endIndex = Math.min(peaks.length, Math.ceil(((scrollLeft + width) / timelineWidth) * peaks.length) + 1)
      for (let index = startIndex; index < endIndex; index += 1) {
        const peak = peaks[index]
        const x = index * barWidth - scrollLeft
        const barHeight = Math.max(1, peak * (waveformHeight - 2))
        context.fillStyle = index / peaks.length <= progress ? '#36b8d8' : '#3b4349'
        context.fillRect(x, mid - barHeight / 2, Math.max(1, barWidth * 0.64), barHeight)
      }
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(scroll)
    scroll.addEventListener('scroll', draw, { passive: true })
    return () => {
      observer.disconnect()
      scroll.removeEventListener('scroll', draw)
    }
  }, [currentMs, durationMs, peaks, zoom])

  useEffect(() => () => {
    cancelAnimationFrame(frameRef.current)
    cancelAnimationFrame(focusAnimationRef.current)
    if (graphRef.current) void graphRef.current.context.close()
  }, [])

  useEffect(() => {
    if (!settingsOpen) return
    const closeOutside = (event: PointerEvent): void => {
      if (!settingsRef.current?.contains(event.target as Node)) setSettingsOpen(false)
    }
    const closeEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setSettingsOpen(false) }
    window.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', closeEscape)
    }
  }, [settingsOpen])

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    if (wordTimingActive) {
      if (!wordFocusRestoreRef.current) wordFocusRestoreRef.current = { zoom, centerMs: waveformCenterMs() }
      return
    }
    const restore = wordFocusRestoreRef.current
    if (!restore) return
    wordFocusRestoreRef.current = null
    animateWaveformView(restore.zoom, restore.centerMs)
  }, [wordTimingActive])

  useEffect(() => {
    const scroll = scrollRef.current
    if (!wordTimingActive || !scroll || !durationMs || selected?.startMs === null || selected?.startMs === undefined || loopEnd === null) return
    const lineSpan = Math.max(500, loopEnd - selected.startMs)
    const targetWindowMs = Math.max(MINIMUM_AUTOMATIC_WORD_WINDOW_MS, lineSpan * AUTOMATIC_WORD_CONTEXT_MULTIPLIER)
    const targetZoom = Math.min(MAX_AUTOMATIC_WORD_ZOOM, Math.max(1, durationMs / targetWindowMs))
    animateWaveformView(targetZoom, selected.startMs + lineSpan / 2)
  }, [durationMs, loopEnd, selected?.id, selected?.startMs, wordTimingActive])

  const timelineWidth = `${zoom * 100}%`
  const markerLines = useMemo(() => lines.filter((line) => line.startMs !== null), [lines])
  const playbackMarkerStart = useMemo(() => markerLines.reduce<number | null>((latest, line) => {
    if (line.startMs === null || line.startMs > currentMs) return latest
    return latest === null || line.startMs > latest ? line.startMs : latest
  }, null), [currentMs, markerLines])

  const visibleMarkerTime = (line: LyricLine): number => dragMarker?.lineId === line.id
    ? dragMarker.timeMs
    : previewMarker?.lineId === line.id ? previewMarker.timeMs : line.startMs ?? 0
  const hoverLine = hoverMarkerId ? markerLines.find((line) => line.id === hoverMarkerId) ?? null : null
  const hoverTime = hoverLine ? visibleMarkerTime(hoverLine) : 0
  const rawHoverX = durationMs && waveformWidth ? (hoverTime / durationMs) * waveformWidth * zoom - waveformScrollLeft : 0
  const previewWidth = Math.min(330, Math.max(0, waveformWidth - 12))
  const previewHalf = previewWidth / 2
  const previewX = previewWidth ? Math.max(previewHalf + 6, Math.min(waveformWidth - previewHalf - 6, rawHoverX)) : 0
  const previewAnchorOffset = previewWidth ? Math.max(-previewHalf + 14, Math.min(previewHalf - 14, rawHoverX - previewX)) : 0

  const timeFromPointer = (clientX: number): number => {
    const scroll = scrollRef.current
    if (!scroll || !durationMs) return 0
    const rect = scroll.getBoundingClientRect()
    const timelinePixels = scroll.clientWidth * zoom
    const x = clientX - rect.left + scroll.scrollLeft
    return Math.max(0, Math.min(durationMs, Math.round((x / timelinePixels) * durationMs)))
  }

  const beginMarkerDrag = (event: React.PointerEvent, line: LyricLine): void => {
    event.stopPropagation()
    if (line.startMs === null) return
    onTimingIntent()
    const markerElement = event.currentTarget
    const originX = event.clientX
    let moved = false
    draggingMarkerRef.current = line.id
    setHoverMarkerId(line.id)
    onSelectLine(line.id)
    seek(line.startMs)
    setDragMarker({ lineId: line.id, timeMs: line.startMs })
    const move = (moveEvent: PointerEvent): void => {
      if (!moved && Math.abs(moveEvent.clientX - originX) < 3) return
      moved = true
      const timeMs = timeFromPointer(moveEvent.clientX)
      setDragMarker({ lineId: line.id, timeMs })
      seek(timeMs)
    }
    const up = (upEvent: PointerEvent): void => {
      const timeMs = timeFromPointer(upEvent.clientX)
      if (moved) {
        onMoveMarker(line.id, timeMs)
        suppressMarkerClickRef.current = line.id
        window.setTimeout(() => { if (suppressMarkerClickRef.current === line.id) suppressMarkerClickRef.current = null }, 0)
      }
      else seek(line.startMs ?? timeMs)
      setDragMarker(null)
      draggingMarkerRef.current = null
      if (!markerElement.matches(':hover')) setHoverMarkerId(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const visibleWordTime = (wordId: string, startMs: number): number => dragWord?.wordId === wordId ? dragWord.timeMs : startMs
  const beginWordDrag = (event: React.PointerEvent, wordId: string, startMs: number): void => {
    event.stopPropagation()
    onTimingIntent()
    const originX = event.clientX
    let moved = false
    draggingMarkerRef.current = wordId
    onSelectWord(wordId)
    seek(startMs)
    setDragWord({ wordId, timeMs: startMs })
    const move = (moveEvent: PointerEvent): void => {
      if (!moved && Math.abs(moveEvent.clientX - originX) < 3) return
      moved = true
      const timeMs = timeFromPointer(moveEvent.clientX)
      setDragWord({ wordId, timeMs })
      seek(timeMs)
    }
    const finish = (finishEvent: PointerEvent): void => {
      const timeMs = timeFromPointer(finishEvent.clientX)
      if (moved && selected) {
        onMoveWord(selected.id, wordId, timeMs)
        suppressWordClickRef.current = wordId
        window.setTimeout(() => { if (suppressWordClickRef.current === wordId) suppressWordClickRef.current = null }, 0)
      }
      else seek(startMs)
      setDragWord(null)
      draggingMarkerRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  return (
    <section className={`transport ${wordTimingActive ? 'word-timing-active' : ''}`} aria-label="Audio transport" data-waveform-ready={peaks.length > 0} data-word-timing={wordTimingActive || undefined}>
      <audio
        ref={audioRef}
        src={sourceUrl ?? undefined}
        crossOrigin="anonymous"
        preload="auto"
        onLoadedMetadata={(event) => {
          const duration = Number.isFinite(event.currentTarget.duration) ? Math.round(event.currentTarget.duration * 1000) : 0
          event.currentTarget.playbackRate = rate
          setDurationMs(duration)
          onTime(0)
        }}
        onPlay={() => { setPlaying(true); cancelAnimationFrame(frameRef.current); frameRef.current = requestAnimationFrame(updateClock) }}
        onPause={() => { setPlaying(false); cancelAnimationFrame(frameRef.current); updateClock() }}
        onEnded={() => setPlaying(false)}
        onSeeked={updateClock}
      />
      <div className="transport-leading">
        <button className="transport-play" type="button" onClick={toggle} disabled={!sourceUrl} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <div className="transport-time"><strong>{formatClock(currentMs)}</strong><span>{formatClock(durationMs)}</span></div>
      </div>
      <div className="waveform-stage">
        {hoverLine && waveformWidth > 0 && <aside
          id="wave-marker-preview"
          className="wave-marker-preview"
          aria-label="Lyric marker preview"
          style={{ left: `${previewX}px`, '--marker-anchor-offset': `${previewAnchorOffset}px` } as CSSProperties}
        >
          <header><span>Line {String(lines.findIndex((line) => line.id === hoverLine.id) + 1).padStart(2, '0')}</span><time>{formatTimestamp(hoverTime)}</time></header>
          <strong>{hoverLine.text || 'Instrumental break'}</strong>
          {hoverLine.translations[0] && <small><em>{hoverLine.translations[0].language || 'Translation'}</em><span>{hoverLine.translations[0].text}</span>{hoverLine.translations.length > 1 && <i>+{hoverLine.translations.length - 1}</i>}</small>}
        </aside>}
        <div
          ref={scrollRef}
          className="waveform-scroll"
          role="slider"
          tabIndex={sourceUrl ? 0 : -1}
          aria-label="Waveform seek"
          aria-valuemin={0}
          aria-valuemax={durationMs}
          aria-valuenow={currentMs}
          onScroll={(event) => setWaveformScrollLeft(event.currentTarget.scrollLeft)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            seek(currentMs + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 5_000 : 1_000))
          }}
          onPointerDown={(event) => {
            if (!sourceUrl) return
            scrubbingRef.current = true
            event.currentTarget.setPointerCapture(event.pointerId)
            seek(timeFromPointer(event.clientX))
          }}
          onPointerMove={(event) => { if (scrubbingRef.current) seek(timeFromPointer(event.clientX)) }}
          onPointerUp={(event) => {
            scrubbingRef.current = false
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => { scrubbingRef.current = false }}
        >
          <div className="waveform-timeline" style={{ width: timelineWidth }}>
            <canvas ref={canvasRef} className="waveform-canvas" />
            {markerLines.map((line) => {
              const visibleTime = visibleMarkerTime(line)
              const playbackActive = playbackMarkerStart !== null && line.startMs === playbackMarkerStart
              return <button
                key={line.id}
                type="button"
                className={`wave-marker ${visibleTime <= currentMs ? 'passed' : ''} ${playbackActive ? 'playback-active' : ''} ${line.id === selectedLineId ? 'selected' : ''}`}
                style={{ left: `${durationMs ? (visibleTime / durationMs) * 100 : 0}%` }}
                onPointerEnter={() => setHoverMarkerId(line.id)}
                onPointerLeave={() => { if (draggingMarkerRef.current !== line.id) setHoverMarkerId((current) => current === line.id ? null : current) }}
                onFocus={() => setHoverMarkerId(line.id)}
                onBlur={() => { if (draggingMarkerRef.current !== line.id) setHoverMarkerId((current) => current === line.id ? null : current) }}
                onPointerDown={(event) => beginMarkerDrag(event, line)}
                onClick={(event) => {
                  event.stopPropagation()
                  if (suppressMarkerClickRef.current === line.id) { suppressMarkerClickRef.current = null; return }
                  onSelectLine(line.id)
                  seek(visibleTime)
                }}
                aria-label={`Move marker for ${line.text || 'instrumental line'}`}
                aria-describedby={hoverMarkerId === line.id ? 'wave-marker-preview' : undefined}
              />
            })}
            {wordTimingActive && selected?.startMs !== null && selected?.words.map((word, index) => {
              const visibleTime = visibleWordTime(word.id, word.startMs)
              return <button
                key={word.id}
                type="button"
                className={`word-marker ${visibleTime <= currentMs ? 'passed' : ''} ${word.id === selectedWordId ? 'selected' : ''}`}
                style={{ left: `${durationMs ? (visibleTime / durationMs) * 100 : 0}%` }}
                onPointerDown={(event) => beginWordDrag(event, word.id, word.startMs)}
                onClick={(event) => {
                  event.stopPropagation()
                  if (suppressWordClickRef.current === word.id) { suppressWordClickRef.current = null; return }
                  onSelectWord(word.id)
                  seek(visibleTime)
                }}
                aria-label={`Move word marker ${index + 1}: ${word.text.trim() || 'space'}`}
                title={`${word.text.trim() || 'Space'} · ${formatTimestamp(visibleTime)}`}
              />
            })}
            <div className="wave-playhead" style={{ left: `${durationMs ? (currentMs / durationMs) * 100 : 0}%` }} />
          </div>
        </div>
      </div>
      <div className="transport-actions">
        <div className="transport-slider speed-control">
          <span>Speed <button type="button" onClick={() => changeRate(1)} aria-label="Reset playback speed" title="Reset to 1×">{rateLabel}</button></span>
          <span className="range-track"><input aria-label="Playback speed" type="range" min="0.1" max="1.25" step="0.01" value={rate} onChange={(event) => changeRate(Number(event.target.value))} onDoubleClick={() => changeRate(1)} /><i className="speed-detent" /></span>
        </div>
        <div className="transport-slider zoom-control">
          <span>Zoom <button type="button" onClick={() => setZoom(1)} aria-label="Reset waveform zoom" title="Reset waveform zoom">{zoomLabel}</button></span>
          <span className="range-track"><input aria-label="Waveform zoom" type="range" min="1" max={zoomMaximum} step="0.25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} onDoubleClick={() => setZoom(1)} /></span>
        </div>
        <div ref={settingsRef} className="audio-settings-anchor">
          <button type="button" className={`audio-settings-button ${settingsOpen ? 'active' : ''}`} onClick={() => setSettingsOpen((value) => !value)} aria-expanded={settingsOpen} aria-label="Audio settings"><SettingsIcon /><span>Audio</span></button>
          {settingsOpen && <section className="audio-settings-popover" role="dialog" aria-label="Audio playback settings">
            <header><div><span className="eyebrow">Output</span><strong>Audio settings</strong></div><button type="button" aria-label="Close audio settings" onClick={() => setSettingsOpen(false)}>×</button></header>
            <label className="audio-setting"><span>Output gain <output>{gainPercent}%</output></span><input aria-label="Playback gain" type="range" min="0" max="200" step="1" value={gainPercent} onChange={(event) => {
              ensureAudioGraph()
              setGainPercent(Number(event.target.value))
            }} /></label>
            <button
              type="button"
              className={`normalize-button ${normalize ? 'active' : ''}`}
              aria-pressed={normalize}
              onClick={() => { ensureAudioGraph(); setNormalize((value) => !value) }}
              title={`Measured normalization: ${gainToDecibels(measuredGain) >= 0 ? '+' : ''}${gainToDecibels(measuredGain).toFixed(1)} dB`}
              disabled={!sourceUrl}
            ><span><strong>Normalize loudness</strong><small>Measured {gainToDecibels(measuredGain) >= 0 ? '+' : ''}{gainToDecibels(measuredGain).toFixed(1)} dB</small></span><i /></button>
          </section>}
        </div>
        <button className="stamp-button" type="button" disabled={!sourceUrl || !selectedLineId || (wordTimingActive && !selectedWordId)} onClick={() => onStamp(currentMs)} title={`${wordTimingActive ? 'Stamp selected word' : 'Stamp selected line'} at playhead (⌥ Enter)`}>{wordTimingActive ? 'Stamp word' : 'Stamp'} <kbd>⌥↵</kbd></button>
      </div>
    </section>
  )
})
