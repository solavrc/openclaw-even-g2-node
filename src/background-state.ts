type Snapshotter = () => unknown;
type Restorer = (snapshot: unknown) => void;

type BackgroundStateGlobal = typeof globalThis & {
  __getStateSnapshot?: () => string;
  __restoreState?: (snapshot: unknown) => void;
};

const snapshotters = new Map<string, Snapshotter>();
const restorers = new Map<string, Restorer>();
const pendingRestores = new Map<string, unknown>();
let globalsInstalled = false;

function logBackgroundStateError(message: string, err: unknown) {
  if (import.meta.env.DEV) globalThis["console"].error(message, err);
}

function serializeBackgroundSnapshots() {
  const payload: Record<string, unknown> = {};
  for (const [key, snapshotter] of snapshotters) {
    try {
      const snapshot = snapshotter();
      JSON.stringify(snapshot);
      payload[key] = snapshot;
    } catch (err) {
      logBackgroundStateError(`[background-state] snapshot failed for ${key}`, err);
    }
  }
  try {
    return JSON.stringify(payload);
  } catch (err) {
    logBackgroundStateError("[background-state] snapshot serialization failed", err);
    return "{}";
  }
}

function parseBackgroundRestoreSnapshot(rawSnapshot: unknown) {
  try {
    const value = typeof rawSnapshot === "string" ? JSON.parse(rawSnapshot) as unknown : rawSnapshot;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch (err) {
    logBackgroundStateError("[background-state] restore parse failed", err);
    return null;
  }
}

function restoreBackgroundSnapshot(parsed: Record<string, unknown>) {
  for (const [key, snapshot] of Object.entries(parsed)) {
    const restorer = restorers.get(key);
    if (!restorer) {
      pendingRestores.set(key, snapshot);
      continue;
    }
    try {
      restorer(snapshot);
    } catch (err) {
      logBackgroundStateError(`[background-state] restore failed for ${key}`, err);
    }
  }
}

function installBackgroundStateGlobals() {
  if (globalsInstalled || typeof globalThis === "undefined") return;
  const target = globalThis as BackgroundStateGlobal;

  target.__getStateSnapshot = serializeBackgroundSnapshots;

  target.__restoreState = (rawSnapshot: unknown) => {
    const parsed = parseBackgroundRestoreSnapshot(rawSnapshot);
    if (parsed) restoreBackgroundSnapshot(parsed);
  };

  globalsInstalled = true;
}

installBackgroundStateGlobals();

export function setBackgroundState(key: string, snapshotter: Snapshotter) {
  snapshotters.set(key, snapshotter);
  return () => {
    if (snapshotters.get(key) === snapshotter) snapshotters.delete(key);
  };
}

export function onBackgroundRestore(key: string, restorer: Restorer) {
  restorers.set(key, restorer);
  if (pendingRestores.has(key)) {
    const snapshot = pendingRestores.get(key);
    pendingRestores.delete(key);
    try {
      restorer(snapshot);
    } catch (err) {
      logBackgroundStateError(`[background-state] buffered restore failed for ${key}`, err);
    }
  }
  return () => {
    if (restorers.get(key) === restorer) restorers.delete(key);
  };
}

export function _resetBackgroundStateForTests() {
  snapshotters.clear();
  restorers.clear();
  pendingRestores.clear();
}

export function _backgroundStateGlobalsInstalledForTests() {
  return globalsInstalled;
}
