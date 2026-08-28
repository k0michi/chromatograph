import MathHelper from "~/math/MathHelper";

export interface ScreenStrokePoint {
  x: number;
  y: number;
  pressure: number;
  /** Pointer event timestamp in milliseconds. */
  time: number;
}

type PointSink = (point: ScreenStrokePoint) => void;

const EMA_REFERENCE_INTERVAL_MS = 1000 / 60;
const MIN_KNOT_INTERVAL = 0.0001;

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function normalizePoint(point: ScreenStrokePoint): ScreenStrokePoint {
  return {
    x: point.x,
    y: point.y,
    pressure: MathHelper.clamp(point.pressure, 0, 1),
    time: point.time,
  };
}

function extrapolateEndpoint(
  endpoint: ScreenStrokePoint,
  neighbor: ScreenStrokePoint,
): ScreenStrokePoint {
  return {
    x: 2 * endpoint.x - neighbor.x,
    y: 2 * endpoint.y - neighbor.y,
    pressure: endpoint.pressure,
    time: 2 * endpoint.time - neighbor.time,
  };
}

/** Converts a 60 Hz EMA alpha to an alpha for the actual event interval. */
export function adjustEmaAlpha(baseAlpha: number, deltaTimeMs: number): number {
  const alpha = MathHelper.clamp(baseAlpha, 0, 1);
  // Some browsers assign identical timestamps to coalesced samples. A small
  // floor keeps those samples responsive while preserving time-based decay.
  const elapsed = Math.max(1, deltaTimeMs);
  return 1 - Math.pow(1 - alpha, elapsed / EMA_REFERENCE_INTERVAL_MS);
}

/** Applies one exponential-moving-average step to position and pressure. */
export function applyEma(
  previous: ScreenStrokePoint,
  current: ScreenStrokePoint,
  alpha: number,
): ScreenStrokePoint {
  const weight = MathHelper.clamp(alpha, 0, 1);
  return {
    x: lerp(previous.x, current.x, weight),
    y: lerp(previous.y, current.y, weight),
    pressure: lerp(previous.pressure, current.pressure, weight),
    time: current.time,
  };
}

function knotInterval(a: ScreenStrokePoint, b: ScreenStrokePoint): number {
  // Centripetal Catmull-Rom uses chord length raised to alpha=0.5.
  return Math.max(MIN_KNOT_INTERVAL, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
}

interface Position {
  x: number;
  y: number;
}

function interpolateAtKnot(
  a: Position,
  b: Position,
  knotA: number,
  knotB: number,
  target: number,
): Position {
  const amount = (target - knotA) / (knotB - knotA);
  return {
    x: lerp(a.x, b.x, amount),
    y: lerp(a.y, b.y, amount),
  };
}

/** Returns a point on the centripetal Catmull-Rom segment from p1 to p2. */
export function interpolateCentripetalCatmullRom(
  p0: ScreenStrokePoint,
  p1: ScreenStrokePoint,
  p2: ScreenStrokePoint,
  p3: ScreenStrokePoint,
  t: number,
): ScreenStrokePoint {
  const amount = MathHelper.clamp(t, 0, 1);
  const knot0 = 0;
  const knot1 = knot0 + knotInterval(p0, p1);
  const knot2 = knot1 + knotInterval(p1, p2);
  const knot3 = knot2 + knotInterval(p2, p3);
  const target = lerp(knot1, knot2, amount);

  // Barry-Goldman pyramid evaluation of the non-uniform spline.
  const a1 = interpolateAtKnot(p0, p1, knot0, knot1, target);
  const a2 = interpolateAtKnot(p1, p2, knot1, knot2, target);
  const a3 = interpolateAtKnot(p2, p3, knot2, knot3, target);
  const b1 = interpolateAtKnot(a1, a2, knot0, knot2, target);
  const b2 = interpolateAtKnot(a2, a3, knot1, knot3, target);
  const position = interpolateAtKnot(b1, b2, knot1, knot2, target);

  return {
    ...position,
    // Cubic pressure interpolation can overshoot and create visible width
    // ripples, so pressure and time remain monotonic between the endpoints.
    pressure: lerp(p1.pressure, p2.pressure, amount),
    time: lerp(p1.time, p2.time, amount),
  };
}

/**
 * Screen-space pen pipeline: time-adjusted EMA, adaptive decimation, then a
 * streaming centripetal Catmull-Rom spline. The sink receives curve samples.
 */
export class StrokeSmoother {
  private readonly factor: number;
  private stabilized: ScreenStrokePoint | null = null;
  /** Sliding window; contains at most four points, and normally three. */
  private readonly retained: ScreenStrokePoint[] = [];
  private firstSegmentEmitted = false;

  constructor(factor: number, private readonly sink: PointSink) {
    this.factor = MathHelper.clamp(factor, 0, 1);
  }

  begin(point: ScreenStrokePoint): void {
    const start = normalizePoint(point);
    this.stabilized = start;
    this.retained.length = 0;
    this.retained.push(start);
    this.firstSegmentEmitted = false;
    this.sink(start);
  }

  add(point: ScreenStrokePoint): void {
    if (!this.stabilized) {
      this.begin(point);
      return;
    }

    const raw = normalizePoint(point);
    if (this.factor === 0) {
      this.stabilized = raw;
      this.sink(raw);
      return;
    }

    const baseAlpha = 1 - 0.85 * this.factor;
    const alpha = adjustEmaAlpha(baseAlpha, raw.time - this.stabilized.time);
    const filtered = applyEma(this.stabilized, raw, alpha);
    this.stabilized = filtered;

    if (this.shouldRetain(filtered)) this.retain(filtered);
  }

  /** Flushes the spline tail. Call once before committing the brush stroke. */
  end(): void {
    if (this.factor === 0 || !this.stabilized) return;

    const last = this.retained[this.retained.length - 1];
    if (Math.hypot(this.stabilized.x - last.x, this.stabilized.y - last.y) > 0.01) {
      this.retain({ ...this.stabilized });
    }

    if (this.retained.length === 2 && !this.firstSegmentEmitted) {
      const [start, finish] = this.retained;
      this.emitSegment(
        extrapolateEndpoint(start, finish),
        start,
        finish,
        extrapolateEndpoint(finish, start),
      );
    } else if (this.retained.length === 3 && this.firstSegmentEmitted) {
      const [previous, start, finish] = this.retained;
      this.emitSegment(previous, start, finish, extrapolateEndpoint(finish, start));
    }
  }

  private shouldRetain(filtered: ScreenStrokePoint): boolean {
    const last = this.retained[this.retained.length - 1];
    const distance = Math.hypot(filtered.x - last.x, filtered.y - last.y);
    let threshold = 0.25 + 1.75 * this.factor;

    // Both direction vectors use EMA-filtered points, keeping raw jitter out of
    // the corner detector.
    if (this.retained.length >= 2) {
      const prior = this.retained[this.retained.length - 2];
      const ax = last.x - prior.x;
      const ay = last.y - prior.y;
      const bx = filtered.x - last.x;
      const by = filtered.y - last.y;
      const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by);
      if (lengths > 0) {
        const dot = MathHelper.clamp((ax * bx + ay * by) / lengths, -1, 1);
        const turn = 1 - dot;
        threshold *= 1 - 0.75 * Math.min(1, turn);
      }
    }
    return distance >= threshold;
  }

  private retain(point: ScreenStrokePoint): void {
    this.retained.push(point);

    if (!this.firstSegmentEmitted && this.retained.length === 3) {
      const [start, finish, lookAhead] = this.retained;
      this.emitSegment(extrapolateEndpoint(start, finish), start, finish, lookAhead);
      this.firstSegmentEmitted = true;
      return;
    }

    if (this.firstSegmentEmitted && this.retained.length === 4) {
      this.emitSegment(
        this.retained[0],
        this.retained[1],
        this.retained[2],
        this.retained[3],
      );
      this.retained.shift();
    }
  }

  private emitSegment(
    p0: ScreenStrokePoint,
    p1: ScreenStrokePoint,
    p2: ScreenStrokePoint,
    p3: ScreenStrokePoint,
  ): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y)));
    for (let step = 1; step <= steps; step++) {
      this.sink(interpolateCentripetalCatmullRom(p0, p1, p2, p3, step / steps));
    }
  }
}
