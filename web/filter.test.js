import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEndingPreviewFilter, buildFilter, buildOpeningPreviewFilter } from "./filter.js";

const baseSpec = {
  speechDelayMs: 10000,
  outroStartMs: 620000,
  introPad: 10,
  safeOutroOverlap: 5,
  voiceLufs: -16,
  introMusicVolume: 0.22,
  outroMusicVolume: 0.22,
  introFadeStart: 10,
  introFadeEnd: 15,
  outroFadeStart: 12,
  outroFadeEnd: 18,
  talkTrimStart: 0,
  talkTrimEnd: 0,
};

test("buildFilter: no trim emits no atrim prefix", () => {
  const result = buildFilter(baseSpec);
  assert.match(
    result,
    /^\[0:a\]aformat=sample_fmts=fltp/,
    "speech chain starts with aformat (no atrim)",
  );
  assert.ok(!result.includes("atrim="), "no atrim should appear");
});

test("buildFilter: talkTrimStart + talkTrimEnd emits start:end atrim", () => {
  const result = buildFilter({ ...baseSpec, talkTrimStart: 5, talkTrimEnd: 600 });
  assert.match(
    result,
    /^\[0:a\]atrim=start=5:end=600,asetpts=PTS-STARTPTS,aformat=/,
    "atrim with start and end",
  );
});

test("buildFilter: only talkTrimStart emits start-only atrim", () => {
  const result = buildFilter({ ...baseSpec, talkTrimStart: 5, talkTrimEnd: 0 });
  assert.match(
    result,
    /^\[0:a\]atrim=start=5,asetpts=PTS-STARTPTS,aformat=/,
    "atrim with only start",
  );
});

test("buildFilter: talkTrimEnd <= talkTrimStart falls back to start-only", () => {
  const result = buildFilter({ ...baseSpec, talkTrimStart: 10, talkTrimEnd: 5 });
  assert.match(
    result,
    /^\[0:a\]atrim=start=10,asetpts=PTS-STARTPTS,aformat=/,
  );
});

test("buildFilter: speech chain includes dynaudnorm then loudnorm with target LUFS", () => {
  const result = buildFilter({ ...baseSpec, voiceLufs: -18 });
  assert.match(result, /dynaudnorm=f=200:g=15:p=0\.92,loudnorm=I=-18:TP=-2:LRA=11\[speech_mono\]/);
});

test("buildFilter: intro fade expression uses introFadeStart/End", () => {
  const result = buildFilter({ ...baseSpec, introFadeStart: 8, introFadeEnd: 12 });
  assert.match(result, /lt\(t\\,8\)/);
  assert.match(result, /lt\(t\\,12\)/);
  assert.match(result, /\(12-t\)\/4/, "denominator equals end-start");
});

test("buildFilter: outro fade expression uses outroFadeStart/End", () => {
  const result = buildFilter({ ...baseSpec, outroFadeStart: 10, outroFadeEnd: 30 });
  assert.match(result, /\(30-t\)\/20/, "outro denominator equals end-start");
});

test("buildFilter: zero-length fade window guards against div-by-zero", () => {
  const result = buildFilter({ ...baseSpec, introFadeStart: 10, introFadeEnd: 10 });
  assert.match(result, /\/0\.0001/, "denominator clamped to 0.0001");
});

test("buildFilter: outroStartMs propagated to outro adelay", () => {
  const result = buildFilter({ ...baseSpec, outroStartMs: 425000 });
  assert.match(result, /adelay=425000\|425000\[outro_music\]/);
});

test("buildFilter: no sidechain (envelope-based ducking)", () => {
  const result = buildFilter(baseSpec);
  assert.ok(!result.includes("sidechaincompress"), "no sidechain compressor");
  assert.ok(!result.includes("speech_intro_sc"), "no sidechain branches");
});

test("buildFilter: speech is widened via pseudo-stereo EQ split", () => {
  const result = buildFilter(baseSpec);
  assert.match(result, /\[speech_mono\]asplit=2\[speech_l_src\]\[speech_r_src\]/);
  assert.match(result, /\[speech_l_src\]equalizer=f=3500:t=q:w=2:g=2/);
  assert.match(result, /\[speech_r_src\]equalizer=f=3500:t=q:w=2:g=-2/);
  assert.match(result, /\[speech_l\]\[speech_r\]join=inputs=2:channel_layout=stereo\[speech\]/);
});

test("buildFilter: mixes 3 inputs (speech + intro + outro)", () => {
  const result = buildFilter(baseSpec);
  assert.match(result, /\[speech_delayed\]\[intro_music\]\[outro_music\]amix=inputs=3:duration=longest:normalize=0\[mixed\]/);
});

test("buildFilter: intro envelope includes duck transition before fade-out", () => {
  const result = buildFilter({ ...baseSpec, introPad: 10, introFadeStart: 26, introFadeEnd: 29 });
  // duck transition at introPad=10 → fadeBegin=9.6
  assert.match(result, /lt\(t\\,9\.6\)/);
  // ducked level 0.3 appears in the duck branch
  assert.match(result, /0\.3/);
  // fade-out denominator still present
  assert.match(result, /\(29-t\)\/3/);
});

test("buildFilter: outro envelope includes rise transition after duck end", () => {
  const result = buildFilter({ ...baseSpec, safeOutroOverlap: 8, outroFadeStart: 12, outroFadeEnd: 18 });
  // rise from duckEnd=8 to riseEnd=8.4
  assert.match(result, /lt\(t\\,8\)/);
  assert.match(result, /lt\(t\\,8\.4\)/);
  // outro fade-out
  assert.match(result, /\(18-t\)\/6/);
});

test("buildFilter: ends with limiter", () => {
  const result = buildFilter(baseSpec);
  assert.match(result, /\[mixed\]alimiter=limit=0\.89:attack=5:release=50\[out\]$/);
});

const previewBase = {
  speechDelayMs: 10000,
  introPad: 10,
  outroDuckEnd: 0,
  voiceLufs: -16,
  introMusicVolume: 0.22,
  outroMusicVolume: 0.22,
  introFadeStart: 10,
  introFadeEnd: 15,
  outroFadeStart: 12,
  outroFadeEnd: 18,
  talkTrimStart: 0,
  talkTrimEnd: 30,
  segmentDurationSec: 30,
};

test("buildOpeningPreviewFilter: references only [0:a] (talk) and [1:a] (intro)", () => {
  const result = buildOpeningPreviewFilter(previewBase);
  assert.match(result, /\[0:a\]/, "uses talk input");
  assert.match(result, /\[1:a\]/, "uses intro input");
  assert.ok(!result.includes("[2:a]"), "outro input not referenced");
  assert.ok(!result.includes("outro_music"), "no outro music chain");
});

test("buildOpeningPreviewFilter: ends with limiter + atrim 0:30 + fade-out", () => {
  const result = buildOpeningPreviewFilter(previewBase);
  assert.match(result, /\[limited\]atrim=0:30,asetpts=PTS-STARTPTS,afade=t=out:st=29\.5:d=0\.5\[preview\]$/);
  assert.match(result, /\[mixed\]alimiter=limit=0\.89:attack=5:release=50\[limited\]/);
});

test("buildOpeningPreviewFilter: applies talk trim window", () => {
  const result = buildOpeningPreviewFilter({ ...previewBase, talkTrimStart: 0, talkTrimEnd: 20 });
  assert.match(result, /\[0:a\]atrim=start=0:end=20,asetpts=PTS-STARTPTS,/);
});

test("buildEndingPreviewFilter: references only [0:a] (talk) and [1:a] (outro)", () => {
  const result = buildEndingPreviewFilter({
    ...previewBase,
    outroDelayMs: 12000,
    talkTrimStart: 580,
    talkTrimEnd: 600,
  });
  assert.match(result, /\[0:a\]/, "uses talk tail input");
  assert.match(result, /\[1:a\]/, "uses outro input");
  assert.ok(!result.includes("[2:a]"), "no third input");
  assert.ok(!result.includes("intro_music"), "no intro music chain");
});

test("buildEndingPreviewFilter: outro adelay reflects preview-time offset", () => {
  const result = buildEndingPreviewFilter({
    ...previewBase,
    outroDelayMs: 12000,
    talkTrimStart: 580,
    talkTrimEnd: 600,
  });
  assert.match(result, /adelay=12000\|12000\[outro_music\]/);
});

test("buildEndingPreviewFilter: ends with fade-in", () => {
  const result = buildEndingPreviewFilter({
    ...previewBase,
    outroDelayMs: 12000,
    talkTrimStart: 580,
    talkTrimEnd: 600,
  });
  assert.match(result, /afade=t=in:st=0:d=0\.5\[preview\]$/);
});
