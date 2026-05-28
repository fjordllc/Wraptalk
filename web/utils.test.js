import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clamp01,
  percentToGain,
  assertInRange,
  extFromName,
  formatTime,
  isNetworkLikeError,
  parseNumberInput,
  parseOptionalNumber,
  parseRequiredNumber,
} from "./utils.js";

test("parseOptionalNumber: valid number string", () => {
  assert.equal(parseOptionalNumber("3.14"), 3.14);
  assert.equal(parseOptionalNumber("0"), 0);
  assert.equal(parseOptionalNumber("-5"), -5);
});

test("parseOptionalNumber: returns fallback on invalid", () => {
  assert.equal(parseOptionalNumber("", 7), 7);
  assert.equal(parseOptionalNumber("abc", 9), 9);
  assert.equal(parseOptionalNumber(undefined, 4), 4);
  assert.equal(parseOptionalNumber(null, 2), 2);
});

test("parseOptionalNumber: default fallback is 0", () => {
  assert.equal(parseOptionalNumber("nope"), 0);
});

test("parseRequiredNumber: valid number string", () => {
  assert.equal(parseRequiredNumber("12.5", "label"), 12.5);
});

test("parseRequiredNumber: throws with label in message", () => {
  assert.throws(
    () => parseRequiredNumber("", "イントロの開始位置"),
    /イントロの開始位置/,
  );
  assert.throws(
    () => parseRequiredNumber("abc", "X"),
    /X を確認してください。/,
  );
});

test("parseNumberInput: reads .value from input-like object", () => {
  assert.equal(parseNumberInput({ value: "7.5" }), 7.5);
});

test("parseNumberInput: missing input falls back", () => {
  assert.equal(parseNumberInput(null, 3), 3);
  assert.equal(parseNumberInput(undefined, 5), 5);
});

test("parseNumberInput: invalid value falls back", () => {
  assert.equal(parseNumberInput({ value: "" }, 4), 4);
});

test("clamp01: within range", () => {
  assert.equal(clamp01(0), 0);
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(1), 1);
});

test("clamp01: below 0 clamps to 0", () => {
  assert.equal(clamp01(-0.5), 0);
  assert.equal(clamp01(-100), 0);
});

test("clamp01: above 1 clamps to 1", () => {
  assert.equal(clamp01(1.5), 1);
  assert.equal(clamp01(99), 1);
});

test("formatTime: zero", () => {
  assert.equal(formatTime(0), "0:00");
});

test("formatTime: sub-minute", () => {
  assert.equal(formatTime(7), "0:07");
  assert.equal(formatTime(59.9), "0:59");
});

test("formatTime: minutes and seconds", () => {
  assert.equal(formatTime(60), "1:00");
  assert.equal(formatTime(125), "2:05");
  assert.equal(formatTime(3600), "60:00");
});

test("formatTime: non-finite or negative coerced to 0", () => {
  assert.equal(formatTime(NaN), "0:00");
  assert.equal(formatTime(Infinity), "0:00");
  assert.equal(formatTime(-3), "0:00");
});

test("extFromName: standard case", () => {
  assert.equal(extFromName("recording.mp4", "bin"), "mp4");
  assert.equal(extFromName("clip.wav", "bin"), "wav");
});

test("extFromName: lowercases", () => {
  assert.equal(extFromName("Loud.WAV", "bin"), "wav");
});

test("extFromName: no dot returns fallback", () => {
  assert.equal(extFromName("README", "txt"), "txt");
});

test("extFromName: multi-dot keeps last segment", () => {
  assert.equal(extFromName("foo.bar.baz.mp3", "x"), "mp3");
});

test("assertInRange: returns value when inside range", () => {
  assert.equal(assertInRange(0.5, 0, 1, "音量"), 0.5);
  assert.equal(assertInRange(0, 0, 1, "音量"), 0);
  assert.equal(assertInRange(1, 0, 1, "音量"), 1);
});

test("assertInRange: throws labeled error when below min", () => {
  assert.throws(
    () => assertInRange(-0.1, 0, 1, "音量"),
    /音量は 0〜1 の範囲で入力してください \(現在: -0\.1\)/,
  );
});

test("assertInRange: throws labeled error when above max", () => {
  assert.throws(
    () => assertInRange(101, 0, 100, "ducking レベル"),
    /ducking レベルは 0〜100 の範囲で入力してください \(現在: 101\)/,
  );
});

test("assertInRange: negative ranges work", () => {
  assert.equal(assertInRange(-16, -40, -8, "LUFS"), -16);
  assert.throws(() => assertInRange(-5, -40, -8, "LUFS"));
  assert.throws(() => assertInRange(-41, -40, -8, "LUFS"));
});

test("isNetworkLikeError: matches typical fetch failures", () => {
  assert.equal(isNetworkLikeError(new Error("Failed to fetch")), true);
  assert.equal(isNetworkLikeError(new Error("NetworkError when attempting")), true);
  assert.equal(isNetworkLikeError(new Error("Failed to load module")), true);
  assert.equal(isNetworkLikeError(new TypeError("network connection lost")), true);
});

test("isNetworkLikeError: returns false for unrelated errors", () => {
  assert.equal(isNetworkLikeError(new Error("Invalid filter")), false);
  assert.equal(isNetworkLikeError(new Error("Out of memory")), false);
  assert.equal(isNetworkLikeError(new Error("syntax error")), false);
});

test("isNetworkLikeError: handles non-Error values", () => {
  assert.equal(isNetworkLikeError("Failed to fetch"), true);
  assert.equal(isNetworkLikeError("some other reason"), false);
  assert.equal(isNetworkLikeError(null), false);
  assert.equal(isNetworkLikeError(undefined), false);
});

test("percentToGain: maps 0-100 to 0-1", () => {
  assert.equal(percentToGain(0), 0);
  assert.equal(percentToGain(100), 1);
  assert.equal(percentToGain(22), 0.22);
  assert.equal(percentToGain(30), 0.3);
});
