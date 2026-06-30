import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SIMULATOR_SOURCE_INPUTS = [
  "app.json",
  "docs/testing.md",
  "docs/user-stories.md",
  "index.html",
  "pnpm-lock.yaml",
  "src",
  "scripts/evenhub-simulator-e2e.ts",
  "scripts/evenhub-simulator-fixtures.ts",
  "scripts/run-evenhub-simulator.ts",
  "scripts/sim-static-server.ts",
  "scripts/simulator-utils.ts",
  "tsconfig.json",
  "vite.config.ts",
];

const SIMULATOR_SOURCE_EXCLUDES = [
  /\.test\.[cm]?[tj]sx?$/i,
  /\.spec\.[cm]?[tj]sx?$/i,
];

function posixPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function isExcludedSimulatorSourcePath(relativePath: string) {
  return SIMULATOR_SOURCE_EXCLUDES.some((pattern) => pattern.test(relativePath));
}

function walkFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

export function isSimulatorSourcePath(relativePath: string) {
  const normalized = relativePath.replace(/^\.?\//, "");
  if (isExcludedSimulatorSourcePath(normalized)) return false;
  return SIMULATOR_SOURCE_INPUTS.some((input) => normalized === input || normalized.startsWith(`${input}/`));
}

export function simulatorSourceSha256(cwd = process.cwd()) {
  const hash = crypto.createHash("sha256");
  const files = SIMULATOR_SOURCE_INPUTS.flatMap((input) => {
    const inputPath = path.join(cwd, input);
    if (!fs.existsSync(inputPath)) return [inputPath];
    if (fs.statSync(inputPath).isDirectory()) return walkFiles(inputPath)
      .filter((filePath) => isSimulatorSourcePath(posixPath(path.relative(cwd, filePath))));
    return [inputPath];
  }).sort();

  for (const filePath of files) {
    const relativePath = posixPath(path.relative(cwd, filePath));
    hash.update(relativePath);
    hash.update("\0");
    if (!fs.existsSync(filePath)) {
      hash.update("<missing>");
    } else {
      hash.update(fs.readFileSync(filePath));
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}
