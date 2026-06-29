import { describe, expect, it } from "vitest";
import {
  connectionStateLabel,
  hasGatewaySetup,
  liveActionLabel,
  liveFacts,
  liveStateLabel,
  nodeDetailText,
  nodeStatusLabel,
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
    expect(liveStateLabel({ hasGatewaySetup: true, connected: true, nodeConnected: false })).toBe("Connecting");
    expect(liveActionLabel({ showSetupFlow: false, showRetryNow: true })).toBe("Retry now");
  });

  it("builds live facts", () => {
    expect(liveFacts({
      connected: true,
      hasGatewaySetup: true,
      nodeConnected: true,
      foregroundClientCount: 0,
      nodeApprovalPending: true,
      showCanvasTutorial: true,
    })).toEqual([
      "Gateway connected",
      "Even G2 paired",
      "G2 bridge unavailable",
      "node tools pending",
      "canvas tutorial",
    ]);
  });

  it("summarizes review provider and failure display state", () => {
    expect(selectedReviewProviderMissing("provider-a", [{ id: "provider-b" }])).toBe(true);
    expect(selectedReviewProviderMissing("provider-a", [{ id: "provider-a" }])).toBe(false);
    expect(voiceFailureErrorText("error: provider failed")).toBe("provider failed");
  });
});
