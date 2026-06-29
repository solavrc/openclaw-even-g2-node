import type { PendingSessionVoice } from "./voice-gateway-message";
import { nodeVoiceCloseCommandResult } from "./voice-command";

export const VOICE_FINALIZE_CLOSE_TIMEOUT_MS = 60000;
export const VOICE_CLOSED_BEFORE_TRANSCRIPT_ERROR = "Voice input closed before OpenClaw returned a transcript";

export type VoiceTransportCloseAction = "finalize" | "close" | "none";
export type VoiceStartAction = "stop-listening" | "busy" | "start";

export type VoiceCaptureState = {
  listening: boolean;
  hasVoiceTransport: boolean;
  hasPendingNodeCommand: boolean;
  hasPendingSessionVoice: boolean;
};

export type VoiceTransportClosedPlan = {
  nodeCommandResult: {
    id: string;
    ok: boolean;
    payload: Record<string, unknown>;
    error?: { code: string; message: string };
    status: "voice: sent partial to node" | "voice closed";
  } | null;
  sessionFailure: {
    errorText: typeof VOICE_CLOSED_BEFORE_TRANSCRIPT_ERROR;
  } | null;
};

export type VoiceStartTimerPlan = {
  hardStopMs: number;
  nodeAutoStopMs: number | null;
};

export function voiceTransportCloseAction(
  readyState: number,
  states: { open: number; closing: number },
): VoiceTransportCloseAction {
  if (readyState === states.open) return "finalize";
  if (readyState < states.closing) return "close";
  return "none";
}

export function shouldCloseVoiceTransportWithoutFinalize(
  readyState: number,
  closingState: number,
) {
  return readyState < closingState;
}

export function nextVoiceTransportGeneration(currentGeneration: number) {
  return currentGeneration + 1;
}

export function isCurrentVoiceTransportGeneration(currentGeneration: number, transportGeneration: number) {
  return currentGeneration === transportGeneration;
}

export function canSendVoiceAudio(input: {
  byteLength?: number;
  readyState: number;
  openState: number;
}) {
  return Boolean(input.byteLength) && input.readyState === input.openState;
}

export function voiceCaptureOpeningOrActive(input: VoiceCaptureState) {
  return Boolean(
    input.listening
    || input.hasVoiceTransport
    || input.hasPendingNodeCommand
    || input.hasPendingSessionVoice,
  );
}

export function voiceStartAction(input: VoiceCaptureState): VoiceStartAction {
  if (input.listening) return "stop-listening";
  if (voiceCaptureOpeningOrActive(input)) return "busy";
  return "start";
}

export function voiceStartTimerPlan(input: {
  nodeCommandId?: string | null;
  autoStopMs?: number;
  userLimitMs: number;
  defaultLimitMs: number;
}): VoiceStartTimerPlan {
  const hardStopMs = input.autoStopMs || input.userLimitMs || input.defaultLimitMs;
  return {
    hardStopMs,
    nodeAutoStopMs: input.nodeCommandId && input.autoStopMs ? input.autoStopMs : null,
  };
}

export function voiceTransportClosedPlan(input: {
  nodeCommandId: string | null;
  transcriptText: string;
  pendingSessionVoice: PendingSessionVoice | null;
}): VoiceTransportClosedPlan {
  const result = input.nodeCommandId ? nodeVoiceCloseCommandResult(input.transcriptText) : null;
  return {
    nodeCommandResult: input.nodeCommandId && result
      ? {
        id: input.nodeCommandId,
        ok: result.ok,
        payload: result.payload,
        error: result.error,
        status: result.ok ? "voice: sent partial to node" : "voice closed",
      }
      : null,
    sessionFailure: input.pendingSessionVoice
      ? { errorText: VOICE_CLOSED_BEFORE_TRANSCRIPT_ERROR }
      : null,
  };
}

export function voiceStopListeningViewState(pendingSessionVoice: PendingSessionVoice | null) {
  if (pendingSessionVoice?.mode === "review") {
    return { draftPendingPhase: "draft" as const, sessionHomeStatus: "" };
  }
  return {
    draftPendingPhase: null,
    sessionHomeStatus: pendingSessionVoice ? "sending..." : "ready",
  };
}
