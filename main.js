require('dotenv').config();
const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
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
const epubMemoryCache = new Map();
const smartSyncJobs = new Map();
const SMART_SYNC_MODEL = 'faster-whisper:base';
const SMART_SYNC_ALGORITHM_VERSION = 'smart-sync-v1';
const SMART_SYNC_ALIGNMENT_VERSION = 'alignment-stub-v1';

// ── Data persistence (JSON) ─────────────────────────────────────────────────

function dbPath() {
  return path.join(app.getPath('userData'), 'grimoire-data.json');
}

function loadDb() {
  try {
    const file = dbPath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { books: {}, playback: {}, bookmarks: {}, cloudBooks: {}, collections: {}, ...data };
    }
  } catch (e) { console.error('Load error:', e); }
  return { books: {}, playback: {}, bookmarks: {}, cloudBooks: {}, collections: {} };
}

function saveDb() {
  try { fs.writeFileSync(dbPath(), JSON.stringify(db, null, 2)); }
  catch (e) { console.error('Save error:', e); }
}

// ── Device downloads store (per-device, not synced to Supabase) ──────────────

function deviceDownloadsPath() {
  return path.join(app.getPath('userData'), 'device-downloads.json');
}

function loadDeviceDownloads() {
  try {
    const file = deviceDownloadsPath();
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  return {};
}

function saveDeviceDownloads(data) {
  try { fs.writeFileSync(deviceDownloadsPath(), JSON.stringify(data, null, 2)); } catch {}
}

function getDeviceDownload(bookId) {
  return loadDeviceDownloads()[String(bookId)] || null;
}

function setDeviceDownload(bookId, record) {
  const data = loadDeviceDownloads();
  data[String(bookId)] = record;
  saveDeviceDownloads(data);
}

function clearDeviceDownload(bookId) {
  const data = loadDeviceDownloads();
  delete data[String(bookId)];
  saveDeviceDownloads(data);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function collectionCoverRootDir() {
  return path.join(app.getPath('userData'), 'collection-covers');
}

function normalizeCollectionRecord(collection) {
  return {
    id: collection.id,
    name: collection.name || 'Untitled Collection',
    bookIds: Array.isArray(collection.bookIds) ? collection.bookIds.map(String) : [],
    coverPath: collection.coverPath || null,
    createdAt: collection.createdAt || new Date().toISOString(),
    updatedAt: collection.updatedAt || collection.createdAt || new Date().toISOString(),
  };
}

function collectionSort(a, b) {
  return String(a.name || '').localeCompare(String(b.name || '')) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
}

function saveCollectionRecord(collection) {
  const normalized = normalizeCollectionRecord(collection);
  db.collections[normalized.id] = normalized;
  saveDb();
  return normalized;
}

function removeCollectionCoverFile(collection) {
  const target = collection?.coverPath;
  if (!target) return;
  try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch {}
}

function managedLibraryRootDir() {
  return path.join(app.getPath('userData'), 'library');
}

function managedCatalogBookDir(bookId) {
  return path.join(managedLibraryRootDir(), String(bookId));
}

function catalogDownloadDir(bookId) {
  return path.join(app.getPath('userData'), 'Downloads', String(bookId));
}

function isPathInside(root, target) {
  try {
    const rel = path.relative(path.resolve(root), path.resolve(target));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

function isManagedCatalogBook(book, expectedBookId = null) {
  if (!book?.managedFolder) return false;
  const catalogId = String(book.sourceCatalogId || book.catalogId || book.id || '');
  if (!catalogId) return false;
  if (expectedBookId != null && catalogId !== String(expectedBookId)) return false;
  return isPathInside(managedLibraryRootDir(), book.folderPath || managedCatalogBookDir(catalogId));
}

function cleanupManagedCatalogBookFiles(bookId, book = db?.books?.[bookId]) {
  const managedDir = managedCatalogBookDir(bookId);
  if (fs.existsSync(managedDir) && isPathInside(managedLibraryRootDir(), managedDir)) {
    try { fs.rmSync(managedDir, { recursive: true, force: true }); } catch {}
  }

  const epubPath = path.join(app.getPath('userData'), 'epubs', `${bookId}.epub`);
  const epubCache = path.join(app.getPath('userData'), 'epub-cache', `${bookId}.json`);
  try { if (fs.existsSync(epubPath)) fs.unlinkSync(epubPath); } catch {}
  try { if (fs.existsSync(epubCache)) fs.unlinkSync(epubCache); } catch {}
}

function deleteBookRecord(bookId, { cleanupManaged = false } = {}) {
  const book = db.books[bookId];
  if (cleanupManaged) cleanupManagedCatalogBookFiles(bookId, book);
  delete db.books[bookId];
  delete db.playback[bookId];
  delete db.bookmarks[bookId];
  for (const [collectionId, collection] of Object.entries(db.collections || {})) {
    if (!Array.isArray(collection?.bookIds)) continue;
    db.collections[collectionId].bookIds = collection.bookIds.filter(id => String(id) !== String(bookId));
  }
  saveDb();
  return true;
}

function safeReadJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function safeReadText(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

function safeWriteJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function transcriptRootDir() {
  return path.join(app.getPath('userData'), 'transcripts');
}

function transcriptCachePaths(bookId) {
  const dir = path.join(transcriptRootDir(), String(bookId));
  return {
    dir,
    transcript: path.join(dir, 'transcript.txt'),
    words: path.join(dir, 'words.json'),
    alignment: path.join(dir, 'alignment.json'),
    meta: path.join(dir, 'meta.json'),
    temp: path.join(dir, '.tmp'),
  };
}

function legacyTranscriptPaths(bookId) {
  const root = transcriptRootDir();
  return {
    transcript: path.join(root, `${bookId}_full.txt`),
    words: path.join(root, `${bookId}_words.json`),
  };
}

function statSignature(file) {
  try {
    const st = fs.statSync(file);
    return {
      path: path.resolve(file),
      size: st.size,
      mtimeMs: Math.round(st.mtimeMs),
    };
  } catch {
    return {
      path: path.resolve(file),
      missing: true,
    };
  }
}

function audioInvalidationSignature(book) {
  const hash = crypto.createHash('sha1');
  hash.update(JSON.stringify({
    bookId: book?.id || null,
    chapterCount: book?.chapterCount || book?.chapters?.length || 0,
    chapters: (book?.chapters || []).map((ch, i) => ({
      index: i,
      title: ch?.title || '',
      file: statSignature(ch?.filepath || ''),
    })),
  }));
  return hash.digest('hex');
}

function epubInvalidationSignature(book) {
  if (!book?.epubPath && !book?.epubKey) return null;
  const hash = crypto.createHash('sha1');
  hash.update(JSON.stringify({
    epubPath: book?.epubPath ? statSignature(book.epubPath) : null,
    epubKey: book?.epubKey || null,
  }));
  return hash.digest('hex');
}

function orderedChapterFilenames(chapters = []) {
  return (chapters || []).map(ch => String(ch?.filename || '').trim()).filter(Boolean);
}

function catalogStructureHashFromParts({ s3Prefix = null, chapterCount = 0, filenames = [] } = {}) {
  const raw = JSON.stringify({
    s3Prefix: s3Prefix || '',
    chapterCount: Number(chapterCount) || 0,
    filenames: filenames.map(name => String(name || '').trim()),
  });
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `struct-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function catalogStructurePayload({ s3Prefix = null, chapters = [], chapterCount = null, updatedAt = null } = {}) {
  const normalizedChapters = (chapters || []).map((chapter, index) => ({
    filename: String(chapter?.filename || '').trim(),
    title: String(chapter?.title || chapterTitle(chapter?.filename || `Chapter ${index + 1}`)),
    duration: normalizeOptionalNumber(chapter?.duration) ?? 0,
  })).filter(chapter => chapter.filename);
  const normalizedChapterCount = normalizeOptionalNumber(chapterCount) ?? normalizedChapters.length;
  return {
    updatedAt: updatedAt || new Date().toISOString(),
    s3Prefix: s3Prefix || null,
    chapterCount: normalizedChapterCount,
    chapters: normalizedChapters,
    filenames: orderedChapterFilenames(normalizedChapters),
    structureHash: catalogStructureHashFromParts({
      s3Prefix,
      chapterCount: normalizedChapterCount,
      filenames: orderedChapterFilenames(normalizedChapters),
    }),
  };
}

function catalogStructureFromRow(row = {}) {
  const payload = catalogStructurePayload({
    s3Prefix: row?.s3_prefix || row?.s3Prefix || null,
    chapterCount: row?.chapter_count ?? row?.chapterCount ?? null,
    chapters: row?.chapters || [],
    updatedAt: row?.updated_at || row?.updatedAt || null,
  });
  return {
    ...payload,
    structureHash: row?.structure_hash || row?.structureHash || payload.structureHash,
  };
}

function catalogDownloadRecordIsCurrent(record, catalogRow) {
  if (!record || !catalogRow) return false;
  const structure = catalogStructureFromRow(catalogRow);
  const storedFilenames = (record.chapter_filenames || []).map(name => String(name || '').trim()).filter(Boolean);
  return !!record.local_path
    && (record.structure_hash || null) === (structure.structureHash || null)
    && (record.s3_prefix || null) === (structure.s3Prefix || null)
    && Number(record.chapter_count || 0) === Number(structure.chapterCount || 0)
    && storedFilenames.length === structure.filenames.length
    && storedFilenames.every((filename, index) => filename === structure.filenames[index]);
}

function buildSmartSyncMeta(book, overrides = {}) {
  const now = new Date().toISOString();
  return {
    bookId: book.id,
    audioSignature: audioInvalidationSignature(book),
    epubSignature: epubInvalidationSignature(book),
    model: SMART_SYNC_MODEL,
    modelName: SMART_SYNC_MODEL,
    algorithmVersion: SMART_SYNC_ALGORITHM_VERSION,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    transcriptComplete: false,
    alignmentComplete: false,
    alignmentStatus: 'pending',
    ...overrides,
  };
}

function moveIfPossible(src, dest) {
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dest)) return true;
  try {
    fs.renameSync(src, dest);
    return true;
  } catch {
    try {
      fs.copyFileSync(src, dest);
      return true;
    } catch {
      return false;
    }
  }
}

function migrateLegacyTranscriptCache(book) {
  const bookId = book?.id || book;
  const paths = transcriptCachePaths(bookId);
  const legacy = legacyTranscriptPaths(bookId);
  const legacyExists = fs.existsSync(legacy.transcript) || fs.existsSync(legacy.words);
  if (!legacyExists) return false;

  ensureDir(transcriptRootDir());
  ensureDir(paths.dir);

  const movedTranscript = moveIfPossible(legacy.transcript, paths.transcript);
  const movedWords = moveIfPossible(legacy.words, paths.words);
  const transcriptExists = fs.existsSync(paths.transcript);
  const wordsExists = fs.existsSync(paths.words);
  if (!transcriptExists && !wordsExists) return false;

  if (!fs.existsSync(paths.alignment)) {
    safeWriteJson(paths.alignment, {
      status: 'stub',
      version: SMART_SYNC_ALIGNMENT_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      segments: [],
    });
  }

  const meta = safeReadJson(paths.meta) || buildSmartSyncMeta(
    typeof book === 'object' ? book : { id: bookId, chapters: [] },
    {
      transcriptComplete: transcriptExists || wordsExists,
      alignmentComplete: false,
      alignmentStatus: 'stub',
    }
  );
  safeWriteJson(paths.meta, meta);

  if (movedTranscript && fs.existsSync(legacy.transcript)) {
    try { fs.unlinkSync(legacy.transcript); } catch {}
  }
  if (movedWords && fs.existsSync(legacy.words)) {
    try { fs.unlinkSync(legacy.words); } catch {}
  }
  return true;
}

function readTranscriptCache(book) {
  migrateLegacyTranscriptCache(book);
  const paths = transcriptCachePaths(book.id);
  return {
    paths,
    transcript: safeReadText(paths.transcript),
    words: safeReadJson(paths.words),
    alignment: safeReadJson(paths.alignment),
    meta: safeReadJson(paths.meta),
  };
}

function isSmartSyncCacheValid(book, cache) {
  const meta = cache?.meta;
  if (!meta) return false;
  if (!meta.transcriptComplete) return false;
  if (!cache.transcript && !cache.words) return false;
  if ((meta.bookId || '') !== String(book.id)) return false;
  if ((meta.audioSignature || '') !== audioInvalidationSignature(book)) return false;
  if ((meta.epubSignature || null) !== epubInvalidationSignature(book)) return false;
  if ((meta.modelName || '') !== SMART_SYNC_MODEL) return false;
  if ((meta.algorithmVersion || '') !== SMART_SYNC_ALGORITHM_VERSION) return false;
  return true;
}

function publicJobState(job) {
  if (!job) return null;
  return {
    bookId: job.bookId,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    error: job.error || null,
    pid: job.pid || null,
    cacheHit: !!job.cacheHit,
  };
}

async function resolveAudioBook(bookId, { requireSingleFile = false } = {}) {
  const localBook = db.books[bookId];
  if (localBook) {
    if (requireSingleFile && localBook.chapters?.length !== 1) {
      return { error: 'Book must have exactly one file' };
    }
    return { book: localBook, source: 'library' };
  }

  const download = getDeviceDownload(bookId);
  const localPath = download?.local_path;
  if (!localPath || !fs.existsSync(localPath)) {
    return { error: 'Book not found' };
  }

  if (!supabase) {
    return { error: 'Catalog metadata unavailable' };
  }

  let catBook;
  try {
    const { data, error } = await supabase
      .from('catalog')
      .select('*')
      .eq('id', bookId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Catalog book not found');
    catBook = data;
  } catch (error) {
    return { error: error.message || 'Catalog book not found' };
  }

  const chapters = (catBook.chapters || []).map((ch, i) => ({
    id: i,
    filename: ch.filename,
    filepath: path.join(localPath, ch.filename),
    title: ch.title || `Chapter ${i + 1}`,
    duration: ch.duration || 0,
  }));

  if (requireSingleFile && chapters.length !== 1) {
    return { error: 'Book must have exactly one file' };
  }

  return {
    source: 'catalog-download',
    book: {
      id: catBook.id,
      title: catBook.title,
      author: catBook.author || '',
      folderPath: localPath,
      localPath,
      chapterCount: catBook.chapter_count || chapters.length,
      chapters,
      sourceCatalogId: catBook.id,
      isCatalog: true,
      downloadedLocally: true,
    },
    catalog: catBook,
    download,
  };
}

function sendTranscribeProgress(payload) {
  mainWindow?.webContents.send('transcribe:progress', {
    timestamp: new Date().toISOString(),
    ...payload,
  });
}

function updateSmartSyncJob(job, patch = {}) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  smartSyncJobs.set(job.bookId, job);
  if (patch.event) {
    sendTranscribeProgress({
      bookId: job.bookId,
      event: patch.event,
      status: job.status,
      stage: job.stage,
      progress: job.progress || null,
      error: job.error || null,
      payload: patch.payload || null,
    });
  }
  return job;
}

// ── Debug logging ─────────────────────────────────────────────────────────────

const LOG_TAG = '[Grimoire]';
let _logStream = null;
function _getLogStream() {
  if (_logStream) return _logStream;
  try {
    const logPath = path.join(app.getPath('userData'), 'grimoire-debug.log');
    _logStream = fs.createWriteStream(logPath, { flags: 'a' });
  } catch {}
  return _logStream;
}
function dbg(...args) {
  const line = `${new Date().toISOString()} ${LOG_TAG} ${args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`;
  console.log(line);
  try { _getLogStream()?.write(line + '\n'); } catch {}
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

const COMMENT_TEXT_COLUMNS = ['comment_text', 'text', 'content', 'body', 'comment'];
const REPLY_TEXT_COLUMNS = ['reply_text', 'text', 'content', 'body', 'reply'];
const COMMENT_SELECTION_COLUMNS = [
  { text: 'selected_text', chapter: 'epub_chapter_index', paragraph: 'epub_paragraph_index' },
  { text: 'epub_selected_text', chapter: 'epub_chapter_index', paragraph: 'epub_paragraph_index' },
  { text: 'selection_text', chapter: 'selection_chapter_index', paragraph: 'selection_paragraph_index' },
];

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
    if (!fs.existsSync(sessionFilePath())) {
      dbg('loadSession: no saved session file');
      return null;
    }
    const { access_token, refresh_token } = JSON.parse(fs.readFileSync(sessionFilePath(), 'utf8'));
    const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error || !data?.session) {
      dbg('loadSession: session restore failed -', error?.message);
      clearSession();
      return null;
    }
    currentUser = await hydrateAuthUser(data.session.user);
    dbg('loadSession: restored session | userId =', currentUser?.id, '| username =', currentUser?.username);
    saveSession(data.session);
    fetchAndCacheS3Config().catch(() => {});
    return data.session;
  } catch (e) {
    dbg('loadSession: exception -', e.message);
    clearSession();
    return null;
  }
}

function normalizeUsername(value) {
  return String(value || '').trim();
}

function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!username) return { error: 'Username is required.' };
  if (username.length < 3) return { error: 'Username must be at least 3 characters.' };
  if (username.length > 32) return { error: 'Username must be 32 characters or fewer.' };
  if (!/^[A-Za-z0-9._-]+$/.test(username)) {
    return { error: 'Username can only use letters, numbers, dots, underscores, and hyphens.' };
  }
  return { value: username };
}

function usernameFromEmail(email) {
  const local = String(email || 'user').split('@')[0] || 'user';
  const sanitized = local.replace(/[^A-Za-z0-9._-]+/g, '').slice(0, 24);
  return sanitized || 'user';
}

function internalEmailForUsername(username) {
  return `${String(username || '').toLowerCase()}@grimoire.local`;
}

function publicUser(user = currentUser) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    username: user.username || usernameFromEmail(user.email),
  };
}

async function getUserProfileByUserId(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, email, username')
    .eq('id', userId)
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] || null;
}

async function getUserProfileByUsername(username) {
  if (!supabase || !username) return null;
  const { value, error: usernameError } = validateUsername(username);
  if (usernameError) return null;

  const direct = await supabase
    .from('user_profiles')
    .select('id, email, username')
    .ilike('username', value)
    .limit(1);
  if (direct.error) throw new Error(direct.error.message);
  if (direct.data?.[0]) return direct.data[0];

  const legacy = await supabase
    .from('user_profiles')
    .select('id, email, username')
    .ilike('email', `${value}@%`)
    .limit(1);
  if (legacy.error) throw new Error(legacy.error.message);
  return legacy.data?.[0] || null;
}

async function ensureUniqueUsername(baseUsername, excludeUserId = null) {
  const seed = normalizeUsername(baseUsername).replace(/[^A-Za-z0-9._-]+/g, '') || 'user';
  const base = seed.slice(0, 24);
  for (let i = 0; i < 100; i++) {
    const suffix = i === 0 ? '' : String(i + 1);
    const candidate = `${base}${suffix}`.slice(0, 32);
    const existing = await getUserProfileByUsername(candidate);
    if (!existing || existing.id === excludeUserId) return candidate;
  }
  return `user${Date.now()}`.slice(0, 32);
}

async function upsertUserProfile({ userId, email, username }) {
  if (!supabase) throw new Error('Sync unavailable');
  const { data, error } = await supabase
    .from('user_profiles')
    .upsert({
      id: userId,
      email,
      username,
    }, { onConflict: 'id' })
    .select('id, email, username')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function hydrateAuthUser(user, preferredUsername = null) {
  if (!user) return null;

  let profile = null;
  try {
    profile = await getUserProfileByUserId(user.id);
  } catch (error) {
    console.warn('Profile lookup failed:', error.message);
  }

  let username = profile?.username || preferredUsername || null;
  if (!profile) {
    try {
      profile = await upsertUserProfile({
        userId: user.id,
        email: user.email,
        username: preferredUsername || null,
      });
      username = profile?.username || preferredUsername || null;
    } catch (error) {
      console.warn('Profile upsert failed:', error.message);
    }
  }

  currentUser = {
    ...user,
    username: username || usernameFromEmail(user.email),
  };
  return currentUser;
}

function firstPresent(row, keys) {
  for (const key of keys) {
    if (row?.[key] != null && row[key] !== '') return row[key];
  }
  return null;
}

function normalizeOptionalNumber(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function fetchProfilesByIds(userIds) {
  const ids = Array.from(new Set((userIds || []).filter(Boolean)));
  if (!supabase || !ids.length) return new Map();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, email, username')
    .in('id', ids);
  if (error) throw new Error(error.message);
  return new Map((data || []).map(profile => [profile.id, profile]));
}

function normalizeReplyRow(row, profiles) {
  const userId = row?.user_id || null;
  const profile = profiles.get(userId) || null;
  return {
    id: row.id,
    commentId: row.comment_id,
    userId,
    username: profile?.username || usernameFromEmail(profile?.email),
    text: String(firstPresent(row, REPLY_TEXT_COLUMNS) || ''),
    createdAt: row.created_at || new Date().toISOString(),
  };
}

function normalizeCommentRow(row, profiles, repliesByComment) {
  const userId = row?.user_id || null;
  const profile = profiles.get(userId) || null;
  const selection = COMMENT_SELECTION_COLUMNS.find(columns => row?.[columns.text] != null) || null;
  return {
    id: row.id,
    bookId: row.book_id,
    chapterIndex: normalizeOptionalNumber(row.chapter_index) ?? 0,
    audioTimestampSeconds: normalizeOptionalNumber(row.audio_timestamp_seconds) ?? 0,
    userId,
    username: profile?.username || row?.username || usernameFromEmail(profile?.email) || 'Unknown',
    text: String(firstPresent(row, COMMENT_TEXT_COLUMNS) || ''),
    createdAt: row.created_at || new Date().toISOString(),
    selectedText: selection ? row[selection.text] : null,
    epubChapterIndex: selection ? normalizeOptionalNumber(row[selection.chapter]) : null,
    epubParagraphIndex: selection ? normalizeOptionalNumber(row[selection.paragraph]) : null,
    replies: repliesByComment.get(row.id) || [],
  };
}

function isUnknownColumnError(error) {
  const message = String(error?.message || '');
  return /column|schema cache|does not exist|Could not find/.test(message);
}

async function insertWithVariants(table, variants) {
  let lastError = null;
  for (const row of variants) {
    const { data, error } = await supabase.from(table).insert(row).select('*').single();
    if (!error) return data;
    lastError = error;
    if (!isUnknownColumnError(error)) break;
  }
  throw new Error(lastError?.message || `Failed to insert into ${table}.`);
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

function progressTimestamp(value) {
  const ts = new Date(value || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function normalizeProgressRecord(record, fallbackBookId = null) {
  if (!record) return null;

  const bookId = String(record.book_id ?? record.bookId ?? fallbackBookId ?? '');
  if (!bookId) return null;

  return {
    bookId,
    chapterIndex: normalizeOptionalNumber(record.chapter_index ?? record.chapterIndex) ?? 0,
    position: normalizeOptionalNumber(record.position) ?? 0,
    speed: normalizeOptionalNumber(record.speed) ?? 1,
    updatedAt: record.updated_at || record.updatedAt || new Date(0).toISOString(),
  };
}

function chooseNewestProgress(localRecord, remoteRecord) {
  const local = normalizeProgressRecord(localRecord);
  const remote = normalizeProgressRecord(remoteRecord, local?.bookId);
  if (!local) return remote;
  if (!remote) return local;
  return progressTimestamp(local.updatedAt) >= progressTimestamp(remote.updatedAt) ? local : remote;
}

async function doSync(op) {
  try {
    if (op.type === 'progress') {
      const { error } = await supabase.from('progress').upsert({
        user_id: currentUser.id, book_id: op.bookId, book_title: op.bookTitle || '',
        chapter_index: op.chapterIndex, position: op.position, speed: op.speed,
        updated_at: op.updatedAt || new Date().toISOString(),
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

// ── Catalog cover cache (download once via Node, serve as local path) ─────────

function catalogCoverCacheDir() { return path.join(app.getPath('userData'), 'catalog-covers'); }

function catalogCoverCachePath(bookId) {
  return path.join(catalogCoverCacheDir(), `${bookId}.jpg`);
}

// Generate a presigned/signed URL for a catalog S3 object.
// Primary: Supabase Storage (uses auth JWT, no IAM creds needed in packaged exe).
// Fallback: AWS SDK presigned URL (needs valid credentials in s3-config.json or hardcoded).
async function catalogSignedUrl(bucket, s3Key, expiresIn) {
  if (supabase && bucket && s3Key) {
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(s3Key, expiresIn);
      if (!error && data?.signedUrl) {
        dbg('catalogSignedUrl: Supabase Storage OK | key =', s3Key);
        return data.signedUrl;
      }
      dbg('catalogSignedUrl: Supabase Storage failed | key =', s3Key, '| error =', error?.message);
    } catch (e) {
      dbg('catalogSignedUrl: Supabase Storage exception | key =', s3Key, '| error =', e.message);
    }
  }
  const cfg = loadS3Config();
  if (!cfg?.accessKeyId) throw new Error('S3 not configured and Supabase Storage unavailable');
  dbg('catalogSignedUrl: AWS SDK fallback | key =', s3Key, '| accessKeyId =', cfg.accessKeyId);
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const url = await getSignedUrl(
    createS3Client(cfg),
    new GetObjectCommand({ Bucket: cfg.bucket, Key: s3Key }),
    { expiresIn }
  );
  dbg('catalogSignedUrl: AWS SDK URL generated (first 80) =', url.slice(0, 80));
  return url;
}

// Returns a local file path to the cover, downloading it if not cached yet.
// Cover art is always public: https://grimoire-library.s3.us-east-1.amazonaws.com/catalog/{id}/cover.jpg
async function resolveCoverPath(bookId) {
  if (!bookId) return null;
  const cachePath = catalogCoverCachePath(bookId);
  if (fs.existsSync(cachePath)) {
    dbg('resolveCoverPath: cache hit | bookId =', bookId);
    return cachePath;
  }
  try {
    ensureDir(catalogCoverCacheDir());
    const publicUrl = `https://grimoire-library.s3.us-east-1.amazonaws.com/catalog/${bookId}/cover.jpg`;
    dbg('resolveCoverPath: downloading cover | bookId =', bookId);
    await downloadToFile(publicUrl, cachePath);
    dbg('resolveCoverPath: cover cached at', cachePath);
    return cachePath;
  } catch (e) {
    dbg('resolveCoverPath: failed -', e.message);
    return null;
  }
}

// ── S3 helpers ────────────────────────────────────────────────────────────────

function s3ConfigPath() { return path.join(app.getPath('userData'), 's3-config.json'); }

function loadS3Config() {
  // Start with file config as a base (may be stale/old)
  let fileCfg = {};
  try {
    if (fs.existsSync(s3ConfigPath())) {
      fileCfg = JSON.parse(fs.readFileSync(s3ConfigPath(), 'utf8'));
      dbg('loadS3Config: read file config | accessKeyId =', fileCfg.accessKeyId);
    }
  } catch (e) {
    dbg('loadS3Config: file read error -', e.message);
  }

  // Env vars always override the saved file — this is the authoritative source
  const cfg = {
    region:          process.env.AWS_REGION          || fileCfg.region          || 'us-east-1',
    bucket:          process.env.AWS_BUCKET          || fileCfg.bucket          || 'grimoire-library',
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID   || fileCfg.accessKeyId,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || fileCfg.secretAccessKey,
  };

  const source = process.env.AWS_ACCESS_KEY_ID ? 'env (.env file)' : (fileCfg.accessKeyId ? 'file (s3-config.json)' : 'none');
  dbg('loadS3Config: source =', source, '| accessKeyId =', cfg.accessKeyId, '| bucket =', cfg.bucket, '| region =', cfg.region);
  return cfg;
}

function saveS3Config(cfg) {
  try { fs.writeFileSync(s3ConfigPath(), JSON.stringify(cfg, null, 2), 'utf8'); } catch {}
}

async function pushS3ConfigToSupabase(cfg) {
  if (!supabase || !currentUser) return;
  try {
    await supabase.from('app_config').upsert(
      { key: 'aws_s3_config', value: cfg, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    dbg('pushS3ConfigToSupabase: synced');
  } catch (e) {
    dbg('pushS3ConfigToSupabase: error -', e.message);
  }
}

async function fetchAndCacheS3Config() {
  if (!supabase) return;
  const existing = loadS3Config();
  if (existing?.accessKeyId) return; // already have local creds
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'aws_s3_config')
      .maybeSingle();
    if (error || !data?.value) return;
    saveS3Config(data.value);
    dbg('fetchAndCacheS3Config: cached from Supabase');
  } catch (e) {
    dbg('fetchAndCacheS3Config: error -', e.message);
  }
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

async function buildEmbeddedChapters(filePath, existingChapters = []) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (!['.mp4', '.m4a', '.m4b'].includes(ext)) return null;
  try {
    const mm = require('music-metadata');
    const meta = await mm.parseFile(filePath, {
      skipCovers: true,
      duration: true,
      includeChapters: true,
    });
    const embedded = Array.isArray(meta?.format?.chapters) ? meta.format.chapters : [];
    const sampleRate = Number(meta?.format?.sampleRate) || 0;
    if (embedded.length <= 1 || sampleRate <= 0) return null;
    const totalDuration = Number(meta?.format?.duration) || 0;
    return embedded.map((chapter, index) => {
      const startTime = Math.max(0, Number(chapter.sampleOffset) / sampleRate);
      const next = embedded[index + 1];
      const endTime = next
        ? Math.max(startTime, Number(next.sampleOffset) / sampleRate)
        : Math.max(startTime, totalDuration);
      return {
        id: index,
        filename: path.basename(filePath),
        filepath: filePath,
        title: String(chapter.title || existingChapters[index]?.title || `Chapter ${index + 1}`),
        startTime,
        endTime,
        duration: Math.max(0, endTime - startTime),
      };
    });
  } catch (error) {
    console.warn('Embedded chapter parsing skipped:', error.message);
    return null;
  }
}

// ── EPUB helpers ─────────────────────────────────────────────────────────────

function probeContentLength(url, redirectsLeft = 5) {
  return new Promise(resolve => {
    if (!url || redirectsLeft < 0) { resolve(0); return; }
    const https = require('https');
    const http  = require('http');
    const mod   = url.startsWith('https') ? https : http;
    const req = mod.request(url, { method: 'HEAD' }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const next = res.headers.location;
        res.resume();
        if (!next) { resolve(0); return; }
        probeContentLength(next, redirectsLeft - 1).then(resolve);
        return;
      }
      const total = Math.max(0, Number(res.headers['content-length']) || 0);
      res.resume();
      resolve(total);
    });
    req.on('error', () => resolve(0));
    req.end();
  });
}

function downloadToFile(url, dest, opts = {}) {
  const { onProgress } = opts;
  return new Promise((resolve, reject) => {
    const https = require('https');
    const http  = require('http');
    const mod   = url.startsWith('https') ? https : http;
    ensureDir(path.dirname(dest));
    // Log first ~80 chars of URL (host + path prefix) for diagnostics
    const urlPreview = url.replace(/X-Amz-[^&]+/g, '…').slice(0, 120);
    dbg('downloadToFile: GET', urlPreview);
    const file  = fs.createWriteStream(dest);
    mod.get(url, res => {
      dbg('downloadToFile: status', res.statusCode, 'dest =', path.basename(dest));
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        downloadToFile(res.headers.location, dest, opts).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        // Capture error body for diagnostics (S3 returns XML with error code/message)
        let body = '';
        res.on('data', chunk => { body += chunk.toString(); });
        res.on('end', () => {
          file.close();
          try { fs.unlinkSync(dest); } catch {}
          const brief = body.slice(0, 400);
          dbg('downloadToFile: error body =', brief);
          reject(new Error(`Download failed with status ${res.statusCode} — ${brief}`));
        });
        res.on('error', err => { file.close(); try { fs.unlinkSync(dest); } catch {} reject(err); });
        return;
      }
      const total = Math.max(0, Number(res.headers['content-length']) || 0);
      let loaded = 0;
      if (onProgress) onProgress({ loaded, total });
      res.on('data', chunk => {
        loaded += chunk.length;
        if (onProgress) onProgress({ loaded, total });
      });
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', err => { try { fs.unlinkSync(dest); } catch {} reject(err); });
    }).on('error', err => { dbg('downloadToFile: net error', err.message); try { fs.unlinkSync(dest); } catch {} reject(err); });
  });
}

function decodeEpubEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, '\u00a0').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function extractEpubParagraphs(html) {
  html = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  const paras = [];
  const re = /<(p|h[1-6]|li|blockquote|td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = decodeEpubEntities(m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (text.length > 8) paras.push(text);
  }
  if (!paras.length) {
    decodeEpubEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      .split(/\n\n+/).map(s => s.trim()).filter(s => s.length > 8).forEach(p => paras.push(p));
  }
  return paras;
}

async function parseEpubFile(epubPath) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(epubPath));

  const containerEntry = zip.file('META-INF/container.xml');
  if (!containerEntry) throw new Error('Not a valid EPUB: missing container.xml');
  const containerXml = await containerEntry.async('string');

  const opfMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!opfMatch) throw new Error('Cannot find OPF path');
  const opfPath = opfMatch[1];
  const opfDir  = opfPath.includes('/') ? opfPath.split('/').slice(0, -1).join('/') : '';

  const opfEntry = zip.file(opfPath);
  if (!opfEntry) throw new Error('Cannot find OPF file: ' + opfPath);
  const opfXml = await opfEntry.async('string');

  // Build manifest id → href
  const manifest = {};
  let mm;
  const maniRe = /<item\b[^>]*>/gi;
  while ((mm = maniRe.exec(opfXml)) !== null) {
    const id   = mm[0].match(/\bid="([^"]+)"/)?.[1];
    const href = mm[0].match(/\bhref="([^"]+)"/)?.[1];
    if (id && href) manifest[id] = href;
  }

  // Spine order
  const spineIds = [];
  const spineRe = /<itemref\b[^>]*idref="([^"]+)"/gi;
  while ((mm = spineRe.exec(opfXml)) !== null) spineIds.push(mm[1]);

  const results = await Promise.all(spineIds.map(async id => {
    const href = manifest[id];
    if (!href) return null;
    // Resolve path within zip
    const parts = (opfDir ? opfDir + '/' + href : href).split('/').reduce((acc, p) => {
      if (p === '..') acc.pop(); else if (p !== '.') acc.push(p);
      return acc;
    }, []);
    const filePath = parts.join('/');
    const entry = zip.file(filePath) || zip.file(href);
    if (!entry) return null;
    try {
      const html = await entry.async('string');
      const paragraphs = extractEpubParagraphs(html);
      if (!paragraphs.length) return null;
      const title = (
        html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ||
        html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g,'')?.trim() ||
        html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]?.replace(/<[^>]+>/g,'')?.trim() ||
        ''
      );
      return { title: decodeEpubEntities(title), paragraphs };
    } catch { return null; }
  }));

  return results.filter(Boolean);
}

function chunkArray(items, parts) {
  if (!Array.isArray(items) || !items.length || parts <= 0) return [];
  const out = [];
  for (let i = 0; i < parts; i++) {
    const start = Math.floor(i * items.length / parts);
    const end = Math.floor((i + 1) * items.length / parts);
    out.push(items.slice(start, end));
  }
  return out;
}

function chunkParagraphs(paragraphs, parts) {
  return chunkArray(paragraphs.filter(Boolean), Math.max(1, parts))
    .filter(group => group.length > 0);
}

function normalizeChapterMatchText(value, bookTitle = '') {
  let text = String(value || '').toLowerCase().replace(/&[^;\s]+;/g, ' ');
  text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (bookTitle) {
    const normBook = String(bookTitle).toLowerCase().replace(/[^a-z0-9]/g, '');
    const normText = text.replace(/[^a-z0-9]/g, '');
    if (normBook && normText.startsWith(normBook)) {
      let matched = 0;
      let i = 0;
      while (i < text.length && matched < normBook.length) {
        if (/[a-z0-9]/i.test(text[i])) matched++;
        i++;
      }
      while (i < text.length && /[\s\-_:.,]/.test(text[i])) i++;
      text = text.slice(i).trim();
    }
  }
  return text.replace(/[^a-z0-9]+/g, '');
}

function romanToInt(value) {
  const roman = String(value || '').toUpperCase();
  if (!/^[IVXLCDM]+$/.test(roman)) return null;
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  let prev = 0;
  for (let i = roman.length - 1; i >= 0; i--) {
    const cur = map[roman[i]] || 0;
    total += cur < prev ? -cur : cur;
    prev = cur;
  }
  return total || null;
}

function wordToInt(value) {
  const words = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
    twentyone: 21, twentytwo: 22, twentythree: 23, twentyfour: 24, twentyfive: 25,
    twentysix: 26, twentyseven: 27, twentyeight: 28, twentynine: 29, thirty: 30,
  };
  const key = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  return words[key] || null;
}

function extractChapterNumber(value) {
  if (!value) return null;
  const arabic = String(value).match(/\d{1,4}/);
  if (arabic) return parseInt(arabic[0], 10);
  const roman = String(value).match(/\b([ivxlcdm]+)\b/i);
  if (roman) return romanToInt(roman[1]);
  const word = String(value).match(/\b([a-z]+(?:[\s-][a-z]+)?)\b/i);
  if (word) return wordToInt(word[1]);
  return null;
}

function buildChapterMatchMeta(title = '', paragraphs = [], bookTitle = '') {
  const textCandidates = [
    String(title || '').trim(),
    String(paragraphs?.[0] || '').trim(),
    String(paragraphs?.find(p => /\b(?:prologue|epilogue|chapter|part|ch\.)\b/i.test(p)) || '').trim(),
  ].filter(Boolean);
  const first = textCandidates[0] || '';
  const joined = textCandidates.join(' ');
  const lower = joined.toLowerCase();
  const key = normalizeChapterMatchText(first || joined, bookTitle);

  if (/\bprologue\b/i.test(lower)) {
    return { kind: 'prologue', number: 0, key: key || 'prologue' };
  }
  if (/\bepilogue\b/i.test(lower)) {
    return { kind: 'epilogue', number: Number.MAX_SAFE_INTEGER, key: key || 'epilogue' };
  }

  const chapterLike = joined.match(/\b(chapter|ch\.|part)\s+([a-z0-9ivxlcdm-]+)/i);
  if (chapterLike) {
    const number = extractChapterNumber(chapterLike[2]);
    if (number != null) {
      return { kind: chapterLike[1].toLowerCase().startsWith('part') ? 'part' : 'numbered', number, key: `chapter${number}` };
    }
  }

  const bareNumber = extractChapterNumber(first);
  if (bareNumber != null && /^(?:\d+|[ivxlcdm]+|[a-z\s-]+)$/i.test(first)) {
    return { kind: 'numbered', number: bareNumber, key: `chapter${bareNumber}` };
  }

  return { kind: 'named', number: null, key };
}

function scoreChapterMatch(sectionMeta, audioMeta, audioIndex) {
  if (!sectionMeta || !audioMeta) return 0;
  let score = 0;

  if (sectionMeta.kind === 'prologue' && audioMeta.kind === 'prologue') score += 14;
  if (sectionMeta.kind === 'epilogue' && audioMeta.kind === 'epilogue') score += 14;
  if (sectionMeta.number != null && audioMeta.number != null && sectionMeta.number === audioMeta.number) score += 14;

  if (sectionMeta.key && audioMeta.key) {
    if (sectionMeta.key === audioMeta.key) score += 10;
    else if (sectionMeta.key.includes(audioMeta.key) || audioMeta.key.includes(sectionMeta.key)) score += 6;
  }

  if (!score && sectionMeta.kind === 'numbered' && sectionMeta.number === audioIndex + 1) score += 8;
  return score;
}

function epubSectionStats(section, bookTitle = '') {
  const title = String(section?.title || '').trim();
  const paragraphs = Array.isArray(section?.paragraphs) ? section.paragraphs : [];
  const text = paragraphs.join(' ').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(/\s+/).length : 0;
  const lower = text.toLowerCase();
  const titleLower = title.toLowerCase();
  const heading = `${title} ${paragraphs[0] || ''}`.toLowerCase();
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const metadataPatterns = [
    /all rights reserved/g,
    /\bcopyright\b/g,
    /\bisbn\b/g,
    /\bpublisher\b/g,
    /\bpublished by\b/g,
    /\blibrary of congress\b/g,
    /\bcover design\b/g,
    /\btext copyright\b/g,
    /\bebook\b/g,
    /\btable of contents\b/g,
    /\bcontents\b/g,
    /\bdedication\b/g,
    /\backnowledg(?:e)?ments?\b/g,
    /\bmap\b/g,
    /\billustration\b/g,
    /\bpreview\b/g,
    /\bexcerpt\b/g,
    /\bbonus\b/g,
    /\balso by\b/g,
    /\bpraise for\b/g,
    /\babout the author\b/g,
  ];
  const metadataHits = metadataPatterns.reduce((sum, re) => sum + ((lower.match(re) || []).length), 0);
  const sentenceHits = (text.match(/[.!?][\s"']+[A-Z]/g) || []).length;
  const dialogueHits = (text.match(/["“”]/g) || []).length;
  const shortParas = paragraphs.filter(p => p.trim().split(/\s+/).length <= 8).length;
  const titleRepeat = bookTitle && norm(title).startsWith(norm(bookTitle));
  const titleOnly = bookTitle && norm(text.slice(0, Math.min(text.length, 160))) === norm(bookTitle);

  let nonStoryScore = metadataHits * 3;
  if (titleRepeat) nonStoryScore += 3;
  if (titleOnly) nonStoryScore += 4;
  if (words < 40) nonStoryScore += 2;
  if (words < 18) nonStoryScore += 2;
  if (paragraphs.length && shortParas / paragraphs.length > 0.7) nonStoryScore += 2;
  if (/^(contents?|copyright|dedication|acknowledg(?:e)?ments?|map|preview|excerpt|bonus)/i.test(title)) nonStoryScore += 4;

  let storyScore = 0;
  if (words >= 120) storyScore += 3;
  if (sentenceHits >= 3) storyScore += 2;
  if (dialogueHits >= 2) storyScore += 1;
  if (paragraphs.length >= 3) storyScore += 1;
  if (/^chapter\b|^prologue\b|^epilogue\b|^part\b/i.test(titleLower)) storyScore += 2;

  return {
    title,
    paragraphs,
    words,
    metadataHits,
    nonStoryScore,
    storyScore,
    likelyNonStory: nonStoryScore >= 5 && storyScore <= 2,
    likelyStory: storyScore >= 3 && nonStoryScore <= 4,
    marker: buildChapterMatchMeta(title, paragraphs, bookTitle),
    text,
  };
}

function detectStoryBounds(sections, bookTitle = '', audioChapters = []) {
  if (!sections.length) return { start: 0, end: -1, stats: [] };
  const stats = sections.map(section => epubSectionStats(section, bookTitle));

  let start = 0;
  const firstAudioMeta = audioChapters.length
    ? buildChapterMatchMeta(audioChapters[0]?.title || `Chapter 1`, [], bookTitle)
    : null;
  if (firstAudioMeta) {
    for (let i = 0; i < Math.min(stats.length, 20); i++) {
      const here = stats[i];
      const matchScore = scoreChapterMatch(here.marker, firstAudioMeta, 0);
      const looksStoryish = here.likelyStory || here.storyScore >= here.nonStoryScore || here.words >= 80;
      if (matchScore >= 10 || (matchScore >= 6 && looksStoryish)) {
        start = i;
        break;
      }
    }
  }

  for (let i = 0; i < stats.length; i++) {
    if (i < start) continue;
    const here = stats[i];
    const next = stats[i + 1];
    const looksLikeStart = here.likelyStory || (
      here.storyScore >= here.nonStoryScore &&
      here.words >= 80 &&
      !(here.metadataHits >= 2 && here.words < 120)
    );
    const windowSupport = !next || next.likelyStory || next.storyScore >= next.nonStoryScore;
    if (looksLikeStart && windowSupport) {
      start = i;
      break;
    }
  }

  let end = stats.length - 1;
  for (let i = stats.length - 1; i >= start; i--) {
    const here = stats[i];
    const prev = stats[i - 1];
    const looksLikeTail = here.likelyNonStory && (
      i === stats.length - 1 ||
      (prev && prev.likelyNonStory)
    );
    if (looksLikeTail) {
      end = i - 1;
      continue;
    }
    break;
  }

  if (end < start) end = stats.length - 1;
  return { start, end, stats };
}

function buildSectionStartIndexes(totalSections, desired, anchors) {
  const starts = Array(desired).fill(0);
  const sorted = anchors
    .filter(a => a && a.audioIndex >= 0 && a.audioIndex < desired && a.sectionIndex >= 0 && a.sectionIndex < totalSections)
    .sort((a, b) => a.audioIndex - b.audioIndex || a.sectionIndex - b.sectionIndex)
    .filter((anchor, i, arr) => i === 0 || (anchor.audioIndex !== arr[i - 1].audioIndex && anchor.sectionIndex > arr[i - 1].sectionIndex));

  if (!sorted.length || sorted[0].audioIndex !== 0) {
    sorted.unshift({ audioIndex: 0, sectionIndex: 0 });
  }

  const last = sorted[sorted.length - 1];
  if (last.audioIndex !== desired - 1) {
    sorted.push({ audioIndex: desired - 1, sectionIndex: Math.max(0, totalSections - 1) });
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const left = sorted[i];
    const right = sorted[i + 1];
    const audioSpan = Math.max(1, right.audioIndex - left.audioIndex);
    const sectionSpan = Math.max(0, right.sectionIndex - left.sectionIndex);
    for (let step = 0; step <= audioSpan; step++) {
      const audioIndex = left.audioIndex + step;
      const offset = Math.floor(sectionSpan * step / audioSpan);
      starts[audioIndex] = Math.min(totalSections - 1, left.sectionIndex + offset);
    }
  }

  for (let i = 1; i < starts.length; i++) {
    starts[i] = Math.max(starts[i], starts[i - 1] + 1);
  }
  for (let i = starts.length - 2; i >= 0; i--) {
    starts[i] = Math.min(starts[i], starts[i + 1] - 1);
  }

  starts[0] = 0;
  for (let i = 1; i < starts.length; i++) {
    starts[i] = Math.max(i, Math.min(starts[i], totalSections - (desired - i)));
  }
  return starts;
}

function groupStorySectionsByAudioChapters(storySections, audioChapters) {
  const desired = Math.max(1, audioChapters.length);
  if (!storySections.length) return [];
  if (storySections.length === desired) {
    return storySections.map((ch, i) => ({
      title: audioChapters[i]?.title || ch.title || `Chapter ${i + 1}`,
      paragraphs: ch.paragraphs,
      sourceCount: 1,
    }));
  }
  if (storySections.length < desired) return null;

  const audioMeta = audioChapters.map((ch, i) => buildChapterMatchMeta(ch?.title || `Chapter ${i + 1}`));
  const anchors = [];

  for (let audioIndex = 0; audioIndex < desired; audioIndex++) {
    let best = null;
    for (let sectionIndex = 0; sectionIndex < storySections.length; sectionIndex++) {
      const section = storySections[sectionIndex];
      const meta = buildChapterMatchMeta(section.title, section.paragraphs);
      const score = scoreChapterMatch(meta, audioMeta[audioIndex], audioIndex);
      if (score >= 8 && (!best || score > best.score || (score === best.score && sectionIndex < best.sectionIndex))) {
        best = { audioIndex, sectionIndex, score };
      }
    }
    if (best) anchors.push(best);
  }

  const usableAnchors = [];
  let lastSectionIndex = -1;
  for (const anchor of anchors.sort((a, b) => a.audioIndex - b.audioIndex || a.sectionIndex - b.sectionIndex)) {
    if (anchor.sectionIndex <= lastSectionIndex) continue;
    usableAnchors.push(anchor);
    lastSectionIndex = anchor.sectionIndex;
  }

  if (!usableAnchors.length) return null;

  const starts = buildSectionStartIndexes(storySections.length, desired, usableAnchors);
  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : storySections.length;
    const group = storySections.slice(start, Math.max(start + 1, end));
    return {
      title: audioChapters[i]?.title || group.find(ch => ch.title)?.title || `Chapter ${i + 1}`,
      paragraphs: group.flatMap(ch => ch.paragraphs),
      sourceCount: group.length,
    };
  });
}

function mapStorySectionsToChapters(storySections, targetCount, audioChapters = []) {
  if (!storySections.length) return [];
  const desired = Math.max(1, parseInt(targetCount, 10) || storySections.length);

  if (audioChapters.length === desired) {
    const mapped = groupStorySectionsByAudioChapters(storySections, audioChapters);
    if (mapped?.length === desired) return mapped;
  }

  if (storySections.length > desired) {
    const grouped = chunkArray(storySections, desired).filter(group => group.length > 0);
    return grouped.map((group, i) => ({
      title: audioChapters[i]?.title || group.find(ch => ch.title)?.title || `Chapter ${i + 1}`,
      paragraphs: group.flatMap(ch => ch.paragraphs),
      sourceCount: group.length,
    }));
  }

  const allParagraphs = storySections.flatMap(ch => ch.paragraphs);
  const split = chunkParagraphs(allParagraphs, desired);
  return split.map((paragraphs, i) => ({
    title: audioChapters[i]?.title || storySections[i]?.title || `Chapter ${i + 1}`,
    paragraphs,
    sourceCount: 0,
  }));
}

function normalizeEpubChapters(parsed, targetCount, audioChapters = [], bookTitle = '') {
  const clean = (parsed || []).filter(ch => Array.isArray(ch.paragraphs) && ch.paragraphs.length);
  if (!clean.length) return { sections: [], storyStartIndex: 0, frontMatterCount: 0, storyCount: 0 };

  const { start, end, stats } = detectStoryBounds(clean, bookTitle, audioChapters);
  const frontMatter = clean.slice(0, start).map((section, i) => ({
    title: section.title || `Front Matter ${i + 1}`,
    paragraphs: section.paragraphs,
    kind: 'frontMatter',
    rawIndex: i,
    syncIndex: null,
    score: stats[i]?.nonStoryScore || 0,
  }));
  const storyRaw = clean.slice(start, end + 1);
  const backMatter = clean.slice(end + 1).map((section, i) => ({
    title: section.title || `Back Matter ${i + 1}`,
    paragraphs: section.paragraphs,
    kind: 'backMatter',
    rawIndex: end + 1 + i,
    syncIndex: null,
    score: stats[end + 1 + i]?.nonStoryScore || 0,
  }));
  const storyChapters = mapStorySectionsToChapters(storyRaw, targetCount, audioChapters).map((section, i) => ({
    title: audioChapters[i]?.title || section.title || `Chapter ${i + 1}`,
    paragraphs: section.paragraphs,
    kind: 'story',
    syncIndex: i,
  }));
  const sections = [...frontMatter, ...storyChapters, ...backMatter];
  const audioToEpub = Array.from({ length: storyChapters.length }, (_, i) => frontMatter.length + i);
  const epubToAudio = sections.map(section => section.kind === 'story' ? section.syncIndex : null);

  return {
    sections,
    audioToEpub,
    epubToAudio,
    storyStartIndex: frontMatter.length,
    frontMatterCount: frontMatter.length,
    backMatterCount: backMatter.length,
    storyCount: storyChapters.length,
  };
}

// ── App setup ────────────────────────────────────────────────────────────────

// Required on Windows for notifications to appear in the Action Center
// Dev: use execPath so Windows registers notifications under the electron process.
// Packaged: use the real app ID that matches the NSIS installer.
if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? 'com.grimoire.app' : process.execPath);
}

// ── Auto-updater ──────────────────────────────────────────────────────────────
// Only active in packaged builds (electron-updater checks GitHub Releases).
// userData (AppData/Roaming/Grimoire) is NEVER touched by the installer or
// updater — electron-builder NSIS only writes to the app installation directory.

function initAutoUpdater() {
  if (!app.isPackaged) {
    dbg('autoUpdater: skipped in dev mode');
    return;
  }
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    dbg('autoUpdater: electron-updater not available -', e.message);
    return;
  }

  autoUpdater.autoDownload        = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = { info: (...a) => dbg('[updater]', ...a), warn: (...a) => dbg('[updater]', ...a), error: (...a) => dbg('[updater]', ...a), debug: () => {} };

  autoUpdater.on('update-available', info => {
    dbg('autoUpdater: update available -', info.version);
    mainWindow?.webContents.send('update:available', { version: info.version });
  });

  autoUpdater.on('download-progress', progress => {
    mainWindow?.webContents.send('update:progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', info => {
    dbg('autoUpdater: download complete -', info.version);
    mainWindow?.webContents.send('update:downloaded', { version: info.version });
  });

  autoUpdater.on('error', err => {
    dbg('autoUpdater: error -', err.message);
    // Silent — don't surface update errors to the user
  });

  // Check once 4 seconds after launch so startup isn't blocked
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(e => dbg('autoUpdater: checkForUpdates failed -', e.message));
  }, 4000);

  ipcMain.handle('update:download', () =>
    autoUpdater.downloadUpdate().catch(e => ({ error: e.message }))
  );

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true);
  });
}

app.whenReady().then(async () => {
  db = loadDb();
  initSupabase();
  dbg('startup: packaged =', app.isPackaged, '| userData =', app.getPath('userData'));
  const s3cfgExists = fs.existsSync(s3ConfigPath());
  dbg('startup: s3-config.json present =', s3cfgExists);
  const _startCfg = loadS3Config();
  const _keyPreview = _startCfg.accessKeyId ? _startCfg.accessKeyId.slice(0, 8) + '...' : '(none)';
  const _cfgSource  = process.env.AWS_ACCESS_KEY_ID ? 'env (.env file)' : (s3cfgExists ? 'file (s3-config.json)' : 'none');
  console.log('[Grimoire] S3 credentials loaded from:', _cfgSource, '| key prefix:', _keyPreview, '| bucket:', _startCfg.bucket);
  loadQueue();
  setAuthSkipped(false); // clear any stale skip state — auth is now required
  await loadSession();
  createWindow();
  registerIPC();
  initAutoUpdater();
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
      icon: path.join(__dirname, 'assets', 'grimoire-logo.png'),
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

// Tracks in-flight catalog downloads so they can be cancelled
const _downloadCancelRefs = new Map();

function registerIPC() {
  // App version (always available, packaged or dev)
  ipcMain.handle('update:getVersion', () => app.getVersion());

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
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
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

    let chapters = files.map((filename, i) => ({
      id: i,
      filename,
      filepath: path.join(folderPath, filename),
      title: chapterTitle(filename),
      duration: existing?.chapters?.[i]?.duration || 0,
    }));

    if (files.length === 1) {
      const embeddedChapters = await buildEmbeddedChapters(path.join(folderPath, files[0]), existing?.chapters || []);
      if (embeddedChapters?.length) chapters = embeddedChapters;
    }

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
      chapterCount: chapters.length,
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
  ipcMain.handle('library:delete', (_e, bookId) => deleteBookRecord(bookId, { cleanupManaged: true }));

  // Rename book title
  ipcMain.handle('library:rename', (_e, { bookId, title }) => {
    if (db.books[bookId]) { db.books[bookId].title = title; saveDb(); }
    return true;
  });

  ipcMain.handle('collections:getAll', () =>
    Object.values(db.collections || {})
      .map(normalizeCollectionRecord)
      .sort(collectionSort)
  );

  ipcMain.handle('collections:create', (_e, { name }) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return { error: 'Collection name is required.' };
    const collection = saveCollectionRecord({
      id: crypto.randomUUID(),
      name: trimmed,
      bookIds: [],
      coverPath: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return { collection };
  });

  ipcMain.handle('collections:rename', (_e, { collectionId, name }) => {
    const existing = db.collections?.[collectionId];
    const trimmed = String(name || '').trim();
    if (!existing) return { error: 'Collection not found.' };
    if (!trimmed) return { error: 'Collection name is required.' };
    const collection = saveCollectionRecord({
      ...existing,
      name: trimmed,
      updatedAt: new Date().toISOString(),
    });
    return { collection };
  });

  ipcMain.handle('collections:delete', (_e, { collectionId }) => {
    const existing = db.collections?.[collectionId];
    if (!existing) return { error: 'Collection not found.' };
    removeCollectionCoverFile(existing);
    delete db.collections[collectionId];
    saveDb();
    return { success: true };
  });

  ipcMain.handle('collections:updateBooks', (_e, { collectionId, bookIds }) => {
    const existing = db.collections?.[collectionId];
    if (!existing) return { error: 'Collection not found.' };
    const collection = saveCollectionRecord({
      ...existing,
      bookIds: Array.from(new Set((bookIds || []).map(String))),
      updatedAt: new Date().toISOString(),
    });
    return { collection };
  });

  ipcMain.handle('collections:setCover', (_e, { collectionId, sourcePath }) => {
    const existing = db.collections?.[collectionId];
    if (!existing) return { error: 'Collection not found.' };
    if (!sourcePath || !fs.existsSync(sourcePath)) return { error: 'Cover image not found.' };
    ensureDir(collectionCoverRootDir());
    const ext = path.extname(sourcePath) || '.png';
    const dest = path.join(collectionCoverRootDir(), `${collectionId}${ext}`);
    removeCollectionCoverFile(existing);
    fs.copyFileSync(sourcePath, dest);
    const collection = saveCollectionRecord({
      ...existing,
      coverPath: dest,
      updatedAt: new Date().toISOString(),
    });
    return { collection };
  });

  ipcMain.handle('collections:removeCover', (_e, { collectionId }) => {
    const existing = db.collections?.[collectionId];
    if (!existing) return { error: 'Collection not found.' };
    removeCollectionCoverFile(existing);
    const collection = saveCollectionRecord({
      ...existing,
      coverPath: null,
      updatedAt: new Date().toISOString(),
    });
    return { collection };
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
  ipcMain.handle('playback:reset', (_e, bookId) => {
    delete db.playback[bookId];
    saveDb();
    return true;
  });

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
        icon: path.join(__dirname, 'assets', 'grimoire-logo.png'),
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

  function persistTranscriptArtifacts(book, transcriptText, wordsData, priorMeta = null) {
    const paths = transcriptCachePaths(book.id);
    ensureDir(transcriptRootDir());
    ensureDir(paths.dir);

    const transcriptTmp = path.join(paths.dir, `transcript.${process.pid}.tmp`);
    const wordsTmp = path.join(paths.dir, `words.${process.pid}.tmp`);

    fs.writeFileSync(transcriptTmp, transcriptText, 'utf8');
    fs.renameSync(transcriptTmp, paths.transcript);

    safeWriteJson(wordsTmp, wordsData || {});
    fs.renameSync(wordsTmp, paths.words);

    const currentMeta = safeReadJson(paths.meta) || priorMeta || buildSmartSyncMeta(book);
    const nextMeta = buildSmartSyncMeta(book, {
      ...currentMeta,
      createdAt: currentMeta.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      transcriptComplete: true,
      alignmentComplete: false,
      alignmentStatus: 'pending',
    });
    safeWriteJson(paths.meta, nextMeta);
    return nextMeta;
  }

  function persistAlignmentArtifacts(book, alignmentData, priorMeta = null) {
    const paths = transcriptCachePaths(book.id);
    ensureDir(transcriptRootDir());
    ensureDir(paths.dir);
    const currentMeta = safeReadJson(paths.meta) || priorMeta || buildSmartSyncMeta(book);
    const nextMeta = buildSmartSyncMeta(book, {
      ...currentMeta,
      createdAt: currentMeta.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      alignmentComplete: !!alignmentData?.complete,
      alignmentStatus: alignmentData?.status || (alignmentData?.complete ? 'complete' : 'stub'),
    });
    safeWriteJson(paths.alignment, alignmentData);
    safeWriteJson(paths.meta, nextMeta);
    return nextMeta;
  }

  function finalizeJob(job, result) {
    job.result = result;
    job.status = result?.cancelled ? 'cancelled' : (result?.error ? 'failed' : 'completed');
    job.stage = result?.error ? 'error' : 'done';
    job.error = result?.error || null;
    job.progress = result?.progress || job.progress || null;
    job.pid = null;
    job.proc = null;
    job.updatedAt = new Date().toISOString();
    smartSyncJobs.set(job.bookId, job);
    setTimeout(() => {
      const current = smartSyncJobs.get(job.bookId);
      if (current === job && (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled')) {
        smartSyncJobs.delete(job.bookId);
      }
    }, 5 * 60 * 1000);
    return result;
  }

  async function runSmartSyncJob(bookId) {
    const resolved = await resolveAudioBook(bookId);
    if (resolved.error) return { error: resolved.error };
    const book = resolved.book;

    const existing = smartSyncJobs.get(bookId);
    if (existing && (existing.status === 'queued' || existing.status === 'running')) {
      updateSmartSyncJob(existing, {
        event: 'queued',
        payload: { reused: true },
      });
      return existing.promise;
    }

    const job = {
      bookId,
      status: 'queued',
      stage: 'queue',
      progress: { current: 0, total: Math.max(1, book.chapterCount || book.chapters?.length || 1), percent: 0 },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: null,
      pid: null,
      proc: null,
      cacheHit: false,
      cancelRequested: false,
      result: null,
      promise: null,
    };
    smartSyncJobs.set(bookId, job);
    updateSmartSyncJob(job, {
      event: 'queued',
      status: 'queued',
      stage: 'queue',
      payload: { chapterCount: book.chapterCount || book.chapters?.length || 0 },
    });

    job.promise = (async () => {
      const cache = readTranscriptCache(book);
      if (isSmartSyncCacheValid(book, cache)) {
        job.cacheHit = true;
        updateSmartSyncJob(job, {
          status: 'completed',
          stage: 'cache',
          progress: { current: 1, total: 1, percent: 100 },
          event: 'cache-hit',
          payload: {
            transcriptComplete: !!cache.meta?.transcriptComplete,
            alignmentComplete: !!cache.meta?.alignmentComplete,
          },
        });
        updateSmartSyncJob(job, {
          status: 'completed',
          stage: 'done',
          progress: { current: 1, total: 1, percent: 100 },
          event: 'completed',
          payload: {
            cacheHit: true,
            transcriptComplete: !!cache.meta?.transcriptComplete,
            alignmentComplete: !!cache.meta?.alignmentComplete,
          },
        });
        return finalizeJob(job, {
          bookId,
          cacheHit: true,
          transcript: cache.transcript,
          words: cache.words,
          alignment: cache.alignment,
          meta: cache.meta,
          progress: { current: 1, total: 1, percent: 100 },
        });
      }

      let ffmpegPath;
      try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; }
      catch (e) { return finalizeJob(job, { error: 'ffmpeg not available: ' + e.message }); }

      const scriptPath = path.join(__dirname, 'scripts', 'detect_chapters.py');
      if (!fs.existsSync(scriptPath)) {
        return finalizeJob(job, { error: 'Transcription script not found. Reinstall Grimoire.' });
      }

      const python = await findPython();
      if (!python) {
        return finalizeJob(job, {
          error: 'Python 3 is not installed or not in PATH.\n\nTranscription requires Python 3.9–3.11 and faster-whisper.\nInstall: pip install faster-whisper',
        });
      }

      const chaptersArg = (book.chapters || []).map((ch, i) => ({
        index: i,
        title: ch.title,
        filepath: ch.filepath,
      }));

      updateSmartSyncJob(job, {
        status: 'running',
        stage: 'transcription',
        progress: { current: 0, total: chaptersArg.length || 1, percent: 0 },
        event: 'transcription-start',
        payload: { chapterCount: chaptersArg.length, modelName: SMART_SYNC_MODEL },
      });

      return new Promise((resolve) => {
        const { spawn } = require('child_process');
        const proc = spawn(python.exe, [
          ...python.args,
          scriptPath,
          '--mode', 'transcribe',
          '--chapters-json', JSON.stringify(chaptersArg),
          '--ffmpeg', ffmpegPath,
        ], { stdio: ['ignore', 'pipe', 'pipe'], env: cudaEnv() });

        job.proc = proc;
        job.pid = proc.pid;
        smartSyncJobs.set(bookId, job);

        let buf = '';
        let stderrBuf = '';
        let transcriptText = '';
        let wordsData = {};
        let alignmentData = null;
        let transcriptMeta = cache.meta || buildSmartSyncMeta(book);
        let handledClose = false;

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
                updateSmartSyncJob(job, {
                  status: 'running',
                  stage: 'transcription',
                  event: 'model-loading',
                  payload: { message: msg.message || '' },
                });
              } else if (msg.type === 'device') {
                updateSmartSyncJob(job, {
                  status: 'running',
                  stage: 'transcription',
                  event: 'transcription-start',
                  payload: {
                    chapterCount: chaptersArg.length,
                    modelName: SMART_SYNC_MODEL,
                    device: msg.device,
                    computeType: msg.compute_type,
                  },
                });
              } else if (msg.type === 'progress' && msg.phase === 'transcription') {
                const current = Math.max(0, parseInt(msg.current, 10) || 0);
                const total = Math.max(1, parseInt(msg.total, 10) || chaptersArg.length || 1);
                const percent = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
                updateSmartSyncJob(job, {
                  status: 'running',
                  stage: 'transcription',
                  progress: { current, total, percent },
                  event: 'transcription-progress',
                  payload: {
                    chapterIndex: msg.chapterIndex,
                    chapterTitle: msg.chapterTitle || '',
                  },
                });
              } else if (msg.type === 'phase' && msg.phase === 'transcription' && msg.event === 'complete') {
                updateSmartSyncJob(job, {
                  status: 'running',
                  stage: 'transcription',
                  progress: { current: chaptersArg.length || 1, total: chaptersArg.length || 1, percent: 100 },
                  event: 'transcript-complete',
                  payload: { chapterCount: chaptersArg.length },
                });
              } else if (msg.type === 'chapter') {
                const current = (parseInt(msg.chapterIndex, 10) || 0) + 1;
                const total = Math.max(1, parseInt(msg.total, 10) || chaptersArg.length || 1);
                const percent = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
                updateSmartSyncJob(job, {
                  status: 'running',
                  stage: 'transcription',
                  progress: { current, total, percent },
                  event: 'transcription-progress',
                  payload: {
                    chapterIndex: msg.chapterIndex,
                    chapterTitle: msg.chapterTitle || '',
                    text: msg.text || '',
                    words: msg.words || [],
                  },
                });
              } else if (msg.type === 'transcript') {
                transcriptText = String(msg.text || '');
                wordsData = msg.wordsByChapter || {};
                transcriptMeta = persistTranscriptArtifacts(book, transcriptText, wordsData, transcriptMeta);
                updateSmartSyncJob(job, {
                  status: 'running',
                  stage: 'transcription',
                  progress: { current: chaptersArg.length || 1, total: chaptersArg.length || 1, percent: 100 },
                  event: 'transcript-complete',
                  payload: {
                    chapterCount: chaptersArg.length,
                    transcriptComplete: true,
                  },
                });
              } else if (msg.type === 'phase' && msg.phase === 'alignment' && msg.event === 'start') {
                updateSmartSyncJob(job, {
                  status: 'running',
                  stage: 'alignment',
                  progress: { current: 0, total: 1, percent: 0 },
                  event: 'alignment-start',
                  payload: { mode: msg.mode || 'stub' },
                });
              } else if (msg.type === 'progress' && msg.phase === 'alignment') {
                const current = Math.max(0, parseInt(msg.current, 10) || 0);
                const total = Math.max(1, parseInt(msg.total, 10) || 1);
                const percent = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
                updateSmartSyncJob(job, {
                  status: 'running',
                  stage: 'alignment',
                  progress: { current, total, percent },
                  event: 'alignment-progress',
                  payload: { message: msg.message || '', stub: !!msg.stub },
                });
              } else if (msg.type === 'alignment') {
                alignmentData = msg.data || null;
                transcriptMeta = persistAlignmentArtifacts(book, alignmentData, transcriptMeta);
                updateSmartSyncJob(job, {
                  status: 'running',
                  stage: 'alignment',
                  progress: { current: 1, total: 1, percent: 100 },
                  event: 'alignment-complete',
                  payload: {
                    alignmentComplete: !!alignmentData?.complete,
                    alignmentStatus: alignmentData?.status || 'stub',
                    stub: !!alignmentData?.stub,
                  },
                });
              } else if (msg.type === 'error') {
                stderrBuf += (msg.message || 'Unknown worker error');
              }
            } catch {}
          }
        });

        proc.stderr.on('data', chunk => { stderrBuf += chunk.toString(); });

        proc.on('close', code => {
          if (handledClose) return;
          handledClose = true;

          if (job.cancelRequested) {
            updateSmartSyncJob(job, {
              status: 'cancelled',
              stage: 'done',
              progress: job.progress,
              event: 'failed',
              payload: { cancelled: true },
            });
            return resolve(finalizeJob(job, {
              cancelled: true,
              error: 'Cancelled',
              progress: job.progress,
            }));
          }

          if (code === 0) {
            const cacheAfter = readTranscriptCache(book);
            updateSmartSyncJob(job, {
              status: 'completed',
              stage: 'done',
              progress: { current: 1, total: 1, percent: 100 },
              event: 'completed',
              payload: {
                cacheHit: false,
                transcriptComplete: !!cacheAfter.meta?.transcriptComplete,
                alignmentComplete: !!cacheAfter.meta?.alignmentComplete,
              },
            });
            return resolve(finalizeJob(job, {
              bookId,
              cacheHit: false,
              transcript: cacheAfter.transcript || transcriptText,
              words: cacheAfter.words || wordsData,
              alignment: cacheAfter.alignment || alignmentData,
              meta: cacheAfter.meta || transcriptMeta,
              progress: { current: 1, total: 1, percent: 100 },
            }));
          }

          const notInstalled = /No module named ['"]faster_whisper/i.test(stderrBuf)
            || /ModuleNotFoundError/i.test(stderrBuf);
          const error = notInstalled
            ? 'faster-whisper is not installed.\n\nRun: pip install faster-whisper'
            : (stderrBuf.slice(-600) || `Process exited with code ${code}`);
          updateSmartSyncJob(job, {
            status: 'failed',
            stage: 'error',
            error,
            event: 'failed',
            payload: { code },
          });
          resolve(finalizeJob(job, { error, progress: job.progress }));
        });

        proc.on('error', err => {
          updateSmartSyncJob(job, {
            status: 'failed',
            stage: 'error',
            error: err.message,
            event: 'failed',
          });
          resolve(finalizeJob(job, { error: err.message, progress: job.progress }));
        });
      });
    })();

    return job.promise;
  }

  ipcMain.handle('book:transcribe', async (_event, bookId) => runSmartSyncJob(bookId));

  ipcMain.handle('transcribe:getJob', (_e, bookId) => {
    const job = smartSyncJobs.get(bookId);
    return publicJobState(job);
  });

  ipcMain.handle('transcribe:cancel', (_e, bookId) => {
    const job = smartSyncJobs.get(bookId);
    if (!job) return { success: false, error: 'No active job for this book.' };
    if (!job.proc || job.status !== 'running') return { success: false, error: 'Job is not running.' };
    job.cancelRequested = true;
    try {
      job.proc.kill();
      updateSmartSyncJob(job, {
        status: 'cancelled',
        stage: 'done',
        event: 'failed',
        payload: { cancelled: true },
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('book:transcribe:legacy', async (event, bookId) => {
    const resolved = await resolveAudioBook(bookId);
    if (resolved.error) return { error: resolved.error };
    const book = resolved.book;

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

  async function splitBookIntoChapterFolder(book, splitPoints, onProgress = null) {
    let ffmpegPath;
    try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; }
    catch (e) { return { error: 'ffmpeg not available: ' + e.message }; }

    const sourceFile = book.chapters[0].filepath;
    const sourceDir  = path.dirname(sourceFile);
    const sourceName = path.basename(sourceFile, path.extname(sourceFile));
    const sourceExt  = path.extname(sourceFile);
    const outDir = path.join(sourceDir, `${sourceName} - Chapters`);

    if (fs.existsSync(outDir)) {
      try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
    }
    fs.mkdirSync(outDir, { recursive: true });

    const starts = [0, ...(splitPoints || [])];
    const total  = starts.length;

    for (let i = 0; i < total; i++) {
      const segStart = starts[i];
      const segEnd   = i < total - 1 ? starts[i + 1] : null;
      const chNum    = String(i + 1).padStart(3, '0');
      const outFile  = path.join(outDir, `Chapter ${chNum}${sourceExt}`);

      onProgress?.({
        type: 'splitting',
        current: i + 1,
        total,
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

    const audioExts = new Set(['.mp3', '.mp4', '.m4b', '.m4a', '.aac', '.ogg', '.wav', '.flac', '.opus']);
    const newFiles = fs.readdirSync(outDir)
      .filter(f => audioExts.has(path.extname(f).toLowerCase()))
      .sort(naturalSort);

    return {
      outDir,
      chapters: newFiles.map((filename, idx) => ({
        id: idx,
        filename,
        filepath: path.join(outDir, filename),
        title: chapterTitle(filename),
        duration: 0,
      })),
    };
  }

  async function uploadCatalogChapterFolder({ folderPath, s3Prefix, event }) {
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
    const s3 = createS3Client(cfg);

    for (let i = 0; i < files.length; i++) {
      const filename = files[i];
      event?.sender.send('split:progress', {
        type: 'uploading',
        current: i,
        total: files.length,
        message: `Uploading ${filename}…`,
      });
      try {
        const uploader = new Upload({
          client: s3,
          params: { Bucket: cfg.bucket, Key: `${s3Prefix}${filename}`, Body: fs.createReadStream(path.join(folderPath, filename)) },
        });
        uploader.on('httpUploadProgress', ({ loaded, total }) => {
          const progress = total ? (i + (loaded / total)) : i;
          event?.sender.send('split:progress', {
            type: 'uploading',
            current: progress,
            total: files.length,
            message: `Uploading ${filename}…`,
          });
        });
        await uploader.done();
      } catch (e) {
        return { error: `Failed to upload ${filename}: ${e.message}` };
      }
    }

    return {
      files,
      chapters: files.map((filename, index) => ({ filename, title: chapterTitle(filename), duration: 0 })),
    };
  }

  async function verifyCatalogObjectsExist(s3Prefix, filenames = []) {
    const cfg = loadS3Config();
    if (!cfg?.accessKeyId) return { error: 'S3 not configured' };
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = createS3Client(cfg);
    for (const filename of filenames) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: `${s3Prefix}${filename}` }));
      } catch (error) {
        return { error: `Uploaded file verification failed for ${filename}: ${error.message}` };
      }
    }
    return { success: true };
  }

  async function updateCatalogStructureRow(bookId, structure) {
    const { error } = await supabase.from('catalog').update({
      s3_prefix: structure.s3Prefix,
      chapter_count: structure.chapterCount,
      chapters: structure.chapters,
      updated_at: structure.updatedAt,
      structure_hash: structure.structureHash,
    }).eq('id', bookId);
    if (!error) return { success: true };
    if (isUnknownColumnError(error)) {
      return { error: 'Catalog schema is missing updated_at or structure_hash. Run the catalog structure migration first.' };
    }
    return { error: error.message };
  }

  ipcMain.handle('book:detectSilences', async (event, { bookId, silenceDuration, noiseFloor }) => {
    const resolved = await resolveAudioBook(bookId, { requireSingleFile: true });
    if (resolved.error) return { error: resolved.error };
    const book = resolved.book;

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
    const resolved = await resolveAudioBook(bookId, { requireSingleFile: true });
    if (resolved.error) return { error: resolved.error };
    const book = resolved.book;
    const splitResult = await splitBookIntoChapterFolder(book, splitPoints, data => event.sender.send('split:progress', data));
    if (splitResult.error) return splitResult;

    event.sender.send('split:progress', { type: 'importing', message: 'Updating library...' });
    const { outDir, chapters } = splitResult;

    const storedBook = db.books[bookId] || {};
    const nextBook = {
      ...storedBook,
      id: bookId,
      title: storedBook.title || book.title,
      author: storedBook.author || book.author || '',
      folderPath: outDir,
      chapterCount: chapters.length,
      chapters,
      addedAt: storedBook.addedAt || new Date().toISOString(),
      sourceCatalogId: storedBook.sourceCatalogId || resolved.catalog?.id || book.sourceCatalogId || null,
      managedFolder: storedBook.managedFolder || false,
    };
    if (storedBook.coverPath) nextBook.coverPath = storedBook.coverPath;
    if (storedBook.bgPath) nextBook.bgPath = storedBook.bgPath;
    if (storedBook.epubPath) nextBook.epubPath = storedBook.epubPath;

    db.books[bookId] = nextBook;
    delete db.playback[bookId];
    saveDb();

    return { ...nextBook, playback: null, chaptersCreated: chapters.length };
  });

  ipcMain.handle('catalog:splitReplaceChapters', async (event, { bookId, splitPoints }) => {
    if (!supabase || !currentUser) return { error: 'Not authenticated' };
    try {
      const catBook = await ensureCatalogOwnership(bookId);
      const resolved = await resolveAudioBook(bookId, { requireSingleFile: true });
      if (resolved.error) return { error: resolved.error };

      const splitResult = await splitBookIntoChapterFolder(resolved.book, splitPoints, data => event.sender.send('split:progress', data));
      if (splitResult.error) return splitResult;

      const replacementPrefix = `catalog/${bookId}/replace-${Date.now()}/`;
      event.sender.send('split:progress', { type: 'publishing', message: 'Preparing replacement catalog structure...' });

      const uploadResult = await uploadCatalogChapterFolder({
        folderPath: splitResult.outDir,
        s3Prefix: replacementPrefix,
        event,
      });
      if (uploadResult.error) return uploadResult;

      event.sender.send('split:progress', { type: 'publishing', message: 'Verifying uploaded chapter files...' });
      const verifyResult = await verifyCatalogObjectsExist(replacementPrefix, uploadResult.files);
      if (verifyResult.error) return verifyResult;

      const structure = catalogStructurePayload({
        s3Prefix: replacementPrefix,
        chapterCount: uploadResult.files.length,
        chapters: uploadResult.chapters,
      });

      event.sender.send('split:progress', { type: 'publishing', message: 'Updating catalog metadata...' });
      const updateResult = await updateCatalogStructureRow(bookId, structure);
      if (updateResult.error) return updateResult;

      let totalSize = 0;
      for (const chapter of splitResult.chapters) {
        try { totalSize += fs.statSync(chapter.filepath).size; } catch {}
      }
      const storedBook = db.books[bookId] || {};
      const existingDownload = getDeviceDownload(bookId) || {};
      const preservedCoverPath = storedBook.coverPath || existingDownload.cover_path || null;
      const preservedCoverUrl = storedBook.coverUrl || catalogCoverUrl(bookId);
      setDeviceDownload(bookId, {
        ...existingDownload,
        book_id: String(bookId),
        local_path: splitResult.outDir,
        downloaded_at: new Date().toISOString(),
        file_count: splitResult.chapters.length,
        total_size: totalSize,
        cover_path: preservedCoverPath,
        s3_prefix: structure.s3Prefix,
        structure_hash: structure.structureHash,
        chapter_count: structure.chapterCount,
        chapter_filenames: structure.filenames,
      });

      const localBook = {
        ...storedBook,
        id: String(bookId),
        title: catBook.title,
        author: catBook.author || storedBook.author || '',
        series: catBook.series || storedBook.series || null,
        seriesOrder: catBook.series_order || storedBook.seriesOrder || null,
        genres: Array.isArray(catBook.genres) ? catBook.genres : (storedBook.genres || []),
        folderPath: splitResult.outDir,
        chapterCount: splitResult.chapters.length,
        chapters: splitResult.chapters,
        addedAt: storedBook.addedAt || new Date().toISOString(),
        catalogId: String(bookId),
        sourceCatalogId: String(bookId),
        s3Prefix: structure.s3Prefix,
        structureHash: structure.structureHash,
        catalogUpdatedAt: structure.updatedAt,
        uploadedBy: catBook.uploaded_by || currentUser.id,
        coverPath: preservedCoverPath,
        coverUrl: preservedCoverUrl,
        isCatalog: false,
        isCloudOnly: false,
      };
      if (storedBook.bgPath) localBook.bgPath = storedBook.bgPath;
      if (storedBook.epubPath) localBook.epubPath = storedBook.epubPath;
      if (storedBook.epubKey) localBook.epubKey = storedBook.epubKey;
      if (storedBook.hasEpub != null) localBook.hasEpub = storedBook.hasEpub;
      db.books[bookId] = localBook;
      saveDb();

      return {
        success: true,
        chaptersCreated: splitResult.chapters.length,
        localBook: { ...localBook, playback: db.playback[bookId] || null },
        structureHash: structure.structureHash,
        updatedAt: structure.updatedAt,
      };
    } catch (error) {
      return { error: error.message };
    }
  });

  ipcMain.handle('transcript:get', (_e, bookId) => {
    const book = db.books[bookId] || { id: bookId, chapters: [] };
    return readTranscriptCache(book).transcript;
  });

  ipcMain.handle('transcript:exists', (_e, bookId) => {
    const legacy = legacyTranscriptPaths(bookId).transcript;
    if (fs.existsSync(legacy)) return { exists: true, source: 'legacy' };
    const book = db.books[bookId] || { id: bookId, chapters: [] };
    const cache = readTranscriptCache(book);
    return { exists: !!cache.transcript, source: cache.transcript ? 'cache' : null };
  });

  ipcMain.handle('transcript:getWords', (_e, bookId) => {
    const book = db.books[bookId] || { id: bookId, chapters: [] };
    return readTranscriptCache(book).words;
  });

  // AI chapter detection — sliding-window scan via detect_chapters.py
  // Transcribes a short clip every stepSeconds and checks for "chapter" in the text.
  ipcMain.handle('book:detectChaptersAI', async (event, { bookId, stepSeconds = 480 }) => {
    const resolved = await resolveAudioBook(bookId, { requireSingleFile: true });
    if (resolved.error) return { error: 'book_not_found', message: resolved.error };
    const book = resolved.book;

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
    const resolved = await resolveAudioBook(bookId, { requireSingleFile: true });
    if (resolved.error) return { error: resolved.error };
    const book = resolved.book;

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

  ipcMain.handle('book:setFavorite', (_e, { bookId, favorite }) => {
    if (db.books[bookId]) {
      if (favorite) db.books[bookId].favorite = true;
      else delete db.books[bookId].favorite;
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

  ipcMain.handle('auth:getSession', async () => {
    if (currentUser) return { user: publicUser(currentUser) };
    if (isAuthSkipped()) return { skipped: true };
    return null;
  });

  ipcMain.handle('auth:login', async (_e, { email, password }) => {
    if (!supabase) return { error: 'Sync unavailable' };
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) return { error: error.message };
      // Explicitly set session so all subsequent requests carry the JWT
      await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      currentUser = await hydrateAuthUser(data.user);
      saveSession(data.session);
      setAuthSkipped(false);
      fetchAndCacheS3Config().catch(() => {});
      return { user: publicUser(currentUser) };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('auth:signup', async (_e, { email, username, password }) => {
    if (!supabase) return { error: 'Sync unavailable' };
    try {
      const trimmedEmail = String(email || '').trim();
      if (!trimmedEmail) return { error: 'Email is required.' };
      const validated = validateUsername(username);
      if (validated.error) return { error: validated.error };

      const existing = await getUserProfileByUsername(validated.value);
      if (existing) return { error: 'That username is already taken.' };

      const { data, error } = await supabase.auth.signUp({ email: trimmedEmail, password });
      if (error) return { error: error.message };
      if (data.session) {
        // Explicitly set session so all subsequent requests carry the JWT
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        currentUser = await hydrateAuthUser(data.user, validated.value);
        saveSession(data.session);
        setAuthSkipped(false);
        fetchAndCacheS3Config().catch(() => {});
        return { user: publicUser(currentUser) };
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

      const progressPushes = [];
      for (const r of pRes.data || []) {
        const bookId = String(r.book_id);
        const localProgress = normalizeProgressRecord(db.playback[bookId], bookId);
        const remoteProgress = normalizeProgressRecord(r, bookId);
        const resolvedProgress = chooseNewestProgress(localProgress, remoteProgress);

        if (resolvedProgress) {
          db.playback[bookId] = {
            chapterIndex: resolvedProgress.chapterIndex,
            position: resolvedProgress.position,
            speed: resolvedProgress.speed,
            updatedAt: resolvedProgress.updatedAt,
          };
        }

        if (
          localProgress
          && resolvedProgress
          && resolvedProgress.updatedAt === localProgress.updatedAt
          && progressTimestamp(localProgress.updatedAt) > progressTimestamp(remoteProgress?.updatedAt)
        ) {
          progressPushes.push({
            type: 'progress',
            bookId,
            bookTitle: db.books[bookId]?.title || r.book_title || '',
            chapterIndex: localProgress.chapterIndex,
            position: localProgress.position,
            speed: localProgress.speed,
            updatedAt: localProgress.updatedAt,
          });
        }
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
      for (const op of progressPushes) {
        const res = await doSync(op);
        if (!res.ok) {
          offlineQueue = offlineQueue.filter(q => !(q.type === 'progress' && q.bookId === op.bookId));
          offlineQueue.push(op);
        }
      }
      saveQueue();
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

  ipcMain.handle('s3:saveConfig', async (_e, cfg) => {
    // cfg may omit secretAccessKey if user didn't re-enter it
    const existing = loadS3Config();
    const merged = { ...existing, ...cfg };
    if (!cfg.secretAccessKey) merged.secretAccessKey = existing.secretAccessKey;
    saveS3Config(merged);
    pushS3ConfigToSupabase(merged).catch(() => {});
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

  ipcMain.handle('auth:checkApproval:legacy', async () => {
    if (!supabase || !currentUser) return { error: 'Not logged in' };
    // Admin always approved — short-circuit before any DB call
    currentUser = await hydrateAuthUser(currentUser);
    return { approved: true, user: publicUser(currentUser) };
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('approved')
        .eq('id', currentUser.id)
        .single();
      if (error?.code === 'PGRST116') {
        // Profile does not exist — create with approved=false
        await supabase.from('user_profiles').insert({
          id: currentUser.id,
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

  async function loadNormalizedCommentsForBook(bookId) {
    const { data: commentRows, error: commentError } = await supabase
      .from('comments')
      .select('*')
      .eq('book_id', bookId)
      .order('chapter_index', { ascending: true })
      .order('audio_timestamp_seconds', { ascending: true })
      .order('created_at', { ascending: true });
    if (commentError) throw new Error(commentError.message);

    const commentIds = (commentRows || []).map(row => row.id).filter(Boolean);
    let replyRows = [];
    if (commentIds.length) {
      const replyResult = await supabase
        .from('comment_replies')
        .select('*')
        .in('comment_id', commentIds)
        .order('created_at', { ascending: true });
      if (replyResult.error) throw new Error(replyResult.error.message);
      replyRows = replyResult.data || [];
    }

    const profiles = await fetchProfilesByIds([
      ...(commentRows || []).map(row => row.user_id),
      ...replyRows.map(row => row.user_id),
    ]);

    const repliesByComment = new Map();
    for (const row of replyRows) {
      const reply = normalizeReplyRow(row, profiles);
      if (!repliesByComment.has(reply.commentId)) repliesByComment.set(reply.commentId, []);
      repliesByComment.get(reply.commentId).push(reply);
    }

    return (commentRows || []).map(row => normalizeCommentRow(row, profiles, repliesByComment));
  }

  function buildCommentInsertVariants(payload) {
    const base = {
      user_id: currentUser.id,
      username: currentUser.username || null,
      book_id: payload.bookId,
      chapter_index: payload.chapterIndex,
      audio_timestamp_seconds: payload.audioTimestampSeconds,
      created_at: new Date().toISOString(),
    };
    const locationVariants = payload.selectedText
      ? [
          {
            text: payload.selectedText,
            chapter: payload.epubChapterIndex ?? null,
            paragraph: payload.epubParagraphIndex ?? null,
          },
          null,
        ]
      : [null];

    const variants = [];
    for (const textColumn of COMMENT_TEXT_COLUMNS) {
      for (const location of locationVariants) {
        if (location) {
          for (const columns of COMMENT_SELECTION_COLUMNS) {
            variants.push({
              ...base,
              [textColumn]: payload.text,
              [columns.text]: location.text,
              [columns.chapter]: location.chapter,
              [columns.paragraph]: location.paragraph,
            });
          }
        } else {
          variants.push({
            ...base,
            [textColumn]: payload.text,
          });
        }
      }
    }
    return variants;
  }

  function buildReplyInsertVariants(commentId, text) {
    return REPLY_TEXT_COLUMNS.map(column => ({
      comment_id: commentId,
      user_id: currentUser.id,
      [column]: text,
      created_at: new Date().toISOString(),
    }));
  }

  // Resolve to the canonical catalog ID so all users who own the same book
  // share the same comment thread, regardless of their local copy's UUID.
  function resolveCommentBookId(bookId) {
    const book = db.books[String(bookId)];
    return book?.sourceCatalogId || book?.catalogId || bookId;
  }

  ipcMain.handle('comments:getBook', async (_e, { bookId }) => {
    if (!supabase || !currentUser) return { error: 'Not logged in' };
    try {
      currentUser = await hydrateAuthUser(currentUser);
      return { comments: await loadNormalizedCommentsForBook(resolveCommentBookId(bookId)) };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('comments:create', async (_e, payload) => {
    if (!supabase || !currentUser) return { error: 'Not logged in' };
    const text = String(payload?.text || '').trim();
    if (!text) return { error: 'Comment cannot be empty.' };
    try {
      currentUser = await hydrateAuthUser(currentUser);
      const inserted = await insertWithVariants('comments', buildCommentInsertVariants({
        bookId: resolveCommentBookId(payload.bookId),
        chapterIndex: payload.chapterIndex,
        audioTimestampSeconds: payload.audioTimestampSeconds,
        text,
        selectedText: payload.selectedText || null,
        epubChapterIndex: payload.epubChapterIndex,
        epubParagraphIndex: payload.epubParagraphIndex,
      }));
      const profiles = await fetchProfilesByIds([inserted.user_id]);
      const comment = normalizeCommentRow(inserted, profiles, new Map());
      return { comment };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('comments:delete', async (_e, { commentId }) => {
    if (!supabase || !currentUser) return { error: 'Not logged in' };
    try {
      const { data, error } = await supabase
        .from('comments')
        .select('id, user_id')
        .eq('id', commentId)
        .limit(1);
      if (error) return { error: error.message };
      const comment = data?.[0];
      if (!comment) return { error: 'Comment not found.' };

      const { error: deleteError } = await supabase.from('comments').delete().eq('id', commentId);
      if (deleteError) return { error: deleteError.message };
      return { success: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.on('comment:reached', (_e, data) => {
    console.log('[comment:reached] supported =', Notification.isSupported(), '| data =', JSON.stringify(data));
    if (!Notification.isSupported()) return;
    const { username, text, chapterIndex, audioTimestampSeconds } = data || {};
    const n = new Notification({
      title: 'Grimoire',
      body: `${username || 'Unknown'}: ${text || ''}`,
      silent: true,
    });
    n.on('click', () => {
      mainWindow?.focus();
      mainWindow?.webContents.send('comment:seekTo', {
        chapterIndex:          chapterIndex ?? 0,
        audioTimestampSeconds: audioTimestampSeconds ?? 0,
      });
    });
    n.show();
  });

  // Cover art is always served publicly — no signing required.
  function catalogCoverUrl(bookId) {
    if (!bookId) return null;
    return `https://grimoire-library.s3.us-east-1.amazonaws.com/catalog/${bookId}/cover.jpg`;
  }

  async function catalogObjectUrl(s3Key, cfg, expiresIn = 7200) {
    if (!s3Key) throw new Error('S3 key is required');
    const bucket = cfg?.bucket || 'grimoire-library';
    dbg('catalogObjectUrl: key =', s3Key, '| bucket =', bucket, '| expiresIn =', expiresIn);
    return catalogSignedUrl(bucket, s3Key, expiresIn);
  }

  async function fetchCatalogBookById(bookId) {
    const { data: catBook, error } = await supabase
      .from('catalog')
      .select('*')
      .eq('id', bookId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!catBook) throw new Error('Catalog book not found');
    return catBook;
  }

  async function ensureCatalogOwnership(bookId) {
    const book = await fetchCatalogBookById(bookId);
    if (!currentUser?.id) throw new Error('Not authenticated');
    if (book.uploaded_by !== currentUser.id) {
      throw new Error('Only the uploader can modify this marketplace book.');
    }
    return book;
  }

  async function localizeCatalogBook(catBook, opts = {}) {
    const { onProgress, cancelRef } = opts;
    const cfg = loadS3Config();
    const structure = catalogStructureFromRow(catBook);
    dbg('localizeCatalogBook: id =', catBook?.id, '| s3_prefix =', catBook?.s3_prefix,
      '| cover_s3_key =', catBook?.cover_s3_key, '| chapters =', catBook?.chapters?.length,
      '| cfg.accessKeyId =', cfg?.accessKeyId, '| cfg.bucket =', cfg?.bucket);
    if (!catBook?.s3_prefix) throw new Error('Catalog book is missing its storage path');

    const sourceChapters = Array.isArray(catBook?.chapters) ? catBook.chapters : [];
    if (!sourceChapters.length) throw new Error('Catalog book has no chapters to download');

    const existing = db.books[catBook.id] || null;
    const targetDir = managedCatalogBookDir(catBook.id);
    ensureDir(managedLibraryRootDir());
    ensureDir(targetDir);

    const total = sourceChapters.length;
    const chapterWeight = total > 0 ? (95 / total) : 95;
    const localChapters = [];
    for (let i = 0; i < total; i++) {
      if (cancelRef?.cancelled) throw new Error('Download cancelled');
      const sourceChapter = sourceChapters[i] || {};
      const sourceFilename = String(sourceChapter.filename || '').trim();
      const filename = path.basename(sourceFilename || `Chapter ${i + 1}.mp3`);
      const filepath = path.join(targetDir, filename);
      const basePercent = i * chapterWeight;
      onProgress?.({ type: 'chapter', chapterIndex: i, chapterCount: total, filename, percent: Math.round(basePercent) });
      if (!fs.existsSync(filepath)) {
        if (!sourceFilename) throw new Error(`Catalog chapter ${i + 1} is missing a filename`);
        const s3Key = `${catBook.s3_prefix}${sourceFilename}`;
        dbg('localizeCatalogBook: downloading chapter', i + 1, '| s3Key =', s3Key);
        const url = await catalogObjectUrl(s3Key, cfg);
        const expectedBytes = await probeContentLength(url);
        await downloadToFile(url, filepath, {
          onProgress: ({ loaded, total: byteTotal }) => {
            const effectiveTotal = byteTotal || expectedBytes || 0;
            const withinChapter = effectiveTotal > 0 ? Math.min(1, loaded / effectiveTotal) : 0;
            const percent = Math.min(95, Math.round(basePercent + (withinChapter * chapterWeight)));
            onProgress?.({
              type: 'chapter',
              chapterIndex: i,
              chapterCount: total,
              filename,
              loaded,
              totalBytes: effectiveTotal,
              percent,
            });
          },
        });
      }
      onProgress?.({ type: 'chapter', chapterIndex: i, chapterCount: total, filename, percent: Math.min(95, Math.round(basePercent + chapterWeight)) });
      localChapters.push({
        id: i,
        filename,
        filepath,
        title: sourceChapter.title || chapterTitle(filename),
        duration: sourceChapter.duration || existing?.chapters?.[i]?.duration || 0,
      });
    }

    onProgress?.({ type: 'cover', chapterIndex: total, chapterCount: total, filename: 'cover image', percent: 97 });
    let coverPath = existing?.coverPath && fs.existsSync(existing.coverPath) ? existing.coverPath : null;
    const keepExistingCover = coverPath && !isPathInside(targetDir, coverPath);
    if (!keepExistingCover) {
      const managedCoverPath = path.join(targetDir, 'cover.jpg');
      if (!fs.existsSync(managedCoverPath)) {
        dbg('localizeCatalogBook: downloading cover | bookId =', catBook.id);
        const publicUrl = `https://grimoire-library.s3.us-east-1.amazonaws.com/catalog/${catBook.id}/cover.jpg`;
        try { await downloadToFile(publicUrl, managedCoverPath); }
        catch (e) { dbg('localizeCatalogBook: cover download failed -', e.message); console.warn('Catalog cover download skipped:', e.message); }
      }
      if (fs.existsSync(managedCoverPath)) coverPath = managedCoverPath;
    }

    const localizedBook = {
      ...existing,
      id: catBook.id,
      title: catBook.title,
      author: catBook.author || existing?.author || '',
      series: catBook.series || existing?.series || null,
      seriesOrder: catBook.series_order || existing?.seriesOrder || null,
      genres: Array.isArray(catBook.genres) ? catBook.genres : (existing?.genres || []),
      folderPath: targetDir,
      chapterCount: catBook.chapter_count || localChapters.length,
      addedAt: existing?.addedAt || new Date().toISOString(),
      coverPath,
      chapters: localChapters,
      managedFolder: true,
      catalogId: catBook.id,
      sourceCatalogId: catBook.id,
      s3Prefix: catBook.s3_prefix || existing?.s3Prefix || null,
      structureHash: structure.structureHash,
      catalogUpdatedAt: structure.updatedAt,
      uploadedBy: catBook.uploaded_by || existing?.uploadedBy || null,
      hasEpub: !!(existing?.epubPath || existing?.hasEpub || catBook.has_epub),
      epubKey: catBook.epub_key || existing?.epubKey || null,
      isCatalog: false,
      isCloudOnly: false,
    };

    db.books[catBook.id] = localizedBook;
    saveDb();
    return localizedBook;
  }

  // ── New per-device download system ────────────────────────────────────────
  // Downloads catalog book files to userData/Downloads/{bookId}/ and tracks
  // state in device-downloads.json (never synced to Supabase).

  async function downloadCatalogFiles(catBook, opts = {}) {
    const { onProgress, cancelRef } = opts;
    const cfg = loadS3Config();
    const structure = catalogStructureFromRow(catBook);
    const bookId = String(catBook.id);
    const targetDir = catalogDownloadDir(bookId);
    ensureDir(path.join(app.getPath('userData'), 'Downloads'));
    ensureDir(targetDir);

    const sourceChapters = Array.isArray(catBook.chapters) ? catBook.chapters : [];
    if (!sourceChapters.length) throw new Error('Catalog book has no chapters to download');

    const total = sourceChapters.length;
    const chapterWeight = total > 0 ? (90 / total) : 90;
    const localChapters = [];
    let totalSize = 0;

    for (let i = 0; i < total; i++) {
      if (cancelRef?.cancelled) throw new Error('Download cancelled');
      const sourceChapter = sourceChapters[i] || {};
      const sourceFilename = String(sourceChapter.filename || '').trim();
      const filename = path.basename(sourceFilename || `Chapter ${i + 1}.mp3`);
      const filepath = path.join(targetDir, filename);
      const basePercent = Math.round(i * chapterWeight);

      onProgress?.({ type: 'chapter', chapterIndex: i, chapterCount: total, filename, loaded: 0, totalBytes: 0, percent: basePercent });

      if (!fs.existsSync(filepath)) {
        if (!sourceFilename) throw new Error(`Catalog chapter ${i + 1} is missing a filename`);
        const s3Key = `${catBook.s3_prefix}${sourceFilename}`;
        dbg('downloadCatalogFiles: chapter', i + 1, '| s3Key =', s3Key);
        const url = await catalogObjectUrl(s3Key, cfg);
        const expectedBytes = await probeContentLength(url);
        await downloadToFile(url, filepath, {
          onProgress: ({ loaded, total: byteTotal }) => {
            const effectiveTotal = byteTotal || expectedBytes || 0;
            const within = effectiveTotal > 0 ? Math.min(1, loaded / effectiveTotal) : 0;
            const percent = Math.min(90, Math.round(basePercent + within * chapterWeight));
            onProgress?.({ type: 'chapter', chapterIndex: i, chapterCount: total, filename, loaded, totalBytes: effectiveTotal, percent });
          },
        });
      }

      try { totalSize += fs.statSync(filepath).size; } catch {}
      onProgress?.({ type: 'chapter', chapterIndex: i, chapterCount: total, filename, percent: Math.min(90, Math.round(basePercent + chapterWeight)) });
      localChapters.push({ id: i, filename, filepath, title: sourceChapter.title || chapterTitle(filename), duration: sourceChapter.duration || 0 });
    }

    // Cover — always cover.jpg, served publicly from S3
    onProgress?.({ type: 'cover', chapterIndex: total, chapterCount: total, filename: 'cover image', percent: 95 });
    let coverPath = null;
    {
      const covDest = path.join(targetDir, 'cover.jpg');
      if (!fs.existsSync(covDest)) {
        try {
          const publicUrl = `https://grimoire-library.s3.us-east-1.amazonaws.com/catalog/${bookId}/cover.jpg`;
          await downloadToFile(publicUrl, covDest);
        } catch (e) { dbg('downloadCatalogFiles: cover download failed -', e.message); }
      }
      if (fs.existsSync(covDest)) coverPath = covDest;
    }

    setDeviceDownload(bookId, {
      book_id: bookId,
      local_path: targetDir,
      downloaded_at: new Date().toISOString(),
      file_count: localChapters.length,
      total_size: totalSize,
      cover_path: coverPath,
      s3_prefix: structure.s3Prefix,
      structure_hash: structure.structureHash,
      chapter_count: structure.chapterCount,
      chapter_filenames: structure.filenames,
    });

    dbg('downloadCatalogFiles: done | bookId =', bookId, '| files =', localChapters.length, '| totalSize =', totalSize);
    return { localPath: targetDir, fileCount: localChapters.length, totalSize, coverPath, chapters: localChapters };
  }

  ipcMain.handle('catalog:getAll', async () => {
    if (!supabase) return { error: 'Supabase unavailable' };
    dbg('catalog:getAll | packaged =', app.isPackaged, '| currentUser =', currentUser?.id || 'none');
    try {
      const { data: books, error } = await supabase
        .from('catalog').select('*')
        .order('series',       { ascending: true, nullsFirst: false })
        .order('series_order', { ascending: true, nullsFirst: true })
        .order('title',        { ascending: true });
      if (error) { dbg('catalog:getAll: supabase error =', error.message); return { error: error.message }; }
      dbg('catalog:getAll: fetched', books?.length ?? 0, 'books');
      const result = await Promise.all(books.map(async b => {
        dbg('catalog:getAll: book id =', b.id, '| s3_prefix =', b.s3_prefix);
        // Cover is always public — download to local cache for offline use.
        const coverPath = await resolveCoverPath(b.id);
        const dlRecord = getDeviceDownload(b.id);
        const downloadedLocally = !!(dlRecord?.local_path && fs.existsSync(dlRecord.local_path) && catalogDownloadRecordIsCurrent(dlRecord, b));
        const structure = catalogStructureFromRow(b);
        return {
          ...b,
          updated_at: b.updated_at || structure.updatedAt,
          structure_hash: b.structure_hash || structure.structureHash,
          genres: Array.isArray(b.genres) ? b.genres : [],
          coverPath,
          coverUrl: null,
          downloadedLocally,
        };
      }));
      return { books: result };
    } catch (e) { dbg('catalog:getAll: exception -', e.message); return { error: e.message }; }
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

      const result = await Promise.all(entries.map(async entry => {
        const cat = catBooks.find(b => b.id === entry.book_id);
        if (!cat) return null;
        const structure = catalogStructureFromRow(cat);

        // Check device-local download state
        const dlRecord = getDeviceDownload(entry.book_id);
        const downloadedLocally = !!(dlRecord?.local_path && fs.existsSync(dlRecord.local_path) && catalogDownloadRecordIsCurrent(dlRecord, cat));
        const localPath = downloadedLocally ? dlRecord.local_path : null;

        const chapters = (cat.chapters || []).map((ch, i) => {
          const base = {
            id: i, filename: ch.filename,
            title: ch.title || `Chapter ${i + 1}`,
            duration: ch.duration || 0,
          };
          if (downloadedLocally && localPath) {
            base.filepath = path.join(localPath, ch.filename);
          }
          return base;
        });

        // Cover: prefer local download copy, fall back to public S3 URL
        let coverUrl = null;
        let coverPath = null;
        if (downloadedLocally && dlRecord.cover_path && fs.existsSync(dlRecord.cover_path)) {
          coverPath = dlRecord.cover_path;
        } else {
          coverUrl = catalogCoverUrl(cat.id);
        }

        return {
          id:              cat.id,
          title:           cat.title,
          author:          cat.author || '',
          series:          cat.series || null,
          seriesOrder:     cat.series_order || null,
          genres:          Array.isArray(cat.genres) ? cat.genres : [],
          s3Prefix:        cat.s3_prefix,
          chapters,
          chapterCount:    cat.chapter_count || chapters.length,
          coverUrl,        coverPath,
          isCloudOnly:     !downloadedLocally,
          isCatalog:       true,
          hasEpub:         cat.has_epub  || false,
          epubKey:         cat.epub_key  || null,
          uploadedBy:      cat.uploaded_by || null,
          addedAt:         entry.added_at,
          structureHash:   structure.structureHash,
          catalogUpdatedAt: structure.updatedAt,
          playback:        db.playback[cat.id] || null,
          downloadedLocally,
          localPath,
        };
      }));
      return { books: result.filter(Boolean) };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('catalog:addToLibrary', async (event, { bookId }) => {
    dbg('catalog:addToLibrary: bookId =', bookId, '| currentUser =', currentUser?.id || 'none', '| packaged =', app.isPackaged);
    if (!supabase || !currentUser) return { error: 'Not logged in' };
    let insertedLibraryRow = false;
    const cancelRef = { cancelled: false };
    _downloadCancelRefs.set(bookId, cancelRef);
    try {
      const catBook = await fetchCatalogBookById(bookId);
      dbg('catalog:addToLibrary: catBook id =', catBook?.id, '| s3_prefix =', catBook?.s3_prefix, '| chapters =', catBook?.chapters?.length);

      const { data: existing } = await supabase
        .from('user_library').select('id')
        .eq('user_id', currentUser.id).eq('book_id', bookId).maybeSingle();

      if (!existing) {
        const { error } = await supabase.from('user_library').insert({
          user_id: currentUser.id, book_id: bookId,
        });
        if (error) return { error: error.message };
        insertedLibraryRow = true;
      }

      const result = await downloadCatalogFiles(catBook, {
        cancelRef,
        onProgress: (prog) => {
          try { event.sender.send('catalog:downloadProgress', { bookId, ...prog }); } catch {}
        },
      });

      event.sender.send('catalog:downloadProgress', { bookId, type: 'done', percent: 100 });
      return {
        success: true,
        alreadyAdded: !!existing,
        downloaded: true,
        localPath: result.localPath,
        chapters: result.chapters,
        coverPath: result.coverPath,
      };
    } catch (e) {
      if (cancelRef.cancelled) {
        if (insertedLibraryRow) {
          try { await supabase.from('user_library').delete().eq('user_id', currentUser.id).eq('book_id', bookId); } catch {}
        }
        // Clean up partial download
        const dir = catalogDownloadDir(bookId);
        if (fs.existsSync(dir)) try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
        clearDeviceDownload(bookId);
        return { cancelled: true };
      }
      if (insertedLibraryRow) {
        try { await supabase.from('user_library').delete().eq('user_id', currentUser.id).eq('book_id', bookId); } catch {}
      }
      return { error: e.message };
    } finally {
      _downloadCancelRefs.delete(bookId);
    }
  });

  ipcMain.handle('catalog:cancelDownload', (_e, { bookId }) => {
    const ref = _downloadCancelRefs.get(bookId);
    if (ref) ref.cancelled = true;
    return { ok: true };
  });

  // Download files for a book already in user_library
  ipcMain.handle('catalog:download', async (event, { bookId }) => {
    if (!supabase || !currentUser) return { error: 'Not logged in' };
    const cancelRef = { cancelled: false };
    _downloadCancelRefs.set(bookId, cancelRef);
    try {
      const catBook = await fetchCatalogBookById(bookId);
      const result = await downloadCatalogFiles(catBook, {
        cancelRef,
        onProgress: (prog) => {
          try { event.sender.send('catalog:downloadProgress', { bookId, ...prog }); } catch {}
        },
      });
      event.sender.send('catalog:downloadProgress', { bookId, type: 'done', percent: 100 });
      return { success: true, localPath: result.localPath, chapters: result.chapters, coverPath: result.coverPath };
    } catch (e) {
      if (cancelRef.cancelled) return { cancelled: true };
      return { error: e.message };
    } finally {
      _downloadCancelRefs.delete(bookId);
    }
  });

  // Delete local files for a downloaded catalog book (keeps Supabase user_library entry)
  ipcMain.handle('catalog:removeLocalFiles', (_e, { bookId }) => {
    try {
      const dir = catalogDownloadDir(bookId);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      clearDeviceDownload(bookId);
      return { success: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Re-download: clear existing files then download fresh
  ipcMain.handle('catalog:redownload', async (event, { bookId }) => {
    // Clear existing local files first
    try {
      const dir = catalogDownloadDir(bookId);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
    clearDeviceDownload(bookId);

    if (!supabase || !currentUser) return { error: 'Not logged in' };
    const cancelRef = { cancelled: false };
    _downloadCancelRefs.set(bookId, cancelRef);
    try {
      const catBook = await fetchCatalogBookById(bookId);
      const result = await downloadCatalogFiles(catBook, {
        cancelRef,
        onProgress: (prog) => {
          try { event.sender.send('catalog:downloadProgress', { bookId, ...prog }); } catch {}
        },
      });
      event.sender.send('catalog:downloadProgress', { bookId, type: 'done', percent: 100 });
      return { success: true, localPath: result.localPath, chapters: result.chapters, coverPath: result.coverPath };
    } catch (e) {
      if (cancelRef.cancelled) return { cancelled: true };
      return { error: e.message };
    } finally {
      _downloadCancelRefs.delete(bookId);
    }
  });

  // Return the device-local download record for a book
  ipcMain.handle('catalog:getDownloadState', (_e, { bookId }) => {
    return getDeviceDownload(bookId);
  });

  ipcMain.handle('catalog:removeFromLibrary', async (_e, { bookId }) => {
    if (!supabase || !currentUser) return { error: 'Not logged in' };
    try {
      const { error } = await supabase.from('user_library')
        .delete().eq('user_id', currentUser.id).eq('book_id', bookId);
      if (error) return { error: error.message };
      // Clean up old-system managed book if present
      if (db.books[bookId] && isManagedCatalogBook(db.books[bookId], bookId)) {
        deleteBookRecord(bookId, { cleanupManaged: true });
      } else {
        delete db.playback[bookId];
        delete db.bookmarks[bookId];
        saveDb();
      }
      // Clean up new-system device download if present
      const dir = catalogDownloadDir(bookId);
      if (fs.existsSync(dir)) try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      clearDeviceDownload(bookId);
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

    // Upload cover art — always convert to JPEG 500×500 max and upload as cover.jpg
    let coverS3Key = null;
    if (coverPath && fs.existsSync(coverPath)) {
      coverS3Key = `${s3Prefix}cover.jpg`;
      event.sender.send('catalog:uploadProgress', { type: 'status', message: 'Processing cover…', progress: 90 });
      try {
        const sharp = require('sharp');
        const coverBuffer = await sharp(coverPath)
          .resize(500, 500, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        event.sender.send('catalog:uploadProgress', { type: 'status', message: 'Uploading cover…', progress: 92 });
        await s3.send(new PutObjectCommand({
          Bucket: cfg.bucket, Key: coverS3Key,
          Body: coverBuffer,
          ContentType: 'image/jpeg',
        }));
      } catch (e) { console.error('Cover upload failed:', e.message); coverS3Key = null; }
    }

    // Insert catalog row
    event.sender.send('catalog:uploadProgress', { type: 'status', message: 'Saving to marketplace…', progress: 97 });
    const structure = catalogStructurePayload({
      s3Prefix,
      chapterCount: files.length,
      chapters: files.map((filename, i) => ({ filename, title: chapterTitle(filename), duration: 0 })),
    });
    const { error: insertErr } = await supabase.from('catalog').insert({
      id: bookId, s3_prefix: s3Prefix,
      title, author, series, series_order: seriesOrder,
      chapter_count: structure.chapterCount, chapters: structure.chapters,
      updated_at: structure.updatedAt,
      structure_hash: structure.structureHash,
      cover_s3_key: coverS3Key,
      uploaded_by: currentUser?.id || null,
    });
    if (insertErr) {
      if (isUnknownColumnError(insertErr)) {
        return { error: 'Catalog schema is missing updated_at or structure_hash. Run the catalog structure migration first.' };
      }
      return { error: 'Failed to save book: ' + insertErr.message };
    }

    event.sender.send('catalog:uploadProgress', { type: 'done', message: 'Upload complete!', progress: 100 });
    return { success: true, bookId, chapterCount: files.length };
  });

  ipcMain.handle('catalog:editBook', async (_e, { bookId, title, author, series, seriesOrder, genres }) => {
    if (!supabase || !currentUser) return { error: 'Not authenticated' };
    try {
      await ensureCatalogOwnership(bookId);
      const updates = {};
      if (title   !== undefined) updates.title        = String(title   || '').trim() || null;
      if (author  !== undefined) updates.author       = String(author  || '').trim() || null;
      if (series  !== undefined) updates.series       = String(series  || '').trim() || null;
      if (seriesOrder !== undefined) updates.series_order = seriesOrder ? parseInt(String(seriesOrder), 10) : null;
      if (genres !== undefined) {
        updates.genres = Array.isArray(genres)
          ? genres.map(g => String(g || '').trim()).filter(Boolean)
          : [];
      }
      if (!updates.title) return { error: 'Title is required' };
      const { error } = await supabase.from('catalog').update(updates).eq('id', bookId);
      if (error) {
        if (isUnknownColumnError(error)) {
          return { error: 'Catalog schema is missing the genres column. Add that column first, then try again.' };
        }
        return { error: error.message };
      }
      return { success: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('catalog:deleteBook', async (_e, { bookId }) => {
    if (!supabase || !currentUser) return { error: 'Not authenticated' };
    try {
      const book = await ensureCatalogOwnership(bookId);

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

  // ── EPUB ─────────────────────────────────────────────────────────────────────

  ipcMain.handle('dialog:openEpubFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Select EPUB File',
      filters: [{ name: 'EPUB Books', extensions: ['epub'] }],
    });
    return canceled ? null : filePaths[0];
  });

  ipcMain.handle('epub:attachLocal', async (_e, { bookId, epubPath }) => {
    const book = db.books[bookId];
    if (!book) return { error: 'Book not found' };
    try {
      for (const key of epubMemoryCache.keys()) {
        if (key.includes(`"bookId":"${bookId}"`)) epubMemoryCache.delete(key);
      }
      const epubDir = path.join(app.getPath('userData'), 'epubs');
      if (!fs.existsSync(epubDir)) fs.mkdirSync(epubDir, { recursive: true });
      const dest = path.join(epubDir, `${bookId}.epub`);
      fs.copyFileSync(epubPath, dest);
      book.epubPath = dest;
      book.hasEpub = true;
      saveDb();
      // Invalidate parse cache
      const cf = path.join(app.getPath('userData'), 'epub-cache', `${bookId}.json`);
      if (fs.existsSync(cf)) try { fs.unlinkSync(cf); } catch {}
      return { success: true };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('epub:attachCatalog', async (event, { bookId, epubPath }) => {
    if (!supabase || !currentUser) return { error: 'Not logged in' };
    const cfg = loadS3Config();
    if (!cfg?.accessKeyId) return { error: 'S3 not configured' };
    try {
      await ensureCatalogOwnership(bookId);
      for (const key of epubMemoryCache.keys()) {
        if (key.includes(`"bookId":"${bookId}"`)) epubMemoryCache.delete(key);
      }
      const { Upload } = require('@aws-sdk/lib-storage');
      const s3 = createS3Client(cfg);
      const s3Key = `catalog/${bookId}/book.epub`;
      event.sender.send('epub:uploadProgress', { progress: 0, message: 'Uploading EPUB…' });
      const uploader = new Upload({
        client: s3,
        params: { Bucket: cfg.bucket, Key: s3Key, Body: fs.createReadStream(epubPath), ContentType: 'application/epub+zip' },
      });
      uploader.on('httpUploadProgress', ({ loaded, total }) => {
        if (total) event.sender.send('epub:uploadProgress', { progress: Math.round(loaded / total * 90) });
      });
      await uploader.done();
      const { error } = await supabase.from('catalog').update({ epub_key: s3Key, has_epub: true }).eq('id', bookId);
      if (error) return { error: error.message };
      // Cache a local copy and invalidate parse cache
      try {
        const epubDir = path.join(app.getPath('userData'), 'epubs');
        if (!fs.existsSync(epubDir)) fs.mkdirSync(epubDir, { recursive: true });
        fs.copyFileSync(epubPath, path.join(epubDir, `${bookId}.epub`));
        const cf = path.join(app.getPath('userData'), 'epub-cache', `${bookId}.json`);
        if (fs.existsSync(cf)) try { fs.unlinkSync(cf); } catch {}
      } catch {}
      event.sender.send('epub:uploadProgress', { progress: 100, message: 'Done!' });
      return { success: true, epubKey: s3Key };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('epub:ensureAndParse', async (_e, { bookId, epubKey, chapterCount, audioChapters, bookTitle }) => {
    const cacheDir = path.join(app.getPath('userData'), 'epub-cache');
    const cacheFile = path.join(cacheDir, `${bookId}.json`);
    const cacheKey = JSON.stringify({
      bookId,
      bookTitle: bookTitle || '',
    });
    if (epubMemoryCache.has(cacheKey)) {
      return epubMemoryCache.get(cacheKey);
    }
    if (fs.existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        const meta = cached?.meta || null;
        const sections = Array.isArray(cached?.sections)
          ? cached.sections
          : (Array.isArray(cached?.chapters) ? cached.chapters : (Array.isArray(cached) ? cached : []));
        if (sections.length && (!meta || meta.mode === 'plain-reader')) {
          const normalized = { sections };
          epubMemoryCache.set(cacheKey, normalized);
          return normalized;
        }
      } catch {}
    }
    let epubPath = null;
    if (db.books[bookId]?.epubPath && fs.existsSync(db.books[bookId].epubPath))
      epubPath = db.books[bookId].epubPath;
    const epubDir = path.join(app.getPath('userData'), 'epubs');
    const cachedEpub = path.join(epubDir, `${bookId}.epub`);
    if (!epubPath && fs.existsSync(cachedEpub)) epubPath = cachedEpub;
    if (!epubPath && epubKey) {
      const cfg = loadS3Config();
      if (!cfg?.accessKeyId) return { error: 'S3 not configured' };
      try {
        const { GetObjectCommand } = require('@aws-sdk/client-s3');
        const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
        const url = await getSignedUrl(
          createS3Client(cfg),
          new GetObjectCommand({ Bucket: cfg.bucket, Key: epubKey }),
          { expiresIn: 900 }
        );
        if (!fs.existsSync(epubDir)) fs.mkdirSync(epubDir, { recursive: true });
        await downloadToFile(url, cachedEpub);
        epubPath = cachedEpub;
      } catch (e) { return { error: 'Failed to download EPUB: ' + e.message }; }
    }
    if (!epubPath) return { error: 'No EPUB file found. Attach one first via right-click.' };
    try {
      const parsed = await parseEpubFile(epubPath);
      const sections = (parsed || [])
        .filter(section => Array.isArray(section?.paragraphs) && section.paragraphs.length)
        .map((section, index) => ({
          title: section.title || `Section ${index + 1}`,
          paragraphs: section.paragraphs,
          kind: 'section',
          syncIndex: index,
        }));
      const normalized = { sections };
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({
        meta: {
          mode: 'plain-reader',
          bookTitle: bookTitle || '',
        },
        ...normalized,
        chapters: normalized.sections,
      }), 'utf8');
      epubMemoryCache.set(cacheKey, normalized);
      return normalized;
    } catch (e) { return { error: 'EPUB parse error: ' + e.message }; }
  });

  ipcMain.handle('epub:getReadingPos', (_e, { bookId }) => {
    try {
      const f = path.join(app.getPath('userData'), 'epub-reading-pos.json');
      if (fs.existsSync(f)) {
        const data = JSON.parse(fs.readFileSync(f, 'utf8'));
        const key = currentUser?.id || 'local';
        return data[key]?.[bookId] || {};
      }
    } catch {}
    return {};
  });

  ipcMain.handle('epub:saveReadingPos', (_e, { bookId, position }) => {
    try {
      const f = path.join(app.getPath('userData'), 'epub-reading-pos.json');
      let d = {};
      try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
      const key = currentUser?.id || 'local';
      if (!d[key]) d[key] = {};
      d[key][bookId] = position || {};
      fs.writeFileSync(f, JSON.stringify(d), 'utf8');
    } catch {}
    return { success: true };
  });

  ipcMain.handle('epub:getReaderSettings', () => {
    try {
      const f = path.join(app.getPath('userData'), 'epub-reader-settings.json');
      if (fs.existsSync(f)) {
        const all = JSON.parse(fs.readFileSync(f, 'utf8'));
        return all[currentUser?.id || 'local'] || null;
      }
    } catch {}
    return null;
  });

  ipcMain.handle('epub:saveReaderSettings', (_e, settings) => {
    try {
      const f = path.join(app.getPath('userData'), 'epub-reader-settings.json');
      let all = {};
      try { all = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
      all[currentUser?.id || 'local'] = settings;
      fs.writeFileSync(f, JSON.stringify(all, null, 2), 'utf8');
    } catch {}
    return { success: true };
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
