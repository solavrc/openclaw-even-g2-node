import {
  assertCaptureLooksVisible,
  captureSimulator,
  sendSimulatorInput,
  simulatorConsoleText,
  type SimulatorCapture,
} from "./simulator-utils.js";

type SimFlow = "auto" | "setup" | "rootExit" | "session" | "sessionSelector" | "voiceReview" | "canvas" | "canvasTutorial" | "approval" | "recovery" | "storeChat" | "storeVoice" | "sendNow";

const BASE_URL = process.env.EVENG2_SIMULATOR_URL || "http://127.0.0.1:9898";
const OUT_DIR = process.env.EVENG2_SIMULATOR_OUT_DIR || "/tmp";
const FLOW = normalizeFlow(process.env.EVENG2_SIM_FLOW);
const SESSION_LIT_THRESHOLD = 3_500;

function normalizeFlow(value: string | undefined): SimFlow {
  if (
    value === "setup"
    || value === "rootExit"
    || value === "session"
    || value === "sessionSelector"
    || value === "voiceReview"
    || value === "canvas"
    || value === "canvasTutorial"
    || value === "approval"
    || value === "recovery"
    || value === "storeChat"
    || value === "storeVoice"
    || value === "sendNow"
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

function stepEvidence(name: string, capture: SimulatorCapture, action?: string) {
  return {
    name,
    ...(action ? { action } : {}),
    litPixels: capture.litPixels,
    reviewPath: capture.reviewPath,
    webviewPath: capture.webviewPath,
  };
}

async function inputAndCapture(action: Parameters<typeof sendSimulatorInput>[1], label: string) {
  await sendSimulatorInput(BASE_URL, action);
  await sleep(500);
  return captureStep(label);
}

async function waitForConsoleText(pattern: string, timeoutMs: number, baseline = "") {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  while (Date.now() < deadline) {
    lastText = await simulatorConsoleText(BASE_URL);
    const freshText = baseline && lastText.startsWith(baseline)
      ? lastText.slice(baseline.length)
      : lastText;
    if (freshText.includes(pattern)) return freshText;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for simulator console pattern ${pattern}. Last console text:\n${lastText}`);
}

function parseLastE2eMarker(consoleText: string, marker: string) {
  const lines = consoleText.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] || "";
    const markerIndex = line.indexOf(marker);
    if (markerIndex < 0) continue;
    const jsonText = line.slice(markerIndex + marker.length).trim();
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function runSetupSmoke(initial: SimulatorCapture) {
  return {
    flow: "setup",
    steps: [
      stepEvidence("setup", initial),
    ],
  };
}

async function runRootExitSmoke(initial: SimulatorCapture) {
  const baseline = await simulatorConsoleText(BASE_URL);
  await sendSimulatorInput(BASE_URL, "double_click");
  const consoleText = await waitForConsoleText("root-exit-result", 5_000, baseline);
  const result = parseLastE2eMarker(consoleText, "[openclaw-even-g2-node:e2e:exit]");
  if (result?.action !== "root-exit-result" || result.exitMode !== 1 || result.ok !== true) {
    throw new Error(`Expected successful root exit result marker, got ${JSON.stringify(result)}`);
  }
  return {
    flow: "rootExit",
    steps: [
      stepEvidence("initial-root", initial),
      { name: "root-exit-confirmation", action: "double_click" },
    ],
  };
}

async function runSessionFlow(initial: SimulatorCapture) {
  if (initial.litPixels < SESSION_LIT_THRESHOLD) {
    throw new Error(`Expected session-like HUD with enough text, got litPixels=${initial.litPixels}`);
  }
  const previous = await inputAndCapture("up", "session-up");
  const latest = await inputAndCapture("down", "session-down");

  return {
    flow: "session",
    steps: [
      stepEvidence("initial-session", initial),
      stepEvidence("previous-turn", previous, "up"),
      stepEvidence("latest-turn", latest, "down"),
    ],
  };
}

async function runSessionSelectorFlow(initial: SimulatorCapture) {
  for (const expected of [
    "selector-flow-change-dispatched",
    "refresh-sessions",
    "switch-session",
    "eveng2.session.switch.applied",
    "transcript-snapshot",
  ]) {
    await waitForConsoleText(expected, 8_000);
  }
  await sleep(500);
  const switched = await captureStep("session-selector-switch");

  return {
    flow: "sessionSelector",
    steps: [
      stepEvidence("initial-session", initial),
      stepEvidence("phone-selector-switch", switched, "phone-select-change"),
    ],
  };
}

async function runVisualFixtureFlow(initial: SimulatorCapture, flow: Exclude<SimFlow, "auto" | "setup" | "session" | "sessionSelector">) {
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
  const steps = [stepEvidence(flow, initial)];
  if (flow === "voiceReview") {
    steps.push(stepEvidence("voice-review-send", await inputAndCapture("click", "voice-review-send"), "click"));
  } else if (flow === "canvas") {
    steps.push(stepEvidence("canvas-hide", await inputAndCapture("click", "canvas-hide"), "click"));
  } else if (flow === "canvasTutorial") {
    steps.push(stepEvidence("canvas-tutorial-skip", await inputAndCapture("click", "canvas-tutorial-skip"), "click"));
  } else if (flow === "approval") {
    steps.push(stepEvidence("approval-rerender", await inputAndCapture("up", "approval-rerender"), "up"));
    steps.push(stepEvidence("approval-allow", await inputAndCapture("click", "approval-allow"), "click"));
    const approvalConsole = await waitForConsoleText("eveng2.approval.resolve.ack", 5_000);
    if (!approvalConsole.includes("eveng2.approval.resolved")) {
      throw new Error("Expected approval resolved console marker after allow.");
    }
  } else if (flow === "storeChat") {
    steps.push(stepEvidence("store-chat-previous", await inputAndCapture("up", "store-chat-up"), "up"));
    steps.push(stepEvidence("store-chat-latest", await inputAndCapture("down", "store-chat-down"), "down"));
  } else if (flow === "storeVoice") {
    steps.push(stepEvidence("store-voice-cancel", await inputAndCapture("double_click", "store-voice-cancel"), "double_click"));
  } else if (flow === "sendNow") {
    steps.push(stepEvidence("send-now-cancel", await inputAndCapture("double_click", "send-now-cancel"), "double_click"));
  }
  return {
    flow,
    steps,
  };
}

async function main() {
  const initial = await captureStep("initial");
  const flow = FLOW === "auto"
    ? initial.litPixels >= SESSION_LIT_THRESHOLD ? "session" : "setup"
    : FLOW;
  const result = flow === "session"
    ? await runSessionFlow(initial)
    : flow === "sessionSelector"
      ? await runSessionSelectorFlow(initial)
    : flow === "rootExit"
      ? await runRootExitSmoke(initial)
    : flow === "setup"
      ? await runSetupSmoke(initial)
      : await runVisualFixtureFlow(initial, flow);
  console.log(JSON.stringify({ ok: true, baseUrl: BASE_URL, ...result }, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
