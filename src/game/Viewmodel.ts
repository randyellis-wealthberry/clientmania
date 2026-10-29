import * as THREE from "three";
import { COLORS, clamp, easeOutCubic } from "./utils";
import type { WeaponId } from "./weaponDefs";

type Builder = (group: THREE.Group) => void;

const M = {
  dark: new THREE.MeshStandardMaterial({ color: 0x272036, metalness: 0.5, roughness: 0.5, emissive: 0x0d0a16, emissiveIntensity: 0.8 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xb8bed0, metalness: 0.85, roughness: 0.3, emissive: 0x191b22, emissiveIntensity: 0.5 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd8dbe6, metalness: 1, roughness: 0.15 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x231c33, roughness: 0.95, emissive: 0x0a0712, emissiveIntensity: 0.5 }),
  cuff: new THREE.MeshStandardMaterial({ color: COLORS.acid, emissive: COLORS.acid, emissiveIntensity: 0.25, roughness: 0.7 }),
  wood: new THREE.MeshStandardMaterial({ color: 0xa26a33, roughness: 0.85, emissive: 0x1a0f06, emissiveIntensity: 0.5 }),
  paper: new THREE.MeshStandardMaterial({ color: 0xe2d8c4, roughness: 1 }),
};

function accent(color: number, intensity = 1.8): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    metalness: 0.2,
    roughness: 0.35,
  });
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function cyl(r1: number, r2: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 10): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function sphere(r: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function hand(g: THREE.Group, x: number, y: number, z: number, flip = 1): void {
  const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.09, 4, 8), M.glove);
  palm.position.set(x, y, z);
  palm.rotation.set(0.4, 0, flip * 0.5);
  g.add(palm);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.05, 10), M.cuff);
  cuff.position.set(x + flip * 0.03, y - 0.07, z + 0.06);
  cuff.rotation.set(0.5, 0, flip * 0.5);
  g.add(cuff);
}

const BUILDERS: Record<WeaponId, Builder> = {
  hammer: (g) => {
    const handle = cyl(0.035, 0.045, 0.72, M.wood, 0, 0, -0.05);
    g.add(handle);
    const head = box(0.36, 0.15, 0.18, M.metal, 0, 0.03, -0.46);
    g.add(head);
    g.add(box(0.09, 0.155, 0.19, accent(COLORS.acid), 0, 0.03, -0.46));
    g.add(box(0.1, 0.06, 0.2, M.dark, 0.12, 0.03, -0.46));
    g.add(box(0.1, 0.06, 0.2, M.dark, -0.12, 0.03, -0.46));
    hand(g, 0, -0.08, 0.12);
    hand(g, 0, -0.1, -0.08, -1);
  },
  gun: (g) => {
    g.add(box(0.1, 0.13, 0.32, M.dark, 0, 0.02, -0.1));
    g.add(cyl(0.032, 0.032, 0.26, M.metal, 0, 0.02, -0.34));
    g.add(cyl(0.045, 0.045, 0.05, accent(COLORS.cyan), 0, 0.02, -0.45));
    g.add(box(0.085, 0.17, 0.1, M.dark, 0, -0.11, 0.02).rotateX(-0.25));
    g.add(box(0.02, 0.02, 0.2, accent(COLORS.cyan, 1.2), 0.055, 0.09, -0.1));
    g.add(box(0.04, 0.03, 0.06, M.metal, 0, 0.1, -0.26));
    hand(g, 0, -0.13, 0.02);
    hand(g, 0.01, -0.09, -0.16, -1);
  },
  flame: (g) => {
    g.add(box(0.1, 0.12, 0.25, M.dark, 0, 0, -0.02));
    g.add(cyl(0.09, 0.09, 0.3, M.metal, -0.1, -0.05, 0.02, 12));
    g.add(cyl(0.06, 0.04, 0.5, M.metal, 0.02, 0.03, -0.32));
    g.add(cyl(0.075, 0.05, 0.08, accent(COLORS.orange, 1.2), 0.02, 0.03, -0.58));
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 8), accent(COLORS.orange, 2.4));
    flame.position.set(0.02, 0.03, -0.66);
    flame.rotation.x = -Math.PI / 2;
    flame.name = "pilot";
    g.add(flame);
    g.add(box(0.16, 0.03, 0.03, M.dark, -0.1, 0.08, 0));
    hand(g, 0, -0.11, 0.06);
    hand(g, 0, -0.06, -0.18, -1);
  },
  hose: (g) => {
    g.add(box(0.12, 0.13, 0.24, M.dark, 0, 0, 0));
    g.add(cyl(0.045, 0.055, 0.4, M.metal, 0, 0.01, -0.3));
    g.add(cyl(0.06, 0.045, 0.1, accent(COLORS.cyan, 1.3), 0, 0.01, -0.52));
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.022, 6, 20, Math.PI * 1.6), M.dark);
    coil.position.set(-0.1, -0.1, 0.12);
    coil.rotation.set(1.2, 0.3, 0);
    g.add(coil);
    g.add(box(0.03, 0.03, 0.24, accent(COLORS.cyan, 1.4), 0.065, 0.02, -0.26));
    hand(g, 0, -0.11, 0.02);
    hand(g, 0, -0.07, -0.22, -1);
  },
  chainsaw: (g) => {
    g.add(box(0.17, 0.18, 0.28, M.dark, 0, 0, 0));
    g.add(box(0.05, 0.2, 0.55, M.metal, 0, -0.01, -0.42));
    g.add(box(0.02, 0.05, 0.55, accent(COLORS.magenta, 1.4), 0.02, 0.09, -0.42));
    for (let i = 0; i < 9; i++) {
      const tooth = box(0.035, 0.03, 0.035, M.chrome, 0.03, -0.115, -0.18 - i * 0.055);
      g.add(tooth);
    }
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 16), M.dark);
    loop.position.set(0, 0.12, 0.02);
    loop.rotation.y = Math.PI / 2;
    g.add(loop);
    g.add(box(0.12, 0.04, 0.05, accent(COLORS.magenta), -0.03, 0.1, -0.1));
    hand(g, 0, -0.13, 0.05);
    hand(g, 0, 0.02, -0.08, -1);
  },
  paintball: (g) => {
    g.add(box(0.11, 0.13, 0.34, M.dark, 0, 0, -0.06));
    g.add(cyl(0.03, 0.03, 0.3, M.metal, 0, 0, -0.36));
    g.add(sphere(0.105, accent(COLORS.magenta, 0.5), 0.015, 0.15, 0.02));
    g.add(cyl(0.05, 0.05, 0.15, M.metal, 0.04, -0.1, 0.08));
    g.add(box(0.02, 0.03, 0.22, accent(COLORS.acid, 1.4), -0.06, 0.02, -0.2));
    hand(g, 0, -0.12, 0.06);
    hand(g, 0, -0.06, -0.2, -1);
  },
  broom: (g) => {
    const handle = cyl(0.023, 0.028, 1.05, M.wood, 0, 0, -0.32);
    g.add(handle);
    g.add(box(0.32, 0.1, 0.16, M.dark, 0, -0.02, -0.86));
    for (let i = 0; i < 7; i++) {
      const bristle = box(0.035, 0.15, 0.03, M.paper, -0.13 + i * 0.043, -0.13, -0.9);
      bristle.rotation.x = 0.15;
      g.add(bristle);
    }
    g.add(box(0.34, 0.03, 0.17, accent(COLORS.acid, 0.8), 0, 0.04, -0.86));
    hand(g, 0, -0.05, 0.1);
    hand(g, 0, -0.07, -0.2, -1);
  },
  blackhole: (g) => {
    g.add(box(0.12, 0.16, 0.22, M.dark, 0, 0, 0));
    g.add(cyl(0.045, 0.045, 0.2, M.metal, 0, 0.02, -0.16));
    const core = sphere(0.09, accent(COLORS.violet, 2.6), 0, 0.02, -0.34);
    core.name = "core";
    g.add(core);
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.15 + i * 0.03, 0.012, 5, 24),
        accent(i ? COLORS.magenta : COLORS.violet, 1.6),
      );
      ring.position.set(0, 0.02, -0.34);
      ring.rotation.set(i ? 0.9 : 0.3, i ? 0.4 : 0.9, 0);
      ring.name = "orbit" + i;
      g.add(ring);
    }
    hand(g, 0, -0.11, 0.04);
    hand(g, 0, -0.05, -0.14, -1);
  },
  rocket: (g) => {
    g.add(cyl(0.095, 0.095, 0.72, M.dark, 0, 0, -0.22, 12));
    g.add(cyl(0.105, 0.105, 0.06, accent(COLORS.orange, 1.4), 0, 0, -0.52, 12));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 12), M.metal);
    cone.position.set(0, 0, -0.66);
    cone.rotation.x = -Math.PI / 2;
    g.add(cone);
    g.add(box(0.08, 0.16, 0.1, M.dark, 0, -0.14, 0));
    g.add(box(0.05, 0.06, 0.12, M.metal, 0, 0.13, -0.3));
    g.add(box(0.02, 0.02, 0.16, accent(COLORS.orange, 1.8), 0.12, 0.04, -0.3));
    hand(g, 0, -0.14, 0.06);
    hand(g, 0.02, -0.06, -0.2, -1);
  },
  lightning: (g) => {
    g.add(box(0.12, 0.15, 0.22, M.dark, 0, 0, 0));
    g.add(cyl(0.028, 0.028, 0.42, M.chrome, 0, 0.03, -0.3));
    g.add(sphere(0.085, accent(COLORS.cyan, 2.6), 0, 0.03, -0.54));
    for (let i = 0; i < 3; i++) {
      const prong = box(0.02, 0.02, 0.14, M.chrome, 0, 0.03, -0.62);
      prong.rotation.z = (i - 1) * 0.6;
      g.add(prong);
    }
    for (let i = 0; i < 3; i++) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.05 + i * 0.012, 0.008, 5, 16), accent(COLORS.cyan, 1.1));
      coil.position.set(0, 0.03, -0.18 - i * 0.05);
      g.add(coil);
    }
    hand(g, 0, -0.11, 0.04);
    hand(g, 0, -0.05, -0.16, -1);
  },
  demolition: (g) => {
    g.add(box(0.16, 0.22, 0.1, M.dark, 0, 0, 0));
    g.add(box(0.16, 0.03, 0.1, accent(COLORS.red, 1.2), 0, -0.1, 0));
    const plunger = cyl(0.03, 0.03, 0.18, accent(COLORS.red, 2), 0, 0.2, 0);
    plunger.rotation.x = 0;
    plunger.rotation.z = 0;
    g.add(plunger);
    g.add(box(0.14, 0.03, 0.11, M.metal, 0, 0.29, 0));
    for (let i = 0; i < 3; i++) {
      const stick = cyl(0.045, 0.045, 0.36, new THREE.MeshStandardMaterial({ color: 0xb23a2a, roughness: 0.9 }), 0.12, -0.04, -0.02);
      stick.rotation.x = Math.PI / 2;
      stick.rotation.z = 0.35;
      stick.position.z = -0.02 + i * 0.07;
      g.add(stick);
    }
    g.add(box(0.24, 0.03, 0.03, M.paper, 0.12, 0.02, 0));
    hand(g, 0, -0.13, 0.06);
    hand(g, -0.04, 0.06, 0.02, -1);
  },
  bugs: (g) => {
    const glass = new THREE.MeshStandardMaterial({
      color: 0x9fffb0,
      transparent: true,
      opacity: 0.24,
      roughness: 0.1,
      metalness: 0.1,
    });
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.095, 0.26, 14), glass);
    jar.position.set(0, 0, -0.12);
    jar.rotation.z = 0;
    g.add(jar);
    const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.08, 0.12, 12), accent(COLORS.acid, 0.8));
    liquid.position.set(0, -0.06, -0.12);
    g.add(liquid);
    for (let i = 0; i < 5; i++) {
      const bug = sphere(0.018, M.dark, (Math.random() - 0.5) * 0.12, (Math.random() - 0.3) * 0.16, -0.12 + (Math.random() - 0.5) * 0.12);
      bug.name = "bug";
      g.add(bug);
    }
    g.add(box(0.12, 0.03, 0.12, M.metal, 0, 0.15, -0.12));
    g.add(box(0.05, 0.03, 0.2, M.dark, 0, 0.02, 0.08));
    hand(g, 0, -0.1, 0.08);
    hand(g, 0, -0.02, -0.02, -1);
  },
  laser: (g) => {
    g.add(box(0.12, 0.17, 0.32, M.dark, 0, 0, -0.08));
    g.add(cyl(0.055, 0.04, 0.24, M.metal, 0, 0.01, -0.34));
    g.add(cyl(0.045, 0.045, 0.04, accent(COLORS.magenta, 2.4), 0, 0.01, -0.47));
    for (let i = 0; i < 3; i++) {
      const fin = box(0.01, 0.1, 0.18, M.chrome, -0.075 - i * 0.012, 0.03, -0.04);
      fin.rotation.z = 0.25;
      g.add(fin);
    }
    g.add(box(0.02, 0.02, 0.2, accent(COLORS.magenta, 1.4), 0.065, 0.03, -0.24));
    hand(g, 0, -0.12, 0.04);
    hand(g, 0.01, -0.05, -0.18, -1);
  },
  acid: (g) => {
    const glass = new THREE.MeshStandardMaterial({ color: 0xbaffb0, transparent: true, opacity: 0.3, roughness: 0.12 });
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 14), glass);
    jar.position.set(0, 0.02, -0.16);
    g.add(jar);
    const juice = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.17, 12), accent(COLORS.acid, 1.2));
    juice.position.set(0, 0.0, -0.16);
    g.add(juice);
    const lid = cyl(0.105, 0.105, 0.035, M.metal, 0, 0.15, -0.16);
    g.add(lid);
    g.add(box(0.06, 0.08, 0.05, accent(COLORS.acid, 0.8), 0.1, -0.02, -0.12));
    hand(g, 0, -0.1, 0.02);
    hand(g, 0, -0.01, -0.2, -1);
  },
  sticky: (g) => {
    for (let i = 0; i < 3; i++) {
      const orb = sphere(0.075, M.dark, (i - 1) * 0.09, i * 0.03 - 0.02, -0.16 - i * 0.03);
      orb.add(new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.006, 4, 14), accent(COLORS.gold, 0.9)));
      g.add(orb);
      g.add(box(0.03, 0.02, 0.02, accent(COLORS.gold, 2.2), (i - 1) * 0.09, i * 0.03 + 0.06, -0.16 - i * 0.03));
    }
    g.add(box(0.1, 0.08, 0.1, M.dark, 0, -0.12, 0.02));
    hand(g, 0, -0.12, 0.08);
    hand(g, 0, -0.02, -0.06, -1);
  },
};

export class Viewmodel {
  readonly group = new THREE.Group();
  private models = new Map<WeaponId, THREE.Group>();
  private current: WeaponId = "hammer";
  private swing = 0;
  private swingMax = 0.32;
  private recoil = 0;
  private switchT = 0;
  private time = 0;
  private continuous = false;
  private base = new THREE.Vector3(0.43, -0.15, -0.85);
  private pulse = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.base.set(0.43, -0.15, -0.85);
    this.group.position.copy(this.base);
    camera.add(this.group);
    for (const id of Object.keys(BUILDERS) as WeaponId[]) {
      const model = new THREE.Group();
      BUILDERS[id](model);
      model.visible = false;
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.frustumCulled = false;
          mesh.renderOrder = 2;
        }
      });
      this.group.add(model);
      this.models.set(id, model);
    }
    this.select("hammer", true);
  }

  select(id: WeaponId, instant = false): void {
    if (id === this.current && !instant) return;
    const old = this.models.get(this.current);
    if (old) old.visible = false;
    this.current = id;
    const model = this.models.get(id);
    if (model) model.visible = true;
    this.swing = 0;
    this.recoil = 0;
    this.switchT = instant ? 0 : 0.24;
  }

  trigger(kind: "primary" | "secondary"): void {
    if (kind === "secondary") {
      this.swingMax = 0.5;
      this.swing = 0.5;
      this.recoil = 0.9;
    } else {
      const melee = this.current === "hammer" || this.current === "broom" || this.current === "chainsaw";
      this.swingMax = melee ? 0.34 : 0.18;
      this.swing = this.swingMax;
      this.recoil = melee ? 0.8 : 0.42;
      this.pulse = 1;
    }
  }

  setContinuous(on: boolean): void {
    if (this.continuous !== on) {
      this.continuous = on;
      this.pulse = on ? 1 : 0;
    }
  }

  update(dt: number, speed: number, swayX: number, swayY: number): void {
    this.time += dt;
    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt);
    this.recoil *= Math.exp(-10 * dt);
    this.switchT = Math.max(0, this.switchT - dt);
    this.pulse = Math.max(0, this.pulse - dt * 2.5);

    const walk = clamp(speed / 6, 0, 1);
    const bobY = Math.sin(this.time * 9) * 0.012 * walk + Math.sin(this.time * 1.8) * 0.004;
    const bobX = Math.cos(this.time * 4.5) * 0.01 * walk;
    const switchOffset = easeOutCubic(this.switchT / 0.24) * 0.55;

    const swingP = this.swing > 0 ? 1 - this.swing / this.swingMax : 0;
    const swingAmount = Math.sin(swingP * Math.PI);
    const isMelee = this.current === "hammer" || this.current === "broom" || this.current === "chainsaw";
    const shake = this.continuous
      ? Math.sin(this.time * 45) * 0.004 + Math.sin(this.time * 61) * 0.003
      : 0;

    this.group.position.set(
      this.base.x + swayX * 0.035 + bobX + shake,
      this.base.y + swayY * 0.03 + bobY - switchOffset + shake,
      this.base.z + this.recoil * 0.09 - (isMelee ? swingAmount * 0.16 : 0) + Math.max(0, this.recoil) * 0.02,
    );
    this.group.rotation.set(
      -this.recoil * 0.22 - (isMelee ? swingAmount * 1.15 : swingAmount * 0.25),
      swayX * 0.25 + (isMelee ? swingAmount * 0.35 : 0),
      swayX * 0.3 + (isMelee ? -swingAmount * 0.8 : 0) + this.recoil * 0.1,
    );
    this.group.scale.setScalar(0.85 + this.pulse * 0.02);

    const model = this.models.get(this.current);
    if (model) {
      // per-weapon idle flourish
      if (this.current === "blackhole") {
        const core = model.getObjectByName("core");
        if (core) core.scale.setScalar(1 + Math.sin(this.time * 6) * 0.12 + this.pulse * 0.3);
        const o0 = model.getObjectByName("orbit0");
        const o1 = model.getObjectByName("orbit1");
        if (o0) o0.rotation.z += dt * 2.2;
        if (o1) o1.rotation.y += dt * 2.8;
      } else if (this.current === "chainsaw") {
        model.position.z = this.continuous ? Math.sin(this.time * 80) * 0.006 : 0;
      } else if (this.current === "flame") {
        const pilot = model.getObjectByName("pilot") as THREE.Mesh | undefined;
        if (pilot) pilot.scale.setScalar(0.8 + Math.sin(this.time * 22) * 0.15 + (this.continuous ? 0.5 : 0));
      } else if (this.current === "bugs") {
        for (const child of model.children) {
          if (child.name === "bug") {
            child.position.x += Math.sin(this.time * 7 + child.id) * dt * 0.02;
            child.position.y = Math.cos(this.time * 5 + child.id) * 0.04;
          }
        }
      } else if (this.current === "sticky") {
        model.children.forEach((c, i) => {
          if (i < 3) c.rotation.y += dt * 0.4;
        });
      }
    }

  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  get currentId(): WeaponId {
    return this.current;
  }
}
