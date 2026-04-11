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

  // Chapters
  updateChapterDuration: (data) => ipcRenderer.invoke('chapters:updateDuration', data),

  // Transcription
  transcribe: (bookId) => ipcRenderer.invoke('book:transcribe', bookId),
  onTranscribeProgress: (cb) => {
    ipcRenderer.removeAllListeners('transcribe:progress');
    ipcRenderer.on('transcribe:progress', (_e, data) => cb(data));
  },
  getTranscript: (bookId) => ipcRenderer.invoke('transcript:get', bookId),

  // Chapter splitting
  detectSilences: (bookId, opts) => ipcRenderer.invoke('book:detectSilences', { bookId, ...opts }),
  splitAtPoints:  (bookId, splitPoints) => ipcRenderer.invoke('book:splitAtPoints', { bookId, splitPoints }),
  onSplitProgress: (cb) => {
    ipcRenderer.removeAllListeners('split:progress');
    ipcRenderer.on('split:progress', (_e, data) => cb(data));
  },
});
