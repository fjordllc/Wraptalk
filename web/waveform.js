// @ts-check

import { formatTime, parseNumberInput } from "./utils.js";

/**
 * @typedef {Object} WaveformController
 * @property {HTMLCanvasElement | null} canvas
 * @property {HTMLElement | null} [status]
 * @property {HTMLButtonElement | null} [zoomInButton]
 * @property {HTMLButtonElement | null} [zoomOutButton]
 * @property {HTMLElement | null} [zoomValue]
 * @property {number} zoomLevel
 * @property {AudioBuffer | null} audioBuffer
 * @property {number[] | null} peaks
 * @property {number} duration
 * @property {HTMLAudioElement | null} [audio]
 * @property {HTMLInputElement | null} [fadeStartInput]
 * @property {HTMLInputElement | null} [fadeEndInput]
 * @property {HTMLInputElement | null} [trimStartInput]
 * @property {HTMLInputElement | null} [trimEndInput]
 * @property {HTMLInputElement | null} [targetInput]
 * @property {boolean} [hasTargetHandle]
 * @property {string} [targetHandleColor]
 * @property {boolean} [hasTrimHandles]
 * @property {string} [trimStartColor]
 * @property {string} [trimEndColor]
 */

export const MIN_WAVEFORM_ZOOM = 1;
export const MAX_WAVEFORM_ZOOM = 48;
export const WAVEFORM_ZOOM_STEP = 0.5;

export function extractPeaks(audioBuffer, samples = 180) {
  const channel = audioBuffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(channel.length / samples));
  const peaks = [];

  for (let i = 0; i < samples; i += 1) {
    const start = i * blockSize;
    const end = Math.min(channel.length, start + blockSize);
    let max = 0;
    for (let j = start; j < end; j += 1) {
      const value = Math.abs(channel[j]);
      if (value > max) {
        max = value;
      }
    }
    peaks.push(max);
  }

  return peaks;
}

export function getWaveformZoom(controller) {
  return Math.max(MIN_WAVEFORM_ZOOM, controller.zoomLevel || MIN_WAVEFORM_ZOOM);
}

export function refreshWaveformZoomUI(controller) {
  const zoom = getWaveformZoom(controller);
  if (controller.zoomValue) {
    controller.zoomValue.textContent = `${zoom.toFixed(1)}x`;
  }
  if (controller.zoomOutButton) {
    controller.zoomOutButton.disabled = zoom <= MIN_WAVEFORM_ZOOM;
  }
  if (controller.zoomInButton) {
    controller.zoomInButton.disabled = zoom >= MAX_WAVEFORM_ZOOM;
  }
  if (controller.zoomPresets) {
    const presets = controller.zoomPresets.querySelectorAll(".c--zoom-preset");
    presets.forEach((btn) => {
      const target = Number(btn.dataset.zoom);
      btn.classList.toggle("is--active", Math.abs(target - zoom) < 0.05);
    });
  }
}

function applyZoom(controller, zoom) {
  controller.zoomLevel = Number(zoom.toFixed(1));
  refreshWaveformZoomUI(controller);
  resizeWaveformCanvas(controller);
  if (controller.audioBuffer) {
    controller.peaks = extractPeaks(controller.audioBuffer, Math.max(180, Math.round(controller.canvas.width / 3)));
  }
  drawWaveform(controller);
}

export function updateWaveformZoom(controller, direction) {
  const nextZoom = Math.max(
    MIN_WAVEFORM_ZOOM,
    Math.min(MAX_WAVEFORM_ZOOM, getWaveformZoom(controller) + (direction * WAVEFORM_ZOOM_STEP)),
  );
  applyZoom(controller, nextZoom);
}

export function setWaveformZoom(controller, zoom) {
  const clamped = Math.max(MIN_WAVEFORM_ZOOM, Math.min(MAX_WAVEFORM_ZOOM, zoom));
  applyZoom(controller, clamped);
}

const MAX_CANVAS_WIDTH = 30000;

const TICK_INTERVAL_CHOICES = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

function drawFocusHalo(ctx, x, y, w, h) {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(255, 255, 255, 0.6)";
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.roundRect(x - 2, y - 2, w + 4, h + 4, 5);
  ctx.stroke();
  ctx.restore();
}

function pickTickInterval(secondsPerPixel) {
  // Aim for one label every ~100 px to balance density and readability.
  const target = 100 * secondsPerPixel;
  for (const choice of TICK_INTERVAL_CHOICES) {
    if (choice >= target) {
      return choice;
    }
  }
  return TICK_INTERVAL_CHOICES[TICK_INTERVAL_CHOICES.length - 1];
}

function renderTimeAxis(controller, duration) {
  const scroller = controller.canvas?.closest(".js--waveform-scroll");
  if (!scroller) {
    return;
  }
  let axis = scroller.querySelector(".js--waveform-time-axis");
  if (!axis) {
    axis = document.createElement("div");
    axis.className = "c--waveform-time-axis js--waveform-time-axis";
    axis.setAttribute("aria-hidden", "true");
    scroller.appendChild(axis);
  }
  axis.replaceChildren();
  const width = parseFloat(controller.canvas.style.width || `${controller.canvas.width}`) || controller.canvas.width;
  axis.style.width = `${width}px`;
  if (!duration || duration <= 0) {
    return;
  }
  const secondsPerPixel = duration / width;
  const interval = pickTickInterval(secondsPerPixel);
  for (let t = 0; t <= duration; t += interval) {
    const x = (t / duration) * width;
    const tick = document.createElement("span");
    tick.className = "c--waveform-tick";
    tick.style.left = `${x}px`;
    tick.textContent = formatTime(t);
    axis.appendChild(tick);
  }
}

export function resizeWaveformCanvas(controller) {
  if (!controller.canvas) {
    return;
  }

  const scroller = controller.canvas.closest(".js--waveform-scroll");
  const baseWidth = Math.max(320, Math.round(scroller?.clientWidth || controller.canvas.clientWidth || 640));
  const zoom = getWaveformZoom(controller);
  const displayWidth = Math.min(MAX_CANVAS_WIDTH, Math.round(baseWidth * zoom));
  controller.canvas.width = displayWidth;
  controller.canvas.height = 88;
  controller.canvas.style.width = `${displayWidth}px`;
  controller.canvas.style.minWidth = `${displayWidth}px`;
}

export function drawWaveform(controller) {
  if (!controller.canvas) {
    return;
  }

  resizeWaveformCanvas(controller);

  const canvas = controller.canvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "rgba(30, 41, 59, 1)";
  ctx.fillRect(0, 0, width, height);

  const peaks = controller.peaks;
  if (!peaks?.length) {
    ctx.fillStyle = "rgba(109, 101, 95, 0.8)";
    ctx.font = "12px sans-serif";
    ctx.fillText("waveform unavailable", 16, height / 2 + 4);
    return;
  }

  const mid = height / 2;
  const barWidth = width / peaks.length;
  ctx.fillStyle = "rgba(203, 213, 225, 0.7)";

  peaks.forEach((peak, index) => {
    const barHeight = Math.max(2, peak * (height * 0.82));
    const x = index * barWidth;
    const y = mid - barHeight / 2;
    ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);
  });

  const duration = controller.duration || controller.audio?.duration || 0;
  const currentTime = controller.audio?.currentTime || 0;
  const fadeStart = controller.fadeStartInput ? Math.max(0, parseNumberInput(controller.fadeStartInput, 0)) : null;
  const fadeEnd = controller.fadeEndInput ? Math.max(0, parseNumberInput(controller.fadeEndInput, 0)) : null;

  if (duration > 0 && fadeStart !== null && fadeEnd !== null && fadeEnd > fadeStart) {
    const startX = Math.max(0, Math.min(width, (fadeStart / duration) * width));
    const endX = Math.max(0, Math.min(width, (fadeEnd / duration) * width));

    ctx.fillStyle = "rgba(34, 197, 94, 0.18)";
    ctx.fillRect(startX, 0, Math.max(0, endX - startX), height);

    ctx.strokeStyle = "rgba(74, 222, 128, 0.95)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(startX, 12);
    ctx.lineTo(endX, height - 12);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(74, 222, 128, 0.6)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, 0);
    ctx.lineTo(startX, height);
    ctx.moveTo(endX, 0);
    ctx.lineTo(endX, height);
    ctx.stroke();

    ctx.fillStyle = "rgba(34, 197, 94, 0.95)";
    ctx.beginPath();
    ctx.roundRect(startX - 7, height - 18, 14, 16, 4);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(endX - 7, height - 18, 14, 16, 4);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fillRect(startX - 1, height - 15, 2, 10);
    ctx.fillRect(endX - 1, height - 15, 2, 10);

    if (controller.focusedHandle === "fadeStart") {
      drawFocusHalo(ctx, startX - 7, height - 18, 14, 16);
    }
    if (controller.focusedHandle === "fadeEnd") {
      drawFocusHalo(ctx, endX - 7, height - 18, 14, 16);
    }
  }

  if (controller.hasTrimHandles && duration > 0 && controller.trimStartInput && controller.trimEndInput) {
    const trimStart = Math.max(0, parseNumberInput(controller.trimStartInput, 0));
    const trimEndRaw = parseNumberInput(controller.trimEndInput, 0);
    const trimEnd = trimEndRaw > 0 ? Math.min(trimEndRaw, duration) : duration;
    const trimStartX = Math.max(0, Math.min(width, (trimStart / duration) * width));
    const trimEndX = Math.max(0, Math.min(width, (trimEnd / duration) * width));

    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    if (trimStartX > 0) {
      ctx.fillRect(0, 0, trimStartX, height);
    }
    if (trimEndX < width) {
      ctx.fillRect(trimEndX, 0, width - trimEndX, height);
    }

    const trimStartColor = controller.trimStartColor;
    const trimEndColor = controller.trimEndColor;

    ctx.strokeStyle = `rgba(${trimStartColor}, 0.55)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(trimStartX, 0);
    ctx.lineTo(trimStartX, height);
    ctx.stroke();

    ctx.strokeStyle = `rgba(${trimEndColor}, 0.55)`;
    ctx.beginPath();
    ctx.moveTo(trimEndX, 0);
    ctx.lineTo(trimEndX, height);
    ctx.stroke();

    ctx.fillStyle = `rgba(${trimStartColor}, 0.95)`;
    ctx.beginPath();
    ctx.roundRect(trimStartX - 7, 2, 14, 16, 4);
    ctx.fill();

    ctx.fillStyle = `rgba(${trimEndColor}, 0.95)`;
    ctx.beginPath();
    ctx.roundRect(trimEndX - 7, 2, 14, 16, 4);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fillRect(trimStartX - 1, 5, 2, 10);
    ctx.fillRect(trimEndX - 1, 5, 2, 10);

    if (controller.focusedHandle === "trimStart") {
      drawFocusHalo(ctx, trimStartX - 7, 2, 14, 16);
    }
    if (controller.focusedHandle === "trimEnd") {
      drawFocusHalo(ctx, trimEndX - 7, 2, 14, 16);
    }
  }

  if (controller.hasTargetHandle && duration > 0 && controller.targetInput) {
    const targetTime = Math.max(0, parseNumberInput(controller.targetInput, 0));
    const targetX = Math.max(0, Math.min(width, (targetTime / duration) * width));

    const targetColor = controller.targetHandleColor;
    ctx.strokeStyle = `rgba(${targetColor}, 0.55)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(targetX, 0);
    ctx.lineTo(targetX, height);
    ctx.stroke();

    ctx.fillStyle = `rgba(${targetColor}, 0.95)`;
    ctx.beginPath();
    ctx.roundRect(targetX - 7, 2, 14, 16, 4);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fillRect(targetX - 1, 5, 2, 10);

    if (controller.focusedHandle === "target") {
      drawFocusHalo(ctx, targetX - 7, 2, 14, 16);
    }
  }

  if (duration > 0) {
    const progressX = Math.max(0, Math.min(width, (currentTime / duration) * width));
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.fillRect(progressX, 0, 2, height);
  }

  renderTimeAxis(controller, duration);
}

export function setWaveformStatus(controller, message = "", visible = false) {
  if (!controller.status) {
    return;
  }
  const isLoading = message.includes("解析中");
  controller.status.textContent = "";

  const textNode = document.createElement("span");
  textNode.textContent = message.replace(/\.\.\.$/, "");
  controller.status.appendChild(textNode);

  if (visible && isLoading) {
    const dots = document.createElement("span");
    dots.className = "c--waveform-status-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) {
      const dot = document.createElement("span");
      dot.className = "c--waveform-status-dot";
      dot.textContent = ".";
      dots.appendChild(dot);
    }
    controller.status.appendChild(dots);
  }

  controller.status.classList.toggle("is--visible", visible);
  controller.status.classList.toggle("is--loading", visible && isLoading);
}

export function getFadeHandlePositions(controller) {
  const duration = controller.duration || controller.audio?.duration || 0;
  if (!controller.canvas || !controller.fadeStartInput || !controller.fadeEndInput || duration <= 0) {
    return null;
  }

  const width = controller.canvas.width;
  const fadeStart = Math.max(0, parseNumberInput(controller.fadeStartInput, 0));
  const fadeEnd = Math.max(0, parseNumberInput(controller.fadeEndInput, 0));

  return {
    duration,
    startX: Math.max(0, Math.min(width, (fadeStart / duration) * width)),
    endX: Math.max(0, Math.min(width, (fadeEnd / duration) * width)),
  };
}

export function getFadeHandleHit(controller, event) {
  const positions = getFadeHandlePositions(controller);
  if (!positions || !controller.canvas) {
    return null;
  }

  const rect = controller.canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * controller.canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * controller.canvas.height;
  if (y < controller.canvas.height - 22) {
    return null;
  }

  if (Math.abs(x - positions.startX) <= 10) {
    return "start";
  }
  if (Math.abs(x - positions.endX) <= 10) {
    return "end";
  }
  return null;
}

export function getTargetHandlePosition(controller) {
  const duration = controller.duration || controller.audio?.duration || 0;
  if (!controller.canvas || !controller.targetInput || !controller.hasTargetHandle || duration <= 0) {
    return null;
  }

  const width = controller.canvas.width;
  const time = Math.max(0, parseNumberInput(controller.targetInput, 0));
  return {
    duration,
    x: Math.max(0, Math.min(width, (time / duration) * width)),
  };
}

export function getTargetHandleHit(controller, event) {
  const position = getTargetHandlePosition(controller);
  if (!position || !controller.canvas) {
    return false;
  }

  const rect = controller.canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * controller.canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * controller.canvas.height;
  if (y > 22) {
    return false;
  }
  return Math.abs(x - position.x) <= 10;
}

export function getTrimHandlePositions(controller) {
  const duration = controller.duration || controller.audio?.duration || 0;
  if (!controller.canvas || !controller.trimStartInput || !controller.trimEndInput || !controller.hasTrimHandles || duration <= 0) {
    return null;
  }

  const width = controller.canvas.width;
  const trimStart = Math.max(0, parseNumberInput(controller.trimStartInput, 0));
  const trimEndRaw = parseNumberInput(controller.trimEndInput, 0);
  const trimEnd = trimEndRaw > 0 ? Math.min(trimEndRaw, duration) : duration;
  return {
    duration,
    startX: Math.max(0, Math.min(width, (trimStart / duration) * width)),
    endX: Math.max(0, Math.min(width, (trimEnd / duration) * width)),
  };
}

export function getTrimHandleHit(controller, event) {
  const positions = getTrimHandlePositions(controller);
  if (!positions || !controller.canvas) {
    return null;
  }

  const rect = controller.canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * controller.canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * controller.canvas.height;
  if (y > 22) {
    return null;
  }

  const startDist = Math.abs(x - positions.startX);
  const endDist = Math.abs(x - positions.endX);
  if (startDist <= 10 && startDist <= endDist) {
    return "start";
  }
  if (endDist <= 10) {
    return "end";
  }
  return null;
}

export function updateCanvasCursor(controller, event) {
  if (!controller.canvas) {
    return;
  }
  const duration = controller.duration || controller.audio?.duration || 0;
  if (duration <= 0) {
    controller.canvas.style.cursor = "default";
    return;
  }
  if (
    getFadeHandleHit(controller, event) ||
    getTargetHandleHit(controller, event) ||
    getTrimHandleHit(controller, event)
  ) {
    controller.canvas.style.cursor = "ew-resize";
  } else {
    controller.canvas.style.cursor = "pointer";
  }
}
