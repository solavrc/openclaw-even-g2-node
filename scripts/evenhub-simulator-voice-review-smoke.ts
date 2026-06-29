import {
  assertCaptureLooksVisible,
  captureSimulator,
  fetchSimulator,
  sendSimulatorInput,
  simulatorConsoleText,
} from "./simulator-utils.js";

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
  const capture = await captureSimulator(BASE_URL, OUT_DIR, "voice-smoke-before");
  assertCaptureLooksVisible(capture);
  return capture;
}

async function main() {
  const beforeCapture = await assertSimulatorReady();
  const initialCapture = beforeCapture;

  const listenBaseline = await simulatorConsoleText(BASE_URL);
  await sendSimulatorInput(BASE_URL, "click");
  await waitForConsoleMarker("\"action\":\"voice-listening\"", 8_000, listenBaseline);
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
  const draftBaseline = await simulatorConsoleText(BASE_URL);
  await sendSimulatorInput(BASE_URL, "click");
  await waitForConsoleMarker("\"action\":\"voice-draft-ready\"", TIMEOUT_MS, draftBaseline);
  await sleep(750);

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
    captures: {
      before: beforeCapture.reviewPath,
      initial: initialCapture.reviewPath,
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
