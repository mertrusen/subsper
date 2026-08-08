#!/usr/bin/env bash
# Integration smoke test for the bundled ffmpeg.
#
# The unit suite checks our JavaScript. This checks the other half: that the
# ffmpeg binary we actually ship can perform every operation the app asks of it.
# It exists because swapping the GPL/non-free build for an LGPL one silently
# removed libx264 — and cutMedia, which named no encoder at all, went from
# working to failing with "Error while opening encoder". Nothing caught that.
#
# Every command below mirrors a real call site in js/whispercpp.js.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
case "$(uname -s)" in
  Darwin) PLAT="darwin-$(uname -m | sed 's/x86_64/x64/')" ;;
  Linux)  PLAT="linux-x64" ;;
  *)      PLAT="win-x64" ;;
esac
FF="${FFMPEG_BIN:-$ROOT/bin/$PLAT/ffmpeg}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0; fail=0
check() { # name  file  [min-bytes]
    local name="$1" f="$2" min="${3:-1000}"
    if [ -s "$f" ] && [ "$(wc -c <"$f")" -ge "$min" ]; then
        pass=$((pass+1)); echo "  ok   $name"
    else
        fail=$((fail+1)); echo "  FAIL $name  (missing or too small: $f)"
    fi
}
fails() { fail=$((fail+1)); echo "  FAIL $1"; }
oks()   { pass=$((pass+1)); echo "  ok   $1"; }

[ -x "$FF" ] || { echo "no ffmpeg at $FF — run scripts/build-ffmpeg-lgpl.sh"; exit 1; }
echo "[smoke] ffmpeg: $FF"

# ── Licence gate ──────────────────────────────────────────────────────────
echo
echo "— licence —"
BANNER="$("$FF" -version 2>&1)"
forbidden=0
for f in "--enable-gpl" "--enable-nonfree" "--enable-version3" "--enable-libx264" "--enable-libx265"; do
    grep -q -- "$f" <<<"$BANNER" && { fails "shipped ffmpeg must not report $f"; forbidden=1; }
done
[ $forbidden -eq 0 ] && oks "no GPL or non-free components"

# ── Fixture: 6s clip with video + tone, and a silent gap in the middle ─────
"$FF" -y -f lavfi -i "testsrc=size=320x240:rate=25:duration=6" \
      -f lavfi -i "sine=f=440:d=6:sample_rate=48000" \
      -af "volume='if(between(t,2,4),0,1)':eval=frame" \
      -c:v h264_videotoolbox -c:a aac -shortest "$WORK/in.mp4" >/dev/null 2>&1 \
  || "$FF" -y -f lavfi -i "testsrc=size=320x240:rate=25:duration=6" \
      -f lavfi -i "sine=f=440:d=6:sample_rate=48000" \
      -af "volume='if(between(t,2,4),0,1)':eval=frame" \
      -c:v mpeg4 -c:a aac -shortest "$WORK/in.mp4" >/dev/null 2>&1
check "fixture clip" "$WORK/in.mp4" 5000

# ── toWav16k — the transcription front door ───────────────────────────────
echo
echo "— pipelines —"
"$FF" -y -i "$WORK/in.mp4" -ar 16000 -ac 1 -c:a pcm_s16le -vn "$WORK/a.wav" >/dev/null 2>&1
check "toWav16k (16k mono pcm_s16le)" "$WORK/a.wav" 5000

# ── detectSilence — must actually report the gap we baked in ──────────────
SIL="$("$FF" -hide_banner -i "$WORK/in.mp4" -af "silencedetect=noise=-30dB:d=0.6" -f null - 2>&1)"
grep -q "silence_start" <<<"$SIL" && oks "detectSilence finds the silent range" \
                                  || fails "detectSilence found no silence"

# ── enhanceMedia — denoise + loudness normalise ───────────────────────────
"$FF" -y -i "$WORK/in.mp4" \
      -af "highpass=f=90,afftdn=nr=12:nf=-30:tn=1,deesser=i=0.4,compand=attacks=0.02:decays=0.2:points=-80/-80|-45/-30|-27/-18|0/-6:soft-knee=6,loudnorm=I=-16:TP=-1.5:LRA=11" \
      -c:a pcm_s16le -ar 48000 -vn "$WORK/enh.wav" >/dev/null 2>&1
check "enhanceMedia (afftdn + deesser + compand + loudnorm)" "$WORK/enh.wav" 5000

# ── cutMedia WITH video — the one the LGPL swap broke ─────────────────────
VENC=""
for e in h264_videotoolbox h264_mf h264_qsv h264_nvenc libx264 mpeg4; do
    "$FF" -hide_banner -encoders 2>/dev/null | grep -qE "^\s*\S+\s+$e\s" && { VENC="$e"; break; }
done
[ -n "$VENC" ] && oks "a usable H.264/MPEG-4 encoder exists ($VENC)" || fails "no video encoder at all"

VARGS=(-c:v "$VENC" -fps_mode cfr -pix_fmt yuv420p)
case "$VENC" in
  h264_videotoolbox) VARGS+=(-b:v 0 -q:v 60 -tag:v avc1) ;;
  libx264)           VARGS+=(-crf 18 -preset veryfast) ;;
  h264_mf)           VARGS+=(-rate_control quality -quality 60) ;;
  mpeg4)             VARGS+=(-q:v 3) ;;
esac
FC="[0:v]trim=start=0:end=2,setpts=PTS-STARTPTS[v0];[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS[a0];"
FC+="[0:v]trim=start=4:end=6,setpts=PTS-STARTPTS[v1];[0:a]atrim=start=4:end=6,asetpts=PTS-STARTPTS[a1];"
FC+="[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]"
"$FF" -y -i "$WORK/in.mp4" -filter_complex "$FC" -map "[outv]" "${VARGS[@]}" -map "[outa]" "$WORK/cut.mp4" >/dev/null 2>&1
check "cutMedia with video (trim + concat + re-encode)" "$WORK/cut.mp4" 5000
DUR="$("$FF" -hide_banner -i "$WORK/cut.mp4" 2>&1 | sed -n 's/.*Duration: 00:00:0\([0-9.]*\).*/\1/p')"
case "$DUR" in 3.9*|4.0*|4.1*) oks "cut output is the expected ~4s" ;; *) fails "cut duration is $DUR, expected ~4" ;; esac

# ── cutMedia audio-only ───────────────────────────────────────────────────
"$FF" -y -i "$WORK/in.mp4" -filter_complex \
      "[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS[a0];[0:a]atrim=start=4:end=6,asetpts=PTS-STARTPTS[a1];[a0][a1]concat=n=2:v=0:a=1[outa]" \
      -map "[outa]" "$WORK/cut.m4a" >/dev/null 2>&1
check "cutMedia audio-only" "$WORK/cut.m4a" 2000

# ── beepRanges — mutes speech and lays a tone, video stream-copied ────────
"$FF" -y -i "$WORK/in.mp4" -filter_complex \
      "[0:a]volume='if(between(t,1.000,2.000),0.00,1)':eval=frame[main];sine=f=1000:d=3.00[bp0];[bp0]volume='if(between(t,1.000,2.000),0.30,0)':eval=frame[bp];[main][bp]amix=inputs=2:duration=first:normalize=0[outa]" \
      -map "[outa]" -map "0:v?" -c:v copy "$WORK/beep.mp4" >/dev/null 2>&1
check "beepRanges (mix + video stream-copy)" "$WORK/beep.mp4" 5000

# ── beepTrackWav — standalone beep track for the Premiere timeline ────────
"$FF" -y -f lavfi -i "sine=f=1000:d=3.00" \
      -af "volume='if(between(t,1.000,2.000),0.85,0)':eval=frame" \
      -ar 48000 -c:a pcm_s16le "$WORK/beeptrack.wav" >/dev/null 2>&1
check "beepTrackWav" "$WORK/beeptrack.wav" 5000

# ── Burn-in — needs libass, and must NOT quietly fall back to mpeg4 ───────
# Both failure modes have happened: a `core` ffmpeg has no `subtitles` filter at
# all, and without an explicit -c:v the encoder silently degrades to mpeg4 —
# a 2001 codec, roughly 2.3x the size at worse quality, with no error anywhere.
echo
echo "— burn-in —"
"$FF" -hide_banner -filters 2>/dev/null | grep -qE "^ [TSC.]+ +subtitles " \
  && oks "libass is linked in (subtitles filter exists)" \
  || fails "no subtitles filter — this ffmpeg was built with the 'core' profile; burn-in cannot work"

cat > "$WORK/t.ass" <<'ASS'
[Script Info]
ScriptType: v4.00+
PlayResX: 320
PlayResY: 240

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BorderStyle, Outline, Alignment, MarginV
Style: Default,Arial,28,&H00FFFFFF,&H00000000,1,2,2,20

[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:00.50,0:00:03.00,Default,,Türkçe altyazı ğüşiöç
Dialogue: 0,0:00:03.00,0:00:05.50,Default,,İkinci satır
ASS

( cd "$WORK" && "$FF" -y -i in.mp4 -vf "subtitles='t.ass'" "${VARGS[@]}" -c:a copy burn.mp4 ) >/dev/null 2>&1
check "burn-in renders styled subtitles into the video" "$WORK/burn.mp4" 5000
BURNCODEC="$("$FF" -hide_banner -i "$WORK/burn.mp4" 2>&1 | sed -n 's/.*Video: \([a-z0-9]*\).*/\1/p' | head -1)"
[ "$BURNCODEC" = "h264" ] && oks "burn-in output is H.264, not a silent mpeg4 fallback" \
                          || fails "burn-in output is '$BURNCODEC' — expected h264 (missing -c:v?)"

( cd "$WORK" && "$FF" -y -i in.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920,subtitles='t.ass'" \
    "${VARGS[@]}" -c:a copy vert.mp4 ) >/dev/null 2>&1
check "9:16 vertical clip with burned subtitles" "$WORK/vert.mp4" 5000

# ── extractClipsToWav — multi-clip mix with per-clip offsets ──────────────
"$FF" -y -ss 0 -i "$WORK/in.mp4" -t 2 -ar 16000 -ac 1 -c:a pcm_s16le -vn "$WORK/c0.wav" >/dev/null 2>&1
"$FF" -y -ss 3 -i "$WORK/in.mp4" -t 2 -ar 16000 -ac 1 -c:a pcm_s16le -vn "$WORK/c1.wav" >/dev/null 2>&1
"$FF" -y -i "$WORK/c0.wav" -i "$WORK/c1.wav" -filter_complex \
      "[0]adelay=0|0[d0];[1]adelay=3000|3000[d1];[d0][d1]amix=inputs=2:duration=longest:normalize=0[out]" \
      -map "[out]" -ar 16000 -ac 1 -c:a pcm_s16le "$WORK/mix.wav" >/dev/null 2>&1
check "extractClipsToWav (adelay + amix)" "$WORK/mix.wav" 5000

echo
echo "$pass passed, $fail failed"
exit $([ $fail -eq 0 ] && echo 0 || echo 1)
