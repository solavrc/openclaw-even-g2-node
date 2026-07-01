import { describe, expect, it } from "vitest";
import {
  connectionIssueKind,
  connectionStateLabel,
  gatewayRouteSecurityLabel,
  hasGatewaySetup,
  liveActionLabel,
  liveStateLabel,
  nodeDetailText,
  nodeStatusLabel,
  readinessChecklist,
  retryStatusLabel,
  selectedReviewProviderMissing,
  shouldShowCanvasTutorial,
  voiceFailureErrorText,
} from "./phone-ui-state";

describe("phone UI state helpers", () => {
  it("summarizes connection and node status labels", () => {
    expect(connectionStateLabel(true)).toBe("Connected");
    expect(hasGatewaySetup("  ")).toBe(false);
    expect(nodeStatusLabel({
      connected: true,
      nodeConnected: true,
      foregroundClientCount: 1,
    })).toBe("Paired · G2 bridge live");
    expect(nodeStatusLabel({
      connected: true,
      nodeConnected: false,
      foregroundClientCount: 0,
      lastError: "setup failed",
    })).toBe("Pairing attention needed");
    expect(nodeDetailText({
      hasGatewaySetup: true,
      activeSessionLabel: "main",
    })).toBe("Session: main");
  });

  it("formats retry and live node summaries", () => {
    expect(retryStatusLabel(null, 1000)).toBe("");
    expect(retryStatusLabel(2400, 1000)).toBe("Auto retry in ~2s");
    expect(retryStatusLabel(900, 1000)).toBe("Retrying now...");
    expect(shouldShowCanvasTutorial({ pending: true, completed: false, showSetupFlow: false })).toBe(true);
    expect(liveStateLabel({ hasGatewaySetup: true, connected: true, nodeConnected: true })).toBe("Ready");
    expect(liveStateLabel({ hasGatewaySetup: true, connected: true, nodeApprovalPending: true, nodeConnected: true })).toBe("Node approval required");
    expect(liveStateLabel({ hasGatewaySetup: true, connected: true, nodeConnected: false })).toBe("Connecting");
    expect(liveActionLabel({ showSetupFlow: false, showCheckAgain: false, showRetryNow: true, showVoiceSetup: false })).toBe("Retry now");
    expect(liveActionLabel({ showSetupFlow: false, showCheckAgain: true, showRetryNow: false, showVoiceSetup: false })).toBe("Check again");
    expect(liveActionLabel({ showSetupFlow: false, showCheckAgain: false, showRetryNow: false, showVoiceSetup: true })).toBe("Set up voice");
    expect(liveActionLabel({ showSetupFlow: true, showCheckAgain: true, showRetryNow: true, showVoiceSetup: true })).toBe("Scan setup QR");
  });

  it("summarizes review provider and failure display state", () => {
    expect(selectedReviewProviderMissing("provider-a", [{ id: "provider-b" }])).toBe(true);
    expect(selectedReviewProviderMissing("provider-a", [{ id: "provider-a" }])).toBe(false);
    expect(voiceFailureErrorText("error: provider failed")).toBe("provider failed");
  });

  it("classifies Gateway connection issues", () => {
    expect(connectionIssueKind({ connected: false, hasGatewaySetup: false, status: "idle" })).toBe("setup-required");
    expect(connectionIssueKind({ connected: true, hasGatewaySetup: true, status: "ready" })).toBe("ready");
    expect(connectionIssueKind({ connected: false, hasGatewaySetup: true, status: "error: origin not allowed" })).toBe("origin-not-allowed");
    expect(connectionIssueKind({ connected: false, hasGatewaySetup: true, status: "error: network permission denied" })).toBe("even-hub-network-permission");
    expect(connectionIssueKind({ connected: false, hasGatewaySetup: true, status: "connection error" })).toBe("gateway-unreachable");
    expect(connectionIssueKind({ connected: false, hasGatewaySetup: true, status: "error: device is not approved yet" })).toBe("approval-required");
    expect(connectionIssueKind({ connected: false, hasGatewaySetup: true, status: "error: role upgrade required" })).toBe("approval-required");
    expect(connectionIssueKind({ connected: true, hasGatewaySetup: true, status: "error: role upgrade required" })).toBe("approval-required");
    expect(connectionIssueKind({ connected: false, hasGatewaySetup: true, status: "too many failed authentication attempts" })).toBe("auth-paused");
  });

  it("builds onboarding readiness checklist items", () => {
    expect(gatewayRouteSecurityLabel("wss://gateway.example/ws")).toBe("secure WSS route");
    expect(gatewayRouteSecurityLabel("ws://127.0.0.1:3000/ws")).toBe("plain WS route");

    const items = readinessChecklist({
      connected: true,
      connectionIssue: "ready",
      foregroundClientCount: 1,
      gatewayUrl: "wss://gateway.example/ws",
      hasGatewaySetup: true,
      nodeApprovalPending: false,
      nodeConnected: true,
      reviewStatusState: "ready",
      reviewVoiceVerified: false,
      sessionKey: "agent:main:main",
      showCanvasTutorial: false,
      voiceMode: "review",
    });

    expect(items).toContainEqual(expect.objectContaining({
      label: "Gateway setup",
      status: "Done",
      tone: "ready",
    }));
    expect(items).toContainEqual(expect.objectContaining({
      label: "Voice verification",
      status: "Record once",
      tone: "pending",
    }));
    expect(readinessChecklist({
      connected: true,
      connectionIssue: "ready",
      foregroundClientCount: 1,
      gatewayUrl: "wss://gateway.example/ws",
      hasGatewaySetup: true,
      nodeApprovalPending: false,
      nodeConnected: true,
      reviewStatusState: "ready",
      reviewVoiceVerified: true,
      sessionKey: "agent:main:main",
      showCanvasTutorial: false,
      voiceMode: "review",
    })).toContainEqual(expect.objectContaining({
      label: "Voice verification",
      status: "Verified",
      detail: "Review returned transcript text during this app session.",
      tone: "ready",
    }));
    expect(readinessChecklist({
      connected: true,
      connectionIssue: "ready",
      foregroundClientCount: 1,
      gatewayUrl: "wss://gateway.example/ws",
      hasGatewaySetup: true,
      nodeApprovalPending: false,
      nodeConnected: true,
      reviewStatusState: "needs-setup",
      reviewVoiceVerified: true,
      sessionKey: "agent:main:main",
      showCanvasTutorial: false,
      voiceMode: "review",
    })).toContainEqual(expect.objectContaining({
      label: "Voice verification",
      status: "Setup needed",
      tone: "attention",
    }));
    const nodeApprovalItems = readinessChecklist({
      connected: true,
      connectionGuidanceTitle: "Node approval required",
      connectionIssue: "approval-required",
      foregroundClientCount: 1,
      gatewayUrl: "wss://gateway.example/ws",
      hasGatewaySetup: true,
      nodeApprovalPending: true,
      nodeConnected: true,
      reviewStatusState: "ready",
      reviewVoiceVerified: true,
      sessionKey: "agent:main:main",
      showCanvasTutorial: false,
      voiceMode: "review",
    });
    expect(nodeApprovalItems).toContainEqual(expect.objectContaining({
      label: "Device/operator approval",
      status: "Trusted",
      tone: "ready",
    }));
    expect(nodeApprovalItems).toContainEqual(expect.objectContaining({
      label: "Node tools approval",
      status: "Pending",
      tone: "attention",
    }));
    expect(readinessChecklist({
      connected: true,
      connectionIssue: "ready",
      foregroundClientCount: 1,
      gatewayUrl: "wss://gateway.example/ws",
      hasGatewaySetup: true,
      nodeApprovalPending: false,
      nodeConnected: true,
      reviewStatusState: "needs-setup",
      reviewVoiceVerified: false,
      sessionKey: "agent:main:main",
      showCanvasTutorial: false,
      voiceMode: "review",
    })).toContainEqual(expect.objectContaining({
      label: "Voice verification",
      status: "Setup needed",
      detail: "Use Set up voice, then send the setup request to OpenClaw before relying on Review.",
      tone: "attention",
    }));

    expect(readinessChecklist({
      connected: false,
      connectionGuidanceTitle: "Device approval required",
      connectionIssue: "approval-required",
      foregroundClientCount: 0,
      gatewayUrl: "wss://gateway.example/ws",
      hasGatewaySetup: true,
      nodeApprovalPending: true,
      nodeConnected: false,
      reviewStatusState: "checking",
      reviewVoiceVerified: false,
      sessionKey: "",
      showCanvasTutorial: false,
      voiceMode: "off",
    })).toContainEqual(expect.objectContaining({
      label: "Device/operator approval",
      status: "Pending",
      tone: "attention",
    }));
    expect(readinessChecklist({
      connected: true,
      connectionIssue: "ready",
      foregroundClientCount: 1,
      gatewayUrl: "wss://gateway.example/ws",
      hasGatewaySetup: true,
      nodeApprovalPending: true,
      nodeConnected: true,
      reviewStatusState: "ready",
      reviewVoiceVerified: false,
      sessionKey: "agent:main:main",
      showCanvasTutorial: false,
      voiceMode: "review",
    })).toContainEqual(expect.objectContaining({
      label: "Node tools approval",
      status: "Pending",
      detail: "Approve Even G2 node tools so canvas, location, and push-to-talk can run.",
      tone: "attention",
    }));
  });
});
