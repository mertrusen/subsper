#!/usr/bin/env bash
# Build the ffmpeg we are actually allowed to ship.
#
# WHY THIS EXISTS
# ---------------
# Subsper used to bundle the `ffmpeg-static` npm binary. On macOS that is an
# evermeet.cx build configured with:
#
#     --enable-gpl --enable-version3 --enable-nonfree
#
# `--enable-nonfree` makes the resulting binary **non-redistributable** — not
# "you must publish your source", but "you may not ship it at all". Shipping it
# inside a paid product was a licensing breach, so we build our own instead.
#
# WHAT WE BUILD
# -------------
# Plain LGPL ffmpeg: no --enable-gpl, no --enable-version3, no --enable-nonfree,
# and --disable-autodetect so no GPL library on the build host can sneak in.
#
# Video is never encoded with libx264 (GPL). On macOS we use VideoToolbox, which
# is part of the OS, LGPL-compatible, and hardware-accelerated — faster than
# libx264 was. See VIDEO_ENCODER in js/whispercpp.js, which picks it explicitly
# instead of letting ffmpeg fall back to whatever encoder happens to exist.
#
# PROFILES
#   subs  (default)  what we ship. Everything in `core` plus
#                    freetype/fribidi/harfbuzz/libass, so the `subtitles` filter
#                    exists and burn-in works.
#   core             audio decode/filter/encode, silencedetect, loudnorm,
#                    afftdn, video stream-copy, VideoToolbox re-encode. Smaller
#                    and quicker to build, but burn-in and the 9:16 clip export
#                    will fail against it — use it only for engine-only testing.
#
# USAGE
#   scripts/build-ffmpeg-lgpl.sh [subs|core]
#
# Output: bin/<plat>/ffmpeg   (static, portable, no Homebrew dylibs)
set -euo pipefail

# Default is `subs`, not `core`: the desktop app's burn-in and 9:16 clip export
# call ffmpeg's `subtitles` filter, which only exists when libass is linked in.
# A `core` binary would let those two features fail at the worst moment — in
# front of a customer — so the shipped default has to be the complete one.
PROFILE="${1:-subs}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

FFMPEG_VERSION="7.1.1"
FREETYPE_VERSION="2.13.2"
FRIBIDI_VERSION="1.0.13"
HARFBUZZ_VERSION="8.5.0"
LIBASS_VERSION="0.17.3"

case "$(uname -s)" in
  Darwin) PLAT="darwin-$(uname -m | sed 's/x86_64/x64/')" ;;
  Linux)  PLAT="linux-x64" ;;
  *) echo "This script builds macOS/Linux. Windows uses the BtbN LGPL build — see fetch-binaries.mjs." >&2; exit 1 ;;
esac

OUT="$ROOT/bin/$PLAT"
WORK="${FFMPEG_BUILD_DIR:-${TMPDIR:-/tmp}/subsper-ffmpeg-lgpl}"
DEPS="$WORK/deps"
JOBS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

mkdir -p "$OUT" "$WORK" "$DEPS"
export PKG_CONFIG_PATH="$DEPS/lib/pkgconfig"
log() { echo "[ffmpeg-lgpl] $*"; }

# fetch <dir> <url…> — first mirror that answers wins. GNU Savannah in
# particular returns 502 often enough that a single-URL fetch makes this script
# fail for reasons that have nothing to do with the build.
fetch() {
  local dir="$1"; shift
  [ -d "$WORK/$dir" ] && { log "$dir already unpacked"; return 0; }
  local tmp="$WORK/$dir.archive"
  for url in "$@"; do
    log "downloading $dir from ${url%%/*}//${url#*//}…"
    if curl -fsSL --retry 2 --connect-timeout 20 "$url" -o "$tmp"; then
      # tar sniffs gz/xz/bz2 itself, so the extension does not have to match.
      if tar -xf "$tmp" -C "$WORK"; then rm -f "$tmp"; return 0; fi
      log "archive was corrupt, trying the next mirror"
    else
      log "mirror unavailable, trying the next one"
    fi
    rm -f "$tmp"
  done
  echo "could not download $dir from any mirror" >&2
  return 1
}

# ── Subtitle rendering stack (profile: subs) ──────────────────────────────
# All LGPL-compatible: libass is ISC, freetype is FTL/GPLv2-dual (we take FTL),
# fribidi is LGPL, harfbuzz is MIT.
build_dep() { # dir  configure-args…
  local dir="$1"; shift
  ( cd "$WORK/$dir"
    ./configure --prefix="$DEPS" --enable-static --disable-shared "$@" > "$WORK/$dir.configure.log" 2>&1 \
      || { echo "configure failed for $dir:" >&2; tail -20 "$WORK/$dir.configure.log" >&2; exit 1; }
    make -j"$JOBS" > "$WORK/$dir.make.log" 2>&1 \
      || { echo "make failed for $dir:" >&2; tail -20 "$WORK/$dir.make.log" >&2; exit 1; }
    make install >> "$WORK/$dir.make.log" 2>&1 )
  log "$dir ✓"
}

build_subs_deps() {
  command -v pkg-config >/dev/null 2>&1 || {
    echo "pkg-config is required for the 'subs' profile (ffmpeg uses it to find libass)." >&2
    echo "  macOS: brew install pkg-config   ·   Linux: apt-get install pkg-config" >&2
    exit 1; }

  fetch "freetype-$FREETYPE_VERSION" \
    "https://downloads.sourceforge.net/project/freetype/freetype2/$FREETYPE_VERSION/freetype-$FREETYPE_VERSION.tar.gz" \
    "https://download.savannah.gnu.org/releases/freetype/freetype-$FREETYPE_VERSION.tar.gz" \
    "https://download.savannah.nongnu.org/releases/freetype/freetype-$FREETYPE_VERSION.tar.gz"
  build_dep "freetype-$FREETYPE_VERSION" --with-harfbuzz=no --with-brotli=no --with-png=no --with-bzip2=no

  fetch "fribidi-$FRIBIDI_VERSION" \
    "https://github.com/fribidi/fribidi/releases/download/v$FRIBIDI_VERSION/fribidi-$FRIBIDI_VERSION.tar.xz"
  build_dep "fribidi-$FRIBIDI_VERSION" --disable-docs

  # harfbuzz is not optional: libass 0.17.x dropped --disable-harfbuzz and now
  # checks for it unconditionally. It is meson-only these days, hence the extra
  # toolchain. MIT licensed, so it does not affect the LGPL result.
  command -v meson >/dev/null 2>&1 && command -v ninja >/dev/null 2>&1 || {
    echo "meson and ninja are required for the 'subs' profile (harfbuzz is meson-only)." >&2
    echo "  macOS: brew install meson ninja   ·   Linux: apt-get install meson ninja-build" >&2
    exit 1; }
  fetch "harfbuzz-$HARFBUZZ_VERSION" \
    "https://github.com/harfbuzz/harfbuzz/releases/download/$HARFBUZZ_VERSION/harfbuzz-$HARFBUZZ_VERSION.tar.xz"
  ( cd "$WORK/harfbuzz-$HARFBUZZ_VERSION"
    # Everything optional is off: libass only needs the shaping core, and each
    # extra (glib, icu, cairo) would drag a shared library into a binary that
    # has to run on machines with no Homebrew.
    meson setup _b --prefix="$DEPS" --default-library=static --buildtype=release \
          -Dtests=disabled -Ddocs=disabled -Dutilities=disabled \
          -Dglib=disabled -Dgobject=disabled -Dcairo=disabled -Dicu=disabled \
          -Dfreetype=enabled > "$WORK/harfbuzz.configure.log" 2>&1 \
      || { echo "harfbuzz meson setup failed:" >&2; tail -25 "$WORK/harfbuzz.configure.log" >&2; exit 1; }
    ninja -C _b > "$WORK/harfbuzz.make.log" 2>&1 && ninja -C _b install >> "$WORK/harfbuzz.make.log" 2>&1 \
      || { echo "harfbuzz build failed:" >&2; tail -25 "$WORK/harfbuzz.make.log" >&2; exit 1; } )
  log "harfbuzz-$HARFBUZZ_VERSION ✓"

  fetch "libass-$LIBASS_VERSION" \
    "https://github.com/libass/libass/releases/download/$LIBASS_VERSION/libass-$LIBASS_VERSION.tar.gz"
  build_dep "libass-$LIBASS_VERSION" --disable-require-system-font-provider
}

# ── ffmpeg ────────────────────────────────────────────────────────────────
CONFIG=(
  --prefix="$WORK/install"
  --disable-autodetect          # nothing from the build host leaks in
  --enable-static --disable-shared
  --disable-doc --disable-htmlpages --disable-manpages --disable-podpages --disable-txtpages
  --disable-ffplay --disable-ffprobe
  --disable-debug
  --enable-runtime-cpudetect
  --enable-pthreads
  --enable-zlib                 # permissive; matroska/mov need it
)
# NOTE: --enable-gpl / --enable-version3 / --enable-nonfree are deliberately
# absent. The verification gate at the bottom fails the build if they appear.

if [ "$(uname -s)" = "Darwin" ]; then
  CONFIG+=(--enable-videotoolbox --enable-audiotoolbox)
fi

if [ "$PROFILE" = "subs" ]; then
  build_subs_deps
  CONFIG+=(--enable-libass --enable-libfreetype --enable-libfribidi --enable-filter=subtitles --enable-filter=ass)
  export CFLAGS="-I$DEPS/include ${CFLAGS:-}"
  export LDFLAGS="-L$DEPS/lib ${LDFLAGS:-}"
fi

fetch "ffmpeg-$FFMPEG_VERSION" \
  "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.gz" \
  "https://github.com/FFmpeg/FFmpeg/archive/refs/tags/n$FFMPEG_VERSION.tar.gz"
cd "$WORK/ffmpeg-$FFMPEG_VERSION" 2>/dev/null || cd "$WORK/FFmpeg-n$FFMPEG_VERSION"

log "configuring (profile: $PROFILE, $JOBS jobs)…"
./configure "${CONFIG[@]}" > "$WORK/configure.log" 2>&1 || {
  echo "configure FAILED — tail of $WORK/configure.log:" >&2
  tail -30 "$WORK/configure.log" >&2
  exit 1
}

log "compiling… (this is the slow part)"
make -j"$JOBS" > "$WORK/make.log" 2>&1 || {
  echo "make FAILED — tail of $WORK/make.log:" >&2
  tail -30 "$WORK/make.log" >&2
  exit 1
}

# ── Licence verification gate ─────────────────────────────────────────────
# The whole point of this script. If a GPL or non-free component ever creeps
# back in, the build must fail here rather than ship an undistributable binary.
BANNER="$(./ffmpeg -version 2>&1)"
for forbidden in "--enable-gpl" "--enable-nonfree" "--enable-version3" "--enable-libx264" "--enable-libx265"; do
  if grep -q -- "$forbidden" <<<"$BANNER"; then
    echo "REFUSING TO SHIP: built ffmpeg reports $forbidden" >&2
    echo "$BANNER" | grep configuration >&2
    exit 1
  fi
done
log "licence gate passed — no GPL/non-free components"

cp ./ffmpeg "$OUT/ffmpeg"
chmod +x "$OUT/ffmpeg"

log "→ $OUT/ffmpeg  ($(du -h "$OUT/ffmpeg" | cut -f1))"
"$OUT/ffmpeg" -hide_banner -encoders 2>/dev/null | grep -E "h264_videotoolbox|aac " || true
log "done ✓"
