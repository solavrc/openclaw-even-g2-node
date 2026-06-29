import { describe, expect, it } from "vitest";
import {
  SETTINGS_VERSION,
  parseBackgroundSnapshot,
  parseStoredSettings,
  settingsPayloadForStorage,
} from "./settings-storage";

describe("parseStoredSettings", () => {
  it("accepts legacy relayUrl and normalizes voice preferences", () => {
    expect(parseStoredSettings(JSON.stringify({
      relayUrl: " wss://gateway.example/ws ",
      selectedSessionKey: "agent:main:main",
      lastSeenNodeId: "node-1",
      voiceMode: "clean",
      preferredReviewProvider: "custom-stt",
      voiceRecordingLimitSeconds: "120",
      canvasTutorialCompleted: true,
      settingsVersion: SETTINGS_VERSION,
    }))).toEqual({
      gatewayUrl: "wss://gateway.example/ws",
      selectedSessionKey: "agent:main:main",
      lastSeenNodeId: "node-1",
      voiceMode: "review",
      preferredReviewProvider: "custom-stt",
      voiceRecordingLimitSeconds: 120,
      canvasTutorialCompleted: true,
      settingsVersion: SETTINGS_VERSION,
    });
  });

  it("returns an empty object for invalid JSON", () => {
    expect(parseStoredSettings("{")).toEqual({});
  });
});

describe("parseBackgroundSnapshot", () => {
  it("restores only the supported sessionHome snapshot shape", () => {
    expect(parseBackgroundSnapshot({
      settingsVersion: SETTINGS_VERSION,
      gatewayUrl: "wss://gateway.example/ws",
      selectedSessionKey: "agent:main:main",
      voiceMode: "direct",
      preferredReviewProvider: "custom-stt",
      voiceRecordingLimitSeconds: "600",
      glassView: "sessionHome",
      sessionLogCursor: 4,
    })).toEqual({
      settingsVersion: SETTINGS_VERSION,
      gatewayUrl: "wss://gateway.example/ws",
      selectedSessionKey: "agent:main:main",
      voiceMode: "direct",
      preferredReviewProvider: "custom-stt",
      voiceRecordingLimitSeconds: 600,
      glassView: "sessionHome",
      sessionLogCursor: 4,
    });
  });

  it("drops unsupported snapshot fields", () => {
    expect(parseBackgroundSnapshot({
      settingsVersion: 1,
      voiceMode: "bad",
      voiceRecordingLimitSeconds: "bad",
      glassView: "canvas",
      sessionLogCursor: -1,
    })).toEqual({
      settingsVersion: undefined,
      gatewayUrl: undefined,
      selectedSessionKey: undefined,
      voiceMode: undefined,
      preferredReviewProvider: undefined,
      voiceRecordingLimitSeconds: undefined,
      glassView: undefined,
      sessionLogCursor: undefined,
    });
  });
});

describe("settingsPayloadForStorage", () => {
  it("omits default preferences when only a gateway is stored", () => {
    expect(JSON.parse(settingsPayloadForStorage({
      gatewayUrl: "wss://gateway.example/ws",
      voiceMode: "review",
      voiceRecordingLimitSeconds: 60,
    }))).toEqual({
      gatewayUrl: "wss://gateway.example/ws",
      settingsVersion: SETTINGS_VERSION,
    });
  });

  it("keeps gateway-independent preferences without a gateway", () => {
    expect(JSON.parse(settingsPayloadForStorage({
      gatewayUrl: "",
      selectedSessionKey: "agent:main:main",
      lastSeenNodeId: "node-1",
      voiceMode: "direct",
      voiceRecordingLimitSeconds: 600,
      canvasTutorialCompleted: true,
    }))).toEqual({
      gatewayUrl: "",
      selectedSessionKey: "agent:main:main",
      lastSeenNodeId: "node-1",
      voiceMode: "direct",
      voiceRecordingLimitSeconds: 600,
      canvasTutorialCompleted: true,
      settingsVersion: SETTINGS_VERSION,
    });
  });

  it("returns an empty payload when nothing meaningful is stored", () => {
    expect(settingsPayloadForStorage({ gatewayUrl: "" })).toBe("");
  });
});
