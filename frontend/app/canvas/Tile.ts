import type { BindGroup } from "~/webgl/BindGroup";
import type { Framebuffer } from "~/webgl/Framebuffer";
import type { Texture } from "~/webgl/Texture";
import type { BlendOperation, Operation } from "./Operation";

export const TILE_SIZE = 256;

export interface TileSnapshot {
  texture: Texture;
  bindGroup: BindGroup;
  framebuffer: Framebuffer;
}

export interface TileOperationEntry {
  readonly patchHash: string;
  readonly op: Operation;
}

export class Tile {
  readonly operationEntries: TileOperationEntry[] = [];
  snapshot: TileSnapshot | null = null;

  constructor(
    readonly x: number,
    readonly y: number,
  ) { }

  addOperation(patchHash: string, op: Operation): TileOperationEntry {
    const entry: TileOperationEntry = { patchHash, op };
    this.operationEntries.push(entry);
    return entry;
  }

  resolveActiveBlendEntries(): readonly (TileOperationEntry & { readonly op: BlendOperation })[] {
    const byHash = new Map(this.operationEntries.map((entry) => [entry.patchHash, entry]));
    const activeHashes = new Set(
      this.operationEntries
        .filter((entry) => entry.op.type === "blend")
        .map((entry) => entry.patchHash),
    );

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
      const parentSubjects = entry.op.parents
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

    const undoEntries = this.operationEntries
      .filter((entry) => entry.op.type === "undo")
      .sort((a, b) => a.patchHash.localeCompare(b.patchHash));
    for (const undo of undoEntries) {
      const parentSubjects = undo.op.parents
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
      for (const targetHash of first.blendHashes) {
        if (activeHashes.has(targetHash)) {
          activeHashes.delete(targetHash);
        } else {
          activeHashes.add(targetHash);
        }
      }
    }

    return this.operationEntries
      .filter((entry): entry is TileOperationEntry & { readonly op: BlendOperation } =>
        entry.op.type === "blend" && activeHashes.has(entry.patchHash))
      .sort((a, b) => a.patchHash.localeCompare(b.patchHash));
  }
}
