import { describe, expect, it } from "vitest";
import {
  connectionErrorPresentationPlan,
  gatewayConnectingHudFrame,
  guidanceForConnectionState,
  setupCodeInvalidHudFrame,
  setupCodeMissingHudFrame,
  setupQrNotFoundHudFrame,
  setupQrScanFailedHudFrame,
  setupQrScanPromptHudFrame,
  setupQrScannedHudFrame,
} from "./connection-guidance";

describe("guidanceForConnectionState", () => {
  it("builds setup guidance when no setup code is stored", () => {
    expect(guidanceForConnectionState("setup required", false)).toMatchObject({
      title: "OpenClaw Node",
    });
  });
});

describe("connectionErrorPresentationPlan", () => {
  it("uses connection guidance when an error has a guided recovery path", () => {
    expect(connectionErrorPresentationPlan(
      "error: node approval required",
      "node approval required",
      true,
    )).toMatchObject({
      target: "guidance",
      statusText: "error: node approval required",
      guidance: {
        title: "Node approval required",
      },
      reconnectReason: "needs attention",
    });
  });

  it("falls back to a glass error frame when no guidance matches", () => {
    const plan = connectionErrorPresentationPlan(
      "waiting",
      "Something unexpected happened ".repeat(12),
      true,
    );

    expect(plan).toMatchObject({
      target: "glass-error",
      statusText: "waiting",
      frame: {
        header: "OpenClaw error",
        hint: "retrying...",
      },
      reconnectReason: "needs attention",
    });
    expect(plan.target === "glass-error" ? plan.frame.body : "").toHaveLength(180);
    expect(plan.target === "glass-error" ? plan.frame.body : "").toMatch(/\.\.\.$/);
  });
});

describe("setup HUD frames", () => {
  it("builds setup-code and QR scanning frames", () => {
    expect(gatewayConnectingHudFrame()).toEqual({
      header: "OpenClaw Node",
      body: "Connecting to OpenClaw Gateway.",
      hint: "wait...",
    });
    expect(setupCodeMissingHudFrame()).toEqual({
      header: "OpenClaw Node",
      body: "Setup code missing.",
      hint: "paste setup code on phone",
    });
    expect(setupQrScannedHudFrame()).toEqual({
      header: "OpenClaw Node",
      body: "Setup QR scanned.\nConnecting to OpenClaw Gateway.",
      hint: "wait...",
    });
    expect(setupQrScanPromptHudFrame()).toEqual({
      header: "OpenClaw Node",
      body: "Scan setup QR.\nPoint this phone at the QR shown by OpenClaw host.",
      hint: "use phone camera",
    });
    expect(setupQrNotFoundHudFrame()).toEqual({
      header: "QR not found",
      body: "Keep QR fully visible.",
      hint: "try again",
    });
  });

  it("bounds long setup error text for glasses HUDs", () => {
    const invalidFrame = setupCodeInvalidHudFrame("invalid setup code because ".repeat(12));
    expect(invalidFrame).toMatchObject({
      header: "OpenClaw Node",
      hint: "scan or paste again",
    });
    expect(invalidFrame.body).toMatch(/^Setup code invalid\.\n/);
    expect(invalidFrame.body.length).toBeLessThanOrEqual("Setup code invalid.\n".length + 96);

    const scanFailedFrame = setupQrScanFailedHudFrame("camera decode failed ".repeat(20));
    expect(scanFailedFrame).toMatchObject({
      header: "QR scan failed",
      hint: "try again",
    });
    expect(scanFailedFrame.body).toHaveLength(180);
    expect(scanFailedFrame.body).toMatch(/\.\.\.$/);
  });
});
