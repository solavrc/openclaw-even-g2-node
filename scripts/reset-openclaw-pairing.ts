import { execFileSync } from "node:child_process";

type JsonRecord = Record<string, unknown>;

type OpenClawList<T extends JsonRecord> = {
  pending?: T[];
  paired?: T[];
};

type ResetTarget = {
  kind: "device" | "node" | "device-request" | "node-request";
  id: string;
  displayName: string;
  platform: string;
  clientId: string;
  connected?: boolean;
};

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function runJson<T>(commandArgs: string[]): T {
  const raw = execFileSync("openclaw", commandArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(raw) as T;
}

function isEvenG2Entry(entry: JsonRecord) {
  return readString(entry.platform) === "even-g2"
    || readString(entry.clientId) === "node-host"
    || (readString(entry.displayName) === "Even G2" && readString(entry.deviceFamily) === "glasses");
}

function deviceTarget(entry: JsonRecord): ResetTarget | null {
  if (!isEvenG2Entry(entry)) return null;
  const id = readString(entry.deviceId);
  if (!id) return null;
  return {
    kind: "device",
    id,
    displayName: readString(entry.displayName) || "-",
    platform: readString(entry.platform) || "-",
    clientId: readString(entry.clientId) || "-",
  };
}

function nodeTarget(entry: JsonRecord): ResetTarget | null {
  if (!isEvenG2Entry(entry)) return null;
  const id = readString(entry.nodeId);
  if (!id) return null;
  return {
    kind: "node",
    id,
    displayName: readString(entry.displayName) || "-",
    platform: readString(entry.platform) || "-",
    clientId: readString(entry.clientId) || "-",
    connected: readBoolean(entry.connected),
  };
}

function pendingDeviceTarget(entry: JsonRecord): ResetTarget | null {
  if (!isEvenG2Entry(entry)) return null;
  const id = readString(entry.requestId);
  if (!id) return null;
  return {
    kind: "device-request",
    id,
    displayName: readString(entry.displayName) || "-",
    platform: readString(entry.platform) || "-",
    clientId: readString(entry.clientId) || "-",
  };
}

function pendingNodeTarget(entry: JsonRecord): ResetTarget | null {
  if (!isEvenG2Entry(entry)) return null;
  const id = readString(entry.requestId);
  if (!id) return null;
  return {
    kind: "node-request",
    id,
    displayName: readString(entry.displayName) || "-",
    platform: readString(entry.platform) || "-",
    clientId: readString(entry.clientId) || "-",
  };
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 12)}...` : id;
}

function commandFor(target: ResetTarget) {
  if (target.kind === "node") return ["nodes", "remove", "--node", target.id, "--json"];
  if (target.kind === "device") return ["devices", "remove", target.id, "--json"];
  if (target.kind === "node-request") return ["nodes", "reject", target.id, "--json"];
  return ["devices", "reject", target.id, "--json"];
}

function describe(target: ResetTarget) {
  const connected = target.connected === undefined ? "" : ` connected=${target.connected}`;
  return `${target.kind} ${shortId(target.id)} name=${target.displayName} platform=${target.platform} clientId=${target.clientId}${connected}`;
}

function removeTarget(target: ResetTarget) {
  const commandArgs = commandFor(target);
  const printable = `openclaw ${commandArgs.join(" ")}`;
  if (dryRun) {
    console.log(`[dry-run] ${printable}`);
    return;
  }
  console.log(`[remove] ${describe(target)}`);
  try {
    const stdout = execFileSync("openclaw", commandArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (stdout.trim()) console.log(stdout.trim());
  } catch (error) {
    const cause = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const output = `${cause.stdout || ""}\n${cause.stderr || ""}\n${cause.message || ""}`;
    if (/unknown .*id|not found|no .*found/i.test(output)) {
      console.log(`[skip] ${describe(target)} was already removed.`);
      return;
    }
    throw error;
  }
}

const nodes = runJson<OpenClawList<JsonRecord>>(["nodes", "list", "--json"]);
const devices = runJson<OpenClawList<JsonRecord>>(["devices", "list", "--json"]);
const pendingNodeTargets = (nodes.pending || []).map(pendingNodeTarget).filter((target): target is ResetTarget => Boolean(target));
const pendingDeviceTargets = (devices.pending || []).map(pendingDeviceTarget).filter((target): target is ResetTarget => Boolean(target));
const nodeTargets = (nodes.paired || []).map(nodeTarget).filter((target): target is ResetTarget => Boolean(target));
const deviceTargets = (devices.paired || []).map(deviceTarget).filter((target): target is ResetTarget => Boolean(target));
const targets = [...pendingNodeTargets, ...pendingDeviceTargets, ...nodeTargets, ...deviceTargets];

if (!targets.length) {
  console.log("No paired Even G2 OpenClaw node/device entries found.");
  process.exit(0);
}

console.log("Even G2 OpenClaw pairing reset");
console.log("Close the Even Hub app or simulator first, otherwise it may reconnect immediately.");
console.log("");
for (const target of targets) console.log(`- ${describe(target)}`);
console.log("");

for (const target of targets) removeTarget(target);

if (dryRun) {
  console.log("");
  console.log("Dry run only. Run `pnpm dev:reset-pairing` to remove these OpenClaw pairings.");
}
