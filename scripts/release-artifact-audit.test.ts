import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { releaseArtifactAuditFiles, releaseArtifactAuditFindings } from "./release-artifact-audit.ts";

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oc-eg2-node-artifact-audit-"));
}

function writeFile(root: string, relativePath: string, content: string) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe("releaseArtifactAuditFindings", () => {
  it("accepts a minimal clean release source tree", () => {
    const root = tempRepo();
    writeFile(root, "README.md", "# Even G2 Node\n");
    writeFile(root, "docs/user-guide.md", "OpenClaw Node for Even G2.\n");
    writeFile(root, "src/main.tsx", "export const displayName = 'Even G2';\n");

    expect(releaseArtifactAuditFiles(root).map((filePath) => path.relative(root, filePath))).toEqual([
      "README.md",
      "docs/user-guide.md",
      "src/main.tsx",
    ]);
    expect(releaseArtifactAuditFindings(root)).toEqual([]);
  });

  it("rejects old names, private origins, developer paths, and provider keys", () => {
    const root = tempRepo();
    const oldRepo = ["openclaw", "even", "g2"].join("-");
    const oldProduct = ["Claw", "Bridge"].join("");
    const oldCompat = ["Ocu", "Claw"].join("");
    const privateHost = ["macbookpro", ".tail", "72b6aa", ".ts.net"].join("");
    const developerPath = ["", "Users", "local"].join("/");
    const openAiKey = ["sk-proj", "abcdefghijklmnopqrstuvwxyz123456"].join("-");
    const anthropicKey = ["sk-ant", "abcdefghijklmnopqrstuvwxyz123456"].join("-");
    const xaiKey = ["xai", "abcdefghijklmnopqrstuvwxyz123456"].join("-");

    writeFile(root, "README.md", [
      oldRepo,
      oldProduct,
      oldCompat,
      privateHost,
      developerPath,
      openAiKey,
      anthropicKey,
      xaiKey,
    ].join("\n"));

    const labels = releaseArtifactAuditFindings(root).map((finding) => finding.label);
    expect(labels).toContain("old repo namespace");
    expect(labels).toContain("old product name");
    expect(labels).toContain("old compatibility name");
    expect(labels).toContain("personal hostname");
    expect(labels).toContain("developer absolute path");
    expect(labels).toContain("probable OpenAI API key");
    expect(labels).toContain("probable Anthropic API key");
    expect(labels).toContain("probable xAI API key");
    expect(labels.filter((label) => label === "probable OpenAI API key")).toHaveLength(1);
  });
});
