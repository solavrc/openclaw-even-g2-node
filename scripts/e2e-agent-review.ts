import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gitMetadata } from "./git-state.ts";
import {
  assertCaptureLooksVisible,
  captureSimulator,
  simulatorConsoleText,
  type SimulatorCapture,
} from "./simulator-utils.ts";
import { errorStack } from "./strict-helpers.ts";

type ParsedArgs = {
  canvasText: string;
  liveCanvas: boolean;
  nodeName: string;
  openclawTimeoutMs: number;
  outDir: string;
  simulatorUrl: string;
  skipOpenClaw: boolean;
  skipSimulator: boolean;
};

type CommandEvidence = {
  args: string[];
  exitCode: number | null;
  json: unknown | null;
  ok: boolean;
  stderr: string;
  stdout: string;
  timedOut: boolean;
};

type OpenClawEvidence = {
  canvasPresent?: CommandEvidence;
  canvasSnapshot?: CommandEvidence;
  deviceStatus?: CommandEvidence;
  enabled: boolean;
  liveCanvas: boolean;
  nodeName: string;
};

type SimulatorEvidence = {
  capture?: SimulatorCapture;
  consolePath?: string;
  enabled: boolean;
  error?: string;
  glassStates: unknown[];
  visible: boolean;
};

const DEFAULT_OUT_ROOT = path.join(process.cwd(), ".openclaw-even-g2-node", "e2e-agent-runs");
const DEFAULT_SIMULATOR_URL = process.env.EVENG2_SIMULATOR_URL || "http://127.0.0.1:9898";
const DEFAULT_NODE_NAME = process.env.EVENG2_E2E_NODE || "Even G2";
const DEFAULT_OPENCLAW_TIMEOUT_MS = 5_000;
const E2E_GLASS_MARKER = "[openclaw-even-g2-node:e2e:glass]";

const HELP = `Collect an agent-review evidence bundle for Even G2 user-story E2E review.

Usage:
  pnpm e2e:agent
  pnpm e2e:agent:live
  pnpm e2e:agent -- --simulator-url http://127.0.0.1:9898 --node "Even G2"

Options:
  --out-dir <path>          Output directory. Default: .openclaw-even-g2-node/e2e-agent-runs/<timestamp>
  --simulator-url <url>     Even Hub simulator automation URL. Default: ${DEFAULT_SIMULATOR_URL}
  --node <name>             OpenClaw node name/id. Default: ${DEFAULT_NODE_NAME}
  --openclaw-live-canvas    Invoke canvas.present before canvas.snapshot.
  --canvas-text <text>      Text for --openclaw-live-canvas.
  --openclaw-timeout-ms <n> Timeout for each OpenClaw CLI call. Default: ${DEFAULT_OPENCLAW_TIMEOUT_MS}
  --skip-openclaw           Do not call the OpenClaw CLI.
  --skip-simulator          Do not capture simulator screenshots or console.
  -h, --help                Show this help.
`;

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function readFlagValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function readPositiveInteger(value: string, flag: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive number.`);
  return Math.floor(parsed);
}

export function parseArgs(argv: string[], now = new Date()): ParsedArgs {
  const args: ParsedArgs = {
    canvasText: `OpenClaw Even G2 E2E canvas check ${now.toISOString()}`,
    liveCanvas: false,
    nodeName: DEFAULT_NODE_NAME,
    openclawTimeoutMs: DEFAULT_OPENCLAW_TIMEOUT_MS,
    outDir: path.join(DEFAULT_OUT_ROOT, timestampSlug(now)),
    simulatorUrl: DEFAULT_SIMULATOR_URL,
    skipOpenClaw: false,
    skipSimulator: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--out-dir") {
      args.outDir = path.resolve(readFlagValue(argv, index, arg));
      index += 1;
    } else if (arg === "--simulator-url") {
      args.simulatorUrl = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--node") {
      args.nodeName = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--openclaw-live-canvas") {
      args.liveCanvas = true;
    } else if (arg === "--canvas-text") {
      args.canvasText = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--openclaw-timeout-ms") {
      args.openclawTimeoutMs = readPositiveInteger(readFlagValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--skip-openclaw") {
      args.skipOpenClaw = true;
    } else if (arg === "--skip-simulator") {
      args.skipSimulator = true;
    } else if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return args;
}

export function redactText(value: string) {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1<redacted>")
    .replace(/((?:setupCode|token|apiKey|api_key|authorization|auth)=)[^&\s"']+/gi, "$1<redacted>")
    .replace(/(wss?:\/\/[^/\s"'@]+:)[^@\s"']+@/gi, "$1<redacted>@");
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (/token|secret|authorization|apiKey|api_key/i.test(key)) return [key, "<redacted>"];
      return [key, redactValue(item)];
    }),
  );
}

function parseJsonObject(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function parseE2eGlassMarkers(consoleText: string): unknown[] {
  return consoleText
    .split(/\r?\n/)
    .map((line) => {
      const markerIndex = line.indexOf(E2E_GLASS_MARKER);
      if (markerIndex < 0) return null;
      const jsonText = line.slice(markerIndex + E2E_GLASS_MARKER.length).trim();
      return parseJsonObject(jsonText);
    })
    .filter((value): value is unknown => value !== null)
    .map(redactValue);
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(redactValue(value), null, 2)}\n`);
}

function sha256File(filePath: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function runOpenClaw(args: string[], timeoutMs: number): CommandEvidence {
  const result = spawnSync("openclaw", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  });
  const stdout = redactText(result.stdout || "");
  const stderr = redactText(result.stderr || result.error?.message || "");
  const json = parseJsonObject(stdout.trim());
  return {
    args,
    exitCode: result.status,
    json: redactValue(json),
    ok: result.status === 0,
    stderr,
    stdout,
    timedOut: Boolean(result.error && "code" in result.error && result.error.code === "ETIMEDOUT"),
  };
}

function openClawInvokeArgs(nodeName: string, command: string, params: unknown, timeoutMs: number) {
  return [
    "nodes",
    "invoke",
    "--node",
    nodeName,
    "--command",
    command,
    "--params",
    JSON.stringify(params),
    "--timeout",
    String(timeoutMs),
    "--json",
  ];
}

async function collectSimulatorEvidence(args: ParsedArgs, outDir: string): Promise<SimulatorEvidence> {
  if (args.skipSimulator) return { enabled: false, glassStates: [], visible: false };
  const consolePath = path.join(outDir, "simulator-console.txt");
  try {
    const capture = await captureSimulator(args.simulatorUrl, outDir, "agent-review");
    assertCaptureLooksVisible(capture);
    const consoleText = redactText(await simulatorConsoleText(args.simulatorUrl));
    fs.writeFileSync(consolePath, consoleText);
    return {
      capture,
      consolePath,
      enabled: true,
      glassStates: parseE2eGlassMarkers(consoleText),
      visible: true,
    };
  } catch (error) {
    return {
      consolePath,
      enabled: true,
      error: errorStack(error),
      glassStates: [],
      visible: false,
    };
  }
}

function collectOpenClawEvidence(args: ParsedArgs): OpenClawEvidence {
  const evidence: OpenClawEvidence = {
    enabled: !args.skipOpenClaw,
    liveCanvas: args.liveCanvas,
    nodeName: args.nodeName,
  };
  if (args.skipOpenClaw) return evidence;
  evidence.deviceStatus = runOpenClaw(
    openClawInvokeArgs(args.nodeName, "device.status", {}, args.openclawTimeoutMs),
    args.openclawTimeoutMs + 1_000,
  );
  if (args.liveCanvas) {
    evidence.canvasPresent = runOpenClaw(
      openClawInvokeArgs(args.nodeName, "canvas.present", { text: args.canvasText }, args.openclawTimeoutMs),
      args.openclawTimeoutMs + 1_000,
    );
  }
  evidence.canvasSnapshot = runOpenClaw(
    openClawInvokeArgs(args.nodeName, "canvas.snapshot", {}, args.openclawTimeoutMs),
    args.openclawTimeoutMs + 1_000,
  );
  return evidence;
}

function deterministicChecks(simulator: SimulatorEvidence, openclaw: OpenClawEvidence) {
  const checks = [
    {
      name: "simulator-visible",
      ok: !simulator.enabled || simulator.visible,
      detail: simulator.enabled ? simulator.error || "simulator screenshots are visible" : "simulator skipped",
    },
    {
      name: "glass-state-marker",
      ok: !simulator.enabled || simulator.glassStates.length > 0,
      detail: simulator.enabled ? `${simulator.glassStates.length} e2e glass state marker(s)` : "simulator skipped",
    },
    {
      name: "openclaw-device-status",
      ok: !openclaw.enabled || openclaw.deviceStatus?.ok === true,
      detail: openclaw.enabled ? openclaw.deviceStatus?.stderr || openclaw.deviceStatus?.stdout || "device.status ok" : "OpenClaw skipped",
    },
    {
      name: "openclaw-canvas-snapshot",
      ok: !openclaw.enabled || openclaw.canvasSnapshot?.ok === true,
      detail: openclaw.enabled ? openclaw.canvasSnapshot?.stderr || openclaw.canvasSnapshot?.stdout || "canvas.snapshot ok" : "OpenClaw skipped",
    },
  ];
  if (openclaw.liveCanvas) {
    checks.push({
      name: "openclaw-canvas-present",
      ok: openclaw.canvasPresent?.ok === true,
      detail: openclaw.canvasPresent?.stderr || openclaw.canvasPresent?.stdout || "canvas.present ok",
    });
  }
  return checks;
}

export function buildReviewPrompt(input: {
  bundleDir: string;
  evidencePath: string;
  manifestPath: string;
  userStoriesPath: string;
}) {
  return `# Even G2 Agentic E2E Review

You are reviewing the current OpenClaw Even G2 node behavior as a Coding Agent.
Use docs/user-stories.md as the product source of truth and judge fuzzy state
match, not exact pixel or copy equality.

Read these files:

- User stories snapshot: ${input.userStoriesPath}
- Evidence JSON: ${input.evidencePath}
- Run manifest: ${input.manifestPath}
- Bundle directory: ${input.bundleDir}

Review rules:

- Treat glasses as the primary product surface.
- Treat the phone as setup, status, diagnostics, and recovery.
- Do not require exact wording when the visible state clearly satisfies the story.
- Do fail phone-chat, provider-key, model-picker, or Gateway-settings ownership regressions.
- Use screenshots as visual evidence and state/OpenClaw data as semantic evidence.
- Mark missing evidence as inconclusive instead of guessing.
- If OpenClaw node evidence exists, compare device.status / canvas.snapshot with the simulator state.

Return JSON in this shape:

\`\`\`json
{
  "overallVerdict": "pass | warn | fail | inconclusive",
  "storyReviews": [
    {
      "storyId": "story-1",
      "verdict": "pass | warn | fail | inconclusive",
      "confidence": 0.0,
      "summary": "",
      "matchedEvidence": [],
      "concerns": [],
      "requiredFixes": []
    }
  ],
  "nextActions": []
}
\`\`\`
`;
}

function buildReport(input: {
  deterministic: ReturnType<typeof deterministicChecks>;
  evidencePath: string;
  manifestPath: string;
  reviewPromptPath: string;
  simulator: SimulatorEvidence;
}) {
  const failed = input.deterministic.filter((check) => !check.ok);
  const capture = input.simulator.capture;
  return [
    "# Even G2 Agentic E2E Evidence",
    "",
    `Deterministic checks: ${failed.length ? `${failed.length} need review` : "passed or skipped"}`,
    "",
    ...input.deterministic.map((check) => `- ${check.ok ? "ok" : "review"} ${check.name}: ${check.detail}`),
    "",
    "Artifacts:",
    "",
    `- Evidence JSON: ${input.evidencePath}`,
    `- Manifest: ${input.manifestPath}`,
    `- Review prompt: ${input.reviewPromptPath}`,
    ...(capture ? [
      `- Glass review image: ${capture.reviewPath}`,
      `- Glass raw image: ${capture.glassesPath}`,
      `- Phone WebView image: ${capture.webviewPath}`,
    ] : []),
    "",
    "Next step: a Coding Agent should read review-prompt.md and evidence.json, then write llm-review.json with fuzzy user-story verdicts.",
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.outDir, { recursive: true });

  const userStoriesSource = path.join(process.cwd(), "docs", "user-stories.md");
  const userStoriesSnapshotPath = path.join(args.outDir, "user-stories.md.snapshot");
  fs.copyFileSync(userStoriesSource, userStoriesSnapshotPath);

  const simulator = await collectSimulatorEvidence(args, args.outDir);
  const openclaw = collectOpenClawEvidence(args);
  const deterministic = deterministicChecks(simulator, openclaw);
  const evidencePath = path.join(args.outDir, "evidence.json");
  const manifestPath = path.join(args.outDir, "manifest.json");
  const reviewPromptPath = path.join(args.outDir, "review-prompt.md");
  const reportPath = path.join(args.outDir, "report.md");
  const reviewTemplatePath = path.join(args.outDir, "llm-review.template.json");

  const evidence = {
    deterministic,
    openclaw,
    simulator,
  };
  writeJson(evidencePath, evidence);

  const manifest = {
    args,
    cwd: process.cwd(),
    generatedAt: new Date().toISOString(),
    git: gitMetadata(),
    files: {
      evidence: evidencePath,
      report: reportPath,
      reviewPrompt: reviewPromptPath,
      reviewTemplate: reviewTemplatePath,
      userStoriesSnapshot: userStoriesSnapshotPath,
    },
    userStoriesSnapshotSha256: sha256File(userStoriesSnapshotPath),
  };
  writeJson(manifestPath, manifest);

  fs.writeFileSync(reviewPromptPath, buildReviewPrompt({
    bundleDir: args.outDir,
    evidencePath,
    manifestPath,
    userStoriesPath: userStoriesSnapshotPath,
  }));
  writeJson(reviewTemplatePath, {
    overallVerdict: "inconclusive",
    storyReviews: [],
    nextActions: ["Read review-prompt.md and evidence.json, then replace this template with the agent review."],
  });
  fs.writeFileSync(reportPath, buildReport({
    deterministic,
    evidencePath,
    manifestPath,
    reviewPromptPath,
    simulator,
  }));

  console.log(JSON.stringify({
    ok: deterministic.every((check) => check.ok),
    evidencePath,
    reportPath,
    reviewPromptPath,
    runDir: args.outDir,
  }, null, 2));
}

main().catch((error) => {
  console.error(errorStack(error));
  process.exit(1);
});
