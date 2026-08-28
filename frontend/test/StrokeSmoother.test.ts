import { describe, expect, it } from "vitest";
import {
  adjustEmaAlpha,
  applyEma,
  interpolateCentripetalCatmullRom,
  StrokeSmoother,
  type ScreenStrokePoint,
} from "~/canvas/brush/StrokeSmoother";

const point = (x: number, y: number, pressure = 1, time = 0): ScreenStrokePoint => ({
  x,
  y,
  pressure,
  time,
});

describe("stroke interpolation functions", () => {
  it("applies EMA independently to position and pressure", () => {
    expect(applyEma(point(0, 10, 0), point(10, 20, 1, 5), 0.25))
      .toEqual(point(2.5, 12.5, 0.25, 5));
  });

  it("adjusts EMA decay to the event interval", () => {
    const alphaAt60Hz = 0.3;
    const alphaAt240Hz = adjustEmaAlpha(alphaAt60Hz, 1000 / 240);
    const remainingAfterFourSteps = Math.pow(1 - alphaAt240Hz, 4);
    expect(remainingAfterFourSteps).toBeCloseTo(1 - alphaAt60Hz, 10);
    expect(adjustEmaAlpha(alphaAt60Hz, 0)).toBeGreaterThan(0);
  });

  it("interpolates a centripetal Catmull-Rom segment between its middle points", () => {
    const controls = [point(-10, 0), point(0, 0), point(10, 10), point(20, 10)] as const;
    expect(interpolateCentripetalCatmullRom(...controls, 0)).toEqual(controls[1]);
    expect(interpolateCentripetalCatmullRom(...controls, 1)).toEqual(controls[2]);
    const midpoint = interpolateCentripetalCatmullRom(...controls, 0.5);
    expect(midpoint.x).toBeCloseTo(5);
    expect(midpoint.y).toBeCloseTo(5);
  });

  it("interpolates pressure linearly without cubic overshoot", () => {
    const controls = [
      point(-10, 0, 1),
      point(0, 0, 0.2),
      point(10, 0, 0.8),
      point(20, 0, 0),
    ] as const;
    expect(interpolateCentripetalCatmullRom(...controls, 0.5).pressure).toBeCloseTo(0.5);
  });
});

describe("StrokeSmoother", () => {
  it("passes raw input through when factor is zero", () => {
    const output: ScreenStrokePoint[] = [];
    const smoother = new StrokeSmoother(0, (value) => output.push(value));
    smoother.begin(point(0, 0));
    smoother.add(point(2, 3, 0.5));
    smoother.end();
    expect(output).toEqual([point(0, 0), point(2, 3, 0.5)]);
  });

  it("emits a continuous spline ending at the final stabilized point", () => {
    const output: ScreenStrokePoint[] = [];
    const smoother = new StrokeSmoother(0.5, (value) => output.push(value));
    smoother.begin(point(0, 0));
    smoother.add(point(10, 1, 1, 16));
    smoother.add(point(20, -1, 1, 32));
    smoother.add(point(30, 0, 1, 48));
    smoother.end();

    expect(output.length).toBeGreaterThan(3);
    expect(output[0]).toEqual(point(0, 0));
    for (const value of output) {
      expect(Number.isFinite(value.x)).toBe(true);
      expect(Number.isFinite(value.y)).toBe(true);
      expect(value.pressure).toBeGreaterThanOrEqual(0);
      expect(value.pressure).toBeLessThanOrEqual(1);
    }
  });

  it("reduces high-frequency screen-space jitter", () => {
    const output: ScreenStrokePoint[] = [];
    const smoother = new StrokeSmoother(1, (value) => output.push(value));
    smoother.begin(point(0, 0));
    for (let x = 1; x <= 30; x++) {
      smoother.add(point(x, x % 2 === 0 ? 2 : -2, 1, x * 4));
    }
    smoother.end();

    const maximumY = Math.max(...output.map((value) => Math.abs(value.y)));
    expect(maximumY).toBeLessThan(2);
  });

  it("flushes movement shorter than the decimation threshold", () => {
    const output: ScreenStrokePoint[] = [];
    const smoother = new StrokeSmoother(1, (value) => output.push(value));
    smoother.begin(point(0, 0));
    smoother.add(point(1, 0, 1, 16));
    smoother.end();

    expect(output.length).toBeGreaterThan(1);
    expect(output.at(-1)?.x).toBeGreaterThan(0);
  });
});
