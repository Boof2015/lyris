# Lyris

Local-first lyric transcription and synchronization.

Lyris is a focused desktop workstation for authoring, correcting, timing, and
exporting LRC, Enhanced LRC, and XLRC lyrics. The editor is the product; local
AI providers will plug into the same non-destructive document workflow in a
later milestone.

## Development

```sh
npm install
npm run dev
```

Run all static checks, unit tests, and the production build with:

```sh
npm run check
```

Lyris currently targets Apple Silicon first. Project files use the `.lyris`
extension and reference source audio without copying or altering it.
