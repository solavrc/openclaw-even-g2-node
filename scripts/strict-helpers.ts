export function errorStack(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error);
}
