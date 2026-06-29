import { AUTH_STORAGE_KEY, IDENTITY_STORAGE_KEY } from "./gateway-direct";

export type BridgeKeyValueStorage = {
  getLocalStorage(key: string): Promise<string>;
  setLocalStorage(key: string, value: string): Promise<unknown>;
};

export const DEVICE_CREDENTIAL_STORAGE_KEYS = [IDENTITY_STORAGE_KEY, AUTH_STORAGE_KEY] as const;

export async function getBridgeStorageValue(bridge: BridgeKeyValueStorage, key: string) {
  try {
    return await bridge.getLocalStorage(key);
  } catch {
    return "";
  }
}

export async function setBridgeStorageValue(bridge: BridgeKeyValueStorage, key: string, value: string) {
  try {
    await bridge.setLocalStorage(key, value);
  } catch {
    // Even Hub bridge storage is best-effort; browser state and live setup still continue.
  }
}

function isDeviceCredentialKey(key: string) {
  return (DEVICE_CREDENTIAL_STORAGE_KEYS as readonly string[]).includes(key);
}

export async function hydrateDeviceCredentialsFromBridge(
  bridge: BridgeKeyValueStorage,
  browserStorage: Storage = localStorage,
) {
  await Promise.all(DEVICE_CREDENTIAL_STORAGE_KEYS.map(async (key) => {
    try {
      const bridgeValue = await bridge.getLocalStorage(key);
      if (bridgeValue) {
        browserStorage.setItem(key, bridgeValue);
        return;
      }
      const browserValue = browserStorage.getItem(key);
      if (browserValue) await bridge.setLocalStorage(key, browserValue);
    } catch {
      // Credential mirroring is best-effort; it must not block app startup.
    }
  }));
}

export async function clearDeviceCredentialsFromBridge(bridge: BridgeKeyValueStorage) {
  await Promise.all(DEVICE_CREDENTIAL_STORAGE_KEYS.map(async (key) => {
    try {
      await bridge.setLocalStorage(key, "");
    } catch {
      // Reset continues even if the bridge refuses a best-effort credential clear.
    }
  }));
}

export function createBridgeMirroredCredentialStorage(
  bridge: BridgeKeyValueStorage | null,
  browserStorage: Storage = localStorage,
): Storage {
  return {
    get length() {
      return browserStorage.length;
    },
    clear() {
      browserStorage.clear();
      if (bridge) {
        for (const key of DEVICE_CREDENTIAL_STORAGE_KEYS) {
          void bridge.setLocalStorage(key, "").catch(() => undefined);
        }
      }
    },
    getItem(key: string) {
      return browserStorage.getItem(key);
    },
    key(index: number) {
      return browserStorage.key(index);
    },
    removeItem(key: string) {
      browserStorage.removeItem(key);
      if (bridge && isDeviceCredentialKey(key)) void bridge.setLocalStorage(key, "").catch(() => undefined);
    },
    setItem(key: string, value: string) {
      browserStorage.setItem(key, value);
      if (bridge && isDeviceCredentialKey(key)) void bridge.setLocalStorage(key, value).catch(() => undefined);
    },
  };
}
