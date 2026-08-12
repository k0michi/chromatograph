/// <reference lib="webworker" />

import { PngCodec } from "./PngCodec";

export interface PngEncodeRequest {
  readonly id: number;
  readonly rgba: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

export type PngEncodeResponse =
  | { readonly id: number; readonly png: Uint8Array<ArrayBuffer> }
  | { readonly id: number; readonly error: string };

const worker = globalThis as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<PngEncodeRequest>) => {
  const { id, rgba, width, height } = event.data;
  try {
    const png = PngCodec.encodeRGBA(rgba, width, height);
    worker.postMessage({ id, png } satisfies PngEncodeResponse, [png.buffer]);
  } catch (error) {
    worker.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies PngEncodeResponse);
  }
};
