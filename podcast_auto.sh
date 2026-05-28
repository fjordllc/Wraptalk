#!/usr/bin/env bash
#
# Legacy shell version of Wraptalk, kept as a long-form fallback for when a
# 60min+ mp4 is too heavy for the browser's ffmpeg.wasm. The audio processing
# chain is kept CLOSE to the browser version (web/filter.js): time-based volume
# envelope ducking (no sidechain pumping), highpass 100Hz + 170Hz cut, loudnorm,
# dynamic de-esser (adynamicequalizer), pseudo-stereo widening, optional BGM
# fade-out, and a final alimiter. Intentional differences from the browser: a
# single --duck-level for both intro/outro (no per-section levels) and no
# talk-trim. After changing the chain, verify the output by ear.

set -euo pipefail

INPUT=""
INTRO=""
OUTRO=""
OUTPUT=""

INTRO_PAD="2.0"
OUTRO_OVERLAP="8.0"
VOICE_LUFS="-16"
MUSIC_VOLUME="1.0"
DUCK_LEVEL="0.3"
# Optional BGM fade-out (opt-in; both start and end must be given to take
# effect). Times are in BGM source seconds, matching web/filter.js.
INTRO_FADE_START=""
INTRO_FADE_END=""
OUTRO_FADE_START=""
OUTRO_FADE_END=""
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
  --music-volume VALUE    Base BGM gain, 0-1 (default: 1.0; matches the
                          browser's 100% base volume)
  --duck-level VALUE      BGM gain under talk, 0-1 (default: 0.3 = 30%)
  --intro-fade-start SEC  Intro BGM fade-out start, in intro source seconds
  --intro-fade-end SEC    Intro BGM fade-out end (needs both start and end)
  --outro-fade-start SEC  Outro BGM fade-out start, in outro source seconds
  --outro-fade-end SEC    Outro BGM fade-out end (also trims trailing silence)
  --mp3-bitrate VALUE     Output bitrate (default: 128k)
  --help                  Show this help

Fades are optional; omit them to keep the BGM at full length (ducked under
talk). The browser version always fades — pass these to match it.
EOF
}

# Error out with usage if a value-taking flag has no argument, instead of
# letting `set -u` raise a bare "unbound variable" / shift error. $1 = $#.
need_val() {
  if [[ "$1" -lt 2 ]]; then
    echo "Missing value for $2" >&2
    usage
    exit 1
  fi
}

# These options are the canonical set; podcast_watch.sh and install-watch-agent.sh
# forward them verbatim, so keep those two in sync when adding one here.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --input) need_val "$#" "$1"; INPUT="$2"; shift 2 ;;
    --intro) need_val "$#" "$1"; INTRO="$2"; shift 2 ;;
    --outro) need_val "$#" "$1"; OUTRO="$2"; shift 2 ;;
    --output) need_val "$#" "$1"; OUTPUT="$2"; shift 2 ;;
    --intro-pad) need_val "$#" "$1"; INTRO_PAD="$2"; shift 2 ;;
    --outro-overlap) need_val "$#" "$1"; OUTRO_OVERLAP="$2"; shift 2 ;;
    --voice-lufs) need_val "$#" "$1"; VOICE_LUFS="$2"; shift 2 ;;
    --music-volume) need_val "$#" "$1"; MUSIC_VOLUME="$2"; shift 2 ;;
    --duck-level) need_val "$#" "$1"; DUCK_LEVEL="$2"; shift 2 ;;
    --intro-fade-start) need_val "$#" "$1"; INTRO_FADE_START="$2"; shift 2 ;;
    --intro-fade-end) need_val "$#" "$1"; INTRO_FADE_END="$2"; shift 2 ;;
    --outro-fade-start) need_val "$#" "$1"; OUTRO_FADE_START="$2"; shift 2 ;;
    --outro-fade-end) need_val "$#" "$1"; OUTRO_FADE_END="$2"; shift 2 ;;
    --mp3-bitrate) need_val "$#" "$1"; MP3_BITRATE="$2"; shift 2 ;;
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

INTRO_PAD="$(float_max "$INTRO_PAD" "0")"
OUTRO_OVERLAP="$(float_max "$OUTRO_OVERLAP" "0")"
OUTRO_OVERLAP="$(float_min "$OUTRO_OVERLAP" "$SPEECH_DURATION")"

SPEECH_DELAY_MS="$(to_ms_int "$INTRO_PAD")"
OUTRO_START_SEC="$(awk -v pad="$INTRO_PAD" -v speech="$SPEECH_DURATION" -v overlap="$OUTRO_OVERLAP" 'BEGIN { printf "%.3f", pad + speech - overlap }')"
OUTRO_START_MS="$(to_ms_int "$OUTRO_START_SEC")"

# Time-based ducking envelopes, mirroring web/filter.js buildIntroEnvelope /
# buildOutroEnvelope: each is (duck expression) * (optional fade-out). DUCK_FADE_
# DUR = 0.4s. The volume expression is single-quoted in the filtergraph below so
# its commas are literal and need no backslash escaping. `t` is the BGM source
# time, evaluated before the outro's adelay (so duckEnd/fade are in source time,
# matching the browser). Fade is opt-in: only applied when both fade-start and
# fade-end are given and end > start.
DUCK_LEVEL="$(float_max "$DUCK_LEVEL" "0")"
DUCK_LEVEL="$(float_min "$DUCK_LEVEL" "1")"
INTRO_ENV="$(awk -v duckStart="$INTRO_PAD" -v duckLevel="$DUCK_LEVEL" -v fadeStart="$INTRO_FADE_START" -v fadeEnd="$INTRO_FADE_END" 'BEGIN {
  if (duckStart <= 0) {
    duck = sprintf("%g", duckLevel)
  } else {
    fadeDur = (duckStart < 0.4) ? duckStart : 0.4
    fadeBegin = duckStart - fadeDur
    oneMinus = 1 - duckLevel
    duck = sprintf("if(lt(t,%g),1,if(lt(t,%g),1-%g*(t-%g)/%g,%g))", fadeBegin, duckStart, oneMinus, fadeBegin, fadeDur, duckLevel)
  }
  if (fadeStart != "" && fadeEnd != "" && fadeEnd+0 > fadeStart+0) {
    fdur = (fadeEnd+0) - (fadeStart+0)
    if (fdur < 0.0001) fdur = 0.0001
    fade = sprintf("if(lt(t,%g),1,if(lt(t,%g),(%g-t)/%g,0))", fadeStart+0, fadeEnd+0, fadeEnd+0, fdur)
    printf "(%s)*(%s)", duck, fade
  } else {
    printf "%s", duck
  }
}')"
OUTRO_ENV="$(awk -v duckEnd="$OUTRO_OVERLAP" -v duckLevel="$DUCK_LEVEL" -v fadeStart="$OUTRO_FADE_START" -v fadeEnd="$OUTRO_FADE_END" 'BEGIN {
  duckIsOne = 0
  if (duckEnd <= 0) {
    duck = "1"; duckIsOne = 1
  } else {
    riseEnd = duckEnd + 0.4
    oneMinus = 1 - duckLevel
    duck = sprintf("if(lt(t,%g),%g,if(lt(t,%g),%g+%g*(t-%g)/0.4,1))", duckEnd, duckLevel, riseEnd, duckLevel, oneMinus, duckEnd)
  }
  if (fadeStart != "" && fadeEnd != "" && fadeEnd+0 > fadeStart+0) {
    fdur = (fadeEnd+0) - (fadeStart+0)
    if (fdur < 0.0001) fdur = 0.0001
    fade = sprintf("if(lt(t,%g),1,if(lt(t,%g),(%g-t)/%g,0))", fadeStart+0, fadeEnd+0, fadeEnd+0, fdur)
    if (duckIsOne) printf "%s", fade
    else printf "(%s)*(%s)", duck, fade
  } else {
    printf "%s", duck
  }
}')"

# When the outro fades out, trim the trailing (post-fade) silence the way the
# browser does with -t = outroStart + outroFadeEnd. Built as an array so it
# expands to nothing when no outro fade is set (bash 3.2-safe via the +-guard).
TRIM_ARGS=()
if [[ -n "$OUTRO_FADE_START" && -n "$OUTRO_FADE_END" ]] \
  && awk -v s="$OUTRO_FADE_START" -v e="$OUTRO_FADE_END" 'BEGIN { exit !(e+0 > s+0) }'; then
  TOTAL_DURATION="$(awk -v s="$OUTRO_START_SEC" -v fe="$OUTRO_FADE_END" 'BEGIN { printf "%.3f", s + (fe+0) }')"
  TRIM_ARGS=(-t "$TOTAL_DURATION")
fi

# Mirrors web/filter.js buildFilter: speech EQ + loudnorm + de-esser +
# pseudo-stereo split, envelope-ducked intro/outro, 3-input amix, final limiter.
# NOTE: the de-esser uses mode=cutabove here. The browser (ffmpeg-core 0.12.10)
# uses the older mode=cut; system ffmpeg (7+/8) renamed that enum to cutbelow/
# cutabove, and "cut sibilance when it exceeds threshold" maps to cutabove.
FILTER_COMPLEX="
[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=mono,highpass=f=100,lowpass=f=14000,equalizer=f=170:t=q:w=2:g=-3,loudnorm=I=${VOICE_LUFS}:TP=-2:LRA=11,adynamicequalizer=threshold=3:dfrequency=6500:dqfactor=2:tfrequency=6500:tqfactor=2:mode=cutabove:ratio=4:attack=5:release=50:makeup=0[speech_mono];
[speech_mono]asplit=2[speech_l_src][speech_r_src];
[speech_l_src]equalizer=f=3500:t=q:w=2:g=2,equalizer=f=325:t=q:w=2:g=-1[speech_l];
[speech_r_src]equalizer=f=3500:t=q:w=2:g=-2,equalizer=f=325:t=q:w=2:g=1[speech_r];
[speech_l][speech_r]join=inputs=2:channel_layout=stereo[speech];
[speech]adelay=${SPEECH_DELAY_MS}|${SPEECH_DELAY_MS}[speech_delayed];
[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=${MUSIC_VOLUME},volume='${INTRO_ENV}':eval=frame[intro_music];
[2:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=${MUSIC_VOLUME},volume='${OUTRO_ENV}':eval=frame,adelay=${OUTRO_START_MS}|${OUTRO_START_MS}[outro_music];
[speech_delayed][intro_music][outro_music]amix=inputs=3:duration=longest:normalize=0[mixed];
[mixed]alimiter=limit=0.89:attack=5:release=50[out]
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
  ${TRIM_ARGS[@]+"${TRIM_ARGS[@]}"} \
  -c:a libmp3lame \
  -b:a "$MP3_BITRATE" \
  "$OUTPUT"

echo "Done: $OUTPUT"
