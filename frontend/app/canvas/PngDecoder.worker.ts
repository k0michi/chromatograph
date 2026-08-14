/// <reference lib="webworker" />

import { PngCodec } from "./PngCodec";

export interface PngDecodeRequest {
  readonly id: number;
  readonly png: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

export type PngDecodeResponse =
  | { readonly id: number; readonly rgba: Uint8Array<ArrayBuffer> }
  | { readonly id: number; readonly error: string };

const worker = globalThis as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<PngDecodeRequest>) => {
  const { id, png, width, height } = event.data;
  try {
    const { rgba } = PngCodec.decodeRGBA(png, width, height);
    worker.postMessage({ id, rgba } satisfies PngDecodeResponse, [rgba.buffer]);
  } catch (error) {
    worker.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies PngDecodeResponse);
  }
};
