export type WindowTimeoutRef = {
  current: number | null;
};

export function clearWindowTimeoutRef(timerRef: WindowTimeoutRef) {
  const timer = timerRef.current;
  if (timer === null) return false;
  window.clearTimeout(timer);
  timerRef.current = null;
  return true;
}
