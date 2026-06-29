import { describe, expect, it } from "vitest";
import { redactText } from "./e2e-agent-review.ts";
import {
  parseArgs,
  parseScopeUpgradeRequestId,
  profileBaseDir,
  selectConnectedEvenG2NodeId,
} from "./e2e-agent-live-isolated.ts";

describe("isolated agentic E2E helpers", () => {
  it("defaults to a fresh timestamped OpenClaw profile", () => {
    const args = parseArgs([], new Date("2026-06-30T00:00:00.000Z"));

    expect(args).toMatchObject({
      approvalWatchMs: 60_000,
      canvasText: "E2E canvas check",
      gatewayPort: null,
      openclawContainer: "",
      openclawProfile: "eveng2-e2e-2026-06-30T00-00-00-000Z",
      token: "dummy-e2e-token",
    });
  });

  it("parses explicit ports and profile options", () => {
    const args = parseArgs([
      "--",
      "--profile",
      "eveng2-e2e-manual",
      "--openclaw-container",
      "openclaw-eveng2-e2e",
      "--gateway-port",
      "19001",
      "--app-port",
      "5174",
      "--simulator-port",
      "9898",
      "--token",
      "throwaway",
      "--approval-watch-ms",
      "45000",
      "--openclaw-timeout-ms",
      "7000",
      "--canvas-text",
      "hello",
      "--out-dir",
      "/tmp/even-g2-e2e",
    ]);

    expect(args).toMatchObject({
      appPort: 5174,
      approvalWatchMs: 45_000,
      canvasText: "hello",
      gatewayPort: 19001,
      openclawContainer: "openclaw-eveng2-e2e",
      openclawProfile: "eveng2-e2e-manual",
      openclawTimeoutMs: 7000,
      outDir: "/tmp/even-g2-e2e",
      simulatorPort: 9898,
      token: "throwaway",
    });
  });

  it("selects the newest connected Even G2 canvas node", () => {
    const nodeId = selectConnectedEvenG2NodeId(JSON.stringify({
      nodes: [
        {
          nodeId: "old-connected",
          displayName: "Even G2",
          platform: "even-g2",
          connected: true,
          lastSeenAtMs: 10,
          commands: ["canvas.snapshot"],
        },
        {
          nodeId: "new-connected",
          displayName: "Even G2",
          platform: "even-g2",
          connected: true,
          lastSeenAtMs: 20,
          commands: ["canvas.present", "talk.ptt.once"],
        },
        {
          nodeId: "phone-only",
          displayName: "Even G2",
          platform: "even-g2",
          connected: true,
          lastSeenAtMs: 30,
          commands: ["device.status"],
        },
        {
          nodeId: "stale",
          displayName: "Even G2",
          platform: "even-g2",
          connected: false,
          lastSeenAtMs: 40,
          commands: ["canvas.present"],
        },
      ],
    }));

    expect(nodeId).toBe("new-connected");
  });

  it("redacts command-line and JSON token output", () => {
    const redacted = redactText([
      "$ tsx scripts/approve-even-g2-pairing.ts --token plain-token",
      "$ tsx scripts/e2e-agent-review.ts --openclaw-token openclaw-secret",
      "{\"token\":\"node-secret\",\"bootstrapToken\":\"setup-secret\"}",
    ].join("\n"));

    expect(redacted).toContain("--token <redacted>");
    expect(redacted).toContain("--openclaw-token <redacted>");
    expect(redacted).toContain("\"token\":\"<redacted>\"");
    expect(redacted).toContain("\"bootstrapToken\":\"<redacted>\"");
    expect(redacted).not.toContain("plain-token");
    expect(redacted).not.toContain("openclaw-secret");
    expect(redacted).not.toContain("node-secret");
    expect(redacted).not.toContain("setup-secret");
  });

  it("extracts OpenClaw CLI scope-upgrade request ids", () => {
    expect(parseScopeUpgradeRequestId("scope upgrade pending approval (requestId: abc-123)")).toBe("abc-123");
    expect(parseScopeUpgradeRequestId("pairing required: device is asking for more scopes than currently approved (requestId: def-456)")).toBe("def-456");
    expect(parseScopeUpgradeRequestId("pairing required: device is not approved yet")).toBeNull();
  });

  it("maps isolated profiles to separate OpenClaw state directories", () => {
    expect(profileBaseDir("eveng2-e2e-test")).toMatch(/\/\.openclaw-eveng2-e2e-test$/);
    expect(profileBaseDir("main")).toMatch(/\/\.openclaw$/);
  });
});
