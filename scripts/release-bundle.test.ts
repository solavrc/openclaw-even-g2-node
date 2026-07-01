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
