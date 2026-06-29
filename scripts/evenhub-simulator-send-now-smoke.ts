import {
  assertCaptureLooksVisible,
  captureSimulator,
  fetchSimulator,
  sendSimulatorInput,
  simulatorConsoleText,
} from "./simulator-utils.js";

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

async function waitForConsoleMarker(marker: string, timeoutMs: number, baseline = "") {
  const startedAt = Date.now();
  let lastConsole = "";
  while (Date.now() - startedAt < timeoutMs) {
    lastConsole = await simulatorConsoleText(BASE_URL);
    const freshConsole = baseline && lastConsole.startsWith(baseline)
      ? lastConsole.slice(baseline.length)
      : lastConsole;
    if (freshConsole.includes(marker)) return freshConsole;
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

async function main() {
  const beforeCapture = await assertSimulatorReady();
  const initialCapture = beforeCapture;

  const listenBaseline = await simulatorConsoleText(BASE_URL);
  await sendSimulatorInput(BASE_URL, "click");
  await waitForConsoleMarker("\"action\":\"voice-listening\"", 8_000, listenBaseline);
  await sleep(RECORD_MS);

  const recordingCapture = await captureSimulator(BASE_URL, OUT_DIR, "send-now-recording");
  assertCaptureLooksVisible(recordingCapture);

  const sendBaseline = await simulatorConsoleText(BASE_URL);
  await sendSimulatorInput(BASE_URL, "click");
  const consoleText = await waitForConsoleMarker("\"action\":\"session-voice-sent\"", TIMEOUT_MS, sendBaseline);
  await sleep(750);
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
    captures: {
      before: beforeCapture.reviewPath,
      initial: initialCapture.reviewPath,
      recording: recordingCapture.reviewPath,
      final: finalCapture.reviewPath,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
