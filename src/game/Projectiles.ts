import * as THREE from "three";
import type { Arena } from "./Arena";
import type { Client } from "./Client";
import type { Effects } from "./Effects";
import { clamp } from "./utils";

export interface ProjectileSpec {
  object: THREE.Object3D;
  velocity: THREE.Vector3;
  gravity?: number;
  radius?: number;
  life?: number;
  color: number;
  tag?: string;
  trail?: boolean;
  sticky?: boolean;
  spin?: THREE.Vector3;
  onHit: (point: THREE.Vector3, normal: THREE.Vector3, client: Client | null) => void;
  onStick?: (projectile: Projectile) => void;
  onTick?: (projectile: Projectile, dt: number) => void;
}

export class Projectile {
  object: THREE.Object3D;
  velocity: THREE.Vector3;
  gravity: number;
  radius: number;
  life: number;
  color: number;
  tag: string;
  trail: boolean;
  sticky: boolean;
  spin: THREE.Vector3;
  onHit: ProjectileSpec["onHit"];
  onStick?: ProjectileSpec["onStick"];
  onTick?: ProjectileSpec["onTick"];
  dead = false;
  stuck = false;
  attachedTo: Client | null = null;
  readonly offset = new THREE.Vector3();
  trailTimer = 0;

  constructor(spec: ProjectileSpec) {
    this.object = spec.object;
    this.velocity = spec.velocity;
    this.gravity = spec.gravity ?? 0;
    this.radius = spec.radius ?? 0.2;
    this.life = spec.life ?? 5;
    this.color = spec.color;
    this.tag = spec.tag ?? "";
    this.trail = spec.trail ?? false;
    this.sticky = spec.sticky ?? false;
    this.spin = spec.spin ?? new THREE.Vector3();
    this.onHit = spec.onHit;
    this.onStick = spec.onStick;
    this.onTick = spec.onTick;
  }
}

export interface ProjectileHost {
  scene: THREE.Scene;
  effects: Effects;
  arena: Arena;
  getClients: () => Client[];
}

/** Lightweight projectile simulation with sphere collisions against felt clients. */
export class Projectiles {
  private host: ProjectileHost;
  private list: Projectile[] = [];

  constructor(host: ProjectileHost) {
    this.host = host;
  }

  spawn(spec: ProjectileSpec): Projectile {
    const p = new Projectile(spec);
    p.object.position.copy(spec.object.position);
    this.host.scene.add(p.object);
    this.list.push(p);
    return p;
  }

  get active(): readonly Projectile[] {
    return this.list;
  }

  get stickies(): Projectile[] {
    return this.list.filter((p) => p.sticky && p.stuck && !p.dead && p.tag === "sticky");
  }

  detach(p: Projectile): void {
    p.dead = true;
    this.host.scene.remove(p.object);
  }

  update(dt: number): void {
    const { effects, arena } = this.host;
    const clients = this.host.getClients();
    for (const p of this.list) {
      if (p.dead) continue;
      p.life -= dt;
      p.onTick?.(p, dt);

      if (p.stuck) {
        if (p.attachedTo) {
          if (p.attachedTo.dead || p.attachedTo.removed) {
            p.attachedTo = null;
          } else {
            p.object.position.copy(p.attachedTo.position).add(p.offset);
          }
        }
        if (p.life <= 0) {
          p.onHit(p.object.position.clone(), new THREE.Vector3(0, 1, 0), null);
          this.kill(p);
        }
        continue;
      }

      p.velocity.y -= p.gravity * dt;
      p.object.rotation.x += p.spin.x * dt;
      p.object.rotation.y += p.spin.y * dt;
      p.object.rotation.z += p.spin.z * dt;

      // Continuous collision detection: fast paintballs would otherwise tunnel
      // straight through a client between two frames.
      const start = p.object.position.clone();
      const end = start.clone().addScaledVector(p.velocity, dt);
      const segment = end.clone().sub(start);
      const segLen2 = Math.max(0.000001, segment.lengthSq());
      let tHit = Infinity;
      let hitPoint: THREE.Vector3 | null = null;
      let hitNormal = new THREE.Vector3(0, 1, 0);
      let hitClient: Client | null = null;

      for (const c of clients) {
        if (c.dead) continue;
        const scale = c.isBoss ? 1.9 : 1;
        const center = c.position.clone().setY(1.0 * scale);
        const t = clamp(center.clone().sub(start).dot(segment) / segLen2, 0, 1);
        const closest = start.clone().addScaledVector(segment, t);
        const reach = c.radius + p.radius + 0.16;
        if (closest.y > 0.05 && closest.y < 2.05 * scale && closest.distanceTo(center) < reach && t < tHit) {
          tHit = t;
          hitPoint = closest;
          hitClient = c;
          hitNormal = closest.clone().sub(center).setY(0).normalize();
          if (hitNormal.lengthSq() < 0.01) hitNormal.set(0, 0, 1);
        }
      }

      if (start.y > 0.07 && end.y <= 0.07) {
        const t = (0.07 - start.y) / (end.y - start.y);
        if (t >= 0 && t <= 1 && t < tHit) {
          tHit = t;
          hitPoint = start.clone().addScaledVector(segment, t);
          hitNormal.set(0, 1, 0);
          hitClient = null;
        }
      }

      if (hitPoint) {
        p.object.position.copy(hitPoint);
        if (p.sticky) {
          p.stuck = true;
          p.velocity.set(0, 0, 0);
          p.object.position.addScaledVector(hitNormal, 0.08);
          if (hitClient) {
            p.attachedTo = hitClient;
            p.offset.copy(p.object.position).sub(hitClient.position);
          }
          p.onStick?.(p);
          effects.spark(hitPoint, p.color, 6, { speed: 2.5, spread: 1, up: 0.7, life: 0.35 });
        } else {
          p.onHit(hitPoint, hitNormal, hitClient);
          this.kill(p);
        }
        continue;
      }

      p.object.position.copy(end);

      if (p.trail) {
        p.trailTimer -= dt;
        if (p.trailTimer <= 0) {
          p.trailTimer = 0.025;
          effects.spark(p.object.position, p.color, 1, {
            speed: 0.35,
            spread: 0.8,
            up: 0.3,
            life: 0.42,
            gravity: p.gravity > 0 ? 5 : -1,
            drag: 2,
          });
        }
      }

      // crash into the arena wall
      const d = Math.hypot(end.x, end.z);
      if (d > arena.radius - 1) {
        const normal = new THREE.Vector3(-end.x, 0, -end.z).normalize();
        p.onHit(end.clone(), normal, null);
        this.kill(p);
        continue;
      }

      if (p.life <= 0) {
        p.onHit(p.object.position.clone(), new THREE.Vector3(0, 1, 0), null);
        this.kill(p);
      }
    }
    this.list = this.list.filter((p) => !p.dead);
  }

  detonate(p: Projectile): void {
    if (p.dead) return;
    p.stuck = false;
    p.onHit(p.object.position.clone(), new THREE.Vector3(0, 1, 0), null);
    this.kill(p);
  }

  private kill(p: Projectile): void {
    if (p.dead) return;
    p.dead = true;
    this.host.scene.remove(p.object);
    p.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((m) => m.dispose());
    });
  }

  clear(): void {
    for (const p of this.list) this.kill(p);
    this.list.length = 0;
  }
}
