import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([".git", ".openclaw-even-g2-node", ".playwright-cli", "dist", "node_modules", "release", "tmp"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const IGNORED_PROTOCOLS = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const INLINE_LINK_PATTERN = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
const AUTOLINK_PATTERN = /<((?:https?:|mailto:)[^>\s]+)>/g;

type Finding = {
  file: string;
  line: number;
  link: string;
  reason: string;
};

type LinkRef = {
  target: string;
  line: number;
};

function relative(filePath: string): string {
  return path.relative(ROOT, filePath) || ".";
}

function shouldSkip(relativePath: string): boolean {
  return relativePath.split(path.sep).some((part, index, parts) => {
    const prefix = parts.slice(0, index + 1).join("/");
    return SKIP_DIRS.has(part) || SKIP_DIRS.has(prefix);
  });
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    const rel = relative(fullPath);
    if (shouldSkip(rel)) return [];
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function stripOptionalTitle(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed.slice(1, -1).trim();
  const titleMatch = trimmed.match(/^(\S+)\s+["'][^"']+["']$/);
  return titleMatch ? titleMatch[1] : trimmed;
}

function splitTarget(target: string): { filePart: string; hash: string } {
  const hashIndex = target.indexOf("#");
  const beforeHash = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  const hash = hashIndex >= 0 ? target.slice(hashIndex + 1) : "";
  const queryIndex = beforeHash.indexOf("?");
  const filePart = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  return { filePart, hash };
}

function lineNumberForIndex(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text[cursor] === "\n") line += 1;
  }
  return line;
}

function markdownWithoutFencedBlocks(text: string): string {
  const lines = text.split(/(\r?\n)/);
  let fenced = false;
  return lines.map((segment) => {
    if (/^\r?\n$/.test(segment)) return segment;
    if (/^\s*(```|~~~)/.test(segment)) {
      fenced = !fenced;
      return "";
    }
    return fenced ? "" : segment;
  }).join("");
}

function extractLinks(filePath: string): LinkRef[] {
  const source = fs.readFileSync(filePath, "utf8");
  const searchable = markdownWithoutFencedBlocks(source);
  const links: LinkRef[] = [];

  for (const match of searchable.matchAll(INLINE_LINK_PATTERN)) {
    const target = stripOptionalTitle(match[1]);
    if (!target || target.startsWith("#fn:") || target.startsWith("^")) continue;
    links.push({ target, line: lineNumberForIndex(searchable, match.index || 0) });
  }

  for (const match of searchable.matchAll(AUTOLINK_PATTERN)) {
    const target = stripOptionalTitle(match[1]);
    links.push({ target, line: lineNumberForIndex(searchable, match.index || 0) });
  }

  return links;
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}

function slugifyHeading(value: string): string {
  return stripInlineMarkdown(value)
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z0-9#]+;/gi, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function anchorsForMarkdown(filePath: string): Set<string> {
  const source = fs.readFileSync(filePath, "utf8");
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  let fenced = false;

  for (const line of source.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    for (const match of line.matchAll(/<a\s+(?:[^>]*\s+)?(?:id|name)=["']([^"']+)["'][^>]*>/gi)) {
      anchors.add(match[1]);
    }

    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;

    const base = slugifyHeading(heading[1]);
    if (!base) continue;
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }

  return anchors;
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function validateLink(sourceFile: string, link: LinkRef): Finding | null {
  if (IGNORED_PROTOCOLS.test(link.target)) return null;

  const { filePart, hash } = splitTarget(link.target);
  const sourceDir = path.dirname(sourceFile);
  const targetPath = filePart ? path.resolve(sourceDir, decodePathPart(filePart)) : sourceFile;
  const relSource = relative(sourceFile);
  const relTarget = relative(targetPath);

  if (!targetPath.startsWith(ROOT)) {
    return { file: relSource, line: link.line, link: link.target, reason: "local link points outside the repository" };
  }
  if (!fs.existsSync(targetPath)) {
    return { file: relSource, line: link.line, link: link.target, reason: `target does not exist: ${relTarget}` };
  }
  if (hash) {
    if (!MARKDOWN_EXTENSIONS.has(path.extname(targetPath))) {
      return { file: relSource, line: link.line, link: link.target, reason: "anchor links are only checked for Markdown targets" };
    }
    const anchors = anchorsForMarkdown(targetPath);
    const decodedHash = decodePathPart(hash);
    if (!anchors.has(decodedHash)) {
      return { file: relSource, line: link.line, link: link.target, reason: `anchor does not exist in ${relTarget}: #${decodedHash}` };
    }
  }

  return null;
}

function main(): void {
  const markdownFiles = walk(ROOT)
    .filter((file) => MARKDOWN_EXTENSIONS.has(path.extname(file)))
    .sort((left, right) => relative(left).localeCompare(relative(right)));
  const findings = markdownFiles.flatMap((file) => extractLinks(file)
    .map((link) => validateLink(file, link))
    .filter((finding): finding is Finding => finding !== null));

  if (findings.length) {
    const detail = findings
      .map((finding) => `- ${finding.file}:${finding.line}: ${finding.link} (${finding.reason})`)
      .join("\n");
    throw new Error(`Markdown link check failed:\n${detail}`);
  }

  console.log(JSON.stringify({ ok: true, scannedMarkdownFiles: markdownFiles.length }));
}

main();
