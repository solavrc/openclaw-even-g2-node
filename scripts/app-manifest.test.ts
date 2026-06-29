import { describe, expect, it } from "vitest";
import { appManifestNetworkWhitelist } from "./app-manifest.ts";

describe("app manifest helpers", () => {
  it("extracts only string network whitelist origins", () => {
    expect(appManifestNetworkWhitelist({
      permissions: [
        { name: "camera", whitelist: ["https://ignored.example.com"] },
        { name: "network", whitelist: ["https://gateway.example.com", 42, null, "wss://gateway.example.com"] },
      ],
    })).toEqual(["https://gateway.example.com", "wss://gateway.example.com"]);
  });

  it("returns an empty whitelist for missing or malformed permission data", () => {
    expect(appManifestNetworkWhitelist(null)).toEqual([]);
    expect(appManifestNetworkWhitelist({ permissions: "network" })).toEqual([]);
    expect(appManifestNetworkWhitelist({ permissions: [{ name: "network", whitelist: "https://gateway.example.com" }] })).toEqual([]);
  });
});
