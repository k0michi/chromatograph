import type { PngEncodeRequest, PngEncodeResponse } from "./PngEncoder.worker";

interface PendingEncoding {
  readonly resolve: (png: Uint8Array<ArrayBuffer>) => void;
  readonly reject: (error: Error) => void;
}

class PngEncoderWorker {
  private readonly worker = new Worker(new URL("./PngEncoder.worker.ts", import.meta.url), { type: "module" });
  private readonly pending = new Map<number, PendingEncoding>();
  private nextId = 1;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<PngEncodeResponse>) => {
      const result = event.data;
      const pending = this.pending.get(result.id);
      if (!pending) return;
      this.pending.delete(result.id);

      if ("error" in result) {
        pending.reject(new Error(`PNG encoding failed: ${result.error}`));
      } else {
        pending.resolve(result.png);
      }
    };
    this.worker.onerror = (event) => {
      const error = new Error(`PNG encoder worker failed: ${event.message}`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  encode(rgba: Uint8Array<ArrayBuffer>, width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const request: PngEncodeRequest = { id, rgba, width, height };
      this.worker.postMessage(request, [rgba.buffer]);
    });
  }
}

let sharedEncoder: PngEncoderWorker | undefined;

export function encodePngInWorker(
  rgba: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
): Promise<Uint8Array<ArrayBuffer>> {
  sharedEncoder ??= new PngEncoderWorker();
  return sharedEncoder.encode(rgba, width, height);
}
