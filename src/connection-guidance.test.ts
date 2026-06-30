import { describe, expect, it } from "vitest";
import {
  connectionErrorPresentationPlan,
  gatewayConnectingHudFrame,
  guidanceForConnectionState,
  nodeApprovalGuidance,
  setupCodeInvalidHudFrame,
  setupCodeMissingHudFrame,
  setupQrNotFoundHudFrame,
  setupQrScanFailedHudFrame,
  setupQrScanPromptHudFrame,
  setupQrScannedHudFrame,
  shouldRetryWhileAwaitingApproval,
} from "./connection-guidance";

describe("guidanceForConnectionState", () => {
  it("builds setup guidance when no setup code is stored", () => {
    expect(guidanceForConnectionState("setup required", false)).toMatchObject({
      title: "OpenClaw Node",
    });
  });

  it("keeps node approval request ids on the OpenClaw host side", () => {
    const guidance = guidanceForConnectionState("node approval required (requestId: request-pending)", true);

    expect(guidance?.title).toBe("Node approval required");
    expect(guidance?.action).toContain("$ openclaw nodes pending");
    expect(guidance?.action).toContain("Find the Even G2 request, then run `openclaw nodes approve <requestId>`");
    expect(guidance?.action).not.toContain("$ openclaw nodes approve request-pending");
  });

  it("treats spaced role upgrade errors as operator approval", () => {
    const guidance = guidanceForConnectionState("error: role upgrade required", true);

    expect(guidance?.title).toBe("Operator approval required");
    expect(guidance?.action).toContain("$ openclaw devices list");
    expect(guidance?.action).toContain("Hey Claw, approve remaining Even G2 operator requests.");
  });

  it("renders safe non-UUID operator approval request ids as host commands", () => {
    const guidance = guidanceForConnectionState("error: role upgrade required (requestId: request-1)", true);

    expect(guidance?.title).toBe("Operator approval required");
    expect(guidance?.action).toContain("$ openclaw devices approve request-1");
  });

  it("does not render unsafe or truncated node request ids as commands", () => {
    const truncated = guidanceForConnectionState(
      "node approval required (requestId: c8143076-345e-4083-8c86-6411123",
      true,
    );
    const unsafe = nodeApprovalGuidance();

    expect(truncated?.action).toContain("Find the Even G2 request, then run `openclaw nodes approve <requestId>`");
    expect(truncated?.action).not.toContain("6411123");
    expect(unsafe.action).toContain("Find the Even G2 request, then run `openclaw nodes approve <requestId>`");
    expect(unsafe.action).not.toContain("request-pending;rm");
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

  it("does not request automatic reconnect for authentication pauses", () => {
    expect(connectionErrorPresentationPlan(
      "error: too many failed authentication attempts",
      "too many failed authentication attempts",
      true,
    )).toMatchObject({
      target: "guidance",
      guidance: {
        title: "OpenClaw authentication paused",
      },
      reconnectReason: "",
    });
  });

  it("allows automatic retry while waiting for approval but not auth pauses", () => {
    const approvalPlan = connectionErrorPresentationPlan(
      "error: higher role than currently approved",
      "higher role than currently approved",
      true,
    );
    const authPausePlan = connectionErrorPresentationPlan(
      "error: too many failed authentication attempts",
      "too many failed authentication attempts",
      true,
    );

    expect(shouldRetryWhileAwaitingApproval(approvalPlan)).toBe(true);
    expect(shouldRetryWhileAwaitingApproval(authPausePlan)).toBe(false);
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
