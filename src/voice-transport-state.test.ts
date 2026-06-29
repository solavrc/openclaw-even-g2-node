import { describe, expect, it } from "vitest";
import {
  VOICE_CLOSED_BEFORE_TRANSCRIPT_ERROR,
  VOICE_FINALIZE_CLOSE_TIMEOUT_MS,
  canSendVoiceAudio,
  isCurrentVoiceTransportGeneration,
  nextVoiceTransportGeneration,
  shouldCloseVoiceTransportWithoutFinalize,
  voiceCaptureOpeningOrActive,
  voiceStartAction,
  voiceStartTimerPlan,
  voiceStopListeningViewState,
  voiceTransportClosedPlan,
  voiceTransportCloseAction,
} from "./voice-transport-state";

describe("voice transport state", () => {
  const states = { open: 1, closing: 2 };

  it("chooses close actions from transport readyState", () => {
    expect(voiceTransportCloseAction(1, states)).toBe("finalize");
    expect(voiceTransportCloseAction(0, states)).toBe("close");
    expect(voiceTransportCloseAction(2, states)).toBe("none");
    expect(voiceTransportCloseAction(3, states)).toBe("none");
  });

  it("detects transports that can be closed without finalizing", () => {
    expect(shouldCloseVoiceTransportWithoutFinalize(0, states.closing)).toBe(true);
    expect(shouldCloseVoiceTransportWithoutFinalize(1, states.closing)).toBe(true);
    expect(shouldCloseVoiceTransportWithoutFinalize(2, states.closing)).toBe(false);
  });

  it("tracks current voice transport generations", () => {
    expect(nextVoiceTransportGeneration(0)).toBe(1);
    expect(nextVoiceTransportGeneration(4)).toBe(5);
    expect(isCurrentVoiceTransportGeneration(5, 5)).toBe(true);
    expect(isCurrentVoiceTransportGeneration(6, 5)).toBe(false);
  });

  it("allows voice audio only when bytes are present and the transport is open", () => {
    expect(canSendVoiceAudio({ byteLength: 12, readyState: 1, openState: 1 })).toBe(true);
    expect(canSendVoiceAudio({ byteLength: 0, readyState: 1, openState: 1 })).toBe(false);
    expect(canSendVoiceAudio({ byteLength: 12, readyState: 0, openState: 1 })).toBe(false);
  });

  it("detects active or opening voice capture state", () => {
    expect(voiceCaptureOpeningOrActive({
      listening: false,
      hasVoiceTransport: false,
      hasPendingNodeCommand: false,
      hasPendingSessionVoice: false,
    })).toBe(false);
    expect(voiceCaptureOpeningOrActive({
      listening: false,
      hasVoiceTransport: true,
      hasPendingNodeCommand: false,
      hasPendingSessionVoice: false,
    })).toBe(true);
    expect(voiceCaptureOpeningOrActive({
      listening: false,
      hasVoiceTransport: false,
      hasPendingNodeCommand: true,
      hasPendingSessionVoice: false,
    })).toBe(true);
  });

  it("chooses the voice start action from current capture state", () => {
    expect(voiceStartAction({
      listening: true,
      hasVoiceTransport: true,
      hasPendingNodeCommand: false,
      hasPendingSessionVoice: false,
    })).toBe("stop-listening");
    expect(voiceStartAction({
      listening: false,
      hasVoiceTransport: true,
      hasPendingNodeCommand: false,
      hasPendingSessionVoice: false,
    })).toBe("busy");
    expect(voiceStartAction({
      listening: false,
      hasVoiceTransport: false,
      hasPendingNodeCommand: false,
      hasPendingSessionVoice: false,
    })).toBe("start");
  });

  it("plans voice start timers using existing fallback order", () => {
    expect(voiceStartTimerPlan({
      nodeCommandId: "cmd-1",
      autoStopMs: 5000,
      userLimitMs: 60000,
      defaultLimitMs: 60000,
    })).toEqual({
      hardStopMs: 5000,
      nodeAutoStopMs: 5000,
    });
    expect(voiceStartTimerPlan({
      nodeCommandId: null,
      userLimitMs: 30000,
      defaultLimitMs: 60000,
    })).toEqual({
      hardStopMs: 30000,
      nodeAutoStopMs: null,
    });
    expect(voiceStartTimerPlan({
      nodeCommandId: null,
      userLimitMs: 0,
      defaultLimitMs: 60000,
    })).toEqual({
      hardStopMs: 60000,
      nodeAutoStopMs: null,
    });
  });

  it("keeps voice close constants explicit", () => {
    expect(VOICE_FINALIZE_CLOSE_TIMEOUT_MS).toBe(60000);
    expect(VOICE_CLOSED_BEFORE_TRANSCRIPT_ERROR).toContain("before OpenClaw returned a transcript");
  });

  it("plans close results for node commands and pending session voice", () => {
    expect(voiceTransportClosedPlan({
      nodeCommandId: "cmd-1",
      transcriptText: " partial ",
      pendingSessionVoice: null,
    })).toEqual({
      nodeCommandResult: {
        id: "cmd-1",
        ok: true,
        payload: { text: "partial" },
        error: undefined,
        status: "voice: sent partial to node",
      },
      sessionFailure: null,
    });
    expect(voiceTransportClosedPlan({
      nodeCommandId: "cmd-1",
      transcriptText: "",
      pendingSessionVoice: null,
    })).toEqual({
      nodeCommandResult: {
        id: "cmd-1",
        ok: false,
        payload: {},
        error: {
          code: "VOICE_CLOSED",
          message: "Voice capture closed before a transcript was produced.",
        },
        status: "voice closed",
      },
      sessionFailure: null,
    });
    expect(voiceTransportClosedPlan({
      nodeCommandId: null,
      transcriptText: "",
      pendingSessionVoice: {
        mode: "direct",
        targetSessionKey: "session",
        idempotencyKey: "id",
      },
    })).toEqual({
      nodeCommandResult: null,
      sessionFailure: {
        errorText: VOICE_CLOSED_BEFORE_TRANSCRIPT_ERROR,
      },
    });
  });

  it("maps pending session voice to the post-stop view state", () => {
    expect(voiceStopListeningViewState({
      mode: "review",
      targetSessionKey: "session",
      idempotencyKey: "id",
    })).toEqual({
      draftPendingPhase: "draft",
      sessionHomeStatus: "",
    });
    expect(voiceStopListeningViewState({
      mode: "direct",
      targetSessionKey: "session",
      idempotencyKey: "id",
    })).toEqual({
      draftPendingPhase: null,
      sessionHomeStatus: "sending...",
    });
    expect(voiceStopListeningViewState(null)).toEqual({
      draftPendingPhase: null,
      sessionHomeStatus: "ready",
    });
  });
});
