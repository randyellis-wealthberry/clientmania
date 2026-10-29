import * as THREE from "three";

export const TAU = Math.PI * 2;

export function rand(min = 0, max = 1): number {
  return min + Math.random() * (max - min);
}

export function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential smoothing. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function dampVec3(current: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number): void {
  const t = 1 - Math.exp(-lambda * dt);
  current.lerp(target, t);
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function makeCanvas(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

export function canvasTexture(ctx: CanvasRenderingContext2D): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export const COLORS = {
  ink: 0x07060c,
  inkSoft: 0x141122,
  paper: 0xf4efe4,
  acid: 0xd7ff3e,
  magenta: 0xff2e88,
  cyan: 0x47e0ff,
  orange: 0xff7a1a,
  violet: 0x8b5cff,
  red: 0xff3b30,
  gold: 0xffc93c,
} as const;

export type Hex = number;
