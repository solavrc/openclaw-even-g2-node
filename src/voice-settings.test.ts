import { describe, expect, it } from "vitest";
import type { TalkCatalogReviewStatus } from "./talk-catalog";
import {
  normalizeVoiceMode,
  normalizeVoiceRecordingLimitSeconds,
  restoredVoiceRecordingLimitSeconds,
  voiceCapabilityStatus,
  voiceFailureKind,
  voiceHardStopTimeoutMs,
  voiceModeGatewayGuidance,
  voiceModeLabel,
  voiceModeShortLabel,
  voiceProviderNameFromError,
  voiceRecoveryAction,
  voiceRecoveryTitle,
  voiceRecordingLimitLabel,
} from "./voice-settings";

function reviewStatus(state: TalkCatalogReviewStatus["state"]): TalkCatalogReviewStatus {
  const base = {
    label: state,
    detail: state,
    providers: [],
  };
  if (state === "ready") return { ...base, state, providerId: "review-provider" };
  return { ...base, state };
}

describe("voice settings helpers", () => {
  it("normalizes legacy and current voice modes", () => {
    expect(normalizeVoiceMode("review")).toBe("review");
    expect(normalizeVoiceMode("direct")).toBe("direct");
    expect(normalizeVoiceMode("off")).toBe("off");
    expect(normalizeVoiceMode("draft")).toBe("review");
    expect(normalizeVoiceMode("clean")).toBe("review");
    expect(normalizeVoiceMode("unknown")).toBeUndefined();
  });

  it("normalizes voice recording limits", () => {
    expect(normalizeVoiceRecordingLimitSeconds(undefined)).toBe(60);
    expect(normalizeVoiceRecordingLimitSeconds("20")).toBe(30);
    expect(normalizeVoiceRecordingLimitSeconds(601)).toBe(600);
    expect(normalizeVoiceRecordingLimitSeconds(89.6)).toBe(90);
    expect(restoredVoiceRecordingLimitSeconds("bad")).toBeUndefined();
    expect(restoredVoiceRecordingLimitSeconds("120")).toBe(120);
    expect(voiceHardStopTimeoutMs(500)).toBe(1000);
    expect(voiceHardStopTimeoutMs(1234.9)).toBe(1234);
    expect(voiceHardStopTimeoutMs(700_000)).toBe(600_000);
    expect(voiceRecordingLimitLabel(30)).toBe("30 seconds");
    expect(voiceRecordingLimitLabel(60)).toBe("1 minute");
    expect(voiceRecordingLimitLabel(600)).toBe("10 minutes");
  });

  it("formats voice mode labels and setup requests", () => {
    expect(voiceModeLabel("review")).toBe("Review before sending");
    expect(voiceModeShortLabel("direct")).toBe("Send now");
    expect(voiceModeGatewayGuidance("review").request).toContain("Review voice");
    expect(voiceModeGatewayGuidance("direct").request).toContain("Send now voice");
    expect(voiceModeGatewayGuidance("off")).toEqual({});
  });

  it("classifies provider setup failures without naming hard-coded vendors", () => {
    const error = "Realtime transcription provider custom-stt credential expired";

    expect(voiceFailureKind(error)).toBe("voice-setup");
    expect(voiceProviderNameFromError(error)).toBe("custom-stt");
    expect(voiceRecoveryTitle(error, "review")).toBe("Review voice needs Gateway attention");
    expect(voiceRecoveryAction(error, "review")).toContain("configured voice provider for custom-stt");
    expect(voiceRecoveryAction(error, "review")).toContain("provider auth");
    expect(voiceRecoveryAction(error, "review")).toContain("talk.catalog");
    expect(voiceRecoveryAction(error, "review")).toContain("Set up OpenClaw Even G2 Review voice.");
    expect(voiceRecoveryAction(error, "review")).not.toContain("xAI/OpenAI");
  });

  it("summarizes voice capability status", () => {
    expect(voiceCapabilityStatus("off", reviewStatus("unknown"), true)).toBe("voice off");
    expect(voiceCapabilityStatus("review", reviewStatus("unknown"), false)).toBe("voice waits for Gateway");
    expect(voiceCapabilityStatus("direct", reviewStatus("unknown"), true)).toBe("Send now selected");
    expect(voiceCapabilityStatus("review", reviewStatus("ready"), true)).toBe("Review provider listed");
    expect(voiceCapabilityStatus("review", reviewStatus("needs-setup"), true)).toBe("voice setup pending");
  });
});
