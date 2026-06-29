import { describe, expect, it } from "vitest";
import {
  APPROVAL_FIXTURE,
  CANVAS_FIXTURE_TEXT,
  EMOJI_PROBE_DEFAULT_TEXT,
  RECOVERY_FIXTURE_FRAME,
  SIMULATOR_FIXTURE_SESSIONS,
  SIMULATOR_FIXTURE_SESSION_KEY,
  SIMULATOR_FIXTURE_TRANSCRIPT,
  STORE_VOICE_LISTENING_TEXT,
  STORE_CHAT_FIXTURE_TRANSCRIPT,
  VOICE_REVIEW_FIXTURE_DRAFT,
  isSimulatorFixtureMode,
  simulatorFixtureBaseState,
  simulatorEmojiProbeTextFromSearch,
  simulatorFixtureTranscript,
  simulatorFixtureViewPlan,
  simulatorNodeSnapshot,
  simulatorSendNowPendingSessionVoice,
  simulatorStoreVoicePendingSessionVoice,
  simulatorFixtureModeFromSearch,
} from "./simulator-fixtures";

describe("simulator fixtures", () => {
  it("keeps public sample sessions and transcripts available", () => {
    expect(SIMULATOR_FIXTURE_SESSIONS[0]?.key).toBe("agent:main:main");
    expect(SIMULATOR_FIXTURE_SESSIONS.length).toBeGreaterThan(20);
    expect(SIMULATOR_FIXTURE_TRANSCRIPT.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(STORE_CHAT_FIXTURE_TRANSCRIPT.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("accepts documented fixture modes only", () => {
    expect(isSimulatorFixtureMode("session")).toBe(true);
    expect(isSimulatorFixtureMode("voiceReview")).toBe(true);
    expect(isSimulatorFixtureMode("emojiProbe")).toBe(true);
    expect(isSimulatorFixtureMode("storeVoice")).toBe(true);
    expect(isSimulatorFixtureMode("sendNow")).toBe(true);
    expect(isSimulatorFixtureMode("unknown")).toBe(false);
  });

  it("enables simFixture only in development mode", () => {
    expect(simulatorFixtureModeFromSearch("?simFixture=canvas", true)).toBe("canvas");
    expect(simulatorFixtureModeFromSearch("?simFixture=emojiProbe", true)).toBe("emojiProbe");
    expect(simulatorFixtureModeFromSearch("?simFixture=canvas", false)).toBe("");
    expect(simulatorFixtureModeFromSearch("?simFixture=unknown", true)).toBe("");
  });

  it("keeps fixture-specific state data outside the app shell", () => {
    expect(simulatorFixtureTranscript("storeChat")).toBe(STORE_CHAT_FIXTURE_TRANSCRIPT);
    expect(simulatorFixtureTranscript("session")).toBe(SIMULATOR_FIXTURE_TRANSCRIPT);
    expect(simulatorFixtureBaseState("storeVoice")).toMatchObject({
      gatewayUrl: "wss://gateway.example/ws",
      sessionKey: SIMULATOR_FIXTURE_SESSION_KEY,
      transcript: STORE_CHAT_FIXTURE_TRANSCRIPT,
      status: "ready",
    });
    expect(simulatorNodeSnapshot("recovery").openclaw?.lastError).toBe("EVEN_G2_BRIDGE_UNAVAILABLE");
    expect(simulatorStoreVoicePendingSessionVoice()).toEqual({
      mode: "review",
      targetSessionKey: SIMULATOR_FIXTURE_SESSION_KEY,
      idempotencyKey: "store-voice",
    });
    expect(simulatorSendNowPendingSessionVoice()).toEqual({
      mode: "direct",
      targetSessionKey: SIMULATOR_FIXTURE_SESSION_KEY,
      idempotencyKey: "send-now",
    });
    expect(STORE_VOICE_LISTENING_TEXT).toContain("Summarize this thread");
    expect(VOICE_REVIEW_FIXTURE_DRAFT.targetSessionKey).toBe(SIMULATOR_FIXTURE_SESSION_KEY);
    expect(CANVAS_FIXTURE_TEXT).toContain("Deploy finished");
    expect(EMOJI_PROBE_DEFAULT_TEXT).toContain("Emoji probe");
    expect(APPROVAL_FIXTURE.command).toBe("make release");
    expect(RECOVERY_FIXTURE_FRAME.header).toContain("NODE UNAVAILABLE");
  });

  it("maps fixture modes to view plans", () => {
    expect(simulatorFixtureViewPlan("session")).toEqual({ action: "session-home" });
    expect(simulatorFixtureViewPlan("storeChat")).toEqual({ action: "session-home" });
    expect(simulatorFixtureViewPlan("storeVoice")).toMatchObject({
      action: "store-voice",
      voiceText: STORE_VOICE_LISTENING_TEXT,
    });
    expect(simulatorFixtureViewPlan("sendNow")).toMatchObject({
      action: "store-voice",
      pendingSessionVoice: simulatorSendNowPendingSessionVoice(),
      voiceText: "",
    });
    expect(simulatorFixtureViewPlan("voiceReview")).toMatchObject({
      action: "voice-review",
      draft: VOICE_REVIEW_FIXTURE_DRAFT,
      transcript: SIMULATOR_FIXTURE_TRANSCRIPT,
    });
    expect(simulatorFixtureViewPlan("canvas")).toEqual({
      action: "canvas",
      text: CANVAS_FIXTURE_TEXT,
    });
    expect(simulatorEmojiProbeTextFromSearch("?emojiText=%E2%98%80%EF%B8%8F")).toBe("☀️");
    expect(simulatorEmojiProbeTextFromSearch("")).toBe(EMOJI_PROBE_DEFAULT_TEXT);
    expect(simulatorFixtureViewPlan("emojiProbe", "?emojiText=%E2%98%80%EF%B8%8F")).toEqual({
      action: "emoji-probe",
      text: "☀️",
    });
    expect(simulatorFixtureViewPlan("canvasTutorial")).toEqual({ action: "canvas-tutorial" });
    expect(simulatorFixtureViewPlan("approval")).toEqual({
      action: "approval",
      approval: APPROVAL_FIXTURE,
    });
    expect(simulatorFixtureViewPlan("recovery")).toEqual({
      action: "recovery",
      frame: RECOVERY_FIXTURE_FRAME,
    });
  });
});
