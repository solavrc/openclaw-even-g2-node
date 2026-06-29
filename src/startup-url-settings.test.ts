import { describe, expect, it } from "vitest";
import {
  STARTUP_URL_SETTINGS_KEY,
  consumeStartupUrlSettingsForBridge,
  initialPhonePanelFromSearch,
  persistStartupUrlSettingsForBridge,
  scrubStartupUrlHref,
  settingsFromSearch,
} from "./startup-url-settings";

class MemoryStorage implements Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  private readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("startup URL settings", () => {
  it("reads gateway setup aliases and reset flag", () => {
    expect(settingsFromSearch("?setupCode=wss%3A%2F%2Fgateway.example%2Fws&resetPairing=1")).toEqual({
      gatewayUrl: "wss://gateway.example/ws",
      resetPairing: true,
    });
    expect(settingsFromSearch("?relay=wss%3A%2F%2Fgateway.example%2Frelay")).toEqual({
      gatewayUrl: "wss://gateway.example/relay",
      resetPairing: false,
    });
  });

  it("allows only documented initial phone panels", () => {
    expect(initialPhonePanelFromSearch("?openPanel=voice")).toBe("voice");
    expect(initialPhonePanelFromSearch("?openPanel=connection")).toBe("connection");
    expect(initialPhonePanelFromSearch("?openPanel=diagnostics")).toBe("diagnostics");
    expect(initialPhonePanelFromSearch("?openPanel=other")).toBe("");
  });

  it("removes one-time setup parameters while preserving unrelated URL state", () => {
    expect(scrubStartupUrlHref("https://app.example/path?setupCode=secret&openPanel=voice#top")).toEqual({
      changed: true,
      path: "/path?openPanel=voice#top",
    });
  });

  it("hands off one-time startup settings through session storage", () => {
    const storage = new MemoryStorage();

    persistStartupUrlSettingsForBridge({ gatewayUrl: "ws://localhost:3000", resetPairing: true }, storage);

    expect(consumeStartupUrlSettingsForBridge(storage)).toEqual({
      gatewayUrl: "ws://localhost:3000",
      resetPairing: true,
    });
    expect(storage.getItem(STARTUP_URL_SETTINGS_KEY)).toBeNull();
  });

  it("ignores empty startup settings handoff", () => {
    const storage = new MemoryStorage();

    persistStartupUrlSettingsForBridge({ gatewayUrl: "", resetPairing: false }, storage);

    expect(storage.getItem(STARTUP_URL_SETTINGS_KEY)).toBeNull();
  });
});
