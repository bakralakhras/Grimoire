'use strict';

// ── DOM helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = el => el.classList.remove('hidden');
const hide = el => el.classList.add('hidden');
const toggle = (el, on) => el.classList.toggle('hidden', !on);

// ── State ────────────────────────────────────────────────────────────────────
const S = {
  books: [],
  currentBook: null,
  chapterIndex: 0,
  bookmarks: [],
  isPlaying: false,
  isSeeking: false,
  volume: 1,
  speed: 1,
  searchQuery: '',
  view: 'library',
  ctxBookId: null,
  ctxTranscript: null,
  sleepTimer: null,
  sleepTimerEnd: null,
  sleepInterval: null,
  saveInterval: null,
  syncInterval: null,
};

const SMART_SYNC_UI = {
  byBookId: {},
  startingBookIds: new Set(),
  progressListenerAttached: false,
  refreshToken: 0,
};

const COMMENTS = {
  byBookId: {},
  pollTimer: null,
  requestToken: 0,
  triggeredIds: new Set(),
  toastQueue: [],
  activeToast: null,
  toastShowTimer: null,
  toastHideTimer: null,
  lastBookId: null,
  lastChapterIndex: 0,
  lastPlaybackTime: 0,
  composerContext: null,
  epubSelection: null,
};

// ── Auth / sync state ─────────────────────────────────────────────────────────
let authUser = null;      // { id, email, username } when logged in
let _progressPushTimer = null;

// ── EPUB state ────────────────────────────────────────────────────────────────
const EPUB_DEFAULT_SETTINGS = {
  fontFamily:       'Georgia',
  fontSize:         18,
  lineHeight:       1.7,
  letterSpacing:    0,
  wordSpacing:      0,
  paragraphSpacing: 20,
  marginH:          80,
  textAlign:        'left',
  bgColor:          '#1a1625',
  textColor:        '#e8e0d0',
  columnWidth:      'medium',
  hyphenation:      true,
};
const EPUB_COLUMN_WIDTHS = { single: 0, narrow: 520, medium: 680, wide: 860 };
const EPUB_FONTS = [
  { label: 'Georgia',       value: 'Georgia, serif' },
  { label: 'Palatino',      value: '"Palatino Linotype", Palatino, serif' },
  { label: 'Crimson',       value: '"Crimson Text", serif' },
  { label: 'Garamond',      value: '"EB Garamond", serif' },
  { label: 'Lora',          value: 'Lora, serif' },
  { label: 'Open Sans',     value: '"Open Sans", sans-serif' },
  { label: 'Source Sans',   value: '"Source Sans 3", sans-serif' },
  { label: 'Roboto',        value: 'Roboto, sans-serif' },
  { label: 'Courier New',   value: '"Courier New", monospace' },
  { label: 'iA Writer Mono',value: '"iA Writer Mono", "IBM Plex Mono", monospace' },
];
const EPUB_BG_PRESETS = [
  { label: 'Black',      color: '#0a0a0f' },
  { label: 'Dark',       color: '#1a1625' },
  { label: 'Sepia',      color: '#f4ecd8' },
  { label: 'Warm White', color: '#faf8f5' },
  { label: 'White',      color: '#ffffff' },
  { label: 'Dark Blue',  color: '#0d1117' },
];
const EPUB_TEXT_PRESETS = [
  { label: 'Warm',    color: '#e8e0d0' },
  { label: 'White',   color: '#ffffff' },
  { label: 'Muted',   color: '#c0b8ac' },
  { label: 'Dark',    color: '#1a1008' },
  { label: 'Sepia',   color: '#5c4a2a' },
];

const EPUB = {
  chapters: [],
  frontMatterCount: 0,
  backMatterCount: 0,
  storyStartIndex: 0,
  currentChapter: 0,
  isOpen: false,
  tocOpen: true,
  appSidebarOpen: true,
  audioPanelsOpen: true,
  readerOnly: false,
  readingPos: {},
  sectionEls: [],
  currentScrollSource: 'user',
  scrollReleaseAt: 0,
  activeRaf: null,
  _saveTimer: null,
  _scrollTimer: null,
  _resizeTimer: null,
  settings: { ...EPUB_DEFAULT_SETTINGS },
};

// ── Audio ────────────────────────────────────────────────────────────────────
const audio = new Audio();

// ── Karaoke state ─────────────────────────────────────────────────────────────
const KARAOKE = {
  enabled:         false,
  rafId:           null,
  lastActive:      null,
  // chapterIndex (number) → [{span, start, end}] sorted by start time
  index:           {},
  // All chapters appended so far — used to re-render in fullscreen
  chapters:        [],   // [{num, title, text, words}]
  loadedBookId:    null,
  loadedBookTitle: '',
  isFullscreen:    false,
};

// ── Utilities ────────────────────────────────────────────────────────────────
function fmt(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function pathToUrl(p) {
  if (!p) return '';
  // Windows C:\... -> file:///C:/...
  return 'file:///' + p.replace(/\\/g, '/');
}

function bookColor(title) {
  let h = 5381;
  for (let i = 0; i < title.length; i++) { h = ((h << 5) + h) ^ title.charCodeAt(i); h = h & h; }
  const hue = Math.abs(h % 360);
  return {
    bg: `linear-gradient(145deg, hsl(${hue},30%,16%) 0%, hsl(${(hue+50)%360},22%,9%) 100%)`,
    text: `hsl(${hue},65%,72%)`,
  };
}

function initials(title) {
  return (title || '?').split(/\s+/).filter(w => w.length > 1).slice(0, 2).map(w => w[0].toUpperCase()).join('') || title[0].toUpperCase();
}

function displayUsername(user = authUser) {
  if (!user) return 'Not signed in';
  return user.username || (user.email ? user.email.split('@')[0] : 'User');
}

function truncateText(value, max = 64) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function avatarHue(seed) {
  const text = String(seed || 'user');
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash % 360);
}

function commentTimeLabel(comment) {
  return `Ch ${Number(comment.chapterIndex || 0) + 1} · ${fmt(comment.audioTimestampSeconds || 0)}`;
}

function normalizeLibraryBookMatchText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function linkedCatalogBookId(book) {
  if (!book) return null;
  return book.sourceCatalogId || book.catalogId || (book.isCatalog ? book.id : null);
}

function libraryBooksMatch(localBook, catalogBook) {
  if (!localBook || !catalogBook) return false;
  if (localBook.id === catalogBook.id) return true;
  if (linkedCatalogBookId(localBook) === catalogBook.id) return true;
  const localCount = localBook.chapterCount || localBook.chapters?.length || 0;
  const catalogCount = catalogBook.chapterCount || catalogBook.chapters?.length || 0;
  if (localCount && catalogCount && localCount !== catalogCount) return false;

  const localTitle = normalizeLibraryBookMatchText(localBook.title);
  const catalogTitle = normalizeLibraryBookMatchText(catalogBook.title);
  if (!localTitle || !catalogTitle) return false;

  const titleMatch = localTitle.includes(catalogTitle) || catalogTitle.includes(localTitle);
  if (!titleMatch) return false;

  const localAuthor = normalizeLibraryBookMatchText(localBook.author);
  const catalogAuthor = normalizeLibraryBookMatchText(catalogBook.author);
  if (!catalogAuthor) return true;
  return !localAuthor || localAuthor === catalogAuthor || localTitle.includes(catalogAuthor);
}

function mergeVisibleLibraryBooks(localBooks, catalogBooks) {
  const merged = [...localBooks];
  for (const catalogBook of catalogBooks) {
    const hasLocalTwin = localBooks.some(localBook => libraryBooksMatch(localBook, catalogBook));
    if (!hasLocalTwin) merged.push(catalogBook);
  }
  return merged;
}

function catalogBookIsInLibrary(catalogBookId) {
  return S.books.some(book =>
    book?.id === catalogBookId || linkedCatalogBookId(book) === catalogBookId
  );
}

function catalogBookHasLocalCopy(catalogBookId) {
  return S.books.some(book =>
    !book?.isCatalog && (book?.id === catalogBookId || linkedCatalogBookId(book) === catalogBookId)
  );
}

function getLibraryRemovalCatalogId(book) {
  const linkedId = linkedCatalogBookId(book);
  if (!linkedId) return null;
  if (book?.isCatalog) return book.id;
  if (book?.managedFolder) return linkedId;
  return null;
}

// ── Star rating helpers ───────────────────────────────────────────────────────
function starsStaticHTML(rating) {
  let html = '<div class="star-row">';
  for (let i = 1; i <= 5; i++) {
    if (rating >= i) html += '<span class="star star-full">★</span>';
    else if (rating >= i - 0.5) html += '<span class="star star-half">★</span>';
    else html += '<span class="star star-empty">★</span>';
  }
  html += '</div>';
  return html;
}

function starsInputHTML() {
  return [1,2,3,4,5].map(i =>
    `<span class="si empty" data-pos="${i}">★</span>`
  ).join('') + '<span class="star-tip"></span>';
}

function renderStarElements(els, value) {
  els.forEach((si, i) => {
    const pos = i + 1;
    const base = si.className.replace(/\s*(full|half|empty)/, '');
    const state = value >= pos ? 'full' : (value >= pos - 0.5 ? 'half' : 'empty');
    si.className = `${base} ${state}`;
  });
}

function renderCardStars(card, value) {
  const sis = Array.from(card.querySelectorAll('.book-stars-input .si'));
  renderStarElements(sis, value);
  const tip = card.querySelector('.star-tip');
  if (tip) tip.textContent = value > 0 ? `${value}/5` : '';
}

async function rateBook(bookId, rating) {
  await api.setRating({ bookId, rating });
  const book = S.books.find(b => b.id === bookId);
  if (book) book.rating = rating;
  if (S.currentBook?.id === bookId) {
    S.currentBook.rating = rating;
    renderNowStars(rating);
  }
  renderLibrary();
  api.sync.push({ type: 'rating', bookId, rating });
}

async function clearRating(bookId) {
  await api.setRating({ bookId, rating: null });
  const book = S.books.find(b => b.id === bookId);
  if (book) delete book.rating;
  if (S.currentBook?.id === bookId) {
    delete S.currentBook.rating;
    renderNowStars(0);
  }
  renderLibrary();
  api.sync.push({ type: 'rating', bookId, rating: null });
}

function renderNowStars(value) {
  const sis = Array.from($('now-stars').querySelectorAll('.si-now'));
  renderStarElements(sis, value);
}

// Strip book-title noise from chapter filenames and format as "Chapter N".
//
// Handles two common audiobook naming patterns:
//   "Book Title Series Blurb 007"  → "Chapter 7"   (trailing track number)
//   "Book Title - Chapter Name"    → "Chapter Name" (meaningful subtitle)
function cleanChapterTitle(rawTitle, bookTitle, index) {
  let t = rawTitle.trim();

  // 1. Strip book title prefix using alphanumeric-only comparison so punctuation is ignored.
  //    "Morning Star Book III…" with book "Morning Star" → "Book III…"
  if (bookTitle) {
    const norm   = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normT  = norm(t);
    const normB  = norm(bookTitle);
    if (normB && normT.startsWith(normB)) {
      // Walk the original string, counting alphanumeric chars until we've matched normB.length
      let matched = 0;
      let i = 0;
      while (i < t.length && matched < normB.length) {
        if (/[a-z0-9]/i.test(t[i])) matched++;
        i++;
      }
      // Skip any trailing separator chars (space, dash, colon, etc.)
      while (i < t.length && /[\s\-_:.,]/.test(t[i])) i++;
      t = t.slice(i).trim();
    }
  }

  // 2. Pure number (e.g. after stripping the prefix we get "007") → "Chapter N"
  if (/^\d+$/.test(t)) return `Chapter ${parseInt(t, 10)}`;

  // 3. Trailing number (e.g. "Book III of the Red Rising Trilogy 007" or
  //    what's left after a partial strip) → "Chapter N"
  const endNum = t.match(/\s(\d{1,4})\s*$/);
  if (endNum) return `Chapter ${parseInt(endNum[1], 10)}`;

  // 4. Explicit "Chapter N …" or "Ch. N …" prefix with a subtitle → just the subtitle
  const chPfx = t.match(/^ch(?:apter)?\.?\s*(\d+)[\s\-:_.]+(.+)/i);
  if (chPfx) return chPfx[2].trim();

  // 5. Explicit "Chapter N" with no subtitle → normalise number
  const chOnly = t.match(/^ch(?:apter)?\.?\s*(\d+)\s*$/i);
  if (chOnly) return `Chapter ${parseInt(chOnly[1], 10)}`;

  // 6. Nothing to clean — return as-is (it's already a meaningful chapter name)
  return t || `Chapter ${index + 1}`;
}

function bookProgress(book) {
  const pb = book.playback;
  if (!pb || !book.chapters?.length) return 0;
  const total = book.chapters.reduce((s, c) => s + (c.duration || 0), 0);
  if (total > 0) {
    let elapsed = book.chapters.slice(0, pb.chapterIndex).reduce((s, c) => s + (c.duration || 0), 0);
    elapsed += pb.position || 0;
    return Math.min(elapsed / total, 1);
  }
  return pb.chapterIndex / book.chapters.length;
}

// ── Transcript panel ─────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function openTranscriptPanel(book) {
  $('tp-book-title').textContent = book.title;
  $('tp-status').textContent = '';
  $('tp-status').classList.remove('active');
  $('tp-body').innerHTML = '';
  KARAOKE.chapters        = [];
  KARAOKE.index           = {};
  KARAOKE.lastActive      = null;
  KARAOKE.loadedBookId    = book.id;
  KARAOKE.loadedBookTitle = book.title;
  $('transcript-panel').classList.add('open');
  $('player-view').classList.add('panel-open');
  $('btn-transcript').classList.add('tp-active');
}

function closeTranscriptPanel() {
  if (KARAOKE.isFullscreen) closeReaderFullscreen();
  stopKaraoke();
  $('transcript-panel').classList.remove('open');
  $('player-view').classList.remove('panel-open');
  $('btn-transcript').classList.remove('tp-active');
}

// ── Karaoke helpers ───────────────────────────────────────────────────────────

function _buildSectionIndex(chIdx, section) {
  const entries = [];
  section.querySelectorAll('.tp-word').forEach(span => {
    entries.push({ span, start: parseFloat(span.dataset.start), end: parseFloat(span.dataset.end) });
  });
  KARAOKE.index[chIdx] = entries; // already in DOM order = start-time order
}

function _rebuildIndexFromContainer(container) {
  KARAOKE.index = {};
  if (KARAOKE.lastActive) { KARAOKE.lastActive.classList.remove('active'); KARAOKE.lastActive = null; }
  const byChapter = {};
  container.querySelectorAll('.tp-word[data-chapter]').forEach(span => {
    const ci = parseInt(span.dataset.chapter, 10);
    if (!byChapter[ci]) byChapter[ci] = [];
    byChapter[ci].push({ span, start: parseFloat(span.dataset.start), end: parseFloat(span.dataset.end) });
  });
  Object.assign(KARAOKE.index, byChapter);
}

function _findWordAt(chIdx, t) {
  const words = KARAOKE.index[chIdx];
  if (!words || !words.length) return null;
  if (t < words[0].start || t > words[words.length - 1].end) return null;
  let lo = 0, hi = words.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = words[mid];
    if (w.end <= t) lo = mid + 1;
    else if (w.start > t) hi = mid - 1;
    else return w.span;
  }
  return null;
}

function karaokeStep() {
  if (!KARAOKE.enabled) return;
  const span = _findWordAt(S.chapterIndex, audio.currentTime);
  if (span !== KARAOKE.lastActive) {
    if (KARAOKE.lastActive) KARAOKE.lastActive.classList.remove('active');
    KARAOKE.lastActive = span;
    if (span) {
      span.classList.add('active');
      span.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  KARAOKE.rafId = requestAnimationFrame(karaokeStep);
}

function startKaraoke() {
  KARAOKE.enabled = true;
  if (KARAOKE.rafId) cancelAnimationFrame(KARAOKE.rafId);
  KARAOKE.rafId = requestAnimationFrame(karaokeStep);
  $('tp-follow-btn').classList.add('active');
  $('rfs-follow-btn').classList.add('active');
}

function stopKaraoke() {
  KARAOKE.enabled = false;
  if (KARAOKE.rafId) { cancelAnimationFrame(KARAOKE.rafId); KARAOKE.rafId = null; }
  if (KARAOKE.lastActive) { KARAOKE.lastActive.classList.remove('active'); KARAOKE.lastActive = null; }
  $('tp-follow-btn').classList.remove('active');
  $('rfs-follow-btn').classList.remove('active');
}

function toggleKaraoke() {
  if (KARAOKE.enabled) stopKaraoke(); else startKaraoke();
}

// ── Fullscreen reader ─────────────────────────────────────────────────────────

function _appendChapterToEl(container, num, title, text, words) {
  const chIdx = num - 1;
  const section = document.createElement('div');
  section.className = 'tp-chapter';

  let textHTML;
  if (words && words.length) {
    textHTML = words.map(w =>
      `<span class="tp-word" data-chapter="${chIdx}" data-start="${w.start}" data-end="${w.end}">${escHtml(w.word)}</span>`
    ).join('');
  } else {
    textHTML = escHtml(text || '(no text)');
  }

  // Suppress the title suffix if it is just "Chapter N" / "Chapter 002" —
  // the heading already starts with "Chapter N", repeating it is redundant.
  const titleSuffix = (() => {
    if (!title) return '';
    const m = title.match(/^ch(?:apter)?\.?\s*0*(\d+)\s*$/i);
    if (m && parseInt(m[1], 10) === num) return '';
    return ': ' + escHtml(title);
  })();

  section.innerHTML =
    `<p class="tp-ch-heading">Chapter ${num}${titleSuffix}</p>` +
    `<p class="tp-ch-text">${textHTML}</p>`;
  container.appendChild(section);

  if (words && words.length) _buildSectionIndex(chIdx, section);
}

function openReaderFullscreen() {
  const body = $('rfs-body');
  body.innerHTML = '';
  KARAOKE.index = {};
  if (KARAOKE.lastActive) { KARAOKE.lastActive.classList.remove('active'); KARAOKE.lastActive = null; }

  KARAOKE.chapters.forEach(ch => _appendChapterToEl(body, ch.num, ch.title, ch.text, ch.words));

  $('rfs-title').textContent = KARAOKE.loadedBookTitle;
  // Sync follow-along button state
  $('rfs-follow-btn').classList.toggle('active', KARAOKE.enabled);
  renderCommentMarkers();

  show($('reader-fullscreen'));
  KARAOKE.isFullscreen = true;
}

function closeReaderFullscreen() {
  hide($('reader-fullscreen'));
  KARAOKE.isFullscreen = false;
  // Rebuild karaoke index from the still-populated panel body
  _rebuildIndexFromContainer($('tp-body'));
}

// ── Transcript rendering ──────────────────────────────────────────────────────

function appendChapter(num, title, text, words) {
  KARAOKE.chapters.push({ num, title, text, words });
  _appendChapterToEl($('tp-body'), num, title, text, words);
  $('tp-body').scrollTop = $('tp-body').scrollHeight;
  renderCommentMarkers();
}

function hasTranscriptChapter(num) {
  return KARAOKE.chapters.some(ch => ch.num === num);
}

function appendChapterIfMissing(num, title, text, words) {
  if (hasTranscriptChapter(num)) return;
  appendChapter(num, title, text, words);
}

function describeTranscribeState(data) {
  const payload = data?.payload || {};
  const progress = data?.progress || {};
  switch (data?.event) {
    case 'queued':
      return payload.reused ? 'Transcription already running…' : 'Queued for smart sync…';
    case 'cache-hit':
      return payload.alignmentComplete
        ? 'Loaded transcript and alignment from cache.'
        : 'Loaded transcript from cache.';
    case 'transcription-start':
      if (payload.device) {
        return payload.device === 'cuda'
          ? `Transcribing on GPU (${payload.computeType || 'float16'})…`
          : `Transcribing on CPU (${payload.computeType || 'int8'})…`;
      }
      return 'Starting transcription…';
    case 'model-loading':
      return payload.message || 'Loading Whisper model…';
    case 'transcription-progress':
      if (payload.chapterIndex != null && payload.text) {
        return `Transcribed chapter ${payload.chapterIndex + 1} of ${progress.total || '?'}…`;
      }
      if (payload.chapterIndex != null) {
        return `Transcribing chapter ${payload.chapterIndex + 1} of ${progress.total || '?'}…`;
      }
      return 'Transcribing…';
    case 'transcript-complete':
      return 'Transcript cached. Preparing alignment…';
    case 'alignment-start':
      return 'Building alignment cache…';
    case 'alignment-progress':
      return payload.message || 'Updating alignment cache…';
    case 'alignment-complete':
      return payload.stub
        ? 'Transcript ready. Alignment stub cached for future upgrades.'
        : 'Alignment cache complete.';
    case 'completed':
      return payload.cacheHit ? 'Loaded from cache.' : 'Smart sync complete.';
    case 'failed':
      return data?.error || (payload.cancelled ? 'Transcription cancelled.' : 'Smart sync failed.');
    default:
      return '';
  }
}

function handleTranscribeProgressEvent(book, data) {
  if (!data || data.bookId !== book.id) return;
  const payload = data.payload || {};

  if (data.event === 'transcription-progress' && payload.text && payload.chapterIndex != null) {
    const title = payload.chapterTitle || book.chapters?.[payload.chapterIndex]?.title || `Chapter ${payload.chapterIndex + 1}`;
    appendChapterIfMissing(payload.chapterIndex + 1, title, payload.text, payload.words || null);
  }

  const isActive = !['completed', 'failed', 'cache-hit'].includes(data.event);
  setTranscriptStatus(describeTranscribeState(data), isActive);
}

function describeLegacyTranscribeState(data) {
  switch (data?.type) {
    case 'model_load':
      return 'Loading Whisper model…';
    case 'device':
      return data.device === 'cuda'
        ? `Running on GPU (${data.compute_type || 'float16'})`
        : `Running on CPU (${data.compute_type || 'int8'})`;
    case 'chapter':
      return `Transcribed chapter ${data.chapterIndex + 1} of ${data.total}…`;
    default:
      return '';
  }
}

function handleLegacyTranscribeProgressEvent(book, data) {
  if (!data || data.bookId !== book.id || !data.type) return;
  if (data.type === 'chapter') {
    appendChapterIfMissing(
      data.chapterIndex + 1,
      data.chapterTitle || book.chapters?.[data.chapterIndex]?.title || `Chapter ${data.chapterIndex + 1}`,
      data.text || '',
      data.words || null
    );
  }
  const active = data.type !== 'chapter' || (data.chapterIndex + 1) < data.total;
  setTranscriptStatus(describeLegacyTranscribeState(data), active);
}

function renderFullTranscript(fullText) {
  $('tp-body').innerHTML = '';
  const sections = fullText.split(/\n\n---\n\n/);
  for (const section of sections) {
    const m = section.match(/^=== Chapter (\d+): (.*?) ===\n\n([\s\S]*)/);
    if (m) {
      appendChapter(parseInt(m[1], 10), m[2].trim(), m[3].trim(), null);
    } else if (section.trim()) {
      const div = document.createElement('div');
      div.className = 'tp-chapter';
      div.innerHTML = `<p class="tp-ch-text">${escHtml(section.trim())}</p>`;
      $('tp-body').appendChild(div);
    }
  }
}

async function loadAndShowTranscript(book) {
  const [transcript, wordsData] = await Promise.all([
    api.getTranscript(book.id),
    api.getTranscriptWords(book.id),
  ]);
  if (!transcript && !wordsData) return false;

  openTranscriptPanel(book);
  setTranscriptStatus('', false);

  if (wordsData) {
    for (let i = 0; i < book.chapters.length; i++) {
      const chWords = wordsData[String(i)];
      if (!chWords) continue;
      const title = book.chapters[i].title;
      const text  = chWords.map(w => w.word).join('');
      appendChapter(i + 1, title, text, chWords);
    }
  } else {
    renderFullTranscript(transcript);
  }
  return true;
}

async function runContextMenuTranscription(book, { force = false } = {}) {
  openTranscriptPanel(book);

  if (!force) {
    const transcriptState = await api.transcriptExists(book.id);
    if (transcriptState?.exists) {
      const loaded = await loadAndShowTranscript(book);
      if (!loaded) {
        setTranscriptStatus('Transcript exists on disk but could not be loaded.', false);
        return { error: 'Transcript exists on disk but could not be loaded.' };
      }
      setTranscriptStatus(
        transcriptState.source === 'legacy' ? 'Loaded transcript from disk.' : 'Loaded transcript from cache.',
        false
      );
      S.ctxTranscript = true;
      return { cacheHit: true };
    }
  }

  openTranscriptPanel(book);
  setTranscriptStatus(
    `Starting transcription of ${book.chapterCount || book.chapters.length} chapter${(book.chapterCount || book.chapters.length) !== 1 ? 's' : ''}…`,
    true
  );

  const unsubscribe = api.onTranscribeProgress((data) => handleLegacyTranscribeProgressEvent(book, data));
  try {
    const result = await (force ? api.retranscribe(book.id) : api.transcribe(book.id));
    unsubscribe?.();

    if (result?.error) {
      setTranscriptStatus('Error: ' + result.error, false);
      return result;
    }

    await loadAndShowTranscript(book);
    setTranscriptStatus('Transcription complete', false);
    S.ctxTranscript = result;
    return result;
  } catch (error) {
    unsubscribe?.();
    const message = error?.message || String(error);
    setTranscriptStatus('Error: ' + message, false);
    return { error: message };
  }
}

async function toggleTranscriptPanel() {
  if ($('transcript-panel').classList.contains('open')) {
    closeTranscriptPanel();
    return;
  }
  const book = S.currentBook;
  if (!book) return;

  // If we already have content for this book loaded, just re-open
  if (KARAOKE.loadedBookId === book.id && $('tp-body').children.length > 0) {
    $('transcript-panel').classList.add('open');
    $('player-view').classList.add('panel-open');
    $('btn-transcript').classList.add('tp-active');
    return;
  }

  if (await loadAndShowTranscript(book)) return;

  const job = await api.getTranscribeJob(book.id);
  if (job && (job.status === 'queued' || job.status === 'running')) {
    openTranscriptPanel(book);
    setTranscriptStatus(describeTranscribeState({
      event: job.status === 'queued' ? 'queued' : `${job.stage}-start`,
      stage: job.stage,
      progress: job.progress,
      payload: {},
    }), true);
  }
}

function setTranscriptStatus(msg, active = false) {
  const el = $('tp-status');
  el.textContent = msg;
  el.classList.toggle('active', active);
}

function smartSyncButtonState(bookId) {
  return SMART_SYNC_UI.byBookId[String(bookId)] || { status: 'idle' };
}

function setSmartSyncButtonStatus(bookId, status, label = '') {
  SMART_SYNC_UI.byBookId[String(bookId)] = { status, label };
  updateSmartSyncButton();
}

function ensureSmartSyncProgressListener() {
  if (SMART_SYNC_UI.progressListenerAttached) return;
  SMART_SYNC_UI.progressListenerAttached = true;
  api.onTranscribeProgress((data) => {
    const activeBook = data?.bookId === S.currentBook?.id
      ? S.currentBook
      : S.books.find(b => b.id === data?.bookId) || null;

    if (activeBook) {
      handleTranscribeProgressEvent(activeBook, data);
    }

    if (!data?.bookId) return;
    const trackedBookId = String(data.bookId);
    if (data.event === 'queued' || data.event === 'transcription-start' || data.event === 'model-loading'
      || data.event === 'transcription-progress' || data.event === 'alignment-start' || data.event === 'alignment-progress') {
      SMART_SYNC_UI.startingBookIds.add(trackedBookId);
      setSmartSyncButtonStatus(trackedBookId, 'running', 'Generating...');
    } else if (data.event === 'cache-hit' || data.event === 'completed') {
      SMART_SYNC_UI.startingBookIds.delete(trackedBookId);
      setSmartSyncButtonStatus(trackedBookId, 'completed', 'Completed');
    } else if (data.event === 'failed') {
      SMART_SYNC_UI.startingBookIds.delete(trackedBookId);
      setSmartSyncButtonStatus(trackedBookId, 'idle', 'Generate Smart Sync');
    }
  });
}

async function refreshSmartSyncButton() {
  const book = S.currentBook;
  const refreshToken = ++SMART_SYNC_UI.refreshToken;
  if (!book) {
    updateSmartSyncButton();
    return;
  }
  const job = await api.getTranscribeJob(book.id);
  if (refreshToken !== SMART_SYNC_UI.refreshToken || S.currentBook?.id !== book.id) {
    return;
  }
  if (SMART_SYNC_UI.startingBookIds.has(String(book.id))) {
    updateSmartSyncButton();
    return;
  }
  if (job && (job.status === 'queued' || job.status === 'running')) {
    setSmartSyncButtonStatus(book.id, 'running', 'Generating...');
  } else if (smartSyncButtonState(book.id).status === 'running') {
    setSmartSyncButtonStatus(book.id, 'idle', 'Generate Smart Sync');
  } else {
    updateSmartSyncButton();
  }
}

function updateSmartSyncButton() {
  const btn = $('btn-smart-sync');
  const book = S.currentBook;
  if (!btn) return;
  if (!book) {
    btn.disabled = true;
    btn.textContent = 'Generate Smart Sync';
    return;
  }
  const state = smartSyncButtonState(book.id);
  btn.disabled = state.status === 'running';
  btn.textContent =
    state.label ||
    (state.status === 'running' ? 'Generating...' :
     state.status === 'completed' ? 'Completed' :
     'Generate Smart Sync');
}

async function startSmartSyncForBook(book) {
  if (!book) return;
  const bookId = String(book.id);
  SMART_SYNC_UI.startingBookIds.add(bookId);
  setSmartSyncButtonStatus(book.id, 'running', 'Generating...');
  ensureSmartSyncProgressListener();

  try {
    const result = await api.book.transcribe(book.id);

    if (result?.error) {
      SMART_SYNC_UI.startingBookIds.delete(bookId);
      setSmartSyncButtonStatus(book.id, 'idle', 'Generate Smart Sync');
      setTranscriptStatus('Error: ' + result.error, false);
      showPlayerMessage('Smart sync failed: ' + result.error, true);
      return result;
    }

    SMART_SYNC_UI.startingBookIds.delete(bookId);
    setSmartSyncButtonStatus(book.id, 'completed', 'Completed');
    return result;
  } catch (error) {
    SMART_SYNC_UI.startingBookIds.delete(bookId);
    setSmartSyncButtonStatus(book.id, 'idle', 'Generate Smart Sync');
    setTranscriptStatus('Error: ' + (error?.message || String(error)), false);
    showPlayerMessage('Smart sync failed.', true);
    return { error: error?.message || String(error) };
  }
}

// ── View switching ───────────────────────────────────────────────────────────
function showView(name) {
  S.view = name;
  toggle($('library-view'),  name === 'library');
  toggle($('player-view'),   name === 'player');
  setPlayerSidebarVisibility();
  toggle($('catalog-view'),  name === 'catalog');

  $('nav-library').classList.toggle('active', name === 'library');
  $('nav-player').classList.toggle('active', name === 'player');
  if ($('nav-catalog')) $('nav-catalog').classList.toggle('active', name === 'catalog');

  if (name === 'library')  renderLibrary();
  if (name === 'catalog') renderCatalog();
}

// ── Library ──────────────────────────────────────────────────────────────────
async function loadLibrary() {
  if (authUser) {
    const [catRes, localBooks] = await Promise.all([
      api.catalog.getUserLibrary(),
      api.getLibrary(),
    ]);
    S.books = mergeVisibleLibraryBooks(localBooks || [], catRes.books || []);
  } else {
    // No account: show local books only
    S.books = await api.getLibrary();
  }
  renderLibrary();
}

function renderLibrary() {
  const q = S.searchQuery.toLowerCase();
  const books = q
    ? S.books.filter(b =>
        b.title.toLowerCase().includes(q) ||
        (b.author || '').toLowerCase().includes(q))
    : S.books;

  if (books.length === 0 && !q) {
    hide($('book-grid')); show($('empty-library'));
    return;
  }
  show($('book-grid')); hide($('empty-library'));

  $('book-grid').innerHTML = books.map(bookCardHTML).join('');

  $('book-grid').querySelectorAll('.book-card').forEach(card => {
    const id   = card.dataset.id;
    const book = S.books.find(b => b.id === id);
    if (!book) return;

    // Initialise input stars to current rating
    if (!book.isCatalog) {
      renderCardStars(card, book?.rating || 0);

      card.querySelectorAll('.book-stars-input .si').forEach(si => {
        si.addEventListener('mousemove', e => {
          const pos = parseInt(si.dataset.pos, 10);
          const val = e.offsetX < si.offsetWidth / 2 ? pos - 0.5 : pos;
          renderCardStars(card, val);
        });
      });
      card.querySelector('.book-stars-input')?.addEventListener('mouseleave', () => {
        renderCardStars(card, book?.rating || 0);
      });
    }

    card.addEventListener('click', e => {
      if (e.target.closest('.book-stars-input')) {
        const si = e.target.closest('.si');
        if (!si) return;
        const pos = parseInt(si.dataset.pos, 10);
        const val = e.offsetX < si.offsetWidth / 2 ? pos - 0.5 : pos;
        rateBook(id, val);
        return;
      }
      openBook(id);
    });

    // Context menu: catalog books get a simplified menu (remove from library only)
    card.addEventListener('contextmenu', e => showContextMenu(e, id));
  });
}

function bookCardHTML(book) {
  const col     = bookColor(book.title);
  const pct     = Math.round(bookProgress(book) * 100);
  const isNow   = S.currentBook?.id === book.id;
  // Catalog books have coverUrl (presigned https URL), local books have coverPath
  const imgUrl  = book.coverUrl || (book.coverPath ? pathToUrl(book.coverPath) : null);
  const isCat   = !!book.isCatalog;

  const coverStyle = imgUrl
    ? `background: url('${imgUrl}') center/cover no-repeat`
    : `background:${col.bg}; color:${col.text}`;
  const coverInner = imgUrl ? '' : initials(book.title);

  const chStr = book.chapterCount ? `${book.chapterCount} ch.` : '';
  const metaLine = isCat
    ? [book.narrator || book.author, chStr].filter(Boolean).join(' · ')
    : `${book.chapterCount} chapter${book.chapterCount !== 1 ? 's' : ''}`;

  return `
  <div class="book-card${isNow ? ' now-playing' : ''}${isCat ? ' catalog-card' : ''}" data-id="${book.id}">
    ${isNow ? '<span class="now-playing-badge">Now Playing</span>' : ''}
    <div class="book-cover" style="${coverStyle}">
      ${coverInner}
      ${isNow ? `<div class="book-cover-eq"><div class="eq-bars${S.isPlaying ? '' : ' paused'}" style="transform:scale(0.8)"><span></span><span></span><span></span><span></span></div></div>` : ''}
    </div>
    <div class="book-card-info">
      <p class="book-card-title">${book.title}</p>
      <p class="book-card-meta">${metaLine}</p>
      ${book.rating ? `<div class="book-stars-static">${starsStaticHTML(book.rating)}</div>` : ''}
      ${!isCat ? `<div class="book-stars-input">${starsInputHTML()}</div>` : ''}
      <div class="progress-bar"><div class="progress-fill-bar" style="width:${pct}%"></div></div>
      ${pct > 0 ? `<p class="progress-pct">${pct}%</p>` : ''}
    </div>
  </div>`;
}

// ── Open book ────────────────────────────────────────────────────────────────
async function openBook(bookId) {
  // Check if it's a catalog book (in S.books with isCatalog flag)
  const catBook = S.books.find(b => b.id === bookId && b.isCatalog);
  if (catBook) { openCatalogBook(catBook); return; }

  const book = await api.getBook(bookId);
  if (!book) return;

  S.currentBook = book;

  // If the transcript panel is open showing a different book, close it so
  // stale content from the previous book is never visible while playing this one.
  if ($('transcript-panel').classList.contains('open') && KARAOKE.loadedBookId !== book.id) {
    closeTranscriptPanel();
  }

  const pb = book.playback;
  S.chapterIndex = pb?.chapterIndex || 0;
  S.speed = pb?.speed || 1;
  S.bookmarks = await api.getBookmarks(bookId);

  // Enable Now Playing nav
  $('nav-player').disabled = false;

  renderChapterList();
  renderBookmarks();
  updatePlayerBarInfo();
  showView('player');
  updateNowPlayingDisplay();
  refreshSmartSyncButton();
  clearCommentNotificationState();
  closeCommentComposer();
  hideEpubSelectionPopup();
  resetCommentPlaybackState(pb?.position || 0, S.chapterIndex);
  refreshCurrentBookComments();

  playChapter(S.chapterIndex, pb?.position || 0);
}

async function openCatalogBook(book) {
  if (!navigator.onLine) {
    alert('No internet connection. Cannot stream this audiobook.');
    return;
  }

  if ($('transcript-panel').classList.contains('open') && KARAOKE.loadedBookId !== book.id) {
    closeTranscriptPanel();
  }

  // Reload from catalog to get fresh presigned cover URL if needed
  const freshBook = S.books.find(b => b.id === book.id) || book;
  S.currentBook = freshBook;

  const pb = freshBook.playback || await api.getPlayback(freshBook.id);
  S.chapterIndex = pb?.chapterIndex || 0;
  S.speed = pb?.speed || 1;
  S.bookmarks = await api.getBookmarks(freshBook.id);

  $('nav-player').disabled = false;
  renderChapterList();
  renderBookmarks();
  updatePlayerBarInfo();
  showView('player');
  updateNowPlayingDisplay();
  refreshSmartSyncButton();
  clearCommentNotificationState();
  closeCommentComposer();
  hideEpubSelectionPopup();
  resetCommentPlaybackState(pb?.position || 0, S.chapterIndex);
  refreshCurrentBookComments();
  playChapter(S.chapterIndex, pb?.position || 0);
}

// ── Player ───────────────────────────────────────────────────────────────────
async function playChapter(index, startPos = 0) {
  const book = S.currentBook;
  if (!book) return;

  const chapter = book.chapters[index];
  if (!chapter) return;

  S.chapterIndex = index;
  audio.playbackRate = S.speed;
  audio.volume = S.volume;

  // Resolve audio source
  let src;
  if (book.isCatalog) {
    // Catalog book — stream from shared S3 via catalog presigned URL
    if (!navigator.onLine) {
      showPlayerMessage('No internet connection. Cannot stream this audiobook.', true);
      return;
    }
    showPlayerMessage('Loading…', false);
    const res = await api.catalog.getPresignedUrl({ s3Prefix: book.s3Prefix, filename: chapter.filename });
    if (res.error) {
      showPlayerMessage('Stream failed: ' + res.error, true);
      return;
    }
    src = res.url;
    clearPlayerMessage();
  } else if (chapter.filepath && !book.isCloudOnly) {
    src = pathToUrl(chapter.filepath);
  } else {
    // Legacy cloud-only book — fetch presigned URL via old handler
    if (!navigator.onLine) {
      showPlayerMessage('No internet connection. Cannot stream cloud audio.', true);
      return;
    }
    showPlayerMessage('Loading from cloud…', false);
    const res = await api.s3.getPresignedUrl({ bookId: book.id, chapterIndex: index });
    if (res.error) {
      showPlayerMessage('Cloud playback failed: ' + res.error, true);
      return;
    }
    src = res.url;
    clearPlayerMessage();
  }

  audio.src = src;

  audio.addEventListener('loadedmetadata', () => {
    if (startPos > 0 && startPos < audio.duration - 1) {
      audio.currentTime = startPos;
    }
    resetCommentPlaybackState(audio.currentTime || startPos || 0, index);
    audio.play().catch(err => console.error('Play error:', err));

    // Persist chapter duration for progress accuracy (local books only)
    if (!book.isCloudOnly && (!chapter.duration || Math.abs(chapter.duration - audio.duration) > 0.5)) {
      chapter.duration = audio.duration;
      api.updateChapterDuration({ bookId: book.id, chapterId: index, duration: audio.duration });
      const lb = S.books.find(b => b.id === book.id);
      if (lb?.chapters?.[index]) lb.chapters[index].duration = audio.duration;
    }
  }, { once: true });

  updateNowPlayingDisplay();
  updateChapterListHighlight();
  updatePlayerBarInfo();
}

function showPlayerMessage(msg, isError) {
  let el = $('player-msg');
  if (!el) return;
  el.textContent = msg;
  el.className = 'player-msg' + (isError ? ' player-msg-error' : '');
  show(el);
  if (!isError) setTimeout(clearPlayerMessage, 3000);
}
function clearPlayerMessage() {
  const el = $('player-msg');
  if (el) hide(el);
}

function togglePlay() {
  if (!S.currentBook) return;
  if (audio.paused) {
    audio.play().catch(console.error);
  } else {
    audio.pause();
  }
}

function seekToTime(position) {
  const upperBound = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Math.max(0, position);
  const nextTime = Math.max(0, Math.min(upperBound, position));
  audio.currentTime = nextTime;
  resetCommentPlaybackState(nextTime, S.chapterIndex);
  updateSeekBar();
}

function skip(secs) {
  if (!audio.src) return;
  seekToTime((audio.currentTime || 0) + secs);
}

function prevChapter() {
  if (!S.currentBook) return;
  if (audio.currentTime > 3) { seekToTime(0); return; }
  if (S.chapterIndex > 0) playChapter(S.chapterIndex - 1);
}

function nextChapter() {
  if (!S.currentBook) return;
  const next = S.chapterIndex + 1;
  if (next < S.currentBook.chapters.length) playChapter(next, 0);
}

function setVolume(v) {
  S.volume = Math.max(0, Math.min(1, v));
  audio.volume = S.volume;
  updateVolSlider();
}

function setSpeed(v) {
  S.speed = parseFloat(v);
  audio.playbackRate = S.speed;
  $('speed-select').value = String(S.speed);
  savePlayback();
}

// ── Display updates ──────────────────────────────────────────────────────────
function updateNowPlayingDisplay() {
  const book = S.currentBook;
  if (!book) return;
  const chapter = book.chapters[S.chapterIndex];
  const col = bookColor(book.title);

  // ── Album art thumbnail ──────────────────────────────────────────────────
  const artUrl = book.coverUrl || (book.coverPath ? pathToUrl(book.coverPath) : null);
  if (artUrl) {
    $('book-art').style.background = `url('${artUrl}') center/cover no-repeat`;
    $('book-art-text').style.display = 'none';
  } else {
    $('book-art').style.background = col.bg;
    $('book-art-text').style.display = '';
    $('book-art-text').style.color = col.text;
    $('book-art-text').textContent = initials(book.title);
  }

  // ── Immersive blurred background ─────────────────────────────────────────
  const bgSrc = book.bgPath || book.coverUrl || book.coverPath || null;
  const bg = $('player-bg');
  if (bgSrc) {
    bg.style.cssText = [
      'position:absolute', 'inset:-80px', 'z-index:0',
      `background-image:url('${bgSrc.startsWith('http') ? bgSrc : pathToUrl(bgSrc)}')`,
      'background-size:cover', 'background-position:center',
      'filter:blur(60px) brightness(0.25) saturate(1.4)',
    ].join(';') + ';';
  } else {
    // No image — derive a vivid gradient from book hue so colour shows at low brightness
    let h = 5381;
    for (let i = 0; i < book.title.length; i++) { h = ((h << 5) + h) ^ book.title.charCodeAt(i); h = h & h; }
    const hue = Math.abs(h % 360);
    bg.style.cssText = [
      'position:absolute', 'inset:-80px', 'z-index:0',
      `background-image:linear-gradient(145deg,hsl(${hue},70%,55%) 0%,hsl(${(hue+40)%360},60%,38%) 100%)`,
      'background-size:cover',
      'filter:blur(80px) brightness(0.38) saturate(1.6)',
    ].join(';') + ';';
  }

  $('now-title').textContent = book.title;
  const chapterLabel = book.chapters.length === 1
    ? ''
    : (chapter ? cleanChapterTitle(chapter.title, book.title, S.chapterIndex) : '');
  $('now-chapter').textContent = chapterLabel;

  renderNowStars(book.rating || 0);
  updateSmartSyncButton();
}

function updatePlayerBarInfo() {
  const book = S.currentBook;
  if (!book) return;
  const chapter = book.chapters[S.chapterIndex];
  const col = bookColor(book.title);

  const miniArtUrl = book.coverUrl || (book.coverPath ? pathToUrl(book.coverPath) : null);
  if (miniArtUrl) {
    $('mini-art').style.background = `url('${miniArtUrl}') center/cover no-repeat`;
    $('mini-art-text').style.display = 'none';
  } else {
    $('mini-art').style.background = col.bg;
    $('mini-art-text').style.display = '';
    $('mini-art-text').style.color = col.text;
    $('mini-art-text').textContent = initials(book.title);
  }

  $('pb-book-title').textContent = book.title;
  $('pb-chapter-title').textContent = (book.chapters.length > 1 && chapter)
    ? cleanChapterTitle(chapter.title, book.title, S.chapterIndex)
    : '';

  show($('player-bar'));
  updateEpubButton();
}

function updatePlayButton(playing) {
  toggle($('icon-play'), !playing);
  toggle($('icon-pause'), playing);
  // EQ bars
  const bars = document.querySelectorAll('.eq-bars');
  bars.forEach(b => b.classList.toggle('paused', !playing));
}

function updateSeekBar() {
  if (!audio.duration || S.isSeeking) return;
  const pct = (audio.currentTime / audio.duration) * 100;

  $('pb-seek-fill').style.width = pct + '%';
  $('pb-seek-thumb').style.left = pct + '%';
  $('ch-seek-fill').style.width = pct + '%';
  $('ch-seek-thumb').style.left = pct + '%';

  $('pb-current').textContent = fmt(audio.currentTime);
  $('pb-total').textContent = fmt(audio.duration);
  $('ch-current').textContent = fmt(audio.currentTime);
  $('ch-total').textContent = fmt(audio.duration);
  renderSeekBarCommentDots();
}

function updateChapterListHighlight() {
  document.querySelectorAll('.chapter-item').forEach((el, i) => {
    el.classList.toggle('active', i === S.chapterIndex);
    if (i === S.chapterIndex) el.scrollIntoView({ block: 'nearest' });
  });
}

function updateVolSlider() {
  const slider = $('vol-slider');
  const pct = S.volume * 100;
  slider.value = S.volume;
  slider.style.background = `linear-gradient(to right, var(--accent) ${pct}%, rgba(255,255,255,0.08) ${pct}%)`;
}

// ── Seek bar interaction ──────────────────────────────────────────────────────
function setupSeekBars() {
  function initSeek(trackId) {
    const track = $(trackId);
    track.addEventListener('mousedown', e => {
      S.isSeeking = true;
      doSeek(e, track);
    });
  }
  initSeek('pb-seek-track');
  initSeek('ch-seek-track');

  document.addEventListener('mousemove', e => {
    if (!S.isSeeking) return;
    // find which seek track is being interacted with by checking mouse pos
    ['pb-seek-track', 'ch-seek-track'].forEach(id => {
      const t = $(id);
      const r = t.getBoundingClientRect();
      if (e.clientX >= r.left - 20 && e.clientX <= r.right + 20) {
        doSeek(e, t);
      }
    });
  });
  document.addEventListener('mouseup', () => { S.isSeeking = false; });
}

function doSeek(e, track) {
  if (!audio.duration) return;
  const rect = track.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  seekToTime(ratio * audio.duration);
}

// ── Chapter list ─────────────────────────────────────────────────────────────
function renderChapterList() {
  const book = S.currentBook;
  if (!book) return;
  $('chapter-list').innerHTML = book.chapters.map((ch, i) => {
    const label = cleanChapterTitle(ch.title, book.title, i);
    return `
    <div class="chapter-item${i === S.chapterIndex ? ' active' : ''}" data-index="${i}">
      <span class="chapter-num">${i + 1}</span>
      <span class="chapter-name" title="${label}">${label}</span>
      ${ch.duration ? `<span class="chapter-dur">${fmt(ch.duration)}</span>` : ''}
    </div>`;
  }).join('');

  $('chapter-list').querySelectorAll('.chapter-item').forEach(el => {
    el.addEventListener('click', () => {
      playChapter(parseInt(el.dataset.index, 10), 0);
    });
  });
}

// ── Bookmarks ─────────────────────────────────────────────────────────────────
function renderBookmarks() {
  if (!S.bookmarks.length) {
    $('bookmark-list').innerHTML = '<p class="sidebar-empty">No bookmarks yet</p>';
    return;
  }
  $('bookmark-list').innerHTML = S.bookmarks.map(bm => `
    <div class="bookmark-item" data-id="${bm.id}">
      <span class="bookmark-icon">◆</span>
      <div class="bookmark-info">
        <p class="bookmark-name">${bm.name}</p>
        <p class="bookmark-pos">Ch ${bm.chapterIndex + 1} · ${fmt(bm.position)}</p>
      </div>
      <button class="bookmark-del" data-id="${bm.id}" title="Delete bookmark">✕</button>
    </div>`).join('');

  $('bookmark-list').querySelectorAll('.bookmark-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('bookmark-del')) return;
      const bm = S.bookmarks.find(b => b.id === el.dataset.id);
      if (bm) {
        if (bm.chapterIndex !== S.chapterIndex) {
          playChapter(bm.chapterIndex, bm.position);
        } else {
          seekToTime(bm.position);
        }
      }
    });
    el.querySelector('.bookmark-del').addEventListener('click', async e => {
      e.stopPropagation();
      const id = e.currentTarget.dataset.id;
      await api.deleteBookmark({ bookId: S.currentBook.id, bookmarkId: id });
      api.sync.push({ type: 'bookmark_delete', bookmarkId: id });
      S.bookmarks = S.bookmarks.filter(b => b.id !== id);
      renderBookmarks();
    });
  });
}

async function addBookmark() {
  if (!S.currentBook || !audio.src) return;
  show($('bm-modal'));
  $('bm-name-input').value = `Ch ${S.chapterIndex + 1} – ${fmt(audio.currentTime)}`;
  $('bm-name-input').focus();
  $('bm-name-input').select();
}

async function saveBookmark() {
  const name = $('bm-name-input').value.trim();
  if (!name) return;
  hide($('bm-modal'));

  const bm = await api.addBookmark({
    bookId: S.currentBook.id,
    chapterIndex: S.chapterIndex,
    position: audio.currentTime,
    name,
  });
  S.bookmarks.push(bm);
  S.bookmarks.sort((a, b) => a.chapterIndex - b.chapterIndex || a.position - b.position);
  renderBookmarks();
  api.sync.push({ type: 'bookmark_upsert', ...bm });
}

// ── Sleep timer ───────────────────────────────────────────────────────────────
function setSleepTimer(minutes) {
  if (S.sleepTimer) clearTimeout(S.sleepTimer);
  if (S.sleepInterval) clearInterval(S.sleepInterval);

  S.sleepTimerEnd = Date.now() + minutes * 60 * 1000;
  S.sleepTimer = setTimeout(() => {
    audio.pause();
    S.sleepTimer = null;
    S.sleepTimerEnd = null;
    clearInterval(S.sleepInterval);
    hideSleepPopup();
    $('btn-sleep').classList.remove('active');
    document.querySelectorAll('.timer-opt').forEach(b => b.classList.remove('active'));
  }, minutes * 60 * 1000);

  S.sleepInterval = setInterval(updateSleepDisplay, 1000);
  $('btn-sleep').classList.add('active');
  show($('timer-active'));
  updateSleepDisplay();
}

function cancelSleepTimer() {
  clearTimeout(S.sleepTimer);
  clearInterval(S.sleepInterval);
  S.sleepTimer = null;
  S.sleepTimerEnd = null;
  $('btn-sleep').classList.remove('active');
  hide($('timer-active'));
  document.querySelectorAll('.timer-opt').forEach(b => b.classList.remove('active'));
}

function updateSleepDisplay() {
  if (!S.sleepTimerEnd) return;
  const rem = Math.max(0, S.sleepTimerEnd - Date.now());
  const m = Math.floor(rem / 60000);
  const s = Math.floor((rem % 60000) / 1000);
  $('timer-remaining').textContent = `${m}:${String(s).padStart(2,'0')} remaining`;
}

function toggleSleepPopup() {
  $('sleep-popup').classList.toggle('hidden');
}
function hideSleepPopup() { hide($('sleep-popup')); }

// ── Playback persistence ──────────────────────────────────────────────────────
async function savePlayback() {
  if (!S.currentBook) return;
  await api.savePlayback({
    bookId: S.currentBook.id,
    chapterIndex: S.chapterIndex,
    position: audio.currentTime || 0,
    speed: S.speed,
  });
  // Sync progress in in-memory books list
  const lb = S.books.find(b => b.id === S.currentBook.id);
  if (lb) {
    lb.playback = { chapterIndex: S.chapterIndex, position: audio.currentTime, speed: S.speed };
  }
  schedulePushProgress();
}

// ── Sync helpers ──────────────────────────────────────────────────────────────

function updateSyncDot(statusOrObj) {
  const status = typeof statusOrObj === 'string' ? statusOrObj : (statusOrObj?.status || 'idle');
  const detail = typeof statusOrObj === 'string' ? '' : (statusOrObj?.detail || '');
  const dot = $('sync-dot');
  if (!dot) return;
  dot.className = 'sync-dot sync-' + status;
  const labels = { synced: 'Synced', syncing: 'Syncing…', offline: 'Offline – changes queued', idle: '' };
  dot.title = detail ? `${labels[status] || status}: ${detail}` : (labels[status] || '');
  // Update sync status line in settings popup
  const syncStatusEl = $('settings-sync-status');
  if (syncStatusEl) syncStatusEl.textContent = labels[status] || '';
  // Show sync error in settings popup if it's open
  const errEl = $('sync-error-msg');
  if (errEl) {
    errEl.textContent = (status === 'offline' && detail) ? `Sync error: ${detail}` : '';
    errEl.classList.toggle('hidden', !(status === 'offline' && detail));
  }
}

function schedulePushProgress() {
  if (!authUser) return;
  clearTimeout(_progressPushTimer);
  _progressPushTimer = setTimeout(() => {
    if (!S.currentBook) return;
    api.sync.push({
      type: 'progress',
      bookId: S.currentBook.id,
      bookTitle: S.currentBook.title,
      chapterIndex: S.chapterIndex,
      position: audio.currentTime || 0,
      speed: S.speed,
    });
  }, 3000);
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' toast-error' : ' toast-success');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

function firstPresentValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function formatCommentToastContext(comment) {
  const pieces = [];
  const chapterIndex = Number(comment?.chapterIndex);
  if (Number.isFinite(chapterIndex) && chapterIndex >= 0) pieces.push(`Ch ${chapterIndex + 1}`);
  const timestamp = Number(comment?.audioTimestampSeconds);
  if (Number.isFinite(timestamp) && timestamp >= 0) pieces.push(fmt(timestamp));
  return pieces.join(' · ');
}

function normalizeCommentToastData(comment) {
  const username = firstPresentValue(comment, [
    'displayName',
    'display_name',
    'username',
    'userName',
    'name',
    'author',
  ]) || 'User';
  const text = firstPresentValue(comment, [
    'comment_text',
    'commentText',
    'text',
    'content',
    'body',
    'comment',
  ]);
  return {
    username,
    text,
    context: formatCommentToastContext(comment),
  };
}

function flushCommentToast() {
  const toast = $('comment-toast');
  if (!toast) return;
  clearTimeout(COMMENTS.toastShowTimer);
  clearTimeout(COMMENTS.toastHideTimer);
  COMMENTS.activeToast = null;
  if (COMMENTS.toastQueue.length) {
    COMMENTS.toastShowTimer = setTimeout(showNextCommentToast, 120);
  } else {
    toast.classList.add('hidden');
  }
}

function showNextCommentToast() {
  const toast = $('comment-toast');
  if (!toast || COMMENTS.activeToast || !COMMENTS.toastQueue.length) return;

  const next = COMMENTS.toastQueue.shift();
  COMMENTS.activeToast = next;
  $('comment-toast-user').textContent = `${next.username}:`;
  $('comment-toast-message').textContent = next.text;
  const contextEl = $('comment-toast-context');
  contextEl.textContent = next.context;
  contextEl.classList.toggle('hidden', !next.context);

  toast.classList.remove('hidden');
  clearTimeout(COMMENTS.toastShowTimer);
  clearTimeout(COMMENTS.toastHideTimer);
  COMMENTS.toastShowTimer = setTimeout(() => {
    toast.classList.add('hidden');
    COMMENTS.toastHideTimer = setTimeout(flushCommentToast, 280);
  }, 3000);
}

function enqueueCommentToast(comment) {
  const normalized = normalizeCommentToastData(comment);
  if (!normalized.text) return;
  COMMENTS.toastQueue.push(normalized);
  if (!COMMENTS.activeToast) showNextCommentToast();
  api.comments.notifyReached({
    commentId: comment.id,
    username: comment.username || 'Unknown',
    text: comment.text || '',
    chapterIndex: comment.chapterIndex,
    audioTimestampSeconds: comment.audioTimestampSeconds,
  });
}

function escapeAttr(value) {
  return escHtml(value).replace(/"/g, '&quot;');
}

function getCurrentBookComments() {
  return COMMENTS.byBookId[String(S.currentBook?.id || '')] || [];
}

function findCommentById(commentId) {
  return getCurrentBookComments().find(comment => String(comment.id) === String(commentId)) || null;
}

function sortComments(comments) {
  return [...comments].sort((a, b) =>
    (a.chapterIndex - b.chapterIndex)
    || ((a.audioTimestampSeconds || 0) - (b.audioTimestampSeconds || 0))
    || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
  );
}

function setCurrentBookComments(comments) {
  if (!S.currentBook) return;
  COMMENTS.byBookId[String(S.currentBook.id)] = sortComments(comments || []);
}


function clearCommentNotificationState() {
  COMMENTS.triggeredIds.clear();
  COMMENTS.toastQueue = [];
  COMMENTS.activeToast = null;
  clearTimeout(COMMENTS.toastShowTimer);
  clearTimeout(COMMENTS.toastHideTimer);
  $('comment-toast')?.classList.add('hidden');
}

function resetCommentPlaybackState(playbackTime = audio.currentTime || 0, chapterIndex = S.chapterIndex || 0) {
  COMMENTS.triggeredIds.clear();
  COMMENTS.lastBookId = String(S.currentBook?.id || '');
  COMMENTS.lastChapterIndex = chapterIndex;
  COMMENTS.lastPlaybackTime = playbackTime;
  for (const comment of getCurrentBookComments()) {
    if (comment.chapterIndex !== chapterIndex) continue;
    if ((comment.audioTimestampSeconds || 0) < Math.max(0, playbackTime - 0.35)) {
      COMMENTS.triggeredIds.add(String(comment.id));
    }
  }
}

function closeCommentComposer() {
  COMMENTS.composerContext = null;
  $('comment-drop-input').value = '';
  hide($('comment-drop-popup'));
}


function hideEpubSelectionPopup() {
  COMMENTS.epubSelection = null;
  hide($('epub-selection-popup'));
}

function positionFloatingPopup(popup, anchorEl, { x = window.innerWidth - 360, y = window.innerHeight - 220 } = {}) {
  const rect = anchorEl?.getBoundingClientRect?.();
  const width = popup.offsetWidth || popup.getBoundingClientRect().width || 320;
  const height = popup.offsetHeight || popup.getBoundingClientRect().height || 200;
  const left = rect
    ? Math.min(window.innerWidth - width - 12, Math.max(12, rect.left + rect.width / 2 - width / 2))
    : Math.min(window.innerWidth - width - 12, Math.max(12, x));
  const top = rect
    ? Math.min(window.innerHeight - height - 12, Math.max(12, rect.bottom + 10))
    : Math.min(window.innerHeight - height - 12, Math.max(12, y));
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}


function enqueueTimedComments() {
  if (!S.currentBook) return;
  const currentBookId = String(S.currentBook.id);
  const currentTime = audio.currentTime || 0;
  const lastTime = COMMENTS.lastPlaybackTime || 0;
  const playbackJumped = Math.abs(currentTime - lastTime) > 2;
  if (COMMENTS.lastBookId !== currentBookId
    || COMMENTS.lastChapterIndex !== S.chapterIndex
    || currentTime + 1 < lastTime
    || playbackJumped) {
    resetCommentPlaybackState(currentTime, S.chapterIndex);
    return;
  }

  for (const comment of getCurrentBookComments()) {
    if (comment.chapterIndex !== S.chapterIndex) continue;
    if (comment.userId === authUser?.id) continue;
    const key = String(comment.id);
    if (COMMENTS.triggeredIds.has(key)) continue;
    const timestamp = comment.audioTimestampSeconds || 0;
    if (timestamp > lastTime - 0.1 && timestamp <= currentTime + 0.35) {
      COMMENTS.triggeredIds.add(key);
      enqueueCommentToast(comment);
    }
  }

  COMMENTS.lastBookId = currentBookId;
  COMMENTS.lastChapterIndex = S.chapterIndex;
  COMMENTS.lastPlaybackTime = currentTime;
}


function collectTranscriptWordEntries(container, chapterIndex) {
  return Array.from(container.querySelectorAll(`.tp-word[data-chapter="${chapterIndex}"]`)).map(span => ({
    span,
    start: parseFloat(span.dataset.start) || 0,
    end: parseFloat(span.dataset.end) || 0,
  }));
}

function findClosestTranscriptWord(entries, timestamp) {
  if (!entries.length) return null;
  let best = entries[0];
  let bestDistance = Math.abs((best.start || 0) - timestamp);
  for (const entry of entries) {
    if (timestamp >= entry.start && timestamp <= entry.end) return entry;
    const distance = Math.min(
      Math.abs((entry.start || 0) - timestamp),
      Math.abs((entry.end || entry.start || 0) - timestamp)
    );
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best;
}

function renderTranscriptMarkersIn(container) {
  container.querySelectorAll('.tp-comment-marker-wrap').forEach(node => node.remove());
  const comments = getCurrentBookComments();
  if (!comments.length) return;

  const commentsByChapter = new Map();
  for (const comment of comments) {
    if (!commentsByChapter.has(comment.chapterIndex)) commentsByChapter.set(comment.chapterIndex, []);
    commentsByChapter.get(comment.chapterIndex).push(comment);
  }

  for (const [chapterIndex, chapterComments] of commentsByChapter) {
    const entries = collectTranscriptWordEntries(container, chapterIndex);
    if (!entries.length) continue;

    const groups = new Map();
    for (const comment of chapterComments) {
      const target = findClosestTranscriptWord(entries, comment.audioTimestampSeconds || 0);
      if (!target) continue;
      const key = `${target.start}:${target.end}`;
      if (!groups.has(key)) groups.set(key, { target: target.span, comments: [] });
      groups.get(key).comments.push(comment);
    }

    for (const group of groups.values()) {
      const wrap = document.createElement('span');
      wrap.className = 'tp-comment-marker-wrap';
      for (const comment of group.comments.slice(0, 5)) {
        const btn = document.createElement('button');
        btn.className = 'tp-comment-marker';
        btn.title = `${comment.username}: ${comment.text}`;
        btn.style.background = `hsl(${avatarHue(comment.username)},72%,40%)`;
        btn.textContent = (comment.username || 'U')[0]?.toUpperCase() || 'U';
        attachCommentDeleteMenu(btn, comment.id);
        wrap.appendChild(btn);
      }
      group.target.insertAdjacentElement('afterend', wrap);
    }
  }
}

function decorateEpubParagraph(text, chapterIndex, paragraphIndex) {
  const matches = [];
  const lower = String(text || '').toLowerCase();
  for (const comment of getCurrentBookComments()) {
    const selectedText = String(comment.selectedText || '').trim();
    if (!selectedText) continue;
    const explicitChapter = Number.isFinite(comment.epubChapterIndex) ? comment.epubChapterIndex : null;
    const explicitParagraph = Number.isFinite(comment.epubParagraphIndex) ? comment.epubParagraphIndex : null;
    if (explicitChapter != null && explicitChapter !== chapterIndex) continue;
    if (explicitParagraph != null && explicitParagraph !== paragraphIndex) continue;
    if (explicitChapter == null && EPUB.chapters[chapterIndex]?.syncIndex !== comment.chapterIndex) continue;

    const start = lower.indexOf(selectedText.toLowerCase());
    if (start < 0) continue;
    matches.push({
      start,
      end: start + selectedText.length,
      comment,
    });
  }

  if (!matches.length) return escHtml(text);

  matches.sort((a, b) => a.start - b.start || a.end - b.end);
  let html = '';
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    html += escHtml(text.slice(cursor, match.start));
    html += `<button class="epub-comment-underline" title="${escapeAttr(`${match.comment.username || 'User'}: ${match.comment.text || ''}`)}">${escHtml(text.slice(match.start, match.end))}</button>`;
    cursor = match.end;
  }
  html += escHtml(text.slice(cursor));
  return html;
}

function renderEpubCommentDecorations() {
  const textEl = $('epub-text');
  if (!textEl || !EPUB.chapters.length) return;

  textEl.querySelectorAll('.epub-para').forEach(paraEl => {
    const chapterIndex = parseInt(paraEl.dataset.chapter, 10);
    const paragraphIndex = parseInt(paraEl.dataset.idx, 10);
    const text = EPUB.chapters[chapterIndex]?.paragraphs?.[paragraphIndex] || '';
    paraEl.innerHTML = decorateEpubParagraph(text, chapterIndex, paragraphIndex);
  });

}

async function deleteComment(commentId) {
  const result = await api.comments.delete({ commentId });
  if (result.error) { showToast(result.error, true); return false; }
  setCurrentBookComments(getCurrentBookComments().filter(c => String(c.id) !== String(commentId)));
  renderCommentMarkers();
  return true;
}

function attachCommentDeleteMenu(el, commentId) {
  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm('Delete this comment?')) deleteComment(commentId);
  });
}

function renderSeekBarCommentDots() {
  const track = $('pb-seek-track');
  if (!track || !audio.duration) return;
  track.querySelectorAll('.seek-comment-dot').forEach(d => d.remove());
  const comments = getCurrentBookComments().filter(c => c.chapterIndex === S.chapterIndex && c.audioTimestampSeconds > 0);
  for (const comment of comments) {
    const pct = (comment.audioTimestampSeconds / audio.duration) * 100;
    if (pct < 0 || pct > 100) continue;
    const dot = document.createElement('button');
    dot.className = 'seek-comment-dot';
    dot.style.left = pct + '%';
    dot.title = `${comment.username || 'User'}: ${comment.text}`;
    attachCommentDeleteMenu(dot, comment.id);
    track.appendChild(dot);
  }
}

function renderCommentMarkers() {
  if ($('tp-body').children.length) renderTranscriptMarkersIn($('tp-body'));
  if ($('rfs-body').children.length) renderTranscriptMarkersIn($('rfs-body'));
  renderEpubCommentDecorations();
  renderSeekBarCommentDots();
}

async function refreshCurrentBookComments() {
  if (!authUser || !S.currentBook) return;
  const token = ++COMMENTS.requestToken;
  const bookId = String(S.currentBook.id);
  const result = await api.comments.getBook({ bookId });
  if (token !== COMMENTS.requestToken || String(S.currentBook?.id || '') !== bookId) return;
  if (result.error) {
    console.warn('Comment refresh failed:', result.error);
    return;
  }
  setCurrentBookComments(result.comments || []);
  resetCommentPlaybackState();
  renderCommentMarkers();
}

function ensureCommentPolling() {
  clearInterval(COMMENTS.pollTimer);
  COMMENTS.pollTimer = setInterval(() => {
    if (S.currentBook && authUser) refreshCurrentBookComments();
  }, 15000);
}

function openCommentComposer(context = {}) {
  if (!S.currentBook || !authUser) return;
  COMMENTS.composerContext = {
    bookId: S.currentBook.id,
    chapterIndex: S.chapterIndex,
    audioTimestampSeconds: Number((audio.currentTime || 0).toFixed(3)),
    selectedText: context.selectedText || null,
    epubChapterIndex: context.epubChapterIndex ?? null,
    epubParagraphIndex: context.epubParagraphIndex ?? null,
  };
  $('comment-drop-input').value = '';
  show($('comment-drop-popup'));
  $('comment-drop-input').focus();
}

async function submitCommentComposer() {
  const text = $('comment-drop-input').value.trim();
  if (!text || !COMMENTS.composerContext) return;
  const result = await api.comments.create({
    ...COMMENTS.composerContext,
    chapterIndex: S.chapterIndex,
    audioTimestampSeconds: Number((audio.currentTime || 0).toFixed(3)),
    text,
  });
  if (result.error) {
    showToast(result.error, true);
    return;
  }
  setCurrentBookComments([...getCurrentBookComments(), result.comment]);
  renderCommentMarkers();
  closeCommentComposer();
  showToast('Comment saved.');
  refreshCurrentBookComments();
}

function updateEpubSelectionFromRange() {
  if (!EPUB.isOpen) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    hideEpubSelectionPopup();
    return;
  }
  const range = selection.getRangeAt(0);
  if (!$('epub-text').contains(range.commonAncestorContainer)) {
    hideEpubSelectionPopup();
    return;
  }
  const text = selection.toString().replace(/\s+/g, ' ').trim();
  const startNode = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const paraEl = startNode?.closest('.epub-para');
  const sectionEl = startNode?.closest('.epub-section');
  if (!text || !paraEl || !sectionEl) {
    hideEpubSelectionPopup();
    return;
  }

  COMMENTS.epubSelection = {
    text,
    chapterIndex: parseInt(sectionEl.dataset.chapter, 10),
    paragraphIndex: parseInt(paraEl.dataset.idx, 10),
  };
  const popup = $('epub-selection-popup');
  show(popup);
  positionFloatingPopup(popup, null, {
    x: range.getBoundingClientRect().left,
    y: range.getBoundingClientRect().bottom + 12,
  });
}

// ── Confirm dialog ────────────────────────────────────────────────────────────
let _confirmResolve = null;
function showConfirmDialog(title, body) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    $('confirm-title').textContent = title;
    $('confirm-msg').textContent   = body;
    show($('confirm-modal'));
  });
}
function _confirmSetup() {
  $('confirm-ok').addEventListener('click', () => {
    hide($('confirm-modal'));
    if (_confirmResolve) { _confirmResolve(true); _confirmResolve = null; }
  });
  $('confirm-cancel').addEventListener('click', () => {
    hide($('confirm-modal'));
    if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
  });
  $('confirm-modal').addEventListener('click', e => {
    if (e.target === $('confirm-modal')) {
      hide($('confirm-modal'));
      if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
    }
  });
}

// ── EPUB Reader ───────────────────────────────────────────────────────────────


function updateEpubButton() {
  const book = S.currentBook;
  const hasEpub = !!(book?.hasEpub || book?.epubPath);
  toggle($('btn-epub'), hasEpub);
  toggle($('btn-epub-open'), hasEpub);
  $('btn-epub').classList.toggle('epub-active', hasEpub && EPUB.isOpen);
  $('btn-epub-open').classList.toggle('epub-active', hasEpub && EPUB.isOpen);
  $('btn-epub-open').textContent = EPUB.isOpen ? 'Close EPUB' : 'Open EPUB';
}

function setPlayerSidebarVisibility() {
  const showPanels = S.view === 'player' && (!EPUB.isOpen || EPUB.audioPanelsOpen);
  toggle($('chapter-sidebar'), showPanels);
  toggle($('bookmarks-sidebar'), showPanels);
}

function applyEpubLayoutState() {
  document.body.classList.toggle('epub-hide-app-sidebar', EPUB.isOpen && !EPUB.appSidebarOpen);
  document.body.classList.toggle('epub-hide-audio-panels', EPUB.isOpen && !EPUB.audioPanelsOpen);
  document.body.classList.toggle('epub-focus-mode', EPUB.isOpen && EPUB.readerOnly);
  $('epub-toc').classList.toggle('hidden', !EPUB.tocOpen);
  $('epub-app-sidebar-btn').classList.toggle('active', EPUB.appSidebarOpen);
  $('epub-audio-panels-btn').classList.toggle('active', EPUB.audioPanelsOpen);
  $('epub-toc-btn').classList.toggle('active', EPUB.tocOpen);
  $('epub-reader-mode-btn').classList.toggle('active', EPUB.readerOnly);
  setPlayerSidebarVisibility();
}

function setReaderOnlyMode(on) {
  EPUB.readerOnly = !!on;
  if (EPUB.readerOnly) {
    EPUB.appSidebarOpen = false;
    EPUB.audioPanelsOpen = false;
    EPUB.tocOpen = false;
  } else {
    EPUB.appSidebarOpen = true;
    EPUB.audioPanelsOpen = true;
    EPUB.tocOpen = true;
  }
  applyEpubLayoutState();
}

function normalizeEpubChapterTitle(rawTitle, bookTitle, index, paragraphs = []) {
  const collapse = s => String(s || '').replace(/\s+/g, ' ').trim();
  const normalize = s => collapse(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const looksLikeFileName = s => /\.(xhtml|html|htm|opf|ncx)$/i.test(s || '');
  const looksLikeGarbage = s => {
    const c = collapse(s);
    if (!c) return true;
    if (looksLikeFileName(c)) return true;
    if (normalize(c) === normalize(bookTitle)) return true;
    if (bookTitle && normalize(c).startsWith(normalize(bookTitle)) && c.length > Math.max(bookTitle.length + 18, 44)) return true;
    if (c.length > 90 && !/^ch(?:apter)?\.?\s*\d+/i.test(c)) return true;
    if (/^(untitled|toc|contents?|section|part)$/i.test(c)) return true;
    return false;
  };

  const candidates = [
    rawTitle,
    paragraphs[0],
    paragraphs.find(p => /^ch(?:apter)?\.?\s*\d+/i.test(collapse(p))),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const clean = cleanChapterTitle(collapse(candidate), bookTitle, index);
    if (!looksLikeGarbage(clean) && clean.length <= 80) return clean;
  }

  return `Chapter ${index + 1}`;
}

function applyEpubReaderSettings() {
  const s = EPUB.settings;
  const reader = $('epub-reader');
  const text = $('epub-text');
  if (!reader || !text) return;

  reader.style.setProperty('--epub-font',          s.fontFamily);
  reader.style.setProperty('--epub-size',          s.fontSize + 'px');
  reader.style.setProperty('--epub-lh',            s.lineHeight);
  reader.style.setProperty('--epub-ls',            s.letterSpacing + 'px');
  reader.style.setProperty('--epub-ws',            s.wordSpacing + 'px');
  reader.style.setProperty('--epub-para-spacing',  s.paragraphSpacing + 'px');
  reader.style.setProperty('--epub-margin-h',      s.marginH + 'px');
  reader.style.setProperty('--epub-align',         s.textAlign);
  reader.style.setProperty('--epub-hyphens',       s.hyphenation ? 'auto' : 'manual');
  const colWidth = EPUB_COLUMN_WIDTHS[s.columnWidth];
  reader.style.setProperty('--epub-col-width',     colWidth > 0 ? colWidth + 'px' : '100%');
  reader.style.background = s.bgColor;
  text.style.color = s.textColor;
}

function currentEpubScrollFraction() {
  const scroll = $('epub-scroll');
  if (!scroll) return 0;
  const current = EPUB.sectionEls[EPUB.currentChapter];
  if (!current) {
    const max = scroll.scrollHeight - scroll.clientHeight;
    return max > 0 ? Math.max(0, Math.min(1, scroll.scrollTop / max)) : 0;
  }
  const currentTop = current.offsetTop;
  const nextTop = EPUB.sectionEls[EPUB.currentChapter + 1]?.offsetTop ?? scroll.scrollHeight;
  const span = Math.max(1, nextTop - currentTop);
  const anchor = scroll.scrollTop + Math.min(scroll.clientHeight * 0.28, 180);
  return Math.max(0, Math.min(1, (anchor - currentTop) / span));
}


function renderEpubChapter(chapterIdx, restoreScroll = true) {
  if (!EPUB.chapters.length) return;
  chapterIdx = Math.max(0, Math.min(chapterIdx, EPUB.chapters.length - 1));
  EPUB.currentChapter = chapterIdx;

  const chapter = EPUB.chapters[chapterIdx];
  const text = $('epub-text');

  text.innerHTML = chapter.paragraphs.map((para, i) =>
    `<p class="epub-para" data-idx="${i}">${escHtml(para)}</p>`
  ).join('');

  // Update TOC highlight
  $('epub-toc-list').querySelectorAll('.epub-toc-item').forEach((el, i) => {
    el.classList.toggle('active', i === chapterIdx);
    if (i === chapterIdx) el.scrollIntoView({ block: 'nearest' });
  });

  // Update header
  const book = S.currentBook;
  if (book) {
    $('epub-hdr-book').textContent = book.title;
    $('epub-hdr-chapter').textContent = chapter.title || `Chapter ${chapterIdx + 1}`;
  }

  // Update scroll and progress
  const scroll = $('epub-scroll');
  if (restoreScroll && EPUB.readingPos[String(chapterIdx)] != null) {
    scroll.scrollTop = EPUB.readingPos[String(chapterIdx)];
  } else {
    scroll.scrollTop = 0;
  }

  updateEpubProgress();
  updateEpubTimeEstimate();
}

function setActiveEpubChapter(chapterIdx, { updateScroll = false } = {}) {
  if (!EPUB.chapters.length) return;
  chapterIdx = Math.max(0, Math.min(chapterIdx, EPUB.chapters.length - 1));
  EPUB.currentChapter = chapterIdx;
  const chapter = EPUB.chapters[chapterIdx];

  $('epub-toc-list').querySelectorAll('.epub-toc-item').forEach((el, i) => {
    el.classList.toggle('active', i === chapterIdx);
    if (updateScroll && i === chapterIdx) {
      el.scrollIntoView({ block: 'nearest', behavior: EPUB.currentScrollSource === 'user' ? 'auto' : 'smooth' });
    }
  });

  $('epub-text').querySelectorAll('.epub-section').forEach((el, i) => {
    el.classList.toggle('active', i === chapterIdx);
  });

  if (S.currentBook) {
    $('epub-hdr-book').textContent = S.currentBook.title;
    $('epub-hdr-chapter').textContent = chapter.title || `Chapter ${chapterIdx + 1}`;
  }

  updateEpubProgress();
  updateEpubTimeEstimate();
}

function scrollToEpubChapter(chapterIdx, { restoreScroll = false, behavior = 'smooth', source = 'nav' } = {}) {
  if (!EPUB.chapters.length) return;
  chapterIdx = Math.max(0, Math.min(chapterIdx, EPUB.chapters.length - 1));
  const scroll = $('epub-scroll');
  const section = EPUB.sectionEls[chapterIdx];
  if (!scroll || !section) {
    renderEpubChapter(chapterIdx, restoreScroll);
    return;
  }

  EPUB.currentScrollSource = source;
  EPUB.scrollReleaseAt = Date.now() + (behavior === 'smooth' ? 500 : 120);
  const savedTop = EPUB.readingPos[String(chapterIdx)];
  const top = restoreScroll && savedTop != null ? savedTop : Math.max(0, section.offsetTop - 8);
  scroll.scrollTo({ top, behavior });
  setActiveEpubChapter(chapterIdx, { updateScroll: true });
}

function detectActiveEpubChapterFromScroll() {
  if (!EPUB.isOpen || !EPUB.sectionEls.length) return;
  const scroll = $('epub-scroll');
  if (!scroll) return;
  const anchor = scroll.scrollTop + Math.min(scroll.clientHeight * 0.28, 180);
  let activeIdx = 0;
  for (let i = EPUB.sectionEls.length - 1; i >= 0; i--) {
    if (EPUB.sectionEls[i].offsetTop <= anchor) {
      activeIdx = i;
      break;
    }
  }
  setActiveEpubChapter(activeIdx, { updateScroll: true });
}

function queueActiveEpubDetection() {
  if (EPUB.activeRaf) cancelAnimationFrame(EPUB.activeRaf);
  EPUB.activeRaf = requestAnimationFrame(() => {
    EPUB.activeRaf = null;
    detectActiveEpubChapterFromScroll();
  });
}

function renderEpubContent() {
  const text = $('epub-text');
  text.innerHTML = EPUB.chapters.map((chapter, chapterIdx) => {
    const heading = escHtml(chapter.title || `Chapter ${chapterIdx + 1}`);
    const paragraphs = chapter.paragraphs.map((para, i) =>
      `<p class="epub-para" data-idx="${i}" data-chapter="${chapterIdx}">${escHtml(para)}</p>`
    ).join('');
    return `<section class="epub-section epub-section-${chapter.kind || 'story'}" data-chapter="${chapterIdx}">
      <h2 class="epub-section-title serif">${heading}</h2>
      ${paragraphs}
    </section>`;
  }).join('');

  EPUB.sectionEls = Array.from(text.querySelectorAll('.epub-section'));
  renderEpubCommentDecorations();
}

function updateEpubProgress() {
  if (!EPUB.chapters.length) return;
  const scroll = $('epub-scroll');
  if (!scroll) return;
  const chProgress = currentEpubScrollFraction();
  const pct = ((EPUB.currentChapter + chProgress) / EPUB.chapters.length) * 100;
  const fill = $('epub-progress-fill');
  if (fill) fill.style.width = pct + '%';
}

function updateEpubTimeEstimate() {
  const ch = EPUB.chapters[EPUB.currentChapter];
  if (!ch) return;
  const words = ch.paragraphs.join(' ').split(/\s+/).length;
  const WPM = 250;
  const mins = Math.max(1, Math.ceil((words * (1 - currentEpubScrollFraction())) / WPM));
  const el = $('epub-time-est');
  if (el) el.textContent = mins < 60
    ? `~${mins} min left`
    : `~${Math.round(mins / 60 * 10) / 10} hr left`;
}

function renderEpubTOC() {
  const list = $('epub-toc-list');
  const sections = [];
  const front = EPUB.chapters.filter(ch => ch.kind === 'frontMatter');
  const story = EPUB.chapters.filter(ch => ch.kind === 'story');
  const back = EPUB.chapters.filter(ch => ch.kind === 'backMatter');

  if (front.length) {
    sections.push(`<div class="epub-toc-group-label">Front Matter</div>`);
    sections.push(front.map(ch => {
      const i = EPUB.chapters.indexOf(ch);
      return `<button class="epub-toc-item epub-toc-item-front${i === EPUB.currentChapter ? ' active' : ''}" data-idx="${i}">${escHtml(ch.title || `Front Matter ${i + 1}`)}</button>`;
    }).join(''));
  }
  if (story.length) {
    sections.push(`<div class="epub-toc-group-label">Story</div>`);
    sections.push(story.map(ch => {
      const i = EPUB.chapters.indexOf(ch);
      return `<button class="epub-toc-item${i === EPUB.currentChapter ? ' active' : ''}" data-idx="${i}">${escHtml(ch.title || `Chapter ${i + 1}`)}</button>`;
    }).join(''));
  }
  if (back.length) {
    sections.push(`<div class="epub-toc-group-label">Extras</div>`);
    sections.push(back.map(ch => {
      const i = EPUB.chapters.indexOf(ch);
      return `<button class="epub-toc-item epub-toc-item-back${i === EPUB.currentChapter ? ' active' : ''}" data-idx="${i}">${escHtml(ch.title || `Extra ${i + 1}`)}</button>`;
    }).join(''));
  }
  list.innerHTML = sections.join('');
  list.querySelectorAll('.epub-toc-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      saveEpubScrollPos();
      scrollToEpubChapter(idx, { restoreScroll: true, behavior: 'smooth', source: 'toc' });
    });
  });
}

async function openEpubReader() {
  const book = S.currentBook;
  if (!book) return;

  show($('epub-reader'));
  EPUB.isOpen = true;
  updateEpubButton();

  $('epub-hdr-book').textContent = book.title;
  $('epub-hdr-chapter').textContent = 'Loading…';
  $('epub-text').innerHTML = '<p class="epub-para" style="color:var(--text-muted)">Loading EPUB…</p>';

  const res = await api.epub.ensureAndParse({
    bookId: book.id,
    epubKey: book.epubKey || null,
    bookTitle: book.title || '',
    chapterCount: book.chapters?.length || 0,
    audioChapters: (book.chapters || []).map(ch => ({ title: ch.title || '' })),
  });

  if (res.error) {
    $('epub-text').innerHTML = `<p class="epub-para" style="color:var(--danger)">${escHtml(res.error)}</p>`;
    $('epub-hdr-chapter').textContent = 'Error';
    return;
  }

  EPUB.chapters = (res.sections || res.chapters || []).map((chapter, i) => ({
    ...chapter,
    title: normalizeEpubChapterTitle(chapter.title, book.title, i, chapter.paragraphs || []),
  }));
  EPUB.frontMatterCount = res.frontMatterCount || 0;
  EPUB.backMatterCount = res.backMatterCount || 0;
  EPUB.storyStartIndex = res.storyStartIndex || EPUB.frontMatterCount || 0;

  // Load reading positions
  const pos = await api.epub.getReadingPos({ bookId: book.id });
  EPUB.readingPos = pos || {};

  // Render TOC
  renderEpubTOC();
  renderEpubContent();
  applyEpubLayoutState();

  // Restore last reading position
  const savedChapters = Object.keys(EPUB.readingPos).map(Number).filter(n => !isNaN(n) && n < EPUB.chapters.length);
  const startChapter = savedChapters.length ? Math.max(...savedChapters) : 0;
  scrollToEpubChapter(startChapter, { restoreScroll: true, behavior: 'auto', source: 'open' });

  applyEpubReaderSettings();
}

function closeEpubReader() {
  saveEpubScrollPos();
  hide($('epub-reader'));
  EPUB.isOpen = false;
  EPUB.readerOnly = false;
  EPUB.appSidebarOpen = true;
  EPUB.audioPanelsOpen = true;
  EPUB.tocOpen = true;
  EPUB.sectionEls = [];
  applyEpubLayoutState();
  updateEpubButton();
}

function saveEpubScrollPos() {
  if (!EPUB.isOpen || !S.currentBook) return;
  const scroll = $('epub-scroll');
  if (!scroll) return;
  EPUB.readingPos[String(EPUB.currentChapter)] = scroll.scrollTop;
  api.epub.saveReadingPos({
    bookId: S.currentBook.id,
    chapterIndex: EPUB.currentChapter,
    scrollTop: scroll.scrollTop,
  });
}

// ── EPUB Settings UI ─────────────────────────────────────────────────────────

function buildEpubSettingsUI() {
  // Font grid
  const fontGrid = $('es-font-grid');
  fontGrid.innerHTML = EPUB_FONTS.map(f =>
    `<button class="es-font-btn${EPUB.settings.fontFamily === f.value ? ' active' : ''}" data-font="${f.value}" style="font-family:${f.value}">${f.label}</button>`
  ).join('');
  fontGrid.querySelectorAll('.es-font-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      EPUB.settings.fontFamily = btn.dataset.font;
      fontGrid.querySelectorAll('.es-font-btn').forEach(b => b.classList.toggle('active', b === btn));
      applyEpubReaderSettings();
      scheduleEpubSettingsSave();
    });
  });

  // BG color swatches
  const bgSwatches = $('es-bg-swatches');
  bgSwatches.innerHTML = EPUB_BG_PRESETS.map(p =>
    `<div class="es-swatch${EPUB.settings.bgColor === p.color ? ' active' : ''}" data-color="${p.color}" style="background:${p.color}" title="${p.label}"></div>`
  ).join('');
  bgSwatches.querySelectorAll('.es-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      EPUB.settings.bgColor = sw.dataset.color;
      $('es-bg-color').value = sw.dataset.color;
      bgSwatches.querySelectorAll('.es-swatch').forEach(s => s.classList.toggle('active', s === sw));
      applyEpubReaderSettings();
      scheduleEpubSettingsSave();
    });
  });

  // Text color swatches
  const textSwatches = $('es-text-swatches');
  textSwatches.innerHTML = EPUB_TEXT_PRESETS.map(p =>
    `<div class="es-swatch${EPUB.settings.textColor === p.color ? ' active' : ''}" data-color="${p.color}" style="background:${p.color}" title="${p.label}"></div>`
  ).join('');
  textSwatches.querySelectorAll('.es-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      EPUB.settings.textColor = sw.dataset.color;
      $('es-text-color').value = sw.dataset.color;
      textSwatches.querySelectorAll('.es-swatch').forEach(s => s.classList.toggle('active', s === sw));
      applyEpubReaderSettings();
      scheduleEpubSettingsSave();
    });
  });

  // Sync sliders to current settings
  syncEpubSettingsSliders();
}

function syncEpubSettingsSliders() {
  const s = EPUB.settings;

  function slider(id, valId, value, suffix) {
    const el = $(id);
    const val = $(valId);
    if (!el || !val) return;
    el.value = value;
    val.textContent = (Math.round(value * 100) / 100) + suffix;
  }

  slider('es-size',   'es-size-val',   s.fontSize,         'px');
  slider('es-lh',     'es-lh-val',     s.lineHeight,        '');
  slider('es-ls',     'es-ls-val',     s.letterSpacing,    'px');
  slider('es-ws',     'es-ws-val',     s.wordSpacing,      'px');
  slider('es-ps',     'es-ps-val',     s.paragraphSpacing, 'px');
  slider('es-margin', 'es-margin-val', s.marginH,          'px');

  // Alignment buttons
  $('es-align-group').querySelectorAll('.es-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === s.textAlign);
  });

  // Column width buttons
  $('es-width-group').querySelectorAll('.es-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === s.columnWidth);
  });

  // Hyphenation toggle
  const hyph = $('es-hyphen');
  hyph.classList.toggle('active', s.hyphenation);
  hyph.textContent = s.hyphenation ? 'On' : 'Off';

  // Color pickers
  $('es-bg-color').value = s.bgColor;
  $('es-text-color').value = s.textColor;
}

function scheduleEpubSettingsSave() {
  clearTimeout(EPUB._saveTimer);
  EPUB._saveTimer = setTimeout(() => {
    api.epub.saveReaderSettings(EPUB.settings);
  }, 800);
}

function openEpubSettings() {
  buildEpubSettingsUI();
  show($('epub-settings'));
}
function closeEpubSettings() { hide($('epub-settings')); }

// ── Attach EPUB helpers ───────────────────────────────────────────────────────

async function attachEpubToBook(book) {
  const epubPath = await api.epub.openFilePicker();
  if (!epubPath) return;

  const isCat = !!(book.isCatalog || book.s3Prefix || book.uploaded_by || book.chapter_count);

  if (isCat) {
    let pct = 0;
    showToast('Uploading EPUB…');
    api.epub.onUploadProgress(d => {
      pct = d.progress || 0;
    });
    const res = await api.epub.attachCatalog({ bookId: book.id, epubPath });
    if (res.error) { showToast('Upload failed: ' + res.error, true); return; }
    // Update in-memory book
    book.hasEpub = true;
    book.epubKey = res.epubKey;
    showToast('EPUB attached to marketplace book.');
  } else {
    const res = await api.epub.attachLocal({ bookId: book.id, epubPath });
    if (res.error) { showToast('Failed: ' + res.error, true); return; }
    book.hasEpub = true;
    book.epubPath = epubPath;
    showToast('EPUB attached to book.');
  }

  // If this is the currently playing book, show the epub button
  if (S.currentBook?.id === book.id) {
    S.currentBook.hasEpub = true;
    if (isCat) S.currentBook.epubKey = book.epubKey;
    if (!isCat) S.currentBook.epubPath = book.epubPath;
    updateEpubButton();
  }
}

// ── EPUB UI setup (called from init) ─────────────────────────────────────────

async function setupEpubUI() {
  // Load saved settings
  const saved = await api.epub.getReaderSettings();
  if (saved) Object.assign(EPUB.settings, saved);
  applyEpubLayoutState();

  const toggleEpubReader = () => {
    if (EPUB.isOpen) closeEpubReader();
    else openEpubReader();
  };

  // EPUB buttons in player bar and player view
  $('btn-epub').addEventListener('click', toggleEpubReader);
  $('btn-epub-open').addEventListener('click', toggleEpubReader);

  // Close button
  $('epub-close-btn').addEventListener('click', () => {
    saveEpubScrollPos();
    closeEpubReader();
  });

  // TOC toggle
  $('epub-toc-btn').addEventListener('click', () => {
    EPUB.tocOpen = !EPUB.tocOpen;
    EPUB.readerOnly = false;
    applyEpubLayoutState();
  });

  $('epub-app-sidebar-btn').addEventListener('click', () => {
    EPUB.appSidebarOpen = !EPUB.appSidebarOpen;
    EPUB.readerOnly = false;
    applyEpubLayoutState();
  });

  $('epub-audio-panels-btn').addEventListener('click', () => {
    EPUB.audioPanelsOpen = !EPUB.audioPanelsOpen;
    EPUB.readerOnly = false;
    applyEpubLayoutState();
  });

  $('epub-reader-mode-btn').addEventListener('click', () => {
    setReaderOnlyMode(!EPUB.readerOnly);
  });

  // Settings btn
  $('epub-settings-btn').addEventListener('click', () => {
    if ($('epub-settings').classList.contains('hidden')) openEpubSettings();
    else closeEpubSettings();
  });
  $('epub-settings-close').addEventListener('click', closeEpubSettings);

  // Settings reset
  $('epub-settings-reset').addEventListener('click', () => {
    Object.assign(EPUB.settings, EPUB_DEFAULT_SETTINGS);
    applyEpubReaderSettings();
    buildEpubSettingsUI();
    scheduleEpubSettingsSave();
  });

  // Sliders
  function wireSlider(id, valId, suffix, key, transform) {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      EPUB.settings[key] = transform ? transform(v) : v;
      $(valId).textContent = (Math.round(v * 100) / 100) + suffix;
      applyEpubReaderSettings();
      scheduleEpubSettingsSave();
    });
  }
  wireSlider('es-size',   'es-size-val',   'px', 'fontSize',         parseInt);
  wireSlider('es-lh',     'es-lh-val',     '',   'lineHeight',        parseFloat);
  wireSlider('es-ls',     'es-ls-val',     'px', 'letterSpacing',     parseFloat);
  wireSlider('es-ws',     'es-ws-val',     'px', 'wordSpacing',       parseFloat);
  wireSlider('es-ps',     'es-ps-val',     'px', 'paragraphSpacing',  parseInt);
  wireSlider('es-margin', 'es-margin-val', 'px', 'marginH',           parseInt);

  // Alignment
  $('es-align-group').querySelectorAll('.es-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      EPUB.settings.textAlign = btn.dataset.val;
      $('es-align-group').querySelectorAll('.es-opt').forEach(b => b.classList.toggle('active', b === btn));
      applyEpubReaderSettings();
      scheduleEpubSettingsSave();
    });
  });

  // Column width
  $('es-width-group').querySelectorAll('.es-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      EPUB.settings.columnWidth = btn.dataset.val;
      $('es-width-group').querySelectorAll('.es-opt').forEach(b => b.classList.toggle('active', b === btn));
      applyEpubReaderSettings();
      scheduleEpubSettingsSave();
    });
  });

  // Hyphenation toggle
  $('es-hyphen').addEventListener('click', () => {
    EPUB.settings.hyphenation = !EPUB.settings.hyphenation;
    $('es-hyphen').classList.toggle('active', EPUB.settings.hyphenation);
    $('es-hyphen').textContent = EPUB.settings.hyphenation ? 'On' : 'Off';
    applyEpubReaderSettings();
    scheduleEpubSettingsSave();
  });

  // Color pickers (native input[type=color])
  $('es-bg-color').addEventListener('input', () => {
    EPUB.settings.bgColor = $('es-bg-color').value;
    applyEpubReaderSettings();
    scheduleEpubSettingsSave();
  });
  $('es-text-color').addEventListener('input', () => {
    EPUB.settings.textColor = $('es-text-color').value;
    applyEpubReaderSettings();
    scheduleEpubSettingsSave();
  });

  // Chapter nav buttons
  $('epub-prev-ch').addEventListener('click', () => {
    if (EPUB.currentChapter > 0) {
      const target = EPUB.currentChapter - 1;
      saveEpubScrollPos();
      scrollToEpubChapter(target, { restoreScroll: true, behavior: 'smooth', source: 'nav' });
    }
  });
  $('epub-next-ch').addEventListener('click', () => {
    if (EPUB.currentChapter < EPUB.chapters.length - 1) {
      const target = EPUB.currentChapter + 1;
      saveEpubScrollPos();
      scrollToEpubChapter(target, { restoreScroll: true, behavior: 'smooth', source: 'nav' });
    }
  });

  // Scroll → save position + update progress bar
  $('epub-scroll').addEventListener('scroll', () => {
    updateEpubProgress();
    updateEpubTimeEstimate();
    if (Date.now() >= EPUB.scrollReleaseAt) EPUB.currentScrollSource = 'user';
    queueActiveEpubDetection();
    clearTimeout(EPUB._scrollTimer);
    EPUB._scrollTimer = setTimeout(saveEpubScrollPos, 600);
  });

  window.addEventListener('resize', () => {
    clearTimeout(EPUB._resizeTimer);
    EPUB._resizeTimer = setTimeout(() => {
      if (EPUB.isOpen) queueActiveEpubDetection();
    }, 120);
  });
}

// ── Context menu ──────────────────────────────────────────────────────────────
async function showContextMenu(e, bookId) {
  e.preventDefault();
  S.ctxBookId = bookId;
  S.ctxTranscript = null;

  const menu = $('ctx-menu');
  // Clamp so menu doesn't overflow the viewport
  menu.style.left = Math.min(e.clientX, window.innerWidth  - 210) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - 280) + 'px';

  hide($('ctx-view-transcript'));
  hide($('ctx-retranscribe'));
  hide($('ctx-smart-sync'));

  const book = S.books.find(b => b.id === bookId);
  const isCat = !!book?.isCatalog;

  // Local-only options
  toggle($('ctx-rename'),    !isCat);
  toggle($('ctx-set-cover'), !isCat);
  toggle($('ctx-set-bg'),    !isCat);
  toggle($('ctx-split'),     !isCat && book?.chapterCount === 1);
  $('ctx-transcribe').textContent = isCat ? '↓ Download + Transcribe…' : '◎ Transcribe…';
  toggle($('ctx-transcribe'), !!book);
  toggle($('ctx-reimport'),  !isCat);
  toggle($('ctx-attach-epub'), !!book);

  show(menu);

  if (!isCat) {
    const transcriptState = await api.transcriptExists(bookId);
    S.ctxTranscript = transcriptState?.exists || false;
    if (!menu.classList.contains('hidden')) {
      toggle($('ctx-view-transcript'), !!transcriptState?.exists);
      toggle($('ctx-retranscribe'), !!transcriptState?.exists);
      toggle($('ctx-smart-sync'), !!transcriptState?.exists);
    }
  }
}

function hideContextMenu() { hide($('ctx-menu')); }

// ── Import ────────────────────────────────────────────────────────────────────
async function importBook() {
  const folder = await api.openFolder();
  if (!folder) return;
  const book = await api.importFolder(folder);
  if (book.error) { alert(book.error); return; }

  // Merge into books list
  const idx = S.books.findIndex(b => b.id === book.id);
  if (idx >= 0) S.books[idx] = book;
  else S.books.unshift(book);

  renderLibrary();
}

// ── Audio events ──────────────────────────────────────────────────────────────
function setupAudio() {
  audio.addEventListener('play', () => {
    S.isPlaying = true;
    updatePlayButton(true);
    // Save locally every 3s
    clearInterval(S.saveInterval);
    S.saveInterval = setInterval(savePlayback, 3000);
    // Push progress to Supabase every 3s (separate from local save so
    // the debounce in schedulePushProgress never blocks the playing case)
    clearInterval(S.syncInterval);
    S.syncInterval = setInterval(() => {
      if (!authUser || !S.currentBook) return;
      api.sync.push({
        type: 'progress',
        bookId: S.currentBook.id,
        bookTitle: S.currentBook.title,
        chapterIndex: S.chapterIndex,
        position: audio.currentTime,
        speed: S.speed,
      });
    }, 3000);
  });

  audio.addEventListener('pause', () => {
    S.isPlaying = false;
    updatePlayButton(false);
    clearInterval(S.saveInterval);
    clearInterval(S.syncInterval);
    savePlayback();
  });

  audio.addEventListener('ended', () => {
    clearInterval(S.saveInterval);
    clearInterval(S.syncInterval);
    const next = S.chapterIndex + 1;
    if (S.currentBook && next < S.currentBook.chapters.length) {
      playChapter(next, 0);
    } else {
      S.isPlaying = false;
      updatePlayButton(false);
      savePlayback();
    }
  });

  audio.addEventListener('timeupdate', () => {
    if (!S.isSeeking) updateSeekBar();
    enqueueTimedComments();
  });

  audio.addEventListener('error', e => {
    console.error('Audio error:', e);
  });
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
function setupKeys() {
  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    switch (e.code) {
      case 'Escape':
        if (EPUB.isOpen && EPUB.readerOnly) {
          e.preventDefault();
          setReaderOnlyMode(false);
        }
        break;
      case 'Space':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        skip(-10);
        break;
      case 'ArrowRight':
        e.preventDefault();
        skip(10);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setVolume(S.volume + 0.1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setVolume(S.volume - 0.1);
        break;
      case 'KeyN':
        nextChapter();
        break;
      case 'KeyP':
        prevChapter();
        break;
      case 'KeyC':
        e.preventDefault();
        openCommentComposer();
        break;
    }
  });
}

// ── UI event listeners ────────────────────────────────────────────────────────
function setupUI() {
  ensureSmartSyncProgressListener();
  ensureCommentPolling();

  // Titlebar
  $('btn-minimize').addEventListener('click', () => api.minimize());
  $('btn-maximize').addEventListener('click', () => api.maximize());
  $('btn-close').addEventListener('click', () => { savePlayback(); api.close(); });

  // Nav
  $('nav-library').addEventListener('click', () => showView('library'));
  $('nav-player').addEventListener('click', () => { if (S.currentBook) showView('player'); });
  $('nav-catalog').addEventListener('click', () => showView('catalog'));

  // Import
  $('import-btn').addEventListener('click', importBook);
  $('import-btn-empty').addEventListener('click', importBook);

  // Search
  $('search-input').addEventListener('input', e => {
    S.searchQuery = e.target.value;
    renderLibrary();
  });

  // Transport
  $('btn-play').addEventListener('click', togglePlay);
  $('btn-prev').addEventListener('click', prevChapter);
  $('btn-next').addEventListener('click', nextChapter);
  $('btn-skip-back').addEventListener('click', () => skip(-10));
  $('btn-skip-fwd').addEventListener('click', () => skip(10));

  // Volume
  $('vol-slider').addEventListener('input', e => {
    setVolume(parseFloat(e.target.value));
  });

  // Speed
  $('speed-select').addEventListener('change', e => setSpeed(e.target.value));

  // Sleep timer
  $('btn-sleep').addEventListener('click', toggleSleepPopup);
  document.querySelectorAll('.timer-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.timer-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setSleepTimer(parseInt(btn.dataset.min, 10));
    });
  });
  $('btn-cancel-timer').addEventListener('click', cancelSleepTimer);

  // Bookmarks sidebar toggle
  $('btn-bookmarks').addEventListener('click', () => {
    $('btn-bookmarks').classList.toggle('active');
    if (S.currentBook) {
      showView('player'); // ensure in player view
      // already shown via chapter-sidebar / bookmarks-sidebar
    }
  });

  // Add bookmark
  $('add-bookmark-btn').addEventListener('click', addBookmark);
  $('bm-save').addEventListener('click', saveBookmark);
  $('bm-cancel').addEventListener('click', () => hide($('bm-modal')));
  $('bm-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveBookmark();
    if (e.key === 'Escape') hide($('bm-modal'));
  });

  // Context menu
  $('ctx-open').addEventListener('click', () => { hideContextMenu(); if (S.ctxBookId) openBook(S.ctxBookId); });

  $('ctx-rename').addEventListener('click', () => {
    hideContextMenu();
    const book = S.books.find(b => b.id === S.ctxBookId);
    if (!book) return;
    $('rename-input').value = book.title;
    show($('rename-modal'));
    $('rename-input').select();
  });

  async function commitRename() {
    const newTitle = $('rename-input').value.trim();
    hide($('rename-modal'));
    if (!newTitle) return;
    const book = S.books.find(b => b.id === S.ctxBookId);
    if (!book) return;
    await api.renameBook({ bookId: book.id, title: newTitle });
    book.title = newTitle;
    if (S.currentBook?.id === book.id) {
      S.currentBook.title = newTitle;
      updateNowPlayingDisplay();
      updatePlayerBarInfo();
    }
    renderLibrary();
  }

  $('rename-save').addEventListener('click', commitRename);
  $('rename-cancel').addEventListener('click', () => hide($('rename-modal')));
  $('rename-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') hide($('rename-modal'));
  });

  // ── Rate modal ────────────────────────────────────────────────────────────
  const RATE = { bookId: null, value: null };

  function renderRateModal(value) {
    renderStarElements(
      Array.from($('rate-modal-stars').querySelectorAll('.si-rate')),
      value || 0
    );
    $('rate-val-label').textContent = value ? `${value} / 5` : 'No rating';
  }

  $('ctx-rate').addEventListener('click', () => {
    hideContextMenu();
    const book = S.books.find(b => b.id === S.ctxBookId);
    if (!book) return;
    RATE.bookId = book.id;
    RATE.value = book.rating || null;
    renderRateModal(RATE.value);
    show($('rate-modal'));
  });

  let _rateHover = null;
  $('rate-modal-stars').querySelectorAll('.si-rate').forEach(si => {
    si.addEventListener('mousemove', e => {
      const pos = parseInt(si.dataset.pos, 10);
      _rateHover = e.offsetX < si.offsetWidth / 2 ? pos - 0.5 : pos;
      renderRateModal(_rateHover);
    });
    si.addEventListener('click', () => {
      if (_rateHover !== null) {
        RATE.value = _rateHover;
        renderRateModal(RATE.value);
      }
    });
  });
  $('rate-modal-stars').addEventListener('mouseleave', () => {
    _rateHover = null;
    renderRateModal(RATE.value);
  });

  $('rate-save').addEventListener('click', async () => {
    hide($('rate-modal'));
    if (RATE.bookId && RATE.value != null) await rateBook(RATE.bookId, RATE.value);
  });
  $('rate-cancel').addEventListener('click', () => hide($('rate-modal')));
  $('rate-clear').addEventListener('click', async () => {
    hide($('rate-modal'));
    if (RATE.bookId) await clearRating(RATE.bookId);
  });
  $('rate-modal').addEventListener('click', e => {
    if (e.target === $('rate-modal')) hide($('rate-modal'));
  });

  // ── Now Playing star interaction ──────────────────────────────────────────
  let _nowHover = null;
  $('now-stars').querySelectorAll('.si-now').forEach(si => {
    si.addEventListener('mousemove', e => {
      const pos = parseInt(si.dataset.pos, 10);
      _nowHover = e.offsetX < si.offsetWidth / 2 ? pos - 0.5 : pos;
      renderNowStars(_nowHover);
    });
    si.addEventListener('click', () => {
      if (S.currentBook && _nowHover != null) rateBook(S.currentBook.id, _nowHover);
    });
  });
  $('now-stars').addEventListener('mouseleave', () => {
    _nowHover = null;
    renderNowStars(S.currentBook?.rating || 0);
  });

  $('ctx-set-cover').addEventListener('click', async () => {
    hideContextMenu();
    const book = S.books.find(b => b.id === S.ctxBookId);
    if (!book) return;

    const coverPath = await api.setCover(book.id);
    if (!coverPath || coverPath.error) return;

    book.coverPath = coverPath;
    if (S.currentBook?.id === book.id) {
      S.currentBook.coverPath = coverPath;
      updateNowPlayingDisplay();
      updatePlayerBarInfo();
    }
    renderLibrary();
  });

  $('ctx-split').addEventListener('click', () => {
    hideContextMenu();
    if (S.ctxBookId) openSplitModal(S.ctxBookId);
  });

  $('ctx-set-bg').addEventListener('click', async () => {
    hideContextMenu();
    const book = S.books.find(b => b.id === S.ctxBookId);
    if (!book) return;

    const bgPath = await api.setBackground(book.id);
    if (!bgPath || bgPath.error) return;

    book.bgPath = bgPath;
    if (S.currentBook?.id === book.id) {
      S.currentBook.bgPath = bgPath;
      updateNowPlayingDisplay();
    }
  });

  $('ctx-transcribe').addEventListener('click', async () => {
    hideContextMenu();
    let book = S.books.find(b => b.id === S.ctxBookId);
    if (!book) return;
    if (book.isCatalog) {
      const result = await api.catalog.addToLibrary({ bookId: book.id });
      if (result?.error) {
        showToast('Error: ' + result.error, true);
        return;
      }
      await loadLibrary();
      book = S.books.find(b => b.id === S.ctxBookId && !b.isCatalog) || await api.getBook(S.ctxBookId);
      if (!book) {
        showToast('Downloaded book could not be loaded.', true);
        return;
      }
    }
    await runContextMenuTranscription(book);
  });

  $('ctx-view-transcript').addEventListener('click', async () => {
    hideContextMenu();
    const book = S.books.find(b => b.id === S.ctxBookId);
    if (!book) return;
    await loadAndShowTranscript(book);
  });

  $('ctx-retranscribe').addEventListener('click', async () => {
    hideContextMenu();
    const book = S.books.find(b => b.id === S.ctxBookId);
    if (!book) return;
    await runContextMenuTranscription(book, { force: true });
  });

  $('ctx-smart-sync').addEventListener('click', async () => {
    hideContextMenu();
    const book = S.books.find(b => b.id === S.ctxBookId);
    if (!book) return;
    const result = await startSmartSyncForBook(book);
    if (result?.error) return;
    showToast(result?.cacheHit ? 'Smart sync loaded from cache.' : 'Smart sync completed.');
  });

  $('ctx-attach-epub').addEventListener('click', async () => {
    hideContextMenu();
    const book = S.books.find(b => b.id === S.ctxBookId);
    if (!book) return;
    await attachEpubToBook(book);
  });

  $('tp-close').addEventListener('click', closeTranscriptPanel);
  $('tp-expand').addEventListener('click', openReaderFullscreen);
  $('tp-follow-btn').addEventListener('click', toggleKaraoke);
  $('rfs-close').addEventListener('click', closeReaderFullscreen);
  $('rfs-follow-btn').addEventListener('click', toggleKaraoke);
  $('btn-transcript').addEventListener('click', toggleTranscriptPanel);
  $('btn-comments').addEventListener('click', () => openCommentComposer());
  $('comment-drop-input').addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCommentComposer();
    if (e.key === 'Enter') submitCommentComposer();
  });
  $('epub-selection-comment-btn').addEventListener('click', () => {
    if (!COMMENTS.epubSelection) return;
    openCommentComposer({
      selectedText: COMMENTS.epubSelection.text,
      epubChapterIndex: COMMENTS.epubSelection.chapterIndex,
      epubParagraphIndex: COMMENTS.epubSelection.paragraphIndex,
    });
    hideEpubSelectionPopup();
  });
  api.comments.onSeekRequest(({ chapterIndex, audioTimestampSeconds }) => {
    if (chapterIndex !== S.chapterIndex) {
      playChapter(chapterIndex, audioTimestampSeconds);
    } else {
      seekToTime(audioTimestampSeconds);
    }
  });
  $('epub-text').addEventListener('mouseup', updateEpubSelectionFromRange);
  $('epub-text').addEventListener('keyup', updateEpubSelectionFromRange);

  $('ctx-reimport').addEventListener('click', async () => {
    hideContextMenu();
    const book = S.books.find(b => b.id === S.ctxBookId);
    if (!book) return;
    const result = await api.importFolder(book.folderPath);
    if (result.error) { alert(result.error); return; }
    const idx = S.books.findIndex(b => b.id === result.id);
    if (idx >= 0) S.books[idx] = result;
    if (S.currentBook?.id === result.id) {
      S.currentBook = result;
      renderChapterList();
      updateNowPlayingDisplay();
    }
    renderLibrary();
  });

  $('ctx-delete').addEventListener('click', async () => {
    hideContextMenu();
    const book = S.books.find(b => b.id === S.ctxBookId);
    if (!book) return;
    if (!confirm(`Remove "${book.title}" from library?`)) return;
    const removalCatalogId = getLibraryRemovalCatalogId(book);
    if (removalCatalogId) {
      await api.catalog.removeFromLibrary({ bookId: removalCatalogId });
    } else {
      await api.deleteBook(book.id);
    }
    S.books = S.books.filter(b =>
      b.id !== book.id && linkedCatalogBookId(b) !== removalCatalogId
    );
    if (S.currentBook?.id === book.id) {
      audio.pause();
      audio.src = '';
      S.currentBook = null;
      $('nav-player').disabled = true;
      hide($('player-bar'));
      hide($('chapter-sidebar'));
      hide($('bookmarks-sidebar'));
      showView('library');
    } else {
      renderLibrary();
    }
  });

  // Close popups on outside click
  document.addEventListener('click', e => {
    const popup = $('sleep-popup');
    if (!popup.classList.contains('hidden') && !popup.contains(e.target) && e.target !== $('btn-sleep')) {
      hide(popup);
    }
    if (!$('ctx-menu').classList.contains('hidden') && !$('ctx-menu').contains(e.target)) {
      hideContextMenu();
    }
    const sp = $('settings-popup');
    if (!sp.classList.contains('hidden') && !sp.contains(e.target)
        && !e.target.closest('#btn-settings') && !e.target.closest('#btn-account')) {
      hide(sp);
    }
    const composer = $('comment-drop-popup');
    if (!composer.classList.contains('hidden') && !composer.contains(e.target) && !e.target.closest('#btn-comments')) {
      closeCommentComposer();
    }
    const selection = $('epub-selection-popup');
    if (!selection.classList.contains('hidden') && !selection.contains(e.target)) {
      hideEpubSelectionPopup();
    }
  });

  // Save on page unload
  window.addEventListener('beforeunload', () => savePlayback());

  // ── Approval overlay ──────────────────────────────────────────────────────
  const approvalLogoutBtn = $('approval-logout-btn');
  if (approvalLogoutBtn) approvalLogoutBtn.addEventListener('click', async () => {
    clearInterval(S.saveInterval);
    clearInterval(S.syncInterval);
    audio.pause();
    audio.src = '';
    S.isPlaying = false;
    await api.auth.logout();
    authUser = null;
    clearCommentNotificationState();
    S.books = [];
    S.currentBook = null;
    S.bookmarks = [];
    S.chapterIndex = 0;
    S.searchQuery = '';
    hide($('approval-overlay-legacy'));
    $('auth-overlay').classList.remove('auth-fade-out');
    setAuthMode('login');
    show($('auth-overlay'));
    renderLibrary();
  });

  // ── Catalog refresh ────────────────────────────────────────────────────────
  $('catalog-refresh-btn').addEventListener('click', () => renderCatalog(true));

  // ── Catalog upload button ──────────────────────────────────────────────────
  $('catalog-upload-btn').addEventListener('click', openCatalogUploadModal);

  $('s3-modal-cancel').addEventListener('click', () => hide($('s3-modal')));
  $('s3-modal').addEventListener('click', e => { if (e.target === $('s3-modal')) hide($('s3-modal')); });

  $('s3-test-btn').addEventListener('click', async () => {
    const res = $('s3-test-result');
    res.textContent = 'Testing…'; res.className = 's3-test-result'; show(res);
    // Save current form values first
    await saveS3FormValues();
    const result = await api.s3.testConfig();
    if (result.success) {
      res.textContent = '✓ Connected successfully'; res.className = 's3-test-result s3-test-ok';
    } else {
      res.textContent = '✗ ' + result.error; res.className = 's3-test-result s3-test-err';
    }
  });

  $('s3-modal-save').addEventListener('click', async () => {
    await saveS3FormValues();
    hide($('s3-modal'));
  });

  // ── Settings popup (sidebar account button + legacy player-bar button) ───────
  function openSettingsPopup() {
    if (authUser) $('settings-email').textContent = displayUsername(authUser);
    $('settings-popup').classList.toggle('hidden');
    hide($('sleep-popup'));
  }
  $('btn-account').addEventListener('click', openSettingsPopup);
  $('btn-settings').addEventListener('click', openSettingsPopup);

  $('btn-logout').addEventListener('click', async () => {
    hide($('settings-popup'));

    // Stop audio and clear all playback state
    clearInterval(S.saveInterval);
    clearInterval(S.syncInterval);
    audio.pause();
    audio.src = '';
    S.isPlaying = false;

    await api.auth.logout();
    authUser = null;
    clearCommentNotificationState();
    closeCommentComposer();
      hideEpubSelectionPopup();

    // Reset all in-memory state
    S.books = [];
    S.currentBook = null;
    S.bookmarks = [];
    S.chapterIndex = 0;
    S.searchQuery = '';

    updateSyncDot('idle');
    updateApprovedUI();
    updateAccountBtn();

    // Switch to library view so player is hidden
    showView('library');

    // Reset overlay to login form and show
    $('auth-email').value = '';
    $('auth-username').value = '';
    $('auth-password').value = '';
    hide($('auth-error'));
    hide($('approval-overlay-legacy'));
    $('auth-overlay').classList.remove('auth-fade-out');
    setAuthMode('login');
    show($('auth-overlay'));
    renderLibrary();
  });

  // ── Auth overlay ──────────────────────────────────────────────────────────
  $('auth-switch-btn').addEventListener('click', () => {
    const mode = $('auth-overlay').dataset.mode === 'login' ? 'signup' : 'login';
    setAuthMode(mode);
    hide($('auth-error'));
  });

  $('auth-submit').addEventListener('click', handleAuthSubmit);

  $('auth-email').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if ($('auth-overlay').dataset.mode === 'signup') $('auth-username').focus();
      else $('auth-password').focus();
    }
  });
  $('auth-username').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('auth-password').focus();
  });
  $('auth-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAuthSubmit();
  });

}

// ── Chapter splitting ─────────────────────────────────────────────────────────

const SENSITIVITY = {
  low:    { duration: 3.0, noise: -25, desc: 'Conservative — detects breaks ≥3.0 s at −25 dB' },
  medium: { duration: 2.0, noise: -30, desc: 'Balanced — detects breaks ≥2.0 s at −30 dB' },
  high:   { duration: 1.0, noise: -35, desc: 'Aggressive — detects breaks ≥1.0 s at −35 dB' },
};

const SPLIT = {
  bookId:        null,
  sensitivity:   'medium',
  method:        'silence',
  chapterCount:  10,
  splitPoints:   [],
  totalDuration: 0,
};

const METHOD_DESC = {
  silence: 'Fast — splits at silence gaps only',
  ai:      'Accurate — Whisper AI scans every 8 min for "Chapter…" announcements (requires Python + faster-whisper)',
  count:   'Reliable — you supply the count; picks the N−1 longest silence gaps',
};

const SPLIT_SECTIONS = [
  'split-cfg', 'split-detecting', 'split-ai-state', 'split-preview-state',
  'split-warn-state', 'split-splitting-state', 'split-done-state', 'split-error-state',
];

function showSplitSection(id) {
  SPLIT_SECTIONS.forEach(s => toggle($(s), s === id));
}

function _setSplitMethod(method) {
  SPLIT.method = method;
  document.querySelectorAll('.method-btn').forEach(b => b.classList.toggle('active', b.dataset.method === method));
  $('split-method-desc').textContent = METHOD_DESC[method];
  // Show/hide sensitivity and count sections based on method
  toggle($('split-sensitivity-wrap'), method === 'silence');
  toggle($('split-count-wrap'),       method === 'count');
}

function openSplitModal(bookId) {
  SPLIT.bookId = bookId;
  SPLIT.splitPoints = [];
  SPLIT.totalDuration = 0;
  _setSplitMethod('silence');
  document.querySelectorAll('.sens-btn').forEach(b => b.classList.toggle('active', b.dataset.val === 'medium'));
  SPLIT.sensitivity = 'medium';
  $('split-sens-desc').textContent = SENSITIVITY.medium.desc;
  $('split-count-input').value = String(SPLIT.chapterCount);
  showSplitSection('split-cfg');
  show($('split-modal'));
}

function closeSplitModal() { hide($('split-modal')); }

function showPreview() {
  const count = SPLIT.splitPoints.length + 1;
  $('split-preview-count').textContent = count;

  const list = $('split-preview-list');
  list.innerHTML = '';
  const starts = [0, ...SPLIT.splitPoints];
  starts.forEach((start, i) => {
    const end = i < SPLIT.splitPoints.length ? SPLIT.splitPoints[i] : SPLIT.totalDuration;
    const dur = end > 0 ? end - start : 0;
    const item = document.createElement('div');
    item.className = 'split-preview-item';
    item.innerHTML =
      `<span class="split-preview-chnum">Chapter ${i + 1}</span>` +
      `<span class="split-preview-ts">${fmt(start)}</span>` +
      (dur > 0 ? `<span class="split-preview-dur">${fmt(dur)}</span>` : '');
    list.appendChild(item);
  });

  showSplitSection('split-preview-state');
}

function showSplitWarn(msg) {
  $('split-warn-msg').textContent = msg;
  const canProceed = SPLIT.splitPoints.length > 0;
  $('split-warn-proceed').disabled = !canProceed;
  $('split-warn-proceed').style.opacity = canProceed ? '' : '0.4';
  showSplitSection('split-warn-state');
}

async function runSplitAnalysis() {
  if (SPLIT.method === 'ai') {
    // ── Smart Scan (AI) — sliding window via Python/Whisper ───────────────────
    showSplitSection('split-ai-state');
    $('split-ai-msg').textContent = 'Loading Whisper model…';
    $('split-ai-sub').textContent = '(may download ~150 MB on first run)';
    $('split-ai-prog-fill').style.width = '0%';

    api.onAIProgress(data => {
      if (data.type === 'loading') {
        $('split-ai-msg').textContent = 'Loading Whisper model…';
        $('split-ai-sub').textContent = '';
      } else if (data.type === 'device') {
        $('split-ai-sub').textContent = data.device === 'cuda'
          ? `GPU · ${data.compute_type}`
          : `CPU · ${data.compute_type}`;
      } else if (data.type === 'progress') {
        const pct = Math.round((data.current / data.total) * 100);
        $('split-ai-prog-fill').style.width = pct + '%';
        $('split-ai-msg').textContent = `Scanning ${fmt(data.timestamp)} / ${fmt(data.duration)}`;
      }
    });

    const aiResult = await api.detectChaptersAI(SPLIT.bookId);

    if (aiResult.error) {
      let msg, sub;
      if (aiResult.error === 'not_installed') {
        msg = 'faster-whisper is not installed.';
        sub = 'Run: pip install faster-whisper';
      } else if (aiResult.error === 'no_python') {
        msg = 'Python 3 not found.';
        sub = 'Install Python 3.9–3.11 and add it to PATH, then restart Grimoire.';
      } else {
        msg = 'AI scan failed.';
        sub = aiResult.message || '';
      }
      $('split-error-msg').textContent = msg;
      $('split-error-sub').textContent = sub;
      showSplitSection('split-error-state');
      return;
    }

    SPLIT.splitPoints   = aiResult.confirmed.map(c => c.timestamp);
    SPLIT.totalDuration = aiResult.totalDuration || 0;

  } else if (SPLIT.method === 'count') {
    // ── Known chapter count — rank silences by duration ───────────────────────
    showSplitSection('split-detecting');
    $('split-detect-msg').textContent = 'Scanning audio for silence gaps…';

    api.onSplitProgress(data => {
      if (data.type === 'detecting') $('split-detect-msg').textContent = data.message;
    });

    const count = parseInt($('split-count-input').value, 10) || 10;
    SPLIT.chapterCount = count;
    const result = await api.detectByCount(SPLIT.bookId, count);

    if (result.error) { closeSplitModal(); alert('Error: ' + result.error); return; }
    SPLIT.splitPoints   = result.splitPoints;
    SPLIT.totalDuration = result.totalDuration;

  } else {
    // ── Silence Only ──────────────────────────────────────────────────────────
    showSplitSection('split-detecting');
    $('split-detect-msg').textContent = 'Analyzing audio for silences…';

    api.onSplitProgress(data => {
      if (data.type === 'detecting') $('split-detect-msg').textContent = data.message;
    });

    const cfg    = SENSITIVITY[SPLIT.sensitivity];
    const result = await api.detectSilences(SPLIT.bookId, { silenceDuration: cfg.duration, noiseFloor: cfg.noise });

    if (result.error) { closeSplitModal(); alert('Error: ' + result.error); return; }
    SPLIT.splitPoints   = result.splitPoints;
    SPLIT.totalDuration = result.totalDuration;
  }

  // ── Show preview or warn ──────────────────────────────────────────────────
  if (SPLIT.splitPoints.length === 0) {
    showSplitWarn('No chapter breaks detected. Try adjusting the settings or switching methods.');
  } else {
    showPreview();
  }
}

async function runSplitOperation() {
  showSplitSection('split-splitting-state');
  $('split-prog-fill').style.width = '0%';

  api.onSplitProgress(data => {
    if (data.type === 'splitting') {
      const pct = Math.round((data.current / data.total) * 100);
      $('split-prog-fill').style.width = pct + '%';
      $('split-split-msg').textContent = data.message;
      $('split-split-sub').textContent = `${data.current} of ${data.total} chapters`;
    } else if (data.type === 'importing') {
      $('split-split-msg').textContent = data.message;
      $('split-split-sub').textContent = '';
      $('split-prog-fill').style.width = '100%';
    }
  });

  const result = await api.splitAtPoints(SPLIT.bookId, SPLIT.splitPoints);

  if (result.error) {
    closeSplitModal();
    alert('Split failed: ' + result.error);
    return;
  }

  const idx = S.books.findIndex(b => b.id === SPLIT.bookId);
  if (idx >= 0) S.books[idx] = result;

  if (S.currentBook?.id === SPLIT.bookId) {
    audio.pause();
    audio.src = '';
    S.isPlaying = false;
    S.currentBook = result;
    S.chapterIndex = 0;
    renderChapterList();
    updateNowPlayingDisplay();
    updatePlayerBarInfo();
    updatePlayButton(false);
  }

  $('split-done-msg').textContent = `Split into ${result.chaptersCreated} chapters successfully.`;
  showSplitSection('split-done-state');
}

function setupSplitModal() {
  // Method buttons
  document.querySelectorAll('.method-btn').forEach(btn => {
    btn.addEventListener('click', () => _setSplitMethod(btn.dataset.method));
  });

  // Sensitivity buttons
  document.querySelectorAll('.sens-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      SPLIT.sensitivity = btn.dataset.val;
      document.querySelectorAll('.sens-btn').forEach(b => b.classList.toggle('active', b === btn));
      $('split-sens-desc').textContent = SENSITIVITY[SPLIT.sensitivity].desc;
    });
  });

  // Chapter count input — clamp on blur
  $('split-count-input').addEventListener('blur', () => {
    const v = parseInt($('split-count-input').value, 10);
    $('split-count-input').value = String(Math.max(2, Math.min(500, isNaN(v) ? 10 : v)));
  });

  $('split-cfg-cancel').addEventListener('click', closeSplitModal);
  $('split-cfg-go').addEventListener('click', runSplitAnalysis);

  $('split-warn-back').addEventListener('click', () => showSplitSection('split-cfg'));
  $('split-warn-proceed').addEventListener('click', runSplitOperation);
  $('split-error-back').addEventListener('click', () => showSplitSection('split-cfg'));
  $('split-preview-back').addEventListener('click', () => showSplitSection('split-cfg'));
  $('split-preview-go').addEventListener('click', runSplitOperation);

  $('split-done-close').addEventListener('click', () => {
    closeSplitModal();
    renderLibrary();
  });

  // Close on backdrop click (only in config state)
  $('split-modal').addEventListener('click', e => {
    if (e.target === $('split-modal') && !$('split-cfg').classList.contains('hidden')) {
      closeSplitModal();
    }
  });
}

// ── Catalog view ──────────────────────────────────────────────────────────────

let _catalogCache = null;

function catalogBookCardHTML(book) {
  const col = bookColor(book.title);
  const inLib = catalogBookIsInLibrary(book.id);
  const coverStyle = book.coverUrl
    ? `background: url('${book.coverUrl}') center/cover no-repeat`
    : `background:${col.bg}; color:${col.text}`;
  const coverInner = book.coverUrl ? '' : initials(book.title);
  const chStr = book.chapter_count ? `${book.chapter_count} ch.` : '';
  return `
  <div class="book-card catalog-browse-card${inLib ? ' in-library' : ''}" data-id="${book.id}">
    ${inLib ? '<span class="in-lib-badge">In Library</span>' : ''}
    <div class="book-cover" style="${coverStyle}">${coverInner}</div>
    <div class="book-card-info">
      <p class="book-card-title">${book.title}</p>
      ${book.author ? `<p class="book-card-meta">${escHtml(book.author)}</p>` : ''}
      ${chStr ? `<p class="book-card-sub">${chStr}</p>` : ''}
    </div>
  </div>`;
}

async function renderCatalog(forceRefresh = false) {
  const content = $('catalog-content');

  if (!authUser) {
    content.innerHTML = '';
    $('catalog-empty-msg').textContent = 'Sign in to browse the Marketplace.';
    hide($('catalog-loading')); show($('catalog-empty')); return;
  }

  if (!forceRefresh && _catalogCache) {
    _renderCatalogContent(_catalogCache);
    return;
  }

  content.innerHTML = '';
  show($('catalog-loading')); hide($('catalog-empty'));

  const result = await api.catalog.getAll();
  hide($('catalog-loading'));

  if (result.error) {
    $('catalog-empty-msg').textContent = 'Failed to load Marketplace: ' + result.error;
    show($('catalog-empty')); return;
  }

  _catalogCache = result.books;
  _renderCatalogContent(_catalogCache);
}

function _renderCatalogContent(books) {
  const q = ($('catalog-search-input')?.value || '').toLowerCase();
  let filtered = q
    ? books.filter(b =>
        b.title.toLowerCase().includes(q) ||
        (b.author || '').toLowerCase().includes(q) ||
        (b.series || '').toLowerCase().includes(q))
    : books;

  const content = $('catalog-content');
  hide($('catalog-loading'));

  if (filtered.length === 0) {
    content.innerHTML = '';
    $('catalog-empty-msg').textContent = q ? 'No matching books.' : 'No audiobooks in the Marketplace yet.';
    show($('catalog-empty')); return;
  }
  hide($('catalog-empty'));

  // Group by series; standalone books (no series) go in a separate group
  const seriesMap = new Map(); // series name → [{book}]
  const standalone = [];

  for (const book of filtered) {
    if (book.series) {
      if (!seriesMap.has(book.series)) seriesMap.set(book.series, []);
      seriesMap.get(book.series).push(book);
    } else {
      standalone.push(book);
    }
  }

  let html = '';

  // Series sections
  for (const [seriesName, seriesBooks] of seriesMap) {
    html += `<div class="catalog-section">
      <h2 class="catalog-section-title serif">${escHtml(seriesName)}</h2>
      <div class="book-grid">${seriesBooks.map(catalogBookCardHTML).join('')}</div>
    </div>`;
  }

  // Standalone section
  if (standalone.length) {
    const label = seriesMap.size > 0 ? 'Standalone' : 'All Books';
    html += `<div class="catalog-section">
      <h2 class="catalog-section-title serif">${label}</h2>
      <div class="book-grid">${standalone.map(catalogBookCardHTML).join('')}</div>
    </div>`;
  }

  content.innerHTML = html;

  content.querySelectorAll('.catalog-browse-card').forEach(card => {
    card.addEventListener('click', () => {
      const book = filtered.find(b => b.id === card.dataset.id);
      if (book) openBookDetailModal(book);
    });
    card.addEventListener('contextmenu', e => {
      const book = filtered.find(b => b.id === card.dataset.id);
      if (book) showCatalogContextMenu(e, book);
    });
  });
}

// ── Catalog context menu ────────────────────────────────────────────────────

let _ctxCatalogBook = null;

function showCatalogContextMenu(e, book) {
  e.preventDefault();
  _ctxCatalogBook = book;

  const isPrivileged = authUser && book.uploaded_by === authUser.id;

  toggle($('cat-ctx-edit'),   isPrivileged);
  toggle($('cat-ctx-attach-epub'), isPrivileged);
  toggle($('cat-ctx-delete'), isPrivileged);
  const divider = document.querySelector('.cat-ctx-owner-only');
  if (divider) toggle(divider, isPrivileged);

  // Already in library?
  const inLib = catalogBookIsInLibrary(book.id);
  const hasLocalCopy = catalogBookHasLocalCopy(book.id);
  $('cat-ctx-add').textContent = hasLocalCopy
    ? '✓ In Library'
    : (inLib ? '↓ Download to Library' : '+ Add to Library');
  $('cat-ctx-add').disabled = hasLocalCopy;

  const menu = $('cat-ctx-menu');
  menu.style.left = Math.min(e.clientX, window.innerWidth  - 220) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - 160) + 'px';
  show(menu);
}

function hideCatalogContextMenu() { hide($('cat-ctx-menu')); }

function openBookDetailModal(book) {
  const col = bookColor(book.title);

  // Cover
  const wrap = $('book-detail-cover-wrap');
  if (book.coverUrl) {
    wrap.innerHTML = `<img src="${book.coverUrl}" class="book-detail-cover-img" alt="Cover">`;
  } else {
    wrap.innerHTML = `<div class="book-detail-cover-placeholder" style="background:${col.bg};color:${col.text}">${initials(book.title)}</div>`;
  }

  $('book-detail-title').textContent = book.title;
  $('book-detail-author').textContent = book.author || '';

  const seriesEl = $('book-detail-series');
  if (book.series) {
    seriesEl.textContent = book.series + (book.series_order ? ` #${book.series_order}` : '');
    show(seriesEl);
  } else {
    seriesEl.textContent = '';
    hide(seriesEl);
  }

  const chapEl = $('book-detail-chapters');
  if (chapEl) {
    chapEl.textContent = book.chapter_count
      ? `${book.chapter_count} chapter${book.chapter_count !== 1 ? 's' : ''}`
      : '';
  }

  // Add to Library button
  const addBtn = $('book-detail-add-btn');
  const alreadyAdded = catalogBookIsInLibrary(book.id);
  const hasLocalCopy = catalogBookHasLocalCopy(book.id);
  addBtn.disabled    = hasLocalCopy;
  addBtn.textContent = hasLocalCopy
    ? 'In Library'
    : (alreadyAdded ? 'Download to My Library' : 'Add to My Library');
  addBtn.classList.toggle('already-added', hasLocalCopy);

  // Remove old listener by cloning
  const newBtn = addBtn.cloneNode(true);
  addBtn.parentNode.replaceChild(newBtn, addBtn);

  if (!hasLocalCopy) {
    newBtn.addEventListener('click', async () => {
      newBtn.disabled    = true;
      newBtn.textContent = 'Downloading…';
      const res = await api.catalog.addToLibrary({ bookId: book.id });
      if (res.error) {
        newBtn.disabled    = false;
        newBtn.textContent = alreadyAdded ? 'Download to My Library' : 'Add to My Library';
        alert('Error: ' + res.error);
      } else {
        newBtn.textContent = 'In Library';
        newBtn.classList.add('already-added');
        await loadLibrary();
        if (_catalogCache) _renderCatalogContent(_catalogCache);
      }
    });
  }

  show($('book-detail-modal'));
}

// ── Catalog upload modal ───────────────────────────────────────────────────────

const CUP = { folderPath: null, coverPath: null };

function showCupStep(stepId) {
  ['cup-step1','cup-step2','cup-step3','cup-step4','cup-step5'].forEach(id => {
    toggle($(id), id === stepId);
  });
}

async function openCatalogUploadModal() {
  CUP.folderPath = null;
  CUP.coverPath  = null;
  $('cup-folder-display').textContent = '';
  hide($('cup-folder-display'));
  hide($('cup-step1-next'));
  $('cup-title').value       = '';
  $('cup-author').value      = '';
  $('cup-series').value      = '';
  $('cup-series-order').value = '';
  $('cup-cover-display').textContent = '';

  showCupStep('cup-step1');
  show($('catalog-upload-modal'));
}

function setupCatalogUploadModal() {
  $('cup-step1-cancel').addEventListener('click', () => hide($('catalog-upload-modal')));
  $('catalog-upload-modal').addEventListener('click', e => {
    if (e.target === $('catalog-upload-modal')) hide($('catalog-upload-modal'));
  });

  // Step 1: pick folder
  $('cup-pick-folder').addEventListener('click', async () => {
    const folder = await api.openFolder();
    if (!folder) return;
    CUP.folderPath = folder;
    $('cup-folder-display').textContent = folder.split(/[\\/]/).pop();
    show($('cup-folder-display'));
    show($('cup-step1-next'));
  });

  $('cup-step1-next').addEventListener('click', () => {
    if (!CUP.folderPath) return;
    if (!$('cup-title').value) {
      $('cup-title').value = CUP.folderPath.split(/[\\/]/).pop().replace(/[_-]/g, ' ').trim();
    }
    showCupStep('cup-step2');
  });

  // Step 2: metadata
  $('cup-step2-back').addEventListener('click', () => showCupStep('cup-step1'));

  $('cup-step2-next').addEventListener('click', () => {
    const title = $('cup-title').value.trim();
    if (!title) { alert('Book title is required.'); return; }
    showCupStep('cup-step3');
  });

  // Step 3: cover art + upload trigger
  $('cup-step3-back').addEventListener('click', () => showCupStep('cup-step2'));

  $('cup-pick-cover').addEventListener('click', async () => {
    const filePath = await api.openImageFile();
    if (!filePath) return;
    CUP.coverPath = filePath;
    $('cup-cover-display').textContent = filePath.split(/[\\/]/).pop();
  });

  $('cup-step3-upload').addEventListener('click', async () => {
    // Capture ALL form values immediately before any DOM changes
    const title       = $('cup-title').value.trim();
    const author      = $('cup-author').value.trim() || null;
    const series      = $('cup-series').value.trim() || null;
    const seriesOrder = $('cup-series-order').value || null;
    const coverPath   = CUP.coverPath || null;
    const folderPath  = CUP.folderPath;

    if (!title) { alert('Book title is required.'); return; }

    console.log('[catalog:upload] payload:', { folderPath, title, author, series, seriesOrder });

    // Step 4: progress
    showCupStep('cup-step4');
    $('cup-progress-fill').style.width = '0%';
    $('cup-progress-pct').textContent  = '0%';
    $('cup-progress-msg').textContent  = 'Starting…';

    api.catalog.onUploadProgress(data => {
      const pct = data.progress || 0;
      $('cup-progress-fill').style.width = pct + '%';
      $('cup-progress-pct').textContent   = pct + '%';
      $('cup-progress-msg').textContent   = data.message || '';
    });

    const res = await api.catalog.upload({ folderPath, title, author, series, seriesOrder, coverPath });

    if (res.error) {
      $('cup-progress-msg').textContent = 'Error: ' + res.error;
      $('cup-progress-fill').style.width = '0%';
      setTimeout(() => showCupStep('cup-step3'), 2000);
    } else {
      showCupStep('cup-step5');
      _catalogCache = null;
    }
  });

  // Step 5: done
  $('cup-done-btn').addEventListener('click', () => {
    hide($('catalog-upload-modal'));
    renderCatalog(true);
  });

  $('book-detail-close').addEventListener('click', () => hide($('book-detail-modal')));
  $('book-detail-modal').addEventListener('click', e => {
    if (e.target === $('book-detail-modal')) hide($('book-detail-modal'));
  });

  $('catalog-search-input').addEventListener('input', () => {
    if (_catalogCache) _renderCatalogContent(_catalogCache);
  });

  // ── Catalog context menu handlers ─────────────────────────────────────────
  document.addEventListener('click', e => {
    if (!$('cat-ctx-menu').classList.contains('hidden') && !$('cat-ctx-menu').contains(e.target)) {
      hideCatalogContextMenu();
    }
  });

  $('cat-ctx-add').addEventListener('click', async () => {
    hideCatalogContextMenu();
    const book = _ctxCatalogBook;
    if (!book) return;
    const res = await api.catalog.addToLibrary({ bookId: book.id });
    if (res.error) { showToast('Error: ' + res.error, true); return; }
    showToast(`"${book.title}" downloaded to your library.`);
    await loadLibrary();
    if (_catalogCache) _renderCatalogContent(_catalogCache);
  });

  $('cat-ctx-edit').addEventListener('click', () => {
    hideCatalogContextMenu();
    const book = _ctxCatalogBook;
    if (!book) return;
    $('edit-book-title').value        = book.title || '';
    $('edit-book-author').value       = book.author || '';
    $('edit-book-series').value       = book.series || '';
    $('edit-book-series-order').value = book.series_order || '';
    show($('edit-book-modal'));
  });

  $('cat-ctx-attach-epub').addEventListener('click', async () => {
    hideCatalogContextMenu();
    const book = _ctxCatalogBook;
    if (!book) return;
    await attachEpubToBook(book);
    _catalogCache = null;
    renderCatalog(true);
  });

  $('edit-book-cancel').addEventListener('click', () => hide($('edit-book-modal')));
  $('edit-book-modal').addEventListener('click', e => {
    if (e.target === $('edit-book-modal')) hide($('edit-book-modal'));
  });

  $('edit-book-save').addEventListener('click', async () => {
    const book = _ctxCatalogBook;
    if (!book) return;
    const title       = $('edit-book-title').value.trim();
    const author      = $('edit-book-author').value.trim() || null;
    const series      = $('edit-book-series').value.trim() || null;
    const seriesOrder = $('edit-book-series-order').value || null;
    if (!title) { alert('Title is required.'); return; }
    $('edit-book-save').disabled = true;
    $('edit-book-save').textContent = 'Saving…';
    const res = await api.catalog.editBook({ bookId: book.id, title, author, series, seriesOrder });
    $('edit-book-save').disabled = false;
    $('edit-book-save').textContent = 'Save';
    if (res.error) { alert('Error: ' + res.error); return; }
    hide($('edit-book-modal'));
    _catalogCache = null;
    renderCatalog(true);
  });

  $('cat-ctx-delete').addEventListener('click', async () => {
    hideCatalogContextMenu();
    const book = _ctxCatalogBook;
    if (!book) return;

    const confirmed = await showConfirmDialog(
      'Remove from Marketplace',
      `Are you sure you want to remove "${book.title}" from the marketplace? This cannot be undone.`
    );
    if (!confirmed) return;

    // Remove card from DOM immediately for instant feedback
    const card = document.querySelector(`.catalog-browse-card[data-id="${book.id}"]`);
    if (card) card.remove();

    const res = await api.catalog.deleteBook({ bookId: book.id });
    if (res.error) {
      showToast('Error removing book: ' + res.error, true);
      // Restore the view since removal failed
      _catalogCache = null;
      renderCatalog(true);
      return;
    }

    // Remove from local library if present
    S.books = S.books.filter(b => b.id !== book.id && linkedCatalogBookId(b) !== book.id);
    _catalogCache = null;

    showToast(`"${book.title}" removed from the marketplace.`);
    renderCatalog(true);
    renderLibrary();
  });

  // Wire up the generic confirm dialog buttons
  _confirmSetup();
}

// ── S3 settings ────────────────────────────────────────────────────────────────

async function openS3SettingsModal() {
  const cfg = await api.s3.getConfig();
  $('s3-region').value = cfg?.region || '';
  $('s3-bucket').value = cfg?.bucket || '';
  $('s3-access-key').value = cfg?.accessKeyId || '';
  $('s3-secret-key').value = ''; // never show secret
  $('s3-secret-key').placeholder = cfg?.hasSecret ? 'Leave blank to keep current' : 'Enter secret key';
  hide($('s3-test-result'));
  show($('s3-modal'));
}

async function saveS3FormValues() {
  await api.s3.saveConfig({
    region:          $('s3-region').value.trim()     || 'us-east-1',
    bucket:          $('s3-bucket').value.trim(),
    accessKeyId:     $('s3-access-key').value.trim(),
    secretAccessKey: $('s3-secret-key').value || undefined,
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function setAuthMode(mode) {
  $('auth-overlay').dataset.mode = mode;
  // Switch from loading spinner to the actual form
  hide($('auth-loading'));
  show($('auth-form-wrap'));
  const isLogin = mode === 'login';
  $('auth-email').classList.remove('hidden');
  $('auth-username').classList.toggle('hidden', isLogin);
  $('auth-form-subtitle').textContent = isLogin
    ? 'Sign in with your email to access your library'
    : 'Create an account with email, username, and password';
  $('auth-submit').textContent      = isLogin ? 'Sign In' : 'Create Account';
  $('auth-switch-text').textContent = isLogin ? "Don't have an account?" : 'Already have one?';
  $('auth-switch-btn').textContent  = isLogin ? 'Sign Up' : 'Sign In';
}

function hideAuthOverlay() {
  const el = $('auth-overlay');
  el.classList.add('auth-fade-out');
  el.addEventListener('transitionend', () => { hide(el); el.classList.remove('auth-fade-out'); }, { once: true });
}

function showAuthError(msg) {
  const el = $('auth-error');
  el.textContent = msg;
  show(el);
}

async function checkAuthAndPull() {
  const session = await api.auth.getSession();
  if (session?.user) {
    authUser = session.user;
    $('settings-email').textContent = displayUsername(authUser);
    updateApprovedUI();
    updateAccountBtn();
    api.sync.onStatus(updateSyncDot);
    updateSyncDot('syncing');
    hideAuthOverlay();
    await api.sync.pull();
    await loadLibrary();
  } else {
    // No session — switch spinner to login form
    setAuthMode('login');
  }
}

function updateApprovedUI() {
  // Show upload button in catalog view only for logged-in users.
  const btn = $('catalog-upload-btn');
  if (btn) toggle(btn, !!authUser);
}

function updateAccountBtn() {
  const el = $('sidebar-email');
  if (el) el.textContent = displayUsername(authUser);
}

async function handleAuthSubmit() {
  const email = $('auth-email').value.trim();
  const username = $('auth-username').value.trim();
  const password = $('auth-password').value;
  const mode = $('auth-overlay').dataset.mode;
  if (!email || !password || (mode === 'signup' && !username)) return;

  const btn  = $('auth-submit');
  btn.disabled    = true;
  btn.textContent = 'Please wait…';
  hide($('auth-error'));

  const result = mode === 'login'
    ? await api.auth.login({ email, password })
    : await api.auth.signup({ email, username, password });

  if (result.error) {
    showAuthError(result.error);
    btn.disabled = false;
    setAuthMode(mode);
  } else if (result.needsConfirmation) {
    showAuthError('Check your email to confirm your account, then sign in.');
    btn.disabled = false;
    setAuthMode('login');
  } else {
    authUser = result.user;
    $('settings-email').textContent = displayUsername(authUser);
    updateAccountBtn();
    updateApprovedUI();
    api.sync.onStatus(updateSyncDot);
    updateSyncDot('syncing');
    hideAuthOverlay();
    await api.sync.pull();
    await loadLibrary();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  setupAudio();
  setupSeekBars();
  setupKeys();
  setupUI();
  await setupEpubUI();
  setupSplitModal();
  setupCatalogUploadModal();
  updateVolSlider();
  await checkAuthAndPull();
}

document.addEventListener('DOMContentLoaded', init);
