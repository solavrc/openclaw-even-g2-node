import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gitMetadata } from "./git-state.ts";
import { fetchSimulator } from "./simulator-utils.ts";
import { simulatorSourceSha256 } from "./simulator-source-fingerprint.ts";
import { errorStack } from "./strict-helpers.ts";

export type FixtureFlow = "session" | "sessionSelector" | "voiceReview" | "canvas" | "canvasTutorial" | "approval" | "recovery" | "storeChat" | "storeVoice" | "sendNow";
type BuildFlow = "setup" | "rootExit";

export const FIXTURE_FLOWS: FixtureFlow[] = ["session", "sessionSelector", "voiceReview", "canvas", "canvasTutorial", "approval", "recovery", "storeChat", "storeVoice", "sendNow"];
const OUT_DIR = process.env.EVENG2_SIMULATOR_OUT_DIR || "/tmp";
const REPORT_PATH = path.join(process.cwd(), ".openclaw-even-g2-node", "simulator-fixtures-report.json");

type E2eStep = {
  changedAlphaPixels?: number;
  litPixels?: number;
  name?: string;
  reviewPath?: string;
  webviewPath?: string;
};

type E2eResult = {
  ok: boolean;
  baseUrl?: string;
  flow?: string;
  steps?: E2eStep[];
};

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
  child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  child.on("error", (error) => {
    process.stderr.write(`${command} ${args.join(" ")} failed to start: ${error.message}\n`);
  });
  return child;
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

async function runCommand(command: string, args: string[]) {
  const child = spawnProcess(command, args);
  await new Promise<void>((resolve, reject) => {
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${code}${signal ? ` (${signal})` : ""}`));
    });
    child.on("error", reject);
  });
}

async function runE2e(flow: BuildFlow | FixtureFlow, simulatorPort: number) {
  const child = spawnProcess("pnpm", ["sim:e2e"], {
    env: {
      ...process.env,
      EVENG2_SIM_FLOW: flow,
      EVENG2_SIMULATOR_URL: `http://127.0.0.1:${simulatorPort}`,
      EVENG2_SIMULATOR_OUT_DIR: OUT_DIR,
    },
  });
  let stdout = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  await new Promise<void>((resolve, reject) => {
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`sim:e2e ${flow} exited ${code}${signal ? ` (${signal})` : ""}`));
    });
    child.on("error", reject);
  });
  return parseLastJsonObject(stdout) as E2eResult;
}

function parseLastJsonObject(output: string): unknown {
  for (let start = output.lastIndexOf("{"); start >= 0; start = output.lastIndexOf("{", start - 1)) {
    const candidate = output.slice(start).trim();
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep scanning backward; package-manager output can contain other braces.
    }
  }
  throw new Error("Could not parse sim:e2e JSON output.");
}

export function simulatorFixtureAppUrl(flow: FixtureFlow, appPort: number) {
  const fixtureMode = flow === "sessionSelector" ? "session" : flow;
  const params = new URLSearchParams({
    resetPairing: "1",
    simFixture: fixtureMode,
  });
  if (flow === "sessionSelector") params.set("simSessionSelectorFlow", "1");
  return `http://127.0.0.1:${appPort}/?${params.toString()}`;
}

async function runBuildSmoke(flow: BuildFlow) {
  const appPort = await freePort();
  const simulatorPort = await freePort();
  let server: ChildProcess | null = null;
  let simulator: ChildProcess | null = null;
  try {
    server = spawnProcess("pnpm", ["serve:sim"], {
      env: {
        ...process.env,
        EVENG2_EVEN_DEV_PORT: String(appPort),
      },
    });
    const appBaseUrl = `http://127.0.0.1:${appPort}/openclaw-even-g2-node/`;
    const params = new URLSearchParams({ resetPairing: "1" });
    if (flow === "rootExit") params.set("e2eLog", "1");
    const appUrl = `${appBaseUrl}?${params.toString()}`;
    await waitForHttp(`${appBaseUrl}health`);

    simulator = spawnProcess("pnpm", ["simulator", appUrl, "--automation-port", String(simulatorPort)]);
    await waitForSimulator(`http://127.0.0.1:${simulatorPort}`);
    return await runE2e(flow, simulatorPort);
  } finally {
    await stopProcess(simulator);
    await stopProcess(server);
  }
}

async function runFixtureSmoke(flow: FixtureFlow) {
  const appPort = await freePort();
  const simulatorPort = await freePort();
  let devServer: ChildProcess | null = null;
  let simulator: ChildProcess | null = null;
  try {
    devServer = spawnProcess("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(appPort), "--strictPort"]);
    const appUrl = simulatorFixtureAppUrl(flow, appPort);
    await waitForHttp(`http://127.0.0.1:${appPort}/`);

    simulator = spawnProcess("pnpm", ["simulator", appUrl, "--automation-port", String(simulatorPort)]);
    await waitForSimulator(`http://127.0.0.1:${simulatorPort}`);
    return await runE2e(flow, simulatorPort);
  } finally {
    await stopProcess(simulator);
    await stopProcess(devServer);
  }
}

function writeReport(report: unknown) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  await runCommand("pnpm", ["build"]);
  const results: E2eResult[] = [];
  results.push(await runBuildSmoke("setup"));
  results.push(await runBuildSmoke("rootExit"));
  for (const flow of FIXTURE_FLOWS) {
    results.push(await runFixtureSmoke(flow));
  }
  const report = {
    ok: results.every((result) => result.ok === true),
    generatedAt: new Date().toISOString(),
    outDir: OUT_DIR,
    setup: true,
    fixtures: FIXTURE_FLOWS,
    git: { ...gitMetadata(), simulatorSourceSha256: simulatorSourceSha256() },
    results,
  };
  writeReport(report);
  console.log(JSON.stringify({ ...report, reportPath: REPORT_PATH }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((err) => {
    const report = {
      ok: false,
      generatedAt: new Date().toISOString(),
      outDir: OUT_DIR,
      setup: false,
      fixtures: FIXTURE_FLOWS,
      git: { ...gitMetadata(), simulatorSourceSha256: simulatorSourceSha256() },
      error: errorStack(err),
    };
    try {
      writeReport(report);
      console.error(JSON.stringify({ ...report, reportPath: REPORT_PATH }, null, 2));
    } catch (writeError) {
      console.error(errorStack(writeError));
    }
    process.exit(1);
  });
}
