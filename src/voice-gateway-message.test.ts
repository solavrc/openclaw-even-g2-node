import { describe, expect, it, vi } from "vitest";
import {
  bridgeVoiceStartConfig,
  initialVoiceDraftPendingPhase,
  isEmptyVoiceDraftText,
  pendingVoiceOpenFailurePlan,
  pendingSessionVoiceForStart,
  reviewVoiceFailureFromPendingSession,
  sessionVoiceModeFromSetting,
  transcriptionFailedNodeError,
  sessionVoiceSentPlan,
  voiceTranscriptionFailedPlan,
  voiceDraftFromGatewayPayload,
  voiceDraftFailedPlan,
  voiceDraftPendingPhaseFromGatewayPayload,
  voiceDraftReadyPlan,
  voiceFailureFromPendingSession,
  voiceGatewayErrorText,
  voiceGatewayEventKind,
  voiceGatewayEventName,
  voiceGatewayEventRoute,
  voiceSentSessionInfo,
  voiceTranscriptEventPlan,
} from "./voice-gateway-message";

describe("voice gateway message helpers", () => {
  it("normalizes event names and errors", () => {
    expect(voiceGatewayEventName({ event: "transcript.final", type: "ignored" })).toBe("transcript.final");
    expect(voiceGatewayEventName({ type: "voice.draft.ready" })).toBe("voice.draft.ready");
    expect(voiceGatewayEventKind("transcription.failed")).toBe("transcription-failed");
    expect(voiceGatewayEventKind("transcription.started")).toBe("transcription-started");
    expect(voiceGatewayEventKind("voice.processing")).toBe("voice-processing");
    expect(voiceGatewayEventKind("voice.draft.ready")).toBe("voice-draft-ready");
    expect(voiceGatewayEventKind("voice.draft.failed")).toBe("voice-draft-failed");
    expect(voiceGatewayEventKind("session.voice.sent")).toBe("session-voice-sent");
    expect(voiceGatewayEventKind("transcript.partial")).toBe("transcript");
    expect(voiceGatewayEventKind("transcript.final")).toBe("transcript");
    expect(voiceGatewayEventKind("unexpected")).toBe("unknown");
    expect(voiceGatewayEventRoute({ event: "transcript.final" })).toEqual({
      eventName: "transcript.final",
      kind: "transcript",
    });
    expect(voiceGatewayErrorText({ code: "TRANSCRIPTION_FAILED" }, "fallback")).toBe("TRANSCRIPTION_FAILED");
    expect(voiceGatewayErrorText({}, "fallback")).toBe("fallback");
    expect(transcriptionFailedNodeError({ code: "NO_AUDIO" }, "No audio")).toEqual({
      code: "NO_AUDIO",
      message: "No audio",
    });
    expect(transcriptionFailedNodeError({}, "No audio")).toEqual({
      code: "TRANSCRIPTION_FAILED",
      message: "No audio",
    });
  });

  it("plans transcription failure results", () => {
    const pendingSessionVoice = {
      mode: "review" as const,
      targetSessionKey: "session",
      idempotencyKey: "idem",
      transcriptionProvider: "provider-a",
    };

    expect(voiceTranscriptionFailedPlan({
      payload: { code: "NO_AUDIO" },
      nodeCommandId: "cmd-1",
      pendingSessionVoice,
      fallbackMode: "direct",
      at: 123,
    })).toEqual({
      errorText: "NO_AUDIO",
      nodeCommandResult: {
        id: "cmd-1",
        ok: false,
        payload: {},
        error: {
          code: "NO_AUDIO",
          message: "NO_AUDIO",
        },
      },
      voiceFailure: {
        error: "NO_AUDIO",
        mode: "review",
        providerId: "provider-a",
        at: 123,
      },
      shouldClearPendingSessionVoice: true,
      shouldRenderFailure: true,
    });
    expect(voiceTranscriptionFailedPlan({
      payload: {},
      fallbackMode: "direct",
      at: 123,
    })).toEqual({
      errorText: "Transcription failed",
      nodeCommandResult: null,
      voiceFailure: null,
      shouldClearPendingSessionVoice: false,
      shouldRenderFailure: false,
    });
  });

  it("normalizes pending draft phases", () => {
    expect(voiceDraftPendingPhaseFromGatewayPayload({ phase: "upload" })).toBe("upload");
    expect(voiceDraftPendingPhaseFromGatewayPayload({ phase: "draft" })).toBe("draft");
    expect(voiceDraftPendingPhaseFromGatewayPayload({ phase: "other" })).toBe("preprocess");
  });

  it("rejects empty and no-speech draft text", () => {
    expect(isEmptyVoiceDraftText("")).toBe(true);
    expect(isEmptyVoiceDraftText("  NO_SPEECH  ")).toBe(true);
    expect(isEmptyVoiceDraftText("send this")).toBe(false);
  });

  it("builds voice drafts with payload values first", () => {
    const createId = vi.fn(() => "generated-id");

    expect(voiceDraftFromGatewayPayload({
      text: "  Send this  ",
      targetSessionKey: "payload-session",
      idempotencyKey: "payload-id",
    }, {
      activeSessionKey: "active-session",
      createIdempotencyKey: createId,
    })).toEqual({
      text: "Send this",
      targetSessionKey: "payload-session",
      idempotencyKey: "payload-id",
    });
    expect(createId).not.toHaveBeenCalled();
  });

  it("plans voice draft ready states", () => {
    const createId = vi.fn(() => "generated-id");

    expect(voiceDraftReadyPlan({
      text: "  Send this  ",
      targetSessionKey: "payload-session",
      idempotencyKey: "payload-id",
    }, {
      activeSessionKey: "active-session",
      createIdempotencyKey: createId,
    })).toEqual({
      draft: {
        text: "Send this",
        targetSessionKey: "payload-session",
        idempotencyKey: "payload-id",
      },
      noSpeech: false,
      status: "voice transcript ready",
    });
    expect(voiceDraftReadyPlan({ text: "NO_SPEECH" }, {
      activeSessionKey: "active-session",
      createIdempotencyKey: createId,
    })).toEqual({
      draft: null,
      noSpeech: true,
      status: "voice: no speech detected",
    });
  });

  it("falls back to pending session voice before generating ids", () => {
    const createId = vi.fn(() => "generated-id");

    expect(voiceDraftFromGatewayPayload({ text: "draft" }, {
      pendingSessionVoice: {
        mode: "review",
        targetSessionKey: "pending-session",
        idempotencyKey: "pending-id",
      },
      activeSessionKey: "active-session",
      createIdempotencyKey: createId,
    })).toEqual({
      text: "draft",
      targetSessionKey: "pending-session",
      idempotencyKey: "pending-id",
    });
    expect(createId).not.toHaveBeenCalled();
  });

  it("builds sent session info with lazy generated id fallback", () => {
    const createId = vi.fn(() => "generated-id");

    expect(voiceSentSessionInfo({}, {
      activeSessionKey: "active-session",
      createIdempotencyKey: createId,
    })).toEqual({
      sessionKey: "active-session",
      idempotencyKey: "generated-id",
    });
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it("plans session voice sent updates", () => {
    const createId = vi.fn(() => "generated-id");
    const pendingSessionVoice = {
      mode: "direct" as const,
      targetSessionKey: "pending-session",
      idempotencyKey: "pending-id",
    };

    expect(sessionVoiceSentPlan({ sessionKey: "payload-session", idempotencyKey: "payload-id" }, {
      nodeCommandId: "cmd-1",
      pendingSessionVoice,
      activeSessionKey: "active-session",
      createIdempotencyKey: createId,
    })).toEqual({
      sent: {
        sessionKey: "payload-session",
        idempotencyKey: "payload-id",
      },
      nodeCommandResult: {
        id: "cmd-1",
        ok: true,
        payload: { status: "sent" },
      },
      optimisticUserMessage: {
        sessionKey: "payload-session",
        text: "Voice submitted",
        idempotencyKey: "payload-id",
      },
      status: "voice submitted to OpenClaw",
      sessionHomeStatus: "voice submitted",
    });
    expect(createId).not.toHaveBeenCalled();
  });

  it("builds Even G2 bridge voice start config for review mode", () => {
    const createId = vi.fn(() => "generated-id");

    expect(bridgeVoiceStartConfig({
      pendingSessionVoice: {
        mode: "review",
        targetSessionKey: "target-session",
        idempotencyKey: "pending-id",
        transcriptionProvider: "review-provider",
      },
      activeSessionKey: "active-session",
      createIdempotencyKey: createId,
    })).toEqual({
      format: {
        encoding: "pcm_s16le",
        sampleRateHz: 16000,
        channels: 1,
        endianness: "little",
      },
      transcriptionMode: "talk-relay",
      transcriptionProvider: "review-provider",
      sessionKey: "target-session",
      targetSessionKey: "target-session",
      draftTimeoutMs: 8000,
      idempotencyKey: "pending-id",
    });
    expect(createId).not.toHaveBeenCalled();
  });

  it("builds attachment voice start config without pending session voice", () => {
    const createId = vi.fn(() => "generated-id");

    expect(bridgeVoiceStartConfig({
      activeSessionKey: "active-session",
      createIdempotencyKey: createId,
    })).toMatchObject({
      transcriptionMode: "attachment",
      sessionKey: "active-session",
      draftTimeoutMs: 8000,
      idempotencyKey: "generated-id",
    });
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it("builds pending session voice state for a session voice start", () => {
    expect(sessionVoiceModeFromSetting("off")).toBe("review");
    expect(sessionVoiceModeFromSetting("direct")).toBe("direct");
    expect(initialVoiceDraftPendingPhase("review")).toBe("draft");
    expect(initialVoiceDraftPendingPhase("direct")).toBe("preprocess");
    expect(pendingSessionVoiceForStart({
      mode: "review",
      targetSessionKey: "session",
      idempotencyKey: "idem",
      transcriptionProvider: "provider-a",
    })).toEqual({
      mode: "review",
      targetSessionKey: "session",
      idempotencyKey: "idem",
      transcriptionProvider: "provider-a",
    });
    expect(pendingSessionVoiceForStart({
      mode: "direct",
      targetSessionKey: "session",
      idempotencyKey: "idem",
    })).toEqual({
      mode: "direct",
      targetSessionKey: "session",
      idempotencyKey: "idem",
    });
  });

  it("builds voice failure records and review failure inputs", () => {
    const pendingSessionVoice = {
      mode: "review" as const,
      targetSessionKey: "session",
      idempotencyKey: "idem",
      transcriptionProvider: "provider-a",
    };

    expect(voiceFailureFromPendingSession({
      error: "failed",
      pendingSessionVoice,
      fallbackMode: "direct",
      at: 123,
    })).toEqual({
      error: "failed",
      mode: "review",
      providerId: "provider-a",
      at: 123,
    });
    expect(voiceFailureFromPendingSession({
      error: "failed",
      fallbackMode: "direct",
      at: 123,
    })).toEqual({
      error: "failed",
      mode: "direct",
      providerId: undefined,
      at: 123,
    });
    expect(reviewVoiceFailureFromPendingSession("failed", pendingSessionVoice)).toEqual({
      error: "failed",
      mode: "review",
      providerId: "provider-a",
    });
    expect(reviewVoiceFailureFromPendingSession("failed", {
      ...pendingSessionVoice,
      mode: "direct",
    })).toBeNull();
  });

  it("plans voice draft failures", () => {
    const pendingSessionVoice = {
      mode: "review" as const,
      targetSessionKey: "session",
      idempotencyKey: "idem",
      transcriptionProvider: "provider-a",
    };

    expect(voiceDraftFailedPlan({
      payload: { error: "draft failed" },
      pendingSessionVoice,
      fallbackMode: "direct",
      at: 123,
    })).toEqual({
      errorText: "draft failed",
      voiceFailure: {
        error: "draft failed",
        mode: "review",
        providerId: "provider-a",
        at: 123,
      },
      shouldClearPendingSessionVoice: true,
    });
    expect(voiceDraftFailedPlan({
      payload: {},
      fallbackMode: "direct",
      at: 123,
    })).toEqual({
      errorText: "Voice transcript failed",
      voiceFailure: {
        error: "Voice transcript failed",
        mode: "direct",
        providerId: undefined,
        at: 123,
      },
      shouldClearPendingSessionVoice: false,
    });
  });

  it("builds pending voice open failure plans", () => {
    const pendingSessionVoice = {
      mode: "review" as const,
      targetSessionKey: "session",
      idempotencyKey: "idem",
      transcriptionProvider: "provider-a",
    };

    expect(pendingVoiceOpenFailurePlan({
      error: "microphone failed",
      code: "VOICE_OPEN_FAILED",
      nodeCommandId: "cmd-1",
      pendingSessionVoice,
      fallbackMode: "direct",
      at: 123,
    })).toEqual({
      nodeCommandResult: {
        id: "cmd-1",
        ok: false,
        payload: {},
        error: {
          code: "VOICE_OPEN_FAILED",
          message: "microphone failed",
        },
      },
      voiceFailure: {
        error: "microphone failed",
        mode: "review",
        providerId: "provider-a",
        at: 123,
      },
      shouldRenderFailure: true,
    });
    expect(pendingVoiceOpenFailurePlan({
      error: "microphone failed",
      code: "VOICE_OPEN_FAILED",
      fallbackMode: "direct",
      at: 123,
    })).toEqual({
      nodeCommandResult: null,
      voiceFailure: null,
      shouldRenderFailure: false,
    });
  });

  it("plans transcript partial and final events", () => {
    expect(voiceTranscriptEventPlan({
      eventName: "transcript.partial",
      payload: { text: "hel" },
      currentText: "",
    })).toEqual({
      nextText: "hel",
      isFinal: false,
      nodeCommandResult: null,
      standaloneTranscript: null,
    });
    expect(voiceTranscriptEventPlan({
      eventName: "transcript.final",
      payload: { text: "hello" },
      currentText: "hel",
      nodeCommandId: "cmd-1",
    })).toEqual({
      nextText: "hello",
      isFinal: true,
      nodeCommandResult: {
        id: "cmd-1",
        ok: true,
        payload: { text: "hello" },
        status: "voice: sent to node",
      },
      standaloneTranscript: null,
    });
    expect(voiceTranscriptEventPlan({
      eventName: "transcript.final",
      payload: {},
      currentText: "fallback text",
    })).toEqual({
      nextText: "",
      isFinal: true,
      nodeCommandResult: null,
      standaloneTranscript: {
        text: "fallback text",
        status: "voice transcript ready",
      },
    });
  });
});
