import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const SIMULATOR_BIN = path.join(ROOT, "node_modules", "@evenrealities", "evenhub-simulator", "bin", "index.js");

function main(): void {
  const child = spawn(process.execPath, [SIMULATOR_BIN, ...process.argv.slice(2)], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });
  child.on("error", (error) => {
    console.error(`Failed to start EvenHub simulator: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) : false;
if (invokedPath) main();
