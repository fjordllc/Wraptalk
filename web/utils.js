// @ts-check

/**
 * Parse a value into a number, returning `fallback` when not a finite number.
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function parseOptionalNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Parse a value into a number, throwing a labeled error when invalid.
 * @param {unknown} value
 * @param {string} label
 * @returns {number}
 */
export function parseRequiredNumber(value, label) {
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} を確認してください。`);
  }
  return parsed;
}

/**
 * Parse the `.value` of an input-like object as a number.
 * @param {{ value?: unknown } | null | undefined} input
 * @param {number} [fallback]
 * @returns {number}
 */
export function parseNumberInput(input, fallback = 0) {
  return parseOptionalNumber(input?.value ?? "", fallback);
}

/**
 * Clamp `value` into the `[0, 1]` range.
 * @param {number} value
 * @returns {number}
 */
export function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Convert a 0-100 percentage (as shown in the UI for volume inputs) into a
 * 0-1 linear gain. Single source of truth so the preview path and the ffmpeg
 * export path don't drift apart.
 * @param {number} percent
 * @returns {number}
 */
export function percentToGain(percent) {
  return percent / 100;
}

/**
 * Format a duration (seconds) as `M:SS`. Non-finite or negative values render as `0:00`.
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

/**
 * Return the lowercased extension of a filename, or `fallback` if there is none.
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
export function extFromName(name, fallback) {
  const dot = name.lastIndexOf(".");
  if (dot === -1) {
    return fallback;
  }
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Validate that `value` is inside the inclusive `[min, max]` range. Throws a
 * labeled Error when not. Returns `value` unchanged so the call can be inlined.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {string} label
 * @returns {number}
 */
export function assertInRange(value, min, max, label) {
  if (value < min || value > max) {
    throw new Error(`${label}は ${min}〜${max} の範囲で入力してください (現在: ${value})`);
  }
  return value;
}

/**
 * Heuristic: does this error look like a network / CDN failure rather than a
 * filter / runtime issue? Used to switch ffmpeg.wasm load failure messaging.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isNetworkLikeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch|network|failed to load|err_internet|err_network/i.test(message);
}
