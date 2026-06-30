import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setupOpenClawAskRequest } from "../src/openclaw-ask-requests.ts";
import { gitMetadata } from "./git-state.ts";
import { redactCommandArgs, redactText } from "./e2e-agent-review.ts";
import { errorStack } from "./strict-helpers.ts";

export type ParsedArgs = {
  agent: string;
  gatewayUrl: string;
  message: string;
  openclawContainer: string;
  openclawProfile: string;
  outDir: string;
  sessionKey: string;
  timeoutSeconds: number;
};

export type AgentCommandEvidence = {
  args: string[];
  exitCode: number | null;
  json: unknown[];
  ok: boolean;
  stderr: string;
  stdout: string;
  timedOut: boolean;
};

export type OnboardingCheck = {
  detail: string;
  name: string;
  ok: boolean;
};

const DEFAULT_OUT_ROOT = path.join(process.cwd(), ".openclaw-even-g2-node", "onboarding-agent-runs");
const DEFAULT_GATEWAY_URL = process.env.EVENG2_E2E_GATEWAY_URL || "";
const DEFAULT_OPENCLAW_CONTAINER = process.env.EVENG2_E2E_OPENCLAW_CONTAINER || "";
const DEFAULT_OPENCLAW_PROFILE = process.env.EVENG2_E2E_OPENCLAW_PROFILE || "";
const DEFAULT_TIMEOUT_SECONDS = 180;

const HELP = `Smoke-test the actual "Ask OpenClaw with:" setup prompt through an OpenClaw Agent.

Usage:
  pnpm e2e:agent:onboarding -- --openclaw-container openclaw-even-g2-node-test-...

Options:
  --out-dir <path>          Output directory. Default: .openclaw-even-g2-node/onboarding-agent-runs/<timestamp>
  --gateway-url <url>       Host-reachable Gateway URL to request in the setup QR. Default: EVENG2_E2E_GATEWAY_URL
  --openclaw-container <n>  OpenClaw container name for isolated Gateway Agent execution. Default: EVENG2_E2E_OPENCLAW_CONTAINER
  --openclaw-profile <name> OpenClaw CLI profile for host Agent execution. Default: EVENG2_E2E_OPENCLAW_PROFILE or current CLI profile
  --agent <id>              Agent id. Default: main
  --message <text>          Prompt to send. Default: the app's setup "Ask OpenClaw with:" request
  --session-key <key>       Agent session key. Default: agent:<agent>:eveng2-onboarding-smoke-<timestamp>
  --timeout-seconds <n>     OpenClaw Agent timeout. Default: ${DEFAULT_TIMEOUT_SECONDS}
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
  const timestamp = timestampSlug(now);
  let messageWasSet = false;
  const args: ParsedArgs = {
    agent: "main",
    gatewayUrl: DEFAULT_GATEWAY_URL,
    message: "",
    openclawContainer: DEFAULT_OPENCLAW_CONTAINER,
    openclawProfile: DEFAULT_OPENCLAW_PROFILE,
    outDir: path.join(DEFAULT_OUT_ROOT, timestamp),
    sessionKey: "",
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--out-dir") {
      args.outDir = path.resolve(readFlagValue(argv, index, arg));
      index += 1;
    } else if (arg === "--gateway-url") {
      args.gatewayUrl = readFlagValue(argv, index, arg).trim();
      index += 1;
    } else if (arg === "--openclaw-container") {
      args.openclawContainer = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--openclaw-profile") {
      args.openclawProfile = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--agent") {
      args.agent = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--message") {
      args.message = readFlagValue(argv, index, arg);
      messageWasSet = true;
      index += 1;
    } else if (arg === "--session-key") {
      args.sessionKey = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--timeout-seconds") {
      args.timeoutSeconds = readPositiveInteger(readFlagValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!messageWasSet) {
    args.message = setupOpenClawAskRequest(args.gatewayUrl);
  }
  if (!args.sessionKey) {
    args.sessionKey = `agent:${args.agent}:eveng2-onboarding-smoke-${timestamp}`;
  }
  return args;
}

function tryParseJson(text: string) {
  try {
    return { ok: true as const, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false as const };
  }
}

export function parseAgentJsonOutput(stdout: string): unknown[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const whole = tryParseJson(trimmed);
  if (whole.ok) return [whole.value];
  return trimmed
    .split(/\r?\n/)
    .map((line) => tryParseJson(line.trim()))
    .filter((result): result is { ok: true; value: unknown } => result.ok)
    .map((result) => result.value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item, depth + 1));
  const record = asRecord(value);
  if (!record) return [];
  return Object.entries(record)
    .filter(([key]) => !/^(role|author|speaker|type|event|kind)$/i.test(key))
    .flatMap(([, item]) => collectStrings(item, depth + 1));
}

function isUserInputRecord(record: Record<string, unknown>) {
  const role = stringValue(record.role || record.author || record.speaker).toLowerCase();
  const type = stringValue(record.type || record.event).toLowerCase();
  return role === "user" || type === "user" || type === "input" || type === "prompt";
}

function collectAgentResponseText(value: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectAgentResponseText(item, depth + 1));
  const record = asRecord(value);
  if (!record || isUserInputRecord(record)) return [];

  const role = stringValue(record.role || record.author || record.speaker).toLowerCase();
  const type = stringValue(record.type || record.event || record.kind).toLowerCase();
  if (/(assistant|agent|final|response|output|result)/i.test(`${role} ${type}`)) {
    const text = collectStrings(record, depth + 1);
    if (text.length) return text;
  }

  const finalText = ["finalAssistantVisibleText", "finalAssistantRawText"].flatMap((key) => collectStrings(record[key], depth + 1));
  if (finalText.length) return finalText;

  const nestedResult = collectAgentResponseText(record.result, depth + 1);
  if (nestedResult.length) return nestedResult;

  const preferred = ["payloads", "response", "output", "text", "content", "message", "answer", "final"];
  const text = preferred.flatMap((key) => collectStrings(record[key], depth + 1));
  if (text.length) return text;

  return Object.entries(record)
    .filter(([key]) => !/^(args|argv|command|input|prompt|request|sessionKey|session)$/i.test(key))
    .flatMap(([, item]) => collectAgentResponseText(item, depth + 1));
}

export function extractAgentResponseText(stdout: string, jsonValues = parseAgentJsonOutput(stdout)) {
  const fromJson = jsonValues.flatMap((value) => collectAgentResponseText(value));
  if (fromJson.length) return fromJson.join("\n").trim();
  if (jsonValues.length) return "";
  return stdout.trim();
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function looksLikePromptEcho(responseText: string, promptText = setupOpenClawAskRequest()) {
  const normalized = normalizeText(responseText);
  const prompt = normalizeText(promptText);
  if (!normalized || !prompt) return false;
  if (normalized === prompt) return true;
  const withoutCommonPrefix = normalized.replace(/^(?:prompt|input|user|message|request|submitted prompt)\s*[:>-]\s*/, "");
  return withoutCommonPrefix === prompt;
}

function hostPortFromGatewayUrl(gatewayUrl: string) {
  try {
    const parsed = new URL(gatewayUrl);
    return parsed.host.toLowerCase();
  } catch {
    return "";
  }
}

function includesGatewayTarget(responseText: string, gatewayUrl: string) {
  const target = gatewayUrl.trim().toLowerCase();
  if (!target) return true;
  const normalized = responseText.toLowerCase();
  const hostPort = hostPortFromGatewayUrl(target);
  return normalized.includes(target) || Boolean(hostPort && normalized.includes(hostPort));
}

function containsContainerBridgeAddress(responseText: string) {
  return /\b172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}\b/.test(responseText);
}

export function agentOnboardingVerdict(
  command: AgentCommandEvidence,
  responseText: string,
  options: { gatewayUrl?: string; promptText?: string } = {},
) {
  const normalized = normalizeText(responseText);
  const promptEcho = looksLikePromptEcho(responseText, options.promptText);
  const gatewayUrl = options.gatewayUrl?.trim() || "";
  const checks: OnboardingCheck[] = [
    {
      name: "agent-command-exit",
      ok: command.ok && !command.timedOut,
      detail: command.timedOut ? "OpenClaw Agent command timed out" : `exitCode=${String(command.exitCode)}`,
    },
    {
      name: "agent-response-text",
      ok: normalized.length > 0 && !promptEcho,
      detail: promptEcho
        ? "Agent response only echoed the setup prompt"
        : normalized.length > 0
          ? `${normalized.length} normalized response characters`
          : "Agent response text was empty",
    },
    {
      name: "setup-qr-guidance",
      ok: /\bqr\b/.test(normalized) && /\b(setup|scan|pair|code)\b/.test(normalized),
      detail: "response should tell a user how to get or use the setup QR/code",
    },
    {
      name: "even-g2-context",
      ok: /even\s*g2|openclaw-even-g2-node|glasses?/.test(normalized),
      detail: "response should keep the Even G2 app context",
    },
    {
      name: "openclaw-context",
      ok: /openclaw|open claw|\bclaw\b/.test(normalized),
      detail: "response should route the user through OpenClaw, not a generic QR flow",
    },
    ...(gatewayUrl
      ? [
        {
          name: "host-gateway-url",
          ok: includesGatewayTarget(responseText, gatewayUrl),
          detail: `response should preserve the host-reachable Gateway URL ${gatewayUrl}`,
        },
        {
          name: "no-container-bridge-url",
          ok: !containsContainerBridgeAddress(responseText),
          detail: "response should not expose Docker bridge URLs that the phone cannot reach",
        },
      ]
      : []),
  ];
  return {
    checks,
    ok: checks.every((check) => check.ok),
  };
}

function openClawGlobalArgs(args: ParsedArgs) {
  return [
    ...(args.openclawContainer ? ["--container", args.openclawContainer] : []),
    ...(args.openclawProfile ? ["--profile", args.openclawProfile] : []),
  ];
}

function runAgentCommand(args: ParsedArgs): AgentCommandEvidence {
  const commandArgs = [
    ...openClawGlobalArgs(args),
    "agent",
    "--agent",
    args.agent,
    "--message",
    args.message,
    "--session-key",
    args.sessionKey,
    "--json",
    "--timeout",
    String(args.timeoutSeconds),
  ];
  const result = spawnSync("openclaw", commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: (args.timeoutSeconds + 5) * 1_000,
  });
  const stdout = redactText(result.stdout || "");
  const stderr = redactText(result.stderr || result.error?.message || "");
  return {
    args: redactCommandArgs(["openclaw", ...commandArgs]),
    exitCode: result.status,
    json: parseAgentJsonOutput(stdout),
    ok: result.status === 0,
    stderr,
    stdout,
    timedOut: Boolean(result.error && "code" in result.error && result.error.code === "ETIMEDOUT"),
  };
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (/token|secret|authorization|apiKey|api_key|bootstrap|setupCode|setup_code|setupToken|setup_token/i.test(key)) {
        return [key, "<redacted>"];
      }
      return [key, redactValue(item)];
    }),
  );
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(redactValue(value), null, 2)}\n`);
}

function buildReport(input: {
  command: AgentCommandEvidence;
  evidencePath: string;
  manifestPath: string;
  responseText: string;
  verdict: ReturnType<typeof agentOnboardingVerdict>;
}) {
  return [
    "# Even G2 Onboarding Agent Smoke",
    "",
    `Deterministic checks: ${input.verdict.ok ? "passed" : "failed"}`,
    "",
    ...input.verdict.checks.map((check) => `- ${check.ok ? "ok" : "fail"} ${check.name}: ${check.detail}`),
    "",
    "Artifacts:",
    "",
    `- Evidence JSON: ${input.evidencePath}`,
    `- Manifest: ${input.manifestPath}`,
    "",
    "OpenClaw command:",
    "",
    "```text",
    input.command.args.join(" "),
    "```",
    "",
    "Extracted response:",
    "",
    "```text",
    input.responseText || "<empty>",
    "```",
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.outDir, { recursive: true });

  const command = runAgentCommand(args);
  const responseText = extractAgentResponseText(command.stdout, command.json);
  const verdict = agentOnboardingVerdict(command, responseText, {
    gatewayUrl: args.gatewayUrl,
    promptText: args.message,
  });
  const evidencePath = path.join(args.outDir, "evidence.json");
  const manifestPath = path.join(args.outDir, "manifest.json");
  const reportPath = path.join(args.outDir, "report.md");

  const evidence = {
    command,
    prompt: {
      askOpenClawWith: args.message,
      gatewayUrl: args.gatewayUrl || null,
      source: "src/openclaw-ask-requests.ts setupOpenClawAskRequest(), consumed by setupHudFrame()",
    },
    responseText,
    verdict,
  };
  writeJson(evidencePath, evidence);
  writeJson(manifestPath, {
    args,
    cwd: process.cwd(),
    files: {
      evidence: evidencePath,
      report: reportPath,
    },
    generatedAt: new Date().toISOString(),
    git: gitMetadata(),
  });
  fs.writeFileSync(reportPath, buildReport({
    command,
    evidencePath,
    manifestPath,
    responseText,
    verdict,
  }));

  console.log(JSON.stringify({
    ok: verdict.ok,
    evidencePath,
    reportPath,
    runDir: args.outDir,
  }, null, 2));

  if (!verdict.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(errorStack(error));
    process.exit(1);
  });
}
