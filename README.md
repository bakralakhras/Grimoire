# Grimoire

Grimoire is a desktop audiobook library and player for Windows, built for people who own their audiobook files and want a powerful, clean listening experience without subscriptions.

It supports local audiobook libraries, marketplace/shared books, transcript follow-along, EPUB reading, chapter tools, bookmarks, ratings, and friend-based social comments.

---

## What it does

Grimoire lets you manage and play audiobook collections from local files such as MP3, M4B, and MP4. It remembers your exact progress, handles multi-file and single-file audiobooks, supports custom covers and ratings, and can generate local transcripts with word-level follow-along.

It also supports optional EPUB attachment for manual reading alongside the audiobook, plus timestamped audiobook comments that can appear during playback.

---

## Features

### Library
- Import folders of audiobook files as a single book
- Supports MP3, M4B, and MP4 audio files
- Sorts chapter files numerically
- Persistent local library using SQLite
- Saves progress, bookmarks, playback speed, ratings, and metadata
- Cover art detection and manual cover editing
- Rename, re-import, delete, and manage books

### Playback
- Resume from exact position
- Per-book playback speed
- Skip forward/back
- Sleep timer
- Volume control
- Keyboard shortcuts
- Bookmarks with saved timestamps
- Chapter navigation

### Marketplace / Shared Catalog
- Shared book catalog support
- Add marketplace books to your personal library
- Upload/manage owned marketplace entries
- Attach EPUB files to catalog books
- Friend-focused username login flow

### Transcription & Follow-Along
- Local transcription using faster-whisper
- Word-level timestamps
- Karaoke-style transcript highlighting during playback
- Fullscreen transcript reading mode
- Cached transcripts loaded instantly on future opens
- Smart Sync generation with per-book cache
- Progress/status handling for transcription jobs

### EPUB Reader
- Attach EPUB files to books
- Manual EPUB reader mode
- Chapter sidebar/navigation
- Reader customization settings
- Saved reading position
- EPUB reading is separate from audiobook sync by design

### Comments
- Timestamp-based audiobook comments
- Drop a comment at the current playback position
- Comments appear during playback as in-app and desktop notifications
- Comments are tied to book, chapter, and audio timestamp
- EPUB selected-text comments can save context while still linking to the current audio timestamp

### Chapter Tools
- Silence-based chapter detection
- AI-assisted chapter detection using Whisper
- Known chapter count splitting
- Preview before committing splits
- Original file backup preserved

---

## Requirements

- Windows 10/11
- Node.js 18+
- Python 3.11 for transcription/chapter detection
- NVIDIA GPU recommended for faster transcription
- CPU fallback available

For transcription:

```bash
py -3.11 -m pip install faster-whisper
