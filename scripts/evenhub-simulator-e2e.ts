import {
  assertCaptureLooksVisible,
  captureSimulator,
  simulatorConsoleText,
  type SimulatorCapture,
} from "./simulator-utils.js";

type SimFlow = "auto" | "setup" | "session" | "voiceReview" | "canvas" | "canvasTutorial" | "approval" | "recovery" | "storeChat" | "storeVoice";

const BASE_URL = process.env.EVENG2_SIMULATOR_URL || "http://127.0.0.1:9898";
const OUT_DIR = process.env.EVENG2_SIMULATOR_OUT_DIR || "/tmp";
const FLOW = normalizeFlow(process.env.EVENG2_SIM_FLOW);
const SESSION_LIT_THRESHOLD = 3_500;

function normalizeFlow(value: string | undefined): SimFlow {
  if (
    value === "setup"
    || value === "session"
    || value === "voiceReview"
    || value === "canvas"
    || value === "canvasTutorial"
    || value === "approval"
    || value === "recovery"
    || value === "storeChat"
    || value === "storeVoice"
  ) return value;
  return "auto";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureStep(label: string) {
  let lastCapture: SimulatorCapture | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const capture = await captureSimulator(BASE_URL, OUT_DIR, `e2e-${label}`);
      lastCapture = capture;
      assertCaptureLooksVisible(capture);
      return capture;
    } catch (error) {
      lastError = error;
      if (attempt === 12) break;
      await sleep(250);
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label} did not become visible after retries: ${detail}${lastCapture ? ` reviewPath=${lastCapture.reviewPath}` : ""}`);
}

async function runSetupSmoke(initial: SimulatorCapture) {
  return {
    flow: "setup",
    steps: [
      {
        name: "setup",
        litPixels: initial.litPixels,
        reviewPath: initial.reviewPath,
        webviewPath: initial.webviewPath,
      },
    ],
  };
}

async function runSessionFlow(initial: SimulatorCapture) {
  if (initial.litPixels < SESSION_LIT_THRESHOLD) {
    throw new Error(`Expected session-like HUD with enough text, got litPixels=${initial.litPixels}`);
  }

  return {
    flow: "session",
    steps: [
      {
        name: "initial-session",
        litPixels: initial.litPixels,
        reviewPath: initial.reviewPath,
        webviewPath: initial.webviewPath,
      },
    ],
  };
}

async function runVisualFixtureFlow(initial: SimulatorCapture, flow: Exclude<SimFlow, "auto" | "setup" | "session">) {
  const consoleText = await simulatorConsoleText(BASE_URL);
  const marker = `simFixture=${flow}`;
  if (!consoleText.includes(marker)) {
    throw new Error([
      `Expected simulator console marker ${marker}.`,
      "Start the simulator against the matching Vite dev fixture URL, for example:",
      `  pnpm simulator 'http://127.0.0.1:5174/?resetPairing=1&simFixture=${flow}' --automation-port 9898`,
    ].join("\n"));
  }
  if (initial.litPixels < 1_200) {
    throw new Error(`Expected visible ${flow} fixture HUD, got litPixels=${initial.litPixels}`);
  }
  return {
    flow,
    steps: [
      {
        name: flow,
        litPixels: initial.litPixels,
        reviewPath: initial.reviewPath,
        webviewPath: initial.webviewPath,
      },
    ],
  };
}

async function main() {
  const initial = await captureStep("initial");
  const flow = FLOW === "auto"
    ? initial.litPixels >= SESSION_LIT_THRESHOLD ? "session" : "setup"
    : FLOW;
  const result = flow === "session"
    ? await runSessionFlow(initial)
    : flow === "setup"
      ? await runSetupSmoke(initial)
      : await runVisualFixtureFlow(initial, flow);
  console.log(JSON.stringify({ ok: true, baseUrl: BASE_URL, ...result }, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
