import { describe, expect, it } from "vitest";
import {
  DEVICE_CREDENTIAL_STORAGE_KEYS,
  clearDeviceCredentialsFromBridge,
  createBridgeMirroredCredentialStorage,
  getBridgeStorageValue,
  hydrateDeviceCredentialsFromBridge,
  setBridgeStorageValue,
  type BridgeKeyValueStorage,
} from "./bridge-storage";

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

class FailingBridgeStorage implements BridgeKeyValueStorage {
  async getLocalStorage(): Promise<string> {
    throw new Error("bridge storage unavailable");
  }
  async setLocalStorage() {
    throw new Error("bridge storage unavailable");
  }
}

describe("bridge credential storage", () => {
  it("syncs device credentials from Even Hub bridge storage into browser storage", async () => {
    const bridge = new FakeBridgeStorage();
    const browser = new MemoryStorage();
    bridge.storage.setItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0], "identity");
    bridge.storage.setItem(DEVICE_CREDENTIAL_STORAGE_KEYS[1], "auth");

    await hydrateDeviceCredentialsFromBridge(bridge, browser);

    expect(browser.getItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0])).toBe("identity");
    expect(browser.getItem(DEVICE_CREDENTIAL_STORAGE_KEYS[1])).toBe("auth");
  });

  it("backfills browser credentials into empty Even Hub bridge storage", async () => {
    const bridge = new FakeBridgeStorage();
    const browser = new MemoryStorage();
    browser.setItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0], "identity");
    browser.setItem(DEVICE_CREDENTIAL_STORAGE_KEYS[1], "auth");

    await hydrateDeviceCredentialsFromBridge(bridge, browser);

    expect(bridge.storage.getItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0])).toBe("identity");
    expect(bridge.storage.getItem(DEVICE_CREDENTIAL_STORAGE_KEYS[1])).toBe("auth");
  });

  it("mirrors credential writes and clears to Even Hub bridge storage", async () => {
    const bridge = new FakeBridgeStorage();
    const browser = new MemoryStorage();
    const storage = createBridgeMirroredCredentialStorage(bridge, browser);

    storage.setItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0], "identity");
    storage.setItem("unrelated", "local-only");
    await Promise.resolve();

    expect(browser.getItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0])).toBe("identity");
    expect(bridge.storage.getItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0])).toBe("identity");
    expect(bridge.storage.getItem("unrelated")).toBeNull();

    storage.removeItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0]);
    await Promise.resolve();

    expect(browser.getItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0])).toBeNull();
    expect(bridge.storage.getItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0])).toBe("");
  });

  it("clears mirrored credentials when browser storage is cleared", async () => {
    const bridge = new FakeBridgeStorage();
    const browser = new MemoryStorage();
    const storage = createBridgeMirroredCredentialStorage(bridge, browser);

    storage.setItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0], "identity");
    storage.setItem(DEVICE_CREDENTIAL_STORAGE_KEYS[1], "auth");
    await Promise.resolve();

    storage.clear();
    await Promise.resolve();

    expect(bridge.storage.getItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0])).toBe("");
    expect(bridge.storage.getItem(DEVICE_CREDENTIAL_STORAGE_KEYS[1])).toBe("");
  });

  it("does not throw when bridge credential hydration is unavailable", async () => {
    const browser = new MemoryStorage();
    browser.setItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0], "identity");

    await expect(hydrateDeviceCredentialsFromBridge(new FailingBridgeStorage(), browser)).resolves.toBeUndefined();

    expect(browser.getItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0])).toBe("identity");
  });

  it("does not throw when bridge credential clearing is unavailable", async () => {
    await expect(clearDeviceCredentialsFromBridge(new FailingBridgeStorage())).resolves.toBeUndefined();
  });

  it("clears device credentials from bridge storage", async () => {
    const bridge = new FakeBridgeStorage();
    bridge.storage.setItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0], "identity");
    bridge.storage.setItem(DEVICE_CREDENTIAL_STORAGE_KEYS[1], "auth");

    await clearDeviceCredentialsFromBridge(bridge);

    expect(bridge.storage.getItem(DEVICE_CREDENTIAL_STORAGE_KEYS[0])).toBe("");
    expect(bridge.storage.getItem(DEVICE_CREDENTIAL_STORAGE_KEYS[1])).toBe("");
  });

  it("reads and writes non-credential bridge storage values", async () => {
    const bridge = new FakeBridgeStorage();

    await setBridgeStorageValue(bridge, "settings", "{\"gatewayUrl\":\"ws://localhost\"}");

    expect(await getBridgeStorageValue(bridge, "settings")).toBe("{\"gatewayUrl\":\"ws://localhost\"}");
  });

  it("treats unavailable bridge storage as best-effort", async () => {
    const bridge = new FailingBridgeStorage();

    await expect(setBridgeStorageValue(bridge, "settings", "value")).resolves.toBeUndefined();
    await expect(getBridgeStorageValue(bridge, "settings")).resolves.toBe("");
  });
});
