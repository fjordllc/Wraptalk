import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPreviewFilter,
  computeMixTimings,
  outputNameFromInput,
} from "./mix.js";

// ============================================================
// outputNameFromInput
// ============================================================

test("outputNameFromInput: replaces the trailing extension with _final.mp3", () => {
  assert.equal(outputNameFromInput({ name: "episode.mp4" }), "episode_final.mp3");
});

test("outputNameFromInput: keeps multi-dot stem and only strips the last segment", () => {
  assert.equal(outputNameFromInput({ name: "my.audio.session.wav" }), "my.audio.session_final.mp3");
});

test("outputNameFromInput: returns name + _final.mp3 when there is no extension", () => {
  assert.equal(outputNameFromInput({ name: "recording" }), "recording_final.mp3");
});

// ============================================================
// computeMixTimings
// ============================================================

const baseTimingsArgs = {
  speechDuration: 600,
  introPad: 10,
  outroOverlap: 8,
  outroFadeEnd: 12,
  talkTrimStart: 0,
  talkTrimEndRaw: 0,
};

test("computeMixTimings: default trim uses full speechDuration", () => {
  const t = computeMixTimings(baseTimingsArgs);
  assert.equal(t.safeTalkTrimStart, 0);
  assert.equal(t.safeTalkTrimEnd, 600);
  assert.equal(t.trimmedSpeechDuration, 600);
  assert.equal(t.safeOutroOverlap, 8);
  assert.equal(t.speechDelayMs, 10000);
  assert.equal(t.outroStartMs, (10 + 600 - 8) * 1000);
  assert.equal(t.totalDurationSec, (10 + 600 - 8) + 12);
});

test("computeMixTimings: talkTrimEndRaw = 0 means 'use through the source's end'", () => {
  const t = computeMixTimings({ ...baseTimingsArgs, talkTrimStart: 5, talkTrimEndRaw: 0 });
  assert.equal(t.safeTalkTrimStart, 5);
  assert.equal(t.safeTalkTrimEnd, 600);
  assert.equal(t.trimmedSpeechDuration, 595);
});

test("computeMixTimings: trimEndRaw less than trimStart still produces non-negative trim", () => {
  // The validation against an inverted trim happens in validateMixSpec earlier;
  // computeMixTimings is robust either way and never produces a negative duration.
  const t = computeMixTimings({ ...baseTimingsArgs, talkTrimStart: 200, talkTrimEndRaw: 100 });
  assert.ok(t.trimmedSpeechDuration >= 0);
  assert.equal(t.safeTalkTrimStart, 200);
  assert.equal(t.safeTalkTrimEnd, 100); // raw clamped to speechDuration, kept as-is when smaller
});

test("computeMixTimings: outroOverlap larger than trimmedSpeech caps at trimmedSpeech", () => {
  const t = computeMixTimings({ ...baseTimingsArgs, speechDuration: 5, outroOverlap: 30 });
  assert.equal(t.trimmedSpeechDuration, 5);
  assert.equal(t.safeOutroOverlap, 5);
  // outroStart in mix-time should never be negative: introPad + trimmed - overlap = 10 + 5 - 5 = 10s
  assert.equal(t.outroStartMs, 10000);
});

test("computeMixTimings: negative introPad treated as 0", () => {
  const t = computeMixTimings({ ...baseTimingsArgs, introPad: -3 });
  assert.equal(t.speechDelayMs, 0);
  assert.equal(t.outroStartMs, (0 + 600 - 8) * 1000);
});

test("computeMixTimings: talkTrimStart clamped to speechDuration", () => {
  const t = computeMixTimings({ ...baseTimingsArgs, talkTrimStart: 9999 });
  assert.equal(t.safeTalkTrimStart, 600);
});

// ============================================================
// buildPreviewFilter
// ============================================================

const previewSpec = {
  introPad: 10,
  voiceLufs: -16,
  introMusicVolume: 0.22,
  outroMusicVolume: 0.22,
  introDuckLevel: 0.3,
  outroDuckLevel: 0.3,
  introFadeStart: 26,
  introFadeEnd: 29,
  outroFadeStart: 114,
  outroFadeEnd: 118,
};

const previewTimings = {
  safeTalkTrimStart: 0,
  safeTalkTrimEnd: 600,
  trimmedSpeechDuration: 600,
  safeOutroOverlap: 8,
  speechDelayMs: 10000,
  outroStartMs: 602000,
  totalDurationSec: 614,
};

test("buildPreviewFilter: opening clips talk to (segmentDur - introPad)", () => {
  const segmentDur = 30;
  const filter = buildPreviewFilter("opening", previewSpec, previewTimings, 600, segmentDur);
  // headTalkLen = max(0.1, 30 - 10) = 20 → talkTrimEnd = 0 + 20 = 20
  assert.match(filter, /\[0:a\]atrim=start=0:end=20,/);
});

test("buildPreviewFilter: ending starts outro source at the skip offset when outro begins before the window", () => {
  // window = [584, 614], outro starts in mix at 602.
  // outroStartInPreview = 602 - 584 = 18 → outroSourceStart = 0 (positive case)
  const filter = buildPreviewFilter("ending", previewSpec, previewTimings, 600, 30);
  assert.match(filter, /adelay=18000\|18000\[outro_music\]/);
});

test("buildPreviewFilter: ending atrims outro source when outro started before the preview window", () => {
  // Set up a case where outro begins well before window: window = [584, 614],
  // outro starts at 500 in mix → outroSourceStart = 84 (negative branch)
  const earlyOutroTimings = {
    ...previewTimings,
    outroStartMs: 500000,
    totalDurationSec: 614,
  };
  const filter = buildPreviewFilter("ending", previewSpec, earlyOutroTimings, 600, 30);
  // Look for the atrim=start=84 on the outro input.
  assert.match(filter, /\[1:a\]atrim=start=84,asetpts=PTS-STARTPTS,/);
});

test("buildPreviewFilter: ending picks the trim window matching the tail", () => {
  // Talk plays in mix [10, 610], window [584, 614]
  // clippedTalkStart = max(10, 584) = 584 → adjustedTrimStart = 584 - 10 = 574
  // clippedTalkEnd = min(610, 614) = 610 → adjustedTrimEnd = 610 - 10 = 600
  const filter = buildPreviewFilter("ending", previewSpec, previewTimings, 600, 30);
  assert.match(filter, /\[0:a\]atrim=start=574:end=600,/);
});
