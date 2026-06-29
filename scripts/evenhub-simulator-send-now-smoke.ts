import { execFileSync } from "node:child_process";
import {
  assertCaptureLooksVisible,
  captureSimulator,
  fetchSimulator,
  sendSimulatorInput,
  simulatorConsoleText,
} from "./simulator-utils.js";

type DeviceStatusPayload = {
  view?: string;
  listening?: boolean;
  activeSessionKey?: string;
};

type NodeInvokeResult = {
  ok?: boolean;
  payload?: DeviceStatusPayload;
};

const BASE_URL = process.env.EVENG2_SIMULATOR_URL || "http://127.0.0.1:9898";
const OUT_DIR = process.env.EVENG2_SIMULATOR_OUT_DIR || "/tmp";
const NODE = process.env.EVENG2_SEND_NOW_NODE || process.env.EVENG2_VOICE_NODE || "Even G2";
const RECORD_MS = readPositiveInt(process.env.EVENG2_SEND_NOW_RECORD_MS || process.env.EVENG2_VOICE_RECORD_MS, 10_000);
const TIMEOUT_MS = readPositiveInt(process.env.EVENG2_SEND_NOW_TIMEOUT_MS || process.env.EVENG2_VOICE_TIMEOUT_MS, 35_000);

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openClawGlobalArgs() {
  return [
    ...(process.env.EVENG2_SEND_NOW_OPENCLAW_CONTAINER || process.env.EVENG2_VOICE_OPENCLAW_CONTAINER || process.env.EVENG2_E2E_OPENCLAW_CONTAINER
      ? ["--container", process.env.EVENG2_SEND_NOW_OPENCLAW_CONTAINER || process.env.EVENG2_VOICE_OPENCLAW_CONTAINER || process.env.EVENG2_E2E_OPENCLAW_CONTAINER || ""]
      : []),
    ...(process.env.EVENG2_SEND_NOW_OPENCLAW_PROFILE || process.env.EVENG2_VOICE_OPENCLAW_PROFILE || process.env.EVENG2_E2E_OPENCLAW_PROFILE
      ? ["--profile", process.env.EVENG2_SEND_NOW_OPENCLAW_PROFILE || process.env.EVENG2_VOICE_OPENCLAW_PROFILE || process.env.EVENG2_E2E_OPENCLAW_PROFILE || ""]
      : []),
  ];
}

function openClawGatewayArgs() {
  return [
    ...(process.env.EVENG2_SEND_NOW_OPENCLAW_URL || process.env.EVENG2_VOICE_OPENCLAW_URL || process.env.EVENG2_E2E_OPENCLAW_URL
      ? ["--url", process.env.EVENG2_SEND_NOW_OPENCLAW_URL || process.env.EVENG2_VOICE_OPENCLAW_URL || process.env.EVENG2_E2E_OPENCLAW_URL || ""]
      : []),
    ...(process.env.EVENG2_SEND_NOW_OPENCLAW_TOKEN || process.env.EVENG2_VOICE_OPENCLAW_TOKEN || process.env.EVENG2_E2E_OPENCLAW_TOKEN
      ? ["--token", process.env.EVENG2_SEND_NOW_OPENCLAW_TOKEN || process.env.EVENG2_VOICE_OPENCLAW_TOKEN || process.env.EVENG2_E2E_OPENCLAW_TOKEN || ""]
      : []),
  ];
}

function parseJsonFromOpenClaw<T>(raw: string): T {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error(`OpenClaw output did not include JSON:\n${raw}`);
  return JSON.parse(raw.slice(start)) as T;
}

function deviceStatus(): NodeInvokeResult {
  const raw = execFileSync("openclaw", [
    ...openClawGlobalArgs(),
    "nodes",
    "invoke",
    "--node",
    NODE,
    "--command",
    "device.status",
    "--json",
    ...openClawGatewayArgs(),
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseJsonFromOpenClaw<NodeInvokeResult>(raw);
}

function describeStatus(status: NodeInvokeResult) {
  const payload = status.payload || {};
  return `view=${payload.view || "-"} listening=${payload.listening === true} session=${payload.activeSessionKey || "-"}`;
}

async function waitForView(view: string, timeoutMs: number) {
  const startedAt = Date.now();
  let lastStatus: NodeInvokeResult | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastStatus = deviceStatus();
    if (lastStatus.payload?.view === view) return lastStatus;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${view}; last ${lastStatus ? describeStatus(lastStatus) : "status unavailable"}`);
}

async function waitForConsoleMarker(marker: string, timeoutMs: number) {
  const startedAt = Date.now();
  let lastConsole = "";
  while (Date.now() - startedAt < timeoutMs) {
    lastConsole = await simulatorConsoleText(BASE_URL);
    if (lastConsole.includes(marker)) return lastConsole;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for simulator console marker ${marker}.\nLast console:\n${lastConsole}`);
}

async function assertSimulatorReady() {
  const ping = await fetchSimulator(BASE_URL, "/api/ping");
  if (!ping.ok) throw new Error(`${BASE_URL}/api/ping returned ${ping.status}`);
  const capture = await captureSimulator(BASE_URL, OUT_DIR, "send-now-before");
  assertCaptureLooksVisible(capture);
  return capture;
}

async function recoverToSessionHome(status: NodeInvokeResult) {
  const view = status.payload?.view;
  if (view === "sessionHome") return status;
  if (view === "listening" || view === "voiceDraft" || view === "voiceDraftPending") {
    await sendSimulatorInput(BASE_URL, "double_click");
    return waitForView("sessionHome", 8_000);
  }
  throw new Error(`Send now smoke must start from sessionHome/listening/voiceDraft; current ${describeStatus(status)}`);
}

async function main() {
  const beforeCapture = await assertSimulatorReady();
  const initialStatus = await recoverToSessionHome(deviceStatus());

  await sendSimulatorInput(BASE_URL, "click");
  const listeningStatus = await waitForView("listening", 8_000);
  await waitForConsoleMarker("\"action\":\"voice-listening\"", 8_000);
  await sleep(RECORD_MS);

  const recordingCapture = await captureSimulator(BASE_URL, OUT_DIR, "send-now-recording");
  assertCaptureLooksVisible(recordingCapture);

  await sendSimulatorInput(BASE_URL, "click");
  const consoleText = await waitForConsoleMarker("\"action\":\"session-voice-sent\"", TIMEOUT_MS);
  const finalStatus = await waitForView("sessionHome", 8_000);
  const finalCapture = await captureSimulator(BASE_URL, OUT_DIR, "send-now-final");
  assertCaptureLooksVisible(finalCapture);

  if (!consoleText.includes("\"mode\":\"direct\"")) {
    throw new Error("Send now smoke saw session-voice-sent, but not direct-mode evidence. Start the app with e2eVoiceMode=direct.");
  }

  console.log(JSON.stringify({
    ok: true,
    baseUrl: BASE_URL,
    node: NODE,
    recordMs: RECORD_MS,
    initial: describeStatus(initialStatus),
    listening: describeStatus(listeningStatus),
    final: describeStatus(finalStatus),
    captures: {
      before: beforeCapture.reviewPath,
      recording: recordingCapture.reviewPath,
      final: finalCapture.reviewPath,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
