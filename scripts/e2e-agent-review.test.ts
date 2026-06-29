import { describe, expect, it } from "vitest";
import {
  buildReviewPrompt,
  parseArgs,
  parseE2eGlassMarkers,
  redactText,
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
      openclawTimeoutMs: 7000,
      outDir: "/tmp/e2e-review",
      simulatorUrl: "http://127.0.0.1:9999",
    });
  });

  it("redacts tokens and setup codes before writing evidence", () => {
    const redacted = redactText("Bearer abc.def setupCode=wss%3A%2F%2Fgateway.example%2Fws%3Ftoken%3Dsecret token=plain");

    expect(redacted).toContain("Bearer <redacted>");
    expect(redacted).toContain("setupCode=<redacted>");
    expect(redacted).toContain("token=<redacted>");
    expect(redacted).not.toContain("abc.def");
    expect(redacted).not.toContain("secret");
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
    expect(prompt).toContain("/tmp/run/evidence.json");
  });
});
