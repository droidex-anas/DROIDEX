export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A user Stop/interrupt makes the SDK stream throw (a cancellation message or an
// AbortError). That is a deliberate stop, not a failure, so callers must settle
// quietly instead of surfacing it as an error.
export function isUserCancellation(err: unknown): boolean {
  if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') return true;
  const m = errMsg(err).toLowerCase();
  return (
    m.includes('interrupted by user') ||
    m.includes('cancelled by user') ||
    m.includes('canceled by user') ||
    m.includes('request interrupted') ||
    m.includes('request cancelled') ||
    m.includes('request canceled')
  );
}
