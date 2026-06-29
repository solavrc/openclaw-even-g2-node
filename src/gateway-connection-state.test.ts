import { describe, expect, it } from "vitest";
import {
  canSendGatewayNodeCommandResult,
  gatewayCloseStatus,
  gatewayErrorStatus,
  isGatewayTransportOpen,
  nodeApprovalRequiredStatus,
  shouldCloseGatewayTransport,
  shouldRestoreReadyAfterNodeApproval,
} from "./gateway-connection-state";

describe("gateway connection state", () => {
  it("preserves or derives close statuses", () => {
    expect(gatewayCloseStatus("auth failed", "connected")).toBe("error: auth failed");
    expect(gatewayCloseStatus("", "error: existing")).toBe("error: existing");
    expect(gatewayCloseStatus("", "connection error")).toBe("connection error");
    expect(gatewayCloseStatus("", "ready")).toBe("disconnected");
  });

  it("derives error statuses without hiding existing errors", () => {
    expect(gatewayErrorStatus("error: setup failed")).toBe("error: setup failed");
    expect(gatewayErrorStatus("ready")).toBe("connection error");
  });

  it("formats node approval statuses", () => {
    expect(nodeApprovalRequiredStatus()).toBe("node approval required");
  });

  it("detects node approval statuses that can return to ready", () => {
    expect(shouldRestoreReadyAfterNodeApproval("node approval required")).toBe(true);
    expect(shouldRestoreReadyAfterNodeApproval("node approval required (requestId: request-1)")).toBe(true);
    expect(shouldRestoreReadyAfterNodeApproval("node approval required; checking")).toBe(true);
    expect(shouldRestoreReadyAfterNodeApproval("ready")).toBe(false);
  });

  it("handles gateway transport readyState checks", () => {
    expect(shouldCloseGatewayTransport(0, 2)).toBe(true);
    expect(shouldCloseGatewayTransport(1, 2)).toBe(true);
    expect(shouldCloseGatewayTransport(2, 2)).toBe(false);
    expect(isGatewayTransportOpen(1, 1)).toBe(true);
    expect(isGatewayTransportOpen(undefined, 1)).toBe(false);
    expect(canSendGatewayNodeCommandResult({ readyState: 1, openState: 1 })).toBe(true);
    expect(canSendGatewayNodeCommandResult({ readyState: 0, openState: 1, canSendOverride: true })).toBe(true);
    expect(canSendGatewayNodeCommandResult({ readyState: 0, openState: 1 })).toBe(false);
  });
});
