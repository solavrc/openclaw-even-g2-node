export const RESET_PAIRING_QUERY_PARAM = "resetPairing";
export const STARTUP_URL_SETTINGS_KEY = "openclaw-even-g2-node-startup-url-settings-v1";

export type StartupUrlSettings = {
  gatewayUrl: string;
  resetPairing: boolean;
};

export type InitialPhonePanel = "voice" | "connection" | "diagnostics" | "";

export function settingsFromSearch(search: string): StartupUrlSettings {
  const params = new URLSearchParams(search);
  const gatewayUrl = params.get("gatewayUrl") || params.get("setupCode") || params.get("relayUrl") || params.get("relay") || "";
  return {
    gatewayUrl,
    resetPairing: params.get(RESET_PAIRING_QUERY_PARAM) === "1",
  };
}

export function initialPhonePanelFromSearch(search: string): InitialPhonePanel {
  const panel = new URLSearchParams(search).get("openPanel") || "";
  return panel === "voice" || panel === "connection" || panel === "diagnostics" ? panel : "";
}

export function scrubStartupUrlHref(href: string) {
  const url = new URL(href);
  let changed = false;
  for (const param of [RESET_PAIRING_QUERY_PARAM, "setupCode", "gatewayUrl", "relayUrl", "relay"]) {
    if (!url.searchParams.has(param)) continue;
    url.searchParams.delete(param);
    changed = true;
  }
  return {
    changed,
    path: `${url.pathname}${url.search}${url.hash}`,
  };
}

export function persistStartupUrlSettingsForBridge(
  settings: StartupUrlSettings,
  storage: Pick<Storage, "setItem"> = window.sessionStorage,
) {
  if (!settings.gatewayUrl && !settings.resetPairing) return;
  try {
    storage.setItem(STARTUP_URL_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Best-effort handoff for Even Hub storage; browser settings are handled immediately.
  }
}

export function consumeStartupUrlSettingsForBridge(
  storage: Pick<Storage, "getItem" | "removeItem"> = window.sessionStorage,
): StartupUrlSettings | null {
  try {
    const raw = storage.getItem(STARTUP_URL_SETTINGS_KEY);
    storage.removeItem(STARTUP_URL_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StartupUrlSettings>;
    return {
      gatewayUrl: typeof parsed.gatewayUrl === "string" ? parsed.gatewayUrl : "",
      resetPairing: parsed.resetPairing === true,
    };
  } catch {
    return null;
  }
}
