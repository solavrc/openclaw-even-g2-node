import { describe, expect, it } from "vitest";
import {
  NODE_PTT_DEFAULT_DURATION_MS,
  NODE_PTT_MAX_DURATION_MS,
  NODE_PTT_MIN_DURATION_MS,
  NODE_PTT_TIMEOUT_RESERVE_MS,
  nodePttDurationMs,
  nodeVoiceCloseCommandResult,
  talkPttNodeCommandPlan,
} from "./voice-command";

describe("nodePttDurationMs", () => {
  it("uses explicit duration, timeout fallback, and clamps the result", () => {
    expect(nodePttDurationMs({ durationMs: 5000 }, undefined)).toBe(5000);
    expect(nodePttDurationMs(undefined, 12000)).toBe(12000 - NODE_PTT_TIMEOUT_RESERVE_MS);
    expect(nodePttDurationMs({ durationMs: 100 }, undefined)).toBe(NODE_PTT_MIN_DURATION_MS);
    expect(nodePttDurationMs({ durationMs: 60000 }, undefined)).toBe(NODE_PTT_MAX_DURATION_MS);
    expect(nodePttDurationMs(undefined, undefined)).toBe(NODE_PTT_DEFAULT_DURATION_MS);
  });
});

describe("talkPttNodeCommandPlan", () => {
  it("plans talk push-to-talk commands", () => {
    expect(talkPttNodeCommandPlan("talk.ptt.once", { durationMs: 5000 }, undefined)).toEqual({
      action: "start-voice",
      requiresBridge: true,
      durationMs: 5000,
    });
    expect(talkPttNodeCommandPlan("canvas.present", {}, undefined)).toBeNull();
  });
});

describe("nodeVoiceCloseCommandResult", () => {
  it("returns a transcript payload when speech was captured", () => {
    expect(nodeVoiceCloseCommandResult(" hello ")).toEqual({
      ok: true,
      payload: { text: "hello" },
    });
  });

  it("returns an error when no transcript was produced", () => {
    expect(nodeVoiceCloseCommandResult(" ")).toEqual({
      ok: false,
      payload: {},
      error: {
        code: "VOICE_CLOSED",
        message: "Voice capture closed before a transcript was produced.",
      },
    });
  });
});
