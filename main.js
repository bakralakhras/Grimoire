const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ── Supabase ──────────────────────────────────────────────────────────────────

const SUPABASE_URL  = 'https://bxsjzldjsonkrbduqbrq.supabase.co';
const SUPABASE_ANON = 'sb_publishable_wCvj-EUvPlnfmdMO3WWglw_TJ1ox0oQ';

let supabase     = null;
let currentUser  = null;
let syncStatus   = 'idle';
let offlineQueue = [];


let mainWindow;
let transcribeWindow;
let db;

// ── Data persistence (JSON) ─────────────────────────────────────────────────

function dbPath() {
  return path.join(app.getPath('userData'), 'grimoire-data.json');
}

function loadDb() {
  try {
    const file = dbPath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { books: {}, playback: {}, bookmarks: {}, cloudBooks: {}, ...data };
    }
  } catch (e) { console.error('Load error:', e); }
  return { books: {}, playback: {}, bookmarks: {}, cloudBooks: {} };
}

function saveDb() {
  try { fs.writeFileSync(dbPath(), JSON.stringify(db, null, 2)); }
  catch (e) { console.error('Save error:', e); }
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

function initSupabase() {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });
  } catch (e) { console.error('Supabase init failed:', e); }
}

function sessionFilePath()   { return path.join(app.getPath('userData'), 'auth-session.json'); }
function authStateFilePath() { return path.join(app.getPath('userData'), 'auth-state.json'); }
function queueFilePath()     { return path.join(app.getPath('userData'), 'sync-queue.json'); }

function saveSession(session) {
  try {
    fs.writeFileSync(sessionFilePath(), JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }), 'utf8');
  } catch {}
}

function clearSession() {
  try { if (fs.existsSync(sessionFilePath())) fs.unlinkSync(sessionFilePath()); } catch {}
}

async function loadSession() {
  if (!supabase) return null;
  try {
    if (!fs.existsSync(sessionFilePath())) return null;
    const { access_token, refresh_token } = JSON.parse(fs.readFileSync(sessionFilePath(), 'utf8'));
    const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error || !data?.session) { clearSession(); return null; }
    currentUser = data.session.user;
    saveSession(data.session);
    return data.session;
  } catch { clearSession(); return null; }
}

function isAuthSkipped() {
  try {
    if (!fs.existsSync(authStateFilePath())) return false;
    return JSON.parse(fs.readFileSync(authStateFilePath(), 'utf8'))?.skipped === true;
  } catch { return false; }
}

function setAuthSkipped(val) {
  try { fs.writeFileSync(authStateFilePath(), JSON.stringify({ skipped: val }), 'utf8'); } catch {}
}

function loadQueue() {
  try {
    if (fs.existsSync(queueFilePath()))
      offlineQueue = JSON.parse(fs.readFileSync(queueFilePath(), 'utf8'));
  } catch { offlineQueue = []; }
}

function saveQueue() {
  try { fs.writeFileSync(queueFilePath(), JSON.stringify(offlineQueue), 'utf8'); } catch {}
}

function setSyncStatus(status, detail = '') {
  syncStatus = status;
  mainWindow?.webContents.send('sync:status', { status, detail });
}

async function doSync(op) {
  try {
    if (op.type === 'progress') {
      const { error } = await supabase.from('progress').upsert({
        user_id: currentUser.id, book_id: op.bookId, book_title: op.bookTitle || '',
        chapter_index: op.chapterIndex, position: op.position, speed: op.speed,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,book_id' });
      if (error) throw error;
    } else if (op.type === 'bookmark_upsert') {
      const { error } = await supabase.from('bookmarks').upsert({
        id: op.id, user_id: currentUser.id, book_id: op.bookId,
        chapter_index: op.chapterIndex, position: op.position,
        name: op.name, created_at: op.createdAt,
      });
      if (error) throw error;
    } else if (op.type === 'bookmark_delete') {
      const { error } = await supabase.from('bookmarks')
        .delete().eq('id', op.bookmarkId).eq('user_id', currentUser.id);
      if (error) throw error;
    } else if (op.type === 'rating') {
      const { error } = await supabase.from('book_settings').upsert({
        user_id: currentUser.id, book_id: op.bookId,
        rating: op.rating ?? null, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,book_id' });
      if (error) throw error;
    }
    return { ok: true };
  } catch (e) {
    const msg = e?.message || 'Unknown sync error';
    console.error('Sync op failed:', op.type, msg);
    return { ok: false, error: msg };
  }
}

async function flushQueue() {
  if (!offlineQueue.length || !currentUser || !supabase) return;
  const pending = [...offlineQueue];
  offlineQueue = [];
  const failed = [];
  let lastError = '';
  for (const op of pending) {
    const res = await doSync(op);
    if (!res.ok) { failed.push(op); lastError = res.error || ''; }
  }
  offlineQueue = failed;
  saveQueue();
  setSyncStatus(failed.length === 0 ? 'synced' : 'offline', lastError);
}

// ── S3 helpers ────────────────────────────────────────────────────────────────

function s3ConfigPath() { return path.join(app.getPath('userData'), 's3-config.json'); }

function loadS3Config() {
  try {
    if (fs.existsSync(s3ConfigPath()))
      return JSON.parse(fs.readFileSync(s3ConfigPath(), 'utf8'));
  } catch {}
  // Default credentials (user can override in settings)
  return {
    region: 'us-east-1',
    bucket: 'grimoire-library',
    accessKeyId: 'AKIAW44VDXKCMRWZPVX5',
    secretAccessKey: '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',
  };
}

function saveS3Config(cfg) {
  try { fs.writeFileSync(s3ConfigPath(), JSON.stringify(cfg, null, 2), 'utf8'); } catch {}
}

function createS3Client(cfg) {
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region: cfg.region || 'us-east-1',
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function spawnAsync(bin, args) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => resolve({ code, stderr }));
    proc.on('error', reject);
  });
}

// Returns { exe, args } where `spawn(exe, [...args, scriptPath, ...scriptArgs])` works.
// Tries version-specific invocations first — faster-whisper's ctranslate2 has
// known compatibility issues with Python 3.12+.
async function findPython() {
  const candidates = [
    { exe: 'py',         args: ['-3.11'] },
    { exe: 'py',         args: ['-3.10'] },
    { exe: 'py',         args: ['-3.9']  },
    { exe: 'python3.11', args: []        },
    { exe: 'python',     args: []        },
    { exe: 'py',         args: []        },
  ];
  for (const c of candidates) {
    try {
      const { code } = await spawnAsync(c.exe, [...c.args, '--version']);
      if (code === 0) return c;
    } catch { /* not found — try next */ }
  }
  return null;
}

// Build a process.env copy with NVIDIA CUDA DLL directories prepended to PATH.
// This ensures ctranslate2 / cuDNN DLLs are found even when Electron's PATH
// doesn't include the Python site-packages nvidia subdirectories.
function cudaEnv() {
  const cudaDirs = [
    'C:\\Users\\void_\\AppData\\Local\\Programs\\Python\\Python311\\Lib\\site-packages\\nvidia\\cublas\\bin',
    'C:\\Users\\void_\\AppData\\Local\\Programs\\Python\\Python311\\Lib\\site-packages\\nvidia\\cudnn\\bin',
    'C:\\Users\\void_\\AppData\\Local\\Programs\\Python\\Python311\\Lib\\site-packages\\nvidia\\cuda_nvrtc\\bin',
  ];
  return {
    ...process.env,
    PATH: cudaDirs.join(path.delimiter) + path.delimiter + (process.env.PATH || ''),
  };
}

function naturalSort(a, b) {
  const na = parseInt((a.match(/(\d+)/) || [0, 0])[1], 10);
  const nb = parseInt((b.match(/(\d+)/) || [0, 0])[1], 10);
  if (na !== nb) return na - nb;
  return a.localeCompare(b);
}

// Author/series noise words that should NOT be stripped as part of the title
const TITLE_STOPWORDS = new Set([
  'The','A','An','Of','In','On','At','By','For','To','And','Or','Is','Its',
]);

function cleanTitle(raw) {
  let t = raw;

  // "Author - Title" → keep everything after the first " - "
  const dashIdx = t.indexOf(' - ');
  if (dashIdx > 0) t = t.slice(dashIdx + 3);

  // Strip series/volume suffixes
  t = t.replace(/\s*[,:]?\s*\bBook\s+(?:\d+|[IVXLCDM]+)\b.*/i, '');
  t = t.replace(/\s*[,:]?\s*\bPart\s+(?:\d+|[IVXLCDM]+)\b.*/i, '');
  t = t.replace(/\s*[,:]?\s*\bVol(?:ume)?\s*\.?\s*(?:\d+|[IVXLCDM]+)\b.*/i, '');
  t = t.replace(/\s+#\d+\s*$/, '');
  t = t.replace(/\s*\((?:Unabridged|Abridged|MP3|AAC|Audiobook)[^)]*\)/i, '');
  t = t.replace(/\s*\[(?:Unabridged|Abridged|MP3|AAC|Audiobook)[^\]]*\]/i, '');

  // Strip "Firstname Lastname" author prefix when followed by a capitalised title
  // Both name parts must be ≥2-char Title Case words that are not stopwords
  const m = t.match(/^([A-Z][a-z]{1,}\s+[A-Z][a-z]{1,})\s+(.+)$/);
  if (m) {
    const parts = m[1].split(/\s+/);
    const rest  = m[2];
    if (!TITLE_STOPWORDS.has(parts[0]) && !TITLE_STOPWORDS.has(parts[1]) && /^[A-Z]/.test(rest)) {
      t = rest;
    }
  }

  return t.trim();
}

function bookTitle(folderPath) {
  const raw = path.basename(folderPath)
    .replace(/[_]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleanTitle(raw) || raw;
}

function chapterTitle(filename) {
  const ext = path.extname(filename);
  let name = filename.slice(0, filename.length - ext.length);
  name = name.replace(/^(chapter\s+)?\d+[\s\-_.]+/i, '');
  name = name.replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  return name || filename.replace(ext, '');
}

// ── App setup ────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  db = loadDb();
  initSupabase();
  loadQueue();
  setAuthSkipped(false); // clear any stale skip state — auth is now required
  await loadSession();
  createWindow();
  registerIPC();
  setInterval(flushQueue, 30_000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// ── IPC ──────────────────────────────────────────────────────────────────────

function registerIPC() {
  // Window controls
  ipcMain.on('window:minimize', () => mainWindow.minimize());
  ipcMain.on('window:maximize', () =>
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  );
  ipcMain.on('window:close', () => mainWindow.close());

  // Open folder picker
  ipcMain.handle('dialog:openFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Audiobook Folder',
    });
    return canceled ? null : filePaths[0];
  });

  // Open image file picker (for catalog cover art)
  ipcMain.handle('dialog:openImageFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Select Cover Image',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    return canceled ? null : filePaths[0];
  });

  // Import folder
  ipcMain.handle('library:import', async (_e, folderPath) => {
    const audioExts = new Set(['.mp3', '.mp4', '.m4b', '.m4a', '.aac', '.ogg', '.wav', '.flac', '.opus']);
    let files;
    try {
      files = fs.readdirSync(folderPath)
        .filter(f => audioExts.has(path.extname(f).toLowerCase()))
        .sort(naturalSort);
    } catch (e) {
      return { error: 'Cannot read folder: ' + e.message };
    }
    if (files.length === 0) return { error: 'No audio files found in this folder.' };

    const existing = Object.values(db.books).find(b => b.folderPath === folderPath);
    const bookId = existing ? existing.id : crypto.randomUUID();

    const chapters = files.map((filename, i) => ({
      id: i,
      filename,
      filepath: path.join(folderPath, filename),
      title: chapterTitle(filename),
      duration: existing?.chapters?.[i]?.duration || 0,
    }));

    // Try to extract cover art from ID3/MP4 tags if no cover is set yet
    let coverPath = existing?.coverPath || null;
    if (!coverPath) {
      try {
        const mm = require('music-metadata');
        const firstFile = path.join(folderPath, files[0]);
        const meta = await mm.parseFile(firstFile, { skipCovers: false, duration: false });
        const pic = mm.selectCover(meta.common.picture);
        if (pic?.data?.length) {
          const coversDir = path.join(app.getPath('userData'), 'covers');
          if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });
          const ext = (pic.format || 'image/jpeg').replace('image/', '') || 'jpg';
          const destPath = path.join(coversDir, `${bookId}_cover.${ext}`);
          fs.writeFileSync(destPath, pic.data);
          coverPath = destPath;
        }
      } catch (e) {
        // Non-fatal — cover art extraction failure shouldn't block import
        console.warn('Cover extraction skipped:', e.message);
      }
    }

    const book = {
      id: bookId,
      title: bookTitle(folderPath),
      folderPath,
      chapterCount: files.length,
      addedAt: existing ? existing.addedAt : new Date().toISOString(),
      coverPath,
      chapters,
    };

    db.books[bookId] = book;
    saveDb();
    return { ...book, playback: db.playback[bookId] || null };
  });

  // Get all books (with embedded playback state for progress bars)
  ipcMain.handle('library:getAll', () =>
    Object.values(db.books)
      .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
      .map(book => ({ ...book, playback: db.playback[book.id] || null }))
  );

  // Get single book
  ipcMain.handle('library:getBook', (_e, bookId) => {
    const book = db.books[bookId];
    if (!book) return null;
    return { ...book, playback: db.playback[bookId] || null };
  });

  // Delete book
  ipcMain.handle('library:delete', (_e, bookId) => {
    delete db.books[bookId];
    delete db.playback[bookId];
    delete db.bookmarks[bookId];
    saveDb();
    return true;
  });

  // Rename book title
  ipcMain.handle('library:rename', (_e, { bookId, title }) => {
    if (db.books[bookId]) { db.books[bookId].title = title; saveDb(); }
    return true;
  });

  // Set cover art — opens image picker, copies file into userData/covers/
  ipcMain.handle('book:setCover', async (_e, bookId) => {
    const book = db.books[bookId];
    if (!book) return { error: 'Book not found' };

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Cover Image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (canceled || !filePaths.length) return null;

    const src = filePaths[0];
    const ext = path.extname(src).slice(1).toLowerCase(); // 'jpg', 'png', …

    const coversDir = path.join(app.getPath('userData'), 'covers');
    if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });

    // Remove previous cover file if it was one we copied (lives in coversDir)
    if (book.coverPath && book.coverPath.startsWith(coversDir)) {
      try { fs.unlinkSync(book.coverPath); } catch {}
    }

    const dest = path.join(coversDir, `${bookId}_cover.${ext}`);
    fs.copyFileSync(src, dest);

    book.coverPath = dest;
    saveDb();
    return dest;
  });

  // Set background image — opens image picker, copies file into userData/backgrounds/
  ipcMain.handle('book:setBackground', async (_e, bookId) => {
    const book = db.books[bookId];
    if (!book) return { error: 'Book not found' };

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Background Image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (canceled || !filePaths.length) return null;

    const src = filePaths[0];
    const ext = path.extname(src).slice(1).toLowerCase();

    const bgsDir = path.join(app.getPath('userData'), 'backgrounds');
    if (!fs.existsSync(bgsDir)) fs.mkdirSync(bgsDir, { recursive: true });

    if (book.bgPath && book.bgPath.startsWith(bgsDir)) {
      try { fs.unlinkSync(book.bgPath); } catch {}
    }

    const dest = path.join(bgsDir, `${bookId}_bg.${ext}`);
    fs.copyFileSync(src, dest);

    book.bgPath = dest;
    saveDb();
    return dest;
  });

  // Save playback state
  ipcMain.handle('playback:save', (_e, { bookId, chapterIndex, position, speed }) => {
    db.playback[bookId] = { chapterIndex, position, speed, updatedAt: new Date().toISOString() };
    saveDb();
    return true;
  });

  // Get playback state
  ipcMain.handle('playback:get', (_e, bookId) => db.playback[bookId] || null);

  // Bookmarks
  ipcMain.handle('bookmarks:add', (_e, { bookId, chapterIndex, position, name }) => {
    if (!db.bookmarks[bookId]) db.bookmarks[bookId] = [];
    const bm = { id: crypto.randomUUID(), bookId, chapterIndex, position, name, createdAt: new Date().toISOString() };
    db.bookmarks[bookId].push(bm);
    saveDb();
    return bm;
  });

  ipcMain.handle('bookmarks:get', (_e, bookId) => db.bookmarks[bookId] || []);

  ipcMain.handle('bookmarks:delete', (_e, { bookId, bookmarkId }) => {
    if (db.bookmarks[bookId]) {
      db.bookmarks[bookId] = db.bookmarks[bookId].filter(b => b.id !== bookmarkId);
      saveDb();
    }
    return true;
  });

  ipcMain.handle('bookmarks:rename', (_e, { bookId, bookmarkId, name }) => {
    const bm = db.bookmarks[bookId]?.find(b => b.id === bookmarkId);
    if (bm) { bm.name = name; saveDb(); }
    return true;
  });

  // ── Transcription ──────────────────────────────────────────────────────────

  // Expose userData path to the transcription worker window
  ipcMain.handle('app:getUserDataPath', () => app.getPath('userData'));

  let transcribeWindowReady = false;

  async function getTranscribeWindow() {
    if (transcribeWindow && !transcribeWindow.isDestroyed()) {
      if (transcribeWindowReady) return transcribeWindow;
      // Still loading — wait for it
      await new Promise(r => transcribeWindow.webContents.once('did-finish-load', r));
      return transcribeWindow;
    }
    transcribeWindowReady = false;
    transcribeWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false,
        // .mjs preload: loaded by Node.js's ESM loader so bare npm specifiers
        // resolve correctly, while Worker runs in Chromium for blob: URL support.
        preload: path.join(__dirname, 'src', 'transcribe-preload.mjs'),
      },
    });
    await new Promise(r => {
      transcribeWindow.webContents.once('did-finish-load', () => {
        transcribeWindowReady = true;
        r();
      });
      transcribeWindow.loadFile(path.join(__dirname, 'src', 'transcribe.html'));
    });
    transcribeWindow.on('closed', () => { transcribeWindow = null; transcribeWindowReady = false; });
    return transcribeWindow;
  }

  ipcMain.handle('book:transcribe', async (event, bookId) => {
    const book = db.books[bookId];
    if (!book) return { error: 'Book not found' };

    let ffmpegPath;
    try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; }
    catch (e) { return { error: 'ffmpeg not available: ' + e.message }; }

    const scriptPath = path.join(__dirname, 'scripts', 'detect_chapters.py');
    if (!fs.existsSync(scriptPath)) {
      return { error: 'Transcription script not found. Reinstall Grimoire.' };
    }

    const python = await findPython();
    if (!python) {
      return { error: 'Python 3 is not installed or not in PATH.\n\nTranscription requires Python 3.9–3.11 and faster-whisper.\nInstall: pip install faster-whisper' };
    }

    const transcriptsDir = path.join(app.getPath('userData'), 'transcripts');
    if (!fs.existsSync(transcriptsDir)) fs.mkdirSync(transcriptsDir, { recursive: true });

    const chaptersArg = book.chapters.map((ch, i) => ({
      index: i,
      title: ch.title,
      filepath: ch.filepath,
    }));

    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      const proc = spawn(python.exe, [
        ...python.args,
        scriptPath,
        '--mode',          'transcribe',
        '--chapters-json', JSON.stringify(chaptersArg),
        '--ffmpeg',        ffmpegPath,
      ], { stdio: ['ignore', 'pipe', 'pipe'], env: cudaEnv() });

      let buf = '';
      let stderrBuf = '';
      const parts = [];

      proc.stdout.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            if (msg.type === 'loading') {
              event.sender.send('transcribe:progress', { bookId, type: 'model_load' });
            } else if (msg.type === 'device') {
              event.sender.send('transcribe:progress', {
                bookId, type: 'device',
                device: msg.device, compute_type: msg.compute_type,
              });
            } else if (msg.type === 'chapter') {
              // Chapter fully transcribed — persist and forward to renderer
              const entry = `=== Chapter ${msg.chapterIndex + 1}: ${msg.chapterTitle} ===\n\n${msg.text}`;
              parts[msg.chapterIndex] = entry;
              fs.writeFileSync(
                path.join(transcriptsDir, `${bookId}_${msg.chapterIndex}.txt`), entry, 'utf8'
              );
              // Persist word-timestamp data alongside the plain transcript
              if (Array.isArray(msg.words) && msg.words.length) {
                const wordsFile = path.join(transcriptsDir, `${bookId}_words.json`);
                let wordsData = {};
                try { wordsData = JSON.parse(fs.readFileSync(wordsFile, 'utf8')); } catch {}
                wordsData[String(msg.chapterIndex)] = msg.words;
                fs.writeFileSync(wordsFile, JSON.stringify(wordsData), 'utf8');
              }
              event.sender.send('transcribe:progress', {
                bookId,
                type:         'chapter',
                chapterIndex: msg.chapterIndex,
                total:        msg.total,
                chapterTitle: msg.chapterTitle,
                text:         msg.text,
                words:        msg.words || [],
              });
            }
            // 'progress' (before text is ready) and 'result' need no special handling
          } catch { /* malformed line */ }
        }
      });

      proc.stderr.on('data', chunk => { stderrBuf += chunk.toString(); });

      proc.on('close', code => {
        if (code === 0) {
          const fullTranscript = parts.filter(Boolean).join('\n\n---\n\n');
          fs.writeFileSync(path.join(transcriptsDir, `${bookId}_full.txt`), fullTranscript, 'utf8');
          resolve(fullTranscript);
        } else {
          const notInstalled = /No module named ['"]faster_whisper/i.test(stderrBuf)
            || /ModuleNotFoundError/i.test(stderrBuf);
          resolve({
            error: notInstalled
              ? 'faster-whisper is not installed.\n\nRun: pip install faster-whisper'
              : (stderrBuf.slice(-400) || `Process exited with code ${code}`),
          });
        }
      });

      proc.on('error', err => resolve({ error: err.message }));
    });
  });

  // ── Chapter splitting ────────────────────────────────────────────────────

  ipcMain.handle('book:detectSilences', async (event, { bookId, silenceDuration, noiseFloor }) => {
    const book = db.books[bookId];
    if (!book) return { error: 'Book not found' };
    if (book.chapters.length !== 1) return { error: 'Book must have exactly one file' };

    let ffmpegPath;
    try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; }
    catch (e) { return { error: 'ffmpeg not available: ' + e.message }; }

    const filePath = book.chapters[0].filepath;
    event.sender.send('split:progress', { type: 'detecting', message: 'Analyzing audio for silences…' });

    try {
      const { stderr } = await spawnAsync(ffmpegPath, [
        '-i', filePath,
        '-af', `silencedetect=noise=${noiseFloor}dB:d=${silenceDuration}`,
        '-f', 'null', '-',
      ]);

      const starts = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));
      const ends   = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));

      const rawPoints = [];
      for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
        rawPoints.push((starts[i] + ends[i]) / 2);
      }

      let totalDuration = 0;
      const dm = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      if (dm) totalDuration = parseInt(dm[1]) * 3600 + parseInt(dm[2]) * 60 + parseFloat(dm[3]);

      // Filter out split points that would produce chapters shorter than 10 minutes.
      // Walk the candidate list greedily: only keep a point if it is at least
      // MIN_CHAPTER seconds after the previous kept boundary.  Then do a final
      // pass to drop the last kept point if the trailing chapter would be too short.
      const MIN_CHAPTER = 600; // seconds
      const splitPoints = [];
      let cursor = 0;
      for (const pt of rawPoints) {
        if (pt - cursor >= MIN_CHAPTER) {
          splitPoints.push(pt);
          cursor = pt;
        }
      }
      // If the final chapter would be shorter than MIN_CHAPTER, drop its start point.
      if (splitPoints.length > 0 && totalDuration > 0) {
        const lastChapterLen = totalDuration - splitPoints[splitPoints.length - 1];
        if (lastChapterLen < MIN_CHAPTER) splitPoints.pop();
      }

      return { splitPoints, totalDuration };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('book:splitAtPoints', async (event, { bookId, splitPoints }) => {
    const book = db.books[bookId];
    if (!book) return { error: 'Book not found' };

    let ffmpegPath;
    try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; }
    catch (e) { return { error: 'ffmpeg not available: ' + e.message }; }

    const sourceFile = book.chapters[0].filepath;
    const sourceDir  = path.dirname(sourceFile);
    const sourceName = path.basename(sourceFile, path.extname(sourceFile));
    const sourceExt  = path.extname(sourceFile);
    const outDir = path.join(sourceDir, `${sourceName} - Chapters`);

    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // Build ordered segment list: start times from [0, ...splitPoints]
    const starts = [0, ...splitPoints];
    const total  = starts.length;

    for (let i = 0; i < total; i++) {
      const segStart = starts[i];
      const segEnd   = i < total - 1 ? starts[i + 1] : null;
      const chNum    = String(i + 1).padStart(3, '0');
      const outFile  = path.join(outDir, `Chapter ${chNum}${sourceExt}`);

      event.sender.send('split:progress', {
        type: 'splitting', current: i + 1, total,
        message: `Splitting chapter ${i + 1} of ${total}…`,
      });

      const args = ['-y', '-ss', String(segStart), '-i', sourceFile];
      if (segEnd !== null) args.push('-t', String(segEnd - segStart));
      args.push('-c', 'copy', '-avoid_negative_ts', '1', outFile);

      try {
        const { code, stderr } = await spawnAsync(ffmpegPath, args);
        if (code !== 0) return { error: `Chapter ${i + 1} failed: ${stderr.slice(-300)}` };
      } catch (e) {
        return { error: `Chapter ${i + 1} failed: ${e.message}` };
      }
    }

    event.sender.send('split:progress', { type: 'importing', message: 'Updating library…' });

    const audioExts = new Set(['.mp3', '.mp4', '.m4b', '.m4a', '.aac', '.ogg', '.wav', '.flac', '.opus']);
    const newFiles = fs.readdirSync(outDir)
      .filter(f => audioExts.has(path.extname(f).toLowerCase()))
      .sort(naturalSort);

    const chapters = newFiles.map((filename, idx) => ({
      id: idx, filename,
      filepath: path.join(outDir, filename),
      title: chapterTitle(filename),
      duration: 0,
    }));

    book.folderPath  = outDir;
    book.chapters    = chapters;
    book.chapterCount = chapters.length;
    delete db.playback[bookId];
    saveDb();

    return { ...book, playback: null, chaptersCreated: chapters.length };
  });

  ipcMain.handle('transcript:get', (_e, bookId) => {
    const fp = path.join(app.getPath('userData'), 'transcripts', `${bookId}_full.txt`);
    if (!fs.existsSync(fp)) return null;
    return fs.readFileSync(fp, 'utf8');
  });

  ipcMain.handle('transcript:getWords', (_e, bookId) => {
    const fp = path.join(app.getPath('userData'), 'transcripts', `${bookId}_words.json`);
    if (!fs.existsSync(fp)) return null;
    try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
    catch { return null; }
  });

  // AI chapter detection — sliding-window scan via detect_chapters.py
  // Transcribes a short clip every stepSeconds and checks for "chapter" in the text.
  ipcMain.handle('book:detectChaptersAI', async (event, { bookId, stepSeconds = 480 }) => {
    const book = db.books[bookId];
    if (!book) return { error: 'book_not_found', message: 'Book not found' };

    let ffmpegPath;
    try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; }
    catch (e) { return { error: 'no_ffmpeg', message: 'ffmpeg not available' }; }

    const scriptPath = path.join(__dirname, 'scripts', 'detect_chapters.py');
    if (!fs.existsSync(scriptPath)) {
      return { error: 'no_script', message: 'detect_chapters.py not found alongside main.js' };
    }

    const python = await findPython();
    if (!python) {
      return { error: 'no_python', message: 'Python 3 is not installed or not in PATH.' };
    }

    const audioPath = book.chapters[0].filepath;

    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      const proc = spawn(python.exe, [
        ...python.args,
        scriptPath,
        '--mode',          'chapters',
        '--audio',         audioPath,
        '--step-seconds',  String(stepSeconds),
        '--clip-duration', '20',
        '--ffmpeg',        ffmpegPath,
      ], { stdio: ['ignore', 'pipe', 'pipe'], env: cudaEnv() });

      let stdoutBuf = '';
      let stderrBuf = '';
      let finalResult = null;

      proc.stdout.on('data', chunk => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            if (msg.type === 'result' || msg.type === 'error') {
              finalResult = msg;
            } else {
              event.sender.send('ai:progress', msg);
            }
          } catch { /* malformed line — ignore */ }
        }
      });

      proc.stderr.on('data', chunk => { stderrBuf += chunk.toString(); });

      proc.on('close', code => {
        if (stdoutBuf.trim()) {
          try {
            const msg = JSON.parse(stdoutBuf.trim());
            if (msg.type === 'result' || msg.type === 'error') finalResult = msg;
          } catch { /* ignore */ }
        }

        if (finalResult) {
          if (finalResult.type === 'result') {
            resolve({ confirmed: finalResult.confirmed, totalDuration: finalResult.duration || 0 });
          } else {
            resolve({ error: finalResult.code || 'script_error', message: finalResult.message });
          }
          return;
        }

        const notInstalled = /No module named ['"]faster_whisper/i.test(stderrBuf)
          || /ModuleNotFoundError/i.test(stderrBuf);
        resolve({
          error: notInstalled ? 'not_installed' : 'process_failed',
          message: notInstalled
            ? 'faster-whisper is not installed. Run: pip install faster-whisper'
            : (stderrBuf.slice(-400) || `Process exited with code ${code}`),
        });
      });

      proc.on('error', err => resolve({ error: 'spawn_failed', message: err.message }));
    });
  });

  // Known chapter count — detect ALL silences, rank by duration, keep top N-1.
  ipcMain.handle('book:detectByCount', async (event, { bookId, chapterCount }) => {
    const book = db.books[bookId];
    if (!book) return { error: 'Book not found' };
    if (book.chapters.length !== 1) return { error: 'Book must have exactly one file' };

    let ffmpegPath;
    try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; }
    catch (e) { return { error: 'ffmpeg not available: ' + e.message }; }

    const filePath = book.chapters[0].filepath;
    event.sender.send('split:progress', { type: 'detecting', message: 'Scanning audio for silence gaps…' });

    try {
      // Broad silencedetect to catch even brief gaps — we rank by duration later.
      const { stderr } = await spawnAsync(ffmpegPath, [
        '-i', filePath,
        '-af', 'silencedetect=noise=-30dB:d=0.3',
        '-f', 'null', '-',
      ]);

      const starts = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));
      const ends   = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));

      let totalDuration = 0;
      const dm = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      if (dm) totalDuration = parseInt(dm[1]) * 3600 + parseInt(dm[2]) * 60 + parseFloat(dm[3]);

      // Build silence records with duration for ranking
      const silences = [];
      for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
        silences.push({
          midpoint: (starts[i] + ends[i]) / 2,
          duration: ends[i] - starts[i],
        });
      }

      if (silences.length === 0) {
        return { splitPoints: [], totalDuration, warning: 'No silence gaps found in audio.' };
      }

      const needed = Math.max(0, chapterCount - 1);
      // Sort by silence duration descending → longest silences = most likely chapter breaks
      const topSilences = silences
        .sort((a, b) => b.duration - a.duration)
        .slice(0, needed);

      // Re-sort selected silences chronologically
      const splitPoints = topSilences
        .map(s => s.midpoint)
        .sort((a, b) => a - b);

      return { splitPoints, totalDuration };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Book rating (0.5–5.0, null to clear)
  ipcMain.handle('book:setRating', (_e, { bookId, rating }) => {
    if (db.books[bookId]) {
      if (rating == null) delete db.books[bookId].rating;
      else db.books[bookId].rating = rating;
      saveDb();
    }
    return true;
  });

  // Update chapter duration (for accurate progress)
  ipcMain.handle('chapters:updateDuration', (_e, { bookId, chapterId, duration }) => {
    const book = db.books[bookId];
    if (book?.chapters?.[chapterId] !== undefined) {
      book.chapters[chapterId].duration = duration;
      saveDb();
    }
    return true;
  });

  // ── Auth ─────────────────────────────────────────────────────────────────────

  ipcMain.handle('auth:getSession', () => {
    if (currentUser) return { user: { id: currentUser.id, email: currentUser.email } };
    if (isAuthSkipped()) return { skipped: true };
    return null;
  });

  ipcMain.handle('auth:login', async (_e, { email, password }) => {
    if (!supabase) return { error: 'Sync unavailable' };
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      // Explicitly set session so all subsequent requests carry the JWT
      await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      currentUser = data.user;
      saveSession(data.session);
      setAuthSkipped(false);
      return { user: { id: data.user.id, email: data.user.email } };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('auth:signup', async (_e, { email, password }) => {
    if (!supabase) return { error: 'Sync unavailable' };
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { error: error.message };
      if (data.session) {
        // Explicitly set session so all subsequent requests carry the JWT
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        currentUser = data.user;
        saveSession(data.session);
        setAuthSkipped(false);
        return { user: { id: data.user.id, email: data.user.email } };
      }
      return { needsConfirmation: true };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('auth:logout', async () => {
    try { if (supabase) await supabase.auth.signOut(); } catch {}
    currentUser = null;
    clearSession();
    offlineQueue = [];
    saveQueue();
    setSyncStatus('idle');
    // Wipe all local user data so it doesn't bleed into the next account
    db.books = {};
    db.playback = {};
    db.bookmarks = {};
    db.cloudBooks = {};
    saveDb();
    return true;
  });

  ipcMain.handle('auth:skip', () => { setAuthSkipped(true); return true; });

  // ── Sync ─────────────────────────────────────────────────────────────────────

  ipcMain.handle('sync:push', async (_e, op) => {
    if (!currentUser) return { skipped: true };
    // Dedupe progress pushes — keep only latest per book
    if (op.type === 'progress') {
      offlineQueue = offlineQueue.filter(q => !(q.type === 'progress' && q.bookId === op.bookId));
    }
    setSyncStatus('syncing');
    const res = await doSync(op);
    if (res.ok) {
      if (offlineQueue.length) flushQueue(); else setSyncStatus('synced');
    } else {
      offlineQueue.push(op);
      saveQueue();
      setSyncStatus('offline', res.error);
    }
    return res;
  });

  ipcMain.handle('sync:pull', async () => {
    if (!supabase || !currentUser) return { error: 'Not logged in' };
    setSyncStatus('syncing');
    try {
      const uid = currentUser.id;
      const [pRes, bRes, sRes] = await Promise.all([
        supabase.from('progress').select('*').eq('user_id', uid),
        supabase.from('bookmarks').select('*').eq('user_id', uid),
        supabase.from('book_settings').select('*').eq('user_id', uid),
      ]);
      if (pRes.error) throw pRes.error;

      // Merge progress: remote wins (applies to both local and cloud-only books)
      for (const r of pRes.data || []) {
        db.playback[r.book_id] = {
          chapterIndex: r.chapter_index, position: r.position,
          speed: r.speed, updatedAt: r.updated_at,
        };
      }
      // Merge bookmarks: add remote entries missing locally
      for (const r of bRes.data || []) {
        if (!db.books[r.book_id]) continue;
        if (!db.bookmarks[r.book_id]) db.bookmarks[r.book_id] = [];
        if (!db.bookmarks[r.book_id].some(b => b.id === r.id)) {
          db.bookmarks[r.book_id].push({
            id: r.id, bookId: r.book_id, chapterIndex: r.chapter_index,
            position: r.position, name: r.name, createdAt: r.created_at,
          });
        }
      }
      // Merge ratings
      for (const r of sRes.data || []) {
        if (!db.books[r.book_id]) continue;
        if (r.rating != null) db.books[r.book_id].rating = r.rating;
        else delete db.books[r.book_id].rating;
      }

      saveDb();
      setSyncStatus('synced');
      return { success: true };
    } catch (e) {
      setSyncStatus('offline');
      return { error: e.message };
    }
  });

  ipcMain.handle('sync:getStatus', () => ({ status: syncStatus, detail: '' }));

  // ── S3 ────────────────────────────────────────────────────────────────────────

  ipcMain.handle('s3:getConfig', () => {
    const cfg = loadS3Config();
    // Never send secret back to renderer — just signal if it's set
    return { region: cfg.region, bucket: cfg.bucket, accessKeyId: cfg.accessKeyId, hasSecret: !!cfg.secretAccessKey };
  });

  ipcMain.handle('s3:saveConfig', (_e, cfg) => {
    // cfg may omit secretAccessKey if user didn't re-enter it
    const existing = loadS3Config();
    const merged = { ...existing, ...cfg };
    if (!cfg.secretAccessKey) merged.secretAccessKey = existing.secretAccessKey;
    saveS3Config(merged);
    return true;
  });

  ipcMain.handle('s3:testConfig', async () => {
    const cfg = loadS3Config();
    if (!cfg?.accessKeyId) return { error: 'No S3 config saved' };
    try {
      const { HeadBucketCommand } = require('@aws-sdk/client-s3');
      await createS3Client(cfg).send(new HeadBucketCommand({ Bucket: cfg.bucket }));
      return { success: true };
    } catch (e) { return { error: e.message }; }
  });

  // ── User approval ─────────────────────────────────────────────────────────────

  ipcMain.handle('auth:checkApproval', async () => {
    if (!supabase || !currentUser) return { error: 'Not logged in' };
    const ADMIN_EMAIL = 'bakrferas@gmail.com';
    // Admin always approved — short-circuit before any DB call
    if (currentUser.email === ADMIN_EMAIL) return { approved: true };
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('approved')
        .eq('user_id', currentUser.id)
        .single();
      if (error?.code === 'PGRST116') {
        // Profile does not exist — create with approved=false
        await supabase.from('user_profiles').insert({
          user_id: currentUser.id,
          email: currentUser.email,
          approved: false,
        });
        return { approved: false };
      }
      if (error) return { error: error.message };
      return { approved: !!data.approved };
    } catch (e) { return { error: e.message }; }
  });

  // ── Marketplace ───────────────────────────────────────────────────────────────

  async function catalogCoverUrl(coverS3Key, cfg) {
    if (!coverS3Key || !cfg?.accessKeyId) return null;
    try {
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      return await getSignedUrl(
        createS3Client(cfg),
        new GetObjectCommand({ Bucket: cfg.bucket, Key: coverS3Key }),
        { expiresIn: 7200 }
      );
    } catch { return null; }
  }

  ipcMain.handle('catalog:getAll', async () => {
    if (!supabase) return { error: 'Supabase unavailable' };
    try {
      const { data: books, error } = await supabase
        .from('catalog').select('*')
        .order('series',       { ascending: true, nullsFirst: false })
        .order('series_order', { ascending: true, nullsFirst: true })
        .order('title',        { ascending: true });
      if (error) return { error: error.message };
      const cfg = loadS3Config();
      const result = await Promise.all(books.map(async b => ({
        ...b, coverUrl: await catalogCoverUrl(b.cover_s3_key, cfg),
      })));
      return { books: result };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('catalog:getUserLibrary', async () => {
    if (!supabase || !currentUser) return { error: 'Not logged in' };
    try {
      const { data: entries, error } = await supabase
        .from('user_library').select('book_id, added_at')
        .eq('user_id', currentUser.id);
      if (error) return { error: error.message };
      if (!entries.length) return { books: [] };

      const bookIds = entries.map(r => r.book_id);
      const { data: catBooks, error: bErr } = await supabase
        .from('catalog').select('*').in('id', bookIds);
      if (bErr) return { error: bErr.message };

      const cfg = loadS3Config();
      const result = await Promise.all(entries.map(async entry => {
        const cat = catBooks.find(b => b.id === entry.book_id);
        if (!cat) return null;
        const coverUrl = await catalogCoverUrl(cat.cover_s3_key, cfg);
        const chapters = (cat.chapters || []).map((ch, i) => ({
          id: i, filename: ch.filename,
          title: ch.title || `Chapter ${i + 1}`,
          duration: ch.duration || 0,
        }));
        return {
          id:           cat.id,
          title:        cat.title,
          author:       cat.author || '',
          series:       cat.series || null,
          seriesOrder:  cat.series_order || null,
          s3Prefix:     cat.s3_prefix,
          chapters,
          chapterCount: cat.chapter_count || chapters.length,
          coverUrl,     coverPath: null, folderPath: null,
          isCloudOnly:  true, isCatalog: true,
          addedAt:      entry.added_at,
          playback:     db.playback[cat.id] || null,
        };
      }));
      return { books: result.filter(Boolean) };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('catalog:addToLibrary', async (_e, { bookId }) => {
    if (!supabase || !currentUser) return { error: 'Not logged in' };
    try {
      const { data: existing } = await supabase
        .from('user_library').select('id')
        .eq('user_id', currentUser.id).eq('book_id', bookId).maybeSingle();
      if (existing) return { success: true, alreadyAdded: true };
      const { error } = await supabase.from('user_library').insert({
        user_id: currentUser.id, book_id: bookId,
      });
      if (error) return { error: error.message };
      return { success: true };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('catalog:removeFromLibrary', async (_e, { bookId }) => {
    if (!supabase || !currentUser) return { error: 'Not logged in' };
    try {
      const { error } = await supabase.from('user_library')
        .delete().eq('user_id', currentUser.id).eq('book_id', bookId);
      if (error) return { error: error.message };
      delete db.playback[bookId];
      delete db.bookmarks[bookId];
      saveDb();
      return { success: true };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('catalog:getPresignedUrl', async (_e, { s3Prefix, filename }) => {
    const cfg = loadS3Config();
    if (!cfg?.accessKeyId) return { error: 'S3 not configured' };
    try {
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      const url = await getSignedUrl(
        createS3Client(cfg),
        new GetObjectCommand({ Bucket: cfg.bucket, Key: `${s3Prefix}${filename}` }),
        { expiresIn: 3600 }
      );
      return { url };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('catalog:upload', async (event, args) => {
    // Receive as plain object to avoid any destructuring issues
    const title       = String(args.title       || '').trim();
    const author      = String(args.author      || '').trim() || null;
    const series      = String(args.series      || '').trim() || null;
    const seriesOrder = args.seriesOrder ? parseInt(String(args.seriesOrder), 10) : null;
    const coverPath   = args.coverPath   || null;
    const folderPath  = args.folderPath  || '';
    console.log('[catalog:upload] received:', JSON.stringify({ title, author, series, seriesOrder, folderPath }));

    if (!title) return { error: 'Title is required' };
    if (!supabase || !currentUser) return { error: 'Not logged in' };
    const cfg = loadS3Config();
    if (!cfg?.accessKeyId) return { error: 'S3 not configured' };

    const audioExts = new Set(['.mp3', '.mp4', '.m4b', '.m4a', '.aac', '.ogg', '.wav', '.flac', '.opus']);
    let files;
    try {
      files = fs.readdirSync(folderPath)
        .filter(f => audioExts.has(path.extname(f).toLowerCase()))
        .sort(naturalSort);
    } catch (e) { return { error: 'Cannot read folder: ' + e.message }; }
    if (!files.length) return { error: 'No audio files found in this folder.' };

    const { Upload } = require('@aws-sdk/lib-storage');
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const s3      = createS3Client(cfg);
    const bookId  = crypto.randomUUID();
    const s3Prefix = `catalog/${bookId}/`;

    event.sender.send('catalog:uploadProgress', { type: 'status', message: 'Starting upload…', progress: 0 });

    // Upload audio files
    for (let i = 0; i < files.length; i++) {
      const filename = files[i];
      event.sender.send('catalog:uploadProgress', {
        type: 'file', message: `Uploading ${filename}…`,
        fileIndex: i, fileCount: files.length,
        progress: Math.round(i / files.length * 88),
      });
      try {
        const uploader = new Upload({
          client: s3,
          params: { Bucket: cfg.bucket, Key: `${s3Prefix}${filename}`, Body: fs.createReadStream(path.join(folderPath, filename)) },
        });
        uploader.on('httpUploadProgress', ({ loaded, total: ft }) => {
          const fp = ft ? Math.round(loaded / ft * 100) : 0;
          event.sender.send('catalog:uploadProgress', {
            type: 'file', message: `Uploading ${filename}…`,
            fileIndex: i, fileCount: files.length,
            progress: Math.round((i + fp / 100) / files.length * 88),
          });
        });
        await uploader.done();
      } catch (e) { return { error: `Failed to upload ${filename}: ${e.message}` }; }
    }

    // Upload cover art
    let coverS3Key = null;
    if (coverPath && fs.existsSync(coverPath)) {
      const ext = path.extname(coverPath).slice(1).toLowerCase() || 'jpg';
      coverS3Key = `${s3Prefix}cover.${ext}`;
      event.sender.send('catalog:uploadProgress', { type: 'status', message: 'Uploading cover…', progress: 92 });
      try {
        await s3.send(new PutObjectCommand({
          Bucket: cfg.bucket, Key: coverS3Key,
          Body: fs.readFileSync(coverPath),
          ContentType: ext === 'png' ? 'image/png' : 'image/jpeg',
        }));
      } catch (e) { console.error('Cover upload failed:', e.message); coverS3Key = null; }
    }

    // Insert catalog row
    event.sender.send('catalog:uploadProgress', { type: 'status', message: 'Saving to marketplace…', progress: 97 });
    const chapters = files.map((filename, i) => ({ filename, title: chapterTitle(filename), duration: 0 }));
    const { error: insertErr } = await supabase.from('catalog').insert({
      id: bookId, s3_prefix: s3Prefix,
      title, author, series, series_order: seriesOrder,
      chapter_count: files.length, chapters,
      cover_s3_key: coverS3Key,
      uploaded_by: currentUser?.id || null,
    });
    if (insertErr) return { error: 'Failed to save book: ' + insertErr.message };

    event.sender.send('catalog:uploadProgress', { type: 'done', message: 'Upload complete!', progress: 100 });
    return { success: true, bookId, chapterCount: files.length };
  });

  ipcMain.handle('catalog:editBook', async (_e, { bookId, title, author, series, seriesOrder }) => {
    if (!supabase || !currentUser) return { error: 'Not authenticated' };
    const updates = {};
    if (title   !== undefined) updates.title        = String(title   || '').trim() || null;
    if (author  !== undefined) updates.author       = String(author  || '').trim() || null;
    if (series  !== undefined) updates.series       = String(series  || '').trim() || null;
    if (seriesOrder !== undefined) updates.series_order = seriesOrder ? parseInt(String(seriesOrder), 10) : null;
    if (!updates.title) return { error: 'Title is required' };
    const { error } = await supabase.from('catalog').update(updates).eq('id', bookId);
    if (error) return { error: error.message };
    return { success: true };
  });

  ipcMain.handle('catalog:deleteBook', async (_e, { bookId }) => {
    if (!supabase || !currentUser) return { error: 'Not authenticated' };
    try {
      // Fetch book to get s3_prefix
      const { data: book, error: fetchErr } = await supabase.from('catalog').select('s3_prefix').eq('id', bookId).single();
      if (fetchErr || !book) return { error: 'Book not found' };

      // Delete all S3 objects under the prefix
      const cfg = loadS3Config();
      if (cfg?.accessKeyId && book.s3_prefix) {
        const { ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
        const s3 = createS3Client(cfg);
        const listed = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: book.s3_prefix }));
        if (listed.Contents?.length) {
          await s3.send(new DeleteObjectsCommand({
            Bucket: cfg.bucket,
            Delete: { Objects: listed.Contents.map(o => ({ Key: o.Key })), Quiet: true },
          }));
        }
      }

      // Remove from user_library entries
      await supabase.from('user_library').delete().eq('book_id', bookId);
      // Delete catalog row
      const { error: delErr } = await supabase.from('catalog').delete().eq('id', bookId);
      if (delErr) return { error: delErr.message };
      return { success: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('s3:getPresignedUrl', async (_e, { bookId, chapterIndex }) => {
    const s3Key =
      db.books[bookId]?.cloudPaths?.[String(chapterIndex)] ||
      db.cloudBooks?.[bookId]?.cloudPaths?.[String(chapterIndex)] ||
      db.cloudBooks?.[bookId]?.chapters?.[chapterIndex]?.s3Key;
    if (!s3Key) return { error: 'No S3 path for this chapter' };
    const cfg = loadS3Config();
    if (!cfg?.accessKeyId) return { error: 'S3 not configured' };
    try {
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      const url = await getSignedUrl(
        createS3Client(cfg),
        new GetObjectCommand({ Bucket: cfg.bucket, Key: s3Key }),
        { expiresIn: 3600 }
      );
      return { url };
    } catch (e) { return { error: e.message }; }
  });

}
