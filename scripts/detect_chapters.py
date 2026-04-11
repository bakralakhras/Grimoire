"""
detect_chapters.py — Whisper-powered audio analysis for Grimoire.

Modes
-----
chapters   (default)
    For each silence midpoint, extract a short clip and check whether its
    transcription opens with "chapter".  Outputs confirmed split points.

transcribe
    Transcribe a list of audio chapter files in full and return the text.
    Replaces the broken @xenova/transformers path.

Usage
-----
chapters mode:
    python detect_chapters.py
        --mode         chapters
        --audio        <source file>
        --silences-json <JSON array of silence midpoint floats>
        --clip-duration 20          (seconds around each midpoint)
        --ffmpeg       <ffmpeg binary path>

transcribe mode:
    python detect_chapters.py
        --mode          transcribe
        --chapters-json <JSON array of {index, title, filepath}>
        --ffmpeg        <ffmpeg binary path>

Output (newline-delimited JSON on stdout)
-----------------------------------------
{"type": "loading",  "message": "..."}
{"type": "device",   "device": "cuda"|"cpu", "compute_type": "float16"|"int8"}
{"type": "progress", "current": 1, "total": 5, "timestamp": 123.4}   # chapters mode
{"type": "progress", "chapterIndex": 0, "total": 5, "chapterTitle": "..."}  # transcribe mode
{"type": "chapter",  "chapterIndex": 0, "total": 5, "chapterTitle": "...", "text": "..."}
{"type": "result",   "confirmed": [...]}   # chapters mode
{"type": "result"}                         # transcribe mode

Fatal errors:
{"type": "error", "code": "not_installed"|"other", "message": "..."}
exit(1)
"""

import argparse
import json
import os
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
        # CUDA init failed — fall back to CPU with int8 quantisation.
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


def transcribe_file(model, path, beam_size=5):
    """Return transcribed text for a single audio file."""
    segments, _ = model.transcribe(
        path,
        beam_size=beam_size,
        language="en",
        condition_on_previous_text=False,
    )
    return " ".join(seg.text.strip() for seg in segments if seg.text.strip())


# ── Modes ─────────────────────────────────────────────────────────────────────

def run_chapters(args, model):
    """Clip-and-check mode: confirm silence points that transcribe as 'Chapter …'."""
    silence_points = json.loads(args.silences_json)
    if not silence_points:
        emit({"type": "result", "confirmed": []})
        return

    half = args.clip_duration / 2.0
    confirmed = []
    total = len(silence_points)

    with tempfile.TemporaryDirectory() as tmpdir:
        for idx, midpoint in enumerate(silence_points):
            emit({"type": "progress", "current": idx + 1, "total": total, "timestamp": midpoint})

            clip_start = max(0.0, midpoint - half)
            clip_path = os.path.join(tmpdir, f"clip_{idx}.wav")

            # Extract only the clip window — fast seek before -i, then limit duration.
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

            # Strip leading punctuation before checking for "chapter"
            clean = text.lstrip(" \t\n\r.,\"\u2018\u2019\u201c\u201d-'")
            if clean.lower().startswith("chapter"):
                confirmed.append({"timestamp": midpoint, "text": text})

    emit({"type": "result", "confirmed": confirmed})


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
                text = transcribe_file(model, src, beam_size=5)
            except Exception as e:
                text = f"[Transcription error: {e}]"

            emit({
                "type":         "chapter",
                "chapterIndex": idx,
                "total":        total,
                "chapterTitle": title,
                "text":         text,
            })

    emit({"type": "result"})


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Grimoire audio analysis")
    parser.add_argument("--mode",          choices=["chapters", "transcribe"], default="chapters")
    # chapters mode
    parser.add_argument("--audio",         help="Source audio file (chapters mode)")
    parser.add_argument("--silences-json", help="JSON array of silence midpoint timestamps")
    parser.add_argument("--clip-duration", type=float, default=20.0,
                        help="Seconds to extract around each silence midpoint")
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
        if not args.silences_json:
            emit({"type": "error", "code": "other", "message": "--silences-json is required in chapters mode"})
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
        run_chapters(args, model)
    else:
        run_transcribe(args, model)


if __name__ == "__main__":
    main()
