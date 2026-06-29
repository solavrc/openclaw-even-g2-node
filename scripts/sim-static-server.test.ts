import path from "node:path";
import { describe, expect, it } from "vitest";
import { staticFilePathForRequestPath } from "./sim-static-server.ts";

describe("sim static server", () => {
  it("resolves paths inside the app dist directory", () => {
    const appDist = path.resolve("/tmp/openclaw-even-g2-node/dist");

    expect(staticFilePathForRequestPath("/", appDist)).toBe(path.join(appDist, "index.html"));
    expect(staticFilePathForRequestPath("/assets/app.js", appDist)).toBe(path.join(appDist, "assets/app.js"));
  });

  it("rejects encoded traversal into sibling directories", () => {
    const appDist = path.resolve("/tmp/openclaw-even-g2-node/dist");

    expect(staticFilePathForRequestPath("/../dist-secrets/file", appDist)).toBeNull();
  });
});
