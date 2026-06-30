import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildGatewayPlan,
  createMinimalOpenClawConfig,
  extractSetupCodeOutput,
  FULL_E2E_GATEWAY_CONFIG_TEMPLATE_PATH,
  MINIMAL_GATEWAY_CONFIG_TEMPLATE_PATH,
  parseArgs,
} from "./isolated-openclaw-gateway.ts";

const tempRoots: string[] = [];

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "even-g2-isolated-gateway-"));
  tempRoots.push(root);
  return root;
}

function touch(filePath: string, value = "") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function volumeArgs(args: string[]) {
  const volumes: string[] = [];
  args.forEach((arg, index) => {
    if (arg === "--volume") volumes.push(args[index + 1] || "");
  });
  return volumes;
}

function planArgs(extra: string[] = []) {
  return parseArgs([
    "plan",
    "--run-id",
    "unit-run",
    "--token",
    "unit-token",
    "--openclaw-package",
    "openclaw@2026.6.10",
    ...extra,
  ], new Date("2026-01-02T03:04:05.000Z"));
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("isolated OpenClaw Gateway config", () => {
  it("keeps the visible JSON template aligned with the default generated config", () => {
    const template = JSON.parse(fs.readFileSync(MINIMAL_GATEWAY_CONFIG_TEMPLATE_PATH, "utf8")) as unknown;
    const generated = createMinimalOpenClawConfig({
      containerPort: 19001,
      controlOrigins: [
        "http://127.0.0.1:5174",
        "http://localhost:5174",
        "http://127.0.0.1:35162",
        "http://localhost:35162",
      ],
      plugins: [],
    });

    expect(generated).toEqual(template);
  });

  it("builds a minimal local token Gateway config without copied auth profiles", () => {
    const config = createMinimalOpenClawConfig({
      containerPort: 19001,
      controlOrigins: ["http://127.0.0.1:5174", "http://127.0.0.1:5174"],
      plugins: [],
    });

    expect(config).toEqual({
      env: {
        shellEnv: { enabled: false },
        vars: {},
      },
      gateway: {
        mode: "local",
        bind: "lan",
        port: 19001,
        auth: {
          mode: "token",
          token: {
            source: "env",
            provider: "openclaw",
            id: "OPENCLAW_GATEWAY_TOKEN",
          },
        },
        controlUi: {
          enabled: false,
          allowedOrigins: ["http://127.0.0.1:5174"],
        },
      },
      plugins: { enabled: true },
      tools: { profile: "minimal" },
    });
    expect(Object.keys(config)).not.toContain("auth");
  });

  it("adds a plugin allowlist only when the caller asks for it", () => {
    const config = createMinimalOpenClawConfig({
      containerPort: 19001,
      controlOrigins: [],
      plugins: ["voice-call", "xai", "voice-call"],
    });

    expect(config.plugins).toEqual({ enabled: true, allow: ["voice-call", "xai"] });
  });

  it("can generate the full E2E Gateway config without copying the user config", () => {
    const config = createMinimalOpenClawConfig({
      configTemplatePath: FULL_E2E_GATEWAY_CONFIG_TEMPLATE_PATH,
      containerPort: 19002,
      controlOrigins: ["http://127.0.0.1:5174"],
      plugins: [],
    });

    expect(config).toMatchObject({
      gateway: {
        port: 19002,
      },
      plugins: {
        enabled: true,
        entries: {
          "voice-call": {
            enabled: true,
            config: {
              streaming: {
                enabled: true,
                provider: "xai",
                providers: {
                  xai: {},
                },
              },
            },
          },
          xai: {
            enabled: true,
          },
        },
      },
      tools: {
        media: {
          audio: {
            enabled: true,
            language: "ja",
            models: [
              {
                type: "cli",
                command: "whisper",
              },
            ],
          },
        },
      },
    });
    expect(Object.keys(config)).not.toContain("auth");
  });

  it("keeps full E2E plugin entries when adding an allowlist", () => {
    const config = createMinimalOpenClawConfig({
      configTemplatePath: FULL_E2E_GATEWAY_CONFIG_TEMPLATE_PATH,
      containerPort: 19001,
      controlOrigins: [],
      plugins: ["voice-call", "xai"],
    });

    expect(config.plugins.allow).toEqual(["voice-call", "xai"]);
    expect(config.plugins.entries?.["voice-call"]).toMatchObject({
      enabled: true,
      config: {
        streaming: {
          enabled: true,
          provider: "xai",
        },
      },
    });
  });

  it("extracts setup code when OpenClaw prints config warnings first", () => {
    expect(extractSetupCodeOutput([
      "│",
      "◇  Config warnings ───────────────────────────────────────────────────────╮",
      "│  - plugins.entries.voice-call: plugin not installed: voice-call          │",
      "eyJ1cmwiOiJ3czovLzEyNy4wLjAuMToxOTAwMyIsImJvb3RzdHJhcFRva2VuIjoiabc",
    ].join("\n"))).toBe("eyJ1cmwiOiJ3czovLzEyNy4wLjAuMToxOTAwMyIsImJvb3RzdHJhcFRva2VuIjoiabc");
  });
});

describe("isolated OpenClaw Gateway Docker plan", () => {
  it("keeps generated state writable while mounting user auth inputs read-only", () => {
    const root = makeTempRoot();
    const authStateDir = path.join(root, "host-openclaw");
    const envFile = path.join(authStateDir, ".env");
    const authSecretDir = path.join(authStateDir, "credentials", "auth-profiles");
    const authDb = path.join(authStateDir, "agents", "main", "agent", "openclaw-agent.sqlite");
    touch(envFile, "OPENAI_API_KEY=from-env\n");
    fs.mkdirSync(authSecretDir, { recursive: true });
    touch(authDb);
    touch(`${authDb}-wal`);
    touch(`${authDb}-shm`);

    const plan = buildGatewayPlan(planArgs([
      "--out-root",
      path.join(root, "runs"),
      "--full-e2e-config",
      "--auth-state-dir",
      authStateDir,
      "--env-file",
      envFile,
    ]));
    const volumes = volumeArgs(plan.dockerRunArgs);

    expect(plan.dockerRunArgs).toContain("--rm");
    expect(plan.configTemplatePath).toBe(FULL_E2E_GATEWAY_CONFIG_TEMPLATE_PATH);
    expect(plan.config.plugins.entries?.["voice-call"]).toMatchObject({ enabled: true });
    expect(plan.installPluginPackages).toEqual(["@openclaw/voice-call"]);
    expect(plan.dockerRunArgs.join(" ")).toContain("openclaw plugins install '@openclaw/voice-call'");
    expect(plan.dockerRunArgs.join(" ")).toContain("--bind lan");
    expect(volumes).toContain(`${plan.stateDir}:/home/node/.openclaw:rw`);
    expect(volumes).toContain(`${plan.workspaceDir}:/home/node/.openclaw/workspace:rw`);
    expect(volumes).toContain(`${envFile}:/home/node/.openclaw/.env:ro`);
    expect(volumes).toContain(`${authSecretDir}:/home/node/.config/openclaw:ro`);
    expect(volumes).toContain(`${authDb}:/home/node/.openclaw/agents/main/agent/openclaw-agent.sqlite:ro`);
    expect(volumes).toContain(`${authDb}-wal:/home/node/.openclaw/agents/main/agent/openclaw-agent.sqlite-wal:ro`);
    expect(volumes).toContain(`${authDb}-shm:/home/node/.openclaw/agents/main/agent/openclaw-agent.sqlite-shm:ro`);
    expect(volumes).not.toContain(`${authStateDir}:/home/node/.openclaw:rw`);
  });

  it("uses host URL for pairing and container URL for OpenClaw CLI evidence", () => {
    const root = makeTempRoot();
    const plan = buildGatewayPlan(planArgs([
      "--out-root",
      path.join(root, "runs"),
      "--no-default-env-file",
      "--no-default-auth-binds",
      "--host-port",
      "19002",
      "--container-port",
      "19001",
    ]));

    expect(plan.config.gateway.port).toBe(19001);
    expect(plan.hostGatewayUrl).toBe("ws://127.0.0.1:19002");
    expect(plan.containerGatewayUrl).toBe("ws://127.0.0.1:19001");
    expect(plan.setupCodeCommand).toEqual([
      "openclaw",
      "qr",
      "--url",
      "ws://127.0.0.1:19002",
      "--token",
      "unit-token",
      "--setup-code-only",
    ]);
    expect(plan.e2eAgentArgs).toEqual([
      "--openclaw-container",
      "openclaw-even-g2-test-unit-run",
      "--openclaw-url",
      "ws://127.0.0.1:19001",
      "--openclaw-token",
      "unit-token",
    ]);
  });

  it("rejects writable extra binds", () => {
    const root = makeTempRoot();
    expect(() => parseArgs([
      "plan",
      "--readonly-bind",
      `${root}:/tmp/host-state:rw`,
    ])).toThrow("--readonly-bind only accepts ro mounts");
  });
});
