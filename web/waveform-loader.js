// @ts-check

import { fetchFile } from "../vendor/util/dist/esm/index.js";
import { extFromName } from "./utils.js";
import { ffmpegRuntime } from "./mix.js";

let waveformAudioContext = null;

function getAudioContext() {
  if (!waveformAudioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    waveformAudioContext = new AudioContextClass();
  }
  return waveformAudioContext;
}

async function fetchAudioArrayBuffer(input, fallbackUrl) {
  const file = input.files?.[0];
  if (file) {
    return file.arrayBuffer();
  }

  if (!fallbackUrl) {
    throw new Error("波形用の音源がまだ選択されていません。");
  }

  const response = await fetch(fallbackUrl);
  if (!response.ok) {
    throw new Error("波形用の音源を読み込めませんでした。");
  }
  return response.arrayBuffer();
}

async function decodeWaveformWithFFmpeg(input, fallbackUrl) {
  await ffmpegRuntime.ensureLoaded();

  const sourceName = input.files?.[0]
    ? `waveform_input.${extFromName(input.files[0].name, "mp4")}`
    : `waveform_input.${extFromName(fallbackUrl, "wav")}`;
  const outputName = "waveform_preview.wav";

  const sourceData = input.files?.[0]
    ? await fetchFile(input.files[0])
    : await fetchFile(fallbackUrl);

  await ffmpegRuntime.writeFile(sourceName, sourceData);
  await ffmpegRuntime.exec([
    "-i",
    sourceName,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "22050",
    outputName,
  ]);

  const wavData = await ffmpegRuntime.readFile(outputName);
  const audioContext = getAudioContext();
  const audioBuffer = await audioContext.decodeAudioData(wavData.buffer.slice(0));

  await ffmpegRuntime.cleanupFiles([sourceName, outputName]);

  return audioBuffer;
}

/**
 * Load an AudioBuffer from a file input or fallback URL.
 * Falls back to ffmpeg-based decode when the browser cannot decode the source directly
 * (typically `video/*` files where the audio track needs to be extracted first).
 */
export async function loadAudioBuffer(input, fallbackUrl) {
  const audioContext = getAudioContext();
  const arrayBuffer = await fetchAudioArrayBuffer(input, fallbackUrl);
  try {
    return await audioContext.decodeAudioData(arrayBuffer.slice(0));
  } catch (decodeError) {
    const selectedType = input.files?.[0]?.type || "";
    if (selectedType.startsWith("video/")) {
      return await decodeWaveformWithFFmpeg(input, fallbackUrl);
    }
    throw decodeError;
  }
}
