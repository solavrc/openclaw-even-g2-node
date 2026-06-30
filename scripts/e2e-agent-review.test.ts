import { describe, expect, it } from "vitest";
import {
  buildReviewPrompt,
  parseArgs,
  parseE2eApprovalMarkers,
  parseE2eGlassMarkers,
  parseE2eSessionMarkers,
  parseE2eVoiceMarkers,
  nodeStatusHasConnectedNode,
  redactCommandArgs,
  redactText,
  resolveConnectedNodeName,
} from "./e2e-agent-review.ts";

describe("e2e agent review helpers", () => {
  it("parses local agent review arguments", () => {
    const args = parseArgs([
      "--",
      "--out-dir",
      "/tmp/e2e-review",
      "--simulator-url",
      "http://127.0.0.1:9999",
      "--node",
      "Even G2 Local",
      "--openclaw-container",
      "openclaw-eveng2-e2e",
      "--openclaw-profile",
      "eveng2-e2e",
      "--openclaw-url",
      "ws://127.0.0.1:19001",
      "--openclaw-token",
      "test-token",
      "--openclaw-live-canvas",
      "--canvas-text",
      "hello",
      "--openclaw-timeout-ms",
      "7000",
    ], new Date("2026-06-29T00:00:00.000Z"));

    expect(args).toMatchObject({
      canvasText: "hello",
      liveCanvas: true,
      nodeName: "Even G2 Local",
      openclawContainer: "openclaw-eveng2-e2e",
      openclawProfile: "eveng2-e2e",
      openclawTimeoutMs: 7000,
      openclawToken: "test-token",
      openclawUrl: "ws://127.0.0.1:19001",
      outDir: "/tmp/e2e-review",
      simulatorUrl: "http://127.0.0.1:9999",
    });
  });

  it("redacts tokens and setup codes before writing evidence", () => {
    const redacted = redactText("Bearer abc.def setupCode=wss%3A%2F%2Fgateway.example%2Fws%3Ftoken%3Dsecret token=plain url=ws://gateway.example/ws?bootstrap=one&setup_token=two");

    expect(redacted).toContain("Bearer <redacted>");
    expect(redacted).toContain("setupCode=<redacted>");
    expect(redacted).toContain("token=<redacted>");
    expect(redacted).toContain("bootstrap=<redacted>");
    expect(redacted).toContain("setup_token=<redacted>");
    expect(redacted).not.toContain("abc.def");
    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("one");
    expect(redacted).not.toContain("two");
  });

  it("accepts array-shaped OpenClaw node status output", () => {
    expect(nodeStatusHasConnectedNode({
      context: {
        authProvided: false,
        container: "",
        profile: "",
        url: "",
      },
      enabled: true,
      liveCanvas: false,
      nodeName: "Even G2 Local",
      nodeStatus: {
        ok: true,
        args: ["openclaw", "nodes", "status"],
        exitCode: 0,
        stdout: "[]",
        stderr: "",
        timedOut: false,
        json: [
          { nodeId: "other", displayName: "Other", connected: false },
          { nodeId: "node-even-g2", displayName: "Even G2 Local", connected: true },
        ],
      },
    })).toBe(true);
  });

  it("resolves auto node selection to the connected Even G2 node id", () => {
    const nodeStatus = {
      ok: true,
      args: ["openclaw", "nodes", "status"],
      exitCode: 0,
      stdout: "{}",
      stderr: "",
      timedOut: false,
      json: {
        nodes: [
          { nodeId: "stale-node", displayName: "Even G2", platform: "even-g2", connected: false },
          { nodeId: "connected-node", displayName: "Even G2", platform: "even-g2", connected: true },
        ],
      },
    };

    expect(resolveConnectedNodeName("auto", nodeStatus)).toBe("connected-node");
    expect(resolveConnectedNodeName("Even G2", nodeStatus)).toBe("connected-node");
    expect(nodeStatusHasConnectedNode({
      context: {
        authProvided: false,
        container: "",
        profile: "",
        url: "",
      },
      enabled: true,
      liveCanvas: false,
      nodeName: "auto",
      nodeStatus,
      resolvedNodeName: "connected-node",
    })).toBe(true);
  });

  it("redacts separated OpenClaw CLI token arguments", () => {
    expect(redactCommandArgs([
      "openclaw",
      "--container",
      "openclaw-eveng2-e2e",
      "--profile",
      "eveng2-e2e",
      "nodes",
      "invoke",
      "--url",
      "ws://127.0.0.1:19001/ws?token=secret",
      "--token",
      "plain-token",
    ])).toEqual([
      "openclaw",
      "--container",
      "openclaw-eveng2-e2e",
      "--profile",
      "eveng2-e2e",
      "nodes",
      "invoke",
      "--url",
      "ws://127.0.0.1:19001/ws?token=<redacted>",
      "--token",
      "<redacted>",
    ]);
  });

  it("extracts structured glass state markers from simulator console text", () => {
    const states = parseE2eGlassMarkers([
      "ordinary log",
      "[openclaw-even-g2-node:e2e:glass] {\"layout\":\"text-frame\",\"frame\":{\"header\":\"main · agent\"}}",
      "[openclaw-even-g2-node:e2e:glass] not-json",
      "[openclaw-even-g2-node:e2e:glass] {\"layout\":\"voice-panel\",\"token\":\"secret\"}",
    ].join("\n"));

    expect(states).toEqual([
      { layout: "text-frame", frame: { header: "main · agent" } },
      { layout: "voice-panel", token: "<redacted>" },
    ]);
  });

  it("extracts structured session state markers from simulator console text", () => {
    const states = parseE2eSessionMarkers([
      "[openclaw-even-g2-node:e2e:session] {\"action\":\"switch-session\",\"toSessionKey\":\"agent:main:direct:notes\"}",
      "[openclaw-even-g2-node:e2e:session] {\"action\":\"gateway-send\",\"token\":\"secret\"}",
    ].join("\n"));

    expect(states).toEqual([
      { action: "switch-session", toSessionKey: "agent:main:direct:notes" },
      { action: "gateway-send", token: "<redacted>" },
    ]);
  });

  it("extracts structured voice and approval markers from simulator console text", () => {
    const consoleText = [
      "[openclaw-even-g2-node:e2e:voice] {\"action\":\"session-voice-sent\",\"token\":\"secret\"}",
      "[openclaw-even-g2-node:e2e:approval] {\"action\":\"eveng2.approval.resolve.ack\",\"status\":\"accepted\"}",
    ].join("\n");

    expect(parseE2eVoiceMarkers(consoleText)).toEqual([
      { action: "session-voice-sent", token: "<redacted>" },
    ]);
    expect(parseE2eApprovalMarkers(consoleText)).toEqual([
      { action: "eveng2.approval.resolve.ack", status: "accepted" },
    ]);
  });

  it("builds a prompt for fuzzy Coding Agent review", () => {
    const prompt = buildReviewPrompt({
      bundleDir: "/tmp/run",
      evidencePath: "/tmp/run/evidence.json",
      manifestPath: "/tmp/run/manifest.json",
      userStoriesPath: "/tmp/run/user-stories.md.snapshot",
    });

    expect(prompt).toContain("fuzzy state");
    expect(prompt).toContain("docs/user-stories.md");
    expect(prompt).toContain("overallVerdict");
    expect(prompt).toContain("coverageReviews");
    expect(prompt).toContain("llm-review.schema.md");
    expect(prompt).toContain("story-1 | story-2");
    expect(prompt).toContain("story-1.1");
    expect(prompt).toContain("/tmp/run/evidence.json");
  });
});
