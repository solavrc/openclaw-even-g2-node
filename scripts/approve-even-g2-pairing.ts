import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

type JsonRecord = Record<string, unknown>;

type ParsedArgs = {
  allowNonEvenG2: boolean;
  dryRun: boolean;
  openclawArgs: string[];
  pollMs: number;
  watchMs: number | null;
};

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type PendingRequest = {
  kind: "device" | "node";
  requestId: string;
  displayName?: string;
  platform?: string;
  clientId?: string;
  clientMode?: string;
  deviceFamily?: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  caps?: string[];
  commands?: string[];
  requiredApproveScopes?: string[];
  source: "devices-approve-latest" | "devices-list" | "nodes-pending" | "nodes-status";
};

const DEFAULT_WATCH_MS = 30_000;
const DEFAULT_POLL_MS = 750;

const HELP = `Approve the current Even G2 OpenClaw pairing flow.

This wrapper watches for Even G2 device and node pending requests, then approves
them in the order the Gateway exposes them:
  1. device pairing / role upgrade requests from \`openclaw devices approve --latest\`
  2. node capability requests from \`openclaw nodes pending\`

Usage:
  pnpm device:approve:latest
  pnpm device:preview:latest
  pnpm device:approve:latest -- --watch-ms 45000
  pnpm device:approve:latest -- --url <gateway-ws-url> --token <gateway-token>

Options handled by this wrapper:
  --dry-run             Print the actions without approving.
  --watch-ms <ms>       Watch duration. Default: ${DEFAULT_WATCH_MS}ms for approve, one pass for dry-run.
  --poll-ms <ms>        Poll interval while watching. Default: ${DEFAULT_POLL_MS}ms.
  --allow-non-even-g2   Allow approving a newest device request that does not look like Even G2.
  -h, --help            Show this help.

All other options are passed through to OpenClaw CLI calls.
`;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.map(readString).filter((item): item is string => Boolean(item));
  return values.length ? values : undefined;
}

function readNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative number.`);
  return Math.floor(parsed);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const openclawArgs: string[] = [];
  let allowNonEvenG2 = false;
  let dryRun = false;
  let watchMs: number | null = null;
  let pollMs = DEFAULT_POLL_MS;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-non-even-g2") {
      allowNonEvenG2 = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--watch-ms") {
      const value = argv[index + 1];
      if (!value) throw new Error("--watch-ms requires a value.");
      watchMs = readNumber(value, "--watch-ms");
      index += 1;
    } else if (arg === "--poll-ms") {
      const value = argv[index + 1];
      if (!value) throw new Error("--poll-ms requires a value.");
      pollMs = Math.max(100, readNumber(value, "--poll-ms"));
      index += 1;
    } else if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "--latest") {
      throw new Error("Do not pass --latest to this wrapper; it is added internally for device preview.");
    } else if (arg === "--json") {
      throw new Error("Do not pass --json to this wrapper; it uses JSON internally.");
    } else {
      openclawArgs.push(arg);
    }
  }
  return { allowNonEvenG2, dryRun, openclawArgs, pollMs, watchMs };
}

function runOpenClaw(commandArgs: string[], allowExitOne = false): CommandResult {
  try {
    const stdout = execFileSync("openclaw", commandArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error) {
    const cause = error as {
      status?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    const exitCode = typeof cause.status === "number" ? cause.status : 1;
    const stdout = String(cause.stdout || "");
    const stderr = String(cause.stderr || cause.message || "");
    if (allowExitOne && exitCode === 1) return { stdout, stderr, exitCode };
    throw new Error([stderr.trim(), stdout.trim()].filter(Boolean).join("\n") || `openclaw exited with ${exitCode}`);
  }
}

function parseJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function requestIdFromDeviceApproveCommand(command: string | undefined): string | undefined {
  if (!command) return undefined;
  const requestId = /(?:^|\s)openclaw\s+devices\s+approve\s+([^\s]+)/.exec(command)?.[1];
  return normalizeRequestId(requestId);
}

function normalizeRequestId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("-") || trimmed.includes("<") || trimmed.includes(">")) return undefined;
  return trimmed;
}

function parseDevicePreviewJson(text: string): PendingRequest | null {
  const root = asRecord(parseJson(text));
  if (!root) return null;
  const selected = asRecord(root.selected);
  const requestId = normalizeRequestId(readString(selected?.requestId))
    || requestIdFromDeviceApproveCommand(readString(root.approveCommand));
  if (!requestId) return null;
  return {
    kind: "device",
    requestId,
    displayName: readString(selected?.displayName),
    platform: readString(selected?.platform),
    clientId: readString(selected?.clientId),
    clientMode: readString(selected?.clientMode),
    deviceFamily: readString(selected?.deviceFamily),
    role: readString(selected?.role),
    roles: readStringArray(selected?.roles),
    scopes: readStringArray(selected?.scopes),
    source: "devices-approve-latest",
  };
}

function parseDevicePreviewText(text: string): PendingRequest | null {
  const requestId = requestIdFromDeviceApproveCommand(text)
    || normalizeRequestId(/Selected pending device request\s+([^\s]+)/i.exec(text)?.[1]);
  if (!requestId) return null;
  return {
    kind: "device",
    requestId,
    displayName: /^  Device:\s*(.+)$/m.exec(text)?.[1]?.trim(),
    source: "devices-approve-latest",
  };
}

export function parseDevicePreview(text: string): PendingRequest | null {
  return parseDevicePreviewJson(text) || parseDevicePreviewText(text);
}

function deviceListEntries(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.map(asRecord).filter((entry): entry is JsonRecord => Boolean(entry));
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["requests", "pending", "devices"]) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested.map(asRecord).filter((entry): entry is JsonRecord => Boolean(entry));
  }
  return [record];
}

export function parseDevicePendingList(text: string): PendingRequest[] {
  return deviceListEntries(parseJson(text)).flatMap((record): PendingRequest[] => {
    const requestId = normalizeRequestId(readString(record.requestId) || readString(record.id));
    if (!requestId) return [];
    const state = readString(record.state)?.toLowerCase()
      || readString(record.approvalState)?.toLowerCase()
      || readString(record.status)?.toLowerCase()
      || "";
    if (state && !state.includes("pending") && !state.includes("requested")) return [];
    return [{
      kind: "device",
      requestId,
      displayName: readString(record.displayName) || readString(record.deviceName) || readString(record.name),
      platform: readString(record.platform),
      clientId: readString(record.clientId),
      clientMode: readString(record.clientMode),
      deviceFamily: readString(record.deviceFamily),
      role: readString(record.role),
      roles: readStringArray(record.roles),
      scopes: readStringArray(record.scopes),
      source: "devices-list",
    }];
  });
}

export function parseNodePendingList(text: string): PendingRequest[] {
  const parsed = parseJson(text);
  const entries = Array.isArray(parsed) ? parsed : [];
  return entries.flatMap((entry): PendingRequest[] => {
    const record = asRecord(entry);
    const requestId = readString(record?.requestId);
    if (!record || !requestId) return [];
    return [{
      kind: "node",
      requestId,
      displayName: readString(record.displayName),
      platform: readString(record.platform),
      clientId: readString(record.clientId),
      clientMode: readString(record.clientMode),
      deviceFamily: readString(record.deviceFamily),
      caps: readStringArray(record.caps),
      commands: readStringArray(record.commands),
      requiredApproveScopes: readStringArray(record.requiredApproveScopes),
      source: "nodes-pending",
    }];
  });
}

function nodeStatusEntries(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.map(asRecord).filter((entry): entry is JsonRecord => Boolean(entry));
  const record = asRecord(value);
  if (!record) return [];
  const nested = record.nodes;
  if (Array.isArray(nested)) return nested.map(asRecord).filter((entry): entry is JsonRecord => Boolean(entry));
  return [record];
}

export function parseNodeStatusPending(text: string): PendingRequest[] {
  const entries = nodeStatusEntries(parseJson(text));
  return entries.flatMap((record): PendingRequest[] => {
    const requestId = readString(record.pendingRequestId) || readString(record.requestId);
    if (!requestId) return [];
    const approvalState = readString(record.approvalState)?.toLowerCase() || "";
    if (approvalState && !approvalState.includes("pending")) return [];
    return [{
      kind: "node",
      requestId,
      displayName: readString(record.displayName),
      platform: readString(record.platform),
      clientId: readString(record.clientId),
      clientMode: readString(record.clientMode),
      deviceFamily: readString(record.deviceFamily),
      caps: readStringArray(record.pendingDeclaredCaps) || readStringArray(record.caps),
      commands: readStringArray(record.pendingDeclaredCommands) || readStringArray(record.commands),
      requiredApproveScopes: readStringArray(record.requiredApproveScopes),
      source: "nodes-status",
    }];
  });
}

function isEvenG2Request(request: PendingRequest): boolean {
  const displayName = request.displayName?.toLowerCase() || "";
  const platform = request.platform?.toLowerCase() || "";
  const clientId = request.clientId?.toLowerCase() || "";
  const deviceFamily = request.deviceFamily?.toLowerCase() || "";
  return platform === "even-g2"
    || clientId === "openclaw-even-g2-node"
    || clientId === "node-host"
    || displayName === "even g2"
    || displayName.includes("even g2")
    || deviceFamily === "glasses";
}

function formatRequest(request: PendingRequest): string {
  const parts = [
    `${request.kind}:${request.requestId}`,
    request.displayName ? `name=${request.displayName}` : undefined,
    request.platform ? `platform=${request.platform}` : undefined,
    request.clientId ? `client=${request.clientId}` : undefined,
    request.clientMode ? `mode=${request.clientMode}` : undefined,
    request.deviceFamily ? `family=${request.deviceFamily}` : undefined,
    request.role ? `role=${request.role}` : undefined,
    request.roles?.length ? `roles=${request.roles.join(",")}` : undefined,
    request.scopes?.length ? `scopes=${request.scopes.join(",")}` : undefined,
    request.caps?.length ? `caps=${request.caps.join(",")}` : undefined,
    request.requiredApproveScopes?.length ? `requires=${request.requiredApproveScopes.join(",")}` : undefined,
  ].filter(Boolean);
  return parts.join(" ");
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function previewLatestDevice(openclawArgs: string[]): PendingRequest | null {
  const result = runOpenClaw(["devices", "approve", "--latest", "--json", ...openclawArgs], true);
  return parseDevicePreview(`${result.stdout}\n${result.stderr}`);
}

function listPendingDevices(openclawArgs: string[]): PendingRequest[] {
  const result = runOpenClaw(["devices", "list", "--json", ...openclawArgs], true);
  const listed = parseDevicePendingList(result.stdout);
  if (listed.length > 0) return listed;
  const preview = previewLatestDevice(openclawArgs);
  return preview ? [preview] : [];
}

function listPendingNodes(openclawArgs: string[]): PendingRequest[] {
  const pendingResult = runOpenClaw(["nodes", "pending", "--json", ...openclawArgs], true);
  const statusResult = runOpenClaw(["nodes", "status", "--json", ...openclawArgs], true);
  return [
    ...parseNodePendingList(pendingResult.stdout),
    ...parseNodeStatusPending(statusResult.stdout),
  ];
}

function approveRequest(request: PendingRequest, openclawArgs: string[]): "approved" | "stale" {
  const command = request.kind === "device" ? "devices" : "nodes";
  const args = [command, "approve", request.requestId, "--json", ...openclawArgs];
  try {
    execFileSync("openclaw", args, { stdio: "inherit" });
    return "approved";
  } catch (error) {
    const cause = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const output = `${cause.stdout || ""}\n${cause.stderr || ""}\n${cause.message || ""}`;
    if (/unknown requestId|unknown .*id|not found|expired/i.test(output)) return "stale";
    throw error;
  }
}

function actionLine(request: PendingRequest, dryRun: boolean): string {
  const command = `openclaw ${request.kind === "device" ? "devices" : "nodes"} approve ${request.requestId}`;
  return `${dryRun ? "[dry-run]" : "[approve]"} ${formatRequest(request)}\n  ${command}`;
}

export function approveEvenG2Pairing(argv = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  const watchMs = args.watchMs ?? (args.dryRun ? 0 : DEFAULT_WATCH_MS);
  const deadline = Date.now() + watchMs;
  const seen = new Set<string>();
  let approvedCount = 0;
  let staleCount = 0;
  let printedCount = 0;
  let blockedByOtherDevice = false;

  console.log(args.dryRun ? "Previewing Even G2 pairing approvals." : "Approving Even G2 pairing approvals.");
  if (!args.dryRun && watchMs > 0) console.log(`Watching for ${watchMs}ms.`);

  do {
    for (const device of listPendingDevices(args.openclawArgs)) {
      if (seen.has(`${device.kind}:${device.requestId}`)) continue;
      seen.add(`${device.kind}:${device.requestId}`);
      if (isEvenG2Request(device) || args.allowNonEvenG2) {
        console.log(actionLine(device, args.dryRun));
        printedCount += 1;
        if (!args.dryRun) {
          const result = approveRequest(device, args.openclawArgs);
          if (result === "approved") approvedCount += 1;
          else {
            staleCount += 1;
            console.log(`[skip] ${device.kind}:${device.requestId} disappeared before approval.`);
          }
        }
      } else {
        blockedByOtherDevice = true;
        console.log(`[skip] newest pending device is not Even G2: ${formatRequest(device)}`);
      }
    }

    for (const node of listPendingNodes(args.openclawArgs)) {
      if (seen.has(`${node.kind}:${node.requestId}`)) continue;
      seen.add(`${node.kind}:${node.requestId}`);
      if (!isEvenG2Request(node) && !args.allowNonEvenG2) {
        console.log(`[skip] pending node is not Even G2: ${formatRequest(node)}`);
        continue;
      }
      console.log(actionLine(node, args.dryRun));
      printedCount += 1;
      if (!args.dryRun) {
        const result = approveRequest(node, args.openclawArgs);
        if (result === "approved") approvedCount += 1;
        else {
          staleCount += 1;
          console.log(`[skip] ${node.kind}:${node.requestId} disappeared before approval.`);
        }
      }
    }

    if (args.dryRun || Date.now() >= deadline) break;
    sleep(args.pollMs);
  } while (Date.now() <= deadline);

  if (args.dryRun) {
    if (printedCount === 0) console.log("No pending Even G2 approvals found.");
    return;
  }
  console.log(`Done. approved=${approvedCount} stale=${staleCount}`);
  if (approvedCount === 0 && blockedByOtherDevice) {
    console.log("A non-Even G2 device request is currently newest. Re-run after reviewing it or use --allow-non-even-g2 intentionally.");
  } else if (approvedCount === 0) {
    console.log("No pending Even G2 approvals were found during the watch window.");
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    approveEvenG2Pairing();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
