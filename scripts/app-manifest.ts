export type EvenHubPermission = {
  name?: unknown;
  whitelist?: unknown;
};

export type EvenHubManifestWithPermissions = {
  permissions?: unknown;
};

export function appManifestNetworkWhitelist(manifest: EvenHubManifestWithPermissions | unknown): string[] {
  if (!manifest || typeof manifest !== "object") return [];
  const permissions = (manifest as EvenHubManifestWithPermissions).permissions;
  if (!Array.isArray(permissions)) return [];
  const networkPermission = permissions.find((permission: unknown) => (
    permission &&
    typeof permission === "object" &&
    (permission as EvenHubPermission).name === "network"
  ));
  if (!networkPermission || typeof networkPermission !== "object") return [];
  const whitelist = (networkPermission as EvenHubPermission).whitelist;
  return Array.isArray(whitelist)
    ? whitelist.filter((origin): origin is string => typeof origin === "string")
    : [];
}
