import React, { useSyncExternalStore } from "react";

/** A data store modeled after Flutter's ChangeNotifier. */
export class Store {
  private readonly listeners = new Set<() => void>();
  private currentVersion = 0;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyListeners(): void {
    this.currentVersion = (this.currentVersion + 1) % Number.MAX_SAFE_INTEGER;
    for (const listener of this.listeners) listener();
  }

  get version(): number {
    return this.currentVersion;
  }
}

type StoreConstructor<T extends Store = Store> = new (...args: any[]) => T;
type StoreRegistry = Map<Function, Store>;

const StoreRegistryContext = React.createContext<StoreRegistry | null>(null);

export function StoreProvider<T extends Store>({
  create,
  children,
}: {
  readonly create: () => T;
  readonly children: React.ReactNode;
}) {
  const parentRegistry = React.useContext(StoreRegistryContext);
  const [store] = React.useState(create);

  const registry = React.useMemo(() => {
    const nextRegistry = new Map(parentRegistry ?? []);
    nextRegistry.set(store.constructor, store);
    return nextRegistry;
  }, [parentRegistry, store]);

  return <StoreRegistryContext.Provider value={registry}>{children}</StoreRegistryContext.Provider>;
}

export function useReader<T extends Store>(StoreClass: StoreConstructor<T>): T {
  const registry = React.useContext(StoreRegistryContext);
  if (registry === null) throw new Error("useReader must be used within a StoreProvider");
  const store = registry.get(StoreClass);
  if (store === undefined) throw new Error(`No store found for ${StoreClass.name}`);
  return store as T;
}

export function useWatcher<T extends Store>(StoreClass: StoreConstructor<T>): T {
  const store = useReader(StoreClass);
  useSyncExternalStore(
    (onStoreChange) => store.subscribe(onStoreChange),
    () => store.version,
    () => store.version,
  );
  return store;
}

export function useSelector<T extends Store, U>(
  StoreClass: StoreConstructor<T>,
  selector: (store: T) => U,
): U {
  const store = useReader(StoreClass);
  return useSyncExternalStore(
    (onStoreChange) => store.subscribe(onStoreChange),
    () => selector(store),
    () => selector(store),
  );
}
