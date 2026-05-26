// @ts-check

import { FFmpeg } from "../vendor/ffmpeg/dist/esm/index.js";
import { fetchFile } from "../vendor/util/dist/esm/index.js";
import { extFromName } from "./utils.js";
import { buildEndingPreviewFilter, buildFilter, buildOpeningPreviewFilter } from "./filter.js";

export { buildFilter } from "./filter.js";

/**
 * @typedef {Object} MixAudioSource
 * @property {File | string} source - File object or fallback URL
 * @property {string} name - filename used for ffmpeg fs labeling
 */

/**
 * @typedef {Object} MixSpec
 * @property {File} input - the talk source file
 * @property {MixAudioSource} intro
 * @property {MixAudioSource} outro
 * @property {number} introPad
 * @property {number} outroOverlap
 * @property {number} voiceLufs
 * @property {number} introMusicVolume
 * @property {number} outroMusicVolume
 * @property {number} introFadeStart
 * @property {number} introFadeEnd
 * @property {number} outroFadeStart
 * @property {number} outroFadeEnd
 * @property {number} talkTrimStart
 * @property {number} talkTrimEndRaw
 * @property {string} mp3Bitrate
 * @property {(status: string) => void} [onStatus]
 */

class FfmpegRuntime {
  #instance = new FFmpeg();
  #isLoaded = false;
  #loadPromise = null;
  #mutex = Promise.resolve();
  #logHandler = null;
  #progressHandler = null;

  constructor() {
    this.#instance.on("log", ({ message }) => {
      if (this.#logHandler) {
        this.#logHandler(message);
      }
    });
    this.#instance.on("progress", ({ progress }) => {
      if (this.#progressHandler) {
        this.#progressHandler(progress);
      }
    });
  }

  configure({ onLog, onProgress } = {}) {
    if (onLog !== undefined) {
      this.#logHandler = onLog;
    }
    if (onProgress !== undefined) {
      this.#progressHandler = onProgress;
    }
  }

  isLoaded() {
    return this.#isLoaded;
  }

  ensureLoaded() {
    if (this.#isLoaded) {
      return Promise.resolve();
    }
    if (!this.#loadPromise) {
      this.#loadPromise = this.#instance.load({
        coreURL: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js",
        wasmURL: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm",
        workerURL: "/vendor/ffmpeg/dist/esm/worker.js",
      }).then(() => {
        this.#isLoaded = true;
      }).catch((error) => {
        // Allow retry on a later call.
        this.#loadPromise = null;
        throw error;
      });
    }
    return this.#loadPromise;
  }

  // Acquire exclusive access for a multi-step ffmpeg flow. fn receives a
  // session object exposing writeFile / exec / readFile / cleanupFiles.
  // The session is only valid while fn is awaiting — callers can't stash
  // it and reuse it later from outside the lock — so there is no way to
  // hit the underlying ffmpeg worker outside of an active lock.
  withLock(fn) {
    const previous = this.#mutex;
    const next = previous.then(() => {
      const instance = this.#instance;
      let valid = true;
      const guard = (method) => {
        if (!valid) {
          throw new Error(`ffmpeg session has ended; ${method}() must be called inside the same withLock() callback`);
        }
      };
      const session = {
        writeFile: (name, data) => { guard("writeFile"); return instance.writeFile(name, data); },
        exec: (args) => { guard("exec"); return instance.exec(args); },
        readFile: (name) => { guard("readFile"); return instance.readFile(name); },
        deleteFile: async (name) => {
          guard("deleteFile");
          try { await instance.deleteFile(name); } catch { /* best effort */ }
        },
        cleanupFiles: async (names) => {
          guard("cleanupFiles");
          for (const name of names) {
            try { await instance.deleteFile(name); } catch { /* best effort */ }
          }
        },
      };
      return Promise.resolve(fn(session)).finally(() => {
        valid = false;
      });
    });
    this.#mutex = next.catch(() => {});
    return next;
  }
}

export const ffmpegRuntime = new FfmpegRuntime();

export const DEFAULT_INTRO_URL = "/opening.wav";
export const DEFAULT_OUTRO_URL = "/ending.wav";
export const DEFAULT_INTRO_NAME = "opening.wav";
export const DEFAULT_OUTRO_NAME = "ending.wav";

export function outputNameFromInput(file) {
  const stem = file.name.replace(/\.[^.]+$/, "");
  return `${stem}_final.mp3`;
}

function validateMixSpec({ introFadeStart, introFadeEnd, outroFadeStart, outroFadeEnd, talkTrimStart, talkTrimEndRaw }) {
  if (!ffmpegRuntime.isLoaded()) {
    throw new Error("先に ffmpeg.wasm を読み込んでください。");
  }
  if (introFadeEnd < introFadeStart) {
    throw new Error("イントロのフェード終了位置は開始位置以降にしてください。");
  }
  if (outroFadeEnd < outroFadeStart) {
    throw new Error("アウトロのフェード終了位置は開始位置以降にしてください。");
  }
  if (talkTrimEndRaw > 0 && talkTrimEndRaw <= talkTrimStart) {
    throw new Error("トークの終了位置は開始位置より後にしてください。");
  }
}

function deriveMixFileNames({ input, intro, outro }) {
  return {
    inputName: `input.${extFromName(input.name, "mp4")}`,
    introName: `intro.${extFromName(intro.name, "wav")}`,
    outroName: `outro.${extFromName(outro.name, "wav")}`,
    outputName: outputNameFromInput(input),
  };
}

async function writeMixInputs(fs, { input, intro, outro }, names) {
  await fs.writeFile(names.inputName, await fetchFile(input));
  await fs.writeFile(names.introName, await fetchFile(intro.source));
  await fs.writeFile(names.outroName, await fetchFile(outro.source));
}

export function computeMixTimings({
  speechDuration,
  introPad,
  outroOverlap,
  outroFadeEnd,
  talkTrimStart,
  talkTrimEndRaw,
}) {
  const safeTalkTrimStart = Math.max(0, Math.min(talkTrimStart, speechDuration));
  const safeTalkTrimEnd = talkTrimEndRaw > 0 ? Math.min(talkTrimEndRaw, speechDuration) : speechDuration;
  const trimmedSpeechDuration = Math.max(0, safeTalkTrimEnd - safeTalkTrimStart);
  const safeOutroOverlap = Math.max(0, Math.min(outroOverlap, trimmedSpeechDuration));
  const speechDelayMs = Math.round(Math.max(0, introPad) * 1000);
  const outroStartMs = Math.round((Math.max(0, introPad) + trimmedSpeechDuration - safeOutroOverlap) * 1000);
  const totalDurationSec = (outroStartMs / 1000) + outroFadeEnd;
  return {
    safeTalkTrimStart,
    safeTalkTrimEnd,
    trimmedSpeechDuration,
    safeOutroOverlap,
    speechDelayMs,
    outroStartMs,
    totalDurationSec,
  };
}

async function executeMixFilter(fs, { names, filter, totalDurationSec, mp3Bitrate }) {
  await fs.exec([
    "-i", names.inputName,
    "-i", names.introName,
    "-i", names.outroName,
    "-filter_complex", filter,
    "-map", "[out]",
    "-t", totalDurationSec.toFixed(3),
    "-c:a", "libmp3lame",
    "-b:a", mp3Bitrate,
    names.outputName,
  ]);
}

async function readMixOutput(fs, outputName) {
  const data = await fs.readFile(outputName);
  return new Blob([data.buffer], { type: "audio/mpeg" });
}

const PREVIEW_SEGMENT_SEC = 30;

/**
 * @typedef {"opening" | "ending"} MixPreviewKind
 */

/**
 * Render either the opening 30s or the ending 30s of the mix as mp3.
 * For very short mixes, the requested segment may cover the entire mix
 * (e.g. ending of a 10s mix is the whole thing).
 * @param {MixSpec} spec
 * @param {MixPreviewKind} kind
 * @returns {Promise<{ blob: Blob, durationSec: number }>}
 */
export async function renderMixPreview(spec, kind) {
  validateMixSpec(spec);

  const names = {
    inputName: `input.${extFromName(spec.input.name, "mp4")}`,
    introName: `intro.${extFromName(spec.intro.name, "wav")}`,
    outroName: `outro.${extFromName(spec.outro.name, "wav")}`,
  };
  const outputName = `preview_${kind}.mp3`;
  const { onStatus } = spec;
  const segmentDurationSec = PREVIEW_SEGMENT_SEC;

  // Only write talk + the kind-specific BGM file
  const bgmName = kind === "opening" ? names.introName : names.outroName;
  const bgmSource = kind === "opening" ? spec.intro.source : spec.outro.source;

  onStatus?.("長さを解析中...");
  const speechDuration = await getMediaDurationSeconds(spec.input);
  const timings = computeMixTimings({ ...spec, speechDuration });
  const trimmedDur = timings.safeTalkTrimEnd - timings.safeTalkTrimStart;

  return ffmpegRuntime.withLock(async (fs) => {
    try {
      onStatus?.("ファイルを書き込み中...");
      await fs.writeFile(names.inputName, await fetchFile(spec.input));
      await fs.writeFile(bgmName, await fetchFile(bgmSource));

    let filter;
    if (kind === "opening") {
      // Talk needed: from start of trimmed talk for up to (segmentDur - introPad) seconds
      const headTalkLen = Math.max(0.1, segmentDurationSec - spec.introPad);
      const talkEnd = timings.safeTalkTrimStart + Math.min(trimmedDur, headTalkLen);
      filter = buildOpeningPreviewFilter({
        speechDelayMs: timings.speechDelayMs,
        introPad: spec.introPad,
        voiceLufs: spec.voiceLufs,
        introMusicVolume: spec.introMusicVolume,
        introDuckLevel: spec.introDuckLevel,
        introFadeStart: spec.introFadeStart,
        introFadeEnd: spec.introFadeEnd,
        talkTrimStart: timings.safeTalkTrimStart,
        talkTrimEnd: Math.max(timings.safeTalkTrimStart + 0.1, talkEnd),
        segmentDurationSec,
      });
    } else {
      // ending — clip the mix window to [windowStart, totalDurationSec]
      const totalDur = timings.totalDurationSec;
      const windowStart = Math.max(0, totalDur - segmentDurationSec);
      const talkPlayStart = spec.introPad;
      const talkPlayEnd = spec.introPad + trimmedDur;
      const clippedTalkStart = Math.max(talkPlayStart, windowStart);
      const clippedTalkEnd = Math.min(talkPlayEnd, totalDur);

      const adjustedTalkTrimStartRaw = timings.safeTalkTrimStart + Math.max(0, clippedTalkStart - talkPlayStart);
      const adjustedTalkTrimEndRaw = timings.safeTalkTrimStart + Math.max(0, clippedTalkEnd - talkPlayStart);
      const adjustedTalkTrimStart = Math.min(adjustedTalkTrimStartRaw, timings.safeTalkTrimEnd - 0.1);
      const adjustedTalkTrimEnd = Math.max(adjustedTalkTrimStart + 0.1, adjustedTalkTrimEndRaw);

      const speechDelayMs = Math.round(Math.max(0, clippedTalkStart - windowStart) * 1000);
      // Outro: if it started before window, atrim source from the right offset
      const outroStartInMix = timings.outroStartMs / 1000;
      const outroStartInPreview = outroStartInMix - windowStart;
      let outroDelayMs;
      let outroSourceStart;
      let outroAdjustedFadeStart;
      let outroAdjustedFadeEnd;
      if (outroStartInPreview >= 0) {
        outroDelayMs = Math.round(outroStartInPreview * 1000);
        outroSourceStart = 0;
        outroAdjustedFadeStart = spec.outroFadeStart;
        outroAdjustedFadeEnd = spec.outroFadeEnd;
      } else {
        const outroSkipSec = -outroStartInPreview;
        outroDelayMs = 0;
        outroSourceStart = outroSkipSec;
        outroAdjustedFadeStart = Math.max(0, spec.outroFadeStart - outroSkipSec);
        outroAdjustedFadeEnd = Math.max(0.1, spec.outroFadeEnd - outroSkipSec);
      }

      // duckEnd: time (in outro source post-atrim timeline) when talk ends.
      // In source timeline, talk ends at safeOutroOverlap. After atrim by outroSourceStart, subtract.
      // Then add outroDelayMs/1000 because the volume filter is BEFORE adelay.
      // Actually `t` in the volume expression is the input frame time (post-atrim, pre-adelay) = source post-atrim time.
      const outroDuckEnd = Math.max(0, timings.safeOutroOverlap - outroSourceStart);

      filter = buildEndingPreviewFilter({
        speechDelayMs,
        outroDelayMs,
        outroSourceStart,
        outroDuckEnd,
        voiceLufs: spec.voiceLufs,
        outroMusicVolume: spec.outroMusicVolume,
        outroDuckLevel: spec.outroDuckLevel,
        outroFadeStart: outroAdjustedFadeStart,
        outroFadeEnd: outroAdjustedFadeEnd,
        talkTrimStart: adjustedTalkTrimStart,
        talkTrimEnd: adjustedTalkTrimEnd,
        segmentDurationSec,
      });
    }

      onStatus?.("プレビューを生成中...");
      await fs.exec([
        "-i", names.inputName,
        "-i", bgmName,
        "-filter_complex", filter,
        "-map", "[preview]",
        "-c:a", "libmp3lame",
        "-b:a", spec.mp3Bitrate,
        outputName,
      ]);

      const blob = await readMixOutput(fs, outputName);
      return { blob, durationSec: segmentDurationSec };
    } finally {
      await fs.cleanupFiles([names.inputName, bgmName, outputName]);
    }
  });
}

/**
 * Run the mix pipeline.
 * Reads input/intro/outro into the ffmpeg fs, computes timings, executes the filter,
 * and returns the produced mp3 as a Blob. Cleans up fs files on exit.
 * @param {MixSpec} spec
 * @returns {Promise<{ blob: Blob, filename: string }>}
 */
export async function runMix(spec) {
  validateMixSpec(spec);

  const names = deriveMixFileNames(spec);
  const { onStatus } = spec;

  onStatus?.("長さを解析中...");
  const speechDuration = await getMediaDurationSeconds(spec.input);
  const timings = computeMixTimings({ ...spec, speechDuration });

  const filter = buildFilter({
    speechDelayMs: timings.speechDelayMs,
    outroStartMs: timings.outroStartMs,
    introPad: spec.introPad,
    safeOutroOverlap: timings.safeOutroOverlap,
    voiceLufs: spec.voiceLufs,
    introMusicVolume: spec.introMusicVolume,
    outroMusicVolume: spec.outroMusicVolume,
    introDuckLevel: spec.introDuckLevel,
    outroDuckLevel: spec.outroDuckLevel,
    introFadeStart: spec.introFadeStart,
    introFadeEnd: spec.introFadeEnd,
    outroFadeStart: spec.outroFadeStart,
    outroFadeEnd: spec.outroFadeEnd,
    talkTrimStart: timings.safeTalkTrimStart,
    talkTrimEnd: timings.safeTalkTrimEnd,
  });

  return ffmpegRuntime.withLock(async (fs) => {
    try {
      onStatus?.("ファイルを書き込み中...");
      await writeMixInputs(fs, spec, names);

      onStatus?.("音声処理中...");
      await executeMixFilter(fs, {
        names,
        filter,
        totalDurationSec: timings.totalDurationSec,
        mp3Bitrate: spec.mp3Bitrate,
      });

      onStatus?.("書き出し中...");
      const blob = await readMixOutput(fs, names.outputName);
      return { blob, filename: names.outputName };
    } finally {
      await fs.cleanupFiles([names.inputName, names.introName, names.outroName, names.outputName]);
    }
  });
}

export async function getMediaDurationSeconds(source) {
  return await new Promise((resolve, reject) => {
    const media = document.createElement("audio");
    let objectUrl = null;

    const cleanup = () => {
      media.removeAttribute("src");
      media.load();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };

    media.preload = "metadata";
    media.addEventListener("loadedmetadata", () => {
      const duration = media.duration;
      cleanup();
      if (Number.isFinite(duration)) {
        resolve(duration);
      } else {
        reject(new Error("音源の長さを取得できませんでした。"));
      }
    }, { once: true });

    media.addEventListener("error", () => {
      cleanup();
      reject(new Error("音源の長さを取得できませんでした。"));
    }, { once: true });

    if (source instanceof File) {
      objectUrl = URL.createObjectURL(source);
      media.src = objectUrl;
    } else {
      media.src = source;
    }
  });
}
