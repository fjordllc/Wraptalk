// @ts-check

const DEFAULT_DUCK_LEVEL = 0.3;
const DUCK_FADE_DUR = 0.4;

/**
 * EQ-based pseudo-stereo: splits mono into 2 copies, applies mirror EQ
 * (L: highs boosted / lows cut, R: opposite), joins to stereo.
 * Voice stays centered while gaining a sense of width from the spectral split.
 */
function buildPseudoStereoLines(monoLabel, stereoLabel) {
  return [
    `[${monoLabel}]asplit=2[${stereoLabel}_l_src][${stereoLabel}_r_src]`,
    `[${stereoLabel}_l_src]equalizer=f=3500:t=q:w=2:g=2,equalizer=f=325:t=q:w=2:g=-1[${stereoLabel}_l]`,
    `[${stereoLabel}_r_src]equalizer=f=3500:t=q:w=2:g=-2,equalizer=f=325:t=q:w=2:g=1[${stereoLabel}_r]`,
    `[${stereoLabel}_l][${stereoLabel}_r]join=inputs=2:channel_layout=stereo[${stereoLabel}]`,
  ];
}

const SPEECH_PROCESS_CHAIN = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=mono,highpass=f=100,lowpass=f=14000,equalizer=f=170:t=q:w=2:g=-3";
const DE_ESSER = "adynamicequalizer=threshold=3:dfrequency=6500:dqfactor=2:tfrequency=6500:tqfactor=2:mode=cut:ratio=4:attack=5:release=50:makeup=0";
const MUSIC_FORMAT_CHAIN = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo";
const LIMITER = "alimiter=limit=0.89:attack=5:release=50";

function buildTalkPrefix(talkTrimStart, talkTrimEnd) {
  if (talkTrimEnd > talkTrimStart) {
    return `atrim=start=${talkTrimStart}:end=${talkTrimEnd},asetpts=PTS-STARTPTS,`;
  }
  if (talkTrimStart > 0) {
    return `atrim=start=${talkTrimStart},asetpts=PTS-STARTPTS,`;
  }
  return "";
}

/**
 * Volume envelope for intro music:
 * - Full (1.0) until `duckStart - DUCK_FADE_DUR`
 * - Linear fade-down to DUCK_LEVEL over DUCK_FADE_DUR seconds, ending at `duckStart`
 * - Stays at DUCK_LEVEL afterwards
 * - Multiplied by a linear fade-out between `fadeStart` and `fadeEnd`
 */
function buildIntroEnvelope(duckStart, fadeStart, fadeEnd, duckLevel = DEFAULT_DUCK_LEVEL) {
  const fadeOutDur = Math.max(0.0001, fadeEnd - fadeStart);
  const fadeExpr = `if(lt(t\\,${fadeStart})\\,1\\,if(lt(t\\,${fadeEnd})\\,(${fadeEnd}-t)/${fadeOutDur}\\,0))`;
  if (duckStart <= 0) {
    return `${duckLevel}*(${fadeExpr})`;
  }
  const fadeDur = Math.min(DUCK_FADE_DUR, duckStart);
  const fadeBegin = duckStart - fadeDur;
  const duckExpr = `if(lt(t\\,${fadeBegin})\\,1\\,if(lt(t\\,${duckStart})\\,1-${1 - duckLevel}*(t-${fadeBegin})/${fadeDur}\\,${duckLevel}))`;
  return `(${duckExpr})*(${fadeExpr})`;
}

/**
 * Volume envelope for outro music:
 * - Starts ducked (DUCK_LEVEL) while talk is still playing
 * - Linear rise to 1.0 over DUCK_FADE_DUR seconds starting at `duckEnd`
 * - Multiplied by a linear fade-out between `fadeStart` and `fadeEnd`
 */
function buildOutroEnvelope(duckEnd, fadeStart, fadeEnd, duckLevel = DEFAULT_DUCK_LEVEL) {
  const fadeOutDur = Math.max(0.0001, fadeEnd - fadeStart);
  const fadeExpr = `if(lt(t\\,${fadeStart})\\,1\\,if(lt(t\\,${fadeEnd})\\,(${fadeEnd}-t)/${fadeOutDur}\\,0))`;
  if (duckEnd <= 0) {
    return fadeExpr;
  }
  const riseEnd = duckEnd + DUCK_FADE_DUR;
  const duckExpr = `if(lt(t\\,${duckEnd})\\,${duckLevel}\\,if(lt(t\\,${riseEnd})\\,${duckLevel}+${1 - duckLevel}*(t-${duckEnd})/${DUCK_FADE_DUR}\\,1))`;
  return `(${duckExpr})*(${fadeExpr})`;
}

/**
 * @typedef {Object} BuildFilterSpec
 * @property {number} speechDelayMs
 * @property {number} outroStartMs
 * @property {number} introPad
 * @property {number} safeOutroOverlap
 * @property {number} voiceLufs
 * @property {number} introMusicVolume
 * @property {number} outroMusicVolume
 * @property {number} introDuckLevel
 * @property {number} outroDuckLevel
 * @property {number} introFadeStart
 * @property {number} introFadeEnd
 * @property {number} outroFadeStart
 * @property {number} outroFadeEnd
 * @property {number} talkTrimStart
 * @property {number} talkTrimEnd
 */

/**
 * @param {BuildFilterSpec} spec
 * @returns {string}
 */
export function buildFilter({
  speechDelayMs,
  outroStartMs,
  introPad,
  safeOutroOverlap,
  voiceLufs,
  introMusicVolume,
  outroMusicVolume,
  introDuckLevel,
  outroDuckLevel,
  introFadeStart,
  introFadeEnd,
  outroFadeStart,
  outroFadeEnd,
  talkTrimStart,
  talkTrimEnd,
}) {
  const introEnvelope = buildIntroEnvelope(introPad, introFadeStart, introFadeEnd, introDuckLevel);
  const outroEnvelope = buildOutroEnvelope(safeOutroOverlap, outroFadeStart, outroFadeEnd, outroDuckLevel);
  const trimPrefix = buildTalkPrefix(talkTrimStart, talkTrimEnd);
  return [
    `[0:a]${trimPrefix}${SPEECH_PROCESS_CHAIN},loudnorm=I=${voiceLufs}:TP=-2:LRA=11,${DE_ESSER}[speech_mono]`,
    ...buildPseudoStereoLines("speech_mono", "speech"),
    `[speech]adelay=${speechDelayMs}|${speechDelayMs}[speech_delayed]`,
    `[1:a]${MUSIC_FORMAT_CHAIN},volume=${introMusicVolume},volume='${introEnvelope}':eval=frame[intro_music]`,
    `[2:a]${MUSIC_FORMAT_CHAIN},volume=${outroMusicVolume},volume='${outroEnvelope}':eval=frame,adelay=${outroStartMs}|${outroStartMs}[outro_music]`,
    `[speech_delayed][intro_music][outro_music]amix=inputs=3:duration=longest:normalize=0[mixed]`,
    `[mixed]${LIMITER}[out]`,
  ].join(";");
}

/**
 * Build a filter for the opening (head) preview: talk + intro only.
 * @param {Object} params
 * @param {number} params.speechDelayMs
 * @param {number} params.introPad
 * @param {number} params.voiceLufs
 * @param {number} params.introMusicVolume
 * @param {number} params.introDuckLevel
 * @param {number} params.introFadeStart
 * @param {number} params.introFadeEnd
 * @param {number} params.talkTrimStart
 * @param {number} params.talkTrimEnd
 * @param {number} params.segmentDurationSec
 * @returns {string}
 */
export function buildOpeningPreviewFilter({
  speechDelayMs,
  introPad,
  voiceLufs,
  introMusicVolume,
  introDuckLevel,
  introFadeStart,
  introFadeEnd,
  talkTrimStart,
  talkTrimEnd,
  segmentDurationSec,
}) {
  const introEnvelope = buildIntroEnvelope(introPad, introFadeStart, introFadeEnd, introDuckLevel);
  const trimPrefix = buildTalkPrefix(talkTrimStart, talkTrimEnd);
  const fadeOutStart = Math.max(0, segmentDurationSec - 0.5);
  return [
    `[0:a]${trimPrefix}${SPEECH_PROCESS_CHAIN},loudnorm=I=${voiceLufs}:TP=-2:LRA=11,${DE_ESSER}[speech_mono]`,
    ...buildPseudoStereoLines("speech_mono", "speech"),
    `[speech]adelay=${speechDelayMs}|${speechDelayMs},apad=pad_dur=${segmentDurationSec}[speech_delayed]`,
    `[1:a]${MUSIC_FORMAT_CHAIN},volume=${introMusicVolume},volume='${introEnvelope}':eval=frame[intro_music]`,
    `[speech_delayed][intro_music]amix=inputs=2:duration=longest:normalize=0[mixed]`,
    `[mixed]${LIMITER}[limited]`,
    `[limited]atrim=0:${segmentDurationSec},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeOutStart}:d=0.5[preview]`,
  ].join(";");
}

/**
 * Build a filter for the ending (tail) preview: talk-tail + outro only.
 * @param {Object} params
 * @param {number} params.speechDelayMs
 * @param {number} params.outroDelayMs
 * @param {number} [params.outroSourceStart]
 * @param {number} params.outroDuckEnd
 * @param {number} params.voiceLufs
 * @param {number} params.outroMusicVolume
 * @param {number} params.outroDuckLevel
 * @param {number} params.outroFadeStart
 * @param {number} params.outroFadeEnd
 * @param {number} params.talkTrimStart
 * @param {number} params.talkTrimEnd
 * @param {number} params.segmentDurationSec
 * @returns {string}
 */
export function buildEndingPreviewFilter({
  speechDelayMs,
  outroDelayMs,
  outroSourceStart = 0,
  outroDuckEnd,
  voiceLufs,
  outroMusicVolume,
  outroDuckLevel,
  outroFadeStart,
  outroFadeEnd,
  talkTrimStart,
  talkTrimEnd,
  segmentDurationSec,
}) {
  const outroEnvelope = buildOutroEnvelope(outroDuckEnd, outroFadeStart, outroFadeEnd, outroDuckLevel);
  const trimPrefix = buildTalkPrefix(talkTrimStart, talkTrimEnd);
  const outroSourcePrefix = outroSourceStart > 0
    ? `atrim=start=${outroSourceStart},asetpts=PTS-STARTPTS,`
    : "";
  return [
    `[0:a]${trimPrefix}${SPEECH_PROCESS_CHAIN},loudnorm=I=${voiceLufs}:TP=-2:LRA=11,${DE_ESSER}[speech_mono]`,
    ...buildPseudoStereoLines("speech_mono", "speech"),
    `[speech]adelay=${speechDelayMs}|${speechDelayMs},apad=pad_dur=${segmentDurationSec}[speech_delayed]`,
    `[1:a]${outroSourcePrefix}${MUSIC_FORMAT_CHAIN},volume=${outroMusicVolume},volume='${outroEnvelope}':eval=frame,adelay=${outroDelayMs}|${outroDelayMs}[outro_music]`,
    `[speech_delayed][outro_music]amix=inputs=2:duration=longest:normalize=0[mixed]`,
    `[mixed]${LIMITER}[limited]`,
    `[limited]atrim=0:${segmentDurationSec},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.5[preview]`,
  ].join(";");
}
