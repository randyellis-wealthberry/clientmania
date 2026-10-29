import * as THREE from "three";
import { COLORS, TAU, canvasTexture, clamp, easeOutBack, makeCanvas, pick, rand, randInt } from "./utils";
import { COMPANIES, PROJECTS, SCREAMS } from "./names";
import type { Effects } from "./Effects";
import type { SynthAudio } from "./Audio";
import type { Arena } from "./Arena";

export interface ClientContext {
  effects: Effects;
  audio: SynthAudio;
  arena: Arena;
  camera: THREE.PerspectiveCamera;
  onAttack: (client: Client, kind: "slap" | "paper") => void;
  onScream: (client: Client) => boolean;
  onDeath: (client: Client) => void;
}

const G = {
  torso: new THREE.CapsuleGeometry(0.3, 0.46, 5, 12),
  head: new THREE.SphereGeometry(0.27, 18, 14),
  eye: new THREE.CylinderGeometry(0.062, 0.062, 0.028, 12),
  stitch: new THREE.BoxGeometry(0.012, 0.034, 0.008),
  mouth: new THREE.TorusGeometry(0.075, 0.011, 5, 14, Math.PI),
  arm: new THREE.CapsuleGeometry(0.068, 0.4, 4, 8),
  hand: new THREE.SphereGeometry(0.085, 10, 8),
  leg: new THREE.CapsuleGeometry(0.082, 0.42, 4, 8),
  foot: new THREE.BoxGeometry(0.17, 0.09, 0.26),
  pin: new THREE.CylinderGeometry(0.011, 0.011, 1, 5),
  pinHead: new THREE.SphereGeometry(0.05, 8, 6),
  tag: new THREE.PlaneGeometry(0.38, 0.16),
  barBack: new THREE.PlaneGeometry(0.72, 0.075),
  barFill: new THREE.PlaneGeometry(0.7, 0.045),
  dream: new THREE.OctahedronGeometry(0.075, 0),
  note: new THREE.PlaneGeometry(0.14, 0.14),
};

const pinShaftMat = new THREE.MeshStandardMaterial({ color: 0xc9cbd4, metalness: 0.9, roughness: 0.3 });
const pinHeadMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });

const tagCache = new Map<string, THREE.Texture>();
function tagTexture(name: string, project: string): THREE.Texture {
  const key = name + project;
  const hit = tagCache.get(key);
  if (hit) return hit;
  if (tagCache.size > 80) {
    const oldest = tagCache.keys().next().value;
    if (oldest) tagCache.delete(oldest);
  }
  const ctx = makeCanvas(384, 160);
  ctx.fillStyle = "#f4efe4";
  ctx.fillRect(0, 0, 384, 160);
  ctx.strokeStyle = "#0a0812";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 376, 152);
  ctx.fillStyle = "#0a0812";
  ctx.font = "400 26px Anton, Impact, sans-serif";
  ctx.fillText(name.slice(0, 24), 18, 46);
  ctx.fillStyle = "#ff2e88";
  ctx.font = "700 14px 'Space Mono', monospace";
  ctx.fillText("CLIENT", 18, 72);
  ctx.fillStyle = "#4a4458";
  ctx.font = "700 13px 'Space Mono', monospace";
  const line = project.length > 34 ? project.slice(0, 33) + "…" : project;
  ctx.fillText(line, 18, 100);
  ctx.fillStyle = "#0a0812";
  ctx.fillRect(18, 116, 348, 22);
  ctx.fillStyle = "#d7ff3e";
  ctx.font = "700 13px 'Space Mono', monospace";
  ctx.fillText("PLEASE APPROVE", 26, 132);
  const tex = canvasTexture(ctx);
  tagCache.set(key, tex);
  return tex;
}

const screamCache = new Map<string, THREE.Texture>();
function screamTexture(text: string): THREE.Texture {
  const hit = screamCache.get(text);
  if (hit) return hit;
  const ctx = makeCanvas(640, 180);
  ctx.clearRect(0, 0, 640, 180);
  const pad = 10;
  ctx.fillStyle = "rgba(244,239,228,0.97)";
  ctx.beginPath();
  ctx.roundRect(pad, pad, 620, 118, 18);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(280, 126);
  ctx.lineTo(320, 172);
  ctx.lineTo(356, 126);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#0a0812";
  ctx.lineWidth = 7;
  ctx.strokeRect(pad, pad, 620, 118);
  ctx.fillStyle = "#0a0812";
  ctx.font = "400 40px Anton, Impact, sans-serif";
  const size = ctx.measureText(text).width > 580 ? 30 : 40;
  ctx.font = `400 ${size}px Anton, Impact, sans-serif`;
  const w = ctx.measureText(text).width;
  ctx.fillText(text, (640 - w) / 2, 88);
  const tex = canvasTexture(ctx);
  screamCache.set(text, tex);
  return tex;
}

const FABRICS = [0xd8b98a, 0xc9a06a, 0xb9c1d6, 0xd9a3a3, 0xc7c98a, 0xa8b6a0, 0xd6c3d9];

export class Client {
  readonly id: number;
  readonly isBoss: boolean;
  readonly name: string;
  readonly company: string;
  readonly project: string;
  readonly group = new THREE.Group();
  readonly radius: number;
  maxHp: number;
  hp: number;
  speed: number;
  dead = false;
  removed = false;
  state: "active" | "dying" = "active";
  knock = new THREE.Vector3();
  private baseScale: number;
  private time = rand(0, 10);
  private spawnT = 0;
  private hitFlash = 0;
  private squash = 0;
  private attackTimer = rand(0.6, 1.6);
  private throwTimer = rand(2.5, 6);
  private screamTimer = rand(7, 16);
  private burnTime = 0;
  private burnDps = 0;
  private burnTick = 0;
  private acidTime = 0;
  private acidDps = 0;
  private acidTick = 0;
  private deathT = 0;
  private vy = 0;
  private spin = new THREE.Vector3();
  private healthBar: THREE.Group;
  private healthFill: THREE.Mesh;
  private healthFillMat: THREE.MeshBasicMaterial;
  private dream: THREE.Mesh;
  private dreamGlow: THREE.Sprite;
  private bubble: THREE.Sprite;
  private bubbleMat: THREE.SpriteMaterial;
  private bubbleT = 0;
  private bubbleScale = 1;
  private bodyMats: THREE.MeshStandardMaterial[] = [];
  private pins: THREE.Vector3[] = [];
  private pinMeshes: THREE.InstancedMesh[] = [];
  private detached: { obj: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3 }[] = [];
  private arms: THREE.Group[] = [];
  private legs: THREE.Group[] = [];
  private head: THREE.Object3D;
  private dreamPos = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    id: number,
    boss: boolean,
    level: number,
    private ctx: ClientContext,
  ) {
    this.id = id;
    this.isBoss = boss;
    this.baseScale = (boss ? 1.95 : rand(0.9, 1.08)) * (1 + Math.min(level, 12) * 0.005);
    this.name = boss ? pick(["THE STAKEHOLDER", "THE DECISION MAKER", "VP OF FINAL SAY"]) : pick([
      "CHAD FROM PROCUREMENT", "KAREN, VP OF VIBES", "BRAD, STAKEHOLDER", "YOUR OLD BOSS",
      "THE ART DIRECTOR'S COUSIN", "THE GROWTH LEAD", "FOUNDER (SERIAL)", "AUNTIE WITH THE LOGO IDEA",
      "DUDE WITH A QUICK NOTE", "THE PROCUREMENT COMMITTEE",
    ]);
    this.company = pick(COMPANIES);
    this.project = pick(PROJECTS);
    this.maxHp = (boss ? 900 : 120) * (1 + level * 0.28) * (boss ? 1 : rand(0.85, 1.2));
    this.hp = this.maxHp;
    this.speed = (boss ? 0.85 : rand(0.9, 1.55)) * (1 + Math.min(level, 20) * 0.025);
    this.radius = boss ? 1.2 : 0.42;

    this.group.scale.setScalar(0.01);
    this.group.rotation.y = rand(0, TAU);

    const fabric = new THREE.Color(boss ? 0x8a2a3a : pick(FABRICS));
    const bodyMat = new THREE.MeshStandardMaterial({ color: fabric, roughness: 1, flatShading: false });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2233, roughness: 0.9 });
    const stitchMat = new THREE.MeshStandardMaterial({ color: boss ? COLORS.gold : 0xf4efe4, roughness: 1 });
    this.bodyMats.push(bodyMat);

    const torso = new THREE.Mesh(G.torso, bodyMat);
    torso.position.y = 1.0;
    torso.castShadow = true;
    this.group.add(torso);

    const head = new THREE.Group();
    const skull = new THREE.Mesh(G.head, bodyMat);
    skull.castShadow = true;
    head.add(skull);
    head.position.y = 1.58;
    this.head = head;
    this.group.add(head);

    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(G.eye, darkMat);
      eye.rotation.x = Math.PI / 2;
      eye.position.set(sx * 0.09, 0.035, 0.245);
      head.add(eye);
      const crossA = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.012, 0.01), stitchMat);
      crossA.position.set(sx * 0.09, 0.035, 0.262);
      head.add(crossA);
      const crossB = crossA.clone();
      crossB.rotation.z = Math.PI / 2;
      head.add(crossB);
    }
    const mouth = new THREE.Mesh(G.mouth, darkMat);
    mouth.position.set(0, -0.08, 0.245);
    mouth.rotation.x = Math.PI;
    head.add(mouth);
    for (let i = 0; i < 4; i++) {
      const st = new THREE.Mesh(G.stitch, stitchMat);
      st.position.set(-0.055 + i * 0.037, -0.075, 0.252);
      head.add(st);
    }

    for (const sx of [-1, 1]) {
      const armPivot = new THREE.Group();
      armPivot.position.set(sx * 0.31, 1.22, 0);
      const arm = new THREE.Mesh(G.arm, bodyMat);
      arm.position.y = -0.23;
      arm.castShadow = true;
      armPivot.add(arm);
      const hand = new THREE.Mesh(G.hand, bodyMat);
      hand.position.y = -0.48;
      armPivot.add(hand);
      armPivot.rotation.z = sx * 0.18;
      this.group.add(armPivot);
      this.arms.push(armPivot);

      const legPivot = new THREE.Group();
      legPivot.position.set(sx * 0.15, 0.68, 0);
      const leg = new THREE.Mesh(G.leg, bodyMat);
      leg.position.y = -0.26;
      leg.castShadow = true;
      legPivot.add(leg);
      const foot = new THREE.Mesh(G.foot, darkMat);
      foot.position.set(0, -0.53, 0.06);
      legPivot.add(foot);
      this.group.add(legPivot);
      this.legs.push(legPivot);
    }

    // voodoo pins — instanced so a dozen pins cost two draw calls, not twenty-four
    const pinCount = boss ? 12 : randInt(5, 8);
    const shaftMesh = new THREE.InstancedMesh(G.pin, pinShaftMat, pinCount);
    const headMesh = new THREE.InstancedMesh(G.pinHead, pinHeadMat, pinCount);
    const dummy = new THREE.Object3D();
    const pinColor = new THREE.Color();
    for (let i = 0; i < pinCount; i++) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-0.7, 0.8), rand(-1, 1)).normalize();
      const len = rand(0.16, 0.3);
      const base = dir.clone().multiplyScalar(0.3);
      base.y += rand(0.92, 1.58);
      dummy.position.copy(base);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      dummy.scale.set(1, len, 1);
      dummy.updateMatrix();
      shaftMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.copy(base).addScaledVector(dir, len * 0.55);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      headMesh.setMatrixAt(i, dummy.matrix);
      pinColor.setHex(pick([COLORS.magenta, COLORS.acid, COLORS.cyan, COLORS.orange, 0xff3b30]));
      headMesh.setColorAt(i, pinColor);
      this.pins.push(dummy.position.clone());
    }
    shaftMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
    if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;
    this.group.add(shaftMesh, headMesh);
    this.pinMeshes.push(shaftMesh, headMesh);

    // accessory roulette — ties, glasses, party hats
    const accessory = Math.random();
    if (accessory < 0.42) {
      const tieMat = new THREE.MeshStandardMaterial({ color: boss ? 0x2a0a12 : pick([0x1b1728, 0x3a1520, 0x162a35]), roughness: 0.75 });
      const tie = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.3, 0.02), tieMat);
      tie.position.set(0, 0.86, 0.305);
      tie.rotation.z = rand(-0.15, 0.15);
      this.group.add(tie);
      const knot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.03), tieMat);
      knot.position.set(0, 1.03, 0.31);
      this.group.add(knot);
    } else if (accessory < 0.62) {
      const lensMat = new THREE.MeshBasicMaterial({ color: boss ? COLORS.gold : pick([COLORS.acid, COLORS.cyan, 0xffb347]), toneMapped: false });
      for (const sx of [-1, 1]) {
        const lens = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.009, 5, 16), lensMat);
        lens.position.set(sx * 0.1, 0.035, 0.26);
        head.add(lens);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.01, 0.01), lensMat);
      bridge.position.set(0, 0.035, 0.27);
      head.add(bridge);
    } else if (accessory < 0.78) {
      const hat = new THREE.Mesh(
        new THREE.ConeGeometry(0.11, 0.26, 12),
        new THREE.MeshBasicMaterial({ color: boss ? COLORS.gold : pick([COLORS.magenta, COLORS.acid, COLORS.cyan, COLORS.violet]), toneMapped: false }),
      );
      hat.position.set(rand(-0.05, 0.05), 0.35, 0);
      hat.rotation.z = rand(-0.18, 0.18);
      head.add(hat);
    }

    // name tag
    const tagMat = new THREE.MeshBasicMaterial({ map: tagTexture(this.name, this.project), side: THREE.DoubleSide, toneMapped: false });
    const tag = new THREE.Mesh(G.tag, tagMat);
    tag.position.set(0.02, 1.08, 0.315);
    tag.rotation.z = -0.05;
    this.group.add(tag);

    // the dream
    const dreamMat = new THREE.MeshBasicMaterial({ color: boss ? COLORS.gold : COLORS.magenta, toneMapped: false });
    this.dream = new THREE.Mesh(G.dream, dreamMat);
    this.dream.position.y = 2.12;
    this.group.add(this.dream);
    this.dreamGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlow(),
        color: boss ? COLORS.gold : COLORS.magenta,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.dreamGlow.scale.setScalar(1.1);
    this.dreamGlow.position.y = 2.12;
    this.group.add(this.dreamGlow);

    // boss crown
    if (boss) {
      const crown = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const note = new THREE.Mesh(
          G.note,
          new THREE.MeshStandardMaterial({ color: i % 2 ? 0xf2e6a8 : COLORS.gold, roughness: 0.9, side: THREE.DoubleSide }),
        );
        note.position.set(Math.cos(a) * 0.24, Math.sin(a * 2) * 0.04, Math.sin(a) * 0.24);
        note.rotation.set(rand(-0.4, 0.4), -a, rand(-0.3, 0.3));
        crown.add(note);
      }
      crown.position.y = 1.82;
      this.group.add(crown);
    }

    // health bar
    this.healthBar = new THREE.Group();
    this.healthBar.position.y = 2.36;
    const backMat = new THREE.MeshBasicMaterial({ color: 0x08060c, transparent: true, opacity: 0.82, depthWrite: false });
    const back = new THREE.Mesh(G.barBack, backMat);
    this.healthBar.add(back);
    this.healthFillMat = new THREE.MeshBasicMaterial({ color: COLORS.magenta, depthWrite: false });
    this.healthFill = new THREE.Mesh(G.barFill, this.healthFillMat);
    this.healthFill.position.z = 0.002;
    this.healthBar.add(this.healthFill);
    this.healthBar.scale.setScalar(boss ? 2.6 : 1);
    this.group.add(this.healthBar);

    // scream bubble
    this.bubbleMat = new THREE.SpriteMaterial({
      map: screamTexture(SCREAMS[0]!),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
    });
    this.bubble = new THREE.Sprite(this.bubbleMat);
    this.bubble.position.y = 2.62;
    this.bubble.scale.set(2.45, 0.69, 1);
    this.bubble.visible = false;
    this.bubble.renderOrder = 10;
    this.group.add(this.bubble);

    this.group.scale.setScalar(this.baseScale * 0.01);
    scene.add(this.group);
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  spawnAt(point: THREE.Vector3): void {
    this.group.position.copy(point).setY(0);
    this.spawnT = 0;
  }

  setDreamVisible(v: boolean): void {
    this.dream.visible = v;
    this.dreamGlow.visible = v;
  }

  showScream(text?: string, big = false): void {
    const phrase = text ?? pick(SCREAMS);
    this.bubbleMat.map = screamTexture(phrase);
    this.bubbleMat.needsUpdate = true;
    this.bubble.visible = true;
    this.bubbleT = 1.6;
    this.bubbleScale = big ? 1.35 : 1;
    this.bubble.position.y = 2.85;
  }

  takeDamage(
    amount: number,
    point: THREE.Vector3,
    knockDir: THREE.Vector3,
    opts: { heavy?: boolean; silent?: boolean; color?: number; big?: boolean } = {},
  ): number {
    if (this.dead) return 0;
    const dealt = Math.min(amount, this.hp);
    this.hp -= amount;
    this.hitFlash = 1;
    this.squash = 1;
    this.ctx.effects.damageNumber(point, String(Math.round(amount)), opts.color ?? COLORS.paper, opts.big || amount >= 80);
    this.ctx.effects.spark(point, COLORS.paper, opts.heavy ? 8 : 4, { speed: 3, spread: 0.9, up: 0.6, life: 0.4 });
    this.knock.addScaledVector(knockDir, opts.heavy ? 7.5 : 1.8);
    if (!opts.silent) this.ctx.audio.hit();
    if (this.hp <= 0) this.die(knockDir, opts.heavy ?? false);
    return dealt;
  }

  applyBurn(dps: number, seconds: number): void {
    this.burnDps = Math.max(this.burnDps, dps);
    this.burnTime = Math.max(this.burnTime, seconds);
  }

  applyAcid(dps: number, seconds: number): void {
    this.acidDps = Math.max(this.acidDps, dps);
    this.acidTime = Math.max(this.acidTime, seconds);
  }

  private die(dir: THREE.Vector3, heavy: boolean): void {
    if (this.dead) return;
    this.dead = true;
    this.state = "dying";
    this.deathT = 0;
    this.bubble.visible = false;
    this.ctx.audio.scream(rand(0.85, 1.25));
    this.ctx.audio.squish();
    const p = this.group.position.clone().setY(this.group.position.y + 1.1 * this.baseScale);
    this.ctx.effects.confetti(p, this.isBoss ? 60 : 24);
    this.ctx.effects.spark(this.dreamWorld(), this.isBoss ? COLORS.gold : COLORS.magenta, this.isBoss ? 40 : 16, {
      speed: 5,
      spread: 1,
      up: 1,
      life: 1,
      gravity: 2,
    });
    this.dream.visible = false;
    this.dreamGlow.visible = false;
    this.healthBar.visible = false;
    this.ctx.onDeath(this);
    this.vy = heavy ? rand(4, 7) : rand(2, 4.5);
    this.knock.addScaledVector(dir, heavy ? 5 : 2.5);
    this.spin.set(rand(-3, 3), rand(-4, 4), rand(-3, 3));

    // tear off a couple of limbs for comedy
    if (!this.isBoss) {
      const donors = [...this.arms, ...this.legs];
      const count = Math.random() < 0.35 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const pivot = donors[randInt(0, donors.length - 1)]!;
        if (!pivot.parent) continue;
        const world = new THREE.Vector3();
        pivot.getWorldPosition(world);
        pivot.parent.remove(pivot);
        this.group.parent?.add(pivot);
        pivot.position.copy(world);
        pivot.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
        this.detached.push({
          obj: pivot,
          vel: new THREE.Vector3(rand(-3, 3), rand(2, 6), rand(-3, 3)),
          spin: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)),
        });
      }
    }

    // pins fly
    for (const pin of this.pins) {
      const world = this.group.localToWorld(pin.clone());
      this.ctx.effects.spark(world, COLORS.paper, 1, { speed: 3, spread: 1, up: 1, life: 0.4 });
    }
    for (const mesh of this.pinMeshes) mesh.visible = false;
    this.ctx.effects.spark(p, COLORS.paper, 14, { speed: 4, spread: 1, up: 1, life: 0.7, gravity: 5 });
  }

  dreamWorld(): THREE.Vector3 {
    this.dream.getWorldPosition(this.dreamPos);
    return this.dreamPos.clone();
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    if (this.removed) return;
    this.time += dt;
    this.spawnT += dt;
    const spawn = clamp(this.spawnT / 0.55, 0, 1);
    const scaleTarget = this.baseScale * (this.dead ? 1 : easeOutBack(spawn));
    if (!this.dead) this.group.scale.setScalar(scaleTarget);

    // hit flash & squash
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    for (const m of this.bodyMats) {
      m.emissive.setRGB(this.hitFlash * 0.9, this.hitFlash * 0.85, this.hitFlash * 0.75);
      if (this.burnTime > 0) m.emissive.setRGB(0.42 + Math.sin(this.time * 30) * 0.16, 0.1, 0.0);
    }
    this.squash = Math.max(0, this.squash - dt * 7);
    const sq = 1 + this.squash * 0.12;
    this.group.scale.y = scaleTarget / sq;
    this.group.scale.x = this.group.scale.z = scaleTarget * sq;

    if (this.state === "dying") {
      this.updateDeath(dt);
      return;
    }

    // status effects
    if (this.burnTime > 0) {
      this.burnTime -= dt;
      this.burnTick -= dt;
      if (this.burnTick <= 0) {
        this.burnTick = 0.18;
        this.hp -= this.burnDps * 0.18;
        this.ctx.effects.spark(this.group.position.clone().setY(rand(0.5, 1.7) * this.baseScale), COLORS.orange, 2, {
          speed: 1.6, spread: 0.7, up: 1, life: 0.5, gravity: -1,
        });
        if (this.hp <= 0) this.die(new THREE.Vector3(0, 0, 1), false);
      }
    }
    if (this.acidTime > 0) {
      this.acidTime -= dt;
      this.acidTick -= dt;
      if (this.acidTick <= 0) {
        this.acidTick = 0.22;
        this.hp -= this.acidDps * 0.22;
        this.ctx.effects.spark(this.group.position.clone().setY(rand(0.4, 1.6) * this.baseScale), COLORS.acid, 2, {
          speed: 1.2, spread: 0.6, up: 0.8, life: 0.6, gravity: 1,
        });
        if (this.hp <= 0) this.die(new THREE.Vector3(0, 0, 1), false);
      }
    }

    // movement
    const toPlayer = new THREE.Vector3(playerPos.x - this.group.position.x, 0, playerPos.z - this.group.position.z);
    const dist = toPlayer.length();
    toPlayer.normalize();
    const stop = 1.7 + this.radius;
    if (dist > stop && this.spawnT > 0.35) {
      const strafe = Math.sin(this.time * 0.7 + this.id) * 0.28;
      const dir = toPlayer.clone().add(new THREE.Vector3(-toPlayer.z * strafe, 0, toPlayer.x * strafe)).normalize();
      this.group.position.addScaledVector(dir, this.speed * dt);
      this.group.rotation.y = Math.atan2(dir.x, dir.z);
    } else {
      this.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
    }
    if (this.knock.lengthSq() > 0.0001) {
      this.group.position.addScaledVector(this.knock, dt);
      this.knock.multiplyScalar(Math.max(0, 1 - 6 * dt));
      if (this.knock.lengthSq() < 0.01) this.knock.set(0, 0, 0);
    }
    this.ctx.arena.clampToBounds(this.group.position, this.radius);

    // hop & sway
    const moving = dist > stop;
    const bob = moving ? Math.abs(Math.sin(this.time * 8)) * 0.06 : Math.sin(this.time * 2) * 0.02;
    this.group.position.y = bob;
    this.head.rotation.z = Math.sin(this.time * 2.4 + this.id) * 0.09;
    this.head.rotation.x = Math.sin(this.time * 1.7 + this.id) * 0.05;
    this.arms[0]!.rotation.x = moving ? Math.sin(this.time * 8 + this.id) * 0.7 : Math.sin(this.time * 1.6) * 0.15;
    this.arms[1]!.rotation.x = moving ? Math.sin(this.time * 8 + this.id + Math.PI) * 0.7 : -Math.sin(this.time * 1.6) * 0.15;
    this.arms[0]!.rotation.z = -0.18 - Math.abs(Math.sin(this.time * 2)) * 0.12;
    this.arms[1]!.rotation.z = 0.18 + Math.abs(Math.sin(this.time * 2 + 1)) * 0.12;
    this.legs[0]!.rotation.x = moving ? Math.sin(this.time * 8 + this.id) * 0.6 : 0;
    this.legs[1]!.rotation.x = moving ? Math.sin(this.time * 8 + this.id + Math.PI) * 0.6 : 0;

    // dream idle
    this.dream.position.y = 2.12 + Math.sin(this.time * 2.2 + this.id) * 0.08;
    this.dream.rotation.y += dt * 1.4;
    this.dream.rotation.x += dt * 0.6;
    this.dreamGlow.position.y = this.dream.position.y;
    const pulse = 0.62 + Math.sin(this.time * 4) * 0.16;
    (this.dreamGlow.material as THREE.SpriteMaterial).opacity = pulse * (this.burnTime > 0 ? 0.6 : 1);

    // health bar
    const ratio = clamp(this.hp / this.maxHp, 0, 1);
    this.healthFill.scale.x = Math.max(0.001, ratio);
    this.healthFill.position.x = -0.35 * (1 - ratio);
    this.healthFillMat.color.setHex(ratio > 0.55 ? COLORS.acid : ratio > 0.25 ? COLORS.orange : COLORS.magenta);
    const inv = this.group.quaternion.clone().invert();
    this.healthBar.quaternion.copy(inv.multiply(this.ctx.camera.quaternion));
    this.healthBar.visible = ratio < 0.999 || dist < 9;

    // attacks
    this.attackTimer -= dt;
    this.throwTimer -= dt;
    this.screamTimer -= dt;
    if (dist < 2.6 && this.attackTimer <= 0 && this.spawnT > 0.8) {
      this.attackTimer = rand(1.3, 2.1);
      this.ctx.onAttack(this, "slap");
    } else if (dist > 4.5 && dist < 18 && this.throwTimer <= 0 && this.spawnT > 1.2) {
      this.throwTimer = rand(3.4, 6.5);
      this.ctx.onAttack(this, "paper");
    }
    if (this.screamTimer <= 0) {
      this.screamTimer = rand(8, 17);
      if (dist < 13 && Math.random() < 0.4 && this.ctx.onScream(this)) this.showScream();
    }

    // scream bubble
    if (this.bubbleT > 0) {
      this.bubbleT -= dt;
      const t = clamp(this.bubbleT / 1.6, 0, 1);
      this.bubble.position.y = 2.62 + (1 - t) * 0.3;
      this.bubbleMat.opacity = t > 0.8 ? (1 - t) * 5 : t;
      this.bubble.scale.set(2.45 * this.bubbleScale, 0.69 * this.bubbleScale, 1);
        if (this.bubbleT <= 0) this.bubble.visible = false;
    }
  }

  private updateDeath(dt: number): void {
    this.deathT += dt;
    this.vy -= 18 * dt;
    this.group.position.x += this.knock.x * dt;
    this.group.position.z += this.knock.z * dt;
    this.group.position.y += this.vy * dt;
    this.group.rotation.x += this.spin.x * dt;
    this.group.rotation.y += this.spin.y * dt;
    this.group.rotation.z += this.spin.z * dt;
    this.knock.multiplyScalar(Math.max(0, 1 - 3 * dt));
    if (this.group.position.y < 0) {
      this.group.position.y = 0;
      this.vy = Math.abs(this.vy) * 0.32;
      this.spin.multiplyScalar(0.7);
      if (this.vy > 0.8) {
        this.ctx.effects.ring(this.group.position, COLORS.paper, 1.2, 0.3, 0.6);
        this.ctx.audio.squish();
      }
    }
    this.ctx.arena.clampToBounds(this.group.position, 1);

    for (const d of this.detached) {
      d.vel.y -= 16 * dt;
      d.obj.position.addScaledVector(d.vel, dt);
      d.obj.rotation.x += d.spin.x * dt;
      d.obj.rotation.y += d.spin.y * dt;
      d.obj.rotation.z += d.spin.z * dt;
      if (d.obj.position.y < 0.1) {
        d.obj.position.y = 0.1;
        d.vel.y = Math.abs(d.vel.y) * 0.3;
        d.vel.x *= 0.75;
        d.vel.z *= 0.75;
        d.spin.multiplyScalar(0.8);
      }
    }

    if (this.deathT > 1.5) {
      const fade = clamp(1 - (this.deathT - 1.5) / 0.45, 0, 1);
      this.group.scale.setScalar(this.baseScale * fade);
      for (const d of this.detached) d.obj.scale.setScalar(fade);
    }
    if (this.deathT > 1.95) {
      this.removed = true;
      this.group.parent?.remove(this.group);
      for (const d of this.detached) d.obj.parent?.remove(d.obj);
    }
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    for (const d of this.detached) d.obj.parent?.remove(d.obj);
    this.group.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (mat) {
        (Array.isArray(mat) ? mat : [mat]).forEach((m) => {
          if (m !== pinShaftMat && m !== pinHeadMat) m.dispose();
        });
      }
    });
    for (const d of this.detached) {
      d.obj.traverse((o) => {
        const mat = (o as THREE.Mesh).material;
        if (mat) {
          (Array.isArray(mat) ? mat : [mat]).forEach((m) => {
            if (m !== pinShaftMat && m !== pinHeadMat) m.dispose();
          });
        }
      });
    }
    this.detached.length = 0;
  }
}

let glowTex: THREE.Texture | null = null;
function makeGlow(): THREE.Texture {
  if (glowTex) return glowTex;
  const ctx = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.4)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTex = canvasTexture(ctx);
  return glowTex;
}

