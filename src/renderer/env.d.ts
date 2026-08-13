import type { LyrisApi } from '../types/api'

declare global {
  interface Window {
    lyris: LyrisApi
  }
}

export {}
