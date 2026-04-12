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

// ── Auth / sync state ─────────────────────────────────────────────────────────
let authUser = null;      // { id, email } when logged in
let _progressPushTimer = null;

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

  await loadAndShowTranscript(book);
}

function setTranscriptStatus(msg, active = false) {
  const el = $('tp-status');
  el.textContent = msg;
  el.classList.toggle('active', active);
}

// ── View switching ───────────────────────────────────────────────────────────
function showView(name) {
  S.view = name;
  toggle($('library-view'), name === 'library');
  toggle($('player-view'), name === 'player');
  toggle($('chapter-sidebar'), name === 'player');
  toggle($('bookmarks-sidebar'), name === 'player');
  toggle($('cloud-view'), name === 'cloud');

  $('nav-library').classList.toggle('active', name === 'library');
  $('nav-player').classList.toggle('active', name === 'player');
  if ($('nav-cloud')) $('nav-cloud').classList.toggle('active', name === 'cloud');

  if (name === 'library') {
    renderLibrary();
  }
}

// ── Library ──────────────────────────────────────────────────────────────────
async function loadLibrary() {
  S.books = await api.getLibrary();
  renderLibrary();
}

function renderLibrary() {
  const q = S.searchQuery.toLowerCase();
  const books = q ? S.books.filter(b => b.title.toLowerCase().includes(q)) : S.books;

  if (books.length === 0 && !q) {
    hide($('book-grid')); show($('empty-library'));
    return;
  }
  show($('book-grid')); hide($('empty-library'));

  $('book-grid').innerHTML = books.map(bookCardHTML).join('');

  $('book-grid').querySelectorAll('.book-card').forEach(card => {
    const id = card.dataset.id;
    const book = S.books.find(b => b.id === id);

    // Initialise input stars to current rating
    renderCardStars(card, book?.rating || 0);

    // Star hover & click
    card.querySelectorAll('.book-stars-input .si').forEach(si => {
      si.addEventListener('mousemove', e => {
        const pos = parseInt(si.dataset.pos, 10);
        const val = e.offsetX < si.offsetWidth / 2 ? pos - 0.5 : pos;
        renderCardStars(card, val);
      });
    });
    card.querySelector('.book-stars-input').addEventListener('mouseleave', () => {
      renderCardStars(card, book?.rating || 0);
    });

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
    card.addEventListener('contextmenu', e => showContextMenu(e, id));
  });
}

function bookCardHTML(book) {
  const col = bookColor(book.title);
  const pct = Math.round(bookProgress(book) * 100);
  const isNow = S.currentBook?.id === book.id;
  const coverUrl = book.coverPath ? pathToUrl(book.coverPath) : null;
  const isCloud = book.isCloudOnly;
  const hasCloud = !!book.cloudPaths || isCloud;

  const coverStyle = coverUrl
    ? `background: url('${coverUrl}') center/cover no-repeat`
    : `background:${col.bg}; color:${col.text}`;
  const coverInner = coverUrl ? '' : initials(book.title);

  return `
  <div class="book-card${isNow ? ' now-playing' : ''}${isCloud ? ' cloud-only-card' : ''}" data-id="${book.id}">
    ${isNow ? '<span class="now-playing-badge">Now Playing</span>' : ''}
    ${hasCloud ? `<div class="cloud-badge" title="${isCloud ? 'Cloud only' : 'Uploaded to cloud'}"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg></div>` : ''}
    <div class="book-cover" style="${coverStyle}">
      ${isCloud ? `<div class="cloud-cover-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg></div>` : coverInner}
      ${isNow ? `<div class="book-cover-eq"><div class="eq-bars${S.isPlaying ? '' : ' paused'}" style="transform:scale(0.8)"><span></span><span></span><span></span><span></span></div></div>` : ''}
    </div>
    <div class="book-card-info">
      <p class="book-card-title">${book.title}</p>
      <p class="book-card-meta">${book.chapterCount} chapter${book.chapterCount !== 1 ? 's' : ''}${isCloud ? ' · Cloud' : ''}</p>
      ${book.rating ? `<div class="book-stars-static">${starsStaticHTML(book.rating)}</div>` : ''}
      ${!isCloud ? `<div class="book-stars-input">${starsInputHTML()}</div>` : ''}
      ${!isCloud ? `<div class="progress-bar"><div class="progress-fill-bar" style="width:${pct}%"></div></div>` : ''}
      ${!isCloud && pct > 0 ? `<p class="progress-pct">${pct}%</p>` : ''}
    </div>
  </div>`;
}

// ── Open book ────────────────────────────────────────────────────────────────
async function openBook(bookId) {
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

  // Resolve audio source: prefer local file, fall back to S3 presigned URL
  let src;
  if (chapter.filepath && !book.isCloudOnly) {
    src = pathToUrl(chapter.filepath);
  } else {
    // Cloud-only book or no local file — fetch presigned URL
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

function skip(secs) {
  if (!audio.src) return;
  audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + secs));
}

function prevChapter() {
  if (!S.currentBook) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
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
  if (book.coverPath) {
    $('book-art').style.background = `url('${pathToUrl(book.coverPath)}') center/cover no-repeat`;
    $('book-art-text').style.display = 'none';
  } else {
    $('book-art').style.background = col.bg;
    $('book-art-text').style.display = '';
    $('book-art-text').style.color = col.text;
    $('book-art-text').textContent = initials(book.title);
  }

  // ── Immersive blurred background ─────────────────────────────────────────
  // Priority: custom bg > cover art > vivid hue-derived gradient.
  // Use cssText to set all properties atomically — avoids cascade/ordering bugs.
  const bgSrc = book.bgPath || book.coverPath || null;
  const bg = $('player-bg');
  if (bgSrc) {
    bg.style.cssText = [
      'position:absolute', 'inset:-80px', 'z-index:0',
      `background-image:url('${pathToUrl(bgSrc)}')`,
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
}

function updatePlayerBarInfo() {
  const book = S.currentBook;
  if (!book) return;
  const chapter = book.chapters[S.chapterIndex];
  const col = bookColor(book.title);

  if (book.coverPath) {
    $('mini-art').style.background = `url('${pathToUrl(book.coverPath)}') center/cover no-repeat`;
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
  audio.currentTime = ratio * audio.duration;
  updateSeekBar();
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
          audio.currentTime = bm.position;
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

  // Only show split option for single-file books
  const book = S.books.find(b => b.id === bookId);
  toggle($('ctx-split'), book?.chapterCount === 1);

  // Cloud upload/remove options (only when logged in)
  const hasCloud = !!book?.cloudPaths;
  const canCloud = !!authUser;
  toggle($('ctx-upload-cloud'), canCloud && !hasCloud);
  toggle($('ctx-remove-cloud'), canCloud && hasCloud);

  show(menu);

  const transcript = await api.getTranscript(bookId);
  S.ctxTranscript = transcript;
  if (!menu.classList.contains('hidden')) {
    toggle($('ctx-view-transcript'), !!transcript);
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
    }
  });
}

// ── UI event listeners ────────────────────────────────────────────────────────
function setupUI() {
  // Titlebar
  $('btn-minimize').addEventListener('click', () => api.minimize());
  $('btn-maximize').addEventListener('click', () => api.maximize());
  $('btn-close').addEventListener('click', () => { savePlayback(); api.close(); });

  // Nav
  $('nav-library').addEventListener('click', () => showView('library'));
  $('nav-player').addEventListener('click', () => { if (S.currentBook) showView('player'); });

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
    const book = S.books.find(b => b.id === S.ctxBookId);
    if (!book) return;

    openTranscriptPanel(book);
    setTranscriptStatus(`Starting transcription of ${book.chapterCount} chapter${book.chapterCount !== 1 ? 's' : ''}…`, true);

    api.onTranscribeProgress((data) => {
      if (data.type === 'model_load') {
        setTranscriptStatus('Loading Whisper model…', true);
      } else if (data.type === 'device') {
        const label = data.device === 'cuda'
          ? `Running on GPU (${data.compute_type})`
          : `Running on CPU (${data.compute_type})`;
        setTranscriptStatus(label, true);
      } else if (data.type === 'model_download') {
        setTranscriptStatus(`Downloading model… ${data.pct}%`, true);
      } else {
        // type === 'chapter'
        const { chapterIndex, total, chapterTitle, text, words } = data;
        setTranscriptStatus(`Transcribed chapter ${chapterIndex + 1} of ${total}…`, true);
        appendChapter(chapterIndex + 1, chapterTitle, text, words || null);
      }
    });

    const result = await api.transcribe(book.id);

    if (result?.error) {
      setTranscriptStatus('Error: ' + result.error, false);
      return;
    }

    setTranscriptStatus('Transcription complete', false);
    // Update context-menu cache so "View Transcript" appears next time
    S.ctxTranscript = result;
  });

  $('ctx-view-transcript').addEventListener('click', async () => {
    hideContextMenu();
    const book = S.books.find(b => b.id === S.ctxBookId);
    if (!book) return;
    await loadAndShowTranscript(book);
  });

  $('tp-close').addEventListener('click', closeTranscriptPanel);
  $('tp-expand').addEventListener('click', openReaderFullscreen);
  $('tp-follow-btn').addEventListener('click', toggleKaraoke);
  $('rfs-close').addEventListener('click', closeReaderFullscreen);
  $('rfs-follow-btn').addEventListener('click', toggleKaraoke);
  $('btn-transcript').addEventListener('click', toggleTranscriptPanel);

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
    await api.deleteBook(book.id);
    S.books = S.books.filter(b => b.id !== book.id);
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
    if (!sp.classList.contains('hidden') && !sp.contains(e.target) && !e.target.closest('#btn-settings')) {
      hide(sp);
    }
  });

  // Save on page unload
  window.addEventListener('beforeunload', () => savePlayback());

  // ── Cloud nav ─────────────────────────────────────────────────────────────
  $('nav-cloud').addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    $('nav-cloud').classList.add('active');
    showView('cloud');
    renderCloudLibrary();
  });

  $('cloud-refresh-btn').addEventListener('click', renderCloudLibrary);

  $('cloud-settings-btn').addEventListener('click', () => {
    hide($('settings-popup'));
    openS3SettingsModal();
  });

  // ── Cloud context menu items ───────────────────────────────────────────────
  $('ctx-upload-cloud').addEventListener('click', async () => {
    hideContextMenu();
    const book = S.books.find(b => b.id === S.ctxBookId);
    if (!book) return;
    startUpload(book);
  });

  $('ctx-remove-cloud').addEventListener('click', async () => {
    hideContextMenu();
    const book = S.books.find(b => b.id === S.ctxBookId);
    if (!book) return;
    if (!confirm(`Remove "${book.title}" from cloud storage? Local files are kept.`)) return;
    const res = await api.s3.removeFromCloud(book.id);
    if (res.error) { alert('Remove failed: ' + res.error); return; }
    delete book.cloudPaths; delete book.cloudStatus;
    renderLibrary();
  });

  // ── Upload modal ──────────────────────────────────────────────────────────
  $('upload-done-btn').addEventListener('click', () => {
    hide($('upload-modal'));
    renderLibrary();
  });
  $('upload-error-close').addEventListener('click', () => hide($('upload-modal')));

  // ── S3 settings modal ──────────────────────────────────────────────────────
  $('btn-s3-settings').addEventListener('click', () => {
    hide($('settings-popup'));
    openS3SettingsModal();
  });

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

  // ── Settings popup ────────────────────────────────────────────────────────
  $('btn-settings').addEventListener('click', () => {
    if (authUser) $('settings-email').textContent = authUser.email;
    $('settings-popup').classList.toggle('hidden');
    hide($('sleep-popup'));
  });

  $('btn-logout').addEventListener('click', async () => {
    hide($('settings-popup'));
    await api.auth.logout();
    authUser = null;
    updateSyncDot('idle');
    setAuthMode('login');
    $('auth-email').value = '';
    $('auth-password').value = '';
    hide($('auth-error'));
    show($('auth-overlay'));
  });

  // ── Auth overlay ──────────────────────────────────────────────────────────
  $('auth-switch-btn').addEventListener('click', () => {
    const mode = $('auth-overlay').dataset.mode === 'login' ? 'signup' : 'login';
    setAuthMode(mode);
    hide($('auth-error'));
  });

  $('auth-submit').addEventListener('click', handleAuthSubmit);

  $('auth-email').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('auth-password').focus();
  });
  $('auth-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAuthSubmit();
  });

  $('auth-skip').addEventListener('click', async () => {
    await api.auth.skip();
    hide($('auth-overlay'));
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

// ── Cloud library ─────────────────────────────────────────────────────────────

function cloudBookCardHTML(book) {
  const col = bookColor(book.title);
  const isLocal = !!S.books.find(b => b.id === book.id);
  const coverStyle = book.coverUrl
    ? `background: url('${book.coverUrl}') center/cover no-repeat`
    : `background:${col.bg}; color:${col.text}`;
  const coverInner = book.coverUrl
    ? ''
    : `<div class="cloud-cover-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg></div>`;
  return `
  <div class="book-card cloud-only-card" data-id="${book.id}">
    <div class="cloud-badge" title="${isLocal ? 'Local + Cloud' : 'Cloud only'}"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg></div>
    <div class="book-cover" style="${coverStyle}">${coverInner}</div>
    <div class="book-card-info">
      <p class="book-card-title">${book.title}</p>
      <p class="book-card-meta">${book.chapterCount} chapter${book.chapterCount !== 1 ? 's' : ''} · ${isLocal ? 'Local + Cloud' : 'Cloud only'}</p>
    </div>
  </div>`;
}

async function renderCloudLibrary() {
  show($('cloud-loading')); hide($('cloud-empty')); $('cloud-book-grid').innerHTML = '';

  if (!authUser) {
    hide($('cloud-loading'));
    $('cloud-empty-title').textContent = 'Sign in required';
    $('cloud-empty-msg').textContent = 'Sign in to access your cloud library.';
    show($('cloud-empty')); return;
  }

  const result = await api.s3.listCloudBooks();
  hide($('cloud-loading'));

  if (result.error) {
    $('cloud-empty-title').textContent = 'Cannot connect';
    $('cloud-empty-msg').textContent = result.error === 'S3 not configured'
      ? 'Configure cloud storage settings to use this feature.'
      : (navigator.onLine ? result.error : 'No internet connection. Cloud library is unavailable offline.');
    show($('cloud-empty')); return;
  }

  const { books } = result;
  if (books.length === 0) {
    $('cloud-empty-title').textContent = 'No books in the cloud';
    $('cloud-empty-msg').textContent = 'Upload books from your library to stream them on any device.';
    show($('cloud-empty')); return;
  }

  // Cache for offline access
  for (const book of books) await api.cloudBooks.save(book);

  show($('cloud-book-grid'));
  $('cloud-book-grid').innerHTML = books.map(cloudBookCardHTML).join('');
  $('cloud-book-grid').querySelectorAll('.book-card').forEach(card => {
    const id = card.dataset.id;
    const cloudBook = books.find(b => b.id === id);
    card.addEventListener('click', () => openCloudBook(cloudBook));
  });
}

async function openCloudBook(cloudBook) {
  // If local copy exists, open it normally
  const local = S.books.find(b => b.id === cloudBook.id);
  if (local) { openBook(cloudBook.id); return; }

  if (!navigator.onLine) {
    alert('No internet connection. This cloud book is not available offline.');
    return;
  }

  // Build a playable cloud-only book object
  const book = {
    ...cloudBook,
    isCloudOnly: true,
    folderPath: null, coverPath: cloudBook.coverUrl || null, bgPath: null,
  };

  // Restore saved position (pulled from Supabase on login)
  const pb = await api.getPlayback(cloudBook.id);

  S.currentBook = book;
  S.chapterIndex = pb?.chapterIndex || 0;
  S.speed = pb?.speed || 1;
  S.bookmarks = [];
  $('nav-player').disabled = false;
  renderChapterList();
  renderBookmarks();
  updatePlayerBarInfo();
  showView('player');
  updateNowPlayingDisplay();
  playChapter(S.chapterIndex, pb?.position || 0);
}

// ── Upload ─────────────────────────────────────────────────────────────────────

function startUpload(book) {
  $('upload-book-name').textContent = book.title;
  $('upload-file-list').innerHTML = book.chapters
    .map((ch, i) => `<div class="upload-file-row" id="ufile-${i}">
      <span class="upload-file-name">${ch.title || ch.filename}</span>
      <span class="upload-file-pct" id="ufile-pct-${i}">—</span>
    </div>`).join('');
  $('upload-overall-fill').style.width = '0%';
  $('upload-overall-pct').textContent = '0%';
  $('upload-status-msg').textContent = 'Starting upload…';
  hide($('upload-done-btn'));
  $('upload-error-close').style.display = 'none';
  show($('upload-modal'));

  api.s3.onUploadProgress(data => {
    if (data.bookId !== book.id) return;
    const row = $(`ufile-${data.chapterIndex}`);
    const pctEl = $(`ufile-pct-${data.chapterIndex}`);
    if (pctEl) pctEl.textContent = data.filePct + '%';
    if (row) row.className = 'upload-file-row' + (data.status === 'done' ? ' done' : data.status === 'error' ? ' error' : ' active');
    const op = data.overallPct || 0;
    $('upload-overall-fill').style.width = op + '%';
    $('upload-overall-pct').textContent = op + '%';
    if (data.status === 'uploading') $('upload-status-msg').textContent = `Uploading ${data.chapterTitle}…`;
    else if (data.status === 'done' && data.chapterIndex >= data.chapterTotal - 1) $('upload-status-msg').textContent = 'Finalising…';
  });

  api.s3.uploadBook(book.id).then(res => {
    if (res.error) {
      $('upload-status-msg').textContent = 'Error: ' + res.error;
      $('upload-error-close').style.display = '';
    } else {
      $('upload-status-msg').textContent = 'Upload complete!';
      $('upload-overall-fill').style.width = '100%';
      $('upload-overall-pct').textContent = '100%';
      // Update in-memory book so cloud badge appears immediately
      const lb = S.books.find(b => b.id === book.id);
      if (lb) { lb.cloudPaths = res.cloudPaths; lb.cloudStatus = 'cloud'; }
      show($('upload-done-btn'));
    }
  });
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
  const isLogin = mode === 'login';
  $('auth-submit').textContent      = isLogin ? 'Sign In' : 'Create Account';
  $('auth-switch-text').textContent = isLogin ? "Don't have an account?" : 'Already have one?';
  $('auth-switch-btn').textContent  = isLogin ? 'Sign Up' : 'Sign In';
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
    hide($('auth-overlay'));
    api.sync.onStatus(updateSyncDot);
    updateSyncDot('syncing');
    const res = await api.sync.pull();
    if (!res.error) await loadLibrary();
  } else if (session?.skipped) {
    hide($('auth-overlay'));
  } else {
    show($('auth-overlay'));
    setAuthMode('login');
  }
}

async function handleAuthSubmit() {
  const email    = $('auth-email').value.trim();
  const password = $('auth-password').value;
  if (!email || !password) return;

  const btn  = $('auth-submit');
  const mode = $('auth-overlay').dataset.mode;
  btn.disabled    = true;
  btn.textContent = 'Please wait…';
  hide($('auth-error'));

  const result = mode === 'login'
    ? await api.auth.login({ email, password })
    : await api.auth.signup({ email, password });

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
    hide($('auth-overlay'));
    api.sync.onStatus(updateSyncDot);
    updateSyncDot('syncing');
    const res = await api.sync.pull();
    if (!res.error) await loadLibrary();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  setupAudio();
  setupSeekBars();
  setupKeys();
  setupUI();
  setupSplitModal();
  updateVolSlider();
  await loadLibrary();
  await checkAuthAndPull();
}

document.addEventListener('DOMContentLoaded', init);
