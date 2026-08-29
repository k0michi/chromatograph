import type { BindGroup } from "~/webgl/BindGroup";
import type { Framebuffer } from "~/webgl/Framebuffer";
import type { Texture } from "~/webgl/Texture";
import { ROOT_PATCH_HASH, type RenderableBlendOperation, type RenderableOperation } from "./Operation";

export const TILE_SIZE = 256;

export interface TileSnapshot {
  texture: Texture;
  bindGroup: BindGroup;
  framebuffer: Framebuffer;
}

export interface TileOperationEntry {
  readonly patchHash: string;
  readonly op: RenderableOperation;
}

export class Tile {
  readonly operationEntries: TileOperationEntry[] = [];
  snapshot: TileSnapshot | null = null;
  baseSnapshot: TileSnapshot | null = null;
  headPatchHash: string | null = null;
  containsEntireOperationOrder = false;
  isActive = false;

  constructor(
    readonly x: number,
    readonly y: number,
  ) { }

  addOperation(patchHash: string, op: RenderableOperation): TileOperationEntry {
    const entry: TileOperationEntry = { patchHash, op };
    this.operationEntries.push(entry);
    return entry;
  }

  /** Last node of the deterministic, hash-sorted depth-first linearization. */
  resolveHeadPatchHash(): string | null {
    const byHash = new Map(this.operationEntries.map((entry) => [entry.patchHash, entry]));
    const children = new Map<string, TileOperationEntry[]>();
    const roots: TileOperationEntry[] = [];
    for (const entry of this.operationEntries) {
      const parent = entry.op.type === "blend" ? entry.op.parent : entry.op.targetPatchHash;
      if (parent === ROOT_PATCH_HASH || !byHash.has(parent)) roots.push(entry);
      else {
        const values = children.get(parent) ?? [];
        values.push(entry);
        children.set(parent, values);
      }
    }
    let last: string | null = null;
    const visited = new Set<string>();
    const visit = (entry: TileOperationEntry): void => {
      if (!visited.add(entry.patchHash)) return;
      last = entry.patchHash;
      for (const child of (children.get(entry.patchHash) ?? []).sort((a, b) => a.patchHash.localeCompare(b.patchHash))) visit(child);
    };
    for (const root of roots.sort((a, b) => a.patchHash.localeCompare(b.patchHash))) visit(root);
    if (visited.size !== this.operationEntries.length) throw new Error("A cycle was found in the Patch DAG.");
    return last;
  }

  resolveActiveBlendEntries(): readonly (TileOperationEntry & { readonly op: RenderableBlendOperation })[] {
    const byHash = new Map(this.operationEntries.map((entry) => [entry.patchHash, entry]));
    const childrenByHash = new Map<string, TileOperationEntry[]>();
    const parentCountByHash = new Map<string, number>();

    for (const entry of this.operationEntries) {
      const parent = entry.op.type === "blend" ? entry.op.parent : entry.op.targetPatchHash;
      const parents = parent === ROOT_PATCH_HASH || !byHash.has(parent) ? [] : [parent];
      parentCountByHash.set(entry.patchHash, parents.length);
      for (const parent of parents) {
        const children = childrenByHash.get(parent) ?? [];
        children.push(entry);
        childrenByHash.set(parent, children);
      }
    }

    interface UndoSubject {
      readonly blendHashes: readonly string[];
      readonly visible: boolean;
    }

    const sameHashes = (a: readonly string[], b: readonly string[]): boolean =>
      a.length === b.length && a.every((hash, index) => hash === b[index]);

    const resolveUndoSubject = (hash: string, visiting = new Set<string>()): UndoSubject | null => {
      if (visiting.has(hash)) {
        throw new Error(`A cycle was found in the Patch DAG at ${hash}.`);
      }
      const entry = byHash.get(hash);
      if (!entry) {
        return null;
      }
      if (entry.op.type === "blend") {
        return { blendHashes: [hash], visible: true };
      }
      const nextVisiting = new Set(visiting).add(hash);
      const parentSubjects = [entry.op.targetPatchHash]
        .map((parent) => resolveUndoSubject(parent, nextVisiting))
        .filter((subject): subject is UndoSubject => subject !== null);
      const first = parentSubjects[0];
      if (!first) {
        return null;
      }
      for (const subject of parentSubjects.slice(1)) {
        if (!sameHashes(subject.blendHashes, first.blendHashes) || subject.visible !== first.visible) {
          throw new Error(`Undo ${hash} has parents that do not represent the same Blend state.`);
        }
      }
      return { blendHashes: first.blendHashes, visible: !first.visible };
    };

    for (const undo of this.operationEntries) {
      if (undo.op.type !== "undo") continue;
      const parentSubjects = [undo.op.targetPatchHash]
        .map((parent) => resolveUndoSubject(parent))
        .filter((subject): subject is UndoSubject => subject !== null);
      const first = parentSubjects[0];
      if (!first) {
        continue;
      }
      for (const subject of parentSubjects.slice(1)) {
        if (!sameHashes(subject.blendHashes, first.blendHashes) || subject.visible !== first.visible) {
          throw new Error(`Undo ${undo.patchHash} has parents that do not represent the same Blend state.`);
        }
      }
    }

    const isActive = (blendHash: string): boolean => {
      interface UndoChain {
        readonly maximumHash: string;
        readonly length: number;
      }

      const chainsFrom = (hash: string, maximumHash: string, length: number, visiting: ReadonlySet<string>): UndoChain[] => {
        if (visiting.has(hash)) {
          throw new Error(`A cycle was found in the Patch DAG at ${hash}.`);
        }
        const undoChildren = (childrenByHash.get(hash) ?? []).filter((entry) => entry.op.type === "undo");
        if (undoChildren.length === 0) {
          return [{ maximumHash, length }];
        }
        const nextVisiting = new Set(visiting).add(hash);
        return undoChildren.flatMap((entry) =>
          chainsFrom(entry.patchHash, maximumHash > entry.patchHash ? maximumHash : entry.patchHash, length + 1, nextVisiting));
      };

      const chains = chainsFrom(blendHash, "", 0, new Set());
      const winner = chains.reduce((current, candidate) =>
        candidate.maximumHash > current.maximumHash ? candidate : current);
      return winner.length % 2 === 0;
    };

    const roots = this.operationEntries
      .filter((entry) => parentCountByHash.get(entry.patchHash) === 0)
      .sort((a, b) => a.patchHash.localeCompare(b.patchHash));
    const ordered: TileOperationEntry[] = [];
    const visited = new Set<string>();
    const visit = (entry: TileOperationEntry): void => {
      if (visited.has(entry.patchHash)) {
        return;
      }
      visited.add(entry.patchHash);
      ordered.push(entry);
      for (const child of (childrenByHash.get(entry.patchHash) ?? []).sort((a, b) => a.patchHash.localeCompare(b.patchHash))) {
        visit(child);
      }
    };
    for (const root of roots) {
      visit(root);
    }
    if (visited.size !== this.operationEntries.length) {
      throw new Error("A cycle was found in the Patch DAG.");
    }

    return ordered.filter((entry): entry is TileOperationEntry & { readonly op: RenderableBlendOperation } =>
      entry.op.type === "blend" && isActive(entry.patchHash));
  }
}
