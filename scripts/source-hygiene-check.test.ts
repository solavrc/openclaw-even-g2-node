import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sourceHygieneFindings, sourceHygieneReport } from "./source-hygiene-check.ts";

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-eg2-node-hygiene-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { check: "tsx scripts/source-hygiene-check.ts" } }));
  return dir;
}

function writeFile(root: string, relativePath: string, content: string) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe("sourceHygieneFindings", () => {
  it("accepts a minimal TypeScript-only public tree", () => {
    const root = tempRepo();
    writeFile(root, "src/main.ts", "export const appName = 'OpenClaw Node';\n");
    writeFile(root, "README.md", "# OpenClaw Node\n");

    expect(sourceHygieneReport(root)).toEqual({
      findings: [],
      scannedFiles: 3,
    });
  });

  it("rejects legacy product names and private network values", () => {
    const root = tempRepo();
    const legacyName = ["Claw", "Bridge"].join("");
    const oldCompatibleName = ["Ocu", "Claw"].join("");
    const privateOrigin = ["macbookpro", ".tail", "72b6aa", ".ts.net"].join("");
    const privateIp = ["100", "97", "205", "67"].join(".");

    writeFile(root, "README.md", [
      `Old name: ${legacyName}`,
      `Compatibility target: ${oldCompatibleName}`,
      `Gateway: wss://${privateOrigin}`,
      `Legacy IP: ${privateIp}`,
    ].join("\n"));

    const reasons = sourceHygieneFindings(root).map((finding) => finding.reason).join("\n");
    expect(reasons).toContain("legacy product name");
    expect(reasons).toContain("environment-specific private network value");
  });

  it("rejects committed env files and secret-looking provider keys", () => {
    const root = tempRepo();
    const openAiKey = ["sk-proj", "abcdefghijklmnopqrstuvwxyz123456"].join("-");
    const anthropicKey = ["sk-ant", "abcdefghijklmnopqrstuvwxyz123456"].join("-");
    const xaiKey = ["xai", "abcdefghijklmnopqrstuvwxyz123456"].join("-");
    writeFile(root, ".env.local", `OPENAI_API_KEY=${openAiKey}\n`);
    writeFile(root, ".env.example", "OPENAI_API_KEY=\n");
    writeFile(root, "docs/providers.md", [
      `OpenAI: ${openAiKey}`,
      `Anthropic: ${anthropicKey}`,
      `xAI: ${xaiKey}`,
    ].join("\n"));

    const findings = sourceHygieneFindings(root);
    const reasons = findings.map((finding) => finding.reason).join("\n");
    expect(reasons).toContain("environment files are not allowed");
    expect(reasons).toContain("OpenAI API key value is not allowed");
    expect(reasons).toContain("Anthropic API key value is not allowed");
    expect(reasons).toContain("xAI API key value is not allowed");
    expect(findings.some((finding) => finding.file === ".env.example")).toBe(false);
  });

  it("allows env examples but still scans them for real secrets", () => {
    const root = tempRepo();
    const openAiKey = ["sk-proj", "abcdefghijklmnopqrstuvwxyz123456"].join("-");
    writeFile(root, ".env.example", [
      "OPENAI_API_KEY=",
      `DO_NOT_COMMIT=${openAiKey}`,
    ].join("\n"));

    const findings = sourceHygieneFindings(root);
    expect(findings).toEqual([
      {
        file: ".env.example",
        reason: "OpenAI API key value is not allowed in the public repo",
      },
    ]);
  });

  it("skips generated release artifacts when scanning public source", () => {
    const root = tempRepo();
    const legacyName = ["Claw", "Bridge"].join("");
    writeFile(root, "release/submission-copy.md", legacyName);
    writeFile(root, "src/main.ts", "export const ok = true;\n");

    expect(sourceHygieneFindings(root)).toEqual([]);
  });
});
