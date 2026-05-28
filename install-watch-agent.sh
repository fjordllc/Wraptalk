#!/usr/bin/env bash
#
# Install (or remove) a launchd LaunchAgent that runs podcast_watch.sh in the
# background and on login, so you don't have to keep a terminal open. macOS only.
#
#   ./install-watch-agent.sh --in-dir ~/Podcast/inbox --out-dir ~/Podcast/outbox
#   ./install-watch-agent.sh --in-dir ... --out-dir ... --print   # show plist, don't install
#   ./install-watch-agent.sh --uninstall                          # stop + remove
#
# launchd starts agents with a minimal PATH, so the generated plist sets PATH to
# include Homebrew (/opt/homebrew/bin), where ffmpeg/ffprobe usually live.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WATCH="$SCRIPT_DIR/podcast_watch.sh"

LABEL="local.wraptalk.watch"
IN_DIR=""
OUT_DIR=""
MODE="install"   # install | print | uninstall

# Options forwarded verbatim to podcast_watch.sh.
PASS=()
add_pass() { PASS+=("$1" "$2"); }

usage() {
  cat <<'EOF'
Usage:
  ./install-watch-agent.sh --in-dir DIR --out-dir DIR [options]
  ./install-watch-agent.sh --in-dir DIR --out-dir DIR --print
  ./install-watch-agent.sh --uninstall [--label LABEL]

Generates ~/Library/LaunchAgents/<label>.plist that runs podcast_watch.sh in the
background (RunAtLoad + KeepAlive) and loads it. macOS only.

Required for install/print:
  --in-dir DIR            Folder to watch
  --out-dir DIR           Folder for finished mp3s (also holds the logs)

Options:
  --label LABEL           launchd label / plist name (default: local.wraptalk.watch)
  --print                 Print the generated plist to stdout and exit (no install)
  --uninstall             Unload and remove the agent, then exit
  --help                  Show this help

Forwarded to podcast_watch.sh (optional):
  --intro, --outro, --interval, --intro-pad, --outro-overlap, --voice-lufs,
  --music-volume, --duck-level, --intro-fade-start, --intro-fade-end,
  --outro-fade-start, --outro-fade-end, --mp3-bitrate

Logs once installed:
  <out-dir>/watch.log          podcast_watch.sh activity
  <out-dir>/agent.out.log      launchd stdout
  <out-dir>/agent.err.log      launchd stderr
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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --in-dir) need_val "$#" "$1"; IN_DIR="$2"; shift 2 ;;
    --out-dir) need_val "$#" "$1"; OUT_DIR="$2"; shift 2 ;;
    --label) need_val "$#" "$1"; LABEL="$2"; shift 2 ;;
    --print) MODE="print"; shift ;;
    --uninstall) MODE="uninstall"; shift ;;
    # KEEP IN SYNC with podcast_watch.sh / podcast_auto.sh options (forwarded verbatim).
    --intro|--outro|--interval|--intro-pad|--outro-overlap|--voice-lufs|--music-volume|--duck-level|--intro-fade-start|--intro-fade-end|--outro-fade-start|--outro-fade-end|--mp3-bitrate)
      need_val "$#" "$1"; add_pass "$1" "$2"; shift 2 ;;
    --help) usage; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! "$LABEL" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Invalid --label: '$LABEL'" >&2
  echo "Use only letters, numbers, dots, underscores, and hyphens." >&2
  exit 1
fi

PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# launchctl only exists on macOS. --print just emits XML, so it stays usable
# anywhere; install/uninstall need launchctl.
if [[ "$MODE" != "print" ]] && ! command -v launchctl >/dev/null 2>&1; then
  echo "launchctl not found — this installer is macOS only." >&2
  echo "Use --print to generate the plist for manual/other-OS setup." >&2
  exit 1
fi

if [[ "$MODE" == "uninstall" ]]; then
  launchctl unload -w "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed agent: $PLIST"
  exit 0
fi

if [[ -z "$IN_DIR" || -z "$OUT_DIR" ]]; then
  usage
  exit 1
fi
if [[ ! -x "$WATCH" ]]; then
  echo "podcast_watch.sh not found or not executable: $WATCH" >&2
  exit 1
fi

# Absolute path without requiring the dir to exist yet (no side effects in --print).
abspath() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *) printf '%s' "$(pwd)/$1" ;;
  esac
}
IN_ABS="$(abspath "$IN_DIR")"
OUT_ABS="$(abspath "$OUT_DIR")"

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

emit_plist() {
  local p
  printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>'
  printf '%s\n' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
  printf '%s\n' '<plist version="1.0">'
  printf '%s\n' '<dict>'
  printf '  <key>Label</key>\n  <string>%s</string>\n' "$(xml_escape "$LABEL")"
  printf '  <key>ProgramArguments</key>\n  <array>\n'
  printf '    <string>/bin/bash</string>\n'
  printf '    <string>%s</string>\n' "$(xml_escape "$WATCH")"
  printf '    <string>--in-dir</string>\n    <string>%s</string>\n' "$(xml_escape "$IN_ABS")"
  printf '    <string>--out-dir</string>\n    <string>%s</string>\n' "$(xml_escape "$OUT_ABS")"
  for p in ${PASS[@]+"${PASS[@]}"}; do
    printf '    <string>%s</string>\n' "$(xml_escape "$p")"
  done
  printf '  </array>\n'
  printf '  <key>EnvironmentVariables</key>\n  <dict>\n'
  printf '    <key>PATH</key>\n    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>\n'
  printf '  </dict>\n'
  printf '  <key>RunAtLoad</key>\n  <true/>\n'
  printf '  <key>KeepAlive</key>\n  <true/>\n'
  printf '  <key>StandardOutPath</key>\n  <string>%s</string>\n' "$(xml_escape "$OUT_ABS/agent.out.log")"
  printf '  <key>StandardErrorPath</key>\n  <string>%s</string>\n' "$(xml_escape "$OUT_ABS/agent.err.log")"
  printf '</dict>\n</plist>\n'
}

if [[ "$MODE" == "print" ]]; then
  emit_plist
  exit 0
fi

# install
mkdir -p "$IN_DIR" "$OUT_DIR" "$HOME/Library/LaunchAgents"
emit_plist > "$PLIST"
launchctl unload -w "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
echo "Installed and loaded: $PLIST"
echo "Watching: $IN_ABS  ->  $OUT_ABS"
echo "Logs: $OUT_ABS/watch.log (watcher), $OUT_ABS/agent.out.log / agent.err.log (launchd)"
echo "Uninstall with: $0 --uninstall --label $LABEL"
