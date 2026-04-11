/**
 * ESM preload for the hidden transcription window.
 *
 * Why .mjs preload?
 *   – Electron loads preload scripts via Node.js's module system, so bare
 *     specifiers like '@xenova/transformers' resolve through node_modules. ✓
 *   – The preload runs inside the renderer process, so globalThis.Worker is
 *     Chromium's Web Worker, which supports blob: URLs needed by
 *     onnxruntime-web's WASM threading backend. ✓
 *   – Dynamic import() inside this file also uses Node.js's loader, not
 *     Chromium's, so every transitive bare specifier keeps working. ✓
 */
import { ipcRenderer } from 'electron';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

// createRequire gives us a require() that resolves from THIS file's location,
// so node_modules lookups work correctly.
const require = createRequire(import.meta.url);

// ── ONNX patch ────────────────────────────────────────────────────────────────
// onnxruntime-node's native binding fails (ERR_DLOPEN_FAILED on this machine).
// Pre-populate require.cache under the onnxruntime-node path with
// onnxruntime-web so the CJS-interop loader returns our stub without ever
// touching the .node file.
try {
  const Module   = require('module');
  const nodePath = require.resolve('onnxruntime-node');
  const ortWeb   = require('onnxruntime-web');
  require.cache[nodePath] = {
    id: nodePath, filename: nodePath, loaded: true,
    exports: ortWeb.default ?? ortWeb,
    parent: null, children: [], paths: [],
  };
} catch (e) {
  console.warn('[transcribe] ONNX patch failed:', e.message);
}

// ── Whisper pipeline (lazy) ───────────────────────────────────────────────────
let transcriber = null;

async function ensureTranscriber(bookId, total) {
  if (transcriber) return transcriber;

  // import() here uses Node.js's ESM loader → bare specifiers work.
  const { pipeline, env } = await import('@xenova/transformers');
  const userData = await ipcRenderer.invoke('app:getUserDataPath');
  env.cacheDir = path.join(userData, 'models');

  send({ bookId, type: 'model_load', chapterIndex: -1, total, chapterTitle: '', text: '' });

  transcriber = await pipeline(
    'automatic-speech-recognition',
    'Xenova/whisper-tiny.en',
    {
      quantized: true,
      progress_callback: (p) => {
        if (p.status === 'downloading') {
          send({
            bookId, type: 'model_download', pct: Math.round(p.progress || 0),
            chapterIndex: -1, total, chapterTitle: '', text: '',
          });
        }
      },
    }
  );
  return transcriber;
}

function send(data) { ipcRenderer.send('transcribe:progress', data); }

// ── Transcription worker ──────────────────────────────────────────────────────
ipcRenderer.on('transcribe:start', async (_e, { bookId, chapters, ffmpegPath, tmpDir }) => {
  const total = chapters.length;
  try {
    const t = await ensureTranscriber(bookId, total);

    for (let i = 0; i < total; i++) {
      const chapter  = chapters[i];
      const rawPath  = path.join(tmpDir, `ch_${bookId}_${i}.raw`);
      let chapterText = '';

      try {
        execFileSync(ffmpegPath, [
          '-y', '-i', chapter.filepath,
          '-ar', '16000', '-ac', '1', '-f', 'f32le', rawPath,
        ], { stdio: 'pipe' });

        const rawBuf = fs.readFileSync(rawPath);
        const audio  = new Float32Array(rawBuf.buffer, rawBuf.byteOffset, rawBuf.byteLength / 4);

        const result = await t(audio, { sampling_rate: 16000, chunk_length_s: 30, stride_length_s: 5 });
        chapterText = Array.isArray(result)
          ? result.map(r => r.text).join(' ').trim()
          : (result.text || '').trim();
      } catch (err) {
        chapterText = `(Transcription error: ${err.message})`;
      } finally {
        try { fs.unlinkSync(rawPath); } catch {}
      }

      send({ bookId, type: 'chapter', chapterIndex: i, total, chapterTitle: chapter.title, text: chapterText });
    }

    ipcRenderer.send('transcribe:done', { bookId, error: null });
  } catch (err) {
    ipcRenderer.send('transcribe:done', { bookId, error: err.message });
  }
});
