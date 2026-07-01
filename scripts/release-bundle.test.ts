import { describe, expect, it } from "vitest";
import { releaseBundleSummary, type ReleaseBundleResult } from "./release-bundle.ts";

describe("releaseBundleSummary", () => {
  it("keeps release handoff output compact while preserving the upload-critical fields", () => {
    const bundle: ReleaseBundleResult = {
      ok: true,
      releaseDir: "/tmp/release/com.solavrc.openclaweveng2node-0.1.9",
      packageName: "@solavrc/openclaw-even-g2-node",
      appName: "OpenClaw Node",
      packageId: "com.solavrc.openclaweveng2node",
      version: "0.1.9",
      ehpk: {
        file: "openclaw-even-g2-node-0.1.9.ehpk",
        sizeBytes: 184727,
        sha256: "a".repeat(64),
      },
      evenHubIcon: {
        file: "openclaw-node-evenhub-icon-24.png",
        sha256: "b".repeat(64),
      },
      storeScreenshots: [
        {
          file: "evenhub-screenshots/01.png",
          height: 288,
          sha256: "c".repeat(64),
          sizeBytes: 4001,
          width: 576,
        },
      ],
      storeScreenshotsSource: {
        schemaVersion: 1,
        captureSource: "official-evenhub-simulator-camera",
        editingPolicy: "none; screenshots are direct simulator captures",
        generatedAt: "2026-06-26T21:06:46.158Z",
        simulatorSourceSha256: "d".repeat(64),
        git: {
          dirtyContentSha256: "e".repeat(64),
          head: "f".repeat(40),
          statusPorcelain: "",
          worktreeClean: true,
        },
        screenshots: [],
      },
      generatedAt: "2026-06-26T21:23:03.590Z",
      network: {
        whitelist: [],
        developmentOrigins: [],
        reviewRequired: true,
        reviewRisk: "Runtime Gateway endpoint review required.",
        publicReleaseBlockedByNetworkReview: true,
      },
      git: {
        dirtyContentSha256: "g".repeat(64),
        head: "h".repeat(40),
        statusPorcelain: "",
        worktreeClean: true,
      },
      publicReleaseBlockedByNetworkReview: true,
    };

    expect(releaseBundleSummary(bundle)).toEqual({
      ok: true,
      releaseDir: "/tmp/release/com.solavrc.openclaweveng2node-0.1.9",
      packageId: "com.solavrc.openclaweveng2node",
      version: "0.1.9",
      ehpk: {
        file: "openclaw-even-g2-node-0.1.9.ehpk",
        sizeBytes: 184727,
        sha256: "a".repeat(64),
      },
      storeScreenshotCount: 1,
      storeScreenshotsSource: {
        generatedAt: "2026-06-26T21:06:46.158Z",
        head: "f".repeat(40),
        worktreeClean: true,
      },
      network: {
        reviewRequired: true,
        publicReleaseBlockedByNetworkReview: true,
      },
      git: {
        head: "h".repeat(40),
        worktreeClean: true,
      },
    });
  });
});
