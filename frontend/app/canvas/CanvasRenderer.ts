import { mat3 } from "gl-matrix";
import { Identity } from "~/crypto/Identity";
import type { BindGroup } from "~/webgl/BindGroup";
import type { BindGroupLayout } from "~/webgl/BindGroupLayout";
import { Context, type RenderPassTarget } from "~/webgl/Context";
import type { Device } from "~/webgl/Device";
import type { RenderPassEncoder } from "~/webgl/RenderPassEncoder";
import type { RenderPipeline } from "~/webgl/RenderPipeline";
import { ShaderStage } from "~/webgl/ShaderStage";
import type { Texture } from "~/webgl/Texture";
import { Camera2D } from "./Camera2D";
import {
  CANVAS_DISPLAY_FRAGMENT_SHADER,
  CANVAS_VERTEX_SHADER,
  SNAPSHOT_COPY_FRAGMENT_SHADER,
  STRAIGHT_COMPOSITE_FRAGMENT_SHADER,
  TILE_GRID_FRAGMENT_SHADER,
} from "./CanvasShaders";
import { CHUNK_VIEW_PROJECTION, worldToChunkPosition } from "./chunkSpace";
import { CompositeOp, type BlendOperation, type UndoOperation } from "./Operation";
import { Patch } from "./Patch";
import { QuadGeometry } from "./QuadGeometry";
import { TileStore } from "./TileStore";
import { TILE_SIZE, type Tile, type TileOperationEntry, type TileSnapshot } from "./Tile";
import { PngCodec } from "./PngCodec";
import { decodePngInWorker } from "./PngDecoderWorker";
import type { ChunkSnapshotPacket } from "~/network/SnapshotPacket";
import type { Client } from "~/network/Client";
import {
  chunksInViewport,
  chunkViewportKey,
  containsChunk,
  sameChunkViewport,
  type ChunkCoordinate,
  type ChunkViewport,
} from "~/network/ChunkViewport";

const BACKGROUND_COLOR: [number, number, number, number] = [1, 1, 1, 1];
const IMAGE_BINDING = 0;
const DESTINATION_BINDING = 1;
const SNAPSHOT_MODEL = mat3.fromValues(TILE_SIZE, 0, 0, 0, TILE_SIZE, 0, 0, 0, 1);
const SNAPSHOT_MVP = mat3.multiply(mat3.create(), CHUNK_VIEW_PROJECTION, SNAPSHOT_MODEL);
const FULLSCREEN_MVP = mat3.fromValues(2, 0, 0, 0, 2, 0, -1, -1, 1);

export interface UncommittedOverlay {
  chunkX: number;
  chunkY: number;
  bindGroup: BindGroup;
}

interface HistoryRecord {
  patch: Patch;
  entries: { tile: Tile; entry: TileOperationEntry }[];
  toggleHeadHash: string;
  active: boolean;
  pending: boolean;
  readonly label: string;
  readonly createdAt: number;
}

export interface OperationHistoryItem {
  readonly id: string;
  readonly label: string;
  readonly createdAt: number;
  readonly chunkCount: number;
  readonly active: boolean;
  readonly pending: boolean;
}

export type CanvasContentRenderedListener = () => void;
export type CanvasInvalidatedListener = () => void;

export class CanvasRenderer {
  private readonly context: Context;
  private readonly pipeline: RenderPipeline;
  private readonly copyPipeline: RenderPipeline;
  private readonly straightCompositePipeline: RenderPipeline;
  private readonly gridPipeline: RenderPipeline;
  private readonly quad: QuadGeometry;
  private readonly bindGroupLayout: BindGroupLayout;
  private readonly compositeBindGroupLayout: BindGroupLayout;
  readonly gl: WebGL2RenderingContext;
  readonly device: Device;
  readonly camera = new Camera2D(0, 0, 1, () => this.invalidate());
  readonly tiles = new TileStore();
  readonly uncommittedOverlays = new Map<string, UncommittedOverlay>();
  readonly transparentSnapshot: TileSnapshot;
  private gridVisible = false;

  private readonly historyRecords: HistoryRecord[] = [];
  private readonly redoOrder: HistoryRecord[] = [];
  private readonly historyChangedListeners = new Set<() => void>();
  private readonly optimisticPatchHashes = new Set<string>();
  private readonly replaySyncing = new Set<Tile>();
  private readonly replayPending = new Map<Tile, string>();
  private snapshotApplyChain: Promise<void> = Promise.resolve();
  private readonly canvasContentRenderedListeners = new Set<CanvasContentRenderedListener>();
  private readonly canvasInvalidatedListeners = new Set<CanvasInvalidatedListener>();
  private readonly identity: Promise<Identity> = Identity.generate();
  private viewport: ChunkViewport | null = null;
  private readonly knownChunks = new Map<string, ChunkCoordinate>();
  private readonly snapshotVersions = new Map<string, number>();

  constructor(
    canvas: HTMLCanvasElement,
    private readonly client: Client,
  ) {
    this.context = new Context(canvas);
    this.gl = this.context.gl;
    this.device = this.context.device;
    const { gl, device } = this;

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [{ binding: IMAGE_BINDING, type: "texture" }],
    });
    this.compositeBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: IMAGE_BINDING, type: "texture" },
        { binding: DESTINATION_BINDING, type: "texture" },
      ],
    });

    using vertexShader = device.createShader({ stage: ShaderStage.VERTEX, source: CANVAS_VERTEX_SHADER });
    using fragmentShader = device.createShader({ stage: ShaderStage.FRAGMENT, source: CANVAS_DISPLAY_FRAGMENT_SHADER });
    using copyFragmentShader = device.createShader({
      stage: ShaderStage.FRAGMENT,
      source: SNAPSHOT_COPY_FRAGMENT_SHADER,
    });
    using compositeFragmentShader = device.createShader({
      stage: ShaderStage.FRAGMENT,
      source: STRAIGHT_COMPOSITE_FRAGMENT_SHADER,
    });
    using gridFragmentShader = device.createShader({ stage: ShaderStage.FRAGMENT, source: TILE_GRID_FRAGMENT_SHADER });
    const vertexBuffers = [
      {
        arrayStride: 4 * Float32Array.BYTES_PER_ELEMENT,
        attributes: [
          { shaderLocation: 0, format: "float32x2" as const, offset: 0 },
          { shaderLocation: 1, format: "float32x2" as const, offset: 2 * Float32Array.BYTES_PER_ELEMENT },
        ],
      },
    ];
    this.pipeline = device.createRenderPipeline({
      vertexShader,
      fragmentShader,
      topology: "triangle-strip",
      blend: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      bindGroupLayout: this.bindGroupLayout,
      vertexBuffers,
    });
    this.copyPipeline = device.createRenderPipeline({
      vertexShader,
      fragmentShader: copyFragmentShader,
      topology: "triangle-strip",
      bindGroupLayout: this.bindGroupLayout,
      vertexBuffers,
    });
    this.straightCompositePipeline = device.createRenderPipeline({
      vertexShader,
      fragmentShader: compositeFragmentShader,
      topology: "triangle-strip",
      bindGroupLayout: this.compositeBindGroupLayout,
      vertexBuffers,
    });
    this.gridPipeline = device.createRenderPipeline({
      vertexShader,
      fragmentShader: gridFragmentShader,
      topology: "triangle-strip",
      blend: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
      bindGroupLayout: this.bindGroupLayout,
      vertexBuffers,
    });

    this.quad = new QuadGeometry(device);
    this.transparentSnapshot = this.createEmptySnapshot();
  }

  createPatchBindGroup(texture: Texture): BindGroup {
    return this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [{ binding: IMAGE_BINDING, texture }],
    });
  }

  beginPass(target?: RenderPassTarget, clearColor?: [number, number, number, number]): RenderPassEncoder {
    const pass = this.context.beginRenderPass({ clearColor, target });
    pass.setPipeline(this.pipeline);
    pass.setVertexBuffer(0, this.quad.buffer);
    pass.setUniformInt("uImage", IMAGE_BINDING);
    return pass;
  }

  drawQuad(pass: RenderPassEncoder, mvp: mat3, bindGroup: BindGroup, opacity: number): void {
    pass.setUniformMatrix3("uMvp", mvp);
    pass.setBindGroup(bindGroup);
    pass.setUniformFloat("uOpacity", opacity);
    pass.draw(this.quad.vertexCount);
  }

  compositeOntoSnapshot(
    destination: TileSnapshot,
    output: TileSnapshot,
    source: Texture,
    sourceMvp: mat3,
    opacity: number,
    copyDestination = true,
    compositeOp = CompositeOp.SourceOver,
  ): void {
    if (destination === output) {
      throw new Error("Straight-alpha composition requires different input and output snapshots.");
    }

    if (copyDestination) {
      const copyPass = this.context.beginRenderPass({
        target: { framebuffer: output.framebuffer, width: TILE_SIZE, height: TILE_SIZE },
      });
      copyPass.setPipeline(this.copyPipeline);
      copyPass.setVertexBuffer(0, this.quad.buffer);
      copyPass.setUniformInt("uImage", IMAGE_BINDING);
      this.drawQuad(copyPass, SNAPSHOT_MVP, destination.bindGroup, 1);
      copyPass.end();
    }

    const compositeBindGroup = this.device.createBindGroup({
      layout: this.compositeBindGroupLayout,
      entries: [
        { binding: IMAGE_BINDING, texture: source },
        { binding: DESTINATION_BINDING, texture: destination.texture },
      ],
    });
    const compositePass = this.context.beginRenderPass({
      target: { framebuffer: output.framebuffer, width: TILE_SIZE, height: TILE_SIZE },
    });
    compositePass.setPipeline(this.straightCompositePipeline);
    compositePass.setVertexBuffer(0, this.quad.buffer);
    compositePass.setUniformInt("uSource", IMAGE_BINDING);
    compositePass.setUniformInt("uDestination", DESTINATION_BINDING);
    compositePass.setUniformFloat2("uTargetSize", TILE_SIZE, TILE_SIZE);
    compositePass.setUniformInt("uCompositeOp", compositeOp);
    this.drawQuad(compositePass, sourceMvp, compositeBindGroup, opacity);
    compositePass.end();
  }

  private paintOperationOntoSnapshot(
    destination: TileSnapshot,
    output: TileSnapshot,
    operation: BlendOperation,
  ): void {
    const decoded = PngCodec.decodeRGBA(operation.imageBytes, TILE_SIZE, TILE_SIZE);
    using texture = this.device.createTexture({
      source: { width: decoded.width, height: decoded.height, data: decoded.rgba },
      minFilter: "nearest",
      magFilter: "nearest",
    });
    this.compositeOntoSnapshot(destination, output, texture, SNAPSHOT_MVP, operation.opacity, false, operation.compositeOp);
  }

  createEmptySnapshot(): TileSnapshot {
    const texture = this.device.createTexture({
      source: { width: TILE_SIZE, height: TILE_SIZE, data: null },
      magFilter: "nearest",
    });
    const framebuffer = this.device.createFramebuffer({ colorAttachment: texture });
    const bindGroup = this.createPatchBindGroup(texture);
    this.beginPass({ framebuffer, width: TILE_SIZE, height: TILE_SIZE }, [0, 0, 0, 0]).end();
    return { texture, bindGroup, framebuffer };
  }

  disposeSnapshot(snapshot: TileSnapshot): void {
    snapshot.texture.dispose();
    snapshot.framebuffer.dispose();
  }

  async commitPatch(operations: readonly BlendOperation[]): Promise<void> {
    const patch = await Patch.create(operations, await this.identity);
    this.optimisticPatchHashes.add(patch.hash);
    const entries: HistoryRecord["entries"] = [];
    const touchedTiles = new Set<Tile>();

    for (const operation of operations) {
      const tile = this.tiles.getOrCreate(operation.chunk.x, operation.chunk.y);
      const entry = tile.addOperation(patch.hash, operation);
      entries.push({ tile, entry });
      tile.headPatchHash = patch.hash;
      touchedTiles.add(tile);
    }
    for (const tile of touchedTiles) this.rebuildSnapshot(tile);

    const isEraser = operations.every((operation) => operation.compositeOp === CompositeOp.DestinationOut);
    this.historyRecords.push({
      patch,
      entries,
      toggleHeadHash: patch.hash,
      active: true,
      pending: false,
      label: isEraser ? "Eraser stroke" : "Brush stroke",
      createdAt: Date.now(),
    });
    this.emitHistoryChanged();
    void this.client.send(patch).catch((error: unknown) => {
      console.error("Failed to persist Patch for delivery:", error);
    });
  }

  getChunkParents(x: number, y: number): string[] {
    const tile = this.tiles.get(x, y);
    const entries = tile?.operationEntries;
    if (entries?.length) return [entries[entries.length - 1].patchHash];
    return tile?.headPatchHash ? [tile.headPatchHash] : [];
  }

  activateChunk(x: number, y: number): void {
    const tile = this.tiles.getOrCreate(x, y);
    if (tile.isActive) return;
    tile.isActive = true;
    if (tile.headPatchHash) this.scheduleActiveChunkSync(tile, tile.headPatchHash);
  }

  applySnapshots(snapshots: readonly ChunkSnapshotPacket[]): Promise<void> {
    for (const snapshot of snapshots) {
      const key = this.chunkKey(snapshot.chunk.x, snapshot.chunk.y);
      this.snapshotVersions.set(key, (this.snapshotVersions.get(key) ?? 0) + 1);
    }
    const apply = this.snapshotApplyChain.then(() => this.applySnapshotsNow(snapshots));
    this.snapshotApplyChain = apply.catch(() => {});
    return apply;
  }

  private async applySnapshotsNow(snapshots: readonly ChunkSnapshotPacket[]): Promise<void> {
    const pending = snapshots.flatMap((update) => {
      if (!this.viewport || !containsChunk(this.viewport, update.chunk.x, update.chunk.y)) return [];
      this.knownChunks.set(this.chunkKey(update.chunk.x, update.chunk.y), update.chunk);
      const tile = this.tiles.getOrCreate(update.chunk.x, update.chunk.y);
      if (tile.isActive) return [];
      return [{
        update,
        tile,
        rgba: decodePngInWorker(update.imageBytes, TILE_SIZE, TILE_SIZE),
      }];
    });

    // Apply each tile the moment its own decode resolves so the canvas fills in
    // progressively. Errors are handled per tile so one failed decode neither
    // blocks the others nor surfaces as an unhandled promise rejection.
    await Promise.all(pending.map(async ({ update, tile, rgba: decoding }) => {
      let rgba: Uint8Array<ArrayBuffer>;
      try {
        rgba = await decoding;
      } catch (error) {
        console.error(`Failed to decode snapshot for chunk ${update.chunk.x},${update.chunk.y}:`, error);
        return;
      }
      if (!this.viewport || !containsChunk(this.viewport, update.chunk.x, update.chunk.y)) return;
      if (tile.isActive) return;
      const snapshot = this.createSnapshotFromRGBA(rgba);
      this.disposeTileSnapshots(tile);
      tile.snapshot = snapshot;
      tile.baseSnapshot = snapshot;
      tile.headPatchHash = update.headPatchHash;
      tile.operationEntries.length = 0;
      tile.containsEntireOperationOrder = false;
      this.invalidate();
    }));
  }

  private scheduleActiveChunkSync(tile: Tile, fromHash: string): void {
    if (this.replaySyncing.has(tile)) {
      this.replayPending.set(tile, fromHash);
      return;
    }
    this.replaySyncing.add(tile);
    void this.syncActiveChunk(tile, fromHash).catch((error: unknown) => {
      console.error(`Failed to lazy-sync chunk ${tile.x},${tile.y}:`, error);
    }).finally(() => {
      this.replaySyncing.delete(tile);
      const pendingHash = this.replayPending.get(tile);
      if (pendingHash) {
        this.replayPending.delete(tile);
        if (!tile.operationEntries.some((entry) => entry.patchHash === pendingHash)) {
          this.scheduleActiveChunkSync(tile, pendingHash);
        }
      }
    });
  }

  private async syncActiveChunk(tile: Tile, fromHash: string): Promise<void> {
    const entriesAtStart = new Set(tile.operationEntries);
    const entriesToPreserve = tile.operationEntries.filter((entry) =>
      this.optimisticPatchHashes.has(entry.patchHash));
    const replay = await this.client.fetchChunkReplay(tile.x, tile.y, fromHash);
    for (const entry of tile.operationEntries) {
      if (!entriesAtStart.has(entry)) entriesToPreserve.push(entry);
    }
    const rgba = await decodePngInWorker(replay.imageBytes, TILE_SIZE, TILE_SIZE);
    const baseSnapshot = this.createSnapshotFromRGBA(rgba);
    this.disposeTileSnapshots(tile);
    tile.baseSnapshot = baseSnapshot;
    tile.snapshot = baseSnapshot;
    tile.operationEntries.length = 0;
    tile.containsEntireOperationOrder = replay.containsEntireOrder;
    const replayedHashes = new Set<string>();
    for (const patch of replay.patches) {
      const operation = patch.operations.find((candidate) =>
        candidate.chunk.x === tile.x && candidate.chunk.y === tile.y);
      if (operation) {
        tile.addOperation(patch.hash, operation);
        replayedHashes.add(patch.hash);
      }
    }
    for (const entry of entriesToPreserve) {
      if (!replayedHashes.has(entry.patchHash)) {
        tile.addOperation(entry.patchHash, entry.op);
        replayedHashes.add(entry.patchHash);
      }
    }
    tile.headPatchHash = tile.operationEntries.at(-1)?.patchHash ?? tile.headPatchHash;
    this.rebuildSnapshot(tile);
  }

  private disposeTileSnapshots(tile: Tile): void {
    if (tile.snapshot && tile.snapshot !== tile.baseSnapshot) this.disposeSnapshot(tile.snapshot);
    if (tile.baseSnapshot) this.disposeSnapshot(tile.baseSnapshot);
    tile.snapshot = null;
    tile.baseSnapshot = null;
  }

  private createSnapshotFromRGBA(rgba: Uint8Array<ArrayBuffer>): TileSnapshot {
    const texture = this.device.createTexture({
      source: { width: TILE_SIZE, height: TILE_SIZE, data: rgba },
      minFilter: "nearest",
      magFilter: "nearest",
    });
    return {
      texture,
      framebuffer: this.device.createFramebuffer({ colorAttachment: texture }),
      bindGroup: this.createPatchBindGroup(texture),
    };
  }

  get canUndo(): boolean {
    return this.historyRecords.some((record) => record.active && !record.pending);
  }

  get canRedo(): boolean {
    return this.redoOrder.some((record) => !record.active && !record.pending);
  }

  get operationHistory(): readonly OperationHistoryItem[] {
    return this.historyRecords.map((record) => ({
      id: record.patch.hash,
      label: record.label,
      createdAt: record.createdAt,
      chunkCount: record.entries.length,
      active: record.active,
      pending: record.pending,
    }));
  }

  onHistoryChanged(listener: () => void): () => void {
    this.historyChangedListeners.add(listener);
    return () => this.historyChangedListeners.delete(listener);
  }

  get showGrid(): boolean {
    return this.gridVisible;
  }

  set showGrid(value: boolean) {
    if (this.gridVisible === value) return;
    this.gridVisible = value;
    this.invalidate();
  }

  invalidate(): void {
    for (const listener of this.canvasInvalidatedListeners) listener();
  }

  onInvalidated(listener: CanvasInvalidatedListener): () => void {
    this.canvasInvalidatedListeners.add(listener);
    return () => this.canvasInvalidatedListeners.delete(listener);
  }

  onCanvasContentRendered(listener: CanvasContentRenderedListener): () => void {
    this.canvasContentRenderedListeners.add(listener);
    return () => this.canvasContentRenderedListeners.delete(listener);
  }

  applyPatch(patch: Patch): boolean {
    const chunks = new Set<string>();
    for (const operation of patch.operations) {
      const key = `${operation.chunk.x},${operation.chunk.y}`;
      if (chunks.has(key)) {
        throw new Error(`Patch ${patch.hash} contains multiple operations for chunk ${key}.`);
      }
      chunks.add(key);
    }

    this.optimisticPatchHashes.delete(patch.hash);
    const replayTiles = new Set<Tile>();
    let applied = false;
    for (const operation of patch.operations) {
      if (!this.viewport || !containsChunk(this.viewport, operation.chunk.x, operation.chunk.y)) continue;
      const tile = this.tiles.get(operation.chunk.x, operation.chunk.y);
      if (!tile) continue;
      if (!tile.isActive) continue;
      const knownEntries = new Set(tile.operationEntries.map((entry) => entry.patchHash));
      if (knownEntries.has(patch.hash)) continue;
      const canApplyIncrementally = tile.containsEntireOperationOrder
        || (operation.parents.length > 0 && operation.parents.every((parent) => knownEntries.has(parent)));
      if (!canApplyIncrementally) {
        replayTiles.add(tile);
        continue;
      }
      tile.addOperation(patch.hash, operation);
      tile.headPatchHash = patch.hash;
      this.rebuildSnapshot(tile);
      applied = true;
    }
    for (const tile of replayTiles) {
      this.scheduleActiveChunkSync(tile, patch.hash);
    }
    return applied || replayTiles.size > 0;
  }

  async undo(): Promise<void> {
    let record: HistoryRecord | undefined;
    for (let index = this.historyRecords.length - 1; index >= 0; index--) {
      const candidate = this.historyRecords[index];
      if (candidate.active && !candidate.pending) {
        record = candidate;
        break;
      }
    }
    if (!record) return;
    await this.setRecordActive(record, false);
  }

  async redo(): Promise<void> {
    let record: HistoryRecord | undefined;
    while (!record && this.redoOrder.length > 0) {
      const candidate = this.redoOrder.pop()!;
      if (!candidate.active && !candidate.pending) record = candidate;
    }
    if (!record) return;
    await this.setRecordActive(record, true);
  }

  async setHistoryItemActive(id: string, active: boolean): Promise<void> {
    const record = this.historyRecords.find((candidate) => candidate.patch.hash === id);
    if (!record || record.active === active || record.pending) return;
    await this.setRecordActive(record, active);
  }

  private async setRecordActive(record: HistoryRecord, active: boolean): Promise<void> {
    record.pending = true;
    this.emitHistoryChanged();
    try {
      const operations: UndoOperation[] = record.entries.map(({ tile }) => ({
        type: "undo",
        chunk: { x: tile.x, y: tile.y },
        parents: [record.toggleHeadHash],
      }));
      const patch = await Patch.create(operations, await this.identity);
      this.optimisticPatchHashes.add(patch.hash);
      record.toggleHeadHash = patch.hash;
      const touchedTiles = new Set<Tile>();
      for (const { tile } of record.entries) {
        const operation = operations.find((candidate) =>
          candidate.chunk.x === tile.x && candidate.chunk.y === tile.y)!;
        tile.addOperation(patch.hash, operation);
        tile.headPatchHash = patch.hash;
        touchedTiles.add(tile);
      }
      for (const tile of touchedTiles) this.rebuildSnapshot(tile);
      record.active = active;
      if (active) {
        for (let index = this.redoOrder.length - 1; index >= 0; index--) {
          if (this.redoOrder[index] === record) this.redoOrder.splice(index, 1);
        }
      } else if (!this.redoOrder.includes(record)) {
        this.redoOrder.push(record);
      }
      void this.client.send(patch).catch((error: unknown) => {
        console.error(`Failed to persist ${active ? "redo" : "undo"} Patch for delivery:`, error);
      });
    } finally {
      record.pending = false;
      this.emitHistoryChanged();
    }
  }

  private emitHistoryChanged(): void {
    for (const listener of this.historyChangedListeners) listener();
  }

  private rebuildSnapshot(tile: Tile): void {
    let rebuilt = this.createEmptySnapshot();
    let spare = this.createEmptySnapshot();
    try {
      if (tile.baseSnapshot) {
        const copyPass = this.context.beginRenderPass({
          target: { framebuffer: rebuilt.framebuffer, width: TILE_SIZE, height: TILE_SIZE },
        });
        copyPass.setPipeline(this.copyPipeline);
        copyPass.setVertexBuffer(0, this.quad.buffer);
        copyPass.setUniformInt("uImage", IMAGE_BINDING);
        this.drawQuad(copyPass, SNAPSHOT_MVP, tile.baseSnapshot.bindGroup, 1);
        copyPass.end();
      }
      for (const entry of tile.resolveActiveBlendEntries()) {
        this.paintOperationOntoSnapshot(rebuilt, spare, entry.op);
        [rebuilt, spare] = [spare, rebuilt];
      }
    } catch (error) {
      this.disposeSnapshot(rebuilt);
      this.disposeSnapshot(spare);
      throw error;
    }
    this.disposeSnapshot(spare);
    if (tile.snapshot && tile.snapshot !== tile.baseSnapshot) {
      this.disposeSnapshot(tile.snapshot);
    }
    tile.snapshot = rebuilt;
    this.invalidate();
  }

  render(): void {
    this.resize();
    this.updateViewport();

    const pass = this.beginPass(undefined, BACKGROUND_COLOR);

    const viewProjection = this.camera.getViewProjectionMatrix();
    const isChunkVisible = (chunkX: number, chunkY: number) =>
      !this.viewport || containsChunk(this.viewport, chunkX, chunkY);
    const previewedTiles = new Set(this.uncommittedOverlays.keys());

    for (const tile of this.tiles) {
      if (!tile.snapshot) {
        continue;
      }
      if (previewedTiles.has(this.chunkKey(tile.x, tile.y))) {
        continue;
      }
      if (!isChunkVisible(tile.x, tile.y)) {
        continue;
      }
      const tileMinX = tile.x * TILE_SIZE;
      const tileMinY = tile.y * TILE_SIZE;

      const model = mat3.fromValues(TILE_SIZE, 0, 0, 0, TILE_SIZE, 0, tileMinX, tileMinY, 1);
      const mvp = mat3.multiply(mat3.create(), viewProjection, model);
      this.drawQuad(pass, mvp, tile.snapshot.bindGroup, 1);
    }

    for (const overlay of this.uncommittedOverlays.values()) {
      if (!isChunkVisible(overlay.chunkX, overlay.chunkY)) {
        continue;
      }
      const tileMinX = overlay.chunkX * TILE_SIZE;
      const tileMinY = overlay.chunkY * TILE_SIZE;

      const model = mat3.fromValues(TILE_SIZE, 0, 0, 0, TILE_SIZE, 0, tileMinX, tileMinY, 1);
      const mvp = mat3.multiply(mat3.create(), viewProjection, model);
      this.drawQuad(pass, mvp, overlay.bindGroup, 1);
    }

    pass.end();

    for (const listener of this.canvasContentRenderedListeners) listener();

    if (this.gridVisible) {
      const gridPass = this.context.beginRenderPass();
      gridPass.setPipeline(this.gridPipeline);
      gridPass.setVertexBuffer(0, this.quad.buffer);
      gridPass.setUniformMatrix3("uMvp", FULLSCREEN_MVP);
      gridPass.setUniformFloat2("uViewportSize", this.context.canvas.width, this.context.canvas.height);
      gridPass.setUniformFloat2("uCameraPosition", this.camera.x, this.camera.y);
      gridPass.setUniformFloat("uZoom", this.camera.zoom * (window.devicePixelRatio || 1));
      gridPass.setUniformFloat("uRotation", this.camera.rotation);
      gridPass.setUniformFloat2(
        "uFlip",
        this.camera.flipX ? -1 : 1,
        this.camera.flipY ? -1 : 1,
      );
      gridPass.setUniformFloat("uGridSize", TILE_SIZE);
      gridPass.draw(this.quad.vertexCount);
      gridPass.end();
    }
  }

  private resize(): void {
    if (this.context.resize()) {
      this.camera.resize(this.context.canvas.clientWidth, this.context.canvas.clientHeight);
    }
  }

  private updateViewport(): void {
    const bounds = this.camera.visibleWorldBounds();
    const minX = Math.floor(bounds.minX / TILE_SIZE);
    const minY = Math.floor(bounds.minY / TILE_SIZE);
    const maxX = Math.ceil(bounds.maxX / TILE_SIZE) - 1;
    const maxY = Math.ceil(bounds.maxY / TILE_SIZE) - 1;

    // Only the chunks the (possibly rotated) viewport quad actually overlaps,
    // so a rotated camera never queries the empty corners of its bounding box.
    const corners = this.camera.visibleWorldCorners();
    const keys = new Set<string>();
    for (let chunkY = minY; chunkY <= maxY; chunkY++) {
      for (let chunkX = minX; chunkX <= maxX; chunkX++) {
        if (
          quadIntersectsRect(
            corners,
            chunkX * TILE_SIZE,
            chunkY * TILE_SIZE,
            (chunkX + 1) * TILE_SIZE,
            (chunkY + 1) * TILE_SIZE,
          )
        ) {
          keys.add(chunkViewportKey(chunkX, chunkY));
        }
      }
    }

    const viewport: ChunkViewport = { minX, minY, maxX, maxY, keys };
    if (sameChunkViewport(this.viewport, viewport)) return;
    this.viewport = viewport;
    this.client.setViewport(viewport);
    for (const tile of [...this.tiles]) {
      if (tile.isActive || containsChunk(viewport, tile.x, tile.y)) continue;
      this.disposeTileSnapshots(tile);
      this.tiles.delete(tile);
    }
    for (const [key, chunk] of this.knownChunks) {
      if (!containsChunk(viewport, chunk.x, chunk.y) && !this.tiles.get(chunk.x, chunk.y)?.isActive) {
        this.knownChunks.delete(key);
      }
    }
    void this.fetchVisibleSnapshots(viewport);
  }

  private async fetchVisibleSnapshots(viewport: ChunkViewport): Promise<void> {
    const missingChunks = chunksInViewport(viewport).filter(({ x, y }) => {
      const key = this.chunkKey(x, y);
      return !this.tiles.get(x, y)?.snapshot
        && !this.knownChunks.has(key);
    });
    if (missingChunks.length === 0) return;
    const versionsBeforeFetch = new Map(
      missingChunks.map(({ x, y }) => {
        const key = this.chunkKey(x, y);
        return [key, this.snapshotVersions.get(key) ?? 0];
      }),
    );
    try {
      const snapshots = await this.client.fetchSnapshots(missingChunks);
      const currentViewport = this.viewport;
      if (currentViewport) {
        for (const chunk of missingChunks) {
          if (containsChunk(currentViewport, chunk.x, chunk.y)) {
            this.knownChunks.set(this.chunkKey(chunk.x, chunk.y), chunk);
          }
        }
      }
      const unchangedSnapshots = snapshots.filter((snapshot) => {
        const key = this.chunkKey(snapshot.chunk.x, snapshot.chunk.y);
        return (this.snapshotVersions.get(key) ?? 0) === versionsBeforeFetch.get(key);
      });
      await this.applySnapshots(unchangedSnapshots);
    } catch (error) {
      console.error("Failed to fetch visible snapshots:", error);
    }
  }

  private chunkKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  readSnapshotRgba(worldX: number, worldY: number): Promise<[number, number, number, number]> {
    const { chunkX, chunkY, subchunkX, subchunkY } = worldToChunkPosition(worldX, worldY);
    const snapshot = this.tiles.get(chunkX, chunkY)?.snapshot;
    if (!snapshot) return Promise.resolve([0, 0, 0, 0]);

    return snapshot.framebuffer.readRgba8PixelAsync(subchunkX, subchunkY);
  }

  dispose(): void {
    this.quad.dispose();
    this.pipeline.dispose();
    this.copyPipeline.dispose();
    this.straightCompositePipeline.dispose();
    this.gridPipeline.dispose();
    this.disposeSnapshot(this.transparentSnapshot);
    for (const tile of this.tiles) {
      this.disposeTileSnapshots(tile);
    }
  }
}

/** Separating-axis test between a convex quad and an axis-aligned rectangle. */
function quadIntersectsRect(
  quad: readonly { x: number; y: number }[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  const rect: [number, number][] = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
  const axes: [number, number][] = [[1, 0], [0, 1]];
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % quad.length];
    axes.push([-(b.y - a.y), b.x - a.x]);
  }
  for (const [ax, ay] of axes) {
    let quadMin = Infinity;
    let quadMax = -Infinity;
    for (const point of quad) {
      const projection = point.x * ax + point.y * ay;
      quadMin = Math.min(quadMin, projection);
      quadMax = Math.max(quadMax, projection);
    }
    let rectMin = Infinity;
    let rectMax = -Infinity;
    for (const [x, y] of rect) {
      const projection = x * ax + y * ay;
      rectMin = Math.min(rectMin, projection);
      rectMax = Math.max(rectMax, projection);
    }
    if (quadMax < rectMin || rectMax < quadMin) return false;
  }
  return true;
}
