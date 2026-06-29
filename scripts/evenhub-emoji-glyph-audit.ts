import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import {
  documentedEvenG2GlyphsText,
  isDocumentedEvenG2TextGlyph,
} from "../src/glass-glyphs.ts";
import {
  assertCaptureLooksVisible,
  captureSimulator,
  fetchSimulator,
} from "./simulator-utils.ts";

type Candidate = {
  label: string;
  text: string;
  codePoints: number[];
};

type CandidateResult = Candidate & {
  documentedGlyphProbe: boolean;
  missingCodePoints: string[];
  needsVisualReview: boolean;
  reviewPath: string;
  supported: boolean;
};

const OUT_DIR = process.env.EVENG2_SIMULATOR_OUT_DIR || "/tmp";
const REPORT_PATH = path.join(process.cwd(), ".openclaw-even-g2-node", "emoji-glyph-report.json");
const IGNORED_MODIFIER_CODE_POINTS = new Set([0x200D, 0xFE0E, 0xFE0F]);

const REPRESENTATIVE_EMOJI = [
  "☀", "☀️", "★", "☆", "♡", "♥", "❤", "❤️", "▶", "▶️", "◀", "◀️", "□", "■", "○", "●",
  "⚙", "⚙️", "⚠", "⚠️", "☑", "✅", "❌", "⭕", "🔌", "🔊", "🪢", "👍", "😊", "😂", "🙏", "🔥",
  "🍎", "🚀", "🇯🇵", "1️⃣", "#️⃣",
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a local port.")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function spawnProcess(command: string, args: string[], options: SpawnOptions = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  child.on("error", (error) => {
    process.stderr.write(`${command} ${args.join(" ")} failed to start: ${error.message}\n`);
  });
  child.stdout?.resume();
  return child;
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Best effort cleanup.
    }
  }
}

async function stopProcess(child: ChildProcess | null) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signalProcessGroup(child, "SIGKILL");
      resolve();
    }, 2_500);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    signalProcessGroup(child, "SIGTERM");
  });
}

async function waitForHttp(url: string, timeoutMs = 20_000) {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = new Error(`${url} returned ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForSimulator(baseUrl: string) {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < 25_000) {
    try {
      const res = await fetchSimulator(baseUrl, "/api/ping");
      if (res.ok) return;
      lastError = new Error(`ping returned ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(350);
  }
  throw new Error(`Timed out waiting for simulator at ${baseUrl}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function codePointLabel(codePoint: number) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

function candidateFromText(text: string): Candidate {
  const codePoints = [...text].map((char) => char.codePointAt(0)).filter((value): value is number => value !== undefined);
  return {
    label: codePoints.map(codePointLabel).join(" "),
    text,
    codePoints,
  };
}

function uniqueCandidates(values: string[]) {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const value of values) {
    if (!value || !value.trim() || seen.has(value)) continue;
    seen.add(value);
    candidates.push(candidateFromText(value));
  }
  return candidates;
}

function graphemeClusters(text: string) {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return [...segmenter.segment(text)].map((segment) => segment.segment).filter(Boolean);
  }
  return [...text];
}

function parseArgs(argv: string[]) {
  const explicit: string[] = [];
  let includeDocumented = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--text") {
      const value = argv[index + 1] || "";
      index += 1;
      explicit.push(...graphemeClusters(value));
    } else if (arg === "--no-documented") {
      includeDocumented = false;
    } else if (arg === "--help") {
      console.log([
        "Usage: pnpm sim:emoji-glyphs [-- --text '⚙️♡👍' --no-documented]",
        "",
        "Starts Vite and the Even Hub simulator, renders candidate glyphs on the glasses,",
        `and writes ${REPORT_PATH}.`,
      ].join("\n"));
      process.exit(0);
    }
  }
  const values = [
    ...REPRESENTATIVE_EMOJI,
    ...(includeDocumented ? [...documentedEvenG2GlyphsText()].filter((char) => /[^\x20-\x7E]/.test(char)) : []),
    ...explicit,
  ];
  return uniqueCandidates(values);
}

function probeText(candidate: Candidate) {
  return [
    "Emoji glyph probe",
    "",
    `${candidate.text} ${candidate.label}`,
    "",
    "LVGL missing-glyph warnings decide support.",
  ].join("\n");
}

function missingGlyphLabels(stderr: string) {
  return new Set([...stderr.matchAll(/glyph dsc\. not found for U\+([0-9A-F]+)/gi)].map((match) => `U+${match[1].toUpperCase()}`));
}

async function runCandidate(candidate: Candidate, appPort: number): Promise<CandidateResult> {
  const simulatorPort = await freePort();
  let simulator: ChildProcess | null = null;
  let stderr = "";
  try {
    const text = probeText(candidate);
    const appUrl = `http://127.0.0.1:${appPort}/?resetPairing=1&simFixture=emojiProbe&emojiText=${encodeURIComponent(text)}`;
    simulator = spawnProcess("pnpm", ["simulator", appUrl, "--automation-port", String(simulatorPort)]);
    simulator.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    await waitForSimulator(`http://127.0.0.1:${simulatorPort}`);
    await sleep(1_200);
    const capture = await captureSimulator(`http://127.0.0.1:${simulatorPort}`, OUT_DIR, `emoji-${candidate.label.replace(/[^A-Z0-9]+/g, "-")}`);
    assertCaptureLooksVisible(capture);
    const missing = missingGlyphLabels(stderr);
    const visibleCodePoints = candidate.codePoints
      .filter((codePoint) => !IGNORED_MODIFIER_CODE_POINTS.has(codePoint))
      .map(codePointLabel);
    const missingCodePoints = visibleCodePoints.filter((label) => missing.has(label));
    const documentedGlyphProbe = candidate.codePoints
      .filter((codePoint) => !IGNORED_MODIFIER_CODE_POINTS.has(codePoint))
      .every(isDocumentedEvenG2TextGlyph);
    return {
      ...candidate,
      documentedGlyphProbe,
      missingCodePoints,
      needsVisualReview: missingCodePoints.length === 0 && !documentedGlyphProbe,
      reviewPath: capture.reviewPath,
      supported: missingCodePoints.length === 0,
    };
  } finally {
    await stopProcess(simulator);
  }
}

function writeReport(report: unknown) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  const candidates = parseArgs(process.argv.slice(2));
  const appPort = await freePort();
  let devServer: ChildProcess | null = null;
  try {
    devServer = spawnProcess("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(appPort), "--strictPort"]);
    await waitForHttp(`http://127.0.0.1:${appPort}/`);
    const results: CandidateResult[] = [];
    for (const candidate of candidates) {
      process.stdout.write(`Probing ${candidate.text} ${candidate.label}...\n`);
      results.push(await runCandidate(candidate, appPort));
    }
    const report = {
      ok: true,
      generatedAt: new Date().toISOString(),
      reportPath: REPORT_PATH,
      outDir: OUT_DIR,
      candidateCount: results.length,
      supportedCount: results.filter((result) => result.supported).length,
      missingCount: results.filter((result) => !result.supported).length,
      needsVisualReviewCount: results.filter((result) => result.needsVisualReview).length,
      results,
    };
    writeReport(report);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await stopProcess(devServer);
  }
}

main().catch((err) => {
  const report = {
    ok: false,
    generatedAt: new Date().toISOString(),
    reportPath: REPORT_PATH,
    error: err instanceof Error ? err.stack || err.message : String(err),
  };
  try {
    writeReport(report);
  } catch {
    // Report writing is best effort after a failure.
  }
  console.error(report.error);
  process.exit(1);
});
