// @ts-check

/** @param {string} id */
const $ = (id) => document.getElementById(id);

export const loadButton = $("loadButton");
export const processButton = $("processButton");
export const actionModal = $("actionModal");
export const actionModalClose = $("actionModalClose");
export const voiceLufsInfoButton = $("voiceLufsInfoButton");
export const voiceLufsInfoModal = $("voiceLufsInfoModal");
export const voiceLufsInfoModalClose = $("voiceLufsInfoModalClose");
export const environmentInfoButton = $("environmentInfoButton");
export const environmentInfoModal = $("environmentInfoModal");
export const environmentInfoModalClose = $("environmentInfoModalClose");
export const introDuckingInfoButton = $("introDuckingInfoButton");
export const outroDuckingInfoButton = $("outroDuckingInfoButton");
export const duckingInfoModal = $("duckingInfoModal");
export const duckingInfoModalClose = $("duckingInfoModalClose");
export const introPadInfoButton = $("introPadInfoButton");
export const introPadInfoModal = $("introPadInfoModal");
export const introPadInfoModalClose = $("introPadInfoModalClose");
export const outroOverlapInfoButton = $("outroOverlapInfoButton");
export const outroOverlapInfoModal = $("outroOverlapInfoModal");
export const outroOverlapInfoModalClose = $("outroOverlapInfoModalClose");
export const talkTrimInfoButton = $("talkTrimInfoButton");
export const talkTrimInfoModal = $("talkTrimInfoModal");
export const talkTrimInfoModalClose = $("talkTrimInfoModalClose");
export const mp3BitrateInfoButton = $("mp3BitrateInfoButton");
export const mp3BitrateInfoModal = $("mp3BitrateInfoModal");
export const mp3BitrateInfoModalClose = $("mp3BitrateInfoModalClose");
export const previewOpeningButton = $("previewOpeningButton");
export const previewEndingButton = $("previewEndingButton");
export const mixPreviewBlock = $("mixPreviewBlock");
export const mixPreviewOpeningClip = $("mixPreviewOpeningClip");
export const mixPreviewEndingClip = $("mixPreviewEndingClip");
export const mixPreviewOpening = /** @type {HTMLAudioElement | null} */ ($("mixPreviewOpening"));
export const mixPreviewEnding = /** @type {HTMLAudioElement | null} */ ($("mixPreviewEnding"));

export const inputFile = $("inputFile");
export const introFile = $("introFile");
export const outroFile = $("outroFile");

export const introPadInput = $("introPad");
export const outroOverlapInput = $("outroOverlap");
export const introMusicVolumeInput = $("introMusicVolume");
export const outroMusicVolumeInput = $("outroMusicVolume");
export const introDuckLevelInput = $("introDuckLevel");
export const outroDuckLevelInput = $("outroDuckLevel");
export const introFadeStartInput = $("introFadeStart");
export const introFadeEndInput = $("introFadeEnd");
export const outroFadeStartInput = $("outroFadeStart");
export const outroFadeEndInput = $("outroFadeEnd");
export const voiceLufsInput = $("voiceLufs");
/**
 * Read the value of the currently selected MP3 bitrate radio.
 * @returns {string}
 */
export function getMp3Bitrate() {
  const checked = /** @type {HTMLInputElement | null} */ (
    document.querySelector('input[name="mp3Bitrate"]:checked')
  );
  return checked ? checked.value : "128k";
}
export const talkTrimStartInput = $("talkTrimStart");
export const talkTrimEndInput = $("talkTrimEnd");

export const statusBlock = $("statusBlock");
export const statusText = $("statusText");
export const logBox = $("logBox");
export const logToggle = $("logToggle");
export const resetSettingsButton = $("resetSettingsButton");
export const meterBar = $("meterBar");

export const inputMeta = $("inputMeta");
export const introMeta = $("introMeta");
export const outroMeta = $("outroMeta");

export const inputSelectButton = $("inputSelectButton");
export const introSelectButton = $("introSelectButton");
export const outroSelectButton = $("outroSelectButton");

export const inputPreviewButton = $("inputPreviewButton");
export const introPreviewButton = $("introPreviewButton");
export const outroPreviewButton = $("outroPreviewButton");

export const inputJumpStartButton = $("inputJumpStartButton");
export const inputJumpTrimStartButton = $("inputJumpTrimStartButton");
export const inputJumpTrimEndButton = $("inputJumpTrimEndButton");
export const inputJumpEndButton = $("inputJumpEndButton");
export const introJumpStartButton = $("introJumpStartButton");
export const introJumpTargetButton = $("introJumpTargetButton");
export const introJumpFadeStartButton = $("introJumpFadeStartButton");
export const outroJumpStartButton = $("outroJumpStartButton");
export const outroJumpTargetButton = $("outroJumpTargetButton");
export const outroJumpFadeStartButton = $("outroJumpFadeStartButton");

export const introFadeStartSetButton = $("introFadeStartSetButton");
export const introFadeEndSetButton = $("introFadeEndSetButton");
export const outroFadeStartSetButton = $("outroFadeStartSetButton");
export const outroFadeEndSetButton = $("outroFadeEndSetButton");
export const introPadSetButton = $("introPadSetButton");
export const outroOverlapSetButton = $("outroOverlapSetButton");
export const talkTrimStartSetButton = $("talkTrimStartSetButton");
export const talkTrimEndSetButton = $("talkTrimEndSetButton");

export const inputPreviewSeek = $("inputPreviewSeek");
export const inputPreviewTime = $("inputPreviewTime");
export const introPreviewSeek = $("introPreviewSeek");
export const outroPreviewSeek = $("outroPreviewSeek");
export const introPreviewTime = $("introPreviewTime");
export const outroPreviewTime = $("outroPreviewTime");

export const inputWaveform = $("inputWaveform");
export const introWaveform = $("introWaveform");
export const outroWaveform = $("outroWaveform");
export const inputWaveformStatus = $("inputWaveformStatus");
export const introWaveformStatus = $("introWaveformStatus");
export const outroWaveformStatus = $("outroWaveformStatus");
export const inputWaveformZoomIn = $("inputWaveformZoomIn");
export const inputWaveformZoomOut = $("inputWaveformZoomOut");
export const inputWaveformZoomValue = $("inputWaveformZoomValue");
export const inputWaveformZoomPresets = $("inputWaveformZoomPresets");
export const introWaveformZoomIn = $("introWaveformZoomIn");
export const introWaveformZoomOut = $("introWaveformZoomOut");
export const introWaveformZoomValue = $("introWaveformZoomValue");
export const introWaveformZoomPresets = $("introWaveformZoomPresets");
export const outroWaveformZoomIn = $("outroWaveformZoomIn");
export const outroWaveformZoomOut = $("outroWaveformZoomOut");
export const outroWaveformZoomValue = $("outroWaveformZoomValue");
export const outroWaveformZoomPresets = $("outroWaveformZoomPresets");
