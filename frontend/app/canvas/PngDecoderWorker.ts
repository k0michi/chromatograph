import type { PngDecodeRequest, PngDecodeResponse } from "./PngDecoder.worker";

interface PendingDecoding {
  readonly resolve: (rgba: Uint8Array<ArrayBuffer>) => void;
  readonly reject: (error: Error) => void;
}

class PngDecoderWorker {
  private readonly worker = new Worker(new URL("./PngDecoder.worker.ts", import.meta.url), { type: "module" });
  private readonly pending = new Map<number, PendingDecoding>();
  private nextId = 1;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<PngDecodeResponse>) => {
      const result = event.data;
      const pending = this.pending.get(result.id);
      if (!pending) return;
      this.pending.delete(result.id);
      if ("error" in result) {
        pending.reject(new Error(`PNG decoding failed: ${result.error}`));
      } else {
        pending.resolve(result.rgba);
      }
    };
    this.worker.onerror = (event) => {
      const error = new Error(`PNG decoder worker failed: ${event.message}`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  get load(): number {
    return this.pending.size;
  }

  decode(
    png: Uint8Array<ArrayBuffer>,
    width: number,
    height: number,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const request: PngDecodeRequest = { id, png, width, height };
      this.worker.postMessage(request, [png.buffer]);
    });
  }
}

const workers: PngDecoderWorker[] = [];

function decoderWorker(): PngDecoderWorker {
  const idle = workers.find((worker) => worker.load === 0);
  if (idle) return idle;
  const maximumWorkers = Math.max(2, Math.min(4, navigator.hardwareConcurrency || 2));
  if (workers.length < maximumWorkers) {
    const worker = new PngDecoderWorker();
    workers.push(worker);
    return worker;
  }
  return workers.reduce((leastBusy, candidate) =>
    candidate.load < leastBusy.load ? candidate : leastBusy);
}

export function decodePngInWorker(
  png: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
): Promise<Uint8Array<ArrayBuffer>> {
  return decoderWorker().decode(png, width, height);
}
