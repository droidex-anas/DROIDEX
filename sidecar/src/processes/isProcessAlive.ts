import { systemBootedAt } from '../liveRuntimeJournal.js';

// Boot time is derived from uptime, which drifts a little between reads.
const BOOT_TIME_DRIFT_MS = 5_000;

// Process ids are reused after a reboot, so one recorded before this boot names
// an unrelated process even when that id is alive again.
export function isRecordedProcessAlive(processId: number, recordedAtMs: number): boolean {
  return recordedAtMs >= systemBootedAt() - BOOT_TIME_DRIFT_MS && isProcessAlive(processId);
}

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
