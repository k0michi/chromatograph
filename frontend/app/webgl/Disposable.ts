import SymbolHelper from "~/polyfills/SymbolHelper";

export interface Disposable {
  dispose(): void;
  [SymbolHelper.dispose](): void;
}
