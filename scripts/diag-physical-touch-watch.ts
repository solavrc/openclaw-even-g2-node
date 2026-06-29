import { spawnSync } from "node:child_process";

type JsonObject = Record<string, unknown>;

type NodeInfo = {
  nodeId: string;
  displayName: string;
  platform: string;
  connected: boolean;
};

type Snapshot = {
  view: string;
  text: string;
};

function objectValue(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function runOpenClaw(args: string[], timeoutMs = 5000): unknown {
  const result = spawnSync("openclaw", args, {
    encoding: "utf8",
    timeout: timeoutMs,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`openclaw ${args.join(" ")} failed: ${detail}`);
  }
  return parseJson(result.stdout);
}

function nodeFromValue(value: unknown): NodeInfo | null {
  const object = objectValue(value);
  if (!object) return null;
  const nodeId = stringValue(object.nodeId);
  const displayName = stringValue(object.displayName);
  const platform = stringValue(object.platform);
  if (!nodeId) return null;
  return {
    nodeId,
    displayName,
    platform,
    connected: booleanValue(object.connected),
  };
}

function connectedEvenG2Node(): NodeInfo {
  const payload = objectValue(runOpenClaw(["nodes", "list", "--json"]));
  const paired = Array.isArray(payload?.paired) ? payload.paired : [];
  const candidates = paired
    .map(nodeFromValue)
    .filter((node): node is NodeInfo => Boolean(node))
    .filter((node) => node.connected && node.platform === "even-g2");
  if (candidates.length === 0) {
    throw new Error("No connected Even G2 node found. Open the Even Hub app and confirm OpenClaw is connected.");
  }
  return candidates[0];
}

function snapshotForNode(nodeId: string): Snapshot {
  const result = objectValue(runOpenClaw([
    "nodes",
    "invoke",
    "--node",
    nodeId,
    "--command",
    "canvas.snapshot",
    "--params",
    "{}",
    "--timeout",
    "5000",
    "--json",
  ], 7000));
  const payload = objectValue(result?.payload);
  return {
    view: stringValue(payload?.view) || "?",
    text: stringValue(payload?.text).replace(/\n/g, " | "),
  };
}

function statusForNode(nodeId: string): string {
  const result = objectValue(runOpenClaw([
    "nodes",
    "invoke",
    "--node",
    nodeId,
    "--command",
    "device.status",
    "--params",
    "{}",
    "--timeout",
    "5000",
    "--json",
  ], 7000));
  const payload = objectValue(result?.payload);
  const view = stringValue(payload?.view) || "?";
  const session = stringValue(payload?.activeSessionKey) || "?";
  const listening = booleanValue(payload?.listening) ? "listening" : "not-listening";
  return `${view} ${session} ${listening}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main(): Promise<void> {
  const durationMs = Number.parseInt(process.env.EVENG2_TOUCH_WATCH_MS || "60000", 10);
  const intervalMs = Number.parseInt(process.env.EVENG2_TOUCH_WATCH_INTERVAL_MS || "1000", 10);
  const node = connectedEvenG2Node();
  const deadline = Date.now() + Math.max(1000, durationMs);
  let previous = "";

  console.log(`Watching ${node.displayName || "Even G2"} (${node.nodeId}) for ${Math.max(1000, durationMs)}ms.`);
  console.log("Use the glasses: down, up, tap, tap, tap.");

  while (Date.now() < deadline) {
    const snapshot = snapshotForNode(node.nodeId);
    const status = statusForNode(node.nodeId);
    const line = `${snapshot.view}: ${status}: ${snapshot.text.slice(0, 240)}`;
    if (line !== previous) {
      console.log(`[${new Date().toLocaleTimeString()}] ${line}`);
      previous = line;
    }
    await sleep(Math.max(250, intervalMs));
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
