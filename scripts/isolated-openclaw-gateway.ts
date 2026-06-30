import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { errorStack } from "./strict-helpers.ts";

type Command = "plan" | "start" | "stop";
type AccessMode = "ro" | "rw";

type BindMount = {
  access: AccessMode;
  reason: string;
  source: string;
  target: string;
};

type ParsedArgs = {
  authStateDir: string;
  command: Command;
  containerName: string;
  containerNameProvided: boolean;
  containerPort: number;
  controlOrigins: string[];
  configTemplatePath: string;
  defaultAuthBinds: boolean;
  defaultEnvFile: boolean;
  envFile: string;
  hostPort: number;
  image: string;
  installPluginPackages: string[];
  openclawPackage: string;
  outRoot: string;
  plugins: string[];
  readOnlyBinds: BindMount[];
  replace: boolean;
  runId: string;
  setupCode: boolean;
  token: string;
  waitMs: number;
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

type MinimalOpenClawConfig = {
  env: {
    shellEnv: { enabled: false };
    vars: Record<string, never>;
  };
  gateway: {
    auth: {
      mode: "token";
      token: {
        id: string;
        provider: "openclaw";
        source: "env";
      };
    };
    bind: "lan";
    controlUi: {
      allowedOrigins: string[];
      enabled: false;
    };
    mode: "local";
    port: number;
  };
  plugins: {
    allow?: string[];
    enabled: true;
    entries?: Record<string, JsonObject>;
  };
  tools: {
    media?: JsonObject;
    profile: "minimal";
  };
};

export type IsolatedGatewayPlan = {
  config: MinimalOpenClawConfig;
  configPath: string;
  containerGatewayUrl: string;
  containerName: string;
  containerPort: number;
  dockerRunArgs: string[];
  e2eAgentArgs: string[];
  e2eAgentEnv: Record<string, string>;
  configTemplatePath: string;
  hostGatewayUrl: string;
  hostPort: number;
  image: string;
  installPluginPackages: string[];
  mounts: BindMount[];
  openclawPackage: string;
  outDir: string;
  runId: string;
  setupCodeCommand: string[];
  stateDir: string;
  stopCommand: string[];
  token: string;
  workspaceDir: string;
};

const CONTAINER_HOME = "/home/node";
const CONTAINER_STATE_DIR = `${CONTAINER_HOME}/.openclaw`;
const CONTAINER_WORKSPACE_DIR = `${CONTAINER_STATE_DIR}/workspace`;
const CONTAINER_AUTH_PROFILE_SECRET_DIR = `${CONTAINER_HOME}/.config/openclaw`;
const DEFAULT_CONTAINER_PORT = 19_001;
const DEFAULT_CONTROL_ORIGINS = [
  "http://127.0.0.1:5174",
  "http://localhost:5174",
  "http://127.0.0.1:35162",
  "http://localhost:35162",
];
const DEFAULT_OUT_ROOT = path.join(process.cwd(), ".openclaw-even-g2-node", "isolated-gateway");
const DEFAULT_IMAGE = "node:22-bookworm";
const FULL_E2E_PLUGIN_PACKAGES = ["@openclaw/voice-call"];
const GATEWAY_TOKEN_ENV = "OPENCLAW_GATEWAY_TOKEN";
const ROLE_LABEL = "openclaw-even-g2-node.role=isolated-gateway";
export const MINIMAL_GATEWAY_CONFIG_TEMPLATE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "isolated-openclaw-gateway.config.json",
);
export const FULL_E2E_GATEWAY_CONFIG_TEMPLATE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "isolated-openclaw-gateway.e2e.config.json",
);

const HELP = `Run an isolated Docker-backed OpenClaw Gateway for local Even G2 E2E tests.

Usage:
  pnpm e2e:gateway:plan
  pnpm e2e:gateway:start
  pnpm e2e:gateway:stop

Commands:
  plan   Write the generated openclaw.json and print Docker/E2E commands.
  start  Start the Docker container and wait for the Gateway.
  stop   Stop isolated Gateway containers created by this script.

Options:
  --host-port <port>          Host loopback port. Default: ${DEFAULT_CONTAINER_PORT}
  --container-port <port>     Container Gateway port. Default: ${DEFAULT_CONTAINER_PORT}
  --run-id <id>               Run id used for generated state paths.
  --container-name <name>     Docker container name.
  --out-root <path>           Generated state root. Default: ${DEFAULT_OUT_ROOT}
  --image <name>              Docker image. Default: ${DEFAULT_IMAGE}
  --openclaw-package <spec>   NPM package installed in the container.
  --config-template <path>    openclaw.json template copied into generated state.
  --full-e2e-config           Use the bundled full-story E2E Gateway template.
  --install-plugin <pkg>      Install an OpenClaw plugin package in the container. Repeatable.
  --token <token>             Gateway token. Default: generated test token.
  --plugin <id>               Add plugins.allow entry. Repeatable; omitted by default.
  --control-origin <origin>   Add controlUi.allowedOrigins entry. Repeatable.
  --env-file <path>           Read-only bind source for /home/node/.openclaw/.env.
  --no-default-env-file       Do not auto-bind ~/.openclaw/.env.
  --auth-state-dir <path>     Source state for default read-only auth binds. Default: ~/.openclaw
  --no-default-auth-binds     Do not auto-bind auth profile files/secrets.
  --readonly-bind <h>:<c>     Extra read-only bind mount. Repeatable.
  --replace                   Stop an existing container with the same name before start.
  --wait-ms <ms>              Gateway readiness wait. Default: 120000.
  --no-setup-code             Skip setup-code generation on start.
  -h, --help                  Show this help.
`;

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function sanitizeName(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/^-+|-+$/g, "") || "run";
}

function defaultContainerName(runId: string) {
  return `openclaw-even-g2-test-${sanitizeName(runId)}`;
}

function defaultAuthStateDir() {
  return path.join(os.homedir(), ".openclaw");
}

function defaultEnvFile() {
  return path.join(defaultAuthStateDir(), ".env");
}

function expandHome(value: string) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolveHostPath(value: string) {
  return path.resolve(expandHome(value));
}

function readFlagValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function readPort(value: string, flag: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${flag} must be a TCP port from 1 to 65535.`);
  }
  return parsed;
}

function readNonNegativeInteger(value: string, flag: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} must be 0 or a positive integer.`);
  return parsed;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function generatedToken() {
  return `eveng2-test-${crypto.randomBytes(24).toString("base64url")}`;
}

function detectHostOpenClawPackage() {
  const explicit = process.env.EVENG2_E2E_OPENCLAW_PACKAGE?.trim();
  if (explicit) return explicit;
  const result = spawnSync("openclaw", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2_000,
  });
  const text = result.stdout || "";
  const match = text.match(/OpenClaw\s+(\d+\.\d+\.\d+)/);
  return match ? `openclaw@${match[1]}` : "openclaw@latest";
}

function parseReadOnlyBind(spec: string): BindMount {
  const parts = spec.split(":");
  if (parts.length < 2) throw new Error(`Invalid read-only bind: ${spec}`);
  const maybeAccess = parts[parts.length - 1];
  const hasAccess = maybeAccess === "ro" || maybeAccess === "rw";
  const source = parts[0];
  const target = parts.slice(1, hasAccess ? -1 : undefined).join(":");
  if (!source || !target) throw new Error(`Invalid read-only bind: ${spec}`);
  if (hasAccess && maybeAccess !== "ro") throw new Error(`--readonly-bind only accepts ro mounts: ${spec}`);
  return {
    access: "ro",
    reason: "user supplied read-only bind",
    source: resolveHostPath(source),
    target,
  };
}

export function parseArgs(argv: string[], now = new Date()): ParsedArgs {
  const runId = timestampSlug(now);
  const args: ParsedArgs = {
    authStateDir: defaultAuthStateDir(),
    command: "start",
    containerName: defaultContainerName(runId),
    containerNameProvided: false,
    containerPort: DEFAULT_CONTAINER_PORT,
    controlOrigins: [...DEFAULT_CONTROL_ORIGINS],
    configTemplatePath: MINIMAL_GATEWAY_CONFIG_TEMPLATE_PATH,
    defaultAuthBinds: true,
    defaultEnvFile: true,
    envFile: defaultEnvFile(),
    hostPort: DEFAULT_CONTAINER_PORT,
    image: DEFAULT_IMAGE,
    installPluginPackages: [],
    openclawPackage: detectHostOpenClawPackage(),
    outRoot: DEFAULT_OUT_ROOT,
    plugins: [],
    readOnlyBinds: [],
    replace: false,
    runId,
    setupCode: true,
    token: generatedToken(),
    waitMs: 120_000,
  };

  let index = 0;
  const first = argv[0];
  if (first === "plan" || first === "start" || first === "stop") {
    args.command = first;
    index = 1;
  }

  for (; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--host-port") {
      args.hostPort = readPort(readFlagValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--container-port") {
      args.containerPort = readPort(readFlagValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--run-id") {
      args.runId = sanitizeName(readFlagValue(argv, index, arg));
      args.containerName = defaultContainerName(args.runId);
      index += 1;
    } else if (arg === "--container-name") {
      args.containerName = sanitizeName(readFlagValue(argv, index, arg));
      args.containerNameProvided = true;
      index += 1;
    } else if (arg === "--out-root") {
      args.outRoot = resolveHostPath(readFlagValue(argv, index, arg));
      index += 1;
    } else if (arg === "--image") {
      args.image = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--openclaw-package") {
      args.openclawPackage = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--config-template") {
      args.configTemplatePath = resolveHostPath(readFlagValue(argv, index, arg));
      index += 1;
    } else if (arg === "--full-e2e-config") {
      args.configTemplatePath = FULL_E2E_GATEWAY_CONFIG_TEMPLATE_PATH;
      args.installPluginPackages.push(...FULL_E2E_PLUGIN_PACKAGES);
    } else if (arg === "--install-plugin") {
      args.installPluginPackages.push(readFlagValue(argv, index, arg));
      index += 1;
    } else if (arg === "--token") {
      args.token = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--plugin") {
      args.plugins.push(readFlagValue(argv, index, arg));
      index += 1;
    } else if (arg === "--control-origin") {
      args.controlOrigins.push(readFlagValue(argv, index, arg));
      index += 1;
    } else if (arg === "--env-file") {
      args.envFile = resolveHostPath(readFlagValue(argv, index, arg));
      args.defaultEnvFile = true;
      index += 1;
    } else if (arg === "--no-default-env-file") {
      args.defaultEnvFile = false;
    } else if (arg === "--auth-state-dir") {
      args.authStateDir = resolveHostPath(readFlagValue(argv, index, arg));
      index += 1;
    } else if (arg === "--no-default-auth-binds") {
      args.defaultAuthBinds = false;
    } else if (arg === "--readonly-bind") {
      args.readOnlyBinds.push(parseReadOnlyBind(readFlagValue(argv, index, arg)));
      index += 1;
    } else if (arg === "--replace") {
      args.replace = true;
    } else if (arg === "--wait-ms") {
      args.waitMs = readNonNegativeInteger(readFlagValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--no-setup-code") {
      args.setupCode = false;
    } else if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  args.controlOrigins = uniqueStrings(args.controlOrigins);
  args.installPluginPackages = uniqueStrings(args.installPluginPackages);
  args.plugins = uniqueStrings(args.plugins);
  args.readOnlyBinds = dedupeBinds(args.readOnlyBinds);
  return args;
}

export function createMinimalOpenClawConfig(input: {
  configTemplatePath?: string;
  containerPort: number;
  controlOrigins: string[];
  plugins: string[];
  tokenEnvName?: string;
}): MinimalOpenClawConfig {
  const template = readGatewayConfigTemplate(input.configTemplatePath || MINIMAL_GATEWAY_CONFIG_TEMPLATE_PATH);
  const plugins = uniqueStrings(input.plugins);
  const pluginConfig = {
    enabled: template.plugins.enabled,
    ...(template.plugins.entries ? { entries: template.plugins.entries } : {}),
    ...(plugins.length
      ? { allow: plugins }
      : template.plugins.allow
        ? { allow: template.plugins.allow }
        : {}),
  };
  return {
    env: {
      shellEnv: { ...template.env.shellEnv },
      vars: {},
    },
    gateway: {
      mode: template.gateway.mode,
      bind: template.gateway.bind,
      port: input.containerPort,
      auth: {
        mode: template.gateway.auth.mode,
        token: {
          source: template.gateway.auth.token.source,
          provider: template.gateway.auth.token.provider,
          id: input.tokenEnvName || template.gateway.auth.token.id,
        },
      },
      controlUi: {
        enabled: template.gateway.controlUi.enabled,
        allowedOrigins: uniqueStrings(input.controlOrigins),
      },
    },
    plugins: pluginConfig,
    tools: {
      profile: template.tools.profile,
      ...(template.tools.media ? { media: template.tools.media } : {}),
    },
  };
}

function readGatewayConfigTemplate(templatePath: string): MinimalOpenClawConfig {
  return JSON.parse(fs.readFileSync(templatePath, "utf8")) as MinimalOpenClawConfig;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function redactCommand(args: string[]) {
  return args.map((arg, index) => {
    const previous = args[index - 1] || "";
    if (previous === "--token" || arg.startsWith(`${GATEWAY_TOKEN_ENV}=`)) return "<redacted>";
    return arg.replace(new RegExp(`${GATEWAY_TOKEN_ENV}=[^\\s]+`, "g"), `${GATEWAY_TOKEN_ENV}=<redacted>`);
  });
}

export function extractSetupCodeOutput(stdout: string) {
  const trimmed = stdout.trim();
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const setupCode = [...lines].reverse().find((line) => (
    /^(?:[A-Za-z0-9_-]{24,}={0,2}|(?:wss?|https?):\/\/\S+)$/.test(line)
  ));
  return setupCode || trimmed;
}

function hostPathExists(hostPath: string) {
  try {
    fs.accessSync(hostPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function firstExistingDirectory(paths: string[]) {
  return paths.find((candidate) => {
    try {
      return fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
}

function defaultReadOnlyBinds(args: ParsedArgs): BindMount[] {
  const binds: BindMount[] = [];
  if (args.defaultEnvFile && hostPathExists(args.envFile)) {
    binds.push({
      access: "ro",
      reason: "Gateway environment fallback; mounted read-only",
      source: args.envFile,
      target: `${CONTAINER_STATE_DIR}/.env`,
    });
  }

  if (!args.defaultAuthBinds) return binds;

  const authProfileSecretDir = firstExistingDirectory(uniqueStrings([
    process.env.OPENCLAW_AUTH_PROFILE_SECRET_DIR ? resolveHostPath(process.env.OPENCLAW_AUTH_PROFILE_SECRET_DIR) : "",
    path.join(args.authStateDir, "credentials", "auth-profiles"),
    path.join(os.homedir(), ".openclaw-auth-profile-secrets"),
  ]));
  if (authProfileSecretDir) {
    binds.push({
      access: "ro",
      reason: "Auth profile secret key directory; mounted read-only",
      source: authProfileSecretDir,
      target: CONTAINER_AUTH_PROFILE_SECRET_DIR,
    });
  }

  for (const relativeFile of [
    "agents/main/agent/openclaw-agent.sqlite",
    "agents/main/agent/openclaw-agent.sqlite-wal",
    "agents/main/agent/openclaw-agent.sqlite-shm",
    "agents/main/agent/auth-profiles.json",
    "agents/main/agent/auth-state.json",
    "agents/main/agent/auth.json",
  ]) {
    const source = path.join(args.authStateDir, relativeFile);
    if (!hostPathExists(source)) continue;
    binds.push({
      access: "ro",
      reason: "Provider auth profile state; mounted read-only",
      source,
      target: `${CONTAINER_STATE_DIR}/${relativeFile}`,
    });
  }

  return binds;
}

function dedupeBinds(binds: BindMount[]) {
  const seen = new Set<string>();
  return binds.filter((bind) => {
    const key = `${bind.source}\0${bind.target}\0${bind.access}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function volumeArg(bind: BindMount) {
  return `${bind.source}:${bind.target}:${bind.access}`;
}

function gatewayShellCommand(openclawPackage: string, installPluginPackages: string[]) {
  return [
    "set -eu",
    "npm config set fund false >/dev/null",
    "npm config set audit false >/dev/null",
    `npm install -g ${shellQuote(openclawPackage)}`,
    ...installPluginPackages.map((pluginPackage) => `openclaw plugins install ${shellQuote(pluginPackage)}`),
    `exec openclaw gateway run --allow-unconfigured --bind lan --port "$OPENCLAW_GATEWAY_PORT" --auth token --token "$${GATEWAY_TOKEN_ENV}" --ws-log compact`,
  ].join("; ");
}

export function buildDockerRunArgs(planInput: {
  configPath: string;
  containerName: string;
  containerPort: number;
  hostPort: number;
  image: string;
  installPluginPackages: string[];
  mounts: BindMount[];
  openclawPackage: string;
  runId: string;
  stateDir: string;
  token: string;
  workspaceDir: string;
}) {
  return [
    "run",
    "--detach",
    "--rm",
    "--init",
    "--name",
    planInput.containerName,
    "--label",
    ROLE_LABEL,
    "--label",
    `openclaw-even-g2-node.run-id=${planInput.runId}`,
    "--cap-drop",
    "NET_RAW",
    "--cap-drop",
    "NET_ADMIN",
    "--security-opt",
    "no-new-privileges:true",
    "--publish",
    `127.0.0.1:${planInput.hostPort}:${planInput.containerPort}`,
    "--volume",
    `${planInput.stateDir}:${CONTAINER_STATE_DIR}:rw`,
    "--volume",
    `${planInput.workspaceDir}:${CONTAINER_WORKSPACE_DIR}:rw`,
    ...planInput.mounts.flatMap((bind) => ["--volume", volumeArg(bind)]),
    "--env",
    `HOME=${CONTAINER_HOME}`,
    "--env",
    `OPENCLAW_HOME=${CONTAINER_HOME}`,
    "--env",
    `OPENCLAW_CONFIG_DIR=${CONTAINER_STATE_DIR}`,
    "--env",
    `OPENCLAW_STATE_DIR=${CONTAINER_STATE_DIR}`,
    "--env",
    `OPENCLAW_CONFIG_PATH=${CONTAINER_STATE_DIR}/openclaw.json`,
    "--env",
    `OPENCLAW_WORKSPACE_DIR=${CONTAINER_WORKSPACE_DIR}`,
    "--env",
    `OPENCLAW_AUTH_PROFILE_SECRET_DIR=${CONTAINER_AUTH_PROFILE_SECRET_DIR}`,
    "--env",
    "OPENCLAW_AUTH_STORE_READONLY=1",
    "--env",
    "OPENCLAW_DISABLE_BONJOUR=1",
    "--env",
    "BROWSER=echo",
    "--env",
    "NO_COLOR=1",
    "--env",
    `OPENCLAW_GATEWAY_PORT=${planInput.containerPort}`,
    "--env",
    `${GATEWAY_TOKEN_ENV}=${planInput.token}`,
    "--workdir",
    CONTAINER_WORKSPACE_DIR,
    planInput.image,
    "sh",
    "-lc",
    gatewayShellCommand(planInput.openclawPackage, planInput.installPluginPackages),
  ];
}

export function buildGatewayPlan(args: ParsedArgs): IsolatedGatewayPlan {
  const outDir = path.join(args.outRoot, args.runId);
  const stateDir = path.join(outDir, "state");
  const workspaceDir = path.join(outDir, "workspace");
  const configPath = path.join(stateDir, "openclaw.json");
  const hostGatewayUrl = `ws://127.0.0.1:${args.hostPort}`;
  const containerGatewayUrl = `ws://127.0.0.1:${args.containerPort}`;
  const mounts = dedupeBinds([...defaultReadOnlyBinds(args), ...args.readOnlyBinds]);
  const config = createMinimalOpenClawConfig({
    configTemplatePath: args.configTemplatePath,
    containerPort: args.containerPort,
    controlOrigins: args.controlOrigins,
    plugins: args.plugins,
  });
  const dockerRunArgs = buildDockerRunArgs({
    configPath,
    containerName: args.containerName,
    containerPort: args.containerPort,
    hostPort: args.hostPort,
    image: args.image,
    installPluginPackages: args.installPluginPackages,
    mounts,
    openclawPackage: args.openclawPackage,
    runId: args.runId,
    stateDir,
    token: args.token,
    workspaceDir,
  });
  const e2eAgentArgs = [
    "--openclaw-container",
    args.containerName,
    "--openclaw-url",
    containerGatewayUrl,
    "--openclaw-token",
    args.token,
  ];
  return {
    config,
    configPath,
    configTemplatePath: args.configTemplatePath,
    containerGatewayUrl,
    containerName: args.containerName,
    containerPort: args.containerPort,
    dockerRunArgs,
    e2eAgentArgs,
    e2eAgentEnv: {
      EVENG2_E2E_OPENCLAW_CONTAINER: args.containerName,
      EVENG2_E2E_OPENCLAW_TOKEN: args.token,
      EVENG2_E2E_OPENCLAW_URL: containerGatewayUrl,
    },
    hostGatewayUrl,
    hostPort: args.hostPort,
    image: args.image,
    installPluginPackages: args.installPluginPackages,
    mounts,
    openclawPackage: args.openclawPackage,
    outDir,
    runId: args.runId,
    setupCodeCommand: [
      "openclaw",
      "qr",
      "--url",
      hostGatewayUrl,
      "--token",
      args.token,
      "--setup-code-only",
    ],
    stateDir,
    stopCommand: ["pnpm", "e2e:gateway:stop", "--", "--container-name", args.containerName],
    token: args.token,
    workspaceDir,
  };
}

function containerTargetHostPath(plan: IsolatedGatewayPlan, target: string) {
  if (target === CONTAINER_STATE_DIR) return plan.stateDir;
  if (!target.startsWith(`${CONTAINER_STATE_DIR}/`)) return null;
  return path.join(plan.stateDir, target.slice(CONTAINER_STATE_DIR.length + 1));
}

function preparePlanFiles(plan: IsolatedGatewayPlan) {
  fs.mkdirSync(plan.stateDir, { recursive: true });
  fs.mkdirSync(plan.workspaceDir, { recursive: true });
  for (const mount of plan.mounts) {
    const targetHostPath = containerTargetHostPath(plan, mount.target);
    if (!targetHostPath) continue;
    fs.mkdirSync(path.dirname(targetHostPath), { recursive: true });
    const sourceStat = fs.statSync(mount.source);
    if (sourceStat.isDirectory()) {
      fs.mkdirSync(targetHostPath, { recursive: true });
    } else {
      fs.closeSync(fs.openSync(targetHostPath, "a"));
    }
  }
  fs.writeFileSync(plan.configPath, `${JSON.stringify(plan.config, null, 2)}\n`);
  fs.writeFileSync(path.join(plan.outDir, "gateway-plan.json"), `${JSON.stringify(planSummary(plan), null, 2)}\n`);
}

function planSummary(plan: IsolatedGatewayPlan) {
  return {
    ...plan,
    dockerRunArgsRedacted: redactCommand(["docker", ...plan.dockerRunArgs]),
    e2eAgentCommand: ["pnpm", "e2e:agent:live", "--", ...plan.e2eAgentArgs],
    simulatorUrl: `http://127.0.0.1:5174/?resetPairing=1&e2eLog=1&setupCode=<setup-code>`,
  };
}

function runCommand(command: string, args: string[], options?: { env?: NodeJS.ProcessEnv; timeout?: number }) {
  return spawnSync(command, args, {
    encoding: "utf8",
    env: options?.env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options?.timeout,
  });
}

function stopContainer(containerName: string) {
  return runCommand("docker", ["rm", "-f", containerName], { timeout: 20_000 });
}

function stopMatchingContainers() {
  const list = runCommand("docker", ["ps", "-aq", "--filter", `label=${ROLE_LABEL}`], { timeout: 20_000 });
  if (list.status !== 0) return { list, stopped: [] as string[] };
  const names = list.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const stopped = names.filter((name) => stopContainer(name).status === 0);
  return { list, stopped };
}

function openClawHostEnv(plan: IsolatedGatewayPlan): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OPENCLAW_AUTH_PROFILE_SECRET_DIR: path.join(plan.outDir, "host-auth-profile-secrets"),
    OPENCLAW_AUTH_STORE_READONLY: "1",
    OPENCLAW_CONFIG_DIR: plan.stateDir,
    OPENCLAW_CONFIG_PATH: plan.configPath,
    OPENCLAW_GATEWAY_TOKEN: plan.token,
    OPENCLAW_STATE_DIR: plan.stateDir,
    OPENCLAW_WORKSPACE_DIR: plan.workspaceDir,
  };
}

function runOpenClawForPlan(plan: IsolatedGatewayPlan, args: string[], options?: {
  env?: Record<string, string>;
  timeout?: number;
}) {
  return runCommand("openclaw", args, {
    env: {
      ...openClawHostEnv(plan),
      ...options?.env,
    },
    timeout: options?.timeout,
  });
}

async function sleep(ms: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForGateway(plan: IsolatedGatewayPlan, waitMs: number) {
  if (waitMs === 0) return { ok: true, skipped: true };
  const deadline = Date.now() + waitMs;
  let last = "";
  while (Date.now() < deadline) {
    const result = runOpenClawForPlan(plan, [
      "gateway",
      "probe",
      "--url",
      plan.hostGatewayUrl,
      "--token",
      plan.token,
      "--json",
      "--timeout",
      "3000",
    ], { timeout: 5_000 });
    if (result.status === 0) return { ok: true, skipped: false };
    last = `${result.stderr || result.stdout || result.error?.message || "Gateway not ready"}`.trim();
    await sleep(1_000);
  }
  return { ok: false, error: last || `Gateway did not become ready within ${waitMs}ms`, skipped: false };
}

function setupCodeFor(plan: IsolatedGatewayPlan) {
  const setupConfigPath = path.join(plan.stateDir, "openclaw.setup-code.json");
  fs.writeFileSync(setupConfigPath, `${JSON.stringify(createMinimalOpenClawConfig({
    containerPort: plan.containerPort,
    controlOrigins: plan.config.gateway.controlUi.allowedOrigins,
    plugins: [],
    tokenEnvName: plan.config.gateway.auth.token.id,
  }), null, 2)}\n`);
  const result = runOpenClawForPlan(plan, plan.setupCodeCommand.slice(1), {
    env: {
      OPENCLAW_CONFIG_PATH: setupConfigPath,
    },
    timeout: 10_000,
  });
  if (result.status !== 0) {
    return {
      ok: false,
      error: result.stderr || result.stdout || result.error?.message || "setup-code generation failed",
    };
  }
  const output = result.stdout.trim();
  const setupCode = extractSetupCodeOutput(output);
  const diagnostics = output === setupCode
    ? ""
    : output.split(/\r?\n/).filter((line) => line.trim() !== setupCode).join("\n").trim();
  return {
    ok: true,
    setupCode,
    ...(diagnostics ? { diagnostics } : {}),
  };
}

async function startGateway(args: ParsedArgs, plan: IsolatedGatewayPlan) {
  if (args.replace) stopContainer(plan.containerName);
  const docker = runCommand("docker", plan.dockerRunArgs, { timeout: 30_000 });
  if (docker.status !== 0) {
    throw new Error(`docker run failed:\n${docker.stderr || docker.stdout || docker.error?.message}`);
  }
  const wait = await waitForGateway(plan, args.waitMs);
  if (!wait.ok) {
    throw new Error(`Gateway readiness failed: ${wait.error || "unknown error"}`);
  }
  const setup = args.setupCode && wait.ok ? setupCodeFor(plan) : { ok: false, skipped: true };
  return {
    ...planSummary(plan),
    containerId: docker.stdout.trim(),
    setup,
    wait,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "stop") {
    const result = args.containerNameProvided
      ? { list: null, stopped: stopContainer(args.containerName).status === 0 ? [args.containerName] : [] }
      : stopMatchingContainers();
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  const plan = buildGatewayPlan(args);
  preparePlanFiles(plan);

  if (args.command === "plan") {
    console.log(JSON.stringify({ ok: true, ...planSummary(plan) }, null, 2));
    return;
  }

  const result = await startGateway(args, plan);
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(errorStack(error));
    process.exit(1);
  });
}
