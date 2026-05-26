import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getFadeHandleHit,
  getFadeHandlePositions,
  getTargetHandleHit,
  getTargetHandlePosition,
  getTrimHandleHit,
  getTrimHandlePositions,
} from "./waveform.js";

const WIDTH = 1000;
const HEIGHT = 88;

function makeController(overrides = {}) {
  return {
    duration: 100,
    canvas: {
      width: WIDTH,
      height: HEIGHT,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT }),
    },
    fadeStartInput: { value: "10" },
    fadeEndInput: { value: "20" },
    targetInput: { value: "30" },
    hasTargetHandle: true,
    trimStartInput: { value: "5" },
    trimEndInput: { value: "80" },
    hasTrimHandles: true,
    ...overrides,
  };
}

function event(x, y) {
  return { clientX: x, clientY: y };
}

test("getFadeHandlePositions: returns null when duration is 0", () => {
  const c = makeController({ duration: 0 });
  assert.equal(getFadeHandlePositions(c), null);
});

test("getFadeHandlePositions: returns null when fadeStartInput is missing", () => {
  const c = makeController({ fadeStartInput: null });
  assert.equal(getFadeHandlePositions(c), null);
});

test("getFadeHandlePositions: maps time to x via canvas.width", () => {
  const c = makeController();
  const p = getFadeHandlePositions(c);
  assert.equal(p.duration, 100);
  assert.equal(p.startX, 100); // 10/100 * 1000
  assert.equal(p.endX, 200); // 20/100 * 1000
});

test("getFadeHandleHit: ignores hits outside bottom 22px band", () => {
  const c = makeController();
  // y = 0 (top) -> null even if x aligns
  assert.equal(getFadeHandleHit(c, event(100, 0)), null);
  assert.equal(getFadeHandleHit(c, event(100, HEIGHT - 30)), null);
});

test("getFadeHandleHit: catches start handle in bottom band", () => {
  const c = makeController();
  assert.equal(getFadeHandleHit(c, event(100, HEIGHT - 5)), "start");
});

test("getFadeHandleHit: catches end handle in bottom band", () => {
  const c = makeController();
  assert.equal(getFadeHandleHit(c, event(200, HEIGHT - 5)), "end");
});

test("getFadeHandleHit: returns null outside 10px tolerance", () => {
  const c = makeController();
  assert.equal(getFadeHandleHit(c, event(150, HEIGHT - 5)), null);
});

test("getTargetHandlePosition: requires hasTargetHandle", () => {
  const c = makeController({ hasTargetHandle: false });
  assert.equal(getTargetHandlePosition(c), null);
});

test("getTargetHandlePosition: maps target value to x", () => {
  const c = makeController();
  const p = getTargetHandlePosition(c);
  assert.equal(p.x, 300); // 30/100 * 1000
});

test("getTargetHandleHit: top 22px only", () => {
  const c = makeController();
  // y at 30 -> miss (below 22px band)
  assert.equal(getTargetHandleHit(c, event(300, 30)), false);
  // y at 10, x near target (300) -> hit
  assert.equal(getTargetHandleHit(c, event(300, 10)), true);
});

test("getTargetHandleHit: x outside tolerance returns false", () => {
  const c = makeController();
  assert.equal(getTargetHandleHit(c, event(350, 10)), false);
});

test("getTrimHandlePositions: maps start/end to x", () => {
  const c = makeController();
  const p = getTrimHandlePositions(c);
  assert.equal(p.startX, 50); // 5/100 * 1000
  assert.equal(p.endX, 800); // 80/100 * 1000
});

test("getTrimHandlePositions: trimEnd=0 falls back to duration", () => {
  const c = makeController({ trimEndInput: { value: "0" } });
  const p = getTrimHandlePositions(c);
  assert.equal(p.endX, WIDTH); // duration / duration * width
});

test("getTrimHandleHit: top 22px only", () => {
  const c = makeController();
  // y = 30 -> below band, no hit
  assert.equal(getTrimHandleHit(c, event(50, 30)), null);
});

test("getTrimHandleHit: picks nearer of start/end when both near", () => {
  const c = makeController({
    trimStartInput: { value: "10" },
    trimEndInput: { value: "20" },
  });
  // startX=100, endX=200, click at 102 → start
  assert.equal(getTrimHandleHit(c, event(102, 10)), "start");
  // click at 198 → end
  assert.equal(getTrimHandleHit(c, event(198, 10)), "end");
});

test("getTrimHandleHit: returns null outside 10px tolerance", () => {
  const c = makeController();
  // startX=50, endX=800, click in middle
  assert.equal(getTrimHandleHit(c, event(400, 10)), null);
});
