import { execFileSync } from "node:child_process";
import {
  assertCaptureLooksVisible,
  captureSimulator,
  fetchSimulator,
  sendSimulatorInput,
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
const NODE = process.env.EVENG2_VOICE_NODE || "Even G2";
const RECORD_MS = readPositiveInt(process.env.EVENG2_VOICE_RECORD_MS, 10_000);
const TIMEOUT_MS = readPositiveInt(process.env.EVENG2_VOICE_TIMEOUT_MS, 35_000);
const FINAL_LIT_PIXELS = readPositiveInt(process.env.EVENG2_VOICE_FINAL_LIT_PIXELS, 4_500);
const REQUIRE_PARTIAL = process.env.EVENG2_VOICE_REQUIRE_PARTIAL === "1";
const PARTIAL_LIT_PIXELS = readPositiveInt(process.env.EVENG2_VOICE_PARTIAL_LIT_PIXELS, 4_000);

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonFromOpenClaw<T>(raw: string): T {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error(`OpenClaw output did not include JSON:\n${raw}`);
  return JSON.parse(raw.slice(start)) as T;
}

function openClawGlobalArgs() {
  return [
    ...(process.env.EVENG2_VOICE_OPENCLAW_CONTAINER || process.env.EVENG2_E2E_OPENCLAW_CONTAINER
      ? ["--container", process.env.EVENG2_VOICE_OPENCLAW_CONTAINER || process.env.EVENG2_E2E_OPENCLAW_CONTAINER || ""]
      : []),
    ...(process.env.EVENG2_VOICE_OPENCLAW_PROFILE || process.env.EVENG2_E2E_OPENCLAW_PROFILE
      ? ["--profile", process.env.EVENG2_VOICE_OPENCLAW_PROFILE || process.env.EVENG2_E2E_OPENCLAW_PROFILE || ""]
      : []),
  ];
}

function openClawGatewayArgs() {
  return [
    ...(process.env.EVENG2_VOICE_OPENCLAW_URL || process.env.EVENG2_E2E_OPENCLAW_URL
      ? ["--url", process.env.EVENG2_VOICE_OPENCLAW_URL || process.env.EVENG2_E2E_OPENCLAW_URL || ""]
      : []),
    ...(process.env.EVENG2_VOICE_OPENCLAW_TOKEN || process.env.EVENG2_E2E_OPENCLAW_TOKEN
      ? ["--token", process.env.EVENG2_VOICE_OPENCLAW_TOKEN || process.env.EVENG2_E2E_OPENCLAW_TOKEN || ""]
      : []),
  ];
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

async function assertSimulatorReady() {
  const ping = await fetchSimulator(BASE_URL, "/api/ping");
  if (!ping.ok) throw new Error(`${BASE_URL}/api/ping returned ${ping.status}`);
  const capture = await captureSimulator(BASE_URL, OUT_DIR, "voice-smoke-before");
  assertCaptureLooksVisible(capture);
  return capture;
}

async function recoverToSessionHome(status: NodeInvokeResult) {
  const view = status.payload?.view;
  if (view === "sessionHome") return status;
  if (view === "listening" || view === "voiceDraft") {
    await sendSimulatorInput(BASE_URL, "double_click");
    return waitForView("sessionHome", 8_000);
  }
  throw new Error(`Voice smoke must start from sessionHome/listening/voiceDraft; current ${describeStatus(status)}`);
}

async function main() {
  const beforeCapture = await assertSimulatorReady();
  const initialStatus = await recoverToSessionHome(deviceStatus());

  await sendSimulatorInput(BASE_URL, "click");
  const listeningStatus = await waitForView("listening", 8_000);
  const midWaitMs = Math.max(2_000, Math.min(5_000, Math.floor(RECORD_MS / 2)));
  await sleep(midWaitMs);
  const midCapture = await captureSimulator(BASE_URL, OUT_DIR, "voice-smoke-recording");
  assertCaptureLooksVisible(midCapture);

  if (REQUIRE_PARTIAL && midCapture.litPixels < PARTIAL_LIT_PIXELS) {
    throw new Error([
      `Expected visible live partial transcript while recording, got litPixels=${midCapture.litPixels}.`,
      `reviewPath=${midCapture.reviewPath}`,
      "Set EVENG2_VOICE_REQUIRE_PARTIAL=0 when validating final-only providers.",
    ].join("\n"));
  }

  await sleep(Math.max(0, RECORD_MS - midWaitMs));
  await sendSimulatorInput(BASE_URL, "click");

  const startedAt = Date.now();
  let finalStatus: NodeInvokeResult | null = null;
  while (Date.now() - startedAt < TIMEOUT_MS) {
    finalStatus = deviceStatus();
    const view = finalStatus.payload?.view;
    if (view === "voiceDraft") break;
    if (view === "sessionHome") {
      const failureCapture = await captureSimulator(BASE_URL, OUT_DIR, "voice-smoke-failure");
      throw new Error([
        "Voice Review returned to sessionHome instead of voiceDraft.",
        "This usually means no usable transcript, provider setup failure, or capture cancellation.",
        `last ${describeStatus(finalStatus)}`,
        `reviewPath=${failureCapture.reviewPath}`,
      ].join("\n"));
    }
    await sleep(750);
  }

  if (finalStatus?.payload?.view !== "voiceDraft") {
    throw new Error(`Timed out waiting for voiceDraft; last ${finalStatus ? describeStatus(finalStatus) : "status unavailable"}`);
  }

  const finalCapture = await captureSimulator(BASE_URL, OUT_DIR, "voice-smoke-final");
  assertCaptureLooksVisible(finalCapture);
  if (finalCapture.litPixels < FINAL_LIT_PIXELS) {
    throw new Error([
      `Voice draft appeared too small to prove transcript text, litPixels=${finalCapture.litPixels}.`,
      `reviewPath=${finalCapture.reviewPath}`,
      `Raise/lower EVENG2_VOICE_FINAL_LIT_PIXELS if the local audio source is intentionally short.`,
    ].join("\n"));
  }

  console.log(JSON.stringify({
    ok: true,
    baseUrl: BASE_URL,
    node: NODE,
    recordMs: RECORD_MS,
    requirePartial: REQUIRE_PARTIAL,
    initial: describeStatus(initialStatus),
    listening: describeStatus(listeningStatus),
    final: describeStatus(finalStatus),
    captures: {
      before: beforeCapture.reviewPath,
      recording: midCapture.reviewPath,
      final: finalCapture.reviewPath,
    },
    litPixels: {
      before: beforeCapture.litPixels,
      recording: midCapture.litPixels,
      final: finalCapture.litPixels,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
