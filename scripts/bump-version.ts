import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type PackageJson = {
  version?: string;
};

type AppJson = {
  version?: string;
};

type ReleasePleaseManifest = {
  "."?: string;
};

type BumpKind = "patch" | "minor" | "major";

const SEMVER_PATTERN = /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)$/;

function readJson<T>(root: string, relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8")) as T;
}

function writeJson(root: string, relativePath: string, value: unknown): void {
  fs.writeFileSync(path.join(root, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

export function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const match = SEMVER_PATTERN.exec(version);
  if (!match?.groups) {
    throw new Error(`Expected a three-part semver version, got "${version}".`);
  }
  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
  };
}

export function bumpVersion(current: string, kind: BumpKind): string {
  const version = parseVersion(current);
  if (kind === "major") {
    return `${version.major + 1}.0.0`;
  }
  if (kind === "minor") {
    return `${version.major}.${version.minor + 1}.0`;
  }
  return `${version.major}.${version.minor}.${version.patch + 1}`;
}

export function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  for (const field of ["major", "minor", "patch"] as const) {
    const difference = leftVersion[field] - rightVersion[field];
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function nextVersion(current: string, requested: string | undefined): string {
  if (!requested) {
    throw new Error("Usage: pnpm version:bump -- <patch|minor|major|x.y.z>");
  }
  if (requested === "patch" || requested === "minor" || requested === "major") {
    return bumpVersion(current, requested);
  }
  parseVersion(requested);
  if (compareVersions(requested, current) <= 0) {
    throw new Error(`Target version ${requested} must be greater than current version ${current}.`);
  }
  return requested;
}

export function bumpProjectVersion(root = process.cwd(), requested = process.argv[2]): { currentVersion: string; targetVersion: string } {
  const rootPackage = readJson<PackageJson>(root, "package.json");
  const appManifest = readJson<AppJson>(root, "app.json");
  const releasePleaseManifest = readJson<ReleasePleaseManifest>(root, ".release-please-manifest.json");
  const maintainerReleasePath = path.join(root, "docs", "maintainers", "release.md");

  const currentVersions = new Set([
    rootPackage.version,
    appManifest.version,
    releasePleaseManifest["."],
  ]);

  if (currentVersions.size !== 1 || currentVersions.has(undefined)) {
    throw new Error(
      `Refusing to bump mismatched versions: ${JSON.stringify([...currentVersions])}. Run pnpm release:check first.`,
    );
  }

  const currentVersion = rootPackage.version;
  if (!currentVersion) {
    throw new Error("package.json version is missing.");
  }

  const targetVersion = nextVersion(currentVersion, requested);
  if (targetVersion === currentVersion) {
    throw new Error(`Target version is already ${targetVersion}.`);
  }

  rootPackage.version = targetVersion;
  appManifest.version = targetVersion;
  releasePleaseManifest["."] = targetVersion;

  writeJson(root, "package.json", rootPackage);
  writeJson(root, "app.json", appManifest);
  writeJson(root, ".release-please-manifest.json", releasePleaseManifest);

  if (fs.existsSync(maintainerReleasePath)) {
    const currentReleaseNotes = fs.readFileSync(maintainerReleasePath, "utf8");
    const updatedReleaseNotes = currentReleaseNotes.replace(
      /^Version `\d+\.\d+\.\d+`:(.*)$/m,
      `Version \`${targetVersion}\`:$1`,
    );
    if (updatedReleaseNotes === currentReleaseNotes) {
      throw new Error("Could not find maintainer release notes version line to update.");
    }
    fs.writeFileSync(maintainerReleasePath, updatedReleaseNotes);
  }

  return { currentVersion, targetVersion };
}

export function main(root = process.cwd(), requested = process.argv[2]): void {
  const { currentVersion, targetVersion } = bumpProjectVersion(root, requested);
  console.log(`Updated OpenClaw Node version: ${currentVersion} -> ${targetVersion}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) main();
