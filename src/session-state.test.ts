import { describe, expect, it } from "vitest";
import {
  FALLBACK_MAIN_SESSION,
  FALLBACK_MAIN_SESSION_KEY,
  currentDisplaySessions,
  fallbackSession,
  filterDisplaySessions,
  gatewaySessionListUpdate,
  isMainSessionKey,
  selectExistingSessionKey,
  sessionSelectOptions,
  validGatewaySessions,
} from "./session-state";

describe("session state helpers", () => {
  it("provides a stable fallback display session", () => {
    expect(currentDisplaySessions([])).toEqual([FALLBACK_MAIN_SESSION]);
    expect(fallbackSession("")).toEqual({ key: FALLBACK_MAIN_SESSION_KEY });
  });

  it("recognizes OpenClaw main session keys", () => {
    expect(isMainSessionKey("agent:main:main")).toBe(true);
    expect(isMainSessionKey("agent:default:direct:main")).toBe(false);
  });

  it("filters structurally internal sessions", () => {
    expect(filterDisplaySessions([
      { key: "agent:main:cron:daily" },
      { key: "agent:main:direct:work" },
    ])).toEqual([{ key: "agent:main:direct:work" }]);
  });

  it("keeps only gateway sessions with string keys", () => {
    expect(validGatewaySessions([
      { key: "agent:main:main", preview: "Main" },
      { key: "" },
      { key: 42 },
      null,
      { label: "missing key" },
    ])).toEqual([{ key: "agent:main:main", preview: "Main" }]);
    expect(validGatewaySessions(null)).toEqual([]);
  });

  it("keeps preferred sessions only when they still exist", () => {
    const sessions = [
      { key: "agent:main:direct:first" },
      { key: "agent:main:main" },
    ];

    expect(selectExistingSessionKey(sessions, "agent:main:direct:first")).toBe("agent:main:direct:first");
    expect(selectExistingSessionKey(sessions, "missing")).toBe("agent:main:main");
  });

  it("plans gateway session list updates", () => {
    expect(gatewaySessionListUpdate(null, "agent:main:main")).toEqual({
      sessions: [],
      activeSessionKey: "",
      changed: false,
      shouldSwitchSession: false,
      shouldRequestTranscript: false,
      shouldResetTranscript: false,
    });

    expect(gatewaySessionListUpdate([
      { key: "agent:main:direct:first" },
      { key: "agent:main:main" },
    ], "agent:main:direct:first")).toEqual({
      sessions: [
        { key: "agent:main:direct:first" },
        { key: "agent:main:main" },
      ],
      activeSessionKey: "agent:main:direct:first",
      changed: false,
      shouldSwitchSession: false,
      shouldRequestTranscript: false,
      shouldResetTranscript: false,
    });

    expect(gatewaySessionListUpdate([
      { key: "agent:main:main" },
      { key: "agent:main:direct:first" },
    ], "missing")).toEqual({
      sessions: [
        { key: "agent:main:main" },
        { key: "agent:main:direct:first" },
      ],
      activeSessionKey: "agent:main:main",
      changed: true,
      shouldSwitchSession: true,
      shouldRequestTranscript: true,
      shouldResetTranscript: true,
    });
  });

  it("adds a fallback active session to select options when it is missing", () => {
    expect(sessionSelectOptions([
      { key: "agent:main:main" },
      { key: "agent:main:main", preview: "duplicate" },
      { key: "" },
    ], "agent:main:direct:missing")).toEqual([
      { key: "agent:main:direct:missing" },
      { key: "agent:main:main" },
    ]);
  });
});
