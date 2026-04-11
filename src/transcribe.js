'use strict';
// Runs in a hidden Chromium BrowserWindow (nodeIntegration: true).
// Chromium's global Worker supports blob: URLs, so onnxruntime-web WASM
// threading works here — unlike plain Node.js where it fails with ERR_WORKER_PATH.

const { ipcRenderer } = require('electron');
const path = require('path');
const fs   = require('fs');
const Module = require('module');

// ── ONNX patch: redirect require('onnxruntime-node') → onnxruntime-web ──────
;(function patchOnnxRuntime() {
  try {
    const ortNodePath = Module._resolveFilename('onnxruntime-node', module);
    const ortWeb = require('onnxruntime-web');
    require.cache[ortNodePath] = {
      id: ortNodePath, filename: ortNodePath, loaded: true,
      exports: ortWeb.default ?? ortWeb,
      parent: module, children: [], paths: [],
    };
  } catch (e) {
    console.warn('[transcribe] ONNX patch failed:', e.message);
  }
})();

let transcriber = null;

async function ensureTranscriber(bookId, total) {
  if (transcriber) return transcriber;

  // Chromium's import() needs a file:// URL, not a bare npm specifier
  const xenovaPath = require.resolve('@xenova/transformers');
  const xenovaUrl  = 'file:///' + xenovaPath.replace(/\\/g, '/');
  const { pipeline, env } = await import(xenovaUrl);
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
          send({ bookId, type: 'model_download', pct: Math.round(p.progress || 0),
                 chapterIndex: -1, total, chapterTitle: '', text: '' });
        }
      },
    }
  );
  return transcriber;
}

function send(data) {
  ipcRenderer.send('transcribe:progress', data);
}

ipcRenderer.on('transcribe:start', async (_e, { bookId, chapters, ffmpegPath, tmpDir }) => {
  const { execFileSync } = require('child_process');
  const total = chapters.length;

  try {
    const t = await ensureTranscriber(bookId, total);

    for (let i = 0; i < total; i++) {
      const chapter = chapters[i];
      let chapterText = '';
      const rawPath = path.join(tmpDir, `ch_${bookId}_${i}.raw`);

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
