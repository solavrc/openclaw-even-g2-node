import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Finding = {
  file: string;
  label: string;
  match: string;
};

const SCAN_ROOTS = [
  "README.md",
  "PRIVACY.md",
  "app.json",
  "index.html",
  "package.json",
  "openclaw-node-evenhub-icon-24.png",
  "tsconfig.json",
  "vite.config.ts",
  "src",
  "scripts",
  "docs",
];

const SKIP_DIRS = new Set([
  ".git",
  ".playwright-cli",
  "node_modules",
  "output",
]);

function textFromCodes(codes: number[]): string {
  return String.fromCharCode(...codes);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function forbiddenLiteral(label: string, codes: number[], flags = "") {
  return {
    label,
    pattern: new RegExp(`\\b${escapeRegExp(textFromCodes(codes))}\\b`, flags),
  };
}

function forbiddenPattern(label: string, codes: number[], suffixPattern: string, flags = "") {
  return {
    label,
    pattern: new RegExp(`\\b${escapeRegExp(textFromCodes(codes))}${suffixPattern}`, flags),
  };
}

const FORBIDDEN_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  forbiddenPattern("old repo namespace", [111, 112, 101, 110, 99, 108, 97, 119, 45, 101, 118, 101, 110, 45, 103, 50], "(?!-node)\\b", "i"),
  forbiddenPattern("old compact namespace", [111, 112, 101, 110, 99, 108, 97, 119, 101, 118, 101, 110, 103, 50], "(?!node)\\b", "i"),
  forbiddenPattern("old package id", [99, 111, 109, 46, 115, 111, 108, 97, 118, 114, 99, 46, 111, 112, 101, 110, 99, 108, 97, 119, 101, 118, 101, 110, 103, 50], "(?!node)\\b", "i"),
  forbiddenLiteral("old product name", [67, 108, 97, 119, 66, 114, 105, 100, 103, 101], "i"),
  forbiddenLiteral("old compatibility name", [79, 99, 117, 67, 108, 97, 119], "i"),
  forbiddenLiteral("old Even Hub listing name", [79, 112, 101, 110, 67, 108, 97, 119, 32, 71, 50]),
  forbiddenLiteral("personal hostname", [109, 97, 99, 98, 111, 111, 107, 112, 114, 111, 46, 116, 97, 105, 108, 55, 50, 98, 54, 97, 97, 46, 116, 115, 46, 110, 101, 116], "i"),
  forbiddenLiteral("personal tailnet marker", [116, 97, 105, 108, 55, 50], "i"),
  forbiddenLiteral("personal tailnet IP", [49, 48, 48, 46, 57, 55, 46, 50, 48, 53, 46, 54, 55]),
  forbiddenLiteral("personal LAN IP", [49, 57, 50, 46, 49, 54, 56, 46, 56, 54, 46, 56, 57]),
  { label: "developer absolute path", pattern: new RegExp(escapeRegExp(textFromCodes([47, 85, 115, 101, 114, 115, 47, 108, 111, 99, 97, 108])) + "\\b") },
  forbiddenLiteral("legacy STT provider", [115, 111, 110, 105, 111, 120], "i"),
  { label: "probable OpenAI API key", pattern: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: "probable Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { label: "probable xAI API key", pattern: /\bxai-[A-Za-z0-9_-]{20,}\b/ },
];

const FORBIDDEN_PATH_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  forbiddenPattern("old repo namespace in path", [111, 112, 101, 110, 99, 108, 97, 119, 45, 101, 118, 101, 110, 45, 103, 50], "(?!-node)\\b", "i"),
  forbiddenPattern("old compact namespace in path", [111, 112, 101, 110, 99, 108, 97, 119, 101, 118, 101, 110, 103, 50], "(?!node)\\b", "i"),
  forbiddenPattern("old package id in path", [99, 111, 109, 46, 115, 111, 108, 97, 118, 114, 99, 46, 111, 112, 101, 110, 99, 108, 97, 119, 101, 118, 101, 110, 103, 50], "(?!node)\\b", "i"),
];

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function walk(root: string, input: string): string[] {
  const abs = path.resolve(root, input);
  if (!fs.existsSync(abs)) return [];
  if (!isDirectory(abs)) return [abs];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) return [];
    const next = path.join(abs, entry.name);
    return entry.isDirectory() ? walk(root, path.relative(root, next)) : [next];
  });
}

function readSearchable(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return buffer.toString("utf8");
}

function findMatches(root: string, filePath: string): Finding[] {
  const relative = path.relative(root, filePath);
  const text = readSearchable(filePath);
  const pathFindings = FORBIDDEN_PATH_PATTERNS.flatMap(({ label, pattern }) => {
    const match = relative.match(pattern);
    return match ? [{ file: relative, label, match: match[0] }] : [];
  });
  const textFindings = FORBIDDEN_PATTERNS.flatMap(({ label, pattern }) => {
    const match = text.match(pattern);
    return match ? [{ file: relative, label, match: match[0] }] : [];
  });
  return [...pathFindings, ...textFindings];
}

export function releaseArtifactAuditFindings(root = process.cwd()): Finding[] {
  const files = releaseArtifactAuditFiles(root);
  return files.flatMap((filePath) => findMatches(root, filePath));
}

export function releaseArtifactAuditFiles(root = process.cwd()): string[] {
  return [...new Set(SCAN_ROOTS.flatMap((scanRoot) => walk(root, scanRoot)))].sort();
}

export function main(root = process.cwd()): void {
  const files = releaseArtifactAuditFiles(root);
  const findings = files.flatMap((filePath) => findMatches(root, filePath));
  if (!findings.length) {
    console.log(JSON.stringify({ ok: true, scannedFiles: files.length }));
    return;
  }
  const detail = findings.map((finding) => (
    `- ${finding.file}: ${finding.label}: ${JSON.stringify(finding.match)}`
  )).join("\n");
  throw new Error(`Release artifact audit failed:\n${detail}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) main();
