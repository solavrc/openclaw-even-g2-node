import type { VoiceGatewayMessage } from "./gateway-messages";
import type { VoiceDraftPendingPhase } from "./voice-hud";
import type { VoiceMode } from "./voice-settings";

export type PendingSessionVoice = {
  mode: Exclude<VoiceMode, "off">;
  targetSessionKey: string;
  idempotencyKey: string;
  transcriptionProvider?: string;
};

export type VoiceDraft = {
  text: string;
  targetSessionKey: string;
  idempotencyKey: string;
};

export type VoiceFailure = {
  error: string;
  mode: VoiceMode;
  at: number;
  providerId?: string;
};

export type BridgeVoiceStartConfig = {
  format: {
    encoding: "pcm_s16le";
    sampleRateHz: 16000;
    channels: 1;
    endianness: "little";
  };
  transcriptionMode: "talk-relay" | "attachment";
  transcriptionProvider?: string;
  sessionKey: string;
  targetSessionKey?: string;
  draftTimeoutMs: 8000;
  idempotencyKey: string;
};

export const EVEN_G2_MICROPHONE_FORMAT = {
  encoding: "pcm_s16le",
  sampleRateHz: 16000,
  channels: 1,
  endianness: "little",
} as const;

export function voiceGatewayEventName(payload: VoiceGatewayMessage) {
  return payload.event || payload.type || "";
}

export type VoiceGatewayEventKind =
  | "transcription-failed"
  | "transcription-started"
  | "voice-processing"
  | "voice-draft-ready"
  | "voice-draft-failed"
  | "session-voice-sent"
  | "transcript"
  | "unknown";

export function voiceGatewayEventKind(eventName: string): VoiceGatewayEventKind {
  if (eventName === "transcription.failed") return "transcription-failed";
  if (eventName === "transcription.started") return "transcription-started";
  if (eventName === "voice.processing") return "voice-processing";
  if (eventName === "voice.draft.ready") return "voice-draft-ready";
  if (eventName === "voice.draft.failed") return "voice-draft-failed";
  if (eventName === "session.voice.sent") return "session-voice-sent";
  if (eventName === "transcript.partial" || eventName === "transcript.final") return "transcript";
  return "unknown";
}

export function voiceGatewayEventRoute(payload: VoiceGatewayMessage) {
  const eventName = voiceGatewayEventName(payload);
  return {
    eventName,
    kind: voiceGatewayEventKind(eventName),
  };
}

export function voiceGatewayErrorText(payload: VoiceGatewayMessage, fallback: string) {
  return payload.error || payload.code || fallback;
}

export function transcriptionFailedNodeError(payload: VoiceGatewayMessage, errorText: string) {
  return {
    code: payload.code || "TRANSCRIPTION_FAILED",
    message: errorText,
  };
}

export function voiceTranscriptionFailedPlan(input: {
  payload: VoiceGatewayMessage;
  nodeCommandId?: string | null;
  pendingSessionVoice?: PendingSessionVoice | null;
  fallbackMode: VoiceMode;
  at: number;
}) {
  const errorText = voiceGatewayErrorText(input.payload, "Transcription failed");
  return {
    errorText,
    nodeCommandResult: input.nodeCommandId
      ? {
        id: input.nodeCommandId,
        ok: false as const,
        payload: {},
        error: transcriptionFailedNodeError(input.payload, errorText),
      }
      : null,
    voiceFailure: input.pendingSessionVoice
      ? voiceFailureFromPendingSession({
        error: errorText,
        pendingSessionVoice: input.pendingSessionVoice,
        fallbackMode: input.fallbackMode,
        at: input.at,
      })
      : null,
    shouldClearPendingSessionVoice: Boolean(input.pendingSessionVoice),
    shouldRenderFailure: Boolean(input.pendingSessionVoice),
  };
}

export function voiceDraftPendingPhaseFromGatewayPayload(payload: VoiceGatewayMessage): VoiceDraftPendingPhase {
  return payload.phase === "upload" || payload.phase === "draft" ? payload.phase : "preprocess";
}

export function isEmptyVoiceDraftText(text: string) {
  const trimmed = text.trim();
  return !trimmed || trimmed === "NO_SPEECH";
}

export function voiceDraftFromGatewayPayload(
  payload: VoiceGatewayMessage,
  fallback: {
    pendingSessionVoice?: PendingSessionVoice | null;
    activeSessionKey: string;
    createIdempotencyKey: () => string;
  },
): VoiceDraft | null {
  const text = (payload.text || "").trim();
  if (isEmptyVoiceDraftText(text)) return null;
  return {
    text,
    targetSessionKey: payload.targetSessionKey || fallback.pendingSessionVoice?.targetSessionKey || fallback.activeSessionKey,
    idempotencyKey: payload.idempotencyKey || fallback.pendingSessionVoice?.idempotencyKey || fallback.createIdempotencyKey(),
  };
}

export function voiceDraftReadyPlan(
  payload: VoiceGatewayMessage,
  fallback: {
    pendingSessionVoice?: PendingSessionVoice | null;
    activeSessionKey: string;
    createIdempotencyKey: () => string;
  },
) {
  const draft = voiceDraftFromGatewayPayload(payload, fallback);
  return {
    draft,
    noSpeech: !draft,
    status: draft ? "voice transcript ready" as const : "voice: no speech detected" as const,
  };
}

export function voiceSentSessionInfo(
  payload: VoiceGatewayMessage,
  fallback: {
    pendingSessionVoice?: PendingSessionVoice | null;
    activeSessionKey: string;
    createIdempotencyKey: () => string;
  },
) {
  return {
    sessionKey: payload.sessionKey || fallback.pendingSessionVoice?.targetSessionKey || fallback.activeSessionKey,
    idempotencyKey: payload.idempotencyKey || fallback.pendingSessionVoice?.idempotencyKey || fallback.createIdempotencyKey(),
  };
}

export function sessionVoiceSentPlan(
  payload: VoiceGatewayMessage,
  fallback: {
    nodeCommandId?: string | null;
    pendingSessionVoice?: PendingSessionVoice | null;
    activeSessionKey: string;
    createIdempotencyKey: () => string;
  },
) {
  const sent = voiceSentSessionInfo(payload, fallback);
  return {
    sent,
    nodeCommandResult: fallback.nodeCommandId
      ? {
        id: fallback.nodeCommandId,
        ok: true as const,
        payload: { status: "sent" },
      }
      : null,
    optimisticUserMessage: fallback.pendingSessionVoice
      ? {
        sessionKey: sent.sessionKey,
        text: "Voice submitted",
        idempotencyKey: sent.idempotencyKey,
      }
      : null,
    status: "voice submitted to OpenClaw" as const,
    sessionHomeStatus: "voice submitted" as const,
  };
}

export function voiceFailureFromPendingSession(input: {
  error: string;
  pendingSessionVoice?: PendingSessionVoice | null;
  fallbackMode: VoiceMode;
  at: number;
}): VoiceFailure {
  const pending = input.pendingSessionVoice;
  return {
    error: input.error,
    mode: pending?.mode || input.fallbackMode,
    providerId: pending?.transcriptionProvider,
    at: input.at,
  };
}

export function voiceDraftFailedPlan(input: {
  payload: VoiceGatewayMessage;
  pendingSessionVoice?: PendingSessionVoice | null;
  fallbackMode: VoiceMode;
  at: number;
}) {
  const errorText = voiceGatewayErrorText(input.payload, "Voice transcript failed");
  return {
    errorText,
    voiceFailure: voiceFailureFromPendingSession({
      error: errorText,
      pendingSessionVoice: input.pendingSessionVoice,
      fallbackMode: input.fallbackMode,
      at: input.at,
    }),
    shouldClearPendingSessionVoice: Boolean(input.pendingSessionVoice),
  };
}

export function pendingVoiceOpenFailurePlan(input: {
  error: string;
  code: string;
  nodeCommandId?: string | null;
  pendingSessionVoice?: PendingSessionVoice | null;
  fallbackMode: VoiceMode;
  at: number;
}) {
  return {
    nodeCommandResult: input.nodeCommandId
      ? {
        id: input.nodeCommandId,
        ok: false as const,
        payload: {},
        error: {
          code: input.code,
          message: input.error,
        },
      }
      : null,
    voiceFailure: input.pendingSessionVoice
      ? voiceFailureFromPendingSession({
        error: input.error,
        pendingSessionVoice: input.pendingSessionVoice,
        fallbackMode: input.fallbackMode,
        at: input.at,
      })
      : null,
    shouldRenderFailure: Boolean(input.pendingSessionVoice),
  };
}

export function voiceTranscriptEventPlan(input: {
  eventName: string;
  payload: VoiceGatewayMessage;
  currentText: string;
  nodeCommandId?: string | null;
  pendingSessionVoice?: PendingSessionVoice | null;
}) {
  const nextText = input.payload.text || "";
  const isFinal = input.eventName === "transcript.final";
  const finalText = isFinal ? (input.payload.text || input.currentText) : "";
  return {
    nextText,
    isFinal,
    nodeCommandResult: isFinal && input.nodeCommandId
      ? {
        id: input.nodeCommandId,
        ok: true as const,
        payload: { text: finalText },
        status: "voice: sent to node" as const,
      }
      : null,
    standaloneTranscript: isFinal && !input.nodeCommandId && !input.pendingSessionVoice
      ? {
        text: finalText,
        status: "voice transcript ready" as const,
      }
      : null,
  };
}

export function reviewVoiceFailureFromPendingSession(error: string, pendingSessionVoice?: PendingSessionVoice | null) {
  if (pendingSessionVoice?.mode !== "review") return null;
  return {
    error,
    mode: pendingSessionVoice.mode,
    providerId: pendingSessionVoice.transcriptionProvider,
  };
}

export function bridgeVoiceStartConfig(input: {
  pendingSessionVoice?: PendingSessionVoice | null;
  activeSessionKey: string;
  createIdempotencyKey: () => string;
}): BridgeVoiceStartConfig {
  const pending = input.pendingSessionVoice;
  return {
    format: EVEN_G2_MICROPHONE_FORMAT,
    transcriptionMode: pending?.mode === "review" ? "talk-relay" : "attachment",
    ...(pending?.transcriptionProvider ? { transcriptionProvider: pending.transcriptionProvider } : {}),
    sessionKey: pending?.targetSessionKey || input.activeSessionKey,
    targetSessionKey: pending?.targetSessionKey,
    draftTimeoutMs: 8000,
    idempotencyKey: pending?.idempotencyKey || input.createIdempotencyKey(),
  };
}

export function sessionVoiceModeFromSetting(mode: VoiceMode): Exclude<VoiceMode, "off"> {
  return mode === "direct" ? "direct" : "review";
}

export function initialVoiceDraftPendingPhase(mode: Exclude<VoiceMode, "off">): VoiceDraftPendingPhase {
  return mode === "review" ? "draft" : "preprocess";
}

export function pendingSessionVoiceForStart(input: {
  mode: Exclude<VoiceMode, "off">;
  targetSessionKey: string;
  idempotencyKey: string;
  transcriptionProvider?: string;
}): PendingSessionVoice {
  return {
    mode: input.mode,
    targetSessionKey: input.targetSessionKey,
    idempotencyKey: input.idempotencyKey,
    ...(input.transcriptionProvider ? { transcriptionProvider: input.transcriptionProvider } : {}),
  };
}
