// @ts-check

import {
  DEFAULT_INTRO_NAME,
  DEFAULT_INTRO_URL,
  DEFAULT_OUTRO_NAME,
  DEFAULT_OUTRO_URL,
  ffmpegRuntime,
  renderMixPreview,
  runMix,
} from "./mix.js";
import {
  parseNumberInput,
  parseOptionalNumber,
  parseRequiredNumber,
} from "./utils.js";
import {
  PreviewController,
  setPreviewLogger,
} from "./preview.js";
import {
  actionModal,
  actionModalClose,
  voiceLufsInfoButton,
  voiceLufsInfoModal,
  voiceLufsInfoModalClose,
  introDuckingInfoButton,
  outroDuckingInfoButton,
  duckingInfoModal,
  duckingInfoModalClose,
  introPadInfoButton,
  introPadInfoModal,
  introPadInfoModalClose,
  outroOverlapInfoButton,
  outroOverlapInfoModal,
  outroOverlapInfoModalClose,
  talkTrimInfoButton,
  talkTrimInfoModal,
  talkTrimInfoModalClose,
  mp3BitrateInfoButton,
  mp3BitrateInfoModal,
  mp3BitrateInfoModalClose,
  inputFile,
  inputMeta,
  inputJumpEndButton,
  inputJumpStartButton,
  inputJumpTrimEndButton,
  inputJumpTrimStartButton,
  introJumpFadeStartButton,
  introJumpStartButton,
  introJumpTargetButton,
  outroJumpFadeStartButton,
  outroJumpStartButton,
  outroJumpTargetButton,
  inputPreviewButton,
  inputPreviewSeek,
  inputPreviewTime,
  inputSelectButton,
  inputWaveform,
  inputWaveformStatus,
  inputWaveformZoomIn,
  inputWaveformZoomOut,
  inputWaveformZoomValue,
  inputWaveformZoomPresets,
  introFadeEndInput,
  introFadeEndSetButton,
  introFadeStartInput,
  introFadeStartSetButton,
  introFile,
  introMeta,
  introDuckLevelInput,
  introMusicVolumeInput,
  introPadInput,
  introPadSetButton,
  introPreviewButton,
  introPreviewSeek,
  introPreviewTime,
  introSelectButton,
  introWaveform,
  introWaveformStatus,
  introWaveformZoomIn,
  introWaveformZoomOut,
  introWaveformZoomValue,
  introWaveformZoomPresets,
  loadButton,
  logBox,
  logToggle,
  meterBar,
  mixPreviewBlock,
  mixPreviewEnding,
  mixPreviewEndingClip,
  mixPreviewOpening,
  mixPreviewOpeningClip,
  getMp3Bitrate,
  outroFadeEndInput,
  outroFadeEndSetButton,
  outroFadeStartInput,
  outroFadeStartSetButton,
  outroFile,
  outroMeta,
  outroDuckLevelInput,
  outroMusicVolumeInput,
  outroOverlapInput,
  outroOverlapSetButton,
  outroPreviewButton,
  outroPreviewSeek,
  outroPreviewTime,
  outroSelectButton,
  outroWaveform,
  outroWaveformStatus,
  outroWaveformZoomIn,
  outroWaveformZoomOut,
  outroWaveformZoomValue,
  outroWaveformZoomPresets,
  previewEndingButton,
  previewOpeningButton,
  processButton,
  statusBlock,
  statusText,
  talkTrimEndInput,
  talkTrimEndSetButton,
  talkTrimStartInput,
  talkTrimStartSetButton,
  voiceLufsInput,
} from "./dom.js";

ffmpegRuntime.configure({ onLog: appendLog, onProgress: setProgress });

function setStatus(message) {
  const match = message.match(/^(.*?)(\.{3,})$/);
  if (match) {
    statusText.replaceChildren();
    statusText.append(match[1]);
    const ellipsis = document.createElement("span");
    ellipsis.className = "c--ellipsis";
    for (let i = 0; i < 3; i += 1) {
      const dot = document.createElement("span");
      dot.textContent = ".";
      ellipsis.append(dot);
    }
    statusText.append(ellipsis);
  } else {
    statusText.textContent = message;
  }
}

logToggle?.addEventListener("click", () => {
  const hidden = logBox.classList.toggle("is--hidden");
  logToggle.setAttribute("aria-expanded", hidden ? "false" : "true");
  logToggle.textContent = hidden ? "ログを見る ▼" : "ログを隠す ▲";
});

function setProgress(progress) {
  const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
  meterBar.style.width = `${percent}%`;
}

function appendLog(message) {
  logBox.textContent += `${message}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

function resetLog() {
  logBox.textContent = "";
}

setPreviewLogger(appendLog);

function updateFileCardState(input, meta, { emptyText, defaultText, selectLabel, changeLabel, button }) {
  if (!input) {
    return;
  }

  const card = document.querySelector(`[data-file-card="${input.id}"]`);
  if (!card) {
    return;
  }

  const file = input.files?.[0];
  card.classList.toggle("is--selected", Boolean(file));
  card.classList.toggle("is--default", !file && Boolean(defaultText));
  if (meta) {
    if (file) {
      meta.textContent = `${file.name} を使用中`;
    } else if (defaultText) {
      meta.textContent = defaultText;
    } else if (emptyText) {
      meta.textContent = emptyText;
    } else {
      meta.textContent = "";
    }
  }
  if (button) {
    const hasSource = Boolean(file || defaultText);
    button.textContent = hasSource ? changeLabel : selectLabel;
    button.classList.toggle("is--empty", !hasSource);
  }
}

function requireFile(input, label) {
  const file = input.files?.[0];
  if (!file) {
    throw new Error(`${label} を選択してください。`);
  }
  return file;
}

async function resolveAudioInput(input, fallbackUrl, fallbackName, label) {
  const file = input.files?.[0];
  if (file) {
    return { source: file, name: file.name, usingDefault: false };
  }

  const response = await fetch(fallbackUrl);
  if (!response.ok) {
    throw new Error(`${label} のデフォルト音源 ${fallbackName} を読み込めませんでした。`);
  }

  return { source: fallbackUrl, name: fallbackName, usingDefault: true };
}

async function handleLoadFFmpeg() {
  if (ffmpegRuntime.isLoaded()) {
    return;
  }
  statusBlock.classList.add("is--visible");
  setStatus("ffmpeg.wasm を読み込み中...");
  resetLog();
  setProgress(0);
  await ffmpegRuntime.ensureLoaded();
  processButton.disabled = false;
  previewOpeningButton.disabled = false;
  previewEndingButton.disabled = false;
  setStatus("準備完了");
}

function clampRange(value, min, max, label) {
  if (value < min || value > max) {
    throw new Error(`${label}は ${min}〜${max} の範囲で入力してください (現在: ${value})`);
  }
  return value;
}

async function readMixSpec() {
  const input = requireFile(inputFile, "トーク音源");
  const intro = await resolveAudioInput(introFile, DEFAULT_INTRO_URL, DEFAULT_INTRO_NAME, "イントロ音源");
  const outro = await resolveAudioInput(outroFile, DEFAULT_OUTRO_URL, DEFAULT_OUTRO_NAME, "アウトロ音源");
  return {
    input,
    intro,
    outro,
    introPad: clampRange(parseRequiredNumber(introPadInput.value, "イントロの開始位置"), 0, 600, "イントロの開始位置"),
    outroOverlap: clampRange(parseRequiredNumber(outroOverlapInput.value, "アウトロの開始位置"), 0, 600, "アウトロの開始位置"),
    voiceLufs: clampRange(parseRequiredNumber(voiceLufsInput.value, "話し声の目標LUFS"), -40, -8, "話し声の目標LUFS"),
    introMusicVolume: clampRange(parseRequiredNumber(introMusicVolumeInput.value, "イントロの基本音量"), 0, 1, "イントロの基本音量"),
    outroMusicVolume: clampRange(parseRequiredNumber(outroMusicVolumeInput.value, "アウトロの基本音量"), 0, 1, "アウトロの基本音量"),
    introDuckLevel: clampRange(parseRequiredNumber(introDuckLevelInput.value, "イントロのトーク中音量"), 0, 100, "イントロのトーク中音量") / 100,
    outroDuckLevel: clampRange(parseRequiredNumber(outroDuckLevelInput.value, "アウトロのトーク中音量"), 0, 100, "アウトロのトーク中音量") / 100,
    introFadeStart: Math.max(0, parseRequiredNumber(introFadeStartInput.value, "イントロのフェード開始")),
    introFadeEnd: Math.max(0, parseRequiredNumber(introFadeEndInput.value, "イントロのフェード終了")),
    outroFadeStart: Math.max(0, parseRequiredNumber(outroFadeStartInput.value, "アウトロのフェード開始")),
    outroFadeEnd: Math.max(0, parseRequiredNumber(outroFadeEndInput.value, "アウトロのフェード終了")),
    talkTrimStart: Math.max(0, parseOptionalNumber(talkTrimStartInput.value, 0)),
    talkTrimEndRaw: Math.max(0, parseOptionalNumber(talkTrimEndInput.value, 0)),
    mp3Bitrate: getMp3Bitrate(),
  };
}

async function processAudio() {
  if (!ffmpegRuntime.isLoaded()) {
    throw new Error("先に ffmpeg.wasm を読み込んでください。");
  }

  const spec = await readMixSpec();
  statusBlock.classList.add("is--visible");
  setProgress(0);
  resetLog();

  const { blob, filename } = await runMix({ ...spec, onStatus: setStatus });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);

  setProgress(1);
  setStatus("完了");
}

const previewClipTargets = {
  opening: { audio: mixPreviewOpening, wrapper: mixPreviewOpeningClip },
  ending: { audio: mixPreviewEnding, wrapper: mixPreviewEndingClip },
};

/**
 * @param {"opening" | "ending"} kind
 */
async function processMixPreview(kind) {
  if (!ffmpegRuntime.isLoaded()) {
    throw new Error("先に ffmpeg.wasm を読み込んでください。");
  }

  const spec = await readMixSpec();
  statusBlock.classList.add("is--visible");
  setProgress(0);
  resetLog();

  const { blob } = await renderMixPreview({ ...spec, onStatus: setStatus }, kind);

  const target = previewClipTargets[kind];
  if (target?.audio) {
    if (target.audio.src) {
      URL.revokeObjectURL(target.audio.src);
    }
    target.audio.src = URL.createObjectURL(blob);
    target.wrapper?.classList.add("is--visible");
  }
  mixPreviewBlock.classList.add("is--visible");

  setProgress(1);
  setStatus(kind === "opening" ? "オープニングのプレビューが準備できました" : "エンディングのプレビューが準備できました");
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const modalFocusReturn = new WeakMap();

function getFocusableElements(modal) {
  return Array.from(modal.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null,
  );
}

function trapFocus(modal, event) {
  if (event.key !== "Tab") {
    return;
  }
  const focusable = getFocusableElements(modal);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (!modal.contains(active)) {
    event.preventDefault();
    first.focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function openModal(modal) {
  modalFocusReturn.set(modal, document.activeElement instanceof HTMLElement ? document.activeElement : null);
  modal.classList.add("is--open");
  modal.setAttribute("aria-hidden", "false");
  // Move initial focus inside the modal so keyboard / screen reader users land inside it.
  const focusable = getFocusableElements(modal);
  const initial = focusable.find((el) => !el.classList.contains("c--modal-close")) ?? focusable[0];
  initial?.focus();
}

function closeModal(modal) {
  modal.classList.remove("is--open");
  modal.setAttribute("aria-hidden", "true");
  const returnTo = modalFocusReturn.get(modal);
  modalFocusReturn.delete(modal);
  returnTo?.focus?.();
}

function openActionModal() {
  openModal(actionModal);
}

function closeActionModal() {
  closeModal(actionModal);
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") {
    return;
  }
  const openInfo = infoModalEntries.find((entry) => entry.modal?.classList.contains("is--open"));
  if (openInfo) {
    trapFocus(openInfo.modal, event);
  } else if (actionModal.classList.contains("is--open")) {
    trapFocus(actionModal, event);
  }
});

function isNetworkLikeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch|network|failed to load|err_internet|err_network/i.test(message);
}

loadButton.addEventListener("click", async () => {
  openActionModal();
  if (ffmpegRuntime.isLoaded()) {
    return;
  }
  loadButton.disabled = true;
  try {
    await handleLoadFFmpeg();
  } catch (error) {
    if (isNetworkLikeError(error)) {
      setStatus("ffmpeg の読み込みに失敗しました（ネットワークまたは CDN 障害の可能性）");
      appendLog("通信エラー: ffmpeg-core を jsDelivr CDN から取得できませんでした。ネットワーク接続を確認するか、しばらく時間を置いて再度お試しください。");
    } else {
      setStatus("初期化失敗");
    }
    appendLog(String(error));
  } finally {
    loadButton.disabled = !inputFile.files?.length;
  }
});

actionModalClose.addEventListener("click", closeActionModal);
actionModal.addEventListener("click", (event) => {
  if (event.target instanceof HTMLElement && event.target.dataset.modalClose === "true") {
    closeActionModal();
  }
});

const infoModalEntries = [
  { triggers: [voiceLufsInfoButton], modal: voiceLufsInfoModal, close: voiceLufsInfoModalClose },
  { triggers: [introDuckingInfoButton, outroDuckingInfoButton], modal: duckingInfoModal, close: duckingInfoModalClose },
  { triggers: [introPadInfoButton], modal: introPadInfoModal, close: introPadInfoModalClose },
  { triggers: [outroOverlapInfoButton], modal: outroOverlapInfoModal, close: outroOverlapInfoModalClose },
  { triggers: [talkTrimInfoButton], modal: talkTrimInfoModal, close: talkTrimInfoModalClose },
  { triggers: [mp3BitrateInfoButton], modal: mp3BitrateInfoModal, close: mp3BitrateInfoModalClose },
];

for (const entry of infoModalEntries) {
  for (const trigger of entry.triggers) {
    trigger?.addEventListener("click", () => openModal(entry.modal));
  }
  entry.close?.addEventListener("click", () => closeModal(entry.modal));
  entry.modal?.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.modalClose === "true") {
      closeModal(entry.modal);
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }
  const openInfo = infoModalEntries.find((entry) => entry.modal?.classList.contains("is--open"));
  if (openInfo) {
    closeModal(openInfo.modal);
  } else if (actionModal?.classList.contains("is--open")) {
    closeActionModal();
  }
});

inputFile?.addEventListener("change", () => {
  if (!ffmpegRuntime.isLoaded()) {
    loadButton.disabled = !inputFile.files?.length;
  }
});

const fileCardConfigs = [
  [inputFile, inputMeta, {
    emptyText: "まだファイルが選択されていません",
    selectLabel: "音源 or 映像を選択",
    changeLabel: "音源 or 映像を変更",
    button: inputSelectButton,
  }],
  [introFile, introMeta, {
    emptyText: "音源を選択",
    defaultText: `未選択時は ${DEFAULT_INTRO_NAME} を使います`,
    selectLabel: "イントロ音源を選択",
    changeLabel: "音源を変更",
    button: introSelectButton,
  }],
  [outroFile, outroMeta, {
    emptyText: "音源を選択",
    defaultText: `未選択時は ${DEFAULT_OUTRO_NAME} を使います`,
    selectLabel: "エンディング音源を選択",
    changeLabel: "音源を変更",
    button: outroSelectButton,
  }],
];

for (const [input, meta, config] of fileCardConfigs) {
  updateFileCardState(input, meta, config);
  input?.addEventListener("change", () => {
    updateFileCardState(input, meta, config);
  });
}

const introPreviewController = new PreviewController({
  source: { input: introFile, fallbackUrl: DEFAULT_INTRO_URL },
  preview: {
    button: introPreviewButton,
    seek: introPreviewSeek,
    time: introPreviewTime,
    jumps: [
      { button: introJumpStartButton, target: 0 },
      { button: introJumpTargetButton, sourceInput: introPadInput },
      { button: introJumpFadeStartButton, sourceInput: introFadeStartInput },
    ],
  },
  waveform: {
    canvas: introWaveform,
    status: introWaveformStatus,
    zoomInButton: introWaveformZoomIn,
    zoomOutButton: introWaveformZoomOut,
    zoomValue: introWaveformZoomValue,
    zoomPresets: introWaveformZoomPresets,
  },
  music: { volumeInput: introMusicVolumeInput },
  fade: {
    startInput: introFadeStartInput,
    endInput: introFadeEndInput,
    startSetButton: introFadeStartSetButton,
    endSetButton: introFadeEndSetButton,
  },
  target: { input: introPadInput, setButton: introPadSetButton, enabled: true },
});

const outroPreviewController = new PreviewController({
  source: { input: outroFile, fallbackUrl: DEFAULT_OUTRO_URL },
  preview: {
    button: outroPreviewButton,
    seek: outroPreviewSeek,
    time: outroPreviewTime,
    jumps: [
      { button: outroJumpStartButton, target: 0 },
      { button: outroJumpTargetButton, sourceInput: outroOverlapInput },
      { button: outroJumpFadeStartButton, sourceInput: outroFadeStartInput },
    ],
  },
  waveform: {
    canvas: outroWaveform,
    status: outroWaveformStatus,
    zoomInButton: outroWaveformZoomIn,
    zoomOutButton: outroWaveformZoomOut,
    zoomValue: outroWaveformZoomValue,
    zoomPresets: outroWaveformZoomPresets,
  },
  music: { volumeInput: outroMusicVolumeInput },
  fade: {
    startInput: outroFadeStartInput,
    endInput: outroFadeEndInput,
    startSetButton: outroFadeStartSetButton,
    endSetButton: outroFadeEndSetButton,
  },
  target: { input: outroOverlapInput, setButton: outroOverlapSetButton, enabled: true, color: "244, 63, 94" },
});

const inputWaveformController = new PreviewController({
  source: { input: inputFile },
  preview: {
    button: inputPreviewButton,
    seek: inputPreviewSeek,
    time: inputPreviewTime,
    jumps: [
      { button: inputJumpStartButton, target: 0 },
      { button: inputJumpTrimStartButton, sourceInput: talkTrimStartInput },
      { button: inputJumpTrimEndButton, sourceInput: talkTrimEndInput },
      { button: inputJumpEndButton, target: "end" },
    ],
  },
  waveform: {
    canvas: inputWaveform,
    status: inputWaveformStatus,
    zoomInButton: inputWaveformZoomIn,
    zoomOutButton: inputWaveformZoomOut,
    zoomValue: inputWaveformZoomValue,
    zoomPresets: inputWaveformZoomPresets,
  },
  trim: {
    startInput: talkTrimStartInput,
    endInput: talkTrimEndInput,
    startSetButton: talkTrimStartSetButton,
    endSetButton: talkTrimEndSetButton,
    enabled: true,
  },
});

const previewControllers = [inputWaveformController, introPreviewController, outroPreviewController];

for (const controller of previewControllers) {
  controller.start({ onLogError: appendLog });
}

const inputBindings = [
  [introPadInput, introPreviewController],
  [introMusicVolumeInput, introPreviewController],
  [introFadeStartInput, introPreviewController],
  [introFadeEndInput, introPreviewController],
  [outroOverlapInput, outroPreviewController],
  [outroMusicVolumeInput, outroPreviewController],
  [outroFadeStartInput, outroPreviewController],
  [outroFadeEndInput, outroPreviewController],
  [talkTrimStartInput, inputWaveformController],
  [talkTrimEndInput, inputWaveformController],
];

for (const [input, controller] of inputBindings) {
  input?.addEventListener("input", () => {
    controller.updateUI();
  });
}

const SETTINGS_STORAGE_KEY = "wraptalk:settings:v1";

// Inputs persisted across sessions (excludes file-derived trim and the file inputs themselves).
const persistedInputs = [
  introPadInput,
  outroOverlapInput,
  voiceLufsInput,
  introMusicVolumeInput,
  outroMusicVolumeInput,
  introDuckLevelInput,
  outroDuckLevelInput,
  introFadeStartInput,
  introFadeEndInput,
  outroFadeStartInput,
  outroFadeEndInput,
];

function persistSettings() {
  const data = {};
  for (const input of persistedInputs) {
    if (input?.id) {
      data[input.id] = input.value;
    }
  }
  const checked = document.querySelector('input[name="mp3Bitrate"]:checked');
  if (checked instanceof HTMLInputElement) {
    data.mp3Bitrate = checked.value;
  }
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage may be unavailable (private mode, quota); fail silently.
  }
}

function restoreSettings() {
  let raw;
  try {
    raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) {
    return;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  if (!data || typeof data !== "object") {
    return;
  }
  for (const input of persistedInputs) {
    if (input?.id && typeof data[input.id] === "string") {
      input.value = data[input.id];
    }
  }
  if (typeof data.mp3Bitrate === "string") {
    const radio = document.querySelector(`input[name="mp3Bitrate"][value="${data.mp3Bitrate}"]`);
    if (radio instanceof HTMLInputElement) {
      radio.checked = true;
    }
  }
}

restoreSettings();
for (const controller of previewControllers) {
  controller.updateUI();
}

for (const input of persistedInputs) {
  input?.addEventListener("change", persistSettings);
  input?.addEventListener("input", persistSettings);
}
for (const radio of document.querySelectorAll('input[name="mp3Bitrate"]')) {
  radio.addEventListener("change", persistSettings);
}

window.addEventListener("resize", () => {
  for (const controller of previewControllers) {
    controller.handleResize();
  }
});

for (const [button, input] of [
  [inputSelectButton, inputFile],
  [introSelectButton, introFile],
  [outroSelectButton, outroFile],
]) {
  button?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    input?.click();
  });
}

function bindDropZone(input) {
  if (!input) {
    return;
  }
  const card = document.querySelector(`[data-file-card="${input.id}"]`);
  if (!card) {
    return;
  }
  card.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    card.classList.add("is--dragover");
  });
  card.addEventListener("dragleave", (event) => {
    // Only clear when leaving the card itself, not bubbling from children.
    if (event.target === card) {
      card.classList.remove("is--dragover");
    }
  });
  card.addEventListener("drop", (event) => {
    event.preventDefault();
    card.classList.remove("is--dragover");
    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

for (const input of [inputFile, introFile, outroFile]) {
  bindDropZone(input);
}

const actionButtons = [processButton, previewOpeningButton, previewEndingButton];

async function runExclusiveAction(operation, failStatus) {
  actionButtons.forEach((b) => { b.disabled = true; });
  try {
    await operation();
  } catch (error) {
    setStatus(failStatus);
    appendLog(error instanceof Error ? error.message : String(error));
  } finally {
    actionButtons.forEach((b) => { b.disabled = false; });
  }
}

processButton.addEventListener("click", () => runExclusiveAction(processAudio, "処理失敗"));
previewOpeningButton.addEventListener("click", () => runExclusiveAction(() => processMixPreview("opening"), "プレビュー失敗"));
previewEndingButton.addEventListener("click", () => runExclusiveAction(() => processMixPreview("ending"), "プレビュー失敗"));
