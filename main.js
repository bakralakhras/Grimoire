const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');


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
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { console.error('Load error:', e); }
  return { books: {}, playback: {}, bookmarks: {} };
}

function saveDb() {
  try { fs.writeFileSync(dbPath(), JSON.stringify(db, null, 2)); }
  catch (e) { console.error('Save error:', e); }
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

function naturalSort(a, b) {
  const na = parseInt((a.match(/(\d+)/) || [0, 0])[1], 10);
  const nb = parseInt((b.match(/(\d+)/) || [0, 0])[1], 10);
  if (na !== nb) return na - nb;
  return a.localeCompare(b);
}

function bookTitle(folderPath) {
  return path.basename(folderPath)
    .replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '')
    .replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function chapterTitle(filename) {
  const ext = path.extname(filename);
  let name = filename.slice(0, filename.length - ext.length);
  name = name.replace(/^(chapter\s+)?\d+[\s\-_.]+/i, '');
  name = name.replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  return name || filename.replace(ext, '');
}

// ── App setup ────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  db = loadDb();
  createWindow();
  registerIPC();
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

  // Import folder
  ipcMain.handle('library:import', (_e, folderPath) => {
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

    const book = {
      id: bookId,
      title: bookTitle(folderPath),
      folderPath,
      chapterCount: files.length,
      addedAt: existing ? existing.addedAt : new Date().toISOString(),
      coverPath: existing?.coverPath || null,
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

    const transcriptsDir = path.join(app.getPath('userData'), 'transcripts');
    if (!fs.existsSync(transcriptsDir)) fs.mkdirSync(transcriptsDir, { recursive: true });

    const tmpDir = path.join(app.getPath('temp'), 'grimoire-transcribe');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const win = await getTranscribeWindow();

    return new Promise((resolve) => {
      const parts = [];

      const onProgress = (_e, data) => {
        if (data.bookId !== bookId) return;
        // Forward progress to the renderer that requested transcription
        event.sender.send('transcribe:progress', data);
        // Persist completed chapters immediately
        if (data.type === 'chapter') {
          const entry = `=== Chapter ${data.chapterIndex + 1}: ${data.chapterTitle} ===\n\n${data.text}`;
          parts[data.chapterIndex] = entry;
          fs.writeFileSync(path.join(transcriptsDir, `${bookId}_${data.chapterIndex}.txt`), entry, 'utf8');
        }
      };

      const onDone = (_e, { bookId: doneId, error }) => {
        if (doneId !== bookId) return;
        ipcMain.off('transcribe:progress', onProgress);
        ipcMain.off('transcribe:done', onDone);
        try { fs.rmdirSync(tmpDir); } catch {}
        if (error) { resolve({ error }); return; }
        const fullTranscript = parts.join('\n\n---\n\n');
        fs.writeFileSync(path.join(transcriptsDir, `${bookId}_full.txt`), fullTranscript, 'utf8');
        resolve(fullTranscript);
      };

      ipcMain.on('transcribe:progress', onProgress);
      ipcMain.on('transcribe:done', onDone);

      // Kick off work in the hidden Chromium window
      win.webContents.send('transcribe:start', {
        bookId, chapters: book.chapters, ffmpegPath, tmpDir,
      });
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

      const splitPoints = [];
      for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
        splitPoints.push((starts[i] + ends[i]) / 2);
      }

      let totalDuration = 0;
      const dm = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      if (dm) totalDuration = parseInt(dm[1]) * 3600 + parseInt(dm[2]) * 60 + parseFloat(dm[3]);

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

  // Update chapter duration (for accurate progress)
  ipcMain.handle('chapters:updateDuration', (_e, { bookId, chapterId, duration }) => {
    const book = db.books[bookId];
    if (book?.chapters?.[chapterId] !== undefined) {
      book.chapters[chapterId].duration = duration;
      saveDb();
    }
    return true;
  });
}
