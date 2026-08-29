import { Store } from "~/store/Store";
import { openChromatographDatabase } from "~/storage/Database";
import { Identity } from "./Identity";

export interface KeySummary {
  readonly id: string;
  readonly name: string;
  readonly publicKeyHex: string;
  readonly createdAt: number;
}

interface StoredKey extends KeySummary {
  readonly privateKey: JsonWebKey;
  readonly publicKey: JsonWebKey;
}

export interface ExportedKeyFile {
  readonly format: "chromatograph-signing-key";
  readonly version: 1;
  readonly name: string;
  readonly createdAt: number;
  readonly privateKey: JsonWebKey;
  readonly publicKey: JsonWebKey;
}

const KEY_STORE = "signing-keys";
const PREFERENCES_STORE = "preferences";
const ACTIVE_KEY = "active-signing-key";

export class KeyringStore extends Store {
  private records: StoredKey[] = [];
  private activeId: string | null = null;
  private initialized: Promise<void> | null = null;

  get keys(): readonly KeySummary[] { return this.records; }
  get activeKeyId(): string | null { return this.activeId; }

  initialize(): Promise<void> {
    if (this.initialized) return this.initialized;
    this.initialized = this.load().catch((error) => {
      this.initialized = null;
      throw error;
    });
    return this.initialized;
  }

  async generate(name?: string): Promise<KeySummary> {
    await this.initialize();
    const identity = await Identity.generate();
    const jwk = await identity.exportJwk();
    const record: StoredKey = {
      id: crypto.randomUUID(),
      name: name?.trim() || `Signing key ${this.records.length + 1}`,
      publicKeyHex: identity.publicKeyHex,
      createdAt: Date.now(),
      ...jwk,
    };
    await this.put(record);
    this.records = [...this.records, record];
    if (!this.activeId) await this.select(record.id);
    else this.notifyListeners();
    return record;
  }

  async select(id: string): Promise<void> {
    await this.initialize();
    if (!this.records.some((key) => key.id === id)) throw new Error("Signing key not found.");
    const database = await openChromatographDatabase();
    await transactionComplete(database, PREFERENCES_STORE, "readwrite", (store) => {
      store.put({ key: ACTIVE_KEY, value: id });
    });
    this.activeId = id;
    this.notifyListeners();
  }

  async deleteKey(id: string): Promise<void> {
    await this.initialize();
    const record = this.records.find((key) => key.id === id);
    if (!record) throw new Error("Signing key not found.");

    const remaining = this.records.filter((key) => key.id !== id);
    const nextActiveId = this.activeId === id ? remaining[0]?.id ?? null : this.activeId;
    if (typeof indexedDB !== "undefined") {
      const database = await openChromatographDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction([KEY_STORE, PREFERENCES_STORE], "readwrite");
        transaction.objectStore(KEY_STORE).delete(id);
        const preferences = transaction.objectStore(PREFERENCES_STORE);
        if (nextActiveId) preferences.put({ key: ACTIVE_KEY, value: nextActiveId });
        else preferences.delete(ACTIVE_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }
    this.records = remaining;
    this.activeId = nextActiveId;
    this.notifyListeners();
  }

  async activeIdentity(): Promise<Identity> {
    await this.initialize();
    if (!this.activeId) await this.generate("Primary signing key");
    const record = this.records.find((key) => key.id === this.activeId);
    if (!record) throw new Error("No active signing key.");
    return Identity.fromJwk(record.privateKey, record.publicKey);
  }

  async exportKey(id: string): Promise<ExportedKeyFile> {
    await this.initialize();
    const record = this.records.find((key) => key.id === id);
    if (!record) throw new Error("Signing key not found.");
    return { format: "chromatograph-signing-key", version: 1, name: record.name,
      createdAt: record.createdAt, privateKey: record.privateKey, publicKey: record.publicKey };
  }

  async importKey(value: unknown): Promise<KeySummary> {
    await this.initialize();
    const file = validateKeyFile(value);
    const identity = await Identity.fromJwk(file.privateKey, file.publicKey);
    const existing = this.records.find((key) => key.publicKeyHex === identity.publicKeyHex);
    if (existing) throw new Error("This key is already in the keyring.");
    const record: StoredKey = { id: crypto.randomUUID(), name: file.name.trim() || "Imported key",
      createdAt: file.createdAt, publicKeyHex: identity.publicKeyHex,
      privateKey: file.privateKey, publicKey: file.publicKey };
    await this.put(record);
    this.records = [...this.records, record];
    if (!this.activeId) await this.select(record.id);
    else this.notifyListeners();
    return record;
  }

  private async load(): Promise<void> {
    if (typeof indexedDB === "undefined") {
      const identity = await Identity.generate();
      const jwk = await identity.exportJwk();
      this.records = [{ id: crypto.randomUUID(), name: "Primary signing key", createdAt: Date.now(),
        publicKeyHex: identity.publicKeyHex, ...jwk }];
      this.activeId = this.records[0]!.id;
      this.notifyListeners();
      return;
    }
    const database = await openChromatographDatabase();
    const [records, preference] = await Promise.all([
      requestResult<StoredKey[]>(database.transaction(KEY_STORE).objectStore(KEY_STORE).getAll()),
      requestResult<{ key: string; value: string } | undefined>(
        database.transaction(PREFERENCES_STORE).objectStore(PREFERENCES_STORE).get(ACTIVE_KEY)),
    ]);
    this.records = records.sort((a, b) => a.createdAt - b.createdAt);
    this.activeId = this.records.some((key) => key.id === preference?.value) ? preference!.value : this.records[0]?.id ?? null;
    if (this.activeId && preference?.value !== this.activeId) {
      await transactionComplete(database, PREFERENCES_STORE, "readwrite", (store) => {
        store.put({ key: ACTIVE_KEY, value: this.activeId });
      });
    }
    this.notifyListeners();
  }

  private async put(record: StoredKey): Promise<void> {
    if (typeof indexedDB === "undefined") return;
    const database = await openChromatographDatabase();
    await transactionComplete(database, KEY_STORE, "readwrite", (store) => { store.put(record); });
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(database: IDBDatabase, storeName: string, mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    action(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function validateKeyFile(value: unknown): ExportedKeyFile {
  if (!value || typeof value !== "object") throw new Error("Invalid key file.");
  const file = value as Partial<ExportedKeyFile>;
  if (file.format !== "chromatograph-signing-key" || file.version !== 1 ||
      typeof file.name !== "string" || typeof file.createdAt !== "number" ||
      !file.privateKey || !file.publicKey) throw new Error("Unsupported or invalid key file.");
  return file as ExportedKeyFile;
}
