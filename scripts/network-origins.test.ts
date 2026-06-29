import { describe, expect, it } from "vitest";
import { isDevelopmentNetworkOrigin, networkReviewMetadata } from "./network-origins.ts";

describe("network origin helpers", () => {
  it("flags private HTTP and WebSocket origins", () => {
    expect(isDevelopmentNetworkOrigin("http://127.0.0.1:5174")).toBe(true);
    expect(isDevelopmentNetworkOrigin("ws://127.0.0.1:18789")).toBe(true);
    expect(isDevelopmentNetworkOrigin("wss://192.168.0.1")).toBe(true);
    expect(isDevelopmentNetworkOrigin("wss://100.64.0.1")).toBe(true);
    expect(isDevelopmentNetworkOrigin("wss://example.tailnet.ts.net")).toBe(true);
  });

  it("allows public HTTPS and WebSocket origins through this dev-origin check", () => {
    expect(isDevelopmentNetworkOrigin("https://gateway.example.com")).toBe(false);
    expect(isDevelopmentNetworkOrigin("wss://gateway.example.com")).toBe(false);
  });

  it("marks empty runtime Gateway whitelist as requiring Even Hub network review", () => {
    expect(networkReviewMetadata([])).toEqual({
      whitelist: [],
      developmentOrigins: [],
      reviewRequired: true,
      reviewRisk: "Runtime user-owned OpenClaw Gateway WebSocket endpoint is configured after install; Even Hub review must confirm the accepted network declaration.",
      publicReleaseBlockedByNetworkReview: true,
    });
  });

  it("marks development/private whitelist origins as requiring network review", () => {
    const metadata = networkReviewMetadata(["wss://example.tailnet.ts.net", "https://gateway.example.com"]);

    expect(metadata.whitelist).toEqual(["wss://example.tailnet.ts.net", "https://gateway.example.com"]);
    expect(metadata.developmentOrigins).toEqual(["wss://example.tailnet.ts.net"]);
    expect(metadata.reviewRequired).toBe(true);
    expect(metadata.publicReleaseBlockedByNetworkReview).toBe(true);
    expect(metadata.reviewRisk).toContain("development/private whitelist origins");
  });

  it("does not flag fixed public origins as this runtime Gateway review risk", () => {
    expect(networkReviewMetadata(["https://gateway.example.com", "wss://gateway.example.com"])).toEqual({
      whitelist: ["https://gateway.example.com", "wss://gateway.example.com"],
      developmentOrigins: [],
      reviewRequired: false,
      reviewRisk: null,
      publicReleaseBlockedByNetworkReview: false,
    });
  });
});
