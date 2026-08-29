import { openChromatographDatabase } from "~/storage/Database";

export interface OutboxPatch {
  readonly hash: string;
  readonly packet: Uint8Array<ArrayBuffer>;
}

export interface PatchOutbox {
  put(patch: OutboxPatch): Promise<void>;
  delete(hash: string): Promise<void>;
  entries(): Promise<readonly OutboxPatch[]>;
}

interface StoredPatch {
  readonly id?: number;
  readonly hash: string;
  readonly packet: ArrayBuffer;
}

const STORE_NAME = "patch-outbox";
const HASH_INDEX = "hash";

export class IndexedDbPatchOutbox implements PatchOutbox {
  private databasePromise: Promise<IDBDatabase> | null = null;

  async put(patch: OutboxPatch): Promise<void> {
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const lookup = store.index(HASH_INDEX).getKey(patch.hash);
      lookup.onerror = () => reject(lookup.error);
      lookup.onsuccess = () => {
        if (lookup.result === undefined) {
          store.add({ hash: patch.hash, packet: patch.packet.slice().buffer } satisfies StoredPatch);
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async delete(hash: string): Promise<void> {
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const lookup = store.index(HASH_INDEX).getKey(hash);
      lookup.onerror = () => reject(lookup.error);
      lookup.onsuccess = () => {
        if (lookup.result !== undefined) store.delete(lookup.result);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async entries(): Promise<readonly OutboxPatch[]> {
    const database = await this.database();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as StoredPatch[]).map((stored) => ({
        hash: stored.hash,
        packet: new Uint8Array(stored.packet.slice(0)),
      })));
      request.onerror = () => reject(request.error);
    });
  }

  private database(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      void openChromatographDatabase().then(resolve, reject);
    });
    return this.databasePromise;
  }
}

export class MemoryPatchOutbox implements PatchOutbox {
  private readonly patches = new Map<string, OutboxPatch>();

  put(patch: OutboxPatch): Promise<void> {
    if (!this.patches.has(patch.hash)) {
      this.patches.set(patch.hash, { hash: patch.hash, packet: patch.packet.slice() });
    }
    return Promise.resolve();
  }

  delete(hash: string): Promise<void> {
    this.patches.delete(hash);
    return Promise.resolve();
  }

  entries(): Promise<readonly OutboxPatch[]> {
    return Promise.resolve([...this.patches.values()].map((patch) => ({
      hash: patch.hash,
      packet: patch.packet.slice(),
    })));
  }
}

export function createPatchOutbox(): PatchOutbox {
  return typeof indexedDB === "undefined" ? new MemoryPatchOutbox() : new IndexedDbPatchOutbox();
}
