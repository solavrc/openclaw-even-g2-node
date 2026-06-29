import {
  DEFAULT_VOICE_MODE,
  DEFAULT_VOICE_RECORDING_LIMIT_SECONDS,
  normalizeVoiceMode,
  normalizeVoiceRecordingLimitSeconds,
  restoredVoiceRecordingLimitSeconds,
} from "./voice-settings";
import type { VoiceMode } from "./voice-settings";
import { storageSafeGatewayUrl } from "./setup-code";

export const SETTINGS_VERSION = 2;

export type ClientSettings = {
  gatewayUrl: string;
  selectedSessionKey?: string;
  lastSeenNodeId?: string;
  voiceMode?: VoiceMode;
  preferredReviewProvider?: string;
  voiceRecordingLimitSeconds?: number;
  canvasTutorialCompleted?: boolean;
  settingsVersion?: number;
};

export type ClientBackgroundSnapshot = {
  settingsVersion: typeof SETTINGS_VERSION;
  gatewayUrl?: string;
  selectedSessionKey?: string;
  voiceMode?: VoiceMode;
  preferredReviewProvider?: string;
  voiceRecordingLimitSeconds?: number;
  glassView?: "sessionHome";
  sessionLogCursor?: number;
};

export function parseStoredSettings(raw: string | null | undefined): Partial<ClientSettings> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const gatewayUrl = typeof parsed.gatewayUrl === "string"
      ? parsed.gatewayUrl
      : typeof parsed.relayUrl === "string"
        ? parsed.relayUrl
        : undefined;
    const safeGatewayUrl = gatewayUrl === undefined ? undefined : storageSafeGatewayUrl(gatewayUrl);
    const voiceMode = normalizeVoiceMode(parsed.voiceMode);
    return {
      gatewayUrl: safeGatewayUrl,
      selectedSessionKey: typeof parsed.selectedSessionKey === "string" ? parsed.selectedSessionKey : undefined,
      lastSeenNodeId: typeof parsed.lastSeenNodeId === "string" ? parsed.lastSeenNodeId : undefined,
      voiceMode,
      preferredReviewProvider: typeof parsed.preferredReviewProvider === "string" ? parsed.preferredReviewProvider : undefined,
      voiceRecordingLimitSeconds: normalizeVoiceRecordingLimitSeconds(parsed.voiceRecordingLimitSeconds),
      canvasTutorialCompleted: parsed.canvasTutorialCompleted === true ? true : undefined,
      settingsVersion: parsed.settingsVersion === SETTINGS_VERSION ? SETTINGS_VERSION : undefined,
    };
  } catch {
    return {};
  }
}

export function parseBackgroundSnapshot(value: unknown): Partial<ClientBackgroundSnapshot> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const parsed = value as Record<string, unknown>;
  const voiceMode = normalizeVoiceMode(parsed.voiceMode);
  const voiceRecordingLimitSeconds = parsed.voiceRecordingLimitSeconds === undefined
    ? undefined
    : restoredVoiceRecordingLimitSeconds(parsed.voiceRecordingLimitSeconds);
  const glassView = parsed.glassView === "sessionHome"
    ? parsed.glassView
    : undefined;
  return {
    settingsVersion: parsed.settingsVersion === SETTINGS_VERSION ? SETTINGS_VERSION : undefined,
    gatewayUrl: typeof parsed.gatewayUrl === "string" ? parsed.gatewayUrl : undefined,
    selectedSessionKey: typeof parsed.selectedSessionKey === "string" ? parsed.selectedSessionKey : undefined,
    voiceMode,
    preferredReviewProvider: typeof parsed.preferredReviewProvider === "string" ? parsed.preferredReviewProvider : undefined,
    voiceRecordingLimitSeconds,
    glassView,
    sessionLogCursor: typeof parsed.sessionLogCursor === "number" && Number.isInteger(parsed.sessionLogCursor) && parsed.sessionLogCursor >= 0
      ? parsed.sessionLogCursor
      : undefined,
  };
}

export function settingsPayloadForStorage(settings: ClientSettings) {
  const gatewayUrl = storageSafeGatewayUrl(settings.gatewayUrl);
  const normalizedRecordingLimit = settings.voiceRecordingLimitSeconds === undefined
    ? undefined
    : normalizeVoiceRecordingLimitSeconds(settings.voiceRecordingLimitSeconds);
  const payload: ClientSettings = {
    gatewayUrl,
    ...(settings.selectedSessionKey ? { selectedSessionKey: settings.selectedSessionKey } : {}),
    ...(settings.lastSeenNodeId ? { lastSeenNodeId: settings.lastSeenNodeId } : {}),
    ...(settings.voiceMode && settings.voiceMode !== DEFAULT_VOICE_MODE ? { voiceMode: settings.voiceMode } : {}),
    ...(settings.preferredReviewProvider ? { preferredReviewProvider: settings.preferredReviewProvider } : {}),
    ...(normalizedRecordingLimit !== undefined && normalizedRecordingLimit !== DEFAULT_VOICE_RECORDING_LIMIT_SECONDS
      ? { voiceRecordingLimitSeconds: normalizedRecordingLimit }
      : {}),
    ...(settings.canvasTutorialCompleted ? { canvasTutorialCompleted: true } : {}),
    settingsVersion: SETTINGS_VERSION,
  };
  const hasGatewayIndependentPreferences = Boolean(
    payload.selectedSessionKey
    || payload.lastSeenNodeId
    || payload.voiceMode
    || payload.preferredReviewProvider
    || payload.voiceRecordingLimitSeconds
    || payload.canvasTutorialCompleted
  );
  if (!gatewayUrl.trim() && !hasGatewayIndependentPreferences) return "";
  return JSON.stringify(payload);
}
