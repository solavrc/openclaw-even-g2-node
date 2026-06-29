import { describe, expect, it } from "vitest";
import { preprocessPcm16Mono } from "./voice-preprocess";

const SAMPLE_RATE_HZ = 16000;

function pcmFromSamples(samples: number[]) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(index * 2, Math.round(clamped * 32767), true);
  });
  return bytes;
}

function tone(durationMs: number, amplitude = 0.2) {
  const sampleCount = Math.floor(SAMPLE_RATE_HZ * durationMs / 1000);
  return Array.from({ length: sampleCount }, (_, index) => Math.sin(index / 8) * amplitude);
}

function silence(durationMs: number) {
  return Array.from({ length: Math.floor(SAMPLE_RATE_HZ * durationMs / 1000) }, () => 0);
}

describe("preprocessPcm16Mono", () => {
  it("rejects very short recordings before they reach OpenClaw", () => {
    const result = preprocessPcm16Mono(pcmFromSamples(tone(250)), { sampleRateHz: SAMPLE_RATE_HZ });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too-short");
  });

  it("rejects silent recordings", () => {
    const result = preprocessPcm16Mono(pcmFromSamples(silence(1200)), { sampleRateHz: SAMPLE_RATE_HZ });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("silent");
  });

  it("trims leading and trailing silence while keeping speech", () => {
    const source = pcmFromSamples([
      ...silence(420),
      ...tone(650, 0.16),
      ...silence(380),
    ]);
    const result = preprocessPcm16Mono(source, { sampleRateHz: SAMPLE_RATE_HZ });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pcm.byteLength).toBeLessThan(source.byteLength);
      expect(result.speechDurationMs).toBeGreaterThan(400);
      expect(result.trimStartMs).toBeGreaterThan(0);
      expect(result.trimEndMs).toBeGreaterThan(0);
    }
  });
});
