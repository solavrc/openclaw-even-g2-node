import {
  assertCaptureLooksVisible,
  captureSimulator,
} from "./simulator-utils.js";

const BASE_URL = process.env.EVENG2_SIMULATOR_URL || "http://127.0.0.1:9898";
const OUT_DIR = process.env.EVENG2_SIMULATOR_OUT_DIR || "/tmp";

async function main() {
  const capture = await captureSimulator(BASE_URL, OUT_DIR);
  assertCaptureLooksVisible(capture);
  console.log(JSON.stringify({ ok: true, ...capture }, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
