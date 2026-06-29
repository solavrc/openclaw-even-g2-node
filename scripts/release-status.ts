import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appManifestNetworkWhitelist } from "./app-manifest.ts";
import { dirtyContentSha256, git, porcelainStatusSummary } from "./git-state.ts";
import { networkReviewMetadata } from "./network-origins.ts";
import { isSimulatorSourcePath, simulatorSourceSha256 } from "./simulator-source-fingerprint.ts";
import { errorStack } from "./strict-helpers.ts";
import {
  storeScreenshotSourceManifestProblems,
  type StoreScreenshotSourceManifest,
} from "./store-screenshot-manifest.ts";

type AppManifest = {
  package_id?: string;
  name?: string;
  version?: string;
  permissions?: unknown;
};

type BundleManifest = {
  packageId?: string;
  version?: string;
  ehpk?: {
    file?: string;
    sizeBytes?: number;
    sha256?: string;
  };
  network?: {
    whitelist?: string[];
    developmentOrigins?: string[];
    reviewRequired?: boolean;
    reviewRisk?: string | null;
  };
  storeScreenshots?: Array<{
    file?: string;
    height?: number;
    sha256?: string;
    sizeBytes?: number;
    width?: number;
  }>;
  storeScreenshotsSource?: StoreScreenshotSourceManifest | null;
  publicReleaseBlockedByNetworkReview?: boolean;
  git?: {
    dirtyContentSha256?: string | null;
    head?: string | null;
    statusPorcelain?: string;
    worktreeClean?: boolean;
  };
};

export type ReleaseStatus = {
  ok: boolean;
  publicReleaseReady: boolean;
  reviewSubmissionReady: boolean;
  privateRehearsalReady: boolean;
  app: {
    packageId?: string;
    name?: string;
    version?: string;
    networkWhitelist: string[];
  };
  git: {
    remoteOrigin: string | null;
    expectedRepoUrl: string;
    expectedRemoteUrl: string;
    commitCount: number;
    releaseCandidateCommits: number;
    worktreeClean: boolean;
    head: string | null;
    dirtyContentSha256: string;
    dirtyEntryCount: number;
    statusSha256: string | null;
  };
  privacyUrl: string;
  supportUrl: string;
  publicUrlsReachableAfterPush: boolean;
  simulatorFixtures: {
    ok: boolean;
    generatedAt: string | null;
    ageHours: number | null;
    reportPath: string;
    error: string | null;
    fixtures: unknown[] | null;
    git: {
      head: string | null;
      dirtyContentSha256: string | null;
      simulatorSourceSha256: string | null;
      worktreeClean: boolean;
      dirtyEntryCount: number;
      statusSha256: string | null;
    } | null;
  };
  bundleDir: string;
  bundle: BundleManifest | null;
  blockers: string[];
  reviewRisks: string[];
  privateRehearsalBlockers: string[];
  warnings: string[];
};

export type ReleaseStatusSummary = {
  publicReleaseReady: boolean;
  reviewSubmissionReady: boolean;
  privateRehearsalReady: boolean;
  app: {
    packageId?: string;
    version?: string;
  };
  git: {
    head: string | null;
    worktreeClean: boolean;
    releaseCandidateCommits: number;
  };
  simulatorFixtures: {
    ok: boolean;
    generatedAt: string | null;
    ageHours: number | null;
    error: string | null;
  };
  bundle: {
    dir: string;
    ehpkFile?: string;
    ehpkSha256?: string;
    screenshotCount: number;
    screenshotSource: {
      generatedAt?: string;
      head?: string | null;
      worktreeClean?: boolean;
    } | null;
  } | null;
  blockers: string[];
  privateRehearsalBlockers: string[];
  reviewRisks: string[];
  warnings: string[];
};

export type SimulatorFixturesReport = {
  error?: string;
  ok?: boolean;
  generatedAt?: string;
  fixtures?: unknown;
  git?: {
    dirtyContentSha256?: string | null;
    head?: string | null;
    simulatorSourceSha256?: string | null;
    statusPorcelain?: string;
    worktreeClean?: boolean;
  };
  results?: unknown;
};

const ROOT = process.cwd();
const EXPECTED_PACKAGE_ID = "com.solavrc.openclaweveng2node";
const EXPECTED_APP_NAME = "OpenClaw Node";
const EXPECTED_REPO_URL = "https://github.com/solavrc/openclaw-even-g2-node";
const EXPECTED_REMOTE_URL = `${EXPECTED_REPO_URL}.git`;
const PRIVACY_URL = `${EXPECTED_REPO_URL}/blob/main/PRIVACY.md`;
const SUPPORT_URL = `${EXPECTED_REPO_URL}/issues`;
const APP_EHPK_PATH = path.join(ROOT, "openclaw-even-g2-node.ehpk");
const SIMULATOR_FIXTURES_REPORT = path.join(ROOT, ".openclaw-even-g2-node", "simulator-fixtures-report.json");
const MAX_SIMULATOR_FIXTURE_REPORT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const STATIC_REVIEW_RISKS: string[] = [];

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function simulatorFixturesReport(): SimulatorFixturesReport | null {
  if (!fs.existsSync(SIMULATOR_FIXTURES_REPORT)) return null;
  return readJson<SimulatorFixturesReport>(SIMULATOR_FIXTURES_REPORT);
}

export function simulatorFixturesErrorSummary(report: SimulatorFixturesReport | null): string | null {
  if (!report?.error) return null;
  const firstLine = report.error.split(/\r?\n/, 1)[0]?.trim();
  return firstLine || "Simulator fixture failed; see the report for details.";
}

export function simulatorFixturesReportAgeMs(report: SimulatorFixturesReport | null, nowMs = Date.now()): number | null {
  if (!report?.generatedAt) return null;
  const generatedAtMs = Date.parse(report.generatedAt);
  if (!Number.isFinite(generatedAtMs)) return null;
  return nowMs - generatedAtMs;
}

export function simulatorFixturesWarning(report: SimulatorFixturesReport | null, ageMs: number | null) {
  if (!report) return "simulator fixture report is missing; run `pnpm sim:fixtures` when visual smoke is useful.";
  if (report.ok !== true) return "last simulator fixture report did not pass.";
  if (ageMs === null) return "simulator fixture report has no valid generatedAt timestamp.";
  if (ageMs > MAX_SIMULATOR_FIXTURE_REPORT_AGE_MS) {
    return "simulator fixture report is older than 7 days; rerun `pnpm sim:fixtures` when fresh visual-smoke context is useful.";
  }
  return null;
}

export function simulatorFixturesGitWarning(
  report: SimulatorFixturesReport | null,
  {
    currentHead,
    currentDirtyContentSha256,
    currentSimulatorSourceSha256,
    currentStatusPorcelain,
    simulatorRelevantChangedFilesSinceReport,
  }: {
    currentHead: string | null;
    currentDirtyContentSha256: string;
    currentSimulatorSourceSha256: string;
    currentStatusPorcelain: string;
    simulatorRelevantChangedFilesSinceReport: string[] | null;
  },
) {
  if (!report) return null;
  if (!report.git) return "simulator fixture report has no git metadata; rerun `pnpm sim:fixtures`.";
  if (report.git.simulatorSourceSha256) {
    if (report.git.simulatorSourceSha256 !== currentSimulatorSourceSha256) {
      if (simulatorRelevantChangedFilesSinceReport?.length === 0) return null;
      const changedFiles = simulatorRelevantChangedFilesSinceReport?.length
        ? ` Changed files: ${simulatorRelevantChangedFilesSinceReport.slice(0, 5).join(", ")}${simulatorRelevantChangedFilesSinceReport.length > 5 ? ", ..." : ""}.`
        : "";
      return `simulator source files changed since the fixture report; rerun \`pnpm sim:fixtures\`.${changedFiles}`;
    }
  } else if (report.git.head && currentHead && report.git.head !== currentHead && simulatorRelevantChangedFilesSinceReport?.length !== 0) {
    const changedFiles = simulatorRelevantChangedFilesSinceReport?.length
      ? ` Changed files: ${simulatorRelevantChangedFilesSinceReport.slice(0, 5).join(", ")}${simulatorRelevantChangedFilesSinceReport.length > 5 ? ", ..." : ""}.`
      : "";
    return `simulator fixture report has no simulator source metadata and relevant files may have changed; rerun \`pnpm sim:fixtures\`.${changedFiles}`;
  }
  if (!report.git.dirtyContentSha256) return "simulator fixture report has no dirty content metadata; rerun `pnpm sim:fixtures`.";
  if (report.git.dirtyContentSha256 !== currentDirtyContentSha256) {
    return "source content changed since the simulator fixture report; rerun `pnpm sim:fixtures` after the current edits settle.";
  }
  if (currentStatusPorcelain && report.git.statusPorcelain !== currentStatusPorcelain) {
    return "git worktree changed since the simulator fixture report; rerun `pnpm sim:fixtures` after the current edits settle.";
  }
  if (!currentStatusPorcelain && report.git.worktreeClean !== true) {
    return "simulator fixture report was generated with uncommitted changes; rerun `pnpm sim:fixtures` if a clean visual-smoke baseline is useful.";
  }
  return null;
}

export function simulatorRelevantChangedFilesSinceReport(report: SimulatorFixturesReport | null, currentHead: string | null, cwd = ROOT) {
  const reportHead = report?.git?.head;
  if (!reportHead || !currentHead || reportHead === currentHead) return null;
  const changedFiles = git(["diff", "--name-only", `${reportHead}..${currentHead}`], cwd)
    .split("\n")
    .map((filePath) => filePath.trim())
    .filter(Boolean)
    .filter(isSimulatorSourcePath);
  return changedFiles;
}

export function currentPackedBundleWarning({
  bundleEhpkPath,
  bundleSha256,
  currentEhpkPath = APP_EHPK_PATH,
}: {
  bundleEhpkPath: string;
  bundleSha256: string;
  currentEhpkPath?: string;
}) {
  if (!fs.existsSync(currentEhpkPath)) {
    return "current packed .ehpk is missing; run `pnpm run pack` or `pnpm release:check` before trusting bundle freshness.";
  }
  const currentPackedSha256 = sha256File(currentEhpkPath);
  if (currentPackedSha256 !== bundleSha256) {
    return "release bundle .ehpk differs from the current packed .ehpk; rerun `pnpm release:bundle:summary`.";
  }
  const currentSize = fs.statSync(currentEhpkPath).size;
  const bundleSize = fs.existsSync(bundleEhpkPath) ? fs.statSync(bundleEhpkPath).size : null;
  if (bundleSize !== null && currentSize !== bundleSize) {
    return "release bundle .ehpk size differs from the current packed .ehpk; rerun `pnpm release:bundle:summary`.";
  }
  return null;
}

export function storeScreenshotBundleProblems(
  bundle: BundleManifest | null,
  bundleDir: string,
  currentSimulatorSourceSha256?: string,
) {
  const screenshots = bundle?.storeScreenshots;
  if (!Array.isArray(screenshots) || screenshots.length === 0) {
    return ["release bundle has no Even Hub store screenshots."];
  }
  const resolvedBundleDir = path.resolve(bundleDir);
  const problems: string[] = [];
  if (screenshots.length > 6) {
    problems.push(`release bundle has ${screenshots.length} store screenshots; Even Hub accepts at most 6.`);
  }
  screenshots.forEach((screenshot, index) => {
    const label = screenshot.file || `store screenshot #${index + 1}`;
    if (!screenshot.file) {
      problems.push(`${label} has no file path.`);
      return;
    }
    const filePath = path.resolve(resolvedBundleDir, screenshot.file);
    const relativePath = path.relative(resolvedBundleDir, filePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || !fs.existsSync(filePath)) {
      problems.push(`${label} is missing from the release bundle.`);
      return;
    }
    const sizeBytes = fs.statSync(filePath).size;
    const sha256 = sha256File(filePath);
    if (screenshot.sizeBytes !== sizeBytes) {
      problems.push(`${label} size mismatch: manifest=${screenshot.sizeBytes}, actual=${sizeBytes}.`);
    }
    if (screenshot.sha256 !== sha256) {
      problems.push(`${label} SHA-256 mismatch.`);
    }
    if (screenshot.width !== 576 || screenshot.height !== 288) {
      problems.push(`${label} is ${screenshot.width || "?"}x${screenshot.height || "?"}; expected 576x288.`);
    }
  });
  if (currentSimulatorSourceSha256) {
    problems.push(...storeScreenshotSourceManifestProblems({
      manifest: bundle?.storeScreenshotsSource,
      screenshots: screenshots.map((screenshot) => ({
        file: path.basename(screenshot.file || ""),
        height: screenshot.height || 0,
        sha256: screenshot.sha256 || "",
        sizeBytes: screenshot.sizeBytes || 0,
        width: screenshot.width || 0,
      })),
      currentSimulatorSourceSha256,
    }));
  }
  return problems;
}

export function submissionCopyBundleProblems(bundleDir: string) {
  const submissionCopyPath = path.join(bundleDir, "submission-copy.md");
  const reviewInquiryPath = path.join(bundleDir, "review-inquiry.md");
  const problems: string[] = [];
  if (!fs.existsSync(submissionCopyPath)) {
    problems.push("release bundle submission-copy.md is missing.");
  } else {
    const submissionCopy = fs.readFileSync(submissionCopyPath, "utf8");
    if (
      /^## Current Public Review Risk\b/m.test(submissionCopy)
      || /^## Current Public Release Blocker\b/m.test(submissionCopy)
      || /^## Review Inquiry Draft\b/m.test(submissionCopy)
    ) {
      problems.push("release bundle submission-copy.md includes internal review-risk/inquiry sections; keep those in review-inquiry.md.");
    }
  }
  if (!fs.existsSync(reviewInquiryPath)) {
    problems.push("release bundle review-inquiry.md is missing.");
  } else {
    const reviewInquiry = fs.readFileSync(reviewInquiryPath, "utf8");
    if (!/^## Current Public Review Risk\b/m.test(reviewInquiry) && !/^## Current Public Release Blocker\b/m.test(reviewInquiry)) {
      problems.push("release bundle review-inquiry.md is missing the current public review risk section.");
    }
    if (!/^## Review Inquiry Draft\b/m.test(reviewInquiry)) {
      problems.push("release bundle review-inquiry.md is missing the review inquiry draft.");
    }
  }
  return problems;
}

export function releaseBundleGitWarning(
  bundle: BundleManifest | null,
  {
    currentHead,
    currentDirtyContentSha256,
    currentStatusPorcelain,
  }: {
    currentHead: string | null;
    currentDirtyContentSha256: string;
    currentStatusPorcelain: string;
  },
) {
  if (!bundle) return null;
  if (!bundle.git) return "release bundle has no git metadata; rerun `pnpm release:bundle:summary`.";
  if (!bundle.git.head) return "release bundle has no git HEAD metadata; rerun `pnpm release:bundle:summary`.";
  if (currentHead && bundle.git.head !== currentHead) {
    return "release bundle was generated from a different git HEAD; rerun `pnpm release:bundle:summary`.";
  }
  if (!bundle.git.dirtyContentSha256) return "release bundle has no dirty content metadata; rerun `pnpm release:bundle:summary`.";
  if (bundle.git.dirtyContentSha256 !== currentDirtyContentSha256) {
    return "source content changed since the release bundle; rerun `pnpm release:bundle:summary`.";
  }
  if (currentStatusPorcelain && bundle.git.statusPorcelain !== currentStatusPorcelain) {
    return "git worktree changed since the release bundle; rerun `pnpm release:bundle:summary` after the current edits settle.";
  }
  if (!currentStatusPorcelain && bundle.git.worktreeClean !== true) {
    return "release bundle was generated with uncommitted changes; rerun `pnpm release:bundle:summary` if you need a clean-tree bundle.";
  }
  return null;
}

export function releaseCandidateCommitCount(cwd = ROOT): number {
  const aheadOfOriginMain = git(["rev-list", "--count", "origin/main..HEAD"], cwd);
  if (aheadOfOriginMain) return Number(aheadOfOriginMain);
  return Number(git(["rev-list", "--all", "--count"], cwd) || "0");
}

export function releaseStatusSummary(status: ReleaseStatus): ReleaseStatusSummary {
  return {
    publicReleaseReady: status.publicReleaseReady,
    reviewSubmissionReady: status.reviewSubmissionReady,
    privateRehearsalReady: status.privateRehearsalReady,
    app: {
      packageId: status.app.packageId,
      version: status.app.version,
    },
    git: {
      head: status.git.head,
      worktreeClean: status.git.worktreeClean,
      releaseCandidateCommits: status.git.releaseCandidateCommits,
    },
    simulatorFixtures: {
      ok: status.simulatorFixtures.ok,
      generatedAt: status.simulatorFixtures.generatedAt,
      ageHours: status.simulatorFixtures.ageHours,
      error: status.simulatorFixtures.error,
    },
    bundle: status.bundle ? {
      dir: status.bundleDir,
      ehpkFile: status.bundle.ehpk?.file,
      ehpkSha256: status.bundle.ehpk?.sha256,
      screenshotCount: status.bundle.storeScreenshots?.length ?? 0,
      screenshotSource: status.bundle.storeScreenshotsSource ? {
        generatedAt: status.bundle.storeScreenshotsSource.generatedAt,
        head: status.bundle.storeScreenshotsSource.git?.head,
        worktreeClean: status.bundle.storeScreenshotsSource.git?.worktreeClean,
      } : null,
    } : null,
    blockers: status.blockers,
    privateRehearsalBlockers: status.privateRehearsalBlockers,
    reviewRisks: status.reviewRisks,
    warnings: status.warnings,
  };
}

export function main(): void {
  const appManifest = readJson<AppManifest>(path.join(ROOT, "app.json"));
  const publicBlockers: string[] = [];
  const privateRehearsalBlockers: string[] = [];
  const reviewRisks: string[] = [];
  const warnings: string[] = [];

  const blockAll = (message: string): void => {
    publicBlockers.push(message);
    privateRehearsalBlockers.push(message);
  };
  const blockPrivate = (message: string): void => {
    privateRehearsalBlockers.push(message);
  };

  if (appManifest.package_id !== EXPECTED_PACKAGE_ID) {
    blockAll(`package_id is ${appManifest.package_id || "<missing>"}, expected ${EXPECTED_PACKAGE_ID}`);
  }
  if (appManifest.name !== EXPECTED_APP_NAME) {
    blockAll(`Even Hub listing name is ${appManifest.name || "<missing>"}, expected ${EXPECTED_APP_NAME}`);
  }

  const remoteOrigin = git(["remote", "get-url", "origin"], ROOT);
  if (!remoteOrigin) {
    publicBlockers.push(`git remote origin is not configured; expected ${EXPECTED_REMOTE_URL} before publishing.`);
  } else if (remoteOrigin !== EXPECTED_REMOTE_URL && remoteOrigin !== `git@github.com:solavrc/openclaw-even-g2-node.git`) {
    publicBlockers.push(`git remote origin is ${remoteOrigin}; expected ${EXPECTED_REMOTE_URL}.`);
  }

  const worktreeStatus = git(["status", "--porcelain"], ROOT);
  const currentDirtyContentSha256 = dirtyContentSha256(ROOT);
  if (worktreeStatus) {
    warnings.push("git worktree has uncommitted changes; make sure the uploaded .ehpk and release bundle are the intended artifacts.");
  }

  const commitCount = Number(git(["rev-list", "--all", "--count"], ROOT) || "0");
  const releaseCandidateCommits = releaseCandidateCommitCount(ROOT);
  const currentHead = git(["rev-parse", "HEAD"], ROOT) || null;

  if (!fs.existsSync(path.join(ROOT, "PRIVACY.md"))) {
    blockAll("PRIVACY.md is missing.");
  }

  const simulatorReport = simulatorFixturesReport();
  const simulatorReportAgeMs = simulatorFixturesReportAgeMs(simulatorReport);
  const currentSimulatorSourceSha256 = simulatorSourceSha256(ROOT);
  const simulatorWarning = simulatorFixturesWarning(simulatorReport, simulatorReportAgeMs);
  if (simulatorWarning) warnings.push(simulatorWarning);
  const simulatorGitWarning = simulatorFixturesGitWarning(simulatorReport, {
    currentHead,
    currentDirtyContentSha256,
    currentSimulatorSourceSha256,
    currentStatusPorcelain: worktreeStatus,
    simulatorRelevantChangedFilesSinceReport: simulatorRelevantChangedFilesSinceReport(simulatorReport, currentHead),
  });
  if (simulatorGitWarning) warnings.push(simulatorGitWarning);

  const network = networkReviewMetadata(appManifestNetworkWhitelist(appManifest));
  const whitelist = network.whitelist;
  if (network.reviewRisk) reviewRisks.push(network.reviewRisk);
  reviewRisks.push(...STATIC_REVIEW_RISKS);

  const bundleDir = path.join(ROOT, "release", `${appManifest.package_id || "unknown"}-${appManifest.version || "unknown"}`);
  const bundleManifestPath = path.join(bundleDir, "bundle-manifest.json");
  let bundle: BundleManifest | null = null;
  if (!fs.existsSync(bundleManifestPath)) {
    blockPrivate("release bundle has not been generated.");
  } else {
    bundle = readJson<BundleManifest>(bundleManifestPath);
    const bundleEhpk = path.join(bundleDir, bundle.ehpk?.file || "");
    if (!bundle.ehpk?.file || !fs.existsSync(bundleEhpk)) {
      blockPrivate("release bundle .ehpk is missing.");
    } else {
      const sizeBytes = fs.statSync(bundleEhpk).size;
      const sha256 = sha256File(bundleEhpk);
      if (bundle.ehpk.sizeBytes !== sizeBytes) blockPrivate(`bundle .ehpk size mismatch: manifest=${bundle.ehpk.sizeBytes}, actual=${sizeBytes}`);
      if (bundle.ehpk.sha256 !== sha256) blockPrivate("bundle .ehpk SHA-256 mismatch.");
      const currentPackedWarning = currentPackedBundleWarning({ bundleEhpkPath: bundleEhpk, bundleSha256: sha256 });
      if (currentPackedWarning?.startsWith("current packed")) warnings.push(currentPackedWarning);
      else if (currentPackedWarning) blockPrivate(currentPackedWarning);
    }
    if (!fs.existsSync(path.join(bundleDir, "PRIVACY.md"))) blockPrivate("release bundle PRIVACY.md is missing.");
    for (const submissionCopyProblem of submissionCopyBundleProblems(bundleDir)) {
      blockPrivate(submissionCopyProblem);
    }
    for (const screenshotProblem of storeScreenshotBundleProblems(bundle, bundleDir, currentSimulatorSourceSha256)) {
      blockPrivate(screenshotProblem);
    }
    const bundleGitWarning = releaseBundleGitWarning(bundle, {
      currentHead,
      currentDirtyContentSha256,
      currentStatusPorcelain: worktreeStatus,
    });
    if (bundleGitWarning) warnings.push(bundleGitWarning);
  }

  const status: ReleaseStatus = {
    ok: publicBlockers.length === 0 && privateRehearsalBlockers.length === 0 && reviewRisks.length === 0,
    publicReleaseReady: publicBlockers.length === 0 && privateRehearsalBlockers.length === 0 && reviewRisks.length === 0,
    reviewSubmissionReady: publicBlockers.length === 0 && privateRehearsalBlockers.length === 0,
    privateRehearsalReady: privateRehearsalBlockers.length === 0,
    app: {
      packageId: appManifest.package_id,
      name: appManifest.name,
      version: appManifest.version,
      networkWhitelist: whitelist,
    },
    git: {
      remoteOrigin: remoteOrigin || null,
      expectedRepoUrl: EXPECTED_REPO_URL,
      expectedRemoteUrl: EXPECTED_REMOTE_URL,
      commitCount,
      releaseCandidateCommits,
      worktreeClean: !worktreeStatus,
      head: currentHead,
      dirtyContentSha256: currentDirtyContentSha256,
      ...porcelainStatusSummary(worktreeStatus),
    },
    privacyUrl: PRIVACY_URL,
    supportUrl: SUPPORT_URL,
    publicUrlsReachableAfterPush: Boolean(remoteOrigin),
    simulatorFixtures: simulatorReport ? {
      ok: simulatorReport.ok === true,
      generatedAt: simulatorReport.generatedAt || null,
      ageHours: simulatorReportAgeMs === null ? null : Math.round(simulatorReportAgeMs / 36_000) / 100,
      reportPath: SIMULATOR_FIXTURES_REPORT,
      error: simulatorFixturesErrorSummary(simulatorReport),
      fixtures: Array.isArray(simulatorReport.fixtures) ? simulatorReport.fixtures : null,
      git: simulatorReport.git ? {
        head: simulatorReport.git.head || null,
        dirtyContentSha256: simulatorReport.git.dirtyContentSha256 || null,
        simulatorSourceSha256: simulatorReport.git.simulatorSourceSha256 || null,
        worktreeClean: simulatorReport.git.worktreeClean === true,
        ...porcelainStatusSummary(simulatorReport.git.statusPorcelain || ""),
      } : null,
    } : {
      ok: false,
      generatedAt: null,
      ageHours: null,
      reportPath: SIMULATOR_FIXTURES_REPORT,
      error: null,
      fixtures: null,
      git: null,
    },
    bundleDir,
    bundle,
    blockers: publicBlockers,
    reviewRisks,
    privateRehearsalBlockers,
    warnings,
  };

  const output = process.argv.includes("--summary") ? releaseStatusSummary(status) : status;
  console.log(JSON.stringify(output, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    main();
  } catch (err) {
    console.error(errorStack(err));
    process.exit(1);
  }
}
