import type { TalkCatalogReviewStatus } from "./talk-catalog";

export type VoiceMode = "review" | "direct" | "off";

export type VoiceGatewayGuidance = {
  request?: string;
};

export type VoiceFailureKind = "voice-setup" | "microphone" | "gateway" | "generic";

export const DEFAULT_VOICE_MODE: VoiceMode = "review";
export const DEFAULT_VOICE_RECORDING_LIMIT_SECONDS = 60;
export const MIN_VOICE_RECORDING_LIMIT_SECONDS = 30;
export const MAX_VOICE_RECORDING_LIMIT_SECONDS = 600;
export const VOICE_RECORDING_LIMIT_OPTIONS_SECONDS = [30, 60, 120, 300, 600] as const;
export const DEFAULT_VOICE_RECORDING_LIMIT_MS = DEFAULT_VOICE_RECORDING_LIMIT_SECONDS * 1000;
export const MAX_VOICE_RECORDING_LIMIT_MS = MAX_VOICE_RECORDING_LIMIT_SECONDS * 1000;

export function voiceFailureKind(errorText: string): VoiceFailureKind {
  const normalized = errorText.toLowerCase();
  if (
    normalized.includes("client secret")
    || normalized.includes("transcription_sessions")
    || normalized.includes("api key")
    || normalized.includes("invalid_request")
    || normalized.includes("invalid_grant")
    || normalized.includes("invalid token")
    || normalized.includes("expired")
    || normalized.includes("oauth")
    || normalized.includes("credential")
    || normalized.includes("unauthorized")
    || normalized.includes("forbidden")
    || normalized.includes("401")
    || normalized.includes("403")
    || normalized.includes("provider")
  ) {
    return "voice-setup";
  }
  if (normalized.includes("microphone")) return "microphone";
  if (normalized.includes("gateway") || normalized.includes("session is not open")) return "gateway";
  return "generic";
}

export function voiceProviderNameFromError(errorText: string) {
  const providerMatch = errorText.match(/provider\s+["']?([a-z0-9._:-]+)["']?/i)
    || errorText.match(/Realtime transcription provider\s+["']?([a-z0-9._:-]+)["']?/i)
    || errorText.match(/\b([a-z0-9._:-]+)\s+(?:auth|oauth|credential|token|api key)\b/i);
  return providerMatch?.[1] || "";
}

export function normalizeVoiceRecordingLimitSeconds(value: unknown) {
  const numericValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numericValue)) return DEFAULT_VOICE_RECORDING_LIMIT_SECONDS;
  const integerValue = Math.round(numericValue);
  return Math.max(MIN_VOICE_RECORDING_LIMIT_SECONDS, Math.min(MAX_VOICE_RECORDING_LIMIT_SECONDS, integerValue));
}

export function voiceHardStopTimeoutMs(timeoutMs: number) {
  return Math.max(1000, Math.min(MAX_VOICE_RECORDING_LIMIT_MS, Math.floor(timeoutMs)));
}

export function restoredVoiceRecordingLimitSeconds(value: unknown) {
  const numericValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numericValue) ? normalizeVoiceRecordingLimitSeconds(numericValue) : undefined;
}

export function voiceRecordingLimitLabel(seconds: number) {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = seconds / 60;
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export function voiceRecoveryTitle(errorText: string, mode: VoiceMode = "review") {
  const kind = voiceFailureKind(errorText);
  if (kind === "voice-setup") {
    if (mode === "direct") return "Send now voice needs Gateway attention";
    return "Review voice needs Gateway attention";
  }
  if (kind === "microphone") return "Microphone is unavailable";
  if (kind === "gateway") return "OpenClaw Gateway disconnected";
  return "Voice input failed";
}

export function voiceRecoveryAction(errorText: string, mode: VoiceMode) {
  const kind = voiceFailureKind(errorText);
  if (kind === "voice-setup") {
    const provider = voiceProviderNameFromError(errorText);
    const providerText = provider ? ` for ${provider}` : "";
    const request = voiceModeGatewayGuidance(mode === "off" ? "review" : mode).request || "Set up OpenClaw Even G2 Review voice.";
    return [
      `OpenClaw could not start the configured voice provider${providerText}.`,
      "In your usual OpenClaw chat, ask it to check Gateway voice setup, provider auth, and talk.catalog.",
      request,
    ].join(" ");
  }
  if (kind === "microphone") return "Check Even Hub microphone permission, then try again from the glasses.";
  if (kind === "gateway") return "Reconnect to OpenClaw Gateway, then retry voice input.";
  return "Try again. If it repeats, open Advanced diagnostics and report the Gateway error text.";
}

export function isVoiceMode(value: unknown): value is VoiceMode {
  return value === "review" || value === "direct" || value === "off";
}

export function normalizeVoiceMode(value: unknown): VoiceMode | undefined {
  if (value === "draft" || value === "clean") return "review";
  return isVoiceMode(value) ? value : undefined;
}

export function voiceModeLabel(mode: VoiceMode) {
  if (mode === "review") return "Review before sending";
  if (mode === "direct") return "Send audio directly";
  return "Off";
}

export function voiceModeShortLabel(mode: VoiceMode) {
  if (mode === "review") return "Review";
  if (mode === "direct") return "Send now";
  return "Off";
}

export function voiceModeGatewayGuidance(mode: VoiceMode): VoiceGatewayGuidance {
  if (mode === "review") {
    return {
      request: "Set up OpenClaw Even G2 Review voice. See solavrc/openclaw-even-g2-node.",
    };
  }
  if (mode === "direct") {
    return {
      request: "Set up OpenClaw Even G2 Send now voice. See solavrc/openclaw-even-g2-node.",
    };
  }
  return {};
}

export function voiceCapabilityStatus(mode: VoiceMode, reviewStatus: TalkCatalogReviewStatus, connected: boolean) {
  if (mode === "off") return "voice off";
  if (!connected) return "voice waits for Gateway";
  if (mode === "direct") return "Send now selected";
  if (reviewStatus.state === "ready") return "Review provider listed";
  if (reviewStatus.state === "checking") return "checking Review";
  if (reviewStatus.state === "needs-setup" || reviewStatus.state === "unavailable") return "voice setup pending";
  return "voice setup unverified";
}
