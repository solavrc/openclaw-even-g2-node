import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appManifestNetworkWhitelist } from "./app-manifest.ts";
import { isDevelopmentNetworkOrigin } from "./network-origins.ts";
import { errorStack } from "./strict-helpers.ts";

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type RunOptions = SpawnOptions & {
  echoOutput?: boolean;
};

class CommandExitError extends Error {
  constructor(
    message: string,
    readonly result: CommandResult,
  ) {
    super(message);
    this.name = "CommandExitError";
  }
}

const EVENHUB_FAILURE_PATTERNS = [
  /Refresh token expired/i,
  /Please log in again/i,
  /Failed to check package ID availability/i,
  /not logged in/i,
];

const EXPECTED_EVEN_HUB_LISTING_NAME = "OpenClaw Node";
const EXPECTED_EVEN_HUB_PACKAGE_ID = "com.solavrc.openclaweveng2node";
const EXPECTED_EVEN_HUB_EDITION = "202601";
const EXPECTED_PACKAGE_NAME = "@solavrc/openclaw-even-g2-node";
const EXPECTED_REPO_URL = "https://github.com/solavrc/openclaw-even-g2-node";
const EXPECTED_ISSUES_URL = `${EXPECTED_REPO_URL}/issues`;
const EXPECTED_PRIVACY_URL = `${EXPECTED_REPO_URL}/blob/main/PRIVACY.md`;
const ALLOWED_EVEN_HUB_PERMISSIONS = new Set(["network", "location", "g2-microphone", "phone-microphone", "album", "camera"]);
const ALLOWED_EVEN_HUB_LANGUAGES = new Set(["en", "de", "fr", "es", "it", "zh", "ja", "ko"]);
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const APP_EHPK_PATH = path.join(process.cwd(), "openclaw-even-g2-node.ehpk");
const REQUIRE_EVENHUB_LOGIN = process.env.EVENG2_REQUIRE_EVENHUB_LOGIN === "1";

function run(command: string, args: string[], options: RunOptions = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const { echoOutput = true, ...spawnOptions } = options;
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      ...spawnOptions,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (echoOutput) process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (echoOutput) process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const exitCode = code ?? 1;
      if (code === 0) {
        resolve({ stdout, stderr, exitCode: 0 });
        return;
      }
      reject(new CommandExitError(
        `${command} ${args.join(" ")} exited ${code}${signal ? ` (${signal})` : ""}`,
        { stdout, stderr, exitCode },
      ));
    });
  });
}

async function runWithCapturedFailure(command: string, args: string[], options: RunOptions = {}): Promise<CommandResult> {
  try {
    return await run(command, args, options);
  } catch (error) {
    if (error instanceof CommandExitError) return error.result;
    throw error;
  }
}

export function commandOutput(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

export function evenHubPackageAvailabilityProbeSummary(result: CommandResult) {
  const output = commandOutput(result);
  if (/Package ID is already taken/i.test(output)) return "package-id-already-owned";
  if (/Successfully packed/i.test(output)) return "package-packable";
  return result.exitCode === 0 ? "package-probe-passed" : "package-probe-failed";
}

type EvenHubAppManifest = {
  package_id?: string;
  edition?: string;
  name?: string;
  version?: string;
  min_app_version?: string;
  min_sdk_version?: string;
  entrypoint?: string;
  permissions?: Array<{ name?: string; desc?: string; whitelist?: unknown }>;
  supported_languages?: unknown;
};

type ReleasePleaseConfig = {
  packages?: Record<string, {
    "bump-minor-pre-major"?: boolean;
    "bump-patch-for-minor-pre-major"?: boolean;
    "changelog-path"?: string;
    "extra-files"?: Array<{
      jsonpath?: string;
      path?: string;
      type?: string;
    }>;
    "package-name"?: string;
    "release-type"?: string;
  }>;
};

type ReleasePleaseManifest = Record<string, string | undefined>;

function appManifest(): EvenHubAppManifest {
  return JSON.parse(fs.readFileSync("app.json", "utf8")) as {
    package_id?: string;
    edition?: string;
    name?: string;
    version?: string;
    min_app_version?: string;
    min_sdk_version?: string;
    entrypoint?: string;
    permissions?: Array<{ name?: string; desc?: string; whitelist?: unknown }>;
    supported_languages?: unknown;
  };
}

function appManifestNetworkWhitelistFromFile(): string[] {
  return appManifestNetworkWhitelist(JSON.parse(fs.readFileSync("app.json", "utf8")));
}

function npmPackageManifest(filePath: string): {
  bugs?: { url?: string };
  engines?: { node?: string };
  homepage?: string;
  license?: string;
  name?: string;
  private?: boolean;
  repository?: { type?: string; url?: string } | string;
  version?: string;
} {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    bugs?: { url?: string };
    engines?: { node?: string };
    homepage?: string;
    license?: string;
    name?: string;
    private?: boolean;
    repository?: { type?: string; url?: string } | string;
    version?: string;
  };
}

function invalidWhitelistOriginReason(origin: string): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return "not a valid URL origin";
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    return `unsupported protocol ${url.protocol}`;
  }
  if (url.origin !== origin || url.pathname !== "/" || url.search || url.hash) {
    return "must be a bare origin without path, query, hash, username, or password";
  }
  return null;
}

function validEvenHubPackageId(value: string | undefined): boolean {
  if (!value) return false;
  const segments = value.split(".");
  return segments.length >= 2 && segments.every((segment) => /^[a-z][a-z0-9]*$/.test(segment));
}

function auditEvenHubManifestSchema(): string[] {
  const manifest = appManifest();
  const blockers: string[] = [];
  if (!validEvenHubPackageId(manifest.package_id)) {
    blockers.push(`package_id "${manifest.package_id || "<missing>"}" must be lowercase reverse-domain segments without hyphens or underscores.`);
  }
  if (manifest.edition !== EXPECTED_EVEN_HUB_EDITION) {
    blockers.push(`edition "${manifest.edition || "<missing>"}" must be "${EXPECTED_EVEN_HUB_EDITION}".`);
  }
  if (!manifest.name || manifest.name.length > 20) {
    blockers.push(`name "${manifest.name || "<missing>"}" must be 20 characters or fewer.`);
  }
  if (!SEMVER_PATTERN.test(manifest.version || "")) {
    blockers.push(`version "${manifest.version || "<missing>"}" must be three-part semver.`);
  }
  for (const field of ["min_app_version", "min_sdk_version"] as const) {
    if (!SEMVER_PATTERN.test(manifest[field] || "")) {
      blockers.push(`${field} "${manifest[field] || "<missing>"}" must be three-part semver.`);
    }
  }
  const entrypoint = manifest.entrypoint || "";
  const entrypointPath = path.normalize(path.join("dist", entrypoint));
  if (!entrypoint || entrypoint.startsWith("/") || entrypointPath.startsWith("..") || !entrypointPath.startsWith(path.normalize("dist/")) || !fs.existsSync(entrypointPath)) {
    blockers.push(`entrypoint "${entrypoint || "<missing>"}" must exist inside dist.`);
  }
  if (!Array.isArray(manifest.permissions)) {
    blockers.push("permissions must be an array.");
  } else {
    const permissionNames = new Set<string>();
    for (const [index, permission] of manifest.permissions.entries()) {
      const label = `permissions[${index}]`;
      if (!permission || typeof permission !== "object" || Array.isArray(permission)) {
        blockers.push(`${label} must be an object.`);
        continue;
      }
      if (!permission.name || !ALLOWED_EVEN_HUB_PERMISSIONS.has(permission.name)) {
        blockers.push(`${label}.name "${permission.name || "<missing>"}" is not a supported Even Hub permission.`);
      } else if (permissionNames.has(permission.name)) {
        blockers.push(`${label}.name "${permission.name}" is duplicated; each permission should be declared once.`);
      } else {
        permissionNames.add(permission.name);
      }
      if (!permission.desc || permission.desc.length > 300) {
        blockers.push(`${label}.desc must be 1-300 characters.`);
      }
      if (permission.name === "network" && !Array.isArray(permission.whitelist)) {
        blockers.push(`${label}.whitelist must be an array for network permission.`);
      }
      if (permission.name !== "network" && Object.prototype.hasOwnProperty.call(permission, "whitelist")) {
        blockers.push(`${label}.whitelist is only valid on network permission.`);
      }
    }
  }
  if (!Array.isArray(manifest.supported_languages) || !manifest.supported_languages.length) {
    blockers.push("supported_languages must be a non-empty array.");
  } else {
    const invalid = manifest.supported_languages.filter((language) => typeof language !== "string" || !ALLOWED_EVEN_HUB_LANGUAGES.has(language));
    if (invalid.length) blockers.push(`supported_languages contains invalid values: ${invalid.map(String).join(", ")}.`);
  }
  return blockers.length ? ["Even Hub app manifest does not match the published schema:", ...blockers.map((item) => `- ${item}`)] : [];
}

function auditReleaseManifest(): string[] {
  const whitelist = appManifestNetworkWhitelistFromFile();
  const invalidOrigins = whitelist.flatMap((origin) => {
    const reason = invalidWhitelistOriginReason(origin);
    return reason ? [`- ${origin}: ${reason}`] : [];
  });
  const devOrigins = whitelist.filter(isDevelopmentNetworkOrigin);
  const findings: string[] = [];
  if (invalidOrigins.length) {
    findings.push(
      "Release manifest network whitelist entries must be full origins:",
      ...invalidOrigins,
      "Use entries such as https://gateway.example.com or wss://gateway.example.com, not bare domains or URLs with paths.",
    );
  }
  if (!devOrigins.length) return findings;
  findings.push(
    "Release manifest still contains development/private network whitelist origins:",
    ...devOrigins.map((origin) => `- ${origin}`),
    "Resolve Even Hub review guidance before public submission for user-owned Gateway WebSocket access.",
    "Set EVENG2_ALLOW_DEV_NETWORK_WHITELIST=1 only for private/internal release-check rehearsal.",
  );
  return findings;
}

function auditPrivateManifestSyntax(): string[] {
  const invalidOrigins = appManifestNetworkWhitelistFromFile().flatMap((origin) => {
    const reason = invalidWhitelistOriginReason(origin);
    return reason ? [`- ${origin}: ${reason}`] : [];
  });
  if (!invalidOrigins.length) return [];
  return [
    "Network whitelist entries are malformed:",
    ...invalidOrigins,
  ];
}

function fencedTextAfterHeading(markdown: string, heading: string): string {
  const headingIndex = markdown.indexOf(heading);
  if (headingIndex < 0) return "";
  const afterHeading = markdown.slice(headingIndex + heading.length);
  const match = /```text\s*\n([\s\S]*?)\n```/.exec(afterHeading);
  return match?.[1]?.trim() || "";
}

function releaseNotesVersion(markdown: string): string {
  return /Version `([^`]+)`/.exec(markdown)?.[1]?.trim() || "";
}

function normalizedIncludes(haystack: string, needle: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  return normalize(haystack).includes(normalize(needle));
}

function auditMaintainerReleaseAssets(): string[] {
  const blockers: string[] = [];
  const manifest = appManifest();
  const rootPackage = npmPackageManifest("package.json");
  const assetsPath = "docs/maintainers/release.md";
  const markdown = fs.readFileSync(assetsPath, "utf8");
  const title = fencedTextAfterHeading(markdown, "Title:");
  const notesVersion = releaseNotesVersion(markdown);
  const networkDesc = manifest.permissions?.find((permission) => permission.name === "network")?.desc || "";
  const microphoneDesc = manifest.permissions?.find((permission) => permission.name === "g2-microphone")?.desc || "";

  if (manifest.package_id !== EXPECTED_EVEN_HUB_PACKAGE_ID) {
    blockers.push(`App manifest package_id "${manifest.package_id || "<missing>"}" must remain "${EXPECTED_EVEN_HUB_PACKAGE_ID}".`);
  }
  const versionSources = [
    ["package", rootPackage.version],
    ["app manifest", manifest.version],
    ["submission release notes", notesVersion],
  ];
  const versions = new Set(versionSources.map(([, version]) => version || ""));
  if (versions.size !== 1 || versions.has("")) {
    blockers.push(`Version mismatch: ${versionSources.map(([label, version]) => `${label}=${version || "<missing>"}`).join(", ")}.`);
  }
  if (manifest.name !== EXPECTED_EVEN_HUB_LISTING_NAME) {
    blockers.push(`App manifest name "${manifest.name || "<missing>"}" must remain "${EXPECTED_EVEN_HUB_LISTING_NAME}" for Even Hub listing review.`);
  }
  if (rootPackage.name !== EXPECTED_PACKAGE_NAME) {
    blockers.push(`package.json name "${rootPackage.name || "<missing>"}" must remain "${EXPECTED_PACKAGE_NAME}".`);
  }
  if (rootPackage.private !== true) {
    blockers.push("package.json private must remain true; this repo is distributed as an Even Hub/OpenClaw extension artifact, not an npm package.");
  }
  if (rootPackage.license !== "MIT") {
    blockers.push(`package.json license "${rootPackage.license || "<missing>"}" must remain "MIT".`);
  }
  const repositoryUrl = typeof rootPackage.repository === "string"
    ? rootPackage.repository
    : rootPackage.repository?.url || "";
  if (repositoryUrl !== `git+${EXPECTED_REPO_URL}.git`) {
    blockers.push(`package.json repository URL "${repositoryUrl || "<missing>"}" must remain "git+${EXPECTED_REPO_URL}.git".`);
  }
  if (rootPackage.bugs?.url !== EXPECTED_ISSUES_URL) {
    blockers.push(`package.json bugs URL "${rootPackage.bugs?.url || "<missing>"}" must remain "${EXPECTED_ISSUES_URL}".`);
  }
  if (rootPackage.homepage !== `${EXPECTED_REPO_URL}#readme`) {
    blockers.push(`package.json homepage "${rootPackage.homepage || "<missing>"}" must remain "${EXPECTED_REPO_URL}#readme".`);
  }
  if (rootPackage.engines?.node !== ">=22.19.0") {
    blockers.push(`package.json engines.node "${rootPackage.engines?.node || "<missing>"}" must remain ">=22.19.0" to match OpenClaw and CI.`);
  }
  if (title !== manifest.name) {
    blockers.push(`Maintainer release title "${title || "<missing>"}" does not match app manifest name "${manifest.name || "<missing>"}".`);
  }
  if (/\bEven\b|\bG2\b/i.test(title) || /\bEven\b|\bG2\b/i.test(manifest.name || "")) {
    blockers.push("Even Hub listing title must not include Even or G2; those names are reserved for device/node context.");
  }
  if (networkDesc && !markdown.includes(networkDesc)) {
    blockers.push("Maintainer release network permission copy does not match app manifest.");
  }
  if (microphoneDesc && !markdown.includes(microphoneDesc)) {
    blockers.push("Maintainer release microphone permission copy does not match app manifest.");
  }
  if (/Replace this paragraph with the maintainer contact URL or email/i.test(markdown)) {
    blockers.push("Maintainer release privacy policy still contains the maintainer contact placeholder.");
  }
  if (!fs.existsSync("PRIVACY.md")) {
    blockers.push("Top-level PRIVACY.md is missing.");
  } else {
    const privacy = fs.readFileSync("PRIVACY.md", "utf8");
    const requiredPrivacyText = [
      "OpenClaw Node is a companion node for a user-controlled OpenClaw Gateway.",
      "The Even Hub app sends data only to the configured OpenClaw Gateway endpoint.",
      "Camera frames are used locally to extract an OpenClaw setup code from a QR code.",
      "Speech provider selection, transcription model, and provider API keys are controlled by OpenClaw",
      EXPECTED_ISSUES_URL,
    ];
    for (const text of requiredPrivacyText) {
      if (!normalizedIncludes(privacy, text)) blockers.push(`PRIVACY.md is missing required text: ${text}`);
    }
    if (!markdown.includes(EXPECTED_PRIVACY_URL)) {
      blockers.push("Maintainer release assets do not include the public privacy policy URL.");
    }
  }
  return blockers.length ? ["Maintainer release assets are not ready for public upload:", ...blockers.map((item) => `- ${item}`)] : [];
}

function auditReleasePleaseConfig(): string[] {
  const blockers: string[] = [];
  if (!fs.existsSync("release-please-config.json")) {
    blockers.push("release-please-config.json is missing.");
  }
  if (!fs.existsSync(".release-please-manifest.json")) {
    blockers.push(".release-please-manifest.json is missing.");
  }
  if (!fs.existsSync(".github/workflows/release-please.yml")) {
    blockers.push(".github/workflows/release-please.yml is missing.");
  }
  if (blockers.length) return ["Release Please configuration is incomplete:", ...blockers.map((item) => `- ${item}`)];

  const config = JSON.parse(fs.readFileSync("release-please-config.json", "utf8")) as ReleasePleaseConfig;
  const releaseManifest = JSON.parse(fs.readFileSync(".release-please-manifest.json", "utf8")) as ReleasePleaseManifest;
  const rootPackage = npmPackageManifest("package.json");
  const manifest = appManifest();
  const rootConfig = config.packages?.["."];
  if (!rootConfig) {
    blockers.push('release-please-config.json must define packages["."].');
  } else {
    if (rootConfig["release-type"] !== "node") {
      blockers.push(`Release Please release-type "${rootConfig["release-type"] || "<missing>"}" must be "node".`);
    }
    if (rootConfig["package-name"] !== EXPECTED_PACKAGE_NAME) {
      blockers.push(`Release Please package-name "${rootConfig["package-name"] || "<missing>"}" must be "${EXPECTED_PACKAGE_NAME}".`);
    }
    if (rootConfig["changelog-path"] !== "CHANGELOG.md") {
      blockers.push(`Release Please changelog-path "${rootConfig["changelog-path"] || "<missing>"}" must be "CHANGELOG.md".`);
    }
    if (rootConfig["bump-minor-pre-major"] !== true) {
      blockers.push("Release Please must set bump-minor-pre-major true while this app is pre-1.0.");
    }
    if (rootConfig["bump-patch-for-minor-pre-major"] !== true) {
      blockers.push("Release Please must set bump-patch-for-minor-pre-major true while this app is pre-1.0.");
    }
    const appJsonVersionFile = rootConfig["extra-files"]?.find((file) => (
      file.type === "json"
      && file.path === "app.json"
      && file.jsonpath === "$.version"
    ));
    if (!appJsonVersionFile) {
      blockers.push('Release Please extra-files must update app.json jsonpath "$.version".');
    }
    const releaseNotesVersionFile = rootConfig["extra-files"]?.find((file) => (
      file.type === "generic"
      && file.path === "docs/maintainers/release.md"
    ));
    if (!releaseNotesVersionFile) {
      blockers.push("Release Please extra-files must update docs/maintainers/release.md with the generic updater.");
    }
  }
  if (releaseManifest["."] !== rootPackage.version) {
    blockers.push(`Release Please manifest version "${releaseManifest["."] || "<missing>"}" must match package.json version "${rootPackage.version || "<missing>"}".`);
  }
  if (manifest.version !== rootPackage.version) {
    blockers.push(`app.json version "${manifest.version || "<missing>"}" must match package.json version "${rootPackage.version || "<missing>"}".`);
  }
  const maintainerRelease = fs.existsSync("docs/maintainers/release.md")
    ? fs.readFileSync("docs/maintainers/release.md", "utf8")
    : "";
  if (!/Version `\d+\.\d+\.\d+`:.*x-release-please-version/.test(maintainerRelease)) {
    blockers.push("docs/maintainers/release.md release-notes version line must include x-release-please-version for Release Please.");
  }
  const releasePleaseWorkflow = fs.readFileSync(".github/workflows/release-please.yml", "utf8");
  const workflowRequirements = [
    ["release-created gate", "steps.release.outputs.release_created == 'true'"],
    ["release commit checkout", "ref: ${{ steps.release.outputs.sha }}"],
    ["Even Hub package build", "corepack pnpm run pack"],
    ["versioned .ehpk asset", "openclaw-even-g2-node-${{ steps.release.outputs.version }}.ehpk"],
    ["GitHub Release upload", "gh release upload"],
    ["Release Please tag upload target", "steps.release.outputs.tag_name"],
  ] as const;
  for (const [label, requiredText] of workflowRequirements) {
    if (!releasePleaseWorkflow.includes(requiredText)) {
      blockers.push(`Release Please workflow must include ${label}.`);
    }
  }
  return blockers.length ? ["Release Please configuration is not ready:", ...blockers.map((item) => `- ${item}`)] : [];
}

async function smokeAppPack(): Promise<void> {
  await run("pnpm", ["run", "pack"]);
  const stat = fs.statSync(APP_EHPK_PATH);
  if (!stat.isFile()) throw new Error("packed .ehpk was not created");
  if (stat.size < 10_000) throw new Error(`packed .ehpk is unexpectedly small: ${stat.size} bytes`);
  console.log(JSON.stringify({ ok: true, ehpk: APP_EHPK_PATH, sizeBytes: stat.size }));
}

async function main(): Promise<void> {
  await run("pnpm", ["check"]);
  await run("pnpm", ["audit"]);
  await smokeAppPack();
  await run("tsx", ["scripts/release-artifact-audit.ts"]);
  await run("tsx", ["scripts/visual-assets-audit.ts"]);

  const releaseBlockers: string[] = [];
  if (process.env.EVENG2_ALLOW_DEV_NETWORK_WHITELIST !== "1") {
    releaseBlockers.push(...auditReleaseManifest());
  } else {
    releaseBlockers.push(...auditPrivateManifestSyntax());
  }
  releaseBlockers.push(...auditEvenHubManifestSchema());
  releaseBlockers.push(...auditMaintainerReleaseAssets());
  releaseBlockers.push(...auditReleasePleaseConfig());

  const availability = await runWithCapturedFailure(
    "pnpm",
    ["exec", "evenhub", "pack", "-c", "app.json", "dist", "-o", "/tmp/openclaw-node-check.ehpk"],
    { echoOutput: false },
  );
  const combinedOutput = commandOutput(availability);
  const matchedFailure = EVENHUB_FAILURE_PATTERNS.find((pattern) => pattern.test(combinedOutput));
  if (availability.exitCode !== 0 && matchedFailure && REQUIRE_EVENHUB_LOGIN) {
    releaseBlockers.push(`Even Hub package availability check failed: ${matchedFailure}`);
  } else if (availability.exitCode !== 0 && matchedFailure) {
    console.warn(JSON.stringify({
      ok: true,
      skipped: "evenhub-package-availability",
      reason: "Even Hub login is not available. Set EVENG2_REQUIRE_EVENHUB_LOGIN=1 to make this probe mandatory.",
    }));
  } else if (availability.exitCode !== 0) {
    releaseBlockers.push(`Even Hub package availability check failed: ${combinedOutput.trim() || `exit ${availability.exitCode}`}`);
  } else {
    console.log(JSON.stringify({
      ok: true,
      evenhubPackageAvailability: evenHubPackageAvailabilityProbeSummary(availability),
    }));
  }
  if (releaseBlockers.length) throw new Error(releaseBlockers.join("\n"));

  console.log(JSON.stringify({ ok: true, releaseCheck: "passed" }));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((err) => {
    console.error(errorStack(err));
    process.exit(1);
  });
}
