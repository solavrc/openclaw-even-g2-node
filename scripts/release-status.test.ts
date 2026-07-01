import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { dirtyContentSha256, porcelainStatusSummary } from "./git-state.ts";
import {
  currentPackedBundleWarning,
  releaseBundleGitWarning,
  releaseCandidateCommitCount,
  simulatorRelevantChangedFilesSinceReport,
  releaseStatusSummary,
  simulatorFixturesErrorSummary,
  simulatorFixturesGitWarning,
  simulatorFixturesReportAgeMs,
  simulatorFixturesWarning,
  STATIC_REVIEW_RISKS,
  submissionCopyBundleProblems,
} from "./release-status.ts";

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oc-eg2-node-release-status-"));
}

function runGit(dir: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

describe("git state helpers", () => {
  it("changes dirty content digest when tracked file content changes without changing porcelain status", () => {
    const dir = tempDir();
    const trackedFile = path.join(dir, "tracked.txt");
    runGit(dir, ["init"]);
    fs.writeFileSync(trackedFile, "base\n");
    runGit(dir, ["add", "tracked.txt"]);
    runGit(dir, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "base"]);

    fs.writeFileSync(trackedFile, "change one\n");
    const firstDigest = dirtyContentSha256(dir);
    fs.writeFileSync(trackedFile, "change two\n");
    const secondDigest = dirtyContentSha256(dir);

    expect(firstDigest).toHaveLength(64);
    expect(secondDigest).toHaveLength(64);
    expect(secondDigest).not.toBe(firstDigest);
  });

  it("changes dirty content digest when untracked file content changes without changing porcelain status", () => {
    const dir = tempDir();
    const untrackedFile = path.join(dir, "new.txt");
    runGit(dir, ["init"]);

    fs.writeFileSync(untrackedFile, "draft one\n");
    const firstDigest = dirtyContentSha256(dir);
    fs.writeFileSync(untrackedFile, "draft two\n");
    const secondDigest = dirtyContentSha256(dir);

    expect(firstDigest).toHaveLength(64);
    expect(secondDigest).toHaveLength(64);
    expect(secondDigest).not.toBe(firstDigest);
  });
});

describe("release status simulator fixture report", () => {
  it("summarizes porcelain status without printing the whole dirty file list", () => {
    expect(porcelainStatusSummary("")).toEqual({
      dirtyEntryCount: 0,
      statusSha256: null,
    });

    const summary = porcelainStatusSummary(" M src/main.tsx\n?? scripts/new-test.ts\n");
    expect(summary.dirtyEntryCount).toBe(2);
    expect(summary.statusSha256).toHaveLength(64);
  });

  it("accepts a fresh passing simulator fixture report", () => {
    const nowMs = Date.parse("2026-06-26T12:00:00.000Z");
    const report = { ok: true, generatedAt: "2026-06-26T11:30:00.000Z" };
    const ageMs = simulatorFixturesReportAgeMs(report, nowMs);

    expect(ageMs).toBe(30 * 60 * 1000);
    expect(simulatorFixturesWarning(report, ageMs)).toBeNull();
  });

  it("warns when the simulator fixture report is missing, failed, invalid, or stale", () => {
    const nowMs = Date.parse("2026-06-26T12:00:00.000Z");

    expect(simulatorFixturesWarning(null, null)).toContain("missing");
    expect(simulatorFixturesWarning({ ok: false, generatedAt: "2026-06-26T12:00:00.000Z" }, 0)).toContain("did not pass");
    expect(simulatorFixturesWarning({ ok: true, generatedAt: "not-a-date" }, null)).toContain("no valid generatedAt");
    expect(simulatorFixturesWarning(
      { ok: true, generatedAt: "2026-06-18T11:59:59.000Z" },
      simulatorFixturesReportAgeMs({ ok: true, generatedAt: "2026-06-18T11:59:59.000Z" }, nowMs),
    )).toContain("older than 7 days");
  });

  it("summarizes simulator fixture failure details without dumping stack traces into status output", () => {
    expect(simulatorFixturesErrorSummary(null)).toBeNull();
    expect(simulatorFixturesErrorSummary({ ok: true })).toBeNull();
    expect(simulatorFixturesErrorSummary({ ok: false, error: "\n" })).toContain("failed");
    expect(simulatorFixturesErrorSummary({
      ok: false,
      error: "Error: Glasses screenshot looked blank\n    at captureStep",
    })).toBe("Error: Glasses screenshot looked blank");
  });

  it("warns when simulator fixture report git metadata does not match the current source state", () => {
    const cleanHead = "a".repeat(40);
    const changedHead = "b".repeat(40);
    const cleanReport = {
      ok: true,
      generatedAt: "2026-06-26T11:30:00.000Z",
      git: {
        dirtyContentSha256: "clean-content",
        head: cleanHead,
        statusPorcelain: "",
        worktreeClean: true,
      },
    };

    expect(simulatorFixturesGitWarning(cleanReport, {
      currentHead: cleanHead,
      currentDirtyContentSha256: "clean-content",
      currentSimulatorSourceSha256: "sim-source",
      currentStatusPorcelain: "",
      simulatorRelevantChangedFilesSinceReport: null,
    })).toBeNull();
    expect(simulatorFixturesGitWarning({ ok: true }, {
      currentHead: cleanHead,
      currentDirtyContentSha256: "clean-content",
      currentSimulatorSourceSha256: "sim-source",
      currentStatusPorcelain: "",
      simulatorRelevantChangedFilesSinceReport: null,
    })).toContain("no git metadata");
    expect(simulatorFixturesGitWarning({
      ...cleanReport,
      git: {
        head: cleanHead,
        statusPorcelain: "",
        worktreeClean: true,
      },
    }, {
      currentHead: cleanHead,
      currentDirtyContentSha256: "clean-content",
      currentSimulatorSourceSha256: "sim-source",
      currentStatusPorcelain: "",
      simulatorRelevantChangedFilesSinceReport: null,
    })).toContain("no dirty content metadata");
    expect(simulatorFixturesGitWarning(cleanReport, {
      currentHead: changedHead,
      currentDirtyContentSha256: "clean-content",
      currentSimulatorSourceSha256: "sim-source",
      currentStatusPorcelain: "",
      simulatorRelevantChangedFilesSinceReport: ["src/main.tsx"],
    })).toContain("no simulator source metadata");
    expect(simulatorFixturesGitWarning(cleanReport, {
      currentHead: changedHead,
      currentDirtyContentSha256: "clean-content",
      currentSimulatorSourceSha256: "sim-source",
      currentStatusPorcelain: "",
      simulatorRelevantChangedFilesSinceReport: [],
    })).toBeNull();
    const changedSimulatorSourceWarning = simulatorFixturesGitWarning({
      ...cleanReport,
      git: {
        ...cleanReport.git,
        simulatorSourceSha256: "old-sim-source",
      },
    }, {
      currentHead: changedHead,
      currentDirtyContentSha256: "clean-content",
      currentSimulatorSourceSha256: "new-sim-source",
      currentStatusPorcelain: "",
      simulatorRelevantChangedFilesSinceReport: ["src/main.tsx"],
    });
    expect(changedSimulatorSourceWarning).toContain("simulator source files changed");
    expect(changedSimulatorSourceWarning).toContain("src/main.tsx");
    expect(simulatorFixturesGitWarning({
      ...cleanReport,
      git: {
        ...cleanReport.git,
        simulatorSourceSha256: "old-sim-source",
      },
    }, {
      currentHead: changedHead,
      currentDirtyContentSha256: "clean-content",
      currentSimulatorSourceSha256: "new-sim-source",
      currentStatusPorcelain: "",
      simulatorRelevantChangedFilesSinceReport: [],
    })).toBeNull();
    expect(simulatorFixturesGitWarning({
      ...cleanReport,
      git: {
        ...cleanReport.git,
        simulatorSourceSha256: "same-sim-source",
      },
    }, {
      currentHead: changedHead,
      currentDirtyContentSha256: "clean-content",
      currentSimulatorSourceSha256: "same-sim-source",
      currentStatusPorcelain: "",
      simulatorRelevantChangedFilesSinceReport: ["src/main.tsx"],
    })).toBeNull();
    expect(simulatorFixturesGitWarning(cleanReport, {
      currentHead: cleanHead,
      currentDirtyContentSha256: "changed-content",
      currentSimulatorSourceSha256: "sim-source",
      currentStatusPorcelain: "",
      simulatorRelevantChangedFilesSinceReport: null,
    })).toContain("source content changed");
    expect(simulatorFixturesGitWarning(cleanReport, {
      currentHead: cleanHead,
      currentDirtyContentSha256: "clean-content",
      currentSimulatorSourceSha256: "sim-source",
      currentStatusPorcelain: " M src/main.tsx",
      simulatorRelevantChangedFilesSinceReport: null,
    })).toContain("worktree changed");
    expect(simulatorFixturesGitWarning({
      ...cleanReport,
      git: {
        dirtyContentSha256: "clean-content",
        head: cleanHead,
        statusPorcelain: " M src/main.tsx",
        worktreeClean: false,
      },
    }, {
      currentHead: cleanHead,
      currentDirtyContentSha256: "clean-content",
      currentSimulatorSourceSha256: "sim-source",
      currentStatusPorcelain: "",
      simulatorRelevantChangedFilesSinceReport: null,
    })).toContain("uncommitted changes");
  });

  it("filters simulator-relevant changed files since a fixture report", () => {
    const dir = tempDir();
    runGit(dir, ["init", "--initial-branch=main"]);
    runGit(dir, ["config", "user.name", "Test"]);
    runGit(dir, ["config", "user.email", "test@example.invalid"]);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "main.tsx"), "one\n");
    fs.writeFileSync(path.join(dir, "docs.md"), "one\n");
    runGit(dir, ["add", "."]);
    runGit(dir, ["commit", "-m", "base"]);
    const reportHead = runGit(dir, ["rev-parse", "HEAD"]);
    fs.writeFileSync(path.join(dir, "src", "main.tsx"), "two\n");
    fs.writeFileSync(path.join(dir, "docs.md"), "two\n");
    runGit(dir, ["add", "."]);
    runGit(dir, ["commit", "-m", "change simulator source"]);
    const currentHead = runGit(dir, ["rev-parse", "HEAD"]);

    expect(simulatorRelevantChangedFilesSinceReport({
      git: { head: reportHead },
    }, currentHead, dir)).toEqual(["src/main.tsx"]);
    expect(simulatorRelevantChangedFilesSinceReport({
      git: { head: currentHead },
    }, currentHead, dir)).toBeNull();
  });
});

describe("release status bundle freshness", () => {
  it("accepts a release bundle that matches the current packed artifact", () => {
    const dir = tempDir();
    const currentEhpkPath = path.join(dir, "openclaw-even-g2-node.ehpk");
    const bundleEhpkPath = path.join(dir, "release.ehpk");
    fs.writeFileSync(currentEhpkPath, "same artifact");
    fs.writeFileSync(bundleEhpkPath, "same artifact");

    expect(currentPackedBundleWarning({
      bundleEhpkPath,
      bundleSha256: sha256("same artifact"),
      currentEhpkPath,
    })).toBeNull();
  });

  it("warns when current packed artifact is missing and blocks when it differs", () => {
    const dir = tempDir();
    const currentEhpkPath = path.join(dir, "openclaw-even-g2-node.ehpk");
    const bundleEhpkPath = path.join(dir, "release.ehpk");
    fs.writeFileSync(bundleEhpkPath, "bundle artifact");

    expect(currentPackedBundleWarning({
      bundleEhpkPath,
      bundleSha256: sha256("bundle artifact"),
      currentEhpkPath,
    })).toContain("current packed .ehpk is missing");

    fs.writeFileSync(currentEhpkPath, "new artifact");
    const mismatchWarning = currentPackedBundleWarning({
      bundleEhpkPath,
      bundleSha256: sha256("bundle artifact"),
      currentEhpkPath,
    });
    expect(mismatchWarning).toContain("differs from the current packed .ehpk");
    expect(mismatchWarning).toContain("pnpm release:bundle:summary");
  });

  it("warns when release bundle git metadata does not match the current source state", () => {
    const cleanBundle = {
      git: {
        dirtyContentSha256: "clean-content",
        head: "a".repeat(40),
        statusPorcelain: "",
        worktreeClean: true,
      },
    };

    expect(releaseBundleGitWarning(cleanBundle, {
      currentHead: "a".repeat(40),
      currentDirtyContentSha256: "clean-content",
      currentStatusPorcelain: "",
    })).toBeNull();
    expect(releaseBundleGitWarning({}, {
      currentHead: "a".repeat(40),
      currentDirtyContentSha256: "clean-content",
      currentStatusPorcelain: "",
    })).toContain("no git metadata");
    expect(releaseBundleGitWarning(cleanBundle, {
      currentHead: "b".repeat(40),
      currentDirtyContentSha256: "clean-content",
      currentStatusPorcelain: "",
    })).toContain("different git HEAD");
    const changedContentWarning = releaseBundleGitWarning(cleanBundle, {
      currentHead: "a".repeat(40),
      currentDirtyContentSha256: "changed-content",
      currentStatusPorcelain: "",
    });
    expect(changedContentWarning).toContain("source content changed");
    expect(changedContentWarning).toContain("pnpm release:bundle:summary");
    const changedWorktreeWarning = releaseBundleGitWarning(cleanBundle, {
      currentHead: "a".repeat(40),
      currentDirtyContentSha256: "clean-content",
      currentStatusPorcelain: " M src/main.tsx",
    });
    expect(changedWorktreeWarning).toContain("worktree changed");
    expect(changedWorktreeWarning).toContain("pnpm release:bundle:summary");
    expect(releaseBundleGitWarning({
      git: {
        dirtyContentSha256: "clean-content",
        head: "a".repeat(40),
        statusPorcelain: " M src/main.tsx",
        worktreeClean: false,
      },
    }, {
      currentHead: "a".repeat(40),
      currentDirtyContentSha256: "clean-content",
      currentStatusPorcelain: "",
    })).toContain("uncommitted changes");
  });
});

describe("release status review risks", () => {
  it("does not keep the resolved session-picker exit gesture as a review risk", () => {
    expect(STATIC_REVIEW_RISKS).not.toContain(
      "Selected-session double-tap opens the session picker; Even Hub review may require the logical root page double-tap to call shutDownPageContainer(1).",
    );
  });

  it("builds a compact status summary for release handoff checks", () => {
    const summary = releaseStatusSummary({
      ok: false,
      publicReleaseReady: false,
      reviewSubmissionReady: true,
      privateRehearsalReady: true,
      app: {
        packageId: "com.solavrc.openclaweveng2node",
        name: "OpenClaw Node",
        version: "0.1.9",
        networkWhitelist: [],
      },
      git: {
        remoteOrigin: "git@github.com:solavrc/openclaw-even-g2-node.git",
        expectedRepoUrl: "https://github.com/solavrc/openclaw-even-g2-node",
        expectedRemoteUrl: "https://github.com/solavrc/openclaw-even-g2-node.git",
        commitCount: 42,
        releaseCandidateCommits: 3,
        worktreeClean: true,
        head: "a".repeat(40),
        dirtyContentSha256: "b".repeat(64),
        dirtyEntryCount: 0,
        statusSha256: null,
      },
      privacyUrl: "https://github.com/solavrc/openclaw-even-g2-node/blob/main/PRIVACY.md",
      supportUrl: "https://github.com/solavrc/openclaw-even-g2-node/issues",
      publicUrlsReachableAfterPush: true,
      simulatorFixtures: {
        ok: true,
        generatedAt: "2026-06-26T12:00:00.000Z",
        ageHours: 1,
        reportPath: ".openclaw-even-g2-node/simulator-fixtures-report.json",
        error: null,
        fixtures: [],
        git: null,
      },
      bundleDir: "/tmp/release/com.solavrc.openclaweveng2node-0.1.9",
      bundle: {
        ehpk: {
          file: "openclaw-even-g2-node-0.1.9.ehpk",
          sizeBytes: 123,
          sha256: "c".repeat(64),
        },
      },
      blockers: [],
      privateRehearsalBlockers: [],
      reviewRisks: STATIC_REVIEW_RISKS,
      warnings: [],
    });

    expect(summary).toMatchObject({
      publicReleaseReady: false,
      reviewSubmissionReady: true,
      privateRehearsalReady: true,
      app: {
        packageId: "com.solavrc.openclaweveng2node",
        version: "0.1.9",
      },
      git: {
        worktreeClean: true,
        releaseCandidateCommits: 3,
      },
      simulatorFixtures: {
        ok: true,
        generatedAt: "2026-06-26T12:00:00.000Z",
        ageHours: 1,
        error: null,
      },
      bundle: {
        ehpkFile: "openclaw-even-g2-node-0.1.9.ehpk",
      },
      reviewRisks: STATIC_REVIEW_RISKS,
    });
  });
});

describe("release status submission copy", () => {
  it("keeps review inquiry material out of the direct submission copy", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "submission-copy.md"), "# Even Hub Submission Copy\n\n## Store Listing\n");
    fs.writeFileSync(
      path.join(dir, "review-inquiry.md"),
      "# Even Hub Review Inquiry\n\n## Current Public Review Risk\n\nRisk.\n\n## Review Inquiry Draft\n",
    );

    expect(submissionCopyBundleProblems(dir)).toEqual([]);

    fs.writeFileSync(path.join(dir, "submission-copy.md"), "# Even Hub Submission Copy\n\n## Current Public Review Risk\n");
    expect(submissionCopyBundleProblems(dir)).toContain(
      "release bundle submission-copy.md includes internal review-risk/inquiry sections; keep those in review-inquiry.md.",
    );

    fs.writeFileSync(path.join(dir, "submission-copy.md"), "# Even Hub Submission Copy\n\n## Current Public Release Blocker\n");
    expect(submissionCopyBundleProblems(dir)).toContain(
      "release bundle submission-copy.md includes internal review-risk/inquiry sections; keep those in review-inquiry.md.",
    );
  });

  it("requires the separate review inquiry artifact", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "submission-copy.md"), "# Even Hub Submission Copy\n");

    expect(submissionCopyBundleProblems(dir)).toContain("release bundle review-inquiry.md is missing.");
  });

  it("requires review inquiry content when the artifact exists", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "submission-copy.md"), "# Even Hub Submission Copy\n");
    fs.writeFileSync(path.join(dir, "review-inquiry.md"), "# Even Hub Review Inquiry\n");

    expect(submissionCopyBundleProblems(dir)).toEqual([
      "release bundle review-inquiry.md is missing the current public review risk section.",
      "release bundle review-inquiry.md is missing the review inquiry draft.",
    ]);
  });
});

describe("release status git history", () => {
  it("counts only commits ahead of origin/main for release status reporting", () => {
    const dir = tempDir();
    runGit(dir, ["init", "--initial-branch=main"]);
    runGit(dir, ["config", "user.name", "Test"]);
    runGit(dir, ["config", "user.email", "test@example.invalid"]);
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
    runGit(dir, ["add", "base.txt"]);
    runGit(dir, ["commit", "-m", "base"]);
    runGit(dir, ["branch", "origin/main"]);
    runGit(dir, ["checkout", "-b", "codex/release-candidate"]);
    fs.writeFileSync(path.join(dir, "feature.txt"), "feature\n");
    runGit(dir, ["add", "feature.txt"]);
    runGit(dir, ["commit", "-m", "feat: add release candidate"]);

    expect(releaseCandidateCommitCount(dir)).toBe(1);
  });
});
