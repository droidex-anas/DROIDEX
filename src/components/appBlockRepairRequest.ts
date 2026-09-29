export async function requestAppBlockRepair({
  canSend,
  prepare,
  send,
}: {
  canSend: () => boolean;
  prepare: () => Promise<void>;
  send: () => void;
}): Promise<void> {
  if (!canSend()) throw new Error('This chat is busy or not ready yet.');
  await prepare();
  if (!canSend()) throw new Error('The chat changed while the fix was being prepared.');
  send();
}
