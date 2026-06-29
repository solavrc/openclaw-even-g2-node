type LockMode = "exclusive" | "shared";

type WebLocksLike = {
  request(name: string, callback: () => Promise<void>): Promise<unknown>;
  request(name: string, options: { mode?: LockMode }, callback: () => Promise<void>): Promise<unknown>;
};

type NavigatorWithLocks = Navigator & {
  locks?: WebLocksLike;
};

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export type KeepAliveState = {
  audio: "active" | "failed" | "unsupported" | "inactive";
  lock: "active" | "failed" | "unsupported" | "inactive";
};

const DEFAULT_LOCK_NAME = "openclaw-even-g2-node-keep-alive";
const QUIET_GAIN = 0.001;
const QUIET_FREQUENCY_HZ = 1;

let audioContext: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;
let gainNode: GainNode | null = null;
let lockActive = false;
let lockRequestStarted = false;
let lockRelease: (() => void) | null = null;
let lockRequestGeneration = 0;
let audioFailed = false;
let lockFailed = false;

function audioContextConstructor() {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ?? (window as WindowWithWebkitAudioContext).webkitAudioContext;
}

export function activateKeepAlive(lockName = DEFAULT_LOCK_NAME): KeepAliveState {
  if (!audioContext) {
    try {
      const AudioContextCtor = audioContextConstructor();
      if (AudioContextCtor) {
        audioContext = new AudioContextCtor();
        oscillator = audioContext.createOscillator();
        gainNode = audioContext.createGain();
        oscillator.frequency.value = QUIET_FREQUENCY_HZ;
        gainNode.gain.value = QUIET_GAIN;
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.start();
        audioContext.addEventListener("statechange", () => {
          if (audioContext?.state === "suspended") void audioContext.resume().catch(() => undefined);
        });
        audioFailed = false;
      }
    } catch {
      audioFailed = true;
      audioContext = null;
      oscillator = null;
      gainNode = null;
    }
  }

  const locks = typeof navigator === "undefined" ? undefined : (navigator as NavigatorWithLocks).locks;
  if (!lockRequestStarted && locks) {
    lockRequestStarted = true;
    lockFailed = false;
    const generation = ++lockRequestGeneration;
    void locks.request(lockName, { mode: "exclusive" }, () => {
      if (generation !== lockRequestGeneration) return Promise.resolve();
      lockActive = true;
      return new Promise<void>((resolve) => {
        lockRelease = () => {
          lockRelease = null;
          resolve();
        };
      });
    }).then(() => {
      if (generation !== lockRequestGeneration) return;
      lockActive = false;
      lockRequestStarted = false;
      lockRelease = null;
    }).catch(() => {
      if (generation !== lockRequestGeneration) return;
      lockFailed = true;
      lockActive = false;
      lockRequestStarted = false;
      lockRelease = null;
    });
  }

  return keepAliveState();
}

export function deactivateKeepAlive() {
  if (oscillator) {
    try {
      oscillator.stop();
    } catch {
      // Already stopped.
    }
  }
  oscillator = null;
  if (gainNode) {
    try {
      gainNode.disconnect();
    } catch {
      // Already disconnected.
    }
  }
  gainNode = null;
  if (audioContext) {
    void audioContext.close().catch(() => undefined);
  }
  audioContext = null;
  const releaseLock = lockRelease;
  lockRequestGeneration += 1;
  lockRelease = null;
  lockActive = false;
  lockRequestStarted = false;
  releaseLock?.();
}

export function keepAliveState(): KeepAliveState {
  const hasAudioSupport = Boolean(audioContextConstructor());
  const hasLockSupport = Boolean(typeof navigator !== "undefined" && (navigator as NavigatorWithLocks).locks);
  return {
    audio: audioContext ? "active" : audioFailed ? "failed" : hasAudioSupport ? "inactive" : "unsupported",
    lock: lockActive ? "active" : lockFailed ? "failed" : hasLockSupport ? "inactive" : "unsupported",
  };
}

export function resetKeepAliveForTests() {
  oscillator = null;
  gainNode = null;
  audioContext = null;
  const releaseLock = lockRelease;
  lockRequestGeneration += 1;
  lockRelease = null;
  lockActive = false;
  lockRequestStarted = false;
  releaseLock?.();
  audioFailed = false;
  lockFailed = false;
}
