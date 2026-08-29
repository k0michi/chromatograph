export const DATABASE_NAME = "chromatograph";
export const DATABASE_VERSION = 3;

let databasePromise: Promise<IDBDatabase> | null = null;

/** The single upgrade path for all of Chromatograph's persistent browser data. */
export function openChromatographDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("patch-outbox")) {
        const outbox = database.createObjectStore("patch-outbox", { keyPath: "id", autoIncrement: true });
        outbox.createIndex("hash", "hash", { unique: true });
      }
      if (!database.objectStoreNames.contains("signing-keys")) {
        database.createObjectStore("signing-keys", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("preferences")) {
        database.createObjectStore("preferences", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("colors")) {
        database.createObjectStore("colors", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error);
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("Chromatograph database upgrade was blocked by another tab."));
    };
  });
  return databasePromise;
}
