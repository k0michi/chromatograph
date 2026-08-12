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
} from "./CanvasShaders";
import { CHUNK_VIEW_PROJECTION } from "./chunkSpace";
import type { BlendOperation, UndoOperation } from "./Operation";
import { Patch } from "./Patch";
import { QuadGeometry } from "./QuadGeometry";
import { TileStore } from "./TileStore";
import { TILE_SIZE, type Tile, type TileOperationEntry, type TileSnapshot } from "./Tile";

const BACKGROUND_COLOR: [number, number, number, number] = [1, 1, 1, 1];
const IMAGE_BINDING = 0;
const DESTINATION_BINDING = 1;
const SNAPSHOT_MODEL = mat3.fromValues(TILE_SIZE, 0, 0, 0, TILE_SIZE, 0, 0, 0, 1);
const SNAPSHOT_MVP = mat3.multiply(mat3.create(), CHUNK_VIEW_PROJECTION, SNAPSHOT_MODEL);

export interface UncommittedOverlay {
  chunkX: number;
  chunkY: number;
  bindGroup: BindGroup;
}

interface HistoryRecord {
  patch: Patch;
  entries: { tile: Tile; entry: TileOperationEntry }[];
  toggleHeadHash: string;
}

export class CanvasRenderer {
  private readonly context: Context;
  private readonly pipeline: RenderPipeline;
  private readonly copyPipeline: RenderPipeline;
  private readonly straightCompositePipeline: RenderPipeline;
  private readonly quad: QuadGeometry;
  private readonly bindGroupLayout: BindGroupLayout;
  private readonly compositeBindGroupLayout: BindGroupLayout;
  readonly gl: WebGL2RenderingContext;
  readonly device: Device;
  readonly camera = new Camera2D();
  readonly tiles = new TileStore();
  readonly uncommittedOverlays = new Map<string, UncommittedOverlay>();

  private readonly undoStack: HistoryRecord[] = [];
  private readonly redoStack: HistoryRecord[] = [];
  private readonly knownPatchHashes = new Set<string>();
  private readonly identity: Promise<Identity> = Identity.generate();

  constructor(
    canvas: HTMLCanvasElement,
    private readonly publishPatch?: (patch: Patch) => void,
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

    this.quad = new QuadGeometry(device);
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
    this.drawQuad(compositePass, sourceMvp, compositeBindGroup, opacity);
    compositePass.end();
  }

  private paintOperationOntoSnapshot(
    destination: TileSnapshot,
    output: TileSnapshot,
    operation: BlendOperation,
  ): void {
    using texture = this.device.createTexture({
      source: { width: TILE_SIZE, height: TILE_SIZE, data: operation.imageBytes },
      minFilter: "nearest",
      magFilter: "nearest",
    });
    this.compositeOntoSnapshot(destination, output, texture, SNAPSHOT_MVP, operation.opacity, false);
  }

  createEmptySnapshot(): TileSnapshot {
    const texture = this.device.createTexture({ source: { width: TILE_SIZE, height: TILE_SIZE, data: null } });
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
    this.knownPatchHashes.add(patch.hash);
    const entries: HistoryRecord["entries"] = [];

    for (const operation of operations) {
      const tile = this.tiles.getOrCreate(operation.chunk.x, operation.chunk.y);
      const entry = tile.addOperation(patch.hash, operation);
      entries.push({ tile, entry });
    }

    for (const { tile } of entries) {
      this.rebuildSnapshot(tile);
    }

    this.undoStack.push({ patch, entries, toggleHeadHash: patch.hash });
    this.redoStack.length = 0;
    this.publishPatch?.(patch);
  }

  getChunkParents(x: number, y: number): string[] {
    const entries = this.tiles.get(x, y)?.operationEntries;
    return entries?.length ? [entries[entries.length - 1].patchHash] : [];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  applyPatch(patch: Patch): boolean {
    if (this.knownPatchHashes.has(patch.hash)) {
      return false;
    }

    const chunks = new Set<string>();
    for (const operation of patch.operations) {
      const key = `${operation.chunk.x},${operation.chunk.y}`;
      if (chunks.has(key)) {
        throw new Error(`Patch ${patch.hash} contains multiple operations for chunk ${key}.`);
      }
      chunks.add(key);
    }

    this.knownPatchHashes.add(patch.hash);
    const touchedTiles = new Set<Tile>();
    for (const operation of patch.operations) {
      const tile = this.tiles.getOrCreate(operation.chunk.x, operation.chunk.y);
      tile.addOperation(patch.hash, operation);
      touchedTiles.add(tile);
    }
    for (const tile of touchedTiles) {
      this.rebuildSnapshot(tile);
    }
    return true;
  }

  async undo(): Promise<void> {
    const record = this.undoStack.pop();
    if (!record) {
      return;
    }
    const operations: UndoOperation[] = record.entries.map(({ tile }) => ({
      type: "undo",
      chunk: { x: tile.x, y: tile.y },
      parents: [record.toggleHeadHash],
    }));
    const patch = await Patch.create(operations, await this.identity);
    this.knownPatchHashes.add(patch.hash);
    record.toggleHeadHash = patch.hash;
    const tiles = new Set<Tile>();
    for (const { tile } of record.entries) {
      tile.addOperation(patch.hash, operations.find((op) => op.chunk.x === tile.x && op.chunk.y === tile.y)!);
      tiles.add(tile);
    }
    for (const tile of tiles) {
      this.rebuildSnapshot(tile);
    }
    this.redoStack.push(record);
    this.publishPatch?.(patch);
  }

  async redo(): Promise<void> {
    const record = this.redoStack.pop();
    if (!record) {
      return;
    }
    const operations: UndoOperation[] = record.entries.map(({ tile }) => ({
      type: "undo",
      chunk: { x: tile.x, y: tile.y },
      parents: [record.toggleHeadHash],
    }));
    const patch = await Patch.create(operations, await this.identity);
    this.knownPatchHashes.add(patch.hash);
    record.toggleHeadHash = patch.hash;
    const tiles = new Set<Tile>();
    for (const { tile } of record.entries) {
      tile.addOperation(patch.hash, operations.find((op) => op.chunk.x === tile.x && op.chunk.y === tile.y)!);
      tiles.add(tile);
    }
    for (const tile of tiles) {
      this.rebuildSnapshot(tile);
    }
    this.undoStack.push(record);
    this.publishPatch?.(patch);
  }

  private rebuildSnapshot(tile: Tile): void {
    let rebuilt = this.createEmptySnapshot();
    let spare = this.createEmptySnapshot();
    for (const entry of tile.resolveActiveBlendEntries()) {
      this.paintOperationOntoSnapshot(rebuilt, spare, entry.op);
      [rebuilt, spare] = [spare, rebuilt];
    }
    this.disposeSnapshot(spare);
    if (tile.snapshot) {
      this.disposeSnapshot(tile.snapshot);
    }
    tile.snapshot = rebuilt;
  }

  render(): void {
    this.resize();

    const pass = this.beginPass(undefined, BACKGROUND_COLOR);

    const viewProjection = this.camera.getViewProjectionMatrix();
    const bounds = this.camera.visibleWorldBounds();

    for (const tile of this.tiles) {
      if (!tile.snapshot) {
        continue;
      }
      const tileMinX = tile.x * TILE_SIZE;
      const tileMinY = tile.y * TILE_SIZE;
      const isVisible =
        tileMinX < bounds.maxX &&
        tileMinX + TILE_SIZE > bounds.minX &&
        tileMinY < bounds.maxY &&
        tileMinY + TILE_SIZE > bounds.minY;
      if (!isVisible) {
        continue;
      }

      const model = mat3.fromValues(TILE_SIZE, 0, 0, 0, TILE_SIZE, 0, tileMinX, tileMinY, 1);
      const mvp = mat3.multiply(mat3.create(), viewProjection, model);
      this.drawQuad(pass, mvp, tile.snapshot.bindGroup, 1);
    }

    for (const overlay of this.uncommittedOverlays.values()) {
      const tileMinX = overlay.chunkX * TILE_SIZE;
      const tileMinY = overlay.chunkY * TILE_SIZE;
      const isVisible =
        tileMinX < bounds.maxX &&
        tileMinX + TILE_SIZE > bounds.minX &&
        tileMinY < bounds.maxY &&
        tileMinY + TILE_SIZE > bounds.minY;
      if (!isVisible) {
        continue;
      }

      const model = mat3.fromValues(TILE_SIZE, 0, 0, 0, TILE_SIZE, 0, tileMinX, tileMinY, 1);
      const mvp = mat3.multiply(mat3.create(), viewProjection, model);
      this.drawQuad(pass, mvp, overlay.bindGroup, 1);
    }

    pass.end();
  }

  private resize(): void {
    if (this.context.resize()) {
      this.camera.resize(this.context.canvas.clientWidth, this.context.canvas.clientHeight);
    }
  }

  dispose(): void {
    this.quad.dispose();
    this.pipeline.dispose();
    this.copyPipeline.dispose();
    this.straightCompositePipeline.dispose();
    for (const tile of this.tiles) {
      if (tile.snapshot) {
        this.disposeSnapshot(tile.snapshot);
      }
    }
  }
}
