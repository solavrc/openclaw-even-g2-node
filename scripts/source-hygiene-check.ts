import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SKIP_DIRS = new Set([".git", ".openclaw-even-g2-node", ".playwright-cli", "dist", "node_modules", "release", "tmp"]);
const JAVASCRIPT_SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".cjs", ".mjs"]);
const TS_NOCHECK = ["@ts", "nocheck"].join("-");
const TS_IGNORE = ["@ts", "ignore"].join("-");
const CLIENT_CONSOLE_PATTERN = /\bconsole\.(?:debug|error|info|log|warn)\s*\(/;
const PACKAGE_SCRIPT_PATTERN = /\bpnpm (?:run )?(?!(?:install|audit|exec)\b)([a-zA-Z0-9:_-]+)/g;
const ANY_TYPE = ["a", "ny"].join("");
const LOOSE_TYPESCRIPT_PATTERN = new RegExp(`\\b${ANY_TYPE}\\b|as\\s+${ANY_TYPE}|as\\s+unknown\\s+as`);
const PUBLIC_TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".json",
  ".md",
  ".markdown",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const LEGACY_PRODUCT_NAMES = [
  ["Claw", "Bridge"].join(""),
  ["Ocu", "Claw"].join(""),
];
const PRIVATE_ENVIRONMENT_VALUES = [
  ["macbookpro", ".tail", "72b6aa", ".ts.net"].join(""),
  ["100", "97", "205", "67"].join("."),
  ["192", "168", "86", "89"].join("."),
];
const SECRET_LIKE_PATTERNS = [
  { label: "OpenAI API key", pattern: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { label: "xAI API key", pattern: /\bxai-[A-Za-z0-9_-]{20,}\b/ },
];
type Finding = {
  file: string;
  reason: string;
};

type PackageJson = {
  scripts?: Record<string, string>;
};

export type SourceHygieneFinding = Finding;
export type SourceHygieneReport = {
  findings: SourceHygieneFinding[];
  scannedFiles: number;
};

function relative(root: string, filePath: string): string {
  return path.relative(root, filePath) || ".";
}

function shouldSkip(relativePath: string): boolean {
  return relativePath.split(path.sep).some((part, index, parts) => {
    const prefix = parts.slice(0, index + 1).join("/");
    return SKIP_DIRS.has(part) || SKIP_DIRS.has(prefix);
  });
}

function walk(root: string, dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    const rel = relative(root, fullPath);
    if (shouldSkip(rel)) return [];
    return entry.isDirectory() ? walk(root, fullPath) : [fullPath];
  });
}

export function sourceHygieneReport(root = process.cwd()): SourceHygieneReport {
  const files = walk(root, root);
  const findings: Finding[] = [];
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as PackageJson;
  const scripts = packageJson.scripts || {};
  const scriptNames = new Set(Object.keys(scripts));

  for (const [sourceScriptName, command] of Object.entries(scripts)) {
    for (const match of command.matchAll(PACKAGE_SCRIPT_PATTERN)) {
      const scriptName = match[1];
      if (!scriptNames.has(scriptName)) {
        findings.push({ file: "package.json", reason: `script "${sourceScriptName}" references unknown pnpm script "${scriptName}"` });
      }
    }
  }

  for (const file of files) {
    const rel = relative(root, file);
    const ext = path.extname(file);
    const basename = path.basename(file);
    const isEnvFile = /^\.env(?:\.|$)/.test(basename);
    if (JAVASCRIPT_SOURCE_EXTENSIONS.has(ext)) {
      findings.push({ file: rel, reason: "JavaScript source file is not allowed; use TypeScript" });
    }
    if (isEnvFile && basename !== ".env.example") {
      findings.push({ file: rel, reason: "environment files are not allowed in the public repo; use .env.example without values" });
    }
    if (/^skills?\//.test(rel) || /\/skills?\//.test(rel)) {
      findings.push({ file: rel, reason: "assistant skills belong outside the public extension repo" });
    }
    if (/postmortem/i.test(rel)) {
      findings.push({ file: rel, reason: "postmortem/reflection notes should be maintainer reports, not public repo docs" });
    }
    if (/\.(md|markdown|ya?ml)$/.test(ext)) {
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(PACKAGE_SCRIPT_PATTERN)) {
        const scriptName = match[1];
        if (!scriptNames.has(scriptName)) {
          findings.push({ file: rel, reason: `references unknown pnpm script "${scriptName}"` });
        }
      }
    }
    if (PUBLIC_TEXT_EXTENSIONS.has(ext) || isEnvFile) {
      const text = fs.readFileSync(file, "utf8");
      for (const name of LEGACY_PRODUCT_NAMES) {
        if (text.includes(name)) {
          findings.push({ file: rel, reason: `legacy product name "${name}" is not allowed in the public repo` });
        }
      }
      for (const value of PRIVATE_ENVIRONMENT_VALUES) {
        if (text.includes(value)) {
          findings.push({ file: rel, reason: "environment-specific private network value is not allowed in the public repo" });
        }
      }
      for (const { label, pattern } of SECRET_LIKE_PATTERNS) {
        if (pattern.test(text)) {
          findings.push({ file: rel, reason: `${label} value is not allowed in the public repo` });
        }
      }
    }
    if (/\.(ts|tsx)$/.test(ext)) {
      const text = fs.readFileSync(file, "utf8");
      if (text.includes(TS_NOCHECK)) {
        findings.push({ file: rel, reason: `${TS_NOCHECK} is not allowed in strict TypeScript source` });
      }
      if (text.includes(TS_IGNORE)) {
        findings.push({ file: rel, reason: `${TS_IGNORE} is not allowed in strict TypeScript source` });
      }
      for (const [index, line] of text.split(/\r?\n/).entries()) {
        if (!LOOSE_TYPESCRIPT_PATTERN.test(line)) continue;
        findings.push({ file: `${rel}:${index + 1}`, reason: "loose TypeScript is not allowed; use unknown plus a type guard" });
      }
      if (/^src\//.test(rel) && CLIENT_CONSOLE_PATTERN.test(text)) {
        findings.push({ file: rel, reason: "client source must not call console directly; use a gated helper" });
      }
    }
  }
  return {
    findings,
    scannedFiles: files.length,
  };
}

export function sourceHygieneFindings(root = process.cwd()): SourceHygieneFinding[] {
  return sourceHygieneReport(root).findings;
}

export function main(root = process.cwd()): void {
  const { findings, scannedFiles } = sourceHygieneReport(root);
  if (findings.length) {
    const detail = findings.map((finding) => `- ${finding.file}: ${finding.reason}`).join("\n");
    throw new Error(`Source hygiene check failed:\n${detail}`);
  }

  console.log(JSON.stringify({ ok: true, scannedFiles }));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) main();
