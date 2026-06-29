import { describe, expect, it } from "vitest";
import {
  formatGlassApprovalDecisionFrame,
  formatGlassApprovalView,
  formatGlassApprovalViewFrame,
  formatGlassSessionCreateFailedFrame,
  formatGlassListeningView,
  formatGlassListeningViewFrame,
  formatGlassSessionView,
  formatGlassSessionViewFrame,
  formatGlassVoiceDraftPendingView,
  formatGlassVoiceDraftPendingViewFrame,
  formatGlassVoiceDraftView,
  formatGlassVoiceDraftViewFrame,
  glassHudFrameToText,
  glassStatusFrame,
  labelForSession,
} from "./glass";
import { glassInputActionFromEvent } from "./glass-events";

const UTF8_ENCODER = new TextEncoder();

describe("glass input events", () => {
  it("normalizes numeric and string event types", () => {
    expect(glassInputActionFromEvent({ textEvent: { eventType: 0 } })).toBe("click");
    expect(glassInputActionFromEvent({ textEvent: { eventType: "SCROLL_TOP_EVENT" } })).toBe("up");
    expect(glassInputActionFromEvent({ listEvent: { eventType: "SCROLL_BOTTOM" } })).toBe("down");
    expect(glassInputActionFromEvent({ sysEvent: { eventType: "DOUBLE_CLICK_EVENT" } })).toBe("doubleClick");
  });

  it("treats source-only touch sys events as tap", () => {
    expect(glassInputActionFromEvent({ sysEvent: { eventSource: 1 } })).toBe("click");
  });

  it("treats list selection events without eventType as tap", () => {
    expect(glassInputActionFromEvent({ listEvent: { containerName: "session-list" } })).toBe("click");
  });
});

describe("glass listening view", () => {
  it("formats listening as a structured HUD frame", () => {
    const frame = formatGlassListeningViewFrame({
      activeSessionLabel: "main",
      transcript: "Summarize the latest release blockers",
    });

    expect(frame.header).toBe("Recording    · main · review");
    expect(frame.body).toBe("Summarize the latest release blockers");
    expect(frame.hint).toBe("tap stop · 2-tap cancel");
    expect(formatGlassListeningView({
      activeSessionLabel: "main",
      transcript: "Summarize the latest release blockers",
    })).toBe(glassHudFrameToText(frame));
  });

  it("keeps the active session and stop action visible", () => {
    const text = formatGlassListeningView({
      activeSessionLabel: "main",
      transcript: "Summarize the latest release blockers",
    });

    expect(text).toContain("main");
    expect(text).toContain("Summarize the latest release blockers");
    expect(text).toContain("Recording    · main · review");
    expect(text).not.toContain("[ Review voice ]");
    expect(text).toContain("tap stop");
    expect(text).toContain("2-tap cancel");
  });

  it("shows a stable waiting state before transcript arrives", () => {
    const frame = formatGlassListeningViewFrame({ activeSessionLabel: "main" });
    expect(frame.header).toContain("Recording");
    expect(frame.body).toBe("");
  });

  it("keeps Send now recording anchored to the selected session", () => {
    const frame = formatGlassListeningViewFrame({
      activeSessionLabel: "main",
      voiceMode: "direct",
      recordingPulse: 2,
    });

    expect(frame.header).toBe("Recording..  · main · send");
    expect(frame.body).toBe("[ Send now ]");
    expect(frame.hint).toBe("tap send · 2-tap cancel");
  });
});

describe("glass voice transcript view", () => {
  it("formats review-before-send as a structured HUD frame", () => {
    const frame = formatGlassVoiceDraftViewFrame({
      activeSessionLabel: "main",
      text: "OpenClaw Even G2 nodeについて説明して。",
    });

    expect(frame.header).toBe("main · ready");
    expect(frame.body).not.toContain("[ Review transcript ]");
    expect(frame.body).toContain("OpenClaw Even G2");
    expect(frame.hint).toBe("tap send · 2-tap discard");
    expect(formatGlassVoiceDraftView({
      activeSessionLabel: "main",
      text: "OpenClaw Even G2 nodeについて説明して。",
    })).toBe(glassHudFrameToText(frame));
  });

  it("formats voice processing as a locked structured HUD frame", () => {
    const frame = formatGlassVoiceDraftPendingViewFrame({
      activeSessionLabel: "main",
      stepTitle: "2/3 Sending audio",
      detail: "Sending audio to OpenClaw.",
    });

    expect(frame.header).toBe("main · ready");
    expect(frame.body).toBe("2/3 Sending audio\nSending audio to OpenClaw.");
    expect(frame.hint).toBe("wait...");
    expect(formatGlassVoiceDraftPendingView({
      activeSessionLabel: "main",
      stepTitle: "2/3 Sending audio",
      detail: "Sending audio to OpenClaw.",
    })).toBe(glassHudFrameToText(frame));
  });

  it("shows send and discard actions for a prepared transcript", () => {
    const text = formatGlassVoiceDraftView({
      activeSessionLabel: "main",
      text: "OpenClaw Even G2 nodeについて説明して。",
    });

    expect(text).toContain("main · ready");
    expect(text).toContain("main");
    expect(text).not.toContain("[ Review transcript ]");
    expect(text).toContain("OpenClaw Even G2");
    expect(text).toContain("tap send · 2-tap discard");
  });

  it("shows a locked pending overlay while OpenClaw prepares the transcript", () => {
    const text = formatGlassVoiceDraftPendingView({
      activeSessionLabel: "main",
      stepTitle: "2/3 Sending audio",
      detail: "Sending audio to OpenClaw.",
    });

    expect(text).toContain("main · ready");
    expect(text).toContain("main");
    expect(text).not.toContain("[ Review voice ]");
    expect(text).toContain("2/3 Sending audio");
    expect(text).toContain("Sending audio to OpenClaw");
    expect(text).toContain("wait");
  });
});

describe("glass approval view", () => {
  it("formats approval as a structured HUD frame", () => {
    const frame = formatGlassApprovalViewFrame({
      command: "pnpm check",
      cwd: "/workspace/openclaw-even-g2-node",
    });

    expect(frame.header).toBe("■ APPROVAL · main");
    expect(frame.body).toContain("pnpm check");
    expect(frame.body).toContain("cwd /workspace/openclaw-even-g2-node");
    expect(frame.hint).toBe("tap allow · 2-tap deny");
    expect(formatGlassApprovalView({
      command: "pnpm check",
      cwd: "/workspace/openclaw-even-g2-node",
    })).toBe(glassHudFrameToText(frame));
  });

  it("shows approval actions without phone-only language", () => {
    const text = formatGlassApprovalView({
      command: "pnpm check",
      cwd: "/workspace/openclaw-even-g2-node",
    });

    expect(text).toContain("APPROVAL · main");
    expect(text).toContain("pnpm check");
    expect(text).toContain("tap allow");
    expect(text).toContain("2-tap deny");
    expect(text).not.toContain("phone");
  });

  it("falls back to a readable request label", () => {
    const text = formatGlassApprovalView({});

    expect(text).toContain("OpenClaw request");
    expect(text).toContain("approval required");
  });

  it("formats approval decision acknowledgement frames", () => {
    expect(formatGlassApprovalDecisionFrame("allow-once")).toEqual({
      header: "Approved",
      body: "Waiting for OpenClaw.",
      hint: "wait...",
    });
    expect(formatGlassApprovalDecisionFrame("deny")).toEqual({
      header: "Rejected",
      body: "Waiting for OpenClaw.",
      hint: "wait...",
    });
  });
});

describe("glass session view", () => {
  it("formats the selected session as a structured HUD frame", () => {
    const frame = formatGlassSessionViewFrame({
      activeSessionLabel: "main",
      statusText: "ready",
      messages: [
        { role: "assistant", text: "The node is ready." },
      ],
    });

    expect(frame.header).toBe("main · agent · 1/1");
    expect(frame.body).toBe("The node is ready.");
    expect(frame.hint).toBe("tap speak");
    expect(formatGlassSessionView({
      activeSessionLabel: "main",
      statusText: "ready",
      messages: [
        { role: "assistant", text: "The node is ready." },
      ],
    })).toBe(glassHudFrameToText(frame));
  });

  it("keeps generic status content in body instead of hint", () => {
    expect(glassStatusFrame("OpenClaw Node", "Opening selected session.", "wait...")).toEqual({
      header: "OpenClaw Node",
      body: "Opening selected session.",
      hint: "wait...",
    });
  });

  it("formats session create failures as bounded HUD frames", () => {
    const frame = formatGlassSessionCreateFailedFrame("session creation failed because ".repeat(12));
    expect(frame).toMatchObject({
      header: "Session not created",
      hint: "check phone",
    });
    expect(frame.body).toHaveLength(180);
    expect(frame.body).toMatch(/\.\.\.$/);
  });

  it("bounds unsupported emoji fallback after HUD text normalization", () => {
    const frame = formatGlassVoiceDraftViewFrame({
      activeSessionLabel: "main",
      text: "🔌".repeat(80),
    });

    expect(frame.body).toHaveLength(220);
    expect(frame.body).toMatch(/\.\.\.$/);
    expect(frame.body).toContain("[emoji]");
    expect(frame.body).not.toContain("🔌");
  });

  it("renders the latest turn with a speaker header and no footer", () => {
    const text = formatGlassSessionView({
      activeSessionLabel: "main",
      statusText: "ready",
      messages: [
        { role: "user", text: "question" },
        { role: "assistant", text: "answer" },
      ],
    });

    expect(text).toContain("main · agent");
    expect(text).toContain("tap speak");
    expect(text).toContain("answer");
    expect(text).not.toContain("question");
    expect(text).not.toContain("U question");
    expect(text).not.toContain("A answer");
    expect(text).not.toContain("------------------------------");
    expect(text).not.toContain("/ Waiting input");
    expect(text).not.toContain("[Tap & hold to input]");
  });

  it("moves to older turns with logCursor", () => {
    const text = formatGlassSessionView({
      activeSessionLabel: "main",
      statusText: "ready",
      logCursor: 1,
      messages: [
        { role: "user", text: "question" },
        { role: "assistant", text: "answer" },
      ],
    });

    expect(text).toContain("main · user");
    expect(text).toContain("question");
    expect(text).not.toContain("answer");
  });

  it("wraps long messages instead of truncating them", () => {
    const text = formatGlassSessionView({
      activeSessionLabel: "main",
      statusText: "ready",
      messages: [
        {
          role: "assistant",
          text: "This is a long assistant response that must remain readable on the glasses without replacing the tail with an ellipsis marker.",
        },
      ],
    });

    expect(text).toContain("This is a long assistant response");
    expect(text).toContain("without replacing the tail");
    expect(text).toContain("ellipsis marker.");
    expect(text).not.toContain("...");
  });

  it("keeps one turn per visible screen", () => {
    const text = formatGlassSessionView({
      activeSessionLabel: "main",
      statusText: "ready",
      logCursor: 2,
      messages: [
        { role: "user", text: "one" },
        { role: "assistant", text: "two" },
        { role: "user", text: "three" },
        { role: "assistant", text: "four" },
        { role: "user", text: "five" },
        { role: "assistant", text: "six" },
      ],
    });

    expect(text).toContain("main · agent");
    expect(text).toContain("four");
    expect(text).not.toContain("three");
    expect(text).not.toContain("five");
    expect(text).not.toContain("/ Waiting input 1/");
    expect(text).not.toContain("U one");
    expect(text).not.toContain("A two");
  });

  it("splits long turns into numbered screens", () => {
    const longTurn = "word ".repeat(3000);
    const text = formatGlassSessionView({
      activeSessionLabel: "main",
      statusText: "ready",
      messages: [
        { role: "assistant", text: longTurn },
      ],
    });

    expect(text).toMatch(/main · agent · \d+\/\d+/);
    expect(text).toContain("tap speak");
    expect(text).toContain("word");
    expect(text).not.toContain("/ Waiting input");
    expect(text).not.toContain("...");
  });

  it("splits transcript pages after unsupported glyph replacement", () => {
    const frames = Array.from({ length: 20 }, (_, logCursor) => formatGlassSessionViewFrame({
      activeSessionLabel: "main",
      statusText: "ready",
      logCursor,
      messages: [
        { role: "assistant", text: "🔌".repeat(120) },
      ],
    }));

    const uniqueFrames = [...new Map(frames.map((frame) => [frame.header, frame])).values()];
    expect(uniqueFrames.length).toBeGreaterThan(1);
    expect(uniqueFrames[0]?.body).toContain("[emoji]");
    expect(uniqueFrames.some((frame) => frame.body.includes("🔌"))).toBe(false);
    for (const frame of uniqueFrames) {
      expect(UTF8_ENCODER.encode(glassHudFrameToText(frame)).length).toBeLessThanOrEqual(420);
    }
  });

  it("hides internal or unknown-role transcript entries", () => {
    const text = formatGlassSessionView({
      activeSessionLabel: "main",
      statusText: "ready",
      messages: [
        { role: "tool", text: "{\"status\":\"completed\"}" },
        { text: "{\"status\":\"recorded\"}" },
        { role: "user", text: "What changed?" },
        { role: "assistant", text: "The node is ready." },
      ],
    });

    expect(text).toContain("main · agent");
    expect(text).toContain("The node is ready.");
    expect(text).not.toContain("What changed?");
    expect(text).not.toContain("U What changed?");
    expect(text).not.toContain("A The node is ready.");
    expect(text).not.toContain("status");
    expect(text).not.toContain("? ");
  });

  it("shows a loading state while expanding tool-heavy session history", () => {
    expect(formatGlassSessionView({
      activeSessionLabel: "main",
      statusText: "loading session log",
      messages: [
        { role: "tool", text: "{\"status\":\"completed\"}" },
        { role: "assistant", text: "" },
      ],
    })).toContain("main · loading");
  });

  it("labels main session as main", () => {
    expect(labelForSession({ key: "agent:main:main", preview: "OpenClaw main session" })).toBe("main");
    expect(labelForSession({ key: "agent:work:main", preview: "OpenClaw main session" })).toBe("main");
  });

  it("uses meaningful message text for selected session labels", () => {
    expect(labelForSession({
      key: "agent:main:direct:abc",
      displayName: "direct",
      preview: "直近の設計方針を整理して。",
    })).toBe("直近の設計方針を整理して。");
  });

  it("does not use session keys as selected-session labels", () => {
    expect(labelForSession({
      key: "agent:main:direct:abc",
      displayName: "direct",
    })).toBe("Recent session");
  });
});
