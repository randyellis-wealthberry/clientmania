import * as THREE from "three";
import { COLORS, TAU, clamp, pick, rand } from "./utils";
import type { Client } from "./Client";
import type { Effects } from "./Effects";
import type { SynthAudio } from "./Audio";
import type { Arena } from "./Arena";
import { Projectiles } from "./Projectiles";
import type { WeaponId } from "./weaponDefs";
import { WEAPONS, type WeaponDef } from "./weaponDefs";
import type { Viewmodel } from "./Viewmodel";

export interface WeaponWorld {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  effects: Effects;
  audio: SynthAudio;
  arena: Arena;
  projectiles: Projectiles;
  getClients: () => Client[];
  damageClient: (
    client: Client,
    amount: number,
    point: THREE.Vector3,
    dir: THREE.Vector3,
    opts?: { heavy?: boolean; color?: number; big?: boolean; silent?: boolean },
  ) => number;
  damageSphere: (center: THREE.Vector3, radius: number, amount: number, opts?: { heavy?: boolean; color?: number }) => number;
  shake: (amount: number) => void;
  hitstop: (seconds: number) => void;
  hint: (text: string) => void;
  onStickyChange: (count: number) => void;
  rageActive: () => boolean;
}

interface Pending {
  time: number;
  fn: () => void;
}

interface Field {
  center: THREE.Vector3;
  life: number;
  tick: number;
}

interface Swarm {
  points: THREE.Points;
  positions: Float32Array;
  center: THREE.Vector3;
  life: number;
  tick: number;
  phase: number;
  damage: number;
}

interface RayHit {
  point: THREE.Vector3;
  client: Client | null;
  normal: THREE.Vector3;
  distance: number;
}

const PAINT_COLORS = [COLORS.magenta, COLORS.cyan, COLORS.acid, COLORS.orange, 0xff6ec7, 0x9dff6e];

export class WeaponSystem {
  private world: WeaponWorld;
  private viewmodel: Viewmodel;
  private index = 0;
  private time = 0;
  private nextPrimary = 0;
  private nextSecondary = 0;
  private primaryHeld = false;
  private secondaryHeld = false;
  private prevPrimary = false;
  private prevSecondary = false;
  private primaryBuffer = 0;
  private secondaryBuffer = 0;
  private activeLoop: "flame" | "water" | "chainsaw" | "laser" | null = null;
  private pending: Pending[] = [];
  private field: Field | null = null;
  private wellStop: (() => void) | null = null;
  private swarms: Swarm[] = [];
  private active = true;

  constructor(world: WeaponWorld, viewmodel: Viewmodel) {
    this.world = world;
    this.viewmodel = viewmodel;
  }

  get current(): WeaponDef {
    return WEAPONS[this.index]!;
  }

  get currentId(): WeaponId {
    return this.current.id;
  }

  select(next: number): WeaponDef {
    const i = ((next % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
    this.index = i;
    this.viewmodel.select(this.current.id);
    this.world.audio.ui();
    this.world.audio.stopAllLoops();
    this.activeLoop = null;
    this.nextPrimary = Math.max(this.nextPrimary, this.time + 0.1);
    this.nextSecondary = this.time + 0.1;
    this.primaryBuffer = 0;
    this.secondaryBuffer = 0;
    return this.current;
  }

  selectDelta(delta: number): WeaponDef {
    return this.select(this.index + delta);
  }

  setHeld(primary: boolean, secondary: boolean): void {
    this.primaryHeld = primary;
    this.secondaryHeld = secondary;
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.primaryHeld = false;
      this.secondaryHeld = false;
      this.world.audio.stopAllLoops();
      this.activeLoop = null;
      this.viewmodel.setContinuous(false);
    }
  }

  detonateStickies(): number {
    const stickies = this.world.projectiles.stickies;
    if (stickies.length === 0) {
      this.world.hint("NO ACTION ITEMS. THROW ONE.");
      return 0;
    }
    for (const s of stickies) {
      this.world.projectiles.detonate(s);
    }
    this.world.onStickyChange(this.world.projectiles.stickies.length);
    return stickies.length;
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]!;
      p.time -= dt;
      if (p.time <= 0) {
        this.pending.splice(i, 1);
        if (this.active) p.fn();
      }
    }
    this.updateField(dt);
    this.updateSwarms(dt);

    if (!this.active) {
      this.prevPrimary = this.primaryHeld;
      this.prevSecondary = this.secondaryHeld;
      return;
    }

    const pressedPrimary = this.primaryHeld && !this.prevPrimary;
    const pressedSecondary = this.secondaryHeld && !this.prevSecondary;
    if (pressedPrimary) this.primaryBuffer = 0.24;
    else this.primaryBuffer = Math.max(0, this.primaryBuffer - dt);
    if (pressedSecondary) this.secondaryBuffer = 0.24;
    else this.secondaryBuffer = Math.max(0, this.secondaryBuffer - dt);
    const def = this.current;
    const ready = this.time >= this.nextPrimary;

    if (def.auto || def.continuous) {
      if (this.primaryHeld && ready) this.firePrimary();
    } else if (this.primaryBuffer > 0 && ready) {
      this.primaryBuffer = 0;
      this.firePrimary();
    }
    if (this.secondaryBuffer > 0 && this.time >= this.nextSecondary) {
      this.secondaryBuffer = 0;
      this.fireSecondary();
    }

    const loopKey = def.continuous && this.primaryHeld ? this.loopKey() : null;
    if (loopKey !== this.activeLoop) {
      if (this.activeLoop) this.world.audio.loop(this.activeLoop, false);
      if (loopKey) this.world.audio.loop(loopKey, true);
      this.activeLoop = loopKey;
    }
    this.viewmodel.setContinuous(loopKey !== null);

    this.prevPrimary = this.primaryHeld;
    this.prevSecondary = this.secondaryHeld;
  }

  private loopKey(): "flame" | "water" | "chainsaw" | "laser" | null {
    switch (this.current.id) {
      case "flame":
        return "flame";
      case "hose":
        return "water";
      case "chainsaw":
        return "chainsaw";
      case "laser":
        return "laser";
      default:
        return null;
    }
  }

  private cd(seconds: number): void {
    this.nextPrimary = this.time + seconds * (this.world.rageActive() ? 0.62 : 1);
  }

  // --------------------------------------------------------------- primitives

  private muzzle(): THREE.Vector3 {
    this.world.camera.updateMatrixWorld();
    return new THREE.Vector3(0.3, -0.24, -0.62).applyMatrix4(this.world.camera.matrixWorld);
  }

  private aimDir(spread = 0): THREE.Vector3 {
    this.world.camera.updateMatrixWorld();
    const dir = new THREE.Vector3();
    this.world.camera.getWorldDirection(dir);
    if (spread > 0) {
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();
      dir.addScaledVector(right, rand(-spread, spread)).addScaledVector(up, rand(-spread, spread)).normalize();
    }
    return dir;
  }

  private rayHit(maxDist = 45): RayHit {
    const origin = this.world.camera.position.clone();
    const dir = this.aimDir();
    let best = maxDist;
    let client: Client | null = null;
    let normal = new THREE.Vector3(0, 1, 0);
    for (const c of this.world.getClients()) {
      if (c.dead) continue;
      const scale = c.isBoss ? 1.9 : 1;
      const center = c.position.clone().setY(1.0 * scale);
      const toCenter = center.clone().sub(origin);
      const t = toCenter.dot(dir);
      if (t < 0 || t > best) continue;
      const closest = origin.clone().addScaledVector(dir, t);
      const dist = closest.distanceTo(center);
      if (dist < 0.62 * scale + 0.14) {
        best = t;
        client = c;
        normal = closest.clone().sub(center).normalize();
      }
    }
    if (dir.y < -0.0001) {
      const t = -origin.y / dir.y;
      if (t > 0 && t < best) {
        best = t;
        client = null;
        normal = new THREE.Vector3(0, 1, 0);
      }
    }
    return {
      point: origin.clone().addScaledVector(dir, best),
      client,
      normal,
      distance: best,
    };
  }

  private clientsInCone(range: number, halfAngleDeg: number): { client: Client; dir: THREE.Vector3 }[] {
    const origin = this.world.camera.position.clone().setY(1.1);
    const dir = this.aimDir();
    dir.y = 0;
    dir.normalize();
    const cos = Math.cos((halfAngleDeg * Math.PI) / 180);
    const out: { client: Client; dir: THREE.Vector3 }[] = [];
    for (const c of this.world.getClients()) {
      if (c.dead) continue;
      const to = c.position.clone().setY(1.1).sub(origin);
      const dist = to.length();
      if (dist > range + c.radius) continue;
      const flat = to.clone().setY(0).normalize();
      if (flat.dot(dir) < cos) continue;
      out.push({ client: c, dir: flat });
    }
    return out;
  }

  private explode(point: THREE.Vector3, radius: number, damage: number, color: number, big = true): number {
    const hit = this.world.damageSphere(point, radius, damage, { heavy: true, color });
    this.world.effects.explosion(point, color, radius);
    this.world.effects.ring(point, color, radius * 1.6, 0.65);
    this.world.audio.explode();
    this.world.shake(big ? 1.5 : 0.7);
    this.world.hitstop(big ? 0.055 : 0.03);
    return hit;
  }

  private later(seconds: number, fn: () => void): void {
    this.pending.push({ time: seconds, fn });
  }

  private spreadPoint(point: THREE.Vector3, spread: number): THREE.Vector3 {
    return point.clone().add(new THREE.Vector3(rand(-spread, spread), 0, rand(-spread, spread)));
  }

  // ------------------------------------------------------------------ firing

  private firePrimary(): void {
    this.viewmodel.trigger("primary");
    switch (this.current.id) {
      case "hammer":
        this.hammer();
        break;
      case "gun":
        this.gun();
        break;
      case "flame":
        this.flame();
        break;
      case "hose":
        this.hose();
        break;
      case "chainsaw":
        this.chainsaw();
        break;
      case "paintball":
        this.paintball(1, 0);
        break;
      case "broom":
        this.broom(false);
        break;
      case "blackhole":
        this.blackhole();
        break;
      case "rocket":
        this.rocket(1, 0);
        break;
      case "lightning":
        this.lightning();
        break;
      case "demolition":
        this.demolition(1, 0);
        break;
      case "bugs":
        this.bugs(1);
        break;
      case "laser":
        this.laser(false);
        break;
      case "acid":
        this.acid(1);
        break;
      case "sticky":
        this.sticky();
        break;
    }
  }

  private fireSecondary(): void {
    this.viewmodel.trigger("secondary");
    const def = this.current;
    switch (def.id) {
      case "hammer":
        this.later(0.1, () => {
          const p = this.world.camera.position.clone();
          p.y = 0.1;
          this.explode(p, 5.2, 95, COLORS.acid, true);
          this.world.effects.ring(p, COLORS.paper, 7, 0.7);
          this.world.audio.hammer();
          this.cd(1.1);
        });
        this.world.hint("GROUND SLAM — FLOOR IS A DELIVERABLE");
        break;
      case "gun":
        for (let i = 0; i < 3; i++) this.later(i * 0.075, () => this.gunShot(0.018));
        this.cd(0.55);
        break;
      case "flame":
        this.fireball();
        this.cd(0.9);
        break;
      case "hose":
        this.pressureBlast();
        this.cd(0.9);
        break;
      case "chainsaw":
        this.whirl();
        this.cd(1.2);
        break;
      case "paintball":
        for (let i = 0; i < 7; i++) this.paintball(1, 0.06);
        this.world.audio.splat();
        this.cd(0.75);
        break;
      case "broom":
        this.broom(true);
        this.cd(0.9);
        break;
      case "blackhole":
        if (this.field) this.collapseField();
        else this.world.hint("NO WELL OPEN. THROW ONE FIRST.");
        this.cd(0.6);
        break;
      case "rocket":
        for (let i = 0; i < 3; i++) this.later(i * 0.09, () => this.rocket(1, 0.035));
        this.cd(1.4);
        break;
      case "lightning":
        for (let i = 0; i < 6; i++) this.later(i * 0.1, () => this.strikeRandom());
        this.world.audio.zap();
        this.cd(2.2);
        break;
      case "demolition":
        for (let i = 0; i < 3; i++) this.demolition(1, 0.1 * (i - 1));
        this.cd(1.8);
        break;
      case "bugs":
        this.bugs(2);
        this.cd(2.4);
        break;
      case "laser":
        this.laser(true);
        this.cd(1.5);
        break;
      case "acid":
        this.acid(1.6);
        this.cd(1.5);
        break;
      case "sticky":
        this.detonateStickies();
        this.nextSecondary = this.time + 0.35;
        break;
    }
  }

  private hammer(): void {
    this.world.audio.swing();
    this.later(0.085, () => {
      const hits = this.clientsInCone(3.5, 55);
      const p = this.muzzle().addScaledVector(this.aimDir(), 1.2);
      for (const { client, dir } of hits) {
        const chest = client.position.clone().setY(1.2);
        this.world.damageClient(client, 72, chest, dir, { heavy: true, color: COLORS.acid, big: true });
        this.world.effects.spark(chest, COLORS.paper, 10, { speed: 4, spread: 1, up: 1 });
      }
      this.world.audio.hammer();
      this.world.shake(0.8);
      this.world.hitstop(0.045);
      this.world.effects.ring(p.clone().setY(0.08), COLORS.acid, 2.6, 0.3, 0.8);
      if (hits.length === 0) this.world.effects.spark(p, COLORS.paper, 3, { speed: 1.5, up: 0.5, life: 0.3 });
      this.cd(this.current.cooldown);
    });
  }

  private gun(): void {
    this.gunShot(0);
    this.cd(this.current.cooldown);
  }

  private gunShot(extraSpread: number): void {
    const from = this.muzzle();
    const hit = this.rayHit();
    if (extraSpread > 0) hit.point.add(new THREE.Vector3(rand(-0.4, 0.4), rand(-0.3, 0.4), rand(-0.4, 0.4)));
    this.world.effects.tracer(from, hit.point, COLORS.cyan, 0.075, 0.008);
    this.world.effects.spark(hit.point, COLORS.cyan, 3, { speed: 2.5, up: 0.4, life: 0.2 });
    if (hit.client) {
      this.world.damageClient(hit.client, 17, hit.point, this.aimDir(), { color: COLORS.cyan });
    } else if (hit.normal.y > 0.5) {
      this.world.effects.splat(hit.point, hit.normal, COLORS.cyan, 0.42);
      this.world.effects.spark(hit.point, COLORS.paper, 4, { speed: 3, up: 0.7, life: 0.35, gravity: 9 });
    }
    this.world.audio.gun();
    this.world.shake(0.16);
  }

  private flame(): void {
    const origin = this.muzzle();
    const dir = this.aimDir(0.08);
    this.world.audio.loop("flame", true);
    for (let i = 0; i < 4; i++) {
      const p = origin.clone().addScaledVector(dir, rand(0.2, 1.2));
      this.world.effects.spark(p, pick([COLORS.orange, COLORS.magenta, 0xffb347]), 2, {
        speed: 9,
        spread: 0.18,
        up: 0.16,
        life: 0.5,
        gravity: -2,
        drag: 1.4,
      });
    }
    const nozzle = origin.clone().addScaledVector(dir, 1.25);
    this.world.effects.flameCone(nozzle, dir, 4.2, pick([COLORS.orange, 0xffb347]));
    this.world.effects.flameCone(nozzle.addScaledVector(dir, 0.4), dir, 3.2, COLORS.magenta);
    this.world.effects.tracer(origin, origin.clone().addScaledVector(dir, 3.4), COLORS.orange, 0.08, 0.05);
    this.world.effects.flameBurst(nozzle, dir, 4.6, COLORS.orange);
    const hits = this.clientsInCone(8, 26);
    for (const { client, dir: d } of hits) {
      this.world.damageClient(client, 7.5, client.position.clone().setY(1.2), d, { color: COLORS.orange, silent: true });
      client.applyBurn(26, 2.4);
    }
    this.world.effects.spark(origin.clone().addScaledVector(dir, 2), COLORS.orange, 6, {
      speed: 6, spread: 0.4, up: 0.4, life: 0.4, gravity: -1,
    });
    this.world.shake(0.06);
    this.cd(this.current.cooldown);
  }

  private hose(): void {
    const origin = this.muzzle();
    const dir = this.aimDir(0.09);
    this.world.audio.loop("water", true);
    for (let i = 0; i < 3; i++) {
      const p = origin.clone().addScaledVector(dir, rand(0.3, 1));
      this.world.effects.spark(p, COLORS.cyan, 2, {
        speed: 13, spread: 0.25, up: 0.25, life: 0.45, gravity: 3, drag: 0.8,
      });
    }
    const hits = this.clientsInCone(8.5, 24);
    for (const { client, dir: d } of hits) {
      this.world.damageClient(client, 3.2, client.position.clone().setY(1.2), d, { color: COLORS.cyan, silent: true });
      client.knock.addScaledVector(d, 6.5);
    }
    this.world.shake(0.05);
    this.cd(this.current.cooldown);
  }

  private chainsaw(): void {
    this.world.audio.loop("chainsaw", true);
    const hits = this.clientsInCone(3.0, 48);
    const from = this.muzzle();
    for (const { client, dir } of hits) {
      this.world.damageClient(client, 13, client.position.clone().setY(1.2), dir, { heavy: false, color: COLORS.magenta, silent: true });
      this.world.effects.spark(client.position.clone().setY(1.1), COLORS.magenta, 4, { speed: 4, up: 0.8, life: 0.3 });
    }
    if (hits.length === 0) this.world.effects.spark(from, COLORS.paper, 2, { speed: 2, up: 0.5, life: 0.2 });
    this.world.shake(0.18);
    this.cd(this.current.cooldown);
  }

  private paintball(count: number, spread: number): void {
    const from = this.muzzle();
    const target = this.rayHit(60);
    for (let i = 0; i < count; i++) {
      const color = pick(PAINT_COLORS);
      const dir = target.point.clone().sub(from).normalize();
      dir.x += rand(-spread, spread);
      dir.y += rand(-spread, spread) * 0.5;
      dir.z += rand(-spread, spread);
      dir.normalize();
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshBasicMaterial({ color, toneMapped: false }),
      );
      mesh.position.copy(from);
      const velocity = dir.clone().multiplyScalar(rand(36, 44));
      this.world.projectiles.spawn({
        object: mesh,
        velocity,
        gravity: 11,
        radius: 0.1,
        life: 3,
        color,
        trail: true,
        onHit: (point, normal, client) => {
          if (client) {
            const d = point.clone().sub(this.world.camera.position).setY(0).normalize();
            this.world.damageClient(client, 30, point, d, { color });
            client.showScream(pick(["MY BRAND!!", "THE PALETTE!!", "NOT THE VISION!!"]));
          } else {
            this.world.effects.splat(point, normal, color, 1.3);
            this.world.effects.spark(point, color, 8, { speed: 4, spread: 1, up: 0.8, life: 0.45, gravity: 10 });
          }
          this.world.audio.splat();
        },
      });
    }
    this.world.audio.pop();
    this.world.shake(0.1);
    this.cd(this.current.cooldown);
  }

  private broom(spin: boolean): void {
    this.world.audio.whoosh();
    this.later(0.07, () => {
      const area = spin ? 4.2 : 3.9;
      const angle = spin ? 180 : 78;
      const hits = this.clientsInCone(area, angle);
      for (const { client, dir } of hits) {
        this.world.damageClient(client, spin ? 12 : 20, client.position.clone().setY(1.2), dir, {
          heavy: true,
          color: COLORS.paper,
          big: spin,
        });
        client.knock.addScaledVector(dir, spin ? 16 : 12);
      }
      const origin = this.world.camera.position.clone().setY(0.08);
      this.world.effects.ring(origin, COLORS.paper, area, 0.4, 0.8);
      if (spin) this.world.effects.ring(origin, COLORS.acid, area * 1.3, 0.5, 0.5);
      this.world.shake(spin ? 0.55 : 0.3);
      this.cd(this.current.cooldown);
    });
  }

  private blackhole(): void {
    if (this.field) {
      this.world.hint("A RETENTION WELL IS ALREADY OPEN.");
      this.cd(0.3);
      return;
    }
    const hit = this.rayHit(28);
    const center = hit.point.clone();
    if (hit.client) center.copy(hit.client.position).setY(1.1);
    if (center.y < 1) center.y = 1.1;
    this.field = { center, life: 2.7, tick: 0 };
    this.wellStop = this.world.effects.well(center, COLORS.violet, 2.7);
    this.world.audio.whoosh();
    this.world.audio.zap();
    this.world.shake(0.6);
    this.world.hint("RETENTION WELL OPEN — THEY CANNOT LEAVE.");
    this.cd(this.current.cooldown);
  }

  private updateField(dt: number): void {
    const f = this.field;
    if (!f) return;
    f.life -= dt;
    f.tick -= dt;
    for (const c of this.world.getClients()) {
      if (c.dead) continue;
      const to = f.center.clone().sub(c.position).setY(0);
      const dist = to.length();
      if (dist < 10 && dist > 0.4) {
        const pull = (1 - dist / 10) * 13;
        c.position.addScaledVector(to.normalize(), pull * dt);
        this.world.arena.clampToBounds(c.position, c.radius);
      }
    }
    if (f.tick <= 0) {
      f.tick = 0.16;
      for (const c of this.world.getClients()) {
        if (c.dead) continue;
        if (c.position.distanceTo(f.center) < 5.5) {
          const d = f.center.clone().sub(c.position).setY(0).normalize();
          this.world.damageClient(c, 9, c.position.clone().setY(1.2), d, { color: COLORS.violet, silent: true });
        }
      }
      this.world.effects.spark(f.center, COLORS.violet, 3, { speed: 4, spread: 1, up: 0.5, life: 0.5, gravity: 0, drag: 2 });
    }
    if (f.life <= 0) this.collapseField();
  }

  private collapseField(): void {
    const f = this.field;
    if (!f) return;
    this.field = null;
    this.wellStop?.();
    this.wellStop = null;
    this.explode(f.center, 6.2, 150, COLORS.violet, true);
    this.world.effects.ring(f.center, COLORS.magenta, 9, 0.8);
    this.world.audio.zap();
    this.world.hint("RETENTION LOST.");
  }

  private rocket(count: number, spread: number): void {
    const from = this.muzzle();
    const target = this.rayHit(70);
    const baseDir = target.point.clone().sub(from).normalize();
    for (let i = 0; i < count; i++) {
      const dir = baseDir.clone();
      dir.x += rand(-spread, spread);
      dir.y += rand(-spread, spread) * 0.4;
      dir.z += rand(-spread, spread);
      dir.normalize();
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0x2a2438, metalness: 0.5, roughness: 0.5 }));
      body.rotation.x = Math.PI / 2;
      mesh.add(body);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 8), new THREE.MeshBasicMaterial({ color: COLORS.orange, toneMapped: false }));
      tip.rotation.x = -Math.PI / 2;
      tip.position.z = -0.28;
      mesh.add(tip);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: COLORS.orange, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending }));
      glow.position.z = 0.22;
      mesh.add(glow);
      mesh.position.copy(from);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
      this.world.projectiles.spawn({
        object: mesh,
        velocity: dir.clone().multiplyScalar(30),
        gravity: 1.8,
        radius: 0.22,
        life: 4,
        color: COLORS.orange,
        trail: true,
        onHit: (point) => {
          this.explode(point, 4.8, 125, COLORS.orange, true);
          this.world.effects.splat(point.clone().setY(0.05), new THREE.Vector3(0, 1, 0), 0x2a2438, 3);
        },
      });
    }
    this.world.audio.swing();
    this.world.audio.gun();
    this.world.shake(0.7);
    this.cd(this.current.cooldown);
  }

  private lightning(): void {
    const hit = this.rayHit(40);
    this.strike(hit.point, 100);
    this.cd(this.current.cooldown);
  }

  private strike(point: THREE.Vector3, damage: number): void {
    const from = new THREE.Vector3(point.x, 24, point.z);
    this.world.effects.lightning(from, point, COLORS.cyan);
    const hits = this.world.damageSphere(point, 2.7, damage, { heavy: true, color: COLORS.cyan });
    const chain = this.world
      .getClients()
      .filter((c) => !c.dead && c.position.distanceTo(point) < 7 && c.position.distanceTo(point) > 0.5)
      .sort((a, b) => a.position.distanceTo(point) - b.position.distanceTo(point))[0];
    if (chain) {
      this.later(0.06, () => {
        if (chain.dead) return;
        const p = chain.position.clone().setY(1.2);
        this.world.effects.lightning(p.clone().setY(20), p, COLORS.cyan);
        this.world.damageClient(chain, 55, p, new THREE.Vector3(0, 0, 1), { color: COLORS.cyan, big: true });
      });
    }
    this.world.audio.zap();
    this.world.shake(0.7);
    this.world.hitstop(0.03);
    if (hits === 0) this.world.audio.hit();
  }

  private strikeRandom(): void {
    const clients = this.world.getClients().filter((c) => !c.dead);
    if (clients.length === 0) return;
    const c = pick(clients);
    this.strike(this.spreadPoint(c.position, 1.3).setY(0.3), 85);
  }

  private demolition(count: number, spread: number): void {
    const from = this.muzzle();
    const target = this.rayHit(50);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const stick = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.055, 0.34, 7),
          new THREE.MeshStandardMaterial({ color: 0xb23a2a, roughness: 0.9 }),
        );
        stick.rotation.z = Math.PI / 2;
        stick.position.set(0, (k - 1) * 0.08, 0);
        mesh.add(stick);
      }
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.014, 5, 12), new THREE.MeshStandardMaterial({ color: 0x2a2233 }));
      strap.rotation.y = Math.PI / 2;
      mesh.add(strap);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), new THREE.MeshBasicMaterial({ color: COLORS.red, toneMapped: false }));
      led.position.set(0, 0.16, 0);
      mesh.add(led);
      mesh.position.copy(from);
      const dir = target.point.clone().sub(from).normalize();
      dir.x += rand(-spread, spread);
      dir.z += rand(-spread, spread);
      dir.normalize();
      const p = this.world.projectiles.spawn({
        object: mesh,
        velocity: dir.clone().multiplyScalar(18).add(new THREE.Vector3(0, 4, 0)),
        gravity: 20,
        radius: 0.2,
        life: 1.6,
        color: COLORS.red,
        sticky: true,
        tag: "demo",
        onStick: () => {
          this.world.audio.pop();
        },
        onTick: (proj) => {
          const t = 1.6 - proj.life;
          led.scale.setScalar(1 + Math.sin(t * 30) * 0.4 + (1.6 - proj.life) * 0.5);
        },
        onHit: (point) => {
          this.explode(point, 6.2, 150, COLORS.red, true);
          this.world.effects.ring(point, COLORS.orange, 8, 0.7);
        },
      });
      p.object.position.copy(from);
    }
    this.world.audio.swing();
    this.cd(this.current.cooldown);
  }

  private bugs(count: number): void {
    const hit = this.rayHit(40);
    const center = hit.client ? hit.client.position.clone().setY(1.2) : hit.point.clone().setY(0.5);
    for (let i = 0; i < count; i++) {
      this.spawnSwarm(this.spreadPoint(center, 1.4));
    }
    this.world.audio.whoosh();
    this.world.audio.pop();
    this.cd(this.current.cooldown);
  }

  private spawnSwarm(center: THREE.Vector3): void {
    const count = 26;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = rand(-0.4, 0.4);
      positions[i * 3 + 1] = rand(0.1, 1.6);
      positions[i * 3 + 2] = rand(-0.4, 0.4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: COLORS.acid,
      size: 0.09,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    points.position.copy(center);
    this.world.scene.add(points);
    this.swarms.push({
      points,
      positions,
      center: center.clone(),
      life: 5,
      tick: 0,
      phase: rand(0, TAU),
      damage: 14,
    });
    this.world.effects.spark(center, COLORS.acid, 12, { speed: 3, spread: 1, up: 0.7, life: 0.5, gravity: 2 });
  }

  private updateSwarms(dt: number): void {
    for (let i = this.swarms.length - 1; i >= 0; i--) {
      const s = this.swarms[i]!;
      s.life -= dt;
      s.phase += dt;
      let target: Client | null = null;
      let best = 18;
      for (const c of this.world.getClients()) {
        if (c.dead) continue;
        const dist = c.position.distanceTo(s.center);
        if (dist < best) {
          best = dist;
          target = c;
        }
      }
      if (target) {
        const dir = target.position.clone().setY(1.2).sub(s.center);
        const dist = dir.length();
        if (dist > 0.9) {
          s.center.addScaledVector(dir.normalize(), Math.min(6.5, dist) * dt);
        }
      }
      s.center.y += Math.sin(s.phase * 3) * 0.25 * dt;
      s.center.y = clamp(s.center.y, 0.4, 2.2);
      s.points.position.copy(s.center);
      const attr = s.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let k = 0; k < s.positions.length / 3; k++) {
        attr.setX(k, Math.sin(s.phase * 13 + k * 1.7) * 0.45);
        attr.setY(k, Math.cos(s.phase * 11 + k * 2.1) * 0.55 + Math.sin(s.phase * 5 + k) * 0.15);
        attr.setZ(k, Math.sin(s.phase * 17 + k * 0.8) * 0.45);
      }
      attr.needsUpdate = true;
      s.tick -= dt;
      if (s.tick <= 0) {
        s.tick = 0.2;
        for (const c of this.world.getClients()) {
          if (!c.dead && c.position.distanceTo(s.center) < 1.6) {
            const d = s.center.clone().sub(c.position).setY(0).normalize();
            this.world.damageClient(c, s.damage, c.position.clone().setY(1.2), d, { color: COLORS.acid, silent: true });
            if (Math.random() < 0.2) c.showScream("QA IS CLOSED!!");
          }
        }
      }
      if (Math.random() < 0.15) {
        this.world.effects.spark(s.center, COLORS.acid, 1, { speed: 1.5, spread: 0.5, up: 0.4, life: 0.4, gravity: 1 });
      }
      if (s.life <= 0) {
        this.world.scene.remove(s.points);
        s.points.geometry.dispose();
        (s.points.material as THREE.Material).dispose();
        this.swarms.splice(i, 1);
      }
    }
  }

  private laser(overcharge: boolean): void {
    const from = this.muzzle();
    const hit = this.rayHit(45);
    const width = overcharge ? 0.09 : 0.028;
    this.world.effects.beam(from, hit.point, COLORS.magenta, 0.07, width);
    this.world.audio.loop("laser", true);
    this.world.effects.spark(hit.point, COLORS.magenta, overcharge ? 20 : 3, { speed: 6, up: 0.6, life: 0.35 });
    this.world.effects.ring(hit.point.clone().setY(0.05), COLORS.magenta, 1.2, 0.25, 0.4);
    for (const c of this.world.getClients()) {
      if (c.dead) continue;
      const center = c.position.clone().setY(1.0 * (c.isBoss ? 1.9 : 1));
      const to = center.clone().sub(this.world.camera.position);
      const t = to.dot(this.aimDir());
      if (t < 0.5 || t > hit.distance + 0.5) continue;
      const closest = this.world.camera.position.clone().addScaledVector(this.aimDir(), t);
      const dist = closest.distanceTo(center);
      if (dist < (overcharge ? 2.2 : 1.05)) {
        const d = to.setY(0).normalize();
        this.world.damageClient(c, overcharge ? 120 : 6.5, closest, d, { color: COLORS.magenta, silent: !overcharge, big: overcharge });
        c.applyBurn(6, 1.2);
      }
    }
    if (!overcharge) {
      this.world.shake(0.07);
      this.cd(this.current.cooldown);
    } else {
      this.world.audio.zap();
      this.world.shake(0.8);
      this.world.hitstop(0.04);
      this.cd(1.4);
    }
  }

  private acid(size: number): void {
    const from = this.muzzle();
    const hit = this.rayHit(45);
    const dir = hit.point.clone().sub(from).normalize().add(new THREE.Vector3(0, 0.18, 0)).normalize();
    const rotor = new THREE.Group();
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13 * size, 0.13 * size, 0.28 * size, 12),
      new THREE.MeshStandardMaterial({ color: 0xaaffaa, transparent: true, opacity: 0.45, roughness: 0.1 }),
    );
    glass.rotation.z = Math.PI / 2;
    rotor.add(glass);
    const juice = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115 * size, 0.115 * size, 0.2 * size, 10),
      new THREE.MeshBasicMaterial({ color: COLORS.acid, toneMapped: false }),
    );
    juice.rotation.z = Math.PI / 2;
    rotor.add(juice);
    rotor.position.copy(from);
    rotor.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    this.world.projectiles.spawn({
      object: rotor,
      velocity: dir.multiplyScalar(23),
      gravity: 17,
      radius: 0.2 * size,
      life: 4,
      color: COLORS.acid,
      trail: true,
      onHit: (point, normal, client) => {
        const radius = 3.4 * size;
        const affected = this.world.damageSphere(point, radius, 65 * size, { color: COLORS.acid });
        for (const c of this.world.getClients()) {
          if (!c.dead && c.position.distanceTo(point) < radius) c.applyAcid(28, 4);
        }
        this.world.effects.splat(point, normal, COLORS.acid, 3.2 * size);
        this.world.effects.spark(point, COLORS.acid, 20, { speed: 5, spread: 1, up: 1, life: 0.8, gravity: 6 });
        this.world.effects.ring(point, COLORS.acid, radius * 1.2, 0.5, 0.5);
        this.world.audio.splat();
        this.world.shake(0.35);
        if (affected > 0 && client) client.showScream("CONSTRUCTIVE FEEDBACK!!");
      },
    });
    this.world.audio.swing();
    this.cd(this.current.cooldown);
  }

  private fireball(): void {
    const from = this.muzzle();
    const target = this.rayHit(50);
    const dir = target.point.clone().sub(from).normalize();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshBasicMaterial({ color: COLORS.orange, toneMapped: false }),
    );
    mesh.position.copy(from);
    this.world.projectiles.spawn({
      object: mesh,
      velocity: dir.multiplyScalar(26),
      gravity: 1.5,
      radius: 0.25,
      life: 3,
      color: COLORS.orange,
      trail: true,
      onHit: (point) => {
        const affected = this.world.damageSphere(point, 3.4, 85, { color: COLORS.orange });
        for (const c of this.world.getClients()) {
          if (!c.dead && c.position.distanceTo(point) < 3.4) c.applyBurn(30, 3);
        }
        this.world.effects.explosion(point, COLORS.orange, 3.4);
        this.world.audio.explode();
        this.world.shake(0.7);
        this.world.hitstop(0.03);
        if (affected > 0) this.world.audio.scream(1.1);
      },
    });
    this.world.audio.whoosh();
    this.cd(0.9);
  }

  private pressureBlast(): void {
    this.world.audio.whoosh();
    const hits = this.clientsInCone(7, 40);
    const origin = this.world.camera.position.clone();
    for (const { client, dir } of hits) {
      this.world.damageClient(client, 26, client.position.clone().setY(1.2), dir, { heavy: true, color: COLORS.cyan });
      client.knock.addScaledVector(dir, 24);
      this.world.effects.spark(client.position.clone().setY(1.2), COLORS.cyan, 14, { speed: 6, spread: 1, up: 0.8, life: 0.6 });
    }
    for (let i = 0; i < 30; i++) {
      const dir = this.aimDir(0.18);
      this.world.effects.spark(origin.clone().addScaledVector(dir, 1), COLORS.cyan, 1, {
        speed: 16, spread: 0.2, up: 0.2, life: 0.5, gravity: 0, drag: 1.2,
      });
    }
    this.world.shake(0.6);
    this.cd(0.9);
  }

  private whirl(): void {
    this.world.audio.swing();
    this.world.audio.loop("chainsaw", true);
    const origin = this.world.camera.position.clone();
    for (const c of this.world.getClients()) {
      if (c.dead) continue;
      const dist = c.position.distanceTo(origin);
      if (dist < 4) {
        const dir = c.position.clone().sub(origin).setY(0).normalize();
        this.world.damageClient(c, 65, c.position.clone().setY(1.2), dir, { heavy: true, color: COLORS.magenta, big: true });
        c.knock.addScaledVector(dir, 10);
        this.world.effects.spark(c.position.clone().setY(1.1), COLORS.magenta, 12, { speed: 5, spread: 1, up: 1, life: 0.5 });
      }
    }
    const p = origin.clone().setY(0.08);
    this.world.effects.ring(p, COLORS.magenta, 4.5, 0.5);
    this.world.effects.ring(p, COLORS.paper, 3.4, 0.4);
    this.world.shake(0.9);
    this.world.hitstop(0.05);
    this.cd(1.2);
  }

  private sticky(): void {
    const from = this.muzzle();
    const target = this.rayHit(45);
    const dir = target.point.clone().sub(from).normalize().add(new THREE.Vector3(0, 0.15, 0)).normalize();
    const mesh = new THREE.Group();
    const bomb = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x2a2438, roughness: 0.6, metalness: 0.3 }),
    );
    mesh.add(bomb);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.018, 5, 16), new THREE.MeshBasicMaterial({ color: COLORS.gold, toneMapped: false }));
    ring.rotation.x = Math.PI / 2;
    mesh.add(ring);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshBasicMaterial({ color: COLORS.gold, toneMapped: false }));
    led.position.y = 0.14;
    mesh.add(led);
    mesh.position.copy(from);
    const start = performance.now();
    this.world.projectiles.spawn({
      object: mesh,
      velocity: dir.multiplyScalar(25),
      gravity: 16,
      radius: 0.16,
      life: 25,
      color: COLORS.gold,
      sticky: true,
      tag: "sticky",
      spin: new THREE.Vector3(2, 3, 1),
      onStick: () => {
        this.world.audio.pop();
        this.world.onStickyChange(this.world.projectiles.stickies.length);
        this.world.hint(this.world.projectiles.stickies.length + " ACTION ITEM(S) — [R] TO DETONATE");
      },
      onTick: () => {
        const age = (performance.now() - start) / 1000;
        led.scale.setScalar(1 + Math.sin(age * 12) * 0.5);
        (led.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(age * 12) > 0 ? COLORS.gold : COLORS.paper);
      },
      onHit: (point) => {
        this.explode(point, 3.8, 115, COLORS.gold, true);
        this.world.onStickyChange(this.world.projectiles.stickies.length);
      },
    });
    this.world.audio.swing();
    this.cd(this.current.cooldown);
  }

  reset(): void {
    this.pending.length = 0;
    if (this.field) {
      this.field = null;
      this.wellStop?.();
      this.wellStop = null;
    }
    for (const s of this.swarms) {
      this.world.scene.remove(s.points);
      s.points.geometry.dispose();
      (s.points.material as THREE.Material).dispose();
    }
    this.swarms.length = 0;
    this.world.audio.stopAllLoops();
    this.activeLoop = null;
    this.primaryHeld = false;
    this.secondaryHeld = false;
    this.prevPrimary = false;
    this.prevSecondary = false;
    this.primaryBuffer = 0;
    this.secondaryBuffer = 0;
    this.nextPrimary = 0;
    this.nextSecondary = 0;
    this.world.onStickyChange(0);
    this.active = true;
  }
}
