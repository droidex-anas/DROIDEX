import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ImageRequests } from './kitImageImport';

function controlled<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test('the newest cover choice wins, and no request reaches a view that has left', async () => {
  const requests = new ImageRequests<string>();
  const delivered: string[] = [];
  requests.setTarget((asset) => delivered.push(`first view: ${asset}`));

  const older = controlled<string | null>();
  const newer = controlled<string | null>();
  const olderSettled = requests.replace(older.promise);
  const newerSettled = requests.replace(newer.promise);
  newer.resolve('newer');
  await newerSettled;
  older.resolve('older');
  await olderSettled;
  assert.deepEqual(delivered, ['first view: newer']);

  const dropped = controlled<string | null>();
  const droppedSettled = requests.add(dropped.promise);
  requests.setTarget((asset) => delivered.push(`saved view: ${asset}`));
  dropped.resolve('dropped');
  await droppedSettled;
  assert.deepEqual(delivered, ['first view: newer', 'saved view: dropped']);

  const late = controlled<string | null>();
  const lateSettled = requests.add(late.promise);
  requests.setTarget(null);
  late.resolve('late');
  await lateSettled;
  assert.equal(delivered.length, 2);
});
