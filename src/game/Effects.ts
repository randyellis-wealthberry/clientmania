import * as THREE from "three";
import { COLORS, TAU, canvasTexture, clamp, easeOutCubic, makeCanvas, pick, rand } from "./utils";

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  color: THREE.Color;
  gravity: number;
  drag: number;
}

interface Transient {
  object: THREE.Object3D;
  life: number;
  maxLife: number;
  tick?: (t: number, dt: number) => void;
  scale?: number;
}

interface Decal {
  mesh: THREE.Mesh;
  born: number;
}

const UP = new THREE.Vector3(0, 1, 0);

let glowTexture: THREE.Texture | null = null;
function glow(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const ctx = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.85)");
  g.addColorStop(0.6, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTexture = canvasTexture(ctx);
  return glowTexture;
}

const splatCache = new Map<number, THREE.Texture>();
function splatTexture(color: number): THREE.Texture {
  const cached = splatCache.get(color);
  if (cached) return cached;
  const ctx = makeCanvas(256, 256);
  const css = `#${color.toString(16).padStart(6, "0")}`;
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = css;
  // main blob
  ctx.beginPath();
  const points = 18;
  for (let i = 0; i < points; i++) {
    const a = (i / points) * TAU;
    const r = 52 + Math.random() * 34;
    const x = 128 + Math.cos(a) * r;
    const y = 128 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  // droplets
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * TAU;
    const dist = 70 + Math.random() * 54;
    const r = 2 + Math.random() * 11;
    ctx.beginPath();
    ctx.ellipse(128 + Math.cos(a) * dist, 128 + Math.sin(a) * dist, r, r * (0.5 + Math.random()), a, 0, TAU);
    ctx.fill();
  }
  // darker rim
  ctx.globalCompositeOperation = "source-atop";
  const g = ctx.createRadialGradient(128, 120, 20, 128, 128, 140);
  g.addColorStop(0, "rgba(255,255,255,0.18)");
  g.addColorStop(0.55, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = canvasTexture(ctx);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  splatCache.set(color, tex);
  return tex;
}

/**
 * Procedural VFX: sparks, paper confetti, tracers, bolts, shockwaves, splats,
 * explosions, gravity-well visuals and floating damage numbers. No assets.
 */
export class Effects {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private layer: HTMLElement;
  private particles: Particle[] = [];
  private points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private geometry: THREE.BufferGeometry;
  private transients: Transient[] = [];
  private decals: Decal[] = [];
  private readonly MAX_PARTICLES = 900;
  private readonly MAX_DECALS = 90;
  private cylinder = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  private sphereGeo = new THREE.SphereGeometry(1, 18, 12);
  private ringGeo = new THREE.RingGeometry(0.82, 1, 64);
  private planeGeo = new THREE.PlaneGeometry(1, 1);
  private coneGeo = new THREE.ConeGeometry(1, 1, 10, 1, true);
  private flash: HTMLDivElement;
  private flashAlpha = 0;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, layer: HTMLElement) {
    this.scene = scene;
    this.camera = camera;
    this.layer = layer;
    this.positions = new Float32Array(this.MAX_PARTICLES * 3);
    this.colors = new Float32Array(this.MAX_PARTICLES * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.1,
      map: glow(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geometry, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    for (let i = 0; i < this.MAX_PARTICLES; i++) this.positions[i * 3 + 1] = -9999;

    this.flash = document.createElement("div");
    this.flash.className = "vfx-flash";
    layer.appendChild(this.flash);
  }

  spark(pos: THREE.Vector3, color: number, count: number, opts: {
    speed?: number;
    spread?: number;
    up?: number;
    gravity?: number;
    life?: number;
    drag?: number;
  } = {}): void {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = (opts.speed ?? 4) * (0.35 + Math.random());
      this.particles.push({
        pos: pos.clone(),
        vel: new THREE.Vector3(Math.cos(a) * s * (opts.spread ?? 1), (opts.up ?? 1) * s * rand(0.1, 1.2), Math.sin(a) * s * (opts.spread ?? 1)),
        life: (opts.life ?? 0.6) * rand(0.6, 1.3),
        maxLife: 1,
        color: c.clone().offsetHSL(rand(-0.04, 0.04), 0, rand(-0.1, 0.2)),
        gravity: opts.gravity ?? 9,
        drag: opts.drag ?? 0.6,
      });
      const p = this.particles[this.particles.length - 1]!;
      p.maxLife = p.life;
    }
    this.trim();
  }

  confetti(pos: THREE.Vector3, count: number): void {
    const palette = [COLORS.paper, COLORS.acid, COLORS.magenta, COLORS.cyan, COLORS.orange];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = rand(1, 4.5);
      const life = rand(0.9, 2.1);
      this.particles.push({
        pos: pos.clone().add(new THREE.Vector3(rand(-0.2, 0.2), rand(-0.2, 0.3), rand(-0.2, 0.2))),
        vel: new THREE.Vector3(Math.cos(a) * s, rand(1, 6), Math.sin(a) * s),
        life,
        maxLife: life,
        color: new THREE.Color(pick(palette)),
        gravity: 3.2,
        drag: 1.2,
      });
    }
    this.trim();
  }

  private trim(): void {
    if (this.particles.length > this.MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - this.MAX_PARTICLES);
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number, life = 0.09, radius = 0.012): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.cylinder, mat);
    this.orient(mesh, from, to, radius);
    mesh.renderOrder = 4;
    this.addTransient(mesh, life);
    this.spark(to, color, 4, { speed: 2, spread: 0.6, up: 0.2, life: 0.25 });
  }

  beam(from: THREE.Vector3, to: THREE.Vector3, color: number, life: number, radius = 0.035): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.cylinder, mat);
    this.orient(mesh, from, to, radius);
    mesh.renderOrder = 4;
    this.addTransient(mesh, life, {
      tick: (t) => {
        mat.opacity = 0.75 + Math.sin(t * 55) * 0.25;
        mesh.scale.x = mesh.scale.z = radius * (1 + Math.sin(t * 40) * 0.35);
      },
    });
    this.spark(to, color, 3, { speed: 5, spread: 0.5, up: 0.4, life: 0.3 });
  }

  ring(pos: THREE.Vector3, color: number, radius: number, life = 0.5, thickness = 1): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(pos).setY(Math.max(0.04, pos.y));
    mesh.scale.setScalar(0.35);
    mesh.renderOrder = 3;
    this.addTransient(mesh, life, {
      tick: (t) => {
        const e = easeOutCubic(clamp(t / life, 0, 1));
        mesh.scale.setScalar(0.35 + (radius - 0.35) * e);
        mat.opacity = (1 - e) * 0.9 * thickness;
      },
    });
  }

  explosion(pos: THREE.Vector3, color: number, radius: number): void {
    const hot = new THREE.Color(color).lerp(new THREE.Color(COLORS.paper), 0.25);
    const mat = new THREE.MeshBasicMaterial({
      color: hot,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ball = new THREE.Mesh(this.sphereGeo, mat);
    ball.position.copy(pos);
    ball.scale.setScalar(radius * 0.35);
    ball.renderOrder = 4;
    this.addTransient(ball, 0.42, {
      tick: (t) => {
        const e = easeOutCubic(clamp(t / 0.42, 0, 1));
        ball.scale.setScalar(radius * (0.25 + e * 0.8));
        mat.opacity = (1 - e) * 0.6;
      },
    });
    this.ring(pos, color, radius * 1.7, 0.55);
    this.spark(pos, COLORS.orange, 26, { speed: 9, spread: 1, up: 1, life: 0.9, gravity: 12 });
    this.spark(pos, color, 18, { speed: 7, spread: 1, up: 0.8, life: 0.7, gravity: 8 });
    this.confetti(pos, 14);
    this.flashScreen(0.1, color);
  }

  flameCone(from: THREE.Vector3, dir: THREE.Vector3, length: number, color: number = COLORS.orange): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.coneGeo, mat);
    mesh.position.copy(from).addScaledVector(dir, length * 0.5);
    mesh.quaternion.setFromUnitVectors(UP, dir);
    const width = 0.24 + Math.random() * 0.1;
    mesh.scale.set(width, length, width);
    mesh.renderOrder = 3;
    this.addTransient(mesh, 0.17, {
      tick: (t) => {
        const p = t / 0.17;
        mat.opacity = 0.22 * (1 - p);
        mesh.scale.set(width * (1 + p * 2.2), length * (1 + p * 0.12), width * (1 + p * 2.2));
      },
    });
  }

  flameBurst(from: THREE.Vector3, dir: THREE.Vector3, distance: number, color: number = COLORS.orange): void {
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.SpriteMaterial({
        map: glow(),
        color: i === 0 ? 0xffe6a8 : color,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      const t = rand(0.1, 1);
      const base = 0.4 + t * 1.4;
      sprite.position
        .copy(from)
        .addScaledVector(dir, distance * t)
        .add(new THREE.Vector3(rand(-0.35, 0.35), rand(-0.3, 0.3), rand(-0.35, 0.35)));
      sprite.scale.setScalar(base);
      this.addTransient(sprite, 0.34, {
        tick: (elapsed) => {
          const p = elapsed / 0.34;
          mat.opacity = 0.5 * (1 - p);
          sprite.scale.setScalar(base * (1 + p * 1.4));
        },
      });
    }
  }

  impact(pos: THREE.Vector3, normal: THREE.Vector3, color: number, decalSize = 0): void {
    this.spark(pos, color, 7, { speed: 3.4, spread: 0.8, up: 0.6, life: 0.4 });
    this.spark(pos, COLORS.paper, 3, { speed: 2, spread: 0.7, up: 0.3, life: 0.3 });
    if (decalSize > 0) this.splat(pos, normal, color, decalSize);
  }

  splat(pos: THREE.Vector3, normal: THREE.Vector3, color: number, size: number): void {
    const mat = new THREE.MeshBasicMaterial({
      map: splatTexture(color),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      opacity: 0.92,
    });
    const mesh = new THREE.Mesh(this.planeGeo, mat);
    mesh.scale.setScalar(size * rand(0.8, 1.25));
    mesh.position.copy(pos).addScaledVector(normal, 0.012);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    mesh.rotateZ(rand(0, TAU));
    this.scene.add(mesh);
    this.decals.push({ mesh, born: performance.now() });
    if (this.decals.length > this.MAX_DECALS) {
      const old = this.decals.shift();
      if (old) {
        this.scene.remove(old.mesh);
        (old.mesh.material as THREE.Material).dispose();
      }
    }
  }

  lightning(from: THREE.Vector3, to: THREE.Vector3, color = COLORS.cyan): void {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const segments = 9;
    const prev = from.clone();
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const p = from.clone().lerp(to, t);
      if (i < segments) {
        p.x += rand(-1.4, 1.4) * (1 - t * 0.5);
        p.z += rand(-1.4, 1.4) * (1 - t * 0.5);
        p.y += rand(-0.4, 0.4);
      }
      const mesh = new THREE.Mesh(this.cylinder, mat);
      this.orient(mesh, prev, p, rand(0.018, 0.05));
      group.add(mesh);
      prev.copy(p);
    }
    const glowMat = new THREE.SpriteMaterial({ map: glow(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const s = new THREE.Sprite(glowMat);
    s.position.copy(to);
    s.scale.setScalar(3.4);
    group.add(s);
    this.scene.add(group);
    this.transients.push({
      object: group,
      life: 0.28,
      maxLife: 0.28,
      tick: (t) => {
        const a = 1 - t / 0.28;
        mat.opacity = a;
        glowMat.opacity = a * 0.85;
      },
    });
    this.spark(to, color, 22, { speed: 7, spread: 1, up: 0.8, life: 0.55, gravity: 5 });
    this.flashScreen(0.12, color);
  }

  well(pos: THREE.Vector3, color: number, life: number): () => void {
    const group = new THREE.Group();
    group.position.copy(pos);
    const coreMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const core = new THREE.Mesh(this.sphereGeo, coreMat);
    core.scale.setScalar(0.55);
    group.add(core);
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const rings: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1.4 + i * 0.5, 0.035, 6, 64), ringMat);
      r.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
      group.add(r);
      rings.push(r);
    }
    const glowMat = new THREE.SpriteMaterial({ map: glow(), color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const halo = new THREE.Sprite(glowMat);
    halo.scale.setScalar(6);
    group.add(halo);
    this.scene.add(group);
    let elapsed = 0;
    this.transients.push({
      object: group,
      life,
      maxLife: life,
      tick: (t, dt) => {
        elapsed += dt;
        core.scale.setScalar(0.5 + Math.sin(elapsed * 9) * 0.08);
        rings.forEach((r, i) => {
          r.rotation.x += dt * (1.4 + i * 0.7);
          r.rotation.y += dt * (1.1 + i * 0.35);
          r.scale.setScalar(1 + Math.sin(elapsed * 3 + i) * 0.18);
        });
        halo.scale.setScalar(5 + Math.sin(elapsed * 5) * 0.8);
        const fade = Math.min(1, (life - t) / 0.4) * Math.min(1, t / 0.15);
        coreMat.opacity = 0.9 * fade;
        ringMat.opacity = 0.55 * fade;
        glowMat.opacity = 0.45 * fade;
      },
    });
    this.spark(pos, color, 40, { speed: 8, spread: 1, up: 0.4, life: 0.8, gravity: 0, drag: 1.5 });
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.scene.remove(group);
      const index = this.transients.findIndex((tr) => tr.object === group);
      if (index >= 0) this.transients.splice(index, 1);
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
        for (const m of mats) m.dispose();
      });
    };
  }

  flashScreen(alpha: number, color: number = COLORS.paper): void {
    this.flash.style.background = `#${color.toString(16).padStart(6, "0")}`;
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
    this.flash.style.opacity = String(this.flashAlpha);
  }

  damageNumber(pos: THREE.Vector3, text: string, color: number = COLORS.paper, big = false): void {
    const v = pos.clone().project(this.camera);
    if (v.z > 1) return;
    const el = document.createElement("div");
    el.className = `dmg-number${big ? " big" : ""}`;
    el.textContent = text;
    el.style.color = `#${color.toString(16).padStart(6, "0")}`;
    el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
    el.style.setProperty("--dx", `${rand(-26, 26)}px`);
    this.layer.appendChild(el);
    window.setTimeout(() => el.remove(), 900);
  }

  private addTransient(object: THREE.Object3D, life: number, opts: { tick?: (t: number, dt: number) => void } = {}): void {
    this.scene.add(object);
    this.transients.push({ object, life, maxLife: life, tick: opts.tick });
  }

  private orient(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, radius: number): void {
    const dir = to.clone().sub(from);
    const len = dir.length();
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
    mesh.scale.set(radius, len, radius);
  }

  update(dt: number): void {
    if (this.flashAlpha > 0.001) {
      this.flashAlpha *= Math.exp(-9 * dt);
      this.flash.style.opacity = String(this.flashAlpha);
    } else if (this.flashAlpha !== 0) {
      this.flashAlpha = 0;
      this.flash.style.opacity = "0";
    }

    // particles
    let w = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.02) {
        p.pos.y = 0.02;
        p.vel.y *= -0.35;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
      this.particles[w++] = p;
    }
    this.particles.length = w;

    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p) {
        this.positions[i * 3 + 1] = -9999;
        this.colors[i * 3] = this.colors[i * 3 + 1] = this.colors[i * 3 + 2] = 0;
        continue;
      }
      this.positions[i * 3] = p.pos.x;
      this.positions[i * 3 + 1] = p.pos.y;
      this.positions[i * 3 + 2] = p.pos.z;
      const f = clamp(p.life / p.maxLife, 0, 1);
      const glowAmt = 0.95 + f * 0.75;
      this.colors[i * 3] = p.color.r * glowAmt * f;
      this.colors[i * 3 + 1] = p.color.g * glowAmt * f;
      this.colors[i * 3 + 2] = p.color.b * glowAmt * f;
    }
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;

    // transients
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const tr = this.transients[i]!;
      tr.life -= dt;
      const elapsed = tr.maxLife - tr.life;
      tr.tick?.(elapsed, dt);
      if (tr.life <= 0) {
        this.scene.remove(tr.object);
        tr.object.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const m of mats) {
              m.dispose();
            }
          }
        });
        this.transients.splice(i, 1);
      }
    }

    // fade old decals out after a while
    const now = performance.now();
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i]!;
      const age = (now - d.born) / 1000;
      if (age > 26) {
        (d.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.92 * (1 - (age - 26) / 6));
        if (age > 32) {
          this.scene.remove(d.mesh);
          (d.mesh.material as THREE.Material).dispose();
          this.decals.splice(i, 1);
        }
      }
    }
  }

  clear(): void {
    this.particles.length = 0;
    for (const tr of this.transients) this.scene.remove(tr.object);
    this.transients.length = 0;
    for (const d of this.decals) {
      this.scene.remove(d.mesh);
      (d.mesh.material as THREE.Material).dispose();
    }
    this.decals.length = 0;
    this.layer.querySelectorAll(".dmg-number").forEach((n) => n.remove());
    this.flashAlpha = 0;
    this.flash.style.opacity = "0";
  }

  /** Ambient drifting dust motes, cheap and pretty. */
  dust(count: number): void {
    const ctx = makeCanvas(64, 64);
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = canvasTexture(ctx);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const r = rand(2, 26);
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = rand(0.3, 12);
      positions[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.14,
      map: tex,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: COLORS.violet,
    });
    const pts = new THREE.Points(geo, mat);
    pts.name = "dust";
    this.scene.add(pts);
    this.transients.push({
      object: pts,
      life: Number.MAX_SAFE_INTEGER,
      maxLife: Number.MAX_SAFE_INTEGER,
      tick: () => {
        pts.rotation.y += 0.0008;
        const arr = geo.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < count; i++) {
          arr.setY(i, (arr.getY(i) + 0.0015 * (0.4 + (i % 5) * 0.2)) % 12);
        }
        arr.needsUpdate = true;
      },
    });
  }
}

export function randomConfettiColor(): number {
  return pick([COLORS.acid, COLORS.magenta, COLORS.cyan, COLORS.orange, COLORS.paper]);
}
