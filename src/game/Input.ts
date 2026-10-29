/** Pointer-lock first-person input. Keeps edge-triggered keys for discrete actions. */
export class Input {
  readonly keys = new Set<string>();
  readonly justPressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  primary = false;
  secondary = false;
  primaryPressed = false;
  secondaryPressed = false;
  pointerLocked = false;
  private canvas: HTMLCanvasElement;
  private onLockChange: (locked: boolean) => void;

  constructor(canvas: HTMLCanvasElement, onLockChange: (locked: boolean) => void = () => {}) {
    this.canvas = canvas;
    this.onLockChange = onLockChange;

    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (this.pointerLocked && ["Space", "Tab", "KeyQ", "KeyE", "KeyF", "KeyR"].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.justPressed.add(e.code);
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.primary = false;
      this.secondary = false;
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener("mousedown", (e) => {
      if (!this.pointerLocked) return;
      if (e.button === 0) {
        this.primary = true;
        this.primaryPressed = true;
      } else if (e.button === 2) {
        this.secondary = true;
        this.secondaryPressed = true;
      }
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.primary = false;
      if (e.button === 2) this.secondary = false;
    });
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener(
      "wheel",
      (e) => {
        if (!this.pointerLocked) return;
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false },
    );
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) {
        this.primary = false;
        this.secondary = false;
      }
      this.onLockChange(this.pointerLocked);
    });
  }

  requestLock(): void {
    if (this.pointerLocked) return;
    const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === "function") p.catch(() => {});
  }

  exitLock(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  pressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  endFrame(): void {
    this.justPressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.primaryPressed = false;
    this.secondaryPressed = false;
  }

  clear(): void {
    this.keys.clear();
    this.justPressed.clear();
    this.primary = false;
    this.secondary = false;
    this.primaryPressed = false;
    this.secondaryPressed = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
