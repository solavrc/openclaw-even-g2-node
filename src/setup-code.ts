import { parseSetupCode } from "./gateway-direct";

export function setupCodeFromQrValue(value: string) {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("setupCode")
      || url.searchParams.get("gatewayUrl")
      || url.searchParams.get("relayUrl")
      || url.searchParams.get("relay")
      || trimmed;
  } catch {
    return trimmed;
  }
}

export function storageSafeGatewayUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const normalized = setupCodeFromQrValue(trimmed);
    const parsed = parseSetupCode(normalized);
    return parsed.bootstrapToken || parsed.url !== normalized ? parsed.url : trimmed;
  } catch {
    return trimmed;
  }
}
