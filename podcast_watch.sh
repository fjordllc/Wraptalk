#!/usr/bin/env bash
#
# Folder-watch front-end for podcast_auto.sh. Watches an inbox directory and
# auto-processes any recording dropped into it — video OR audio. (podcast_auto.sh
# feeds [0:a] to ffmpeg, so audio-only inputs work as-is; the watcher just
# accepts their extensions too.) Polling-based, so it needs nothing beyond what
# podcast_auto.sh already requires. Runs in the foreground; Ctrl-C to stop.
# See README "フォルダ監視".

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUTO="$SCRIPT_DIR/podcast_auto.sh"
DEFAULT_INTRO="$SCRIPT_DIR/opening.wav"
DEFAULT_OUTRO="$SCRIPT_DIR/ending.wav"

IN_DIR=""
OUT_DIR=""
INTRO=""
OUTRO=""
INTERVAL="3"
ONCE=false

# Optional passthrough params for podcast_auto.sh (empty = use its own defaults).
INTRO_PAD=""
OUTRO_OVERLAP=""
VOICE_LUFS=""
MUSIC_VOLUME=""
DUCK_LEVEL=""
INTRO_FADE_START=""
INTRO_FADE_END=""
OUTRO_FADE_START=""
OUTRO_FADE_END=""
MP3_BITRATE=""

usage() {
  cat <<'EOF'
Usage:
  ./podcast_watch.sh --in-dir ./inbox --out-dir ./outbox [options]

Watches --in-dir and runs podcast_auto.sh on each video/audio file dropped in,
writing <name>_final.mp3 to --out-dir. Processed inputs move to <in-dir>/done,
failures to <in-dir>/failed. Runs until Ctrl-C.

Required:
  --in-dir DIR            Folder to watch for new recordings / audio
  --out-dir DIR           Folder for finished mp3s (created if missing)

Options:
  --intro PATH            Intro BGM (default: opening.wav next to this script)
  --outro PATH            Outro BGM (default: ending.wav next to this script)
  --interval SECONDS      Poll interval (default: 3)
  --once                  Process the files already present, then exit
  --help                  Show this help

Passthrough to podcast_auto.sh (omit to use its defaults):
  --intro-pad, --outro-overlap, --voice-lufs, --music-volume, --duck-level,
  --intro-fade-start, --intro-fade-end, --outro-fade-start, --outro-fade-end,
  --mp3-bitrate
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --in-dir) IN_DIR="$2"; shift 2 ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --intro) INTRO="$2"; shift 2 ;;
    --outro) OUTRO="$2"; shift 2 ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    --once) ONCE=true; shift ;;
    --intro-pad) INTRO_PAD="$2"; shift 2 ;;
    --outro-overlap) OUTRO_OVERLAP="$2"; shift 2 ;;
    --voice-lufs) VOICE_LUFS="$2"; shift 2 ;;
    --music-volume) MUSIC_VOLUME="$2"; shift 2 ;;
    --duck-level) DUCK_LEVEL="$2"; shift 2 ;;
    --intro-fade-start) INTRO_FADE_START="$2"; shift 2 ;;
    --intro-fade-end) INTRO_FADE_END="$2"; shift 2 ;;
    --outro-fade-start) OUTRO_FADE_START="$2"; shift 2 ;;
    --outro-fade-end) OUTRO_FADE_END="$2"; shift 2 ;;
    --mp3-bitrate) MP3_BITRATE="$2"; shift 2 ;;
    --help) usage; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

INTRO="${INTRO:-$DEFAULT_INTRO}"
OUTRO="${OUTRO:-$DEFAULT_OUTRO}"

if [[ -z "$IN_DIR" || -z "$OUT_DIR" ]]; then
  usage
  exit 1
fi
if [[ ! -x "$AUTO" ]]; then
  echo "podcast_auto.sh not found or not executable: $AUTO" >&2
  exit 1
fi
if [[ ! -d "$IN_DIR" ]]; then
  echo "Input dir not found: $IN_DIR" >&2
  exit 1
fi
for bgm in "$INTRO" "$OUTRO"; do
  if [[ ! -f "$bgm" ]]; then
    echo "BGM not found: $bgm" >&2
    exit 1
  fi
done

mkdir -p "$OUT_DIR" "$IN_DIR/done" "$IN_DIR/failed"
LOG_FILE="$OUT_DIR/watch.log"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" | tee -a "$LOG_FILE"
}

# Accepted input extensions (lowercased), mirroring the browser's accept sets.
is_supported() {
  local ext
  ext="$(printf '%s' "${1##*.}" | tr '[:upper:]' '[:lower:]')"
  case "$ext" in
    mp4|mov|mkv|webm|m4v|avi) return 0 ;;       # video
    mp3|wav|m4a|aac|flac|ogg|opus) return 0 ;;  # audio
    *) return 1 ;;
  esac
}

# Portable byte count (avoids stat -f/-c platform differences).
file_size() {
  wc -c < "$1" 2>/dev/null | tr -d '[:space:]'
}

# Build the passthrough arg list once. bash 3.2-safe: expanded later with the
# ${arr[@]+...} guard so an empty array doesn't trip `set -u`.
AUTO_ARGS=()
add_arg() { if [[ -n "$2" ]]; then AUTO_ARGS+=("$1" "$2"); fi; }
add_arg --intro-pad "$INTRO_PAD"
add_arg --outro-overlap "$OUTRO_OVERLAP"
add_arg --voice-lufs "$VOICE_LUFS"
add_arg --music-volume "$MUSIC_VOLUME"
add_arg --duck-level "$DUCK_LEVEL"
add_arg --intro-fade-start "$INTRO_FADE_START"
add_arg --intro-fade-end "$INTRO_FADE_END"
add_arg --outro-fade-start "$OUTRO_FADE_START"
add_arg --outro-fade-end "$OUTRO_FADE_END"
add_arg --mp3-bitrate "$MP3_BITRATE"

process_file() {
  local input="$1" stem out
  stem="$(basename "$input")"
  stem="${stem%.*}"
  out="$OUT_DIR/${stem}_final.mp3"
  log "processing: $input -> $out"
  if "$AUTO" --input "$input" --intro "$INTRO" --outro "$OUTRO" --output "$out" \
       ${AUTO_ARGS[@]+"${AUTO_ARGS[@]}"} >>"$LOG_FILE" 2>&1; then
    mv -f "$input" "$IN_DIR/done/"
    log "done: $out"
  else
    mv -f "$input" "$IN_DIR/failed/"
    log "FAILED (moved to failed/): $input"
  fi
}

scan_once() {
  local f size1 size2
  for f in "$IN_DIR"/*; do
    [[ -f "$f" ]] || continue          # skips the done/ and failed/ subdirs
    is_supported "$f" || continue
    size1="$(file_size "$f")"
    [[ -n "$size1" && "$size1" -gt 0 ]] || continue
    # Re-measure after one interval: a size still changing means the file is
    # mid-copy / mid-record, so skip it this round and retry on the next pass.
    sleep "$INTERVAL"
    [[ -f "$f" ]] || continue
    size2="$(file_size "$f")"
    if [[ "$size1" != "$size2" ]]; then
      log "still growing, will retry: $f"
      continue
    fi
    process_file "$f"
  done
}

log "watching $IN_DIR (interval ${INTERVAL}s, once=$ONCE)"
if [[ "$ONCE" == true ]]; then
  scan_once
  log "once pass complete"
else
  while true; do
    scan_once
    sleep "$INTERVAL"
  done
fi
