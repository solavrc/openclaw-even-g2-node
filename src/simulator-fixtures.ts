import type { OpenClawSession, SessionTranscriptMessage } from "./glass";
import type { PendingApproval } from "./gateway-messages";
import type { EvenG2NodeSnapshot } from "./gateway-messages";
import type { VoiceDraft, PendingSessionVoice } from "./voice-gateway-message";

export const SIMULATOR_FIXTURE_SESSION_KEY = "agent:main:main";

export type SimulatorFixtureMode =
  | "session"
  | "voiceReview"
  | "canvas"
  | "emojiProbe"
  | "canvasTutorial"
  | "approval"
  | "recovery"
  | "storeChat"
  | "storeVoice";

export const SIMULATOR_FIXTURE_SESSIONS: OpenClawSession[] = [
  {
    key: SIMULATOR_FIXTURE_SESSION_KEY,
    lastAgentMessage: "Added retry logic to the upload worker and a backoff on 429s.",
    preview: "Added retry logic to the upload worker and a backoff on 429s.",
    updatedAt: Date.UTC(2026, 5, 25, 12, 4),
  },
  {
    key: "agent:main:direct:api-gateway",
    lastUserMessage: "deploy blocked on gateway auth mismatch",
    preview: "deploy blocked on gateway auth mismatch",
    updatedAt: Date.UTC(2026, 5, 25, 12, 1),
  },
  {
    key: "agent:main:direct:notes",
    lastUserMessage: "summarize the RFC",
    preview: "summarize the RFC",
    updatedAt: Date.UTC(2026, 5, 25, 11, 42),
  },
  ...Array.from({ length: 29 }, (_, index): OpenClawSession => ({
    key: `agent:main:direct:fixture-${index + 1}`,
    lastUserMessage: `fixture session ${index + 1}`,
    preview: `fixture session ${index + 1}`,
    updatedAt: Date.UTC(2026, 5, 25, 11, 41 - index),
  })),
];

export const SIMULATOR_FIXTURE_TRANSCRIPT: SessionTranscriptMessage[] = [
  {
    id: "fixture-user-1",
    role: "user",
    text: "Add a health check to the gateway and wire it into the deploy probe.",
    timestamp: "2026-06-25T12:03:40.000Z",
  },
  {
    id: "fixture-agent-1",
    role: "assistant",
    text: "Added retry logic to the upload worker and a backoff on 429s. The deploy probe now checks the gateway health endpoint before attempting the release.",
    timestamp: "2026-06-25T12:04:51.000Z",
  },
];

export const STORE_CHAT_FIXTURE_TRANSCRIPT: SessionTranscriptMessage[] = [
  {
    id: "store-chat-user-1",
    role: "user",
    text: "What should I do next?",
    timestamp: "2026-06-28T00:00:00.000Z",
  },
  {
    id: "store-chat-agent-1",
    role: "assistant",
    text: "You are live on Even G2. I found the failed check, prepared the fix, and can send the next command when you tap to speak.",
    timestamp: "2026-06-28T00:00:08.000Z",
  },
];

export const SIMULATOR_FIXTURE_GATEWAY_URL = "wss://gateway.example/ws";

export function simulatorFixtureTranscript(mode: SimulatorFixtureMode) {
  return mode === "storeChat" || mode === "storeVoice"
    ? STORE_CHAT_FIXTURE_TRANSCRIPT
    : SIMULATOR_FIXTURE_TRANSCRIPT;
}

export function simulatorNodeSnapshot(mode: SimulatorFixtureMode): EvenG2NodeSnapshot {
  return {
    displayName: "Even G2",
    foreground: { clientCount: 1 },
    nodeConnected: true,
    openclaw: {
      lastConnectedAt: new Date().toISOString(),
      nodeEnabled: true,
      ...(mode === "recovery" ? { lastError: "EVEN_G2_BRIDGE_UNAVAILABLE" } : {}),
    },
    voice: {
      enabled: true,
      transport: "simulator",
    },
  };
}

export function simulatorFixtureBaseState(mode: SimulatorFixtureMode) {
  return {
    gatewayUrl: SIMULATOR_FIXTURE_GATEWAY_URL,
    sessionKey: SIMULATOR_FIXTURE_SESSION_KEY,
    sessions: SIMULATOR_FIXTURE_SESSIONS,
    transcript: simulatorFixtureTranscript(mode),
    nodeSnapshot: simulatorNodeSnapshot(mode),
    status: "ready",
  };
}

export function simulatorStoreVoicePendingSessionVoice(): PendingSessionVoice {
  return {
    mode: "review",
    targetSessionKey: SIMULATOR_FIXTURE_SESSION_KEY,
    idempotencyKey: "store-voice",
  };
}

export const STORE_VOICE_LISTENING_TEXT = "Summarize this thread, then draft the next reply.";

export const VOICE_REVIEW_FIXTURE_DRAFT: VoiceDraft = {
  idempotencyKey: "fixture-draft",
  targetSessionKey: SIMULATOR_FIXTURE_SESSION_KEY,
  text: "Add a health check endpoint to the gateway and wire it into the deploy probe.",
};

export const CANVAS_FIXTURE_TEXT = "main · note · 1/1\n\nDeploy finished - 2 services updated, 0 errors.\n\npushed by gateway";
export const EMOJI_PROBE_DEFAULT_TEXT = "Emoji probe\n\n⚙️ 🔌 🔊 🪢 👍 ❤️ ☀️ ★\n\nwatch simulator LVGL glyph warnings";

export const APPROVAL_FIXTURE: PendingApproval = {
  ask: null,
  command: "make release",
  cwd: "/repo/openclaw-even-g2-node",
  id: "fixture-approval",
  requestId: "fixture-approval",
  type: "eveng2.approval.request",
};

export const RECOVERY_FIXTURE_FRAME = {
  header: "■ NODE UNAVAILABLE",
  body: "Foreground connection is unavailable.",
  hint: "open phone status",
} as const;

export type SimulatorFixtureViewPlan =
  | { action: "session-home" }
  | { action: "store-voice"; pendingSessionVoice: PendingSessionVoice; voiceText: string }
  | { action: "voice-review"; draft: VoiceDraft; transcript: SessionTranscriptMessage[] }
  | { action: "canvas"; text: string }
  | { action: "emoji-probe"; text: string }
  | { action: "canvas-tutorial" }
  | { action: "approval"; approval: PendingApproval }
  | { action: "recovery"; frame: typeof RECOVERY_FIXTURE_FRAME };

export function simulatorEmojiProbeTextFromSearch(search: string) {
  const value = new URLSearchParams(search).get("emojiText") || "";
  return value.trim() || EMOJI_PROBE_DEFAULT_TEXT;
}

export function simulatorFixtureViewPlan(mode: SimulatorFixtureMode, search = ""): SimulatorFixtureViewPlan {
  if (mode === "storeVoice") {
    return {
      action: "store-voice",
      pendingSessionVoice: simulatorStoreVoicePendingSessionVoice(),
      voiceText: STORE_VOICE_LISTENING_TEXT,
    };
  }
  if (mode === "voiceReview") {
    return {
      action: "voice-review",
      draft: VOICE_REVIEW_FIXTURE_DRAFT,
      transcript: SIMULATOR_FIXTURE_TRANSCRIPT,
    };
  }
  if (mode === "canvas") return { action: "canvas", text: CANVAS_FIXTURE_TEXT };
  if (mode === "emojiProbe") return { action: "emoji-probe", text: simulatorEmojiProbeTextFromSearch(search) };
  if (mode === "canvasTutorial") return { action: "canvas-tutorial" };
  if (mode === "approval") return { action: "approval", approval: APPROVAL_FIXTURE };
  if (mode === "recovery") return { action: "recovery", frame: RECOVERY_FIXTURE_FRAME };
  return { action: "session-home" };
}

export function isSimulatorFixtureMode(value: string): value is SimulatorFixtureMode {
  return value === "session"
    || value === "voiceReview"
    || value === "canvas"
    || value === "emojiProbe"
    || value === "canvasTutorial"
    || value === "approval"
    || value === "recovery"
    || value === "storeChat"
    || value === "storeVoice";
}

export function simulatorFixtureModeFromSearch(search: string, isDev: boolean) {
  if (!isDev) return "";
  const value = new URLSearchParams(search).get("simFixture") || "";
  return isSimulatorFixtureMode(value) ? value : "";
}
