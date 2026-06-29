export type VoicePreprocessReason = "too-short" | "silent";

export type VoicePreprocessResult = {
  ok: true;
  pcm: Uint8Array;
  durationMs: number;
  speechDurationMs: number;
  rms: number;
  peak: number;
  trimStartMs: number;
  trimEndMs: number;
} | {
  ok: false;
  reason: VoicePreprocessReason;
  durationMs: number;
  speechDurationMs: number;
  rms: number;
  peak: number;
};

export type VoicePreprocessOptions = {
  sampleRateHz?: number;
  minDurationMs?: number;
  minSpeechDurationMs?: number;
  frameMs?: number;
  silencePaddingMs?: number;
  noiseFloorMultiplier?: number;
  minSpeechRms?: number;
  targetRms?: number;
  maxGain?: number;
};

type ResolvedVoicePreprocessOptions = {
  sampleRateHz: number;
  minDurationMs: number;
  minSpeechDurationMs: number;
  frameMs: number;
  silencePaddingMs: number;
  noiseFloorMultiplier: number;
  minSpeechRms: number;
  targetRms: number;
  maxGain: number;
};

type SpeechFrame = {
  value: number;
  index: number;
};

const DEFAULT_SAMPLE_RATE_HZ = 16000;
const DEFAULT_MIN_DURATION_MS = 700;
const DEFAULT_MIN_SPEECH_DURATION_MS = 220;
const DEFAULT_FRAME_MS = 20;
const DEFAULT_SILENCE_PADDING_MS = 150;
const DEFAULT_NOISE_FLOOR_MULTIPLIER = 3.2;
const DEFAULT_MIN_SPEECH_RMS = 0.018;
const DEFAULT_MAX_SPEECH_RMS_THRESHOLD = 0.08;
const DEFAULT_TARGET_RMS = 0.12;
const DEFAULT_MAX_GAIN = 3;

export function preprocessPcm16Mono(
  bytes: Uint8Array,
  options: VoicePreprocessOptions = {},
): VoicePreprocessResult {
  const config = resolveVoicePreprocessOptions(options);
  const samples = pcm16MonoToFloat(bytes);
  const durationMs = samples.length / config.sampleRateHz * 1000;
  const { rms, peak } = signalStats(samples);
  if (durationMs < config.minDurationMs) {
    return { ok: false, reason: "too-short", durationMs, speechDurationMs: 0, rms, peak };
  }

  const frameSamples = Math.max(1, Math.floor(config.sampleRateHz * config.frameMs / 1000));
  const frames = frameRms(samples, frameSamples);
  const speechFrames = detectSpeechFrames(frames, speechThreshold(frames, config));
  const speechDurationMs = speechFrames.length * config.frameMs;
  if (speechDurationMs < config.minSpeechDurationMs) {
    return { ok: false, reason: "silent", durationMs, speechDurationMs, rms, peak };
  }

  const { startSample, endSample } = speechSampleWindow({
    frameCount: frames.length,
    frameSamples,
    sampleRateHz: config.sampleRateHz,
    samplesLength: samples.length,
    silencePaddingMs: config.silencePaddingMs,
    speechFrames,
  });
  const trimmed = removeDcOffset(samples.slice(startSample, endSample));
  const normalized = normalizeGain(trimmed, config.targetRms, config.maxGain);
  return {
    ok: true,
    pcm: floatToPcm16Mono(normalized),
    durationMs,
    speechDurationMs,
    rms,
    peak,
    trimStartMs: startSample / config.sampleRateHz * 1000,
    trimEndMs: (samples.length - endSample) / config.sampleRateHz * 1000,
  };
}

function resolveVoicePreprocessOptions(options: VoicePreprocessOptions): ResolvedVoicePreprocessOptions {
  return {
    sampleRateHz: options.sampleRateHz || DEFAULT_SAMPLE_RATE_HZ,
    minDurationMs: options.minDurationMs || DEFAULT_MIN_DURATION_MS,
    minSpeechDurationMs: options.minSpeechDurationMs || DEFAULT_MIN_SPEECH_DURATION_MS,
    frameMs: options.frameMs || DEFAULT_FRAME_MS,
    silencePaddingMs: options.silencePaddingMs || DEFAULT_SILENCE_PADDING_MS,
    noiseFloorMultiplier: options.noiseFloorMultiplier || DEFAULT_NOISE_FLOOR_MULTIPLIER,
    minSpeechRms: options.minSpeechRms || DEFAULT_MIN_SPEECH_RMS,
    targetRms: options.targetRms || DEFAULT_TARGET_RMS,
    maxGain: options.maxGain || DEFAULT_MAX_GAIN,
  };
}

function speechThreshold(frames: number[], options: ResolvedVoicePreprocessOptions) {
  const sorted = [...frames].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] || 0;
  return Math.max(
    options.minSpeechRms,
    Math.min(DEFAULT_MAX_SPEECH_RMS_THRESHOLD, noiseFloor * options.noiseFloorMultiplier),
  );
}

function detectSpeechFrames(frames: number[], threshold: number): SpeechFrame[] {
  return frames
    .map((value, index) => ({ value, index }))
    .filter((frame) => frame.value >= threshold);
}

function speechSampleWindow({
  frameCount,
  frameSamples,
  sampleRateHz,
  samplesLength,
  silencePaddingMs,
  speechFrames,
}: {
  frameCount: number;
  frameSamples: number;
  sampleRateHz: number;
  samplesLength: number;
  silencePaddingMs: number;
  speechFrames: SpeechFrame[];
}) {
  const firstSpeechFrame = speechFrames[0]?.index ?? 0;
  const lastSpeechFrame = speechFrames[speechFrames.length - 1]?.index ?? frameCount - 1;
  const paddingSamples = Math.floor(sampleRateHz * silencePaddingMs / 1000);
  return {
    startSample: Math.max(0, firstSpeechFrame * frameSamples - paddingSamples),
    endSample: Math.min(samplesLength, (lastSpeechFrame + 1) * frameSamples + paddingSamples),
  };
}

function pcm16MonoToFloat(bytes: Uint8Array) {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const samples = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 32768;
  }
  return samples;
}

function floatToPcm16Mono(samples: Float32Array) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] || 0));
    view.setInt16(index * 2, Math.round(clamped * 32767), true);
  }
  return bytes;
}

function signalStats(samples: Float32Array) {
  if (!samples.length) return { rms: 0, peak: 0 };
  let sumSquares = 0;
  let peak = 0;
  for (const sample of samples) {
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  return { rms: Math.sqrt(sumSquares / samples.length), peak };
}

function frameRms(samples: Float32Array, frameSamples: number) {
  const result: number[] = [];
  for (let start = 0; start < samples.length; start += frameSamples) {
    const end = Math.min(samples.length, start + frameSamples);
    let sumSquares = 0;
    for (let index = start; index < end; index += 1) {
      const sample = samples[index] || 0;
      sumSquares += sample * sample;
    }
    result.push(Math.sqrt(sumSquares / Math.max(1, end - start)));
  }
  return result;
}

function removeDcOffset(samples: Float32Array) {
  if (!samples.length) return samples;
  let sum = 0;
  for (const sample of samples) sum += sample;
  const offset = sum / samples.length;
  const result = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    result[index] = (samples[index] || 0) - offset;
  }
  return result;
}

function normalizeGain(samples: Float32Array, targetRms: number, maxGain: number) {
  const { rms } = signalStats(samples);
  if (!rms) return samples;
  const gain = Math.min(maxGain, Math.max(1, targetRms / rms));
  if (gain <= 1.01) return samples;
  const result = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    result[index] = (samples[index] || 0) * gain;
  }
  return result;
}
