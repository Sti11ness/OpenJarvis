export function mountNeuralActivity(canvas: HTMLCanvasElement): {
  update(phase: string, level: number): void;
  dispose(): void;
};
