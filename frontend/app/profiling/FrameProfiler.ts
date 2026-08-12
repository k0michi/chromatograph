const TARGET_FRAME_MS = 1000 / 60;
const HISTORY_SIZE = 120;

export interface FrameProfilerElements {
  readonly graph: HTMLCanvasElement;
  readonly fps: HTMLElement;
  readonly delay: HTMLElement;
  readonly renderTime: HTMLElement;
}

export class FrameProfiler {
  private readonly delays = new Float32Array(HISTORY_SIZE);
  private previousTimestamp: number | null = null;
  private writeIndex = 0;
  private sampleCount = 0;

  constructor(private readonly elements: FrameProfilerElements) { }

  sample(timestamp: number, renderTimeMs: number): void {
    if (this.previousTimestamp === null) {
      this.previousTimestamp = timestamp;
      return;
    }

    const frameTime = timestamp - this.previousTimestamp;
    this.previousTimestamp = timestamp;
    const delay = frameTime;
    this.delays[this.writeIndex] = delay;
    this.writeIndex = (this.writeIndex + 1) % HISTORY_SIZE;
    this.sampleCount = Math.min(HISTORY_SIZE, this.sampleCount + 1);

    const averageFrameTime = this.averageDelay();
    this.elements.fps.textContent = `${(1000 / averageFrameTime).toFixed(1)} FPS`;
    this.elements.delay.textContent = `Delay ${delay.toFixed(2)} ms`;
    this.elements.renderTime.textContent = `Render ${renderTimeMs.toFixed(2)} ms`;
    this.drawGraph();
  }

  private averageDelay(): number {
    let total = 0;
    for (let index = 0; index < this.sampleCount; index++) {
      total += this.delays[index];
    }
    return this.sampleCount > 0 ? total / this.sampleCount : 0;
  }

  private drawGraph(): void {
    const { graph } = this.elements;
    const context = graph.getContext("2d");
    if (!context) return;

    const { width, height } = graph;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(0, 0, 0, 0.45)";
    context.fillRect(0, 0, width, height);

    let maximumDelay = TARGET_FRAME_MS;
    for (let index = 0; index < this.sampleCount; index++) {
      maximumDelay = Math.max(maximumDelay, this.delays[index]);
    }
    const graphMaximum = Math.ceil(maximumDelay / 4) * 4;

    context.strokeStyle = "rgba(255, 255, 255, 0.16)";
    context.beginPath();
    context.moveTo(0, height - 0.5);
    context.lineTo(width, height - 0.5);
    context.stroke();

    if (this.sampleCount < 2) return;
    context.strokeStyle = maximumDelay > TARGET_FRAME_MS * 2 ? "#ff5c5c" : maximumDelay > TARGET_FRAME_MS ? "#ffd45c" : "#69f0ae";
    context.lineWidth = 1.5;
    context.beginPath();
    for (let sample = 0; sample < this.sampleCount; sample++) {
      const historyIndex = (this.writeIndex - this.sampleCount + sample + HISTORY_SIZE) % HISTORY_SIZE;
      const x = sample * (width - 1) / (HISTORY_SIZE - 1);
      const y = height - 1 - Math.min(1, this.delays[historyIndex] / graphMaximum) * (height - 2);
      if (sample === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();

    context.fillStyle = "rgba(255, 255, 255, 0.65)";
    context.font = "9px ui-monospace, monospace";
    context.fillText(`${graphMaximum} ms`, 4, 10);
  }
}
