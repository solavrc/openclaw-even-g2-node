import { describe, expect, it } from "vitest";
import { setupCodeFromQrValue, storageSafeGatewayUrl } from "./setup-code";

describe("setupCodeFromQrValue", () => {
  it("extracts setup query parameters from QR URLs", () => {
    expect(setupCodeFromQrValue("https://example.com/setup?setupCode=wss%3A%2F%2Fgateway.example%2Fws")).toBe("wss://gateway.example/ws");
    expect(setupCodeFromQrValue("https://example.com/setup?relay=wss%3A%2F%2Fgateway.example%2Frelay")).toBe("wss://gateway.example/relay");
  });

  it("falls back to the trimmed raw value", () => {
    expect(setupCodeFromQrValue(" wss://gateway.example/ws ")).toBe("wss://gateway.example/ws");
  });
});

describe("storageSafeGatewayUrl", () => {
  it("stores only the gateway URL when a setup code includes a bootstrap token", () => {
    const setupCode = btoa(JSON.stringify({
      url: "wss://gateway.example/ws",
      bootstrapToken: "secret-token",
    }));

    expect(storageSafeGatewayUrl(setupCode)).toBe("wss://gateway.example/ws");
  });

  it("keeps plain gateway URLs unchanged", () => {
    expect(storageSafeGatewayUrl(" wss://gateway.example/ws ")).toBe("wss://gateway.example/ws");
  });
});
