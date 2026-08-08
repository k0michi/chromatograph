export interface BrushMask {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
}

export interface BrushTip {
  renderMask(size: number, hardness: number): BrushMask;
}
