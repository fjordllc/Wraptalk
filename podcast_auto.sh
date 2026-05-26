#!/usr/bin/env bash
#
# Legacy shell version of Wraptalk. The audio processing here does NOT match the
# browser version (web/filter.js). The browser version uses time-based envelope
# ducking, dynamic de-esser (adynamicequalizer), pseudo-stereo widening, and a
# final alimiter. This script still uses an older chain (sidechain compressor +
# static acompressor) and is kept only as a long-form fallback when a 60min+
# mp4 is too heavy for ffmpeg.wasm. Output character will differ from the
# browser version's mp3.

set -euo pipefail

INPUT=""
INTRO=""
OUTRO=""
OUTPUT=""

INTRO_PAD="2.0"
OUTRO_OVERLAP="8.0"
VOICE_LUFS="-16"
MUSIC_VOLUME="0.22"
SPEECH_HIGHPASS="80"
SPEECH_LOWPASS="14000"
COMP_THRESHOLD="0.09"
COMP_RATIO="3"
COMP_ATTACK="20"
COMP_RELEASE="250"
COMP_MAKEUP="2"
MP3_BITRATE="128k"

usage() {
  cat <<'EOF'
Usage:
  ./podcast_auto.sh \
    --input episode.mp4 \
    --intro intro.mp3 \
    --outro outro.mp3 \
    --output episode_final.mp3

Options:
  --input PATH            Google Meet recording (.mp4)
  --intro PATH            Intro music file
  --outro PATH            Outro music file
  --output PATH           Output mp3 path
  --intro-pad SECONDS     Intro-only time before talk starts (default: 2.0)
  --outro-overlap SECONDS Seconds of outro that overlap talk (default: 8.0)
  --voice-lufs VALUE      Target loudness for speech (default: -16)
  --music-volume VALUE    Music level multiplier (default: 0.22)
  --mp3-bitrate VALUE     Output bitrate (default: 128k)
  --help                  Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input) INPUT="$2"; shift 2 ;;
    --intro) INTRO="$2"; shift 2 ;;
    --outro) OUTRO="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    --intro-pad) INTRO_PAD="$2"; shift 2 ;;
    --outro-overlap) OUTRO_OVERLAP="$2"; shift 2 ;;
    --voice-lufs) VOICE_LUFS="$2"; shift 2 ;;
    --music-volume) MUSIC_VOLUME="$2"; shift 2 ;;
    --mp3-bitrate) MP3_BITRATE="$2"; shift 2 ;;
    --help) usage; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$INPUT" || -z "$INTRO" || -z "$OUTRO" || -z "$OUTPUT" ]]; then
  usage
  exit 1
fi

for file in "$INPUT" "$INTRO" "$OUTRO"; do
  if [[ ! -f "$file" ]]; then
    echo "File not found: $file" >&2
    exit 1
  fi
done

require_bin() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

require_bin ffmpeg
require_bin ffprobe
require_bin awk

duration_of() {
  ffprobe \
    -v error \
    -show_entries format=duration \
    -of default=noprint_wrappers=1:nokey=1 \
    "$1"
}

float_min() {
  awk -v a="$1" -v b="$2" 'BEGIN { if (a < b) print a; else print b }'
}

float_max() {
  awk -v a="$1" -v b="$2" 'BEGIN { if (a > b) print a; else print b }'
}

to_ms_int() {
  awk -v s="$1" 'BEGIN { printf "%d", s * 1000 }'
}

SPEECH_DURATION="$(duration_of "$INPUT")"
INTRO_DURATION="$(duration_of "$INTRO")"

INTRO_PAD="$(float_max "$INTRO_PAD" "0")"
OUTRO_OVERLAP="$(float_max "$OUTRO_OVERLAP" "0")"
OUTRO_OVERLAP="$(float_min "$OUTRO_OVERLAP" "$SPEECH_DURATION")"

SPEECH_DELAY_MS="$(to_ms_int "$INTRO_PAD")"
OUTRO_START_SEC="$(awk -v pad="$INTRO_PAD" -v speech="$SPEECH_DURATION" -v overlap="$OUTRO_OVERLAP" 'BEGIN { printf "%.3f", pad + speech - overlap }')"
OUTRO_START_MS="$(to_ms_int "$OUTRO_START_SEC")"

FILTER_COMPLEX="
[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=mono,highpass=f=${SPEECH_HIGHPASS},lowpass=f=${SPEECH_LOWPASS},acompressor=threshold=${COMP_THRESHOLD}:ratio=${COMP_RATIO}:attack=${COMP_ATTACK}:release=${COMP_RELEASE}:makeup=${COMP_MAKEUP},loudnorm=I=${VOICE_LUFS}:TP=-1.5:LRA=11[speech];
[speech]adelay=${SPEECH_DELAY_MS}|${SPEECH_DELAY_MS}[speech_delayed];
[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=${MUSIC_VOLUME}[intro_music];
[intro_music][speech_delayed]sidechaincompress=threshold=0.04:ratio=10:attack=20:release=350:makeup=1[intro_ducked];
[intro_ducked][speech_delayed]amix=inputs=2:duration=longest:normalize=0[with_intro];
[2:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=${MUSIC_VOLUME},adelay=${OUTRO_START_MS}|${OUTRO_START_MS}[outro_music];
[outro_music][speech_delayed]sidechaincompress=threshold=0.04:ratio=10:attack=20:release=350:makeup=1[outro_ducked];
[with_intro][outro_ducked]amix=inputs=2:duration=longest:normalize=0[out]
"

echo "Input:  $INPUT"
echo "Intro:  $INTRO"
echo "Outro:  $OUTRO"
echo "Output: $OUTPUT"
echo "Speech duration: ${SPEECH_DURATION}s"
echo "Intro pad: ${INTRO_PAD}s"
echo "Outro overlap: ${OUTRO_OVERLAP}s"

ffmpeg -y \
  -i "$INPUT" \
  -i "$INTRO" \
  -i "$OUTRO" \
  -filter_complex "$FILTER_COMPLEX" \
  -map "[out]" \
  -c:a libmp3lame \
  -b:a "$MP3_BITRATE" \
  "$OUTPUT"

echo "Done: $OUTPUT"
