import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canvasError, storageFailure } from './canvasError.js';

const OWNER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CanvasWriterLease {
  private constructor(
    readonly directory: string,
    private db: DatabaseSync | null,
    private readonly owner: string,
  ) {}

  static async acquire(directory: string): Promise<CanvasWriterLease> {
    let db: DatabaseSync | undefined;
    try {
      await mkdir(directory, { recursive: true });
      const root = await realpath(directory);
      const dbPath = join(root, '.writer-lease.sqlite');
      const stats = lstatSync(dbPath, { throwIfNoEntry: false });
      if (stats && !stats.isFile()) {
        throw canvasError('storage_failed', 'The Canvas writer lease is not a regular file.');
      }

      db = new DatabaseSync(dbPath);
      db.exec('BEGIN IMMEDIATE');
      db.exec(`
        CREATE TABLE IF NOT EXISTS writer_lease (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          owner TEXT NOT NULL,
          process_id INTEGER NOT NULL
        ) STRICT
      `);
      const rows = db.prepare('SELECT id, owner, process_id FROM writer_lease').all();
      const current = rows.at(0);
      if (current) {
        if (
          rows.length !== 1 ||
          current.id !== 1 ||
          typeof current.owner !== 'string' ||
          !OWNER_UUID.test(current.owner) ||
          typeof current.process_id !== 'number' ||
          !Number.isSafeInteger(current.process_id) ||
          current.process_id <= 0
        ) {
          throw canvasError('storage_failed', 'The saved Canvas writer lease is invalid.');
        }
        if (isProcessAlive(current.process_id)) {
          throw canvasError(
            'storage_failed',
            'The Canvas storage directory is already open in another workspace.',
          );
        }
      }

      const owner = randomUUID();
      db.prepare(
        `
        INSERT INTO writer_lease (id, owner, process_id) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          owner = excluded.owner,
          process_id = excluded.process_id
      `,
      ).run(owner, process.pid);
      db.exec('COMMIT');
      return new CanvasWriterLease(root, db, owner);
    } catch (error) {
      // Closing also rolls back an uncommitted claim.
      db?.close();
      throw storageFailure('Canvas storage could not be opened.', error);
    }
  }

  release(): void {
    const db = this.db;
    if (!db) return;
    this.db = null;
    try {
      if (lstatSync(join(this.directory, '.writer-lease.sqlite'), { throwIfNoEntry: false }))
        db.prepare('DELETE FROM writer_lease WHERE id = 1 AND owner = ?').run(this.owner);
    } catch (error) {
      throw storageFailure('Canvas storage could not release its writer lease.', error);
    } finally {
      db.close();
    }
  }
}

function isProcessAlive(processId: number): boolean {
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
