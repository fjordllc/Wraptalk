// @ts-check

import { clamp01, formatTime, parseNumberInput } from "./utils.js";
import {
  MIN_WAVEFORM_ZOOM,
  drawWaveform,
  extractPeaks,
  getFadeHandleHit,
  getFadeHandlePositions,
  getTargetHandleHit,
  getTargetHandlePosition,
  getTrimHandleHit,
  getTrimHandlePositions,
  refreshWaveformZoomUI,
  resizeWaveformCanvas,
  setWaveformStatus,
  setWaveformZoom,
  updateCanvasCursor,
  updateWaveformZoom,
} from "./waveform.js";
import { loadAudioBuffer } from "./waveform-loader.js";

let logger = (message) => console.warn(message);

export function setPreviewLogger(fn) {
  if (typeof fn === "function") {
    logger = fn;
  }
}

function logFromError(error) {
  logger(error instanceof Error ? error.message : String(error));
}

class PreviewSession {
  #audio = null;
  #button = null;
  #controller = null;
  #token = 0;

  get activeController() {
    return this.#controller;
  }

  nextToken() {
    this.#token += 1;
    return this.#token;
  }

  currentToken() {
    return this.#token;
  }

  isPlayingOn(button) {
    return this.#button === button && this.#audio !== null && !this.#audio.paused;
  }

  isActiveAudio(audio) {
    return this.#audio === audio;
  }

  activate(controller, audio) {
    this.#audio = audio;
    this.#button = controller.button;
    this.#controller = controller;
    controller.button.classList.add("is--playing");
    controller.button.textContent = "■ 停止";
  }

  stop() {
    if (this.#audio) {
      this.#audio.pause();
      this.#audio = null;
    }
    if (this.#button) {
      this.#button.classList.remove("is--playing");
      this.#button.textContent = "▶ 試聴";
      this.#button = null;
    }
    if (this.#controller) {
      this.#controller.updateUI();
      this.#controller = null;
    }
  }
}

export const previewSession = new PreviewSession();

function resolvePreviewSource(input, fallbackUrl) {
  const file = input.files?.[0];
  if (file) {
    return { url: URL.createObjectURL(file), revoke: true };
  }
  return { url: fallbackUrl, revoke: false };
}

export function getFadeMultiplier(time, fadeStart, fadeEnd) {
  if (time < fadeStart) {
    return 1;
  }
  if (fadeEnd <= fadeStart) {
    return 0;
  }
  if (time >= fadeEnd) {
    return 0;
  }
  return (fadeEnd - time) / (fadeEnd - fadeStart);
}

export class PreviewController {
  constructor(config = {}) {
    const source = config.source ?? {};
    const preview = config.preview ?? {};
    const waveform = config.waveform ?? {};
    const music = config.music ?? {};
    const fade = config.fade ?? {};
    const target = config.target ?? {};
    const trim = config.trim ?? {};

    this.input = source.input ?? null;
    this.fallbackUrl = source.fallbackUrl ?? "";

    this.button = preview.button ?? null;
    this.seek = preview.seek ?? null;
    this.time = preview.time ?? null;
    this.jumps = (preview.jumps ?? []).map((jump) => ({
      button: jump.button ?? null,
      sourceInput: jump.sourceInput ?? null,
      fixedTarget: typeof jump.target === "number" ? jump.target : null,
      endTarget: jump.target === "end",
    }));

    this.canvas = waveform.canvas ?? null;
    this.status = waveform.status ?? null;
    this.zoomInButton = waveform.zoomInButton ?? null;
    this.zoomOutButton = waveform.zoomOutButton ?? null;
    this.zoomValue = waveform.zoomValue ?? null;
    this.zoomPresets = waveform.zoomPresets ?? null;

    this.musicVolumeInput = music.volumeInput ?? null;

    this.fadeStartInput = fade.startInput ?? null;
    this.fadeEndInput = fade.endInput ?? null;
    this.fadeStartSetButton = fade.startSetButton ?? null;
    this.fadeEndSetButton = fade.endSetButton ?? null;

    this.targetInput = target.input ?? null;
    this.setButton = target.setButton ?? null;
    this.hasTargetHandle = Boolean(target.enabled);
    this.targetHandleColor = target.color ?? "251, 191, 36";

    this.trimStartInput = trim.startInput ?? null;
    this.trimEndInput = trim.endInput ?? null;
    this.trimStartSetButton = trim.startSetButton ?? null;
    this.trimEndSetButton = trim.endSetButton ?? null;
    this.hasTrimHandles = Boolean(trim.enabled);
    this.trimStartColor = trim.startColor ?? "251, 191, 36";
    this.trimEndColor = trim.endColor ?? "244, 63, 94";

    this.audio = null;
    this.objectUrl = null;
    this.peaks = null;
    this.audioBuffer = null;
    this.duration = 0;
    this.zoomLevel = MIN_WAVEFORM_ZOOM;
    this.waveformToken = 0;
  }

  applyVolume() {
    if (!this.audio) {
      return;
    }
    const baseVolume = clamp01(parseNumberInput(this.musicVolumeInput, 0.22));
    if (!this.fadeStartInput || !this.fadeEndInput) {
      this.audio.volume = baseVolume;
      return;
    }
    const fadeStart = Math.max(0, parseNumberInput(this.fadeStartInput, 0));
    const fadeEnd = Math.max(0, parseNumberInput(this.fadeEndInput, fadeStart));
    const fadeMultiplier = getFadeMultiplier(this.audio.currentTime || 0, fadeStart, fadeEnd);
    this.audio.volume = clamp01(baseVolume * fadeMultiplier);
  }

  updateUI() {
    if (!this.seek || !this.time) {
      return;
    }
    const duration = Number.isFinite(this.audio?.duration) && this.audio.duration > 0
      ? this.audio.duration
      : this.duration;
    const currentTime = Number.isFinite(this.audio?.currentTime)
      ? this.audio.currentTime
      : parseNumberInput(this.seek, 0);
    this.seek.max = String(duration || 0);
    this.seek.value = String(Math.min(currentTime, duration || 0));
    this.time.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    if (this.setButton) {
      this.setButton.disabled = !(duration > 0);
    }
    this.applyVolume();
    drawWaveform(this);
  }

  refreshAvailability() {
    if (!this.button) {
      return;
    }
    const hasFile = this.input?.files && this.input.files.length > 0;
    const hasFallback = Boolean(this.fallbackUrl);
    const available = hasFile || hasFallback;
    this.button.disabled = !available;
    this.#refreshJumpButtons(available);
  }

  #jumpTarget(jump) {
    if (jump.endTarget) {
      return this.audio?.duration || this.duration || 0;
    }
    if (jump.fixedTarget !== null) {
      return jump.fixedTarget;
    }
    return Math.max(0, parseNumberInput(jump.sourceInput, 0));
  }

  #refreshJumpButtons(available) {
    for (const jump of this.jumps) {
      if (!jump.button) {
        continue;
      }
      if (jump.fixedTarget !== null || jump.endTarget) {
        jump.button.disabled = !available;
      } else {
        const target = this.#jumpTarget(jump);
        jump.button.disabled = !available || target <= 0;
      }
    }
  }

  async #seekToJump(jump) {
    const ready = await this.ensureReady();
    if (!ready || !this.audio) {
      return;
    }
    const target = this.#jumpTarget(jump);
    const duration = this.audio.duration || this.duration || 0;
    this.audio.currentTime = Math.max(0, Math.min(duration, target));
    this.updateUI();
  }

  seekFromPointer(event) {
    if (!this.canvas || !this.audio) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const duration = this.audio.duration || this.duration || 0;
    this.audio.currentTime = ratio * duration;
    this.updateUI();
  }

  async prepare() {
    const token = previewSession.nextToken();

    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }

    const { url, revoke } = resolvePreviewSource(this.input, this.fallbackUrl);
    const audio = new Audio(url);
    this.audio = audio;
    this.objectUrl = revoke ? url : null;

    audio.addEventListener("timeupdate", () => {
      if (this.audio === audio) {
        this.updateUI();
      }
    });

    audio.addEventListener("loadedmetadata", () => {
      if (this.audio === audio) {
        this.updateUI();
      }
    });

    await new Promise((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("プレビュー音源を読み込めませんでした。"));
      };
      const cleanup = () => {
        audio.removeEventListener("loadedmetadata", onLoaded);
        audio.removeEventListener("error", onError);
      };
      audio.addEventListener("loadedmetadata", onLoaded);
      audio.addEventListener("error", onError);
    });

    if (token !== previewSession.currentToken()) {
      return;
    }

    this.updateUI();
  }

  async ensureReady() {
    if (this.audio) {
      return true;
    }
    try {
      await this.prepare();
      return true;
    } catch (error) {
      logFromError(error);
      return false;
    }
  }

  async toggle() {
    if (!this.button) {
      return;
    }

    if (previewSession.isPlayingOn(this.button)) {
      previewSession.stop();
      return;
    }

    previewSession.stop();

    if (!this.audio) {
      try {
        await this.prepare();
      } catch (error) {
        logFromError(error);
        return;
      }
    }

    const audio = this.audio;
    previewSession.activate(this, audio);
    this.updateUI();

    const handleEnded = () => {
      if (previewSession.isActiveAudio(audio)) {
        previewSession.stop();
      }
      audio.currentTime = 0;
      this.updateUI();
    };
    const handleError = () => {
      if (this.objectUrl) {
        URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
      }
      this.audio = null;
      if (previewSession.isActiveAudio(audio)) {
        previewSession.stop();
      }
    };

    audio.addEventListener("ended", handleEnded, { once: true });
    audio.addEventListener("error", handleError, { once: true });

    try {
      await audio.play();
    } catch (error) {
      handleError();
      logFromError(error);
    }
  }

  #applyHandleDrag(getPositions, event, apply) {
    const positions = getPositions(this);
    if (!positions || !this.canvas) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const time = ratio * positions.duration;
    apply(time, positions);
    this.updateUI();
  }

  updateFadeFromPointer(handleType, event) {
    this.#applyHandleDrag(getFadeHandlePositions, event, (time) => {
      const startValue = Math.max(0, parseNumberInput(this.fadeStartInput, 0));
      const endValue = Math.max(0, parseNumberInput(this.fadeEndInput, startValue));
      if (handleType === "start") {
        this.fadeStartInput.value = Math.min(time, endValue).toFixed(1);
      } else if (handleType === "end") {
        this.fadeEndInput.value = Math.max(time, startValue).toFixed(1);
      }
    });
  }

  updateTargetFromPointer(event) {
    this.#applyHandleDrag(getTargetHandlePosition, event, (time) => {
      this.targetInput.value = time.toFixed(1);
    });
  }

  updateTrimFromPointer(handleType, event) {
    this.#applyHandleDrag(getTrimHandlePositions, event, (time, positions) => {
      const trimStartValue = Math.max(0, parseNumberInput(this.trimStartInput, 0));
      const trimEndRaw = parseNumberInput(this.trimEndInput, 0);
      const trimEndValue = trimEndRaw > 0 ? Math.min(trimEndRaw, positions.duration) : positions.duration;
      if (handleType === "start") {
        this.trimStartInput.value = Math.min(time, trimEndValue).toFixed(1);
      } else if (handleType === "end") {
        this.trimEndInput.value = Math.max(time, trimStartValue).toFixed(1);
      }
    });
  }

  handleResize() {
    resizeWaveformCanvas(this);
    if (this.audioBuffer) {
      this.peaks = extractPeaks(this.audioBuffer, Math.max(180, Math.round(this.canvas.width / 3)));
    }
    drawWaveform(this);
  }

  start({ onLogError } = {}) {
    const logErr = onLogError ?? ((message) => console.warn(message));
    refreshWaveformZoomUI(this);
    this.renderWaveform();
    this.refreshAvailability();
    this.#bindEvents(logErr);
  }

  #bindEvents(logErr) {
    this.button?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await this.toggle();
    });

    this.seek?.addEventListener("input", async (event) => {
      event.stopPropagation();
      if (!this.audio) {
        try {
          await this.prepare();
        } catch (error) {
          logErr(error instanceof Error ? error.message : String(error));
          return;
        }
      }
      this.audio.currentTime = Number.parseFloat(this.seek.value) || 0;
      this.updateUI();
    });

    this.setButton?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!this.audio) {
        try {
          await this.prepare();
        } catch (error) {
          logErr(error instanceof Error ? error.message : String(error));
          return;
        }
      }
      this.targetInput.value = (this.audio.currentTime || 0).toFixed(1);
      this.updateUI();
    });

    for (const [button, targetInput] of [
      [this.fadeStartSetButton, this.fadeStartInput],
      [this.fadeEndSetButton, this.fadeEndInput],
      [this.trimStartSetButton, this.trimStartInput],
      [this.trimEndSetButton, this.trimEndInput],
    ]) {
      button?.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!this.audio) {
          const ready = await this.ensureReady();
          if (!ready) {
            return;
          }
        }
        targetInput.value = (this.audio.currentTime || 0).toFixed(1);
        this.updateUI();
      });
    }

    this.input?.addEventListener("change", () => {
      this.handleSourceChange();
    });

    this.zoomOutButton?.addEventListener("click", () => {
      updateWaveformZoom(this, -1);
    });

    this.zoomInButton?.addEventListener("click", () => {
      updateWaveformZoom(this, 1);
    });

    this.zoomPresets?.addEventListener("click", (event) => {
      const button = event.target.closest(".c--zoom-preset");
      if (!button || !this.zoomPresets.contains(button)) {
        return;
      }
      const zoom = Number(button.dataset.zoom);
      if (Number.isFinite(zoom)) {
        setWaveformZoom(this, zoom);
      }
    });

    const sourceInputs = new Set();
    for (const jump of this.jumps) {
      jump.button?.addEventListener("click", () => {
        this.#seekToJump(jump);
      });
      if (jump.sourceInput) {
        sourceInputs.add(jump.sourceInput);
      }
    }
    for (const input of sourceInputs) {
      input.addEventListener("input", () => {
        this.#refreshJumpButtons(!this.button?.disabled);
      });
    }

    if (this.canvas && this.button) {
      this.#bindCanvasPointers();
    }
  }

  #bindCanvasPointers() {
    let isDraggingWaveform = false;
    let activeFadeHandle = null;
    let isDraggingTarget = false;
    let activeTrimHandle = null;

    this.canvas.addEventListener("pointerdown", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ready = await this.ensureReady();
      if (!ready) {
        return;
      }
      activeFadeHandle = getFadeHandleHit(this, event);
      isDraggingTarget = !activeFadeHandle && getTargetHandleHit(this, event);
      activeTrimHandle = !activeFadeHandle && !isDraggingTarget ? getTrimHandleHit(this, event) : null;
      isDraggingWaveform = !activeFadeHandle && !isDraggingTarget && !activeTrimHandle;
      this.canvas.setPointerCapture(event.pointerId);
      if (activeFadeHandle) {
        this.updateFadeFromPointer(activeFadeHandle, event);
      } else if (isDraggingTarget) {
        this.updateTargetFromPointer(event);
      } else if (activeTrimHandle) {
        this.updateTrimFromPointer(activeTrimHandle, event);
      } else {
        this.seekFromPointer(event);
      }
    });

    this.canvas.addEventListener("pointermove", (event) => {
      if (activeFadeHandle) {
        this.updateFadeFromPointer(activeFadeHandle, event);
        return;
      }
      if (isDraggingTarget) {
        this.updateTargetFromPointer(event);
        return;
      }
      if (activeTrimHandle) {
        this.updateTrimFromPointer(activeTrimHandle, event);
        return;
      }
      if (isDraggingWaveform) {
        this.seekFromPointer(event);
        return;
      }
      updateCanvasCursor(this, event);
    });

    this.canvas.addEventListener("pointerleave", () => {
      if (!isDraggingWaveform && !activeFadeHandle && !isDraggingTarget && !activeTrimHandle) {
        this.canvas.style.cursor = "";
      }
    });

    const stopDragging = (event) => {
      if (!isDraggingWaveform && !activeFadeHandle && !isDraggingTarget && !activeTrimHandle) {
        return;
      }
      isDraggingWaveform = false;
      activeFadeHandle = null;
      isDraggingTarget = false;
      activeTrimHandle = null;
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    };

    this.canvas.addEventListener("pointerup", stopDragging);
    this.canvas.addEventListener("pointercancel", stopDragging);
  }

  handleSourceChange() {
    if (previewSession.activeController === this) {
      previewSession.stop();
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.audio = null;
    this.audioBuffer = null;
    this.peaks = null;
    this.duration = 0;
    this.refreshAvailability();
    drawWaveform(this);
    this.renderWaveform();
  }

  async renderWaveform() {
    if (!this.canvas) {
      return;
    }

    if (!this.input.files?.[0] && !this.fallbackUrl) {
      this.peaks = null;
      this.duration = 0;
      setWaveformStatus(this, "音源を選択すると波形を表示します", true);
      drawWaveform(this);
      return;
    }

    const token = ++this.waveformToken;
    setWaveformStatus(this, "波形を解析中...", true);

    try {
      const audioBuffer = await loadAudioBuffer(this.input, this.fallbackUrl);
      if (token !== this.waveformToken) {
        // A newer renderWaveform() call has started; discard this stale result.
        return;
      }
      this.audioBuffer = audioBuffer;
      this.peaks = extractPeaks(audioBuffer, Math.max(180, Math.round(this.canvas.width / 3)));
      this.duration = audioBuffer.duration;
      setWaveformStatus(this, "", false);
    } catch (error) {
      if (token !== this.waveformToken) {
        return;
      }
      this.audioBuffer = null;
      this.peaks = null;
      this.duration = 0;
      setWaveformStatus(this, "波形を表示できませんでした", true);
      logFromError(error);
    }

    this.updateUI();
    drawWaveform(this);
  }
}

export function createPreviewController(config) {
  return new PreviewController(config);
}
