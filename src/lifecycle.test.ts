import { describe, expect, it } from "vitest";
import {
  createEvenHubLifecycleDedupe,
  evenHubLifecycleActionFromEvent,
  evenHubLifecycleRoute,
  foregroundHadActiveVoice,
  foregroundResumeStatus,
  isForegroundBridgeAvailable,
  shouldCloseGatewayForLifecycleAction,
  shouldReconnectOnForegroundResume,
  shouldResumeForegroundWorkForPageShow,
} from "./lifecycle";

describe("isForegroundBridgeAvailable", () => {
  it("requires an Even Hub bridge, not a visible phone WebView", () => {
    expect(isForegroundBridgeAvailable(true, "visible")).toBe(true);
    expect(isForegroundBridgeAvailable(false, "visible")).toBe(false);
    expect(isForegroundBridgeAvailable(true, "hidden")).toBe(true);
    expect(isForegroundBridgeAvailable(true, "unknown")).toBe(true);
  });
});

describe("shouldResumeForegroundWorkForPageShow", () => {
  it("uses browser pageshow as a best-effort resume signal when visibility is known", () => {
    expect(shouldResumeForegroundWorkForPageShow("visible")).toBe(true);
    expect(shouldResumeForegroundWorkForPageShow("hidden")).toBe(true);
    expect(shouldResumeForegroundWorkForPageShow("unknown")).toBe(false);
  });
});

describe("foregroundResumeStatus", () => {
  it("restores backgrounded nodes to ready when they are still connected", () => {
    expect(foregroundResumeStatus("backgrounded", true, false)).toBe("ready");
  });

  it("reports voice cancellation when live-bridge voice was interrupted", () => {
    expect(foregroundResumeStatus("voice: listening", true, true)).toBe("voice canceled");
    expect(foregroundResumeStatus("backgrounded", true, true)).toBe("voice canceled");
    expect(foregroundResumeStatus("voice: listening", false, true, true)).toBe("voice canceled; reconnecting");
  });

  it("leaves unrelated foreground statuses unchanged", () => {
    expect(foregroundResumeStatus("ready", true, false)).toBeNull();
    expect(foregroundResumeStatus("backgrounded", false, false)).toBeNull();
  });

  it("reports reconnecting when resume needs a Gateway reconnect without interrupted voice", () => {
    expect(foregroundResumeStatus("ready", false, false, true)).toBe("resuming");
  });
});

describe("foreground pause/resume helpers", () => {
  it("detects active voice views and capture state", () => {
    expect(foregroundHadActiveVoice({ voiceCaptureActive: true, glassView: "sessionHome" })).toBe(true);
    expect(foregroundHadActiveVoice({ voiceCaptureActive: false, glassView: "listening" })).toBe(true);
    expect(foregroundHadActiveVoice({ voiceCaptureActive: false, glassView: "voiceDraftPending" })).toBe(true);
    expect(foregroundHadActiveVoice({ voiceCaptureActive: false, glassView: "voiceDraft" })).toBe(false);
  });

  it("detects when foreground resume needs a Gateway reconnect", () => {
    expect(shouldReconnectOnForegroundResume({ gatewayUrl: " wss://gateway ", connected: false })).toBe(true);
    expect(shouldReconnectOnForegroundResume({ gatewayUrl: "", connected: false })).toBe(false);
    expect(shouldReconnectOnForegroundResume({ gatewayUrl: "wss://gateway", connected: true })).toBe(false);
  });
});

describe("shouldCloseGatewayForLifecycleAction", () => {
  it("only closes Gateway sessions for terminal lifecycle actions", () => {
    expect(shouldCloseGatewayForLifecycleAction("foregroundEnter")).toBe(false);
    expect(shouldCloseGatewayForLifecycleAction("foregroundExit")).toBe(false);
    expect(shouldCloseGatewayForLifecycleAction("abnormalExit")).toBe(true);
    expect(shouldCloseGatewayForLifecycleAction("systemExit")).toBe(true);
  });
});

describe("evenHubLifecycleRoute", () => {
  it("leaves non-lifecycle events available for input handling", () => {
    expect(evenHubLifecycleRoute({ action: null, shouldProcess: false })).toBe("none");
  });

  it("ignores duplicate lifecycle events after dedupe", () => {
    expect(evenHubLifecycleRoute({ action: "foregroundEnter", shouldProcess: false })).toBe("ignore");
  });

  it("routes lifecycle actions to foreground or close handling", () => {
    expect(evenHubLifecycleRoute({ action: "foregroundEnter", shouldProcess: true })).toBe("resume-foreground");
    expect(evenHubLifecycleRoute({ action: "foregroundExit", shouldProcess: true })).toBe("pause-foreground");
    expect(evenHubLifecycleRoute({ action: "abnormalExit", shouldProcess: true })).toBe("close-transport");
    expect(evenHubLifecycleRoute({ action: "systemExit", shouldProcess: true })).toBe("close-transport");
  });
});

describe("createEvenHubLifecycleDedupe", () => {
  it("suppresses duplicate lifecycle actions inside the dedupe window", () => {
    let now = 1_000;
    const shouldProcess = createEvenHubLifecycleDedupe(() => now, 600);

    expect(shouldProcess("foregroundExit")).toBe(true);
    now += 100;
    expect(shouldProcess("foregroundExit")).toBe(false);
    now += 600;
    expect(shouldProcess("foregroundExit")).toBe(true);
  });

  it("does not suppress different lifecycle actions", () => {
    let now = 1_000;
    const shouldProcess = createEvenHubLifecycleDedupe(() => now, 600);

    expect(shouldProcess("foregroundExit")).toBe(true);
    now += 100;
    expect(shouldProcess("foregroundEnter")).toBe(true);
  });
});

describe("evenHubLifecycleActionFromEvent", () => {
  it("maps Even Hub lifecycle sys events", () => {
    expect(evenHubLifecycleActionFromEvent({ sysEvent: { eventType: 4 } })).toBe("foregroundEnter");
    expect(evenHubLifecycleActionFromEvent({ sysEvent: { eventType: 5 } })).toBe("foregroundExit");
    expect(evenHubLifecycleActionFromEvent({ sysEvent: { eventType: 6 } })).toBe("abnormalExit");
    expect(evenHubLifecycleActionFromEvent({ sysEvent: { eventType: 7 } })).toBe("systemExit");
  });

  it("accepts SDK-style lifecycle event names", () => {
    expect(evenHubLifecycleActionFromEvent({ sysEvent: { eventType: "FOREGROUND_ENTER_EVENT" } })).toBe("foregroundEnter");
    expect(evenHubLifecycleActionFromEvent({ sysEvent: { eventType: "FOREGROUND_EXIT_EVENT" } })).toBe("foregroundExit");
    expect(evenHubLifecycleActionFromEvent({ sysEvent: { eventType: "ABNORMAL_EXIT_EVENT" } })).toBe("abnormalExit");
    expect(evenHubLifecycleActionFromEvent({ sysEvent: { eventType: "SYSTEM_EXIT_EVENT" } })).toBe("systemExit");
  });

  it("ignores input events and missing sys events", () => {
    expect(evenHubLifecycleActionFromEvent({ sysEvent: { eventType: 0 } })).toBeNull();
    expect(evenHubLifecycleActionFromEvent({})).toBeNull();
  });
});
