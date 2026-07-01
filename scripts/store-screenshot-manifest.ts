import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gitMetadata } from "./git-state.ts";
import { simulatorSourceSha256 } from "./simulator-source-fingerprint.ts";

export type StoreScreenshot = {
  file: string;
  height: number;
  sha256: string;
  sizeBytes: number;
  width: number;
};

export type StoreScreenshotSourceManifest = {
  schemaVersion: 1;
  captureSource?: string;
  editingPolicy?: string;
  generatedAt: string;
  reviewerNote?: string;
  simulatorSourceSha256: string;
  git: ReturnType<typeof gitMetadata>;
  screenshots: StoreScreenshot[];
};

export const STORE_SCREENSHOT_MANIFEST_FILE = "manifest.json";
export const STORE_SCREENSHOT_CAPTURE_SOURCE = "official-evenhub-simulator-camera";
export const STORE_SCREENSHOT_EDITING_POLICY = "none; screenshots are direct simulator captures";
export const STORE_SCREENSHOT_REVIEWER_NOTE = "Store screenshots should be captured directly from the Even Hub simulator camera button without manual editing; this manifest records file hashes to detect later changes.";

export function storeScreenshotsDir(root = process.cwd()) {
  return path.join(root, "release", "evenhub-screenshots");
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

export function pngDimensions(filePath: string): { height: number; width: number } {
  const header = fs.readFileSync(filePath).subarray(0, 24);
  const pngSignature = "89504e470d0a1a0a";
  if (header.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error(`${filePath} is not a PNG file.`);
  }
  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20),
  };
}

export function storeScreenshotFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((fileName) => fileName.toLowerCase().endsWith(".png"))
    .sort();
}

export function storeScreenshotMetadata(root = process.cwd(), dirPath = storeScreenshotsDir(root)): StoreScreenshot[] {
  return storeScreenshotFiles(dirPath).map((fileName) => {
    const filePath = path.join(dirPath, fileName);
    const { width, height } = pngDimensions(filePath);
    return {
      file: fileName,
      height,
      sha256: sha256File(filePath),
      sizeBytes: fs.statSync(filePath).size,
      width,
    };
  });
}

export function readStoreScreenshotSourceManifest(
  dirPath: string,
): StoreScreenshotSourceManifest | null {
  const manifestPath = path.join(dirPath, STORE_SCREENSHOT_MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as StoreScreenshotSourceManifest;
}

export function writeStoreScreenshotSourceManifest(root = process.cwd()): StoreScreenshotSourceManifest {
  const dirPath = storeScreenshotsDir(root);
  const screenshots = storeScreenshotMetadata(root, dirPath);
  if (!screenshots.length) {
    throw new Error(`No PNG screenshots found in ${path.relative(root, dirPath)}.`);
  }
  const manifest: StoreScreenshotSourceManifest = {
    schemaVersion: 1,
    captureSource: STORE_SCREENSHOT_CAPTURE_SOURCE,
    editingPolicy: STORE_SCREENSHOT_EDITING_POLICY,
    generatedAt: new Date().toISOString(),
    reviewerNote: STORE_SCREENSHOT_REVIEWER_NOTE,
    simulatorSourceSha256: simulatorSourceSha256(root),
    git: gitMetadata(root),
    screenshots,
  };
  fs.writeFileSync(path.join(dirPath, STORE_SCREENSHOT_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function storeScreenshotSourceManifestProblems({
  manifest,
  screenshots,
  currentSimulatorSourceSha256,
}: {
  manifest: StoreScreenshotSourceManifest | null | undefined;
  screenshots: StoreScreenshot[];
  currentSimulatorSourceSha256: string;
}) {
  if (!screenshots.length) return [];
  if (!manifest) {
    return ["Even Hub store screenshot source manifest is missing; rerun screenshot capture and `pnpm release:screenshots:mark`."];
  }
  const problems: string[] = [];
  if (manifest.schemaVersion !== 1) {
    problems.push("Even Hub store screenshot source manifest has an unsupported schemaVersion.");
  }
  if (!manifest.generatedAt || Number.isNaN(Date.parse(manifest.generatedAt))) {
    problems.push("Even Hub store screenshot source manifest has no valid generatedAt timestamp.");
  }
  if (manifest.captureSource !== STORE_SCREENSHOT_CAPTURE_SOURCE) {
    problems.push("Even Hub store screenshot source manifest does not confirm official simulator camera capture.");
  }
  if (manifest.editingPolicy !== STORE_SCREENSHOT_EDITING_POLICY) {
    problems.push("Even Hub store screenshot source manifest does not confirm the no-editing screenshot policy.");
  }
  if (!manifest.git?.head) {
    problems.push("Even Hub store screenshot source manifest has no git HEAD metadata.");
  }
  if (manifest.git?.worktreeClean !== true || manifest.git?.statusPorcelain) {
    problems.push("Even Hub store screenshot source manifest was generated with uncommitted changes; rerun `pnpm release:screenshots:mark` on a clean worktree.");
  }
  if (manifest.simulatorSourceSha256 !== currentSimulatorSourceSha256) {
    problems.push("Even Hub store screenshots were captured from older simulator/UI source; rerun screenshot capture and `pnpm release:screenshots:mark`.");
  }
  const manifestScreenshots = new Map((manifest.screenshots || []).map((screenshot) => [screenshot.file, screenshot]));
  for (const screenshot of screenshots) {
    const manifestScreenshot = manifestScreenshots.get(path.basename(screenshot.file));
    if (!manifestScreenshot) {
      problems.push(`${screenshot.file} is missing from the store screenshot source manifest.`);
      continue;
    }
    if (manifestScreenshot.sha256 !== screenshot.sha256) {
      problems.push(`${screenshot.file} differs from the store screenshot source manifest.`);
    }
    if (
      manifestScreenshot.width !== screenshot.width
      || manifestScreenshot.height !== screenshot.height
      || manifestScreenshot.sizeBytes !== screenshot.sizeBytes
    ) {
      problems.push(`${screenshot.file} metadata differs from the store screenshot source manifest.`);
    }
  }
  return problems;
}
