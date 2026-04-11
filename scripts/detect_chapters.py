"""
detect_chapters.py — Whisper-powered audio analysis for Grimoire.

Modes
-----
chapters   (default)
    Sliding-window scan: extract a short clip every --step-seconds and check
    whether the transcription contains "chapter" anywhere (case-insensitive).
    Detections within 2 minutes of each other are merged (earliest kept).
    No silence pre-detection required.

transcribe
    Transcribe a list of audio chapter files in full and return the text
    with per-word timestamps for karaoke-style highlighting.

Usage
-----
chapters mode:
    python detect_chapters.py
        --mode          chapters
        --audio         <source file>
        --step-seconds  480         (seconds between scan windows; default 8 min)
        --clip-duration 20          (seconds per window)
        --ffmpeg        <ffmpeg binary path>

transcribe mode:
    python detect_chapters.py
        --mode          transcribe
        --chapters-json <JSON array of {index, title, filepath}>
        --ffmpeg        <ffmpeg binary path>

Output (newline-delimited JSON on stdout)
-----------------------------------------
{"type": "loading",  "message": "..."}
{"type": "device",   "device": "cuda"|"cpu", "compute_type": "float16"|"int8"}
{"type": "progress", "current": 1, "total": 5, "timestamp": 123.4, "duration": 3600.0}  # chapters
{"type": "progress", "chapterIndex": 0, "total": 5, "chapterTitle": "..."}              # transcribe
{"type": "chapter",  "chapterIndex": 0, "total": 5, "chapterTitle": "...", "text": "...", "words": [...]}
{"type": "result",   "confirmed": [...], "duration": 3600.0}  # chapters mode
{"type": "result"}                                             # transcribe mode

Fatal errors:
{"type": "error", "code": "not_installed"|"other", "message": "..."}
exit(1)
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile


# ── Helpers ───────────────────────────────────────────────────────────────────

def emit(obj):
    print(json.dumps(obj), flush=True)


def load_model():
    """Load WhisperModel, trying CUDA/float16 first.

    Always attempts CUDA — float16 is optimal for RTX 2060 and similar cards.
    Only falls back to CPU/int8 if CUDA initialisation actually raises an
    exception, not merely because torch is absent.
    Emits a "device" event so the UI can confirm what hardware is in use.
    """
    from faster_whisper import WhisperModel

    emit({"type": "loading",
          "message": "Loading Whisper model\u2026 (may download ~150\u00a0MB on first run)"})

    try:
        model = WhisperModel("base", device="cuda", compute_type="float16")
        emit({"type": "device", "device": "cuda", "compute_type": "float16"})
        return model
    except Exception as cuda_err:
        emit({"type": "device", "device": "cpu", "compute_type": "int8",
              "fallback_reason": str(cuda_err)})
        return WhisperModel("base", device="cpu", compute_type="int8")


def ffmpeg_to_wav(ffmpeg, src, dst, timeout=300):
    """Convert *src* to 16 kHz mono WAV at *dst*. Returns True on success."""
    result = subprocess.run(
        [ffmpeg, "-y", "-i", src, "-ar", "16000", "-ac", "1", "-f", "wav", dst],
        capture_output=True,
        timeout=timeout,
    )
    return result.returncode == 0 and os.path.isfile(dst)


def get_duration(ffmpeg, src):
    """Return audio duration in seconds by running ffmpeg -i. Returns 0 on failure."""
    result = subprocess.run(
        [ffmpeg, "-i", src, "-f", "null", "-"],
        capture_output=True, timeout=60,
    )
    m = re.search(
        r"Duration:\s*(\d+):(\d+):([\d.]+)",
        result.stderr.decode("utf-8", errors="ignore"),
    )
    if not m:
        return 0.0
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def transcribe_file(model, path, beam_size=5):
    """Return transcribed text for a single audio file (no word timestamps)."""
    segments, _ = model.transcribe(
        path,
        beam_size=beam_size,
        language="en",
        condition_on_previous_text=False,
    )
    return " ".join(seg.text.strip() for seg in segments if seg.text.strip())


def transcribe_file_with_words(model, path, beam_size=5):
    """Return (text, words) for a single audio file.

    words is a list of {"word": str, "start": float, "end": float} dicts,
    suitable for karaoke-style highlighting.  Each word.word from
    faster-whisper includes any leading whitespace, which is preserved so
    spans concatenate correctly in the browser.
    """
    segments, _ = model.transcribe(
        path,
        beam_size=beam_size,
        language="en",
        condition_on_previous_text=False,
        word_timestamps=True,
    )
    words = []
    text_parts = []
    for seg in segments:
        if not seg.text.strip():
            continue
        text_parts.append(seg.text.strip())
        if seg.words:
            for w in seg.words:
                words.append({
                    "word":  w.word,
                    "start": round(w.start, 3),
                    "end":   round(w.end,   3),
                })
    return " ".join(text_parts), words


# ── Modes ─────────────────────────────────────────────────────────────────────

def run_scan(args, model):
    """Sliding-window scan: transcribe short clips at regular intervals and look
    for a 'chapter' announcement anywhere in the text.  No silence detection
    needed — just a regular time grid.

    merge gap: detections within 2 minutes of each other → keep earliest.
    """
    duration = get_duration(args.ffmpeg, args.audio)
    if duration <= 0:
        emit({"type": "error", "code": "other",
              "message": "Could not determine audio duration."})
        sys.exit(1)

    step = args.step_seconds
    half = args.clip_duration / 2.0

    # Window positions: step, 2*step, … up to (duration - half).
    # Skip position 0 — that is the book start, never a chapter boundary.
    positions = []
    t = step
    while t < duration - half:
        positions.append(t)
        t += step

    total = len(positions)
    if total == 0:
        emit({"type": "result", "confirmed": [], "duration": duration})
        return

    confirmed = []

    with tempfile.TemporaryDirectory() as tmpdir:
        for idx, pos in enumerate(positions):
            emit({
                "type":      "progress",
                "current":   idx + 1,
                "total":     total,
                "timestamp": pos,
                "duration":  duration,
            })

            clip_start = max(0.0, pos - half)
            clip_path  = os.path.join(tmpdir, f"win_{idx}.wav")

            result = subprocess.run(
                [args.ffmpeg, "-y",
                 "-ss", str(clip_start), "-t", str(args.clip_duration),
                 "-i", args.audio,
                 "-ar", "16000", "-ac", "1", "-f", "wav", clip_path],
                capture_output=True, timeout=60,
            )
            if result.returncode != 0 or not os.path.isfile(clip_path):
                continue

            try:
                text = transcribe_file(model, clip_path, beam_size=1)
            except Exception:
                continue

            # Accept "chapter" anywhere in the transcription (case-insensitive).
            # Strip leading punctuation that can precede the word in practice.
            clean = text.lstrip(" \t\n\r.,\"'\u2018\u2019\u201c\u201d\u2014-")
            if "chapter" in clean.lower():
                confirmed.append({"timestamp": pos, "text": text})

    # Merge detections within 2 minutes of each other — keep earliest.
    MERGE_GAP = 120  # seconds
    merged = []
    for det in confirmed:
        if merged and (det["timestamp"] - merged[-1]["timestamp"]) < MERGE_GAP:
            pass  # too close to previous detection — discard
        else:
            merged.append(det)

    emit({"type": "result", "confirmed": merged, "duration": duration})


def run_transcribe(args, model):
    """Full transcription mode: transcribe each chapter file and emit text."""
    chapters = json.loads(args.chapters_json)
    total = len(chapters)

    with tempfile.TemporaryDirectory() as tmpdir:
        for ch in chapters:
            idx      = ch["index"]
            title    = ch["title"]
            filepath = ch["filepath"]

            emit({"type": "progress", "chapterIndex": idx, "total": total, "chapterTitle": title})

            # Convert to 16 kHz WAV — ensures compatibility with all input formats
            # (MP3, M4A, M4B, FLAC, OGG, …) and gives Whisper its preferred input.
            wav_path = os.path.join(tmpdir, f"ch_{idx}.wav")
            src = wav_path if ffmpeg_to_wav(args.ffmpeg, filepath, wav_path) else filepath

            try:
                text, words = transcribe_file_with_words(model, src, beam_size=5)
            except Exception as e:
                text  = f"[Transcription error: {e}]"
                words = []

            emit({
                "type":         "chapter",
                "chapterIndex": idx,
                "total":        total,
                "chapterTitle": title,
                "text":         text,
                "words":        words,
            })

    emit({"type": "result"})


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Grimoire audio analysis")
    parser.add_argument("--mode",          choices=["chapters", "transcribe"], default="chapters")
    # chapters mode
    parser.add_argument("--audio",         help="Source audio file (chapters mode)")
    parser.add_argument("--step-seconds",  type=float, default=480.0,
                        help="Seconds between scan windows (chapters mode; default 480 = 8 min)")
    parser.add_argument("--clip-duration", type=float, default=20.0,
                        help="Seconds to extract for each scan window")
    # transcribe mode
    parser.add_argument("--chapters-json", help="JSON array of {index, title, filepath} objects")
    # shared
    parser.add_argument("--ffmpeg",        required=True, help="Path to ffmpeg binary")
    args = parser.parse_args()

    # ── Validate mode-specific args ────────────────────────────────────────────
    if args.mode == "chapters":
        if not args.audio:
            emit({"type": "error", "code": "other", "message": "--audio is required in chapters mode"})
            sys.exit(1)
        if not os.path.isfile(args.audio):
            emit({"type": "error", "code": "other", "message": f"Audio file not found: {args.audio}"})
            sys.exit(1)
    elif args.mode == "transcribe":
        if not args.chapters_json:
            emit({"type": "error", "code": "other", "message": "--chapters-json is required in transcribe mode"})
            sys.exit(1)

    # ── Import faster-whisper ──────────────────────────────────────────────────
    try:
        from faster_whisper import WhisperModel  # noqa: F401 — import check only
    except ImportError:
        emit({
            "type":    "error",
            "code":    "not_installed",
            "message": "faster-whisper is not installed. Run: pip install faster-whisper",
        })
        sys.exit(1)

    # ── Load model ─────────────────────────────────────────────────────────────
    try:
        model = load_model()
    except Exception as e:
        emit({"type": "error", "code": "other", "message": f"Failed to load model: {e}"})
        sys.exit(1)

    # ── Dispatch ───────────────────────────────────────────────────────────────
    if args.mode == "chapters":
        run_scan(args, model)
    else:
        run_transcribe(args, model)


if __name__ == "__main__":
    main()
