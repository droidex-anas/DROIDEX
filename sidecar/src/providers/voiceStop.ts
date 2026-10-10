// Long enough for a healthy round trip, short enough that closing a chat
// never feels stuck on it.
const STOP_DEADLINE_MS = 3_000;

// Reject on a stalled stop so the caller can release or retire the runtime.
export function stopVoiceWithDeadline(work: Promise<void> | undefined): Promise<void> {
  if (!work) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Codex did not answer the request to end the conversation.'));
    }, STOP_DEADLINE_MS);
    timer.unref();
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer);
    });
  });
}
