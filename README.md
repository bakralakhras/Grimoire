# Grimoire

A local audiobook player for Windows. Built for people who own their files and want to keep it that way — no accounts, no subscriptions, no cloud.

---

## What it does

Grimoire manages a library of local MP3, M4B, and MP4 audiobook files. It tracks your position across sessions, lets you pick up exactly where you left off, and handles the messiness of real audiobook collections — files split across dozens of numbered chapters, single 40-hour monoliths, inconsistent naming, the lot.

Beyond playback, it can transcribe your books locally using your GPU and display the transcript synced word-by-word to the audio as it plays.

---

## Features

**Library**
- Import folders of audio files as a single book — chapters are sorted numerically and played sequentially
- Persistent library stored in SQLite — progress, bookmarks, speed settings, and ratings survive restarts
- Cover art auto-detected from embedded metadata or set manually
- Star ratings (half-star increments), rename, re-import

**Playback**
- Resumes from exact position, even mid-chapter
- Per-book playback speed (0.75× to 2×)
- Skip forward/back, sleep timer, volume control
- Keyboard shortcuts

**Chapter splitting**
- Silence-based detection for splitting single-file audiobooks into chapters
- AI-assisted detection using Whisper — listens for "Chapter X" in the audio to confirm real chapter breaks
- Known chapter count mode — finds the N longest silences and splits there
- Preview before committing, original file kept as backup

**Transcription**
- GPU-accelerated transcription via faster-whisper (CUDA float16)
- Word-level timestamps — each word is highlighted in sync with playback
- Fullscreen reading mode with follow-along karaoke highlighting
- Transcripts saved to disk and loaded instantly on subsequent opens

---

## Requirements

- Windows 10/11
- Node.js 18+
- Python 3.11 (for transcription and AI chapter detection)
- NVIDIA GPU recommended for transcription (CPU fallback available)

For transcription features:
```
py -3.11 -m pip install faster-whisper
```

---

## Getting started

```bash
git clone https://github.com/bakralakhras/Grimoire.git
cd Grimoire
npm install
npm start
```

Import a book by clicking **+ Import** and selecting a folder containing your audio files. Grimoire will sort the chapters, detect cover art, and add it to your library.

---

## Stack

- Electron
- SQLite via better-sqlite3
- faster-whisper for transcription
- ffmpeg-static for audio processing
- Vanilla JS frontend

---

## Status

Active development. Core playback, library management, and transcription are stable. Chapter splitting and karaoke sync are functional but being refined.

Planned: Supabase sync for cross-device progress, EPUB import, Android/iOS companion app, packaged installer.

---

## License

MIT
