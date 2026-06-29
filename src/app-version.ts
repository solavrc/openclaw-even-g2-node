declare const __OPENCLAW_EVEN_G2_VERSION__: string | undefined;

export const APP_VERSION = typeof __OPENCLAW_EVEN_G2_VERSION__ === "undefined"
  ? "0.0.0-dev"
  : __OPENCLAW_EVEN_G2_VERSION__;
