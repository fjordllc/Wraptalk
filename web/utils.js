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
