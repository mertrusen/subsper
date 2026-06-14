#!/usr/bin/env python3
"""
cut_media.py
Usage: python3 cut_media.py <input> <output> '<keep_ranges_json>'
  keep_ranges_json : [[start,end], [start,end], ...]  (seconds to KEEP)

Concatenates the kept (speech) ranges into a single trimmed file using ffmpeg,
dropping everything else (the silent gaps). Handles video+audio and audio-only.

Output: { "success": bool, "output": str, "error": str|null }
"""

import sys
import os
import json
import subprocess
import shutil

FFMPEG_CANDIDATES = [
    "/opt/homebrew/bin/ffmpeg", "/opt/homebrew/sbin/ffmpeg",
    "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg",
    "C:/ffmpeg/bin/ffmpeg.exe", "C:/Program Files/ffmpeg/bin/ffmpeg.exe",
]
FFPROBE_CANDIDATES = [
    "/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "/usr/bin/ffprobe",
    "C:/ffmpeg/bin/ffprobe.exe", "C:/Program Files/ffmpeg/bin/ffprobe.exe",
]


def _find(cands, name):
    for p in cands:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return shutil.which(name)


def has_video_stream(ffprobe, inp):
    if not ffprobe:
        # Guess from extension
        ext = inp.rsplit(".", 1)[-1].lower() if "." in inp else ""
        return ext not in ("mp3", "wav", "m4a", "aac", "flac", "ogg")
    try:
        r = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v",
             "-show_entries", "stream=codec_type", "-of", "csv=p=0", inp],
            capture_output=True, timeout=60)
        return b"video" in r.stdout
    except Exception:
        return True


def run(inp, outp, keep):
    if not os.path.exists(inp):
        return {"success": False, "error": f"Input not found: {inp}"}
    if not keep:
        return {"success": False, "error": "No ranges to keep"}

    ffmpeg = _find(FFMPEG_CANDIDATES, "ffmpeg")
    if not ffmpeg:
        return {"success": False, "error": "ffmpeg not found"}
    ffprobe = _find(FFPROBE_CANDIDATES, "ffprobe")

    video = has_video_stream(ffprobe, inp)

    # Build filter_complex: trim each kept range, then concat.
    parts = []
    n = len(keep)
    for i, (a, b) in enumerate(keep):
        if video:
            parts.append(
                f"[0:v]trim=start={a:.3f}:end={b:.3f},setpts=PTS-STARTPTS[v{i}];"
                f"[0:a]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS[a{i}];"
            )
        else:
            parts.append(
                f"[0:a]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS[a{i}];"
            )

    if video:
        streams = "".join(f"[v{i}][a{i}]" for i in range(n))
        parts.append(f"{streams}concat=n={n}:v=1:a=1[outv][outa]")
        maps = ["-map", "[outv]", "-map", "[outa]"]
    else:
        streams = "".join(f"[a{i}]" for i in range(n))
        parts.append(f"{streams}concat=n={n}:v=0:a=1[outa]")
        maps = ["-map", "[outa]"]

    filter_complex = "".join(parts)

    cmd = [ffmpeg, "-y", "-i", inp, "-filter_complex", filter_complex] + maps
    if video:
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k"]
    cmd += [outp]

    try:
        r = subprocess.run(cmd, capture_output=True, timeout=3600)
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Cut timed out"}

    if r.returncode != 0 or not os.path.exists(outp):
        err = r.stderr.decode(errors="replace")
        return {"success": False, "error": err[-600:] if err else "ffmpeg failed"}
    return {"success": True, "output": outp}


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(json.dumps({"success": False, "error": "Usage: cut_media.py <input> <output> <keep_json>"}))
        sys.exit(1)
    inp, outp = sys.argv[1], sys.argv[2]
    try:
        keep = json.loads(sys.argv[3])
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Bad keep JSON: {e}"}))
        sys.exit(1)
    print(json.dumps(run(inp, outp, keep), ensure_ascii=False))
