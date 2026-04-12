const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close'),

  // Library
  openFolder:   ()       => ipcRenderer.invoke('dialog:openFolder'),
  importFolder: (p)      => ipcRenderer.invoke('library:import', p),
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
  transcribe: (bookId) => ipcRenderer.invoke('book:transcribe', bookId),
  onTranscribeProgress: (cb) => {
    ipcRenderer.removeAllListeners('transcribe:progress');
    ipcRenderer.on('transcribe:progress', (_e, data) => cb(data));
  },
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

  // S3 cloud storage
  s3: {
    getConfig:       ()        => ipcRenderer.invoke('s3:getConfig'),
    saveConfig:      (cfg)     => ipcRenderer.invoke('s3:saveConfig', cfg),
    testConfig:      ()        => ipcRenderer.invoke('s3:testConfig'),
    uploadBook:      (bookId)  => ipcRenderer.invoke('s3:uploadBook', bookId),
    getPresignedUrl: (data)    => ipcRenderer.invoke('s3:getPresignedUrl', data),
    listCloudBooks:  ()        => ipcRenderer.invoke('s3:listCloudBooks'),
    removeFromCloud: (bookId)  => ipcRenderer.invoke('s3:removeFromCloud', bookId),
    onUploadProgress: (cb) => {
      ipcRenderer.removeAllListeners('s3:uploadProgress');
      ipcRenderer.on('s3:uploadProgress', (_e, data) => cb(data));
    },
  },

  // Cloud book cache (books accessible from other devices)
  cloudBooks: {
    getAll: ()     => ipcRenderer.invoke('cloudBooks:getAll'),
    save:   (book) => ipcRenderer.invoke('cloudBooks:save', book),
  },

  // Auth
  auth: {
    getSession: ()       => ipcRenderer.invoke('auth:getSession'),
    login:      (data)   => ipcRenderer.invoke('auth:login', data),
    signup:     (data)   => ipcRenderer.invoke('auth:signup', data),
    logout:     ()       => ipcRenderer.invoke('auth:logout'),
    skip:       ()       => ipcRenderer.invoke('auth:skip'),
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
