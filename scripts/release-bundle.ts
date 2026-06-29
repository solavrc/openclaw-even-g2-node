import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appManifestNetworkWhitelist } from "./app-manifest.ts";
import { gitMetadata } from "./git-state.ts";
import { networkReviewMetadata } from "./network-origins.ts";
import { errorStack } from "./strict-helpers.ts";
import {
  readStoreScreenshotSourceManifest,
  STORE_SCREENSHOT_MANIFEST_FILE,
  type StoreScreenshotSourceManifest,
} from "./store-screenshot-manifest.ts";

type AppManifest = {
  package_id: string;
  name: string;
  version: string;
  permissions?: unknown;
};

type PackageManifest = {
  name: string;
  version: string;
};

type StoreScreenshot = {
  file: string;
  height: number;
  sha256: string;
  sizeBytes: number;
  width: number;
};

type ReleaseBundleManifest = {
  packageName: string;
  appName: string;
  packageId: string;
  version: string;
  ehpk: {
    file: string;
    sizeBytes: number;
    sha256: string;
  };
  evenHubIcon: {
    file: string;
    sha256: string;
  };
  storeScreenshots: StoreScreenshot[];
  storeScreenshotsSource: StoreScreenshotSourceManifest | null;
  generatedAt: string;
  network: ReturnType<typeof networkReviewMetadata>;
  git: ReturnType<typeof gitMetadata>;
  publicReleaseBlockedByNetworkReview: boolean;
};

export type ReleaseBundleResult = {
  ok: true;
  releaseDir: string;
} & ReleaseBundleManifest;

export type ReleaseBundleSummary = {
  ok: true;
  releaseDir: string;
  packageId: string;
  version: string;
  ehpk: {
    file: string;
    sizeBytes: number;
    sha256: string;
  };
  storeScreenshotCount: number;
  storeScreenshotsSource: {
    generatedAt?: string;
    head?: string | null;
    worktreeClean?: boolean;
  } | null;
  network: {
    reviewRequired: boolean;
    publicReleaseBlockedByNetworkReview: boolean;
  };
  git: {
    head?: string | null;
    worktreeClean?: boolean;
  };
};

const ROOT = process.cwd();
const APP_EHPK = path.join(ROOT, "openclaw-even-g2-node.ehpk");
const APP_JSON = path.join(ROOT, "app.json");
const MAINTAINER_RELEASE = path.join(ROOT, "docs", "maintainers", "release.md");
const PRIVACY_POLICY = path.join(ROOT, "PRIVACY.md");
const EVEN_HUB_ICON = path.join(ROOT, "openclaw-node-evenhub-icon-24.png");
const STORE_SCREENSHOTS_DIR = path.join(ROOT, "release", "evenhub-screenshots");

function run(command: string, args: string[], options: SpawnOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "inherit", "inherit"],
      ...options,
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${code}${signal ? ` (${signal})` : ""}`));
    });
  });
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function copyFile(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function pngDimensions(filePath: string): { height: number; width: number } {
  const header = fs.readFileSync(filePath).subarray(0, 24);
  const pngSignature = "89504e470d0a1a0a";
  if (header.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error(`${path.relative(ROOT, filePath)} is not a PNG file.`);
  }
  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20),
  };
}

function copyStoreScreenshots(releaseDir: string): StoreScreenshot[] {
  if (!fs.existsSync(STORE_SCREENSHOTS_DIR)) return [];
  const screenshotDir = path.join(releaseDir, "evenhub-screenshots");
  fs.mkdirSync(screenshotDir, { recursive: true });
  const screenshots = fs.readdirSync(STORE_SCREENSHOTS_DIR)
    .filter((fileName) => fileName.toLowerCase().endsWith(".png"))
    .sort()
    .map((fileName) => {
      const src = path.join(STORE_SCREENSHOTS_DIR, fileName);
      const dest = path.join(screenshotDir, fileName);
      copyFile(src, dest);
      const { width, height } = pngDimensions(dest);
      return {
        file: path.join("evenhub-screenshots", fileName),
        height,
        sha256: sha256File(dest),
        sizeBytes: fs.statSync(dest).size,
        width,
      };
    });
  const readme = path.join(STORE_SCREENSHOTS_DIR, "README.txt");
  if (fs.existsSync(readme)) copyFile(readme, path.join(screenshotDir, "README.txt"));
  const manifest = path.join(STORE_SCREENSHOTS_DIR, STORE_SCREENSHOT_MANIFEST_FILE);
  if (fs.existsSync(manifest)) copyFile(manifest, path.join(screenshotDir, STORE_SCREENSHOT_MANIFEST_FILE));
  return screenshots;
}

function extractSection(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) return "";
  const after = markdown.slice(start);
  const next = after.slice(heading.length).search(/\n## /);
  return (next >= 0 ? after.slice(0, heading.length + next) : after).trim();
}

export function releaseBundleSummary(bundle: ReleaseBundleResult): ReleaseBundleSummary {
  return {
    ok: true,
    releaseDir: bundle.releaseDir,
    packageId: bundle.packageId,
    version: bundle.version,
    ehpk: bundle.ehpk,
    storeScreenshotCount: bundle.storeScreenshots.length,
    storeScreenshotsSource: bundle.storeScreenshotsSource ? {
      generatedAt: bundle.storeScreenshotsSource.generatedAt,
      head: bundle.storeScreenshotsSource.git?.head,
      worktreeClean: bundle.storeScreenshotsSource.git?.worktreeClean,
    } : null,
    network: {
      reviewRequired: bundle.network.reviewRequired,
      publicReleaseBlockedByNetworkReview: bundle.publicReleaseBlockedByNetworkReview,
    },
    git: {
      head: bundle.git.head,
      worktreeClean: bundle.git.worktreeClean,
    },
  };
}

export async function buildReleaseBundle(): Promise<ReleaseBundleResult> {
  const rootPackage = readJson<PackageManifest>(path.join(ROOT, "package.json"));
  const appManifest = readJson<AppManifest>(APP_JSON);
  if (rootPackage.version !== appManifest.version) {
    throw new Error(`version mismatch: package.json=${rootPackage.version}, app.json=${appManifest.version}`);
  }

  await run("pnpm", ["run", "pack"]);

  const stat = fs.statSync(APP_EHPK);
  if (!stat.isFile()) throw new Error("pack did not create an .ehpk file");
  if (stat.size < 10_000) throw new Error(`packed .ehpk is unexpectedly small: ${stat.size} bytes`);

  const releaseDir = path.join(ROOT, "release", `${appManifest.package_id}-${appManifest.version}`);
  fs.rmSync(releaseDir, { recursive: true, force: true });
  fs.mkdirSync(releaseDir, { recursive: true });

  const ehpkFileName = `openclaw-even-g2-node-${appManifest.version}.ehpk`;
  const bundleEhpk = path.join(releaseDir, ehpkFileName);
  copyFile(APP_EHPK, bundleEhpk);
  copyFile(APP_JSON, path.join(releaseDir, "app.json"));
  copyFile(PRIVACY_POLICY, path.join(releaseDir, "PRIVACY.md"));
  copyFile(EVEN_HUB_ICON, path.join(releaseDir, "openclaw-node-evenhub-icon-24.png"));
  const storeScreenshots = copyStoreScreenshots(releaseDir);
  const storeScreenshotsSource: StoreScreenshotSourceManifest | null = readStoreScreenshotSourceManifest(STORE_SCREENSHOTS_DIR);

  const releaseNotes = fs.readFileSync(MAINTAINER_RELEASE, "utf8");
  const submissionCopy = [
    "# Even Hub Submission Copy",
    "",
    extractSection(releaseNotes, "## Store Listing"),
    "",
    extractSection(releaseNotes, "## Permission Copy"),
    "",
    extractSection(releaseNotes, "## Privacy Policy Draft"),
    "",
    extractSection(releaseNotes, "## Release Notes"),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(releaseDir, "submission-copy.md"), submissionCopy);

  const reviewInquiry = [
    "# Even Hub Review Inquiry",
    "",
    extractSection(releaseNotes, "## Current Public Review Risk") || extractSection(releaseNotes, "## Current Public Release Blocker"),
    "",
    extractSection(releaseNotes, "## Review Inquiry Draft"),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(releaseDir, "review-inquiry.md"), reviewInquiry);

  const networkWhitelist = appManifestNetworkWhitelist(appManifest);
  const network = networkReviewMetadata(networkWhitelist);
  const manifest: ReleaseBundleManifest = {
    packageName: rootPackage.name,
    appName: appManifest.name,
    packageId: appManifest.package_id,
    version: appManifest.version,
    ehpk: {
      file: ehpkFileName,
      sizeBytes: stat.size,
      sha256: sha256File(bundleEhpk),
    },
    evenHubIcon: {
      file: "openclaw-node-evenhub-icon-24.png",
      sha256: sha256File(EVEN_HUB_ICON),
    },
    storeScreenshots,
    storeScreenshotsSource,
    generatedAt: new Date().toISOString(),
    network: {
      whitelist: network.whitelist,
      developmentOrigins: network.developmentOrigins,
      reviewRequired: network.reviewRequired,
      reviewRisk: network.reviewRisk,
      publicReleaseBlockedByNetworkReview: network.publicReleaseBlockedByNetworkReview,
    },
    git: gitMetadata(ROOT),
    publicReleaseBlockedByNetworkReview: network.publicReleaseBlockedByNetworkReview,
  };
  fs.writeFileSync(path.join(releaseDir, "bundle-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  return { ok: true, releaseDir, ...manifest };
}

export async function main(): Promise<void> {
  const bundle = await buildReleaseBundle();
  const output = process.argv.includes("--summary") ? releaseBundleSummary(bundle) : bundle;
  console.log(JSON.stringify(output));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((err) => {
    console.error(errorStack(err));
    process.exit(1);
  });
}
