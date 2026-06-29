import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bumpProjectVersion, bumpVersion, compareVersions, nextVersion, parseVersion } from "./bump-version.ts";

function tempRepo(version = "0.1.9") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oc-eg2-node-version-"));
  fs.mkdirSync(path.join(root, "docs", "maintainers"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ version }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "app.json"), `${JSON.stringify({ version }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, ".release-please-manifest.json"), `${JSON.stringify({ ".": version }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "docs", "maintainers", "release.md"), `# Maintainer Release\n\nVersion \`${version}\`: <!-- x-release-please-version -->\n`);
  return root;
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

describe("version bump helpers", () => {
  it("parses and compares strict three-part semver", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(() => parseVersion("1.2")).toThrow("three-part semver");
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("computes patch, minor, major, and explicit target versions", () => {
    expect(bumpVersion("0.1.9", "patch")).toBe("0.1.10");
    expect(bumpVersion("0.1.9", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.1.9", "major")).toBe("1.0.0");
    expect(nextVersion("0.1.9", "0.1.10")).toBe("0.1.10");
    expect(() => nextVersion("0.1.9", "0.1.9")).toThrow("must be greater");
    expect(() => nextVersion("0.1.9", undefined)).toThrow("Usage:");
  });

  it("updates every release-managed version file together", () => {
    const root = tempRepo("0.1.9");

    expect(bumpProjectVersion(root, "patch")).toEqual({
      currentVersion: "0.1.9",
      targetVersion: "0.1.10",
    });

    expect(readJson(path.join(root, "package.json")).version).toBe("0.1.10");
    expect(readJson(path.join(root, "app.json")).version).toBe("0.1.10");
    expect(readJson(path.join(root, ".release-please-manifest.json"))["."]).toBe("0.1.10");
    expect(fs.readFileSync(path.join(root, "docs", "maintainers", "release.md"), "utf8")).toContain("Version `0.1.10`:");
  });

  it("refuses to bump when release-managed files disagree", () => {
    const root = tempRepo("0.1.9");
    fs.writeFileSync(path.join(root, "app.json"), `${JSON.stringify({ version: "0.1.8" }, null, 2)}\n`);

    expect(() => bumpProjectVersion(root, "patch")).toThrow("Refusing to bump mismatched versions");
  });
});
