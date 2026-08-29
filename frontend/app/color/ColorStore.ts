import { Store } from "~/store/Store";
import { openChromatographDatabase } from "~/storage/Database";

/** The history occupies exactly one row in the Swatches panel. */
export const MAX_COLOR_HISTORY = 16;
export const SWATCH_COLUMNS = MAX_COLOR_HISTORY;

const STORE_NAME = "colors";
const HISTORY_KEY = "history";
const SWATCHES_KEY = "swatches";
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

interface StoredColors {
  readonly key: string;
  readonly colors: readonly string[];
}

export class ColorStore extends Store {
  private historyValue: string[] = [];
  private swatchesValue: string[] = [];
  private initialized: Promise<void> | null = null;

  get history(): readonly string[] { return this.historyValue; }
  get swatches(): readonly string[] { return this.swatchesValue; }

  initialize(): Promise<void> {
    if (this.initialized) return this.initialized;
    this.initialized = this.load().catch((error) => { this.initialized = null; throw error; });
    return this.initialized;
  }

  async remember(color: string): Promise<void> {
    await this.initialize();
    const normalized = normalizeColor(color);
    this.historyValue = [normalized, ...this.historyValue.filter((item) => item !== normalized)]
      .slice(0, MAX_COLOR_HISTORY);
    await this.persist(HISTORY_KEY, this.historyValue);
    this.notifyListeners();
  }

  async addSwatch(color: string, index = this.swatchesValue.length): Promise<void> {
    await this.initialize();
    const next = [...this.swatchesValue];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, normalizeColor(color));
    this.swatchesValue = next;
    await this.persist(SWATCHES_KEY, next);
    this.notifyListeners();
  }

  async replaceSwatch(index: number, color: string): Promise<void> {
    await this.initialize();
    if (index < 0 || index >= this.swatchesValue.length) throw new Error("Swatch not found.");
    const next = [...this.swatchesValue];
    next[index] = normalizeColor(color);
    this.swatchesValue = next;
    await this.persist(SWATCHES_KEY, next);
    this.notifyListeners();
  }

  async deleteSwatch(index: number): Promise<void> {
    await this.initialize();
    if (index < 0 || index >= this.swatchesValue.length) throw new Error("Swatch not found.");
    const next = [...this.swatchesValue];
    next.splice(index, 1);
    this.swatchesValue = next;
    await this.persist(SWATCHES_KEY, next);
    this.notifyListeners();
  }

  private async load(): Promise<void> {
    if (typeof indexedDB === "undefined") return;
    const database = await openChromatographDatabase();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const [history, swatches] = await Promise.all([
      requestResult<StoredColors | undefined>(transaction.objectStore(STORE_NAME).get(HISTORY_KEY)),
      requestResult<StoredColors | undefined>(transaction.objectStore(STORE_NAME).get(SWATCHES_KEY)),
    ]);
    this.historyValue = validColors(history?.colors).slice(0, MAX_COLOR_HISTORY);
    this.swatchesValue = validColors(swatches?.colors);
    this.notifyListeners();
  }

  private async persist(key: string, colors: readonly string[]): Promise<void> {
    if (typeof indexedDB === "undefined") return;
    const database = await openChromatographDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ key, colors } satisfies StoredColors);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
}

function normalizeColor(color: string): string {
  if (!COLOR_PATTERN.test(color)) throw new Error("Invalid color.");
  return color.toLowerCase();
}

function validColors(colors: readonly string[] | undefined): string[] {
  return (colors ?? []).filter((color) => COLOR_PATTERN.test(color)).map((color) => color.toLowerCase());
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
