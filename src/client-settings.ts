import {
  clearDeviceCredentialsFromBridge,
  getBridgeStorageValue,
  hydrateDeviceCredentialsFromBridge,
  setBridgeStorageValue,
  type BridgeKeyValueStorage,
} from "./bridge-storage";
import {
  DEFAULT_VOICE_MODE,
  normalizeVoiceRecordingLimitSeconds,
} from "./voice-settings";
import {
  parseStoredSettings,
  settingsPayloadForStorage,
  type ClientSettings,
} from "./settings-storage";
import {
  consumeStartupUrlSettingsForBridge,
  persistStartupUrlSettingsForBridge,
  type StartupUrlSettings,
} from "./startup-url-settings";

export const DEFAULT_GATEWAY_URL = "";
export const CLIENT_SETTINGS_STORAGE_KEY = "openclaw-even-g2-node-settings";

export type LoadedClientSettings = {
  gatewayUrl: string;
  selectedSessionKey: string;
  lastSeenNodeId: string;
  voiceMode: NonNullable<ClientSettings["voiceMode"]>;
  preferredReviewProvider: string;
  voiceRecordingLimitSeconds: number;
  canvasTutorialCompleted: boolean;
};

export type LoadedBridgeSettingsPlan = {
  gatewayUrl: string;
  selectedSessionKey: string | null;
  lastSeenNodeId: string | null;
  voiceMode: LoadedClientSettings["voiceMode"];
  preferredReviewProvider: string | null;
  voiceRecordingLimitSeconds: number;
  canvasTutorialCompleted: boolean;
  presentation: "connecting" | "setup";
};

export function loadedBridgeSettingsPlan(settings: LoadedClientSettings): LoadedBridgeSettingsPlan {
  return {
    gatewayUrl: settings.gatewayUrl,
    selectedSessionKey: settings.selectedSessionKey || null,
    lastSeenNodeId: settings.lastSeenNodeId || null,
    voiceMode: settings.voiceMode,
    preferredReviewProvider: settings.preferredReviewProvider || null,
    voiceRecordingLimitSeconds: normalizeVoiceRecordingLimitSeconds(settings.voiceRecordingLimitSeconds),
    canvasTutorialCompleted: settings.canvasTutorialCompleted === true,
    presentation: settings.gatewayUrl ? "connecting" : "setup",
  };
}

type BrowserSettingsStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;
type StartupHandoffStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function mergeDefinedSettings(
  fallback: LoadedClientSettings,
  stored: Partial<ClientSettings>,
): Partial<ClientSettings> {
  return {
    gatewayUrl: stored.gatewayUrl ?? fallback.gatewayUrl,
    selectedSessionKey: stored.selectedSessionKey ?? fallback.selectedSessionKey,
    lastSeenNodeId: stored.lastSeenNodeId ?? fallback.lastSeenNodeId,
    voiceMode: stored.voiceMode ?? fallback.voiceMode,
    preferredReviewProvider: stored.preferredReviewProvider ?? fallback.preferredReviewProvider,
    voiceRecordingLimitSeconds: stored.voiceRecordingLimitSeconds ?? fallback.voiceRecordingLimitSeconds,
    canvasTutorialCompleted: stored.canvasTutorialCompleted ?? fallback.canvasTutorialCompleted,
    settingsVersion: stored.settingsVersion,
  };
}

export function resolvedClientSettings(
  startupSettings: StartupUrlSettings,
  stored: Partial<ClientSettings>,
  defaultGatewayUrl = DEFAULT_GATEWAY_URL,
): LoadedClientSettings {
  return {
    gatewayUrl: startupSettings.gatewayUrl || stored.gatewayUrl || defaultGatewayUrl,
    selectedSessionKey: stored.selectedSessionKey || "",
    lastSeenNodeId: stored.lastSeenNodeId || "",
    voiceMode: stored.voiceMode || DEFAULT_VOICE_MODE,
    preferredReviewProvider: stored.preferredReviewProvider || "",
    voiceRecordingLimitSeconds: normalizeVoiceRecordingLimitSeconds(stored.voiceRecordingLimitSeconds),
    canvasTutorialCompleted: stored.canvasTutorialCompleted === true,
  };
}

export function loadBrowserClientSettings(input: {
  startupSettings: StartupUrlSettings;
  browserStorage?: BrowserSettingsStorage;
  startupHandoffStorage?: StartupHandoffStorage;
  resetStorageKeys?: string[];
  clearBrowserDeviceCredentials?: () => void;
  afterLoad?: () => void;
}) {
  const browserStorage = input.browserStorage ?? localStorage;
  persistStartupUrlSettingsForBridge(input.startupSettings, input.startupHandoffStorage);
  if (input.startupSettings.resetPairing) {
    browserStorage.removeItem(CLIENT_SETTINGS_STORAGE_KEY);
    for (const key of input.resetStorageKeys || []) browserStorage.removeItem(key);
    input.clearBrowserDeviceCredentials?.();
  }
  const stored = parseStoredSettings(browserStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY));
  input.afterLoad?.();
  return resolvedClientSettings(input.startupSettings, stored, DEFAULT_GATEWAY_URL);
}

export async function loadBridgeClientSettings(
  bridge: BridgeKeyValueStorage,
  input: {
    currentStartupSettings: StartupUrlSettings;
    startupHandoffStorage?: StartupHandoffStorage;
    browserFallbackSettings?: LoadedClientSettings;
  },
) {
  const fromUrl = input.currentStartupSettings.gatewayUrl || input.currentStartupSettings.resetPairing
    ? input.currentStartupSettings
    : consumeStartupUrlSettingsForBridge(input.startupHandoffStorage) || input.currentStartupSettings;
  if (fromUrl.resetPairing) await clearBridgeClientSettings(bridge);
  await hydrateDeviceCredentialsFromBridge(bridge);
  const raw = await getBridgeStorageValue(bridge, CLIENT_SETTINGS_STORAGE_KEY);
  const stored = parseStoredSettings(raw);
  const mergedStored = input.browserFallbackSettings
    ? mergeDefinedSettings(input.browserFallbackSettings, stored)
    : stored;
  const resolved = resolvedClientSettings(fromUrl, mergedStored, "");
  if (!raw && input.browserFallbackSettings) {
    await setBridgeStorageValue(bridge, CLIENT_SETTINGS_STORAGE_KEY, settingsPayloadForStorage(resolved));
  }
  return resolved;
}

export function saveBrowserClientSettings(
  settings: ClientSettings,
  browserStorage: BrowserSettingsStorage = localStorage,
) {
  const payload = settingsPayloadForStorage(settings);
  if (!payload) {
    browserStorage.removeItem(CLIENT_SETTINGS_STORAGE_KEY);
    return;
  }
  browserStorage.setItem(CLIENT_SETTINGS_STORAGE_KEY, payload);
}

export async function saveBridgeClientSettings(
  bridge: BridgeKeyValueStorage,
  settings: ClientSettings,
) {
  const payload = settingsPayloadForStorage(settings);
  await setBridgeStorageValue(bridge, CLIENT_SETTINGS_STORAGE_KEY, payload || "");
}

export function clearBrowserClientSettings(
  browserStorage: BrowserSettingsStorage = localStorage,
  clearBrowserDeviceCredentials?: () => void,
) {
  browserStorage.removeItem(CLIENT_SETTINGS_STORAGE_KEY);
  clearBrowserDeviceCredentials?.();
}

export async function clearBridgeClientSettings(bridge: BridgeKeyValueStorage) {
  await Promise.all([
    setBridgeStorageValue(bridge, CLIENT_SETTINGS_STORAGE_KEY, ""),
    clearDeviceCredentialsFromBridge(bridge),
  ]);
}
