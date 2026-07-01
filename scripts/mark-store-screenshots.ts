import { writeStoreScreenshotSourceManifest } from "./store-screenshot-manifest.ts";
import { errorStack } from "./strict-helpers.ts";

try {
  const manifest = writeStoreScreenshotSourceManifest();
  console.log(JSON.stringify({
    ok: true,
    captureSource: manifest.captureSource,
    editingPolicy: manifest.editingPolicy,
    generatedAt: manifest.generatedAt,
    simulatorSourceSha256: manifest.simulatorSourceSha256,
    screenshots: manifest.screenshots.map((screenshot) => screenshot.file),
  }, null, 2));
} catch (err) {
  console.error(errorStack(err));
  process.exit(1);
}
