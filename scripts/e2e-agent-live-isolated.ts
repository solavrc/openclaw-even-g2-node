import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { redactCommandArgs, redactText } from "./e2e-agent-review.ts";
import { fetchSimulator } from "./simulator-utils.ts";
import { errorStack } from "./strict-helpers.ts";

type ParsedArgs = {
  approvalWatchMs: number;
  appPort: number | null;
  canvasText: string;
  gatewayPort: number | null;
  openclawContainer: string;
  openclawProfile: string;
  openclawTimeoutMs: number;
  outDir: string | null;
  sendNowSmoke: boolean;
  simulatorPort: number | null;
  token: string;
  voiceReviewSmoke: boolean;
};

type ConnectedNode = {
  commands: string[];
  connectedAtMs: number;
  displayName: string;
  lastSeenAtMs: number;
  nodeId: string;
  platform: string;
};

const DEFAULT_APPROVAL_WATCH_MS = 60_000;
const DEFAULT_OPENCLAW_TIMEOUT_MS = 5_000;
const DEFAULT_TOKEN = "dummy-e2e-token";
const REQUIRED_NODE_COMMANDS = ["canvas.present", "canvas.hide", "canvas.snapshot", "talk.ptt.once"];
const SIMULATOR_BIN = path.join(process.cwd(), "node_modules", "@evenrealities", "evenhub-simulator", "bin", "index.js");

const HELP = `Run the Even G2 agentic E2E flow against a fresh isolated OpenClaw Gateway profile.

Usage:
  pnpm e2e:agent:isolated
  pnpm e2e:agent:isolated -- --profile eveng2-e2e-manual --out-dir /tmp/even-g2-e2e

Options:
  --profile <name>          OpenClaw profile. Default: eveng2-e2e-<timestamp>
  --openclaw-container <n>  Optional OpenClaw container global arg.
  --gateway-port <n>        Gateway port. Default: an available loopback port.
  --app-port <n>            Vite app port. Default: an available loopback port.
  --simulator-port <n>      Even Hub simulator automation port. Default: an available loopback port.
  --token <token>           Throwaway token for OpenClaw CLI --url calls. Default: ${DEFAULT_TOKEN}
  --approval-watch-ms <n>   Pairing approval watch window. Default: ${DEFAULT_APPROVAL_WATCH_MS}
  --openclaw-timeout-ms <n> Timeout for OpenClaw node invocations. Default: ${DEFAULT_OPENCLAW_TIMEOUT_MS}
  --canvas-text <text>      Text for the live canvas check.
  --voice-review-smoke      After pairing, run the real Review microphone/Talk smoke.
  --send-now-smoke          After pairing, run the real Send now WAV attachment smoke.
  --out-dir <path>          Output directory for pnpm e2e:agent:live. Default: that script's default.
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

function readNonNegativeInteger(value: string, flag: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative number.`);
  return Math.floor(parsed);
}

function readPositiveInteger(value: string, flag: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive number.`);
  return Math.floor(parsed);
}

export function parseArgs(argv: string[], now = new Date()): ParsedArgs {
  const args: ParsedArgs = {
    approvalWatchMs: DEFAULT_APPROVAL_WATCH_MS,
    appPort: null,
    canvasText: "E2E canvas check",
    gatewayPort: null,
    openclawContainer: "",
    openclawProfile: `eveng2-e2e-${timestampSlug(now)}`,
    openclawTimeoutMs: DEFAULT_OPENCLAW_TIMEOUT_MS,
    outDir: null,
    sendNowSmoke: false,
    simulatorPort: null,
    token: DEFAULT_TOKEN,
    voiceReviewSmoke: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--profile") {
      args.openclawProfile = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--openclaw-profile") {
      args.openclawProfile = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--openclaw-container") {
      args.openclawContainer = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--gateway-port") {
      args.gatewayPort = readPositiveInteger(readFlagValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--app-port") {
      args.appPort = readPositiveInteger(readFlagValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--simulator-port") {
      args.simulatorPort = readPositiveInteger(readFlagValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--token") {
      args.token = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--approval-watch-ms") {
      args.approvalWatchMs = readNonNegativeInteger(readFlagValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--openclaw-timeout-ms") {
      args.openclawTimeoutMs = readPositiveInteger(readFlagValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--canvas-text") {
      args.canvasText = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--voice-review-smoke") {
      args.voiceReviewSmoke = true;
    } else if (arg === "--send-now-smoke") {
      args.sendNowSmoke = true;
    } else if (arg === "--out-dir") {
      args.outDir = path.resolve(readFlagValue(argv, index, arg));
      index += 1;
    } else if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!args.openclawProfile.trim()) throw new Error("--profile must not be empty.");
  if (args.voiceReviewSmoke && args.sendNowSmoke) throw new Error("--voice-review-smoke and --send-now-smoke cannot be used in the same run because they require different startup voice modes.");
  return args;
}

function openClawGlobalArgs(args: Pick<ParsedArgs, "openclawContainer" | "openclawProfile">) {
  return [
    ...(args.openclawContainer ? ["--container", args.openclawContainer] : []),
    "--profile",
    args.openclawProfile,
  ];
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a local port.")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function runRequired(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; printOutput?: boolean; timeoutMs?: number } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: options.env ? { ...process.env, ...options.env } : process.env,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeoutMs,
  });
  const stdout = redactText(result.stdout || "");
  const stderr = redactText(result.stderr || result.error?.message || "");
  const printOutput = options.printOutput !== false;
  if (printOutput && stdout.trim()) process.stdout.write(stdout);
  if (printOutput && stderr.trim()) process.stderr.write(stderr);
  if (result.status !== 0) {
    const commandText = redactCommandArgs([command, ...args]).join(" ");
    throw new Error(`${commandText} exited ${result.status ?? "unknown"}${stderr ? `\n${stderr}` : ""}`);
  }
  return stdout;
}

function runOpenClaw(args: ParsedArgs, commandArgs: string[], options: { printOutput?: boolean; timeoutMs?: number } = {}) {
  return runRequired("openclaw", [...openClawGlobalArgs(args), ...commandArgs], options);
}

export function profileBaseDir(profile: string) {
  return profile === "default" || profile === "main"
    ? path.join(os.homedir(), ".openclaw")
    : path.join(os.homedir(), `.openclaw-${profile}`);
}

export function parseScopeUpgradeRequestId(output: string) {
  return /\bscope upgrade pending approval \(requestId:\s*([^)]+)\)/i.exec(output)?.[1]?.trim()
    || /\bdevice is asking for more scopes than currently approved \(requestId:\s*([^)]+)\)/i.exec(output)?.[1]?.trim()
    || null;
}

function globalOpenClawDeviceBootstrapModulePath() {
  const candidates: string[] = [];
  const npmRoot = spawnSync("npm", ["root", "-g"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).stdout?.trim();
  if (npmRoot) candidates.push(path.join(npmRoot, "openclaw", "dist", "plugin-sdk", "device-bootstrap.js"));
  candidates.push("/Users/local/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/device-bootstrap.js");
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error("Could not find OpenClaw device-bootstrap module for isolated test-profile bootstrap approval.");
  }
  return found;
}

async function approveLocalBootstrapRequest(args: ParsedArgs, requestId: string) {
  const modulePath = globalOpenClawDeviceBootstrapModulePath();
  const mod = await import(pathToFileURL(modulePath).href) as {
    approveDevicePairing?: (
      requestId: string,
      options: { callerScopes: readonly string[] },
      baseDir: string,
    ) => Promise<unknown>;
  };
  if (typeof mod.approveDevicePairing !== "function") {
    throw new Error(`OpenClaw device-bootstrap module does not export approveDevicePairing: ${modulePath}`);
  }
  const approved = await mod.approveDevicePairing(requestId, { callerScopes: ["operator.admin"] }, profileBaseDir(args.openclawProfile));
  if (!approved || typeof approved !== "object") {
    throw new Error(`Could not approve local OpenClaw bootstrap request ${requestId}.`);
  }
  const status = "status" in approved ? String((approved as { status?: unknown }).status) : "";
  if (status && status !== "approved") {
    throw new Error(`Local OpenClaw bootstrap request ${requestId} was not approved: ${redactText(JSON.stringify(approved))}`);
  }
  console.log(`Approved local CLI bootstrap request in test profile: ${requestId}`);
}

async function runPairingApproval(args: ParsedArgs, gatewayUrl: string) {
  const command = [
    "device:approve:latest",
    "--",
    "--openclaw-profile",
    args.openclawProfile,
    ...(args.openclawContainer ? ["--openclaw-container", args.openclawContainer] : []),
    "--url",
    gatewayUrl,
    "--token",
    args.token,
    "--watch-ms",
    String(args.approvalWatchMs),
  ];
  try {
    runRequired("pnpm", command, { timeoutMs: args.approvalWatchMs + 15_000 });
  } catch (error) {
    const requestId = parseScopeUpgradeRequestId(String(error));
    if (!requestId) throw error;
    console.log(`Approving CLI scope-upgrade bootstrap request inside test profile: ${requestId}`);
    await approveLocalBootstrapRequest(args, requestId);
    runRequired("pnpm", command, { timeoutMs: args.approvalWatchMs + 15_000 });
  }
}

function spawnProcess(command: string, args: string[], options: SpawnOptions = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    detached: true,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(redactText(chunk.toString("utf8"))));
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(redactText(chunk.toString("utf8"))));
  child.on("error", (error) => {
    process.stderr.write(redactText(`${command} failed to start: ${error.message}\n`));
  });
  return child;
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Best effort cleanup.
    }
  }
}

async function stopProcess(child: ChildProcess | null) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signalProcessGroup(child, "SIGKILL");
      resolve();
    }, 2_500);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    signalProcessGroup(child, "SIGINT");
  });
}

async function waitForHttp(url: string, timeoutMs = 20_000) {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = new Error(`${url} returned ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForSimulator(baseUrl: string, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetchSimulator(baseUrl, "/api/ping");
      if (res.ok) return;
      lastError = new Error(`ping returned ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(350);
  }
  throw new Error(`Timed out waiting for simulator at ${baseUrl}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function selectConnectedEvenG2NodeId(nodesStatusJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(nodesStatusJson) as unknown;
  } catch {
    return null;
  }
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const nodes = Array.isArray(record?.nodes) ? record.nodes : [];
  const candidates = nodes.flatMap((node): ConnectedNode[] => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return [];
    const entry = node as Record<string, unknown>;
    if (entry.connected !== true) return [];
    const platform = readString(entry.platform).toLowerCase();
    const displayName = readString(entry.displayName).toLowerCase();
    const commands = readStringArray(entry.commands);
    const hasCanvas = commands.some((command) => command.startsWith("canvas."));
    if (platform !== "even-g2" && !displayName.includes("even g2")) return [];
    if (!hasCanvas) return [];
    const nodeId = readString(entry.nodeId);
    if (!nodeId) return [];
    return [{
      commands,
      connectedAtMs: readNumber(entry.connectedAtMs),
      displayName: readString(entry.displayName),
      lastSeenAtMs: readNumber(entry.lastSeenAtMs),
      nodeId,
      platform: readString(entry.platform),
    }];
  });
  candidates.sort((a, b) => (b.lastSeenAtMs || b.connectedAtMs) - (a.lastSeenAtMs || a.connectedAtMs));
  return candidates[0]?.nodeId || null;
}

async function waitForConnectedNodeId(args: ParsedArgs, gatewayUrl: string) {
  const startedAt = Date.now();
  let lastOutput = "";
  while (Date.now() - startedAt < 45_000) {
    const stdout = runOpenClaw(args, [
      "nodes",
      "status",
      "--json",
      "--url",
      gatewayUrl,
      "--token",
      args.token,
    ], { printOutput: false, timeoutMs: args.openclawTimeoutMs + 1_000 });
    lastOutput = stdout;
    const nodeId = selectConnectedEvenG2NodeId(stdout);
    if (nodeId) return nodeId;
    await sleep(750);
  }
  throw new Error(`Timed out waiting for connected Even G2 node.\nLast nodes status:\n${lastOutput}`);
}

function writeIsolatedRunSummary(outDir: string, summary: unknown) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "isolated-run.json"), `${JSON.stringify(summary, null, 2)}\n`);
}

async function runIsolatedLiveE2e(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const gatewayPort = args.gatewayPort ?? await freePort();
  const appPort = args.appPort ?? await freePort();
  const simulatorPort = args.simulatorPort ?? await freePort();
  const gatewayUrl = `ws://127.0.0.1:${gatewayPort}`;
  const simulatorUrl = `http://127.0.0.1:${simulatorPort}`;
  const outDir = args.outDir ?? path.join(process.cwd(), ".openclaw-even-g2-node", "e2e-agent-runs", `isolated-${timestampSlug()}`);
  let gateway: ChildProcess | null = null;
  let vite: ChildProcess | null = null;
  let simulator: ChildProcess | null = null;
  let connectedNodeId = "";

  try {
    console.log(`Using isolated OpenClaw profile: ${args.openclawProfile}`);
    runOpenClaw(args, [
      "config",
      "set",
      "gateway.nodes.allowCommands",
      JSON.stringify(REQUIRED_NODE_COMMANDS),
      "--strict-json",
    ], { timeoutMs: 15_000 });

    gateway = spawnProcess("openclaw", [
      ...openClawGlobalArgs(args),
      "gateway",
      "--dev",
      "--force",
      "--port",
      String(gatewayPort),
      "--auth",
      "none",
      "--allow-unconfigured",
      "--compact",
    ]);
    await waitForHttp(`http://127.0.0.1:${gatewayPort}/health`, 30_000);

    vite = spawnProcess("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(appPort), "--strictPort"]);
    await waitForHttp(`http://127.0.0.1:${appPort}/`, 20_000);

    const setupCode = runOpenClaw(args, [
      "qr",
      "--setup-code-only",
      "--url",
      gatewayUrl,
      "--token",
      args.token,
    ], { printOutput: false, timeoutMs: 15_000 }).trim();
    if (!setupCode) throw new Error("OpenClaw did not return a setup code.");

    const appUrl = `http://127.0.0.1:${appPort}/?resetPairing=1&e2eLog=1${args.sendNowSmoke ? "&e2eVoiceMode=direct" : ""}&setupCode=${encodeURIComponent(setupCode)}`;
    simulator = spawnProcess(process.execPath, [SIMULATOR_BIN, appUrl, "--automation-port", String(simulatorPort)]);
    await waitForSimulator(simulatorUrl);

    await runPairingApproval(args, gatewayUrl);

    connectedNodeId = await waitForConnectedNodeId(args, gatewayUrl);
    console.log(`Connected Even G2 nodeId: ${connectedNodeId}`);

    runRequired("pnpm", [
      "e2e:agent:live",
      "--",
      "--simulator-url",
      simulatorUrl,
      "--openclaw-profile",
      args.openclawProfile,
      "--openclaw-url",
      gatewayUrl,
      "--openclaw-token",
      args.token,
      "--openclaw-timeout-ms",
      String(args.openclawTimeoutMs),
      "--node",
      connectedNodeId,
      "--canvas-text",
      args.canvasText,
      "--out-dir",
      outDir,
    ], { timeoutMs: 45_000 });

    if (args.voiceReviewSmoke || args.sendNowSmoke) {
      runRequired("pnpm", [
        args.voiceReviewSmoke ? "smoke:voice-review" : "smoke:send-now",
      ], {
        env: {
          EVENG2_E2E_OPENCLAW_CONTAINER: args.openclawContainer,
          EVENG2_E2E_OPENCLAW_PROFILE: args.openclawProfile,
          EVENG2_E2E_OPENCLAW_TOKEN: args.token,
          EVENG2_E2E_OPENCLAW_URL: gatewayUrl,
          EVENG2_SIMULATOR_URL: simulatorUrl,
          EVENG2_VOICE_NODE: connectedNodeId,
          EVENG2_SEND_NOW_NODE: connectedNodeId,
        },
        timeoutMs: 90_000,
      });
    }

    writeIsolatedRunSummary(outDir, {
      ok: true,
      generatedAt: new Date().toISOString(),
      openclaw: {
        authProvided: Boolean(args.token),
        container: args.openclawContainer,
        profile: args.openclawProfile,
        url: gatewayUrl,
      },
      ports: {
        app: appPort,
        gateway: gatewayPort,
        simulator: simulatorPort,
      },
      connectedNodeId,
      sendNowSmoke: args.sendNowSmoke,
      voiceReviewSmoke: args.voiceReviewSmoke,
      outDir,
    });

    console.log(JSON.stringify({
      ok: true,
      connectedNodeId,
      outDir,
      reportPath: path.join(outDir, "report.md"),
    }, null, 2));
  } catch (error) {
    if (outDir) {
      writeIsolatedRunSummary(outDir, {
        ok: false,
        generatedAt: new Date().toISOString(),
        connectedNodeId: connectedNodeId || null,
        error: errorStack(error),
        openclaw: {
          authProvided: Boolean(args.token),
          container: args.openclawContainer,
          profile: args.openclawProfile,
          url: gatewayUrl,
        },
      });
    }
    throw error;
  } finally {
    await stopProcess(simulator);
    await stopProcess(vite);
    await stopProcess(gateway);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath || fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  runIsolatedLiveE2e().catch((error) => {
    console.error(redactText(errorStack(error)));
    process.exit(1);
  });
}
