import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type GitMetadata = {
  dirtyContentSha256: string;
  head: string | null;
  statusPorcelain: string;
  worktreeClean: boolean;
};

function gitStdout(args: string[], cwd = process.cwd()): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return "";
  return result.stdout;
}

export function git(args: string[], cwd = process.cwd()): string {
  return gitStdout(args, cwd).trim();
}

export function dirtyContentSha256(cwd = process.cwd()): string {
  const hash = crypto.createHash("sha256");
  hash.update(gitStdout(["diff", "--binary", "HEAD", "--"], cwd));
  hash.update("\0");
  const untrackedFiles = gitStdout(["ls-files", "--others", "--exclude-standard", "-z"], cwd)
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const filePath of untrackedFiles) {
    hash.update(filePath);
    hash.update("\0");
    try {
      hash.update(fs.readFileSync(path.join(cwd, filePath)));
    } catch {
      hash.update("<unreadable>");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function gitMetadata(cwd = process.cwd()): GitMetadata {
  const statusPorcelain = git(["status", "--porcelain"], cwd);
  return {
    dirtyContentSha256: dirtyContentSha256(cwd),
    head: git(["rev-parse", "HEAD"], cwd) || null,
    statusPorcelain,
    worktreeClean: statusPorcelain.length === 0,
  };
}

export function porcelainStatusSummary(statusPorcelain = "") {
  return {
    dirtyEntryCount: statusPorcelain.split("\n").filter(Boolean).length,
    statusSha256: statusPorcelain ? crypto.createHash("sha256").update(statusPorcelain).digest("hex") : null,
  };
}
