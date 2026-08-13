import { parseTimestamp } from './time'

export type SourceTokenKind = 'text' | 'tag' | 'time' | 'furigana' | 'translation' | 'voice'

export interface SourceToken {
  kind: SourceTokenKind
  value: string
}

const KANA = /[\u3040-\u30ff\u31f0-\u31ff]/u
const TIME_MARKER = /^<\d+:\d{2}(?:\.\d{1,3})?>/u
const VOICE_MARKER = /^\[v:[^\]]+\]/u

function append(tokens: SourceToken[], kind: SourceTokenKind, value: string): void {
  if (!value) return
  const previous = tokens.at(-1)
  if (previous?.kind === kind) previous.value += value
  else tokens.push({ kind, value })
}

function tokenizeBody(body: string): SourceToken[] {
  const tokens: SourceToken[] = []
  let cursor = 0
  while (cursor < body.length) {
    const remaining = body.slice(cursor)
    const time = remaining.match(TIME_MARKER)?.[0]
    if (time) {
      append(tokens, 'time', time)
      cursor += time.length
      continue
    }
    const voice = remaining.match(VOICE_MARKER)?.[0]
    if (voice) {
      append(tokens, 'voice', voice)
      cursor += voice.length
      continue
    }
    if (body[cursor] === '[') {
      const close = body.indexOf(']', cursor + 1)
      const previous = body[cursor - 1]
      if (close !== -1 && previous && !/\s/u.test(previous) && KANA.test(body.slice(cursor + 1, close))) {
        append(tokens, 'furigana', body.slice(cursor, close + 1))
        cursor = close + 1
        continue
      }
    }
    append(tokens, 'text', body[cursor])
    cursor += 1
  }
  return tokens
}

export function tokenizeSourceLine(raw: string): SourceToken[] {
  if (!raw) return []
  if (/^\[[A-Za-z][\w-]*:[^\]]*\]$/u.test(raw)) return [{ kind: 'tag', value: raw }]
  const translation = raw.match(/^(\[>[^\]]+\])(.*)$/u)
  if (translation) return [{ kind: 'translation', value: translation[1] }, ...tokenizeBody(translation[2])]
  const timed = raw.match(/^(\[\d+:\d{2}(?:\.\d{1,3})?\])(.*)$/u)
  if (timed) return [{ kind: 'time', value: timed[1] }, ...tokenizeBody(timed[2])]
  return tokenizeBody(raw)
}

export function sourceLineTimestamp(raw: string): number | null {
  const match = raw.match(/^\[(\d+:\d{2}(?:\.\d{1,3})?)\]/u)
  return match ? parseTimestamp(match[1]) : null
}
