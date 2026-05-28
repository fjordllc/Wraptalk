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
  assertInRange,
  isNetworkLikeError,
  parseNumberInput,
  parseOptionalNumber,
  parseRequiredNumber,
} from "./utils.js";
import {
  PreviewController,
  previewSession,
  setPreviewLogger,
} from "./preview.js";
import {
  actionModal,
  actionModalClose,
  voiceLufsInfoButton,
  environmentInfoButton,
  introDuckingInfoButton,
  outroDuckingInfoButton,
  introPadInfoButton,
  outroOverlapInfoButton,
  talkTrimInfoButton,
  mp3BitrateInfoButton,
  shortcutInfoButton,
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
  resetSettingsButton,
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

let currentStatusBase = "";
let currentProgressPercent = 0;

function renderStatus(base, percent) {
  const match = base.match(/^(.*?)(\.{3,})$/);
  statusText.replaceChildren();
  if (match) {
    statusText.append(match[1]);
    const ellipsis = document.createElement("span");
    ellipsis.className = "c--ellipsis";
    for (let i = 0; i < 3; i += 1) {
      const dot = document.createElement("span");
      dot.textContent = ".";
      ellipsis.append(dot);
    }
    statusText.append(ellipsis);
    if (typeof percent === "number" && percent > 0 && percent < 100) {
      statusText.append(` ${percent}%`);
    }
  } else {
    statusText.textContent = base;
  }
}

function setStatus(message) {
  currentStatusBase = message;
  currentProgressPercent = 0;
  renderStatus(message, 0);
}

logToggle?.addEventListener("click", () => {
  const hidden = logBox.classList.toggle("is--hidden");
  logToggle.setAttribute("aria-expanded", hidden ? "false" : "true");
  logToggle.textContent = hidden ? "ログを見る ▼" : "ログを隠す ▲";
});

function setProgress(progress) {
  const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
  meterBar.style.width = `${percent}%`;
  currentProgressPercent = percent;
  if (currentStatusBase) {
    renderStatus(currentStatusBase, percent);
  }
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
    meta.classList.remove("is--error");
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

function showFileCardError(input, message) {
  const meta = document.getElementById(`${input.id.replace(/File$/, "")}Meta`);
  if (!meta) return;
  meta.textContent = message;
  meta.classList.add("is--error");
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

async function readMixSpec() {
  const input = requireFile(inputFile, "トーク音源");
  const intro = await resolveAudioInput(introFile, DEFAULT_INTRO_URL, DEFAULT_INTRO_NAME, "イントロ音源");
  const outro = await resolveAudioInput(outroFile, DEFAULT_OUTRO_URL, DEFAULT_OUTRO_NAME, "アウトロ音源");

  // Single source of truth for the numeric ranges. Mirrors the HTML
  // min/max attrs on the corresponding inputs. Update both if the bounds
  // ever move so the browser-level and submit-time validation stay in sync.
  const rangedInputs = [
    { key: "introPad", input: introPadInput, label: "イントロの開始位置", min: 0, max: 600 },
    { key: "outroOverlap", input: outroOverlapInput, label: "アウトロの開始位置", min: 0, max: 600 },
    { key: "voiceLufs", input: voiceLufsInput, label: "話し声の目標LUFS", min: -40, max: -8 },
    { key: "introMusicVolume", input: introMusicVolumeInput, label: "イントロの基本音量", min: 0, max: 100, scale: 1 / 100 },
    { key: "outroMusicVolume", input: outroMusicVolumeInput, label: "アウトロの基本音量", min: 0, max: 100, scale: 1 / 100 },
    { key: "introDuckLevel", input: introDuckLevelInput, label: "イントロのトーク中音量", min: 0, max: 100, scale: 1 / 100 },
    { key: "outroDuckLevel", input: outroDuckLevelInput, label: "アウトロのトーク中音量", min: 0, max: 100, scale: 1 / 100 },
  ];
  const ranged = {};
  for (const { key, input: el, label, min, max, scale } of rangedInputs) {
    const value = assertInRange(parseRequiredNumber(el.value, label), min, max, label);
    ranged[key] = scale ? value * scale : value;
  }

  return {
    input,
    intro,
    outro,
    ...ranged,
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
  // Some browsers may not have started the download by the time click() returns;
  // a short delay before revoking avoids racing the navigation away.
  setTimeout(() => URL.revokeObjectURL(url), 1000);

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

// Keyboard handling for the currently-open modal: Tab traps focus inside it,
// Esc closes it. infoModalEntries is declared below; the callback reads it
// at event time so the forward reference is fine.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Tab" && event.key !== "Escape") {
    return;
  }
  const openInfo = infoModalEntries.find((entry) => entry.modal?.classList.contains("is--open"));
  const openModalRef = openInfo?.modal ?? (actionModal?.classList.contains("is--open") ? actionModal : null);
  if (!openModalRef) {
    return;
  }
  if (event.key === "Tab") {
    trapFocus(openModalRef, event);
  } else {
    if (openInfo) {
      closeModal(openInfo.modal);
    } else {
      closeActionModal();
    }
  }
});

// Global preview shortcuts. Skip when typing in an input / textarea / contenteditable
// so the keys still type literally, and skip when any modal is open so the focus
// trap is in charge.
function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return target.isContentEditable;
}

function isAnyModalOpen() {
  if (actionModal?.classList.contains("is--open")) {
    return true;
  }
  return infoModalEntries.some((entry) => entry.modal?.classList.contains("is--open"));
}

function activePreviewController() {
  // Prefer whichever controller is currently driving playback; otherwise default
  // to the talk preview (the most common target).
  return previewSession.activeController ?? inputWaveformController;
}

function seekActive(deltaSec) {
  const controller = activePreviewController();
  const audio = controller?.audio;
  if (!audio) {
    return;
  }
  const duration = audio.duration || controller.duration || 0;
  audio.currentTime = Math.max(0, Math.min(duration, audio.currentTime + deltaSec));
  controller.updateUI();
}

document.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  if (isTypingTarget(event.target) || isAnyModalOpen()) {
    return;
  }
  if (event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
    activePreviewController()?.toggle();
  } else if (event.key === ",") {
    event.preventDefault();
    seekActive(-5);
  } else if (event.key === ".") {
    event.preventDefault();
    seekActive(5);
  }
});

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

// Build the info modals from a single shell + per-modal content template.
// Each entry's modal/close are populated when the modal is materialised below.
const infoModalEntries = [
  { key: "environment", title: "動作環境について", triggers: [environmentInfoButton] },
  { key: "voiceLufs", title: "目標LUFS とは", triggers: [voiceLufsInfoButton] },
  { key: "ducking", title: "基本音量とトーク中音量", triggers: [introDuckingInfoButton, outroDuckingInfoButton] },
  { key: "introPad", title: "トーク開始位置（イントロ）", triggers: [introPadInfoButton] },
  { key: "outroOverlap", title: "トーク終了位置（アウトロ）", triggers: [outroOverlapInfoButton] },
  { key: "talkTrim", title: "トークの使用範囲", triggers: [talkTrimInfoButton] },
  { key: "mp3Bitrate", title: "MP3 ビットレート", triggers: [mp3BitrateInfoButton] },
  { key: "shortcut", title: "キーボードショートカット", triggers: [shortcutInfoButton] },
];

function buildInfoModal({ key, title }) {
  const shellTpl = /** @type {HTMLTemplateElement} */ (document.getElementById("infoModalShell"));
  const contentTpl = /** @type {HTMLTemplateElement} */ (document.getElementById(`${key}InfoContent`));
  const node = /** @type {HTMLElement} */ (shellTpl.content.firstElementChild.cloneNode(true));
  const titleId = `${key}InfoModalTitle`;
  node.id = `${key}InfoModal`;
  node.setAttribute("aria-labelledby", titleId);
  const titleEl = node.querySelector(".js--info-modal-title");
  titleEl.id = titleId;
  titleEl.textContent = title;
  node.querySelector(".js--info-modal-body").appendChild(contentTpl.content.cloneNode(true));
  document.body.appendChild(node);
  return node;
}

for (const entry of infoModalEntries) {
  entry.modal = buildInfoModal(entry);
  entry.close = entry.modal.querySelector(".js--info-modal-close");
  for (const trigger of entry.triggers) {
    trigger?.addEventListener("click", () => openModal(entry.modal));
  }
  entry.close.addEventListener("click", () => closeModal(entry.modal));
  entry.modal.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.modalClose === "true") {
      closeModal(entry.modal);
    }
  });
}

inputFile?.addEventListener("change", () => {
  if (!ffmpegRuntime.isLoaded()) {
    loadButton.disabled = !inputFile.files?.length;
  }
});

const fileCardConfigs = [
  {
    input: inputFile,
    meta: inputMeta,
    emptyText: "まだファイルが選択されていません",
    selectLabel: "音源 or 映像を選択",
    changeLabel: "音源 or 映像を変更",
    button: inputSelectButton,
  },
  {
    input: introFile,
    meta: introMeta,
    emptyText: "音源を選択",
    defaultText: `未選択時は ${DEFAULT_INTRO_NAME} を使います`,
    selectLabel: "イントロ音源を選択",
    changeLabel: "音源を変更",
    button: introSelectButton,
  },
  {
    input: outroFile,
    meta: outroMeta,
    emptyText: "音源を選択",
    defaultText: `未選択時は ${DEFAULT_OUTRO_NAME} を使います`,
    selectLabel: "エンディング音源を選択",
    changeLabel: "音源を変更",
    button: outroSelectButton,
  },
];

for (const config of fileCardConfigs) {
  const { input, meta } = config;
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

const SETTINGS_STORAGE_KEY = "wraptalk:settings:v2";
const LEGACY_SETTINGS_KEY_V1 = "wraptalk:settings:v1";

// v1 (0-1 linear) → v2 (0-100%) one-shot migration for the music volume inputs.
// Run before restoreSettings so a returning user who had introMusicVolume: "0.22"
// doesn't end up with the new input pegged at 0.22% (effectively silent).
function migrateLegacySettings() {
  let v1Raw;
  try {
    if (localStorage.getItem(SETTINGS_STORAGE_KEY) !== null) {
      return;
    }
    v1Raw = localStorage.getItem(LEGACY_SETTINGS_KEY_V1);
  } catch {
    return;
  }
  if (!v1Raw) {
    return;
  }
  let data;
  try {
    data = JSON.parse(v1Raw);
  } catch {
    return;
  }
  if (!data || typeof data !== "object") {
    return;
  }
  for (const key of ["introMusicVolume", "outroMusicVolume"]) {
    const value = data[key];
    if (typeof value === "string") {
      const num = Number(value);
      // Old scale capped at 1; if it's at most 1 treat it as the legacy linear gain.
      if (Number.isFinite(num) && num <= 1) {
        data[key] = String(Math.round(num * 100));
      }
    }
  }
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data));
    localStorage.removeItem(LEGACY_SETTINGS_KEY_V1);
  } catch {
    // ignore
  }
}

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
    // Compare .value in JS instead of interpolating into a selector so a
    // tampered localStorage value (with " or ]) can't break querySelector().
    for (const radio of document.querySelectorAll('input[name="mp3Bitrate"]')) {
      if (radio instanceof HTMLInputElement && radio.value === data.mp3Bitrate) {
        radio.checked = true;
        break;
      }
    }
  }
}

migrateLegacySettings();
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

function resetSettingsToDefaults() {
  for (const input of persistedInputs) {
    if (!input) {
      continue;
    }
    input.value = input.defaultValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  for (const radio of document.querySelectorAll('input[name="mp3Bitrate"]')) {
    if (radio instanceof HTMLInputElement) {
      radio.checked = radio.defaultChecked;
    }
  }
  try {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    // ignore
  }
  for (const controller of previewControllers) {
    controller.updateUI();
  }
}

resetSettingsButton?.addEventListener("click", () => {
  if (!window.confirm("すべての設定を初期値に戻します。よろしいですか?")) {
    return;
  }
  resetSettingsToDefaults();
});

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
    // relatedTarget is the element we're entering. If it's null (left the
    // window) or outside the card, we've actually left the drop zone.
    // Comparing event.target === card alone misses the case where the user
    // exits the card while still hovering a child element.
    const next = event.relatedTarget;
    if (!next || !card.contains(/** @type {Node} */ (next))) {
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
    if (!isAcceptableFile(input, file)) {
      const accept = input.accept || "";
      const errorMsg = `非対応のファイル形式です: ${file.name}`;
      showFileCardError(input, errorMsg);
      setStatus(`このファイル形式には対応していません（許可: ${accept || "—"}）`);
      appendLog(`ドロップされたファイル ${file.name} (${file.type || "?"}) は ${input.id} の accept "${accept}" に一致しません。`);
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus", "weba"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "mkv", "webm", "avi", "m4v"]);

function isAcceptableFile(input, file) {
  const accept = input.accept;
  if (!accept) {
    return true;
  }
  const tokens = accept.split(",").map((s) => s.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1) : "";
  return tokens.some((token) => {
    const t = token.toLowerCase();
    if (t.startsWith(".")) {
      return name.endsWith(t);
    }
    if (t === "audio/*") {
      // file.type can be empty for legit audio files on some browsers / OS,
      // so fall back to the well-known audio extensions list.
      return type.startsWith("audio/") || AUDIO_EXTENSIONS.has(ext);
    }
    if (t === "video/*") {
      return type.startsWith("video/") || VIDEO_EXTENSIONS.has(ext);
    }
    if (t.endsWith("/*")) {
      const prefix = t.slice(0, -1);
      return type.startsWith(prefix);
    }
    return type === t;
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
    if (error instanceof Error) {
      appendLog(error.message);
      if (error.stack) {
        appendLog(error.stack);
      }
    } else {
      appendLog(String(error));
    }
  } finally {
    actionButtons.forEach((b) => { b.disabled = false; });
  }
}

// JS-only enhancement: native number spinners are hidden by CSS for visual
// consistency, so we wrap every input[type=number] in .l--stepper at runtime
// and provide ± buttons that drive input.stepUp/Down. The page is functional
// without JS (the inputs still accept typed values), but the ± controls only
// appear after this runs.
function attachStepperButtons() {
  for (const input of document.querySelectorAll('input[type="number"]')) {
    if (input.dataset.stepperBound === "true") {
      continue;
    }
    input.dataset.stepperBound = "true";

    const wrapper = document.createElement("div");
    wrapper.className = "l--stepper";
    input.parentNode.insertBefore(wrapper, input);

    const makeButton = (label, aria, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "c--stepper-button";
      b.tabIndex = -1; // input itself handles keyboard nudges via Up/Down
      b.setAttribute("aria-label", aria);
      b.textContent = label;
      b.addEventListener("click", onClick);
      return b;
    };

    const minus = makeButton("−", "値を減らす", () => {
      input.stepDown();
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const plus = makeButton("+", "値を増やす", () => {
      input.stepUp();
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    wrapper.appendChild(minus);
    wrapper.appendChild(input);
    wrapper.appendChild(plus);
  }
}

attachStepperButtons();

processButton.addEventListener("click", () => runExclusiveAction(processAudio, "処理失敗"));
previewOpeningButton.addEventListener("click", () => runExclusiveAction(() => processMixPreview("opening"), "プレビュー失敗"));
previewEndingButton.addEventListener("click", () => runExclusiveAction(() => processMixPreview("ending"), "プレビュー失敗"));
