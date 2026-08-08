export interface Disposable {
  dispose(): void;
  [Symbol.dispose](): void;
}
