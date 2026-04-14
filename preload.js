const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close'),

  // Library
  openFolder:      ()    => ipcRenderer.invoke('dialog:openFolder'),
  openImageFile:   ()    => ipcRenderer.invoke('dialog:openImageFile'),
  importFolder: (p)      => ipcRenderer.invoke('library:import', p),
  book: {
    transcribe: (bookId) => ipcRenderer.invoke('book:transcribe', bookId),
  },
  getLibrary:   ()       => ipcRenderer.invoke('library:getAll'),
  getBook:      (id)     => ipcRenderer.invoke('library:getBook', id),
  deleteBook:   (id)     => ipcRenderer.invoke('library:delete', id),
  renameBook:   (data)   => ipcRenderer.invoke('library:rename', data),
  setCover:      (bookId) => ipcRenderer.invoke('book:setCover', bookId),
  setBackground: (bookId) => ipcRenderer.invoke('book:setBackground', bookId),

  // Playback
  savePlayback: (data)   => ipcRenderer.invoke('playback:save', data),
  getPlayback:  (bookId) => ipcRenderer.invoke('playback:get', bookId),

  // Bookmarks
  addBookmark:    (data) => ipcRenderer.invoke('bookmarks:add', data),
  getBookmarks:   (id)   => ipcRenderer.invoke('bookmarks:get', id),
  deleteBookmark: (data) => ipcRenderer.invoke('bookmarks:delete', data),
  renameBookmark: (data) => ipcRenderer.invoke('bookmarks:rename', data),

  // Rating
  setRating: (data) => ipcRenderer.invoke('book:setRating', data),

  // Chapters
  updateChapterDuration: (data) => ipcRenderer.invoke('chapters:updateDuration', data),

  // Transcription
  transcribe: (bookId) => ipcRenderer.invoke('book:transcribe:legacy', bookId),
  retranscribe: (bookId) => ipcRenderer.invoke('book:transcribe:legacy', bookId),
  getTranscribeJob: (bookId) => ipcRenderer.invoke('transcribe:getJob', bookId),
  cancelTranscribe: (bookId) => ipcRenderer.invoke('transcribe:cancel', bookId),
  onTranscribeProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('transcribe:progress', listener);
    return () => ipcRenderer.removeListener('transcribe:progress', listener);
  },
  transcriptExists: (bookId) => ipcRenderer.invoke('transcript:exists', bookId),
  getTranscript:      (bookId) => ipcRenderer.invoke('transcript:get', bookId),
  getTranscriptWords: (bookId) => ipcRenderer.invoke('transcript:getWords', bookId),

  // Chapter splitting
  detectSilences: (bookId, opts) => ipcRenderer.invoke('book:detectSilences', { bookId, ...opts }),
  splitAtPoints:  (bookId, splitPoints) => ipcRenderer.invoke('book:splitAtPoints', { bookId, splitPoints }),
  onSplitProgress: (cb) => {
    ipcRenderer.removeAllListeners('split:progress');
    ipcRenderer.on('split:progress', (_e, data) => cb(data));
  },

  // AI chapter detection (sliding window scan)
  detectChaptersAI: (bookId, stepSeconds)    => ipcRenderer.invoke('book:detectChaptersAI', { bookId, stepSeconds }),
  // Known chapter count detection
  detectByCount:    (bookId, chapterCount)   => ipcRenderer.invoke('book:detectByCount', { bookId, chapterCount }),
  onAIProgress: (cb) => {
    ipcRenderer.removeAllListeners('ai:progress');
    ipcRenderer.on('ai:progress', (_e, data) => cb(data));
  },

  // S3 cloud storage (config only — uploads go through catalog:upload)
  s3: {
    getConfig:       ()     => ipcRenderer.invoke('s3:getConfig'),
    saveConfig:      (cfg)  => ipcRenderer.invoke('s3:saveConfig', cfg),
    testConfig:      ()     => ipcRenderer.invoke('s3:testConfig'),
    getPresignedUrl: (data) => ipcRenderer.invoke('s3:getPresignedUrl', data),
  },

  // Catalog marketplace
  catalog: {
    getAll:            ()      => ipcRenderer.invoke('catalog:getAll'),
    getUserLibrary:    ()      => ipcRenderer.invoke('catalog:getUserLibrary'),
    addToLibrary:      (data)  => ipcRenderer.invoke('catalog:addToLibrary', data),
    removeFromLibrary: (data)  => ipcRenderer.invoke('catalog:removeFromLibrary', data),
    getPresignedUrl:   (data)  => ipcRenderer.invoke('catalog:getPresignedUrl', data),
    upload:            (data)  => ipcRenderer.invoke('catalog:upload', data),
    editBook:          (data)  => ipcRenderer.invoke('catalog:editBook', data),
    deleteBook:        (data)  => ipcRenderer.invoke('catalog:deleteBook', data),
    onUploadProgress:  (cb) => {
      ipcRenderer.removeAllListeners('catalog:uploadProgress');
      ipcRenderer.on('catalog:uploadProgress', (_e, data) => cb(data));
    },
  },

  // EPUB reader
  epub: {
    openFilePicker:    ()      => ipcRenderer.invoke('dialog:openEpubFile'),
    attachLocal:       (data)  => ipcRenderer.invoke('epub:attachLocal', data),
    attachCatalog:     (data)  => ipcRenderer.invoke('epub:attachCatalog', data),
    ensureAndParse:    (data)  => ipcRenderer.invoke('epub:ensureAndParse', data),
    getReadingPos:     (data)  => ipcRenderer.invoke('epub:getReadingPos', data),
    saveReadingPos:    (data)  => ipcRenderer.invoke('epub:saveReadingPos', data),
    getReaderSettings: ()      => ipcRenderer.invoke('epub:getReaderSettings'),
    saveReaderSettings:(data)  => ipcRenderer.invoke('epub:saveReaderSettings', data),
    onUploadProgress:  (cb) => {
      ipcRenderer.removeAllListeners('epub:uploadProgress');
      ipcRenderer.on('epub:uploadProgress', (_e, data) => cb(data));
    },
  },

  // Auth
  auth: {
    getSession:     ()     => ipcRenderer.invoke('auth:getSession'),
    login:          (data) => ipcRenderer.invoke('auth:login', data),
    signup:         (data) => ipcRenderer.invoke('auth:signup', data),
    logout:         ()     => ipcRenderer.invoke('auth:logout'),
    skip:           ()     => ipcRenderer.invoke('auth:skip'),
  },

  comments: {
    getBook:       (data) => ipcRenderer.invoke('comments:getBook', data),
    create:        (data) => ipcRenderer.invoke('comments:create', data),
    delete:        (data) => ipcRenderer.invoke('comments:delete', data),
    notifyReached: (data) => ipcRenderer.send('comment:reached', data),
    onSeekRequest: (cb) => {
      ipcRenderer.removeAllListeners('comment:seekTo');
      ipcRenderer.on('comment:seekTo', (_e, data) => cb(data));
    },
  },

  // Sync
  sync: {
    push:      (op) => ipcRenderer.invoke('sync:push', op),
    pull:      ()   => ipcRenderer.invoke('sync:pull'),
    getStatus: ()   => ipcRenderer.invoke('sync:getStatus'),
    onStatus:  (cb) => {
      ipcRenderer.removeAllListeners('sync:status');
      ipcRenderer.on('sync:status', (_e, status) => cb(status));
    },
  },
});
