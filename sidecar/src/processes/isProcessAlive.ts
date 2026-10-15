// Signal 0 checks for a process without touching it; EPERM still means alive.
export function isProcessAlive(processId: number): boolean {
  if (processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ESRCH'
    );
  }
}
