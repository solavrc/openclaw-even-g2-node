import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { coverageIdsFromUserStoriesMarkdown, validateLlmReview } from "./llm-review-schema.ts";
import { errorStack } from "./strict-helpers.ts";

const HELP = `Validate an Even G2 agentic E2E llm-review.json file.

Usage:
  pnpm e2e:agent:review:validate -- <run-dir>
  pnpm e2e:agent:review:validate -- /tmp/even-g2-run/llm-review.json
`;

function reviewPathFromArg(arg: string | undefined) {
  if (!arg || arg === "-h" || arg === "--help") {
    console.log(HELP);
    process.exit(arg ? 0 : 1);
  }
  const resolved = path.resolve(arg);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    return path.join(resolved, "llm-review.json");
  }
  return resolved;
}

export function validateReviewFile(filePath: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    return [`Could not read or parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`];
  }
  const userStoriesSnapshotPath = path.join(path.dirname(filePath), "user-stories.md.snapshot");
  const coverageIds = fs.existsSync(userStoriesSnapshotPath)
    ? coverageIdsFromUserStoriesMarkdown(fs.readFileSync(userStoriesSnapshotPath, "utf8"))
    : undefined;
  return validateLlmReview(parsed, { coverageIds });
}

function main() {
  const filePath = reviewPathFromArg(process.argv.slice(2).find((arg) => arg !== "--"));
  const errors = validateReviewFile(filePath);
  if (errors.length > 0) {
    console.error(JSON.stringify({ ok: false, filePath, errors }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, filePath }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(errorStack(error));
    process.exit(1);
  }
}
