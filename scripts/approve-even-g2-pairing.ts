import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactText } from "./e2e-agent-review.ts";

type JsonRecord = Record<string, unknown>;

type ParsedArgs = {
  allowNonEvenG2: boolean;
  dryRun: boolean;
  e2eIsolatedStateDir: string;
  openclawArgs: string[];
  openclawGlobalArgs: string[];
  pollMs: number;
  settleMs: number;
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
const DEFAULT_SETTLE_MS = 8_000;
const ISOLATED_E2E_ADMIN_SCOPES = [
  "operator.admin",
  "operator.approvals",
  "operator.pairing",
  "operator.read",
  "operator.talk.secrets",
  "operator.write",
];
const ISOLATED_STATE_MARKER_FILE = ".openclaw-even-g2-node-isolated-state.json";
const ISOLATED_STATE_MARKER_KIND = "openclaw-even-g2-node.isolated-gateway-state";
const EVEN_G2_NODE_CAPS = new Set(["canvas", "talk"]);
const EVEN_G2_NODE_COMMANDS = new Set([
  "canvas.hide",
  "canvas.present",
  "canvas.snapshot",
  "talk.ptt.once",
]);

const HELP = `Approve the current Even G2 OpenClaw pairing flow.

This wrapper watches for Even G2 device and node pending requests, then approves
them in the order the Gateway exposes them:
  1. device pairing / role upgrade requests from \`openclaw devices approve --latest\`
  2. node capability requests from \`openclaw nodes pending\`

Usage:
  pnpm device:approve:latest
  pnpm device:preview:latest
  pnpm device:approve:latest -- --watch-ms 45000
  pnpm device:approve:latest -- --openclaw-container <container>
  pnpm device:approve:latest -- --openclaw-profile <profile>
  pnpm device:approve:latest -- --url <gateway-ws-url> --token <gateway-token>

Options handled by this wrapper:
  --dry-run             Print the actions without approving.
  --watch-ms <ms>       Watch duration. Default: ${DEFAULT_WATCH_MS}ms for approve, one pass for dry-run.
  --poll-ms <ms>        Poll interval while watching. Default: ${DEFAULT_POLL_MS}ms.
  --settle-ms <ms>      After approving at least one request, stop once no new Even G2 request appears for this long. Default: ${DEFAULT_SETTLE_MS}ms.
  --openclaw-container <name>
                        Run OpenClaw CLI calls through this container.
  --openclaw-profile <name>
                        Run OpenClaw CLI calls with this profile.
  --e2e-isolated-state-dir <path>
                        Disposable isolated Gateway state dir. Grants the
                        generated CLI identity the admin/operator scopes needed
                        to approve setup requests. Do not use with real state.
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

function uniqueScopeArray(value: unknown, scopes: string[]) {
  const next = new Set(readStringArray(value) || []);
  const before = next.size;
  for (const scope of scopes) next.add(scope);
  return { changed: next.size !== before, value: [...next].sort() };
}

function cliRecordLooksPatchable(record: JsonRecord) {
  const clientId = readString(record.clientId)?.toLowerCase();
  const clientMode = readString(record.clientMode)?.toLowerCase();
  const platform = readString(record.platform)?.toLowerCase();
  const tokens = asRecord(record.tokens);
  return clientId === "cli"
    || clientMode === "cli"
    || (platform === "linux" && Boolean(tokens?.operator));
}

function addScopesToTokenState(tokens: unknown, scopes: string[]) {
  let changed = false;
  if (Array.isArray(tokens)) {
    for (const token of tokens) {
      const record = asRecord(token);
      if (!record || readString(record.role) !== "operator") continue;
      const next = uniqueScopeArray(record.scopes, scopes);
      record.scopes = next.value;
      changed = changed || next.changed;
    }
    return changed;
  }
  const tokenRecord = asRecord(tokens);
  const operator = asRecord(tokenRecord?.operator);
  if (!operator) return false;
  const next = uniqueScopeArray(operator.scopes, scopes);
  operator.scopes = next.value;
  return next.changed;
}

function isCliPendingRequest(record: JsonRecord) {
  return readString(record.clientId)?.toLowerCase() === "cli"
    || readString(record.clientMode)?.toLowerCase() === "cli";
}

function hasIsolatedStateMarker(stateDir: string) {
  const markerPath = path.join(stateDir, ISOLATED_STATE_MARKER_FILE);
  if (!fs.existsSync(markerPath)) return false;
  try {
    const marker = asRecord(JSON.parse(fs.readFileSync(markerPath, "utf8")));
    return readString(marker?.kind) === ISOLATED_STATE_MARKER_KIND;
  } catch {
    return false;
  }
}

export function grantIsolatedE2eCliAdmin(stateDir: string, scopes = ISOLATED_E2E_ADMIN_SCOPES) {
  if (!hasIsolatedStateMarker(stateDir)) {
    return { ok: false, reason: "isolated Gateway state marker missing", changed: false, removedPending: 0 };
  }
  const pairedPath = path.join(stateDir, "devices", "paired.json");
  if (!fs.existsSync(pairedPath)) return { ok: false, reason: "paired state missing", changed: false, removedPending: 0 };
  const paired = asRecord(JSON.parse(fs.readFileSync(pairedPath, "utf8")));
  if (!paired) return { ok: false, reason: "paired state is not an object", changed: false, removedPending: 0 };

  const cliEntry = Object.entries(paired).find(([, value]) => {
    const record = asRecord(value);
    return record ? cliRecordLooksPatchable(record) : false;
  });
  if (!cliEntry) return { ok: false, reason: "CLI device not found", changed: false, removedPending: 0 };

  const [deviceId, device] = cliEntry;
  const record = asRecord(device);
  if (!record) return { ok: false, reason: "CLI device state is not an object", changed: false, removedPending: 0 };

  let changed = false;
  for (const key of ["scopes", "approvedScopes"] as const) {
    const next = uniqueScopeArray(record[key], scopes);
    record[key] = next.value;
    changed = changed || next.changed;
  }
  changed = addScopesToTokenState(record.tokens, scopes) || changed;
  if (changed) fs.writeFileSync(pairedPath, `${JSON.stringify(paired, null, 2)}\n`);

  const pendingPath = path.join(stateDir, "devices", "pending.json");
  let removedPending = 0;
  if (fs.existsSync(pendingPath)) {
    const pending = asRecord(JSON.parse(fs.readFileSync(pendingPath, "utf8")));
    if (pending) {
      for (const [requestId, request] of Object.entries(pending)) {
        const pendingRecord = asRecord(request);
        if (!pendingRecord || !isCliPendingRequest(pendingRecord)) continue;
        delete pending[requestId];
        removedPending += 1;
      }
      if (removedPending > 0) fs.writeFileSync(pendingPath, `${JSON.stringify(pending, null, 2)}\n`);
    }
  }

  return {
    ok: true,
    changed,
    deviceId,
    removedPending,
    scopes,
  };
}

function readNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative number.`);
  return Math.floor(parsed);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const openclawArgs: string[] = [];
  const openclawGlobalArgs: string[] = [];
  let allowNonEvenG2 = false;
  let dryRun = false;
  let e2eIsolatedStateDir = "";
  let watchMs: number | null = null;
  let pollMs = DEFAULT_POLL_MS;
  let settleMs = DEFAULT_SETTLE_MS;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--allow-non-even-g2") {
      allowNonEvenG2 = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--e2e-isolated-state-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--e2e-isolated-state-dir requires a value.");
      e2eIsolatedStateDir = path.resolve(value);
      index += 1;
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
    } else if (arg === "--settle-ms") {
      const value = argv[index + 1];
      if (!value) throw new Error("--settle-ms requires a value.");
      settleMs = readNumber(value, "--settle-ms");
      index += 1;
    } else if (arg === "--openclaw-container") {
      const value = argv[index + 1];
      if (!value) throw new Error("--openclaw-container requires a value.");
      openclawGlobalArgs.push("--container", value);
      index += 1;
    } else if (arg === "--openclaw-profile") {
      const value = argv[index + 1];
      if (!value) throw new Error("--openclaw-profile requires a value.");
      openclawGlobalArgs.push("--profile", value);
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
  return { allowNonEvenG2, dryRun, e2eIsolatedStateDir, openclawArgs, openclawGlobalArgs, pollMs, settleMs, watchMs };
}

function runOpenClaw(openclawGlobalArgs: string[], commandArgs: string[], allowExitOne = false): CommandResult {
  try {
    const stdout = execFileSync("openclaw", [...openclawGlobalArgs, ...commandArgs], {
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

export function isEvenG2Request(request: PendingRequest): boolean {
  const displayName = request.displayName?.toLowerCase() || "";
  const platform = request.platform?.toLowerCase() || "";
  const clientId = request.clientId?.toLowerCase() || "";
  const deviceFamily = request.deviceFamily?.toLowerCase() || "";
  const caps = new Set((request.caps || []).map((cap) => cap.toLowerCase()));
  const commands = new Set((request.commands || []).map((command) => command.toLowerCase()));
  const hasEvenG2NodeSurface = [...commands].some((command) => EVEN_G2_NODE_COMMANDS.has(command))
    || [...caps].some((cap) => EVEN_G2_NODE_CAPS.has(cap));
  return platform === "even-g2"
    || clientId === "openclaw-even-g2-node"
    || displayName === "even g2"
    || displayName.includes("even g2")
    || (clientId === "node-host" && deviceFamily === "glasses" && hasEvenG2NodeSurface);
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

function previewLatestDevice(openclawGlobalArgs: string[], openclawArgs: string[]): PendingRequest | null {
  const result = runOpenClaw(openclawGlobalArgs, ["devices", "approve", "--latest", "--json", ...openclawArgs], true);
  return parseDevicePreview(`${result.stdout}\n${result.stderr}`);
}

function listPendingDevices(openclawGlobalArgs: string[], openclawArgs: string[]): PendingRequest[] {
  const result = runOpenClaw(openclawGlobalArgs, ["devices", "list", "--json", ...openclawArgs], true);
  const listed = parseDevicePendingList(result.stdout);
  if (listed.length > 0) return listed;
  const preview = previewLatestDevice(openclawGlobalArgs, openclawArgs);
  return preview ? [preview] : [];
}

function listPendingNodes(openclawGlobalArgs: string[], openclawArgs: string[]): PendingRequest[] {
  const pendingResult = runOpenClaw(openclawGlobalArgs, ["nodes", "pending", "--json", ...openclawArgs], true);
  const statusResult = runOpenClaw(openclawGlobalArgs, ["nodes", "status", "--json", ...openclawArgs], true);
  return [
    ...parseNodePendingList(pendingResult.stdout),
    ...parseNodeStatusPending(statusResult.stdout),
  ];
}

function approveRequest(request: PendingRequest, openclawGlobalArgs: string[], openclawArgs: string[]): "approved" | "stale" {
  const command = request.kind === "device" ? "devices" : "nodes";
  const args = [...openclawGlobalArgs, command, "approve", request.requestId, "--json", ...openclawArgs];
  try {
    const stdout = execFileSync("openclaw", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (stdout.trim()) process.stdout.write(redactText(stdout));
    return "approved";
  } catch (error) {
    const cause = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const output = `${cause.stdout || ""}\n${cause.stderr || ""}\n${cause.message || ""}`;
    if (/unknown requestId|unknown .*id|not found|expired/i.test(output)) return "stale";
    throw new Error(redactText(output.trim()) || "openclaw approval command failed");
  }
}

function approvalNeedsIsolatedAdmin(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /operator\.admin|role-management-requires-admin|device pairing approval denied|missing scope|scope upgrade pending approval|asking for more scopes/i.test(message);
}

function actionLine(request: PendingRequest, dryRun: boolean): string {
  const command = `openclaw ${request.kind === "device" ? "devices" : "nodes"} approve ${request.requestId}`;
  return `${dryRun ? "[dry-run]" : "[approve]"} ${formatRequest(request)}\n  ${command}`;
}

export function shouldStopAfterSettle(input: {
  lastActivityAt: number | null;
  now: number;
  settleMs: number;
  sawNewEvenG2Request: boolean;
}) {
  return !input.sawNewEvenG2Request
    && input.lastActivityAt !== null
    && input.now - input.lastActivityAt >= input.settleMs;
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
  let lastActivityAt: number | null = null;
  let isolatedAdminGranted = false;
  let isolatedAdminWarningPrinted = false;

  const maybeGrantIsolatedAdmin = () => {
    if (!args.e2eIsolatedStateDir || isolatedAdminGranted) return false;
    const result = grantIsolatedE2eCliAdmin(args.e2eIsolatedStateDir);
    if (result.ok) {
      isolatedAdminGranted = true;
      console.log(`[isolated-e2e] CLI admin scopes ready for ${String(result.deviceId).slice(0, 12)}; removedPending=${result.removedPending}`);
      return true;
    }
    if (!isolatedAdminWarningPrinted) {
      isolatedAdminWarningPrinted = true;
      console.log(`[isolated-e2e] CLI admin scopes not ready yet: ${result.reason}`);
    }
    return false;
  };

  console.log(args.dryRun ? "Previewing Even G2 pairing approvals." : "Approving Even G2 pairing approvals.");
  if (!args.dryRun && watchMs > 0) console.log(`Watching for ${watchMs}ms.`);
  if (!args.dryRun) maybeGrantIsolatedAdmin();

  do {
    if (!args.dryRun) maybeGrantIsolatedAdmin();
    let sawNewEvenG2Request = false;
    for (const device of listPendingDevices(args.openclawGlobalArgs, args.openclawArgs)) {
      if (seen.has(`${device.kind}:${device.requestId}`)) continue;
      seen.add(`${device.kind}:${device.requestId}`);
      if (isEvenG2Request(device) || args.allowNonEvenG2) {
        sawNewEvenG2Request = true;
        console.log(actionLine(device, args.dryRun));
        printedCount += 1;
        if (!args.dryRun) {
          let result: "approved" | "stale";
          try {
            result = approveRequest(device, args.openclawGlobalArgs, args.openclawArgs);
          } catch (error) {
            if (!args.e2eIsolatedStateDir || !approvalNeedsIsolatedAdmin(error) || !maybeGrantIsolatedAdmin()) throw error;
            result = approveRequest(device, args.openclawGlobalArgs, args.openclawArgs);
          }
          if (result === "approved") approvedCount += 1;
          else {
            staleCount += 1;
            console.log(`[skip] ${device.kind}:${device.requestId} disappeared before approval.`);
          }
          lastActivityAt = Date.now();
        }
      } else {
        blockedByOtherDevice = true;
        console.log(`[skip] newest pending device is not Even G2: ${formatRequest(device)}`);
      }
    }

    for (const node of listPendingNodes(args.openclawGlobalArgs, args.openclawArgs)) {
      if (seen.has(`${node.kind}:${node.requestId}`)) continue;
      seen.add(`${node.kind}:${node.requestId}`);
      if (!isEvenG2Request(node) && !args.allowNonEvenG2) {
        console.log(`[skip] pending node is not Even G2: ${formatRequest(node)}`);
        continue;
      }
      sawNewEvenG2Request = true;
      console.log(actionLine(node, args.dryRun));
      printedCount += 1;
      if (!args.dryRun) {
        let result: "approved" | "stale";
        try {
          result = approveRequest(node, args.openclawGlobalArgs, args.openclawArgs);
        } catch (error) {
          if (!args.e2eIsolatedStateDir || !approvalNeedsIsolatedAdmin(error) || !maybeGrantIsolatedAdmin()) throw error;
          result = approveRequest(node, args.openclawGlobalArgs, args.openclawArgs);
        }
        if (result === "approved") approvedCount += 1;
        else {
          staleCount += 1;
          console.log(`[skip] ${node.kind}:${node.requestId} disappeared before approval.`);
        }
        lastActivityAt = Date.now();
      }
    }

    if (args.dryRun || Date.now() >= deadline) break;
    if (shouldStopAfterSettle({
      lastActivityAt,
      now: Date.now(),
      settleMs: args.settleMs,
      sawNewEvenG2Request,
    })) {
      console.log(`No new Even G2 approvals for ${args.settleMs}ms; finishing early.`);
      break;
    }
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
