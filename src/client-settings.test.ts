import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_SETTINGS_STORAGE_KEY,
  clearBridgeClientSettings,
  clearBrowserClientSettings,
  loadedBridgeSettingsPlan,
  loadBridgeClientSettings,
  loadBrowserClientSettings,
  saveBridgeClientSettings,
  saveBrowserClientSettings,
} from "./client-settings";
import { DEVICE_CREDENTIAL_STORAGE_KEYS, type BridgeKeyValueStorage } from "./bridge-storage";
import { STARTUP_URL_SETTINGS_KEY } from "./startup-url-settings";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class FakeBridgeStorage implements BridgeKeyValueStorage {
  readonly storage = new MemoryStorage();
  async getLocalStorage(key: string) {
    return this.storage.getItem(key) || "";
  }
  async setLocalStorage(key: string, value: string) {
    this.storage.setItem(key, value);
    return true;
  }
}

describe("client settings", () => {
  it("plans bridge settings application for the React shell", () => {
    expect(loadedBridgeSettingsPlan({
      gatewayUrl: "ws://gateway",
      selectedSessionKey: "agent:main:main",
      lastSeenNodeId: "node-1",
      voiceMode: "direct",
      preferredReviewProvider: "openai",
      voiceRecordingLimitSeconds: 0,
      canvasTutorialCompleted: true,
    })).toEqual({
      gatewayUrl: "ws://gateway",
      selectedSessionKey: "agent:main:main",
      lastSeenNodeId: "node-1",
      voiceMode: "direct",
      preferredReviewProvider: "openai",
      voiceRecordingLimitSeconds: 30,
      canvasTutorialCompleted: true,
      presentation: "connecting",
    });
    expect(loadedBridgeSettingsPlan({
      gatewayUrl: "",
      selectedSessionKey: "",
      lastSeenNodeId: "",
      voiceMode: "review",
      preferredReviewProvider: "",
      voiceRecordingLimitSeconds: 120,
      canvasTutorialCompleted: false,
    })).toMatchObject({
      selectedSessionKey: null,
      lastSeenNodeId: null,
      preferredReviewProvider: null,
      presentation: "setup",
    });
  });

  it("loads browser settings with startup URL override and handoff", () => {
    const browserStorage = new MemoryStorage();
    const handoffStorage = new MemoryStorage();
    const afterLoad = vi.fn();
    browserStorage.setItem(CLIENT_SETTINGS_STORAGE_KEY, JSON.stringify({
      gatewayUrl: "ws://stored",
      selectedSessionKey: "agent:main:main",
      lastSeenNodeId: "node-1",
      voiceMode: "direct",
      voiceRecordingLimitSeconds: 120,
      canvasTutorialCompleted: true,
    }));

    expect(loadBrowserClientSettings({
      startupSettings: { gatewayUrl: "ws://startup", resetPairing: false },
      browserStorage,
      startupHandoffStorage: handoffStorage,
      afterLoad,
    })).toEqual({
      gatewayUrl: "ws://startup",
      selectedSessionKey: "agent:main:main",
      lastSeenNodeId: "node-1",
      voiceMode: "direct",
      preferredReviewProvider: "",
      voiceRecordingLimitSeconds: 120,
      canvasTutorialCompleted: true,
    });
    expect(JSON.parse(handoffStorage.getItem(STARTUP_URL_SETTINGS_KEY) || "{}")).toEqual({
      gatewayUrl: "ws://startup",
      resetPairing: false,
    });
    expect(afterLoad).toHaveBeenCalledTimes(1);
  });

  it("clears browser settings, diagnostics, and credentials on reset pairing", () => {
    const browserStorage = new MemoryStorage();
    const clearBrowserDeviceCredentials = vi.fn();
    browserStorage.setItem(CLIENT_SETTINGS_STORAGE_KEY, "{}");
    browserStorage.setItem("diagnostics", "[]");

    const settings = loadBrowserClientSettings({
      startupSettings: { gatewayUrl: "", resetPairing: true },
      browserStorage,
      startupHandoffStorage: new MemoryStorage(),
      resetStorageKeys: ["diagnostics"],
      clearBrowserDeviceCredentials,
    });

    expect(settings.gatewayUrl).toBe("");
    expect(browserStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY)).toBeNull();
    expect(browserStorage.getItem("diagnostics")).toBeNull();
    expect(clearBrowserDeviceCredentials).toHaveBeenCalledTimes(1);
  });

  it("loads bridge settings from startup handoff when current URL has no setup data", async () => {
    const bridge = new FakeBridgeStorage();
    const handoffStorage = new MemoryStorage();
    handoffStorage.setItem(STARTUP_URL_SETTINGS_KEY, JSON.stringify({
      gatewayUrl: "ws://handoff",
      resetPairing: false,
    }));
    bridge.storage.setItem(CLIENT_SETTINGS_STORAGE_KEY, JSON.stringify({
      gatewayUrl: "ws://stored",
      selectedSessionKey: "agent:main:main",
      lastSeenNodeId: "node-1",
    }));

    await expect(loadBridgeClientSettings(bridge, {
      currentStartupSettings: { gatewayUrl: "", resetPairing: false },
      startupHandoffStorage: handoffStorage,
    })).resolves.toMatchObject({
      gatewayUrl: "ws://handoff",
      selectedSessionKey: "agent:main:main",
      lastSeenNodeId: "node-1",
    });
    expect(handoffStorage.getItem(STARTUP_URL_SETTINGS_KEY)).toBeNull();
  });

  it("saves and clears browser settings", () => {
    const browserStorage = new MemoryStorage();

    saveBrowserClientSettings({ gatewayUrl: "ws://gateway", voiceMode: "direct" }, browserStorage);
    expect(browserStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY)).toContain("ws://gateway");

    clearBrowserClientSettings(browserStorage);
    expect(browserStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it("saves and clears bridge settings and credentials", async () => {
    const bridge = new FakeBridgeStorage();
    bridge.storage.setItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0], "identity");

    await saveBridgeClientSettings(bridge, { gatewayUrl: "ws://gateway" });
    expect(bridge.storage.getItem(CLIENT_SETTINGS_STORAGE_KEY)).toContain("ws://gateway");

    await clearBridgeClientSettings(bridge);
    expect(bridge.storage.getItem(CLIENT_SETTINGS_STORAGE_KEY)).toBe("");
    expect(bridge.storage.getItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0])).toBe("");
  });
});
