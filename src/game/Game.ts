import * as THREE from "three";
import { Arena } from "./Arena";
import { Client } from "./Client";
import type { ClientContext } from "./Client";
import { Effects } from "./Effects";
import { SynthAudio } from "./Audio";
import { Input } from "./Input";
import { HUD } from "./HUD";
import { Post } from "./Post";
import { Projectiles } from "./Projectiles";
import { Viewmodel } from "./Viewmodel";
import { WeaponSystem } from "./Weapons";
import type { WeaponWorld } from "./Weapons";
import { COLORS, clamp, damp, pick, rand } from "./utils";
import { BOSS_NAMES, DEATH_QUIPS, KILL_QUIPS, WAVE_TITLES } from "./names";
import { WEAPONS, type WeaponId } from "./weaponDefs";

type GameState = "menu" | "playing" | "pause" | "over";

interface Paper {
  group: THREE.Group;
  vel: THREE.Vector3;
  life: number;
  spin: THREE.Vector3;
}

export class Game implements WeaponWorld {
  readonly camera: THREE.PerspectiveCamera;
  readonly scene = new THREE.Scene();
  readonly effects: Effects;
  readonly audio = new SynthAudio();
  readonly arena: Arena;
  readonly projectiles: Projectiles;
  readonly viewmodel: Viewmodel;
  readonly weapons: WeaponSystem;

  private renderer: THREE.WebGLRenderer;
  private post: Post;
  private lowQuality = new URLSearchParams(window.location.search).get("quality") === "low";
  private forceFull = new URLSearchParams(window.location.search).get("quality") === "full";
  private fpsFrames = 0;
  private fpsTime = 0;
  private autoQualityTried = false;
  private input: Input;
  private hud: HUD;
  private clockLast = performance.now();
  private time = 0;
  private rawTime = 0;
  private state: GameState = "menu";
  private overT = 0;
  private deathDelay = 0;

  private player = {
    pos: new THREE.Vector3(0, 0, 0),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: -0.05,
    jumpY: 0,
    vy: 0,
    hp: 100,
    maxHp: 100,
    lastDamage: -99,
    dashCd: 0,
    invuln: 0,
  };
  private sway = new THREE.Vector2();
  private shakeAmt = 0;
  private hitstopTime = 0;
  private damageGlow = 0;
  private rage = 0;
  private rageOn = false;
  private rageTimer = 0;
  private combo = 0;
  private comboTimer = 0;
  private bestCombo = 1;
  private score = 0;
  private best = 0;
  private kills = 0;
  private runTime = 0;
  private lastHitmarker = 0;
  private lastScream = 0;
  private stickyCount = 0;

  private clients: Client[] = [];
  private papers: Paper[] = [];
  private nextId = 1;
  private wave = 0;
  private wavePhase: "idle" | "break" | "spawning" | "active" = "idle";
  private breakTimer = 0;
  private spawnQueue = 0;
  private spawnTimer = 0;
  private bossPending = false;
  private waveTitle: string = WAVE_TITLES[0]!;
  private menuAngle = 0;
  private menuClients: Client[] = [];
  private paperGeo: THREE.BufferGeometry;
  private paperMat: THREE.MeshStandardMaterial;

  constructor(canvas: HTMLCanvasElement, hud: HUD) {
    this.hud = hud;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
    this.camera.rotation.order = "YXZ";
    this.camera.position.set(0, 1.68, 0);
    this.scene.add(this.camera);

    this.arena = new Arena(this.scene);
    this.effects = new Effects(this.scene, this.camera, document.getElementById("vfx-layer")!);
    this.effects.dust(this.lowQuality ? 45 : 130);
    this.projectiles = new Projectiles({
      scene: this.scene,
      effects: this.effects,
      arena: this.arena,
      getClients: () => this.clients,
    });
    this.viewmodel = new Viewmodel(this.camera);
    this.weapons = new WeaponSystem(this, this.viewmodel);
    this.post = new Post(this.renderer, this.scene, this.camera);

    // Software renderers and very constrained devices get the fast path automatically.
    try {
      const gl = this.renderer.getContext();
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
      if (!this.forceFull && (/swiftshader|llvmpipe|software|basic render/i.test(name) || (navigator.hardwareConcurrency ?? 8) <= 4)) {
        this.lowQuality = true;
      }
    } catch {
      /* ignore */
    }
    if (this.lowQuality) this.applyQuality(true);

    const fill = new THREE.PointLight(0xffe9c4, 1.4, 4.5, 2);
    fill.position.set(0.45, 0.25, 0.35);
    this.camera.add(fill);
    const rim = new THREE.PointLight(COLORS.cyan, 0.8, 3.2, 2);
    rim.position.set(-0.4, -0.1, 0.4);
    this.camera.add(rim);

    this.input = new Input(canvas, (locked) => {
      if (!locked && this.state === "playing") this.pause();
    });
    canvas.addEventListener("click", () => {
      if (this.state === "playing") this.input.requestLock();
    });

    this.audio.setMuted(this.audio.muted);
    this.hud.setMuted(this.audio.muted);
    try {
      this.best = Number(localStorage.getItem("clientmania.best") ?? "0") || 0;
    } catch {
      this.best = 0;
    }
    this.hud.setBest(this.best);

    this.paperMat = new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 1, side: THREE.DoubleSide });
    this.paperGeo = makePaperGeo();

    this.bindUI();
    window.addEventListener("resize", () => this.resize());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state === "playing") this.pause();
    });

    this.hud.setWeapon(WEAPONS[0]!);
    this.setupMenu();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ weapon world

  getClients = (): Client[] => this.clients;

  damageClient = (
    client: Client,
    amount: number,
    point: THREE.Vector3,
    dir: THREE.Vector3,
    opts: { heavy?: boolean; color?: number; big?: boolean; silent?: boolean } = {},
  ): number => {
    if (this.state !== "playing" || client.dead) return 0;
    const mult = this.rageOn ? 1.8 : 1;
    const dealt = client.takeDamage(amount * mult, point, dir, opts);
    if (dealt > 0) {
      this.rage = Math.min(100, this.rage + dealt * 0.042);
      this.combo = Math.min(999, this.combo + 1);
      this.comboTimer = 2.6;
      this.score += Math.round(dealt * this.multiplier());
      const now = this.time;
      if (now - this.lastHitmarker > 0.055) {
        this.lastHitmarker = now;
        this.hud.hit(client.dead);
      }
    }
    return dealt;
  };

  damageSphere = (center: THREE.Vector3, radius: number, amount: number, opts: { heavy?: boolean; color?: number } = {}): number => {
    let hits = 0;
    for (const c of this.clients) {
      if (c.dead) continue;
      const dist = c.position.distanceTo(center);
      if (dist > radius + c.radius) continue;
      const fall = clamp(1 - (dist / radius) * 0.6, 0.2, 1);
      const dir = c.position.clone().sub(center).setY(0).normalize();
      const p = c.position.clone().setY(rand(0.7, 1.6));
      if (this.damageClient(c, amount * fall, p, dir, { heavy: opts.heavy, color: opts.color ?? COLORS.orange, big: true }) > 0) hits++;
    }
    return hits;
  };

  shake = (amount: number): void => {
    this.shakeAmt = Math.min(2.4, this.shakeAmt + amount);
  };

  hitstop = (seconds: number): void => {
    this.hitstopTime = Math.max(this.hitstopTime, seconds);
  };

  hint = (text: string): void => {
    this.hud.toast(text, 2.4);
  };

  onStickyChange = (count: number): void => {
    this.stickyCount = count;
  };

  rageActive = (): boolean => this.rageOn;

  // ----------------------------------------------------------------------- setup

  private bindUI(): void {
    this.hud.onStart(() => this.startRun());
    this.hud.onResume(() => this.resume());
    this.hud.onRestart(() => this.startRun());
    this.hud.onMute(() => {
      this.audio.unlock();
      const muted = this.audio.toggleMute();
      this.hud.setMuted(muted);
    });
    this.hud.onCachePick((id) => {
      const index = WEAPONS.findIndex((w) => w.id === id);
      if (index < 0) return;
      if (this.state === "menu") this.startRun(id);
      else if (this.state === "playing") {
        this.weapons.select(index);
        this.hud.setWeapon(this.weapons.current);
        this.input.requestLock();
      } else if (this.state === "pause") {
        this.weapons.select(index);
        this.hud.setWeapon(this.weapons.current);
      }
    });
  }

  private setupMenu(): void {
    this.state = "menu";
    this.viewmodel.setVisible(false);
    this.hud.showScreen("menu");
    this.spawnMenuEffigies();
    this.camera.position.set(0, 5.4, 15);
    this.camera.lookAt(0, 1.2, 0);
  }

  private spawnMenuEffigies(): void {
    for (const c of this.menuClients) c.dispose();
    this.menuClients = [];
    const angles = [-0.55, 0.05, 0.72, 1.45];
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i]!;
      const client = new Client(this.scene, 900 + i, false, 3, this.clientContext());
      client.spawnAt(new THREE.Vector3(Math.cos(a) * 5.4, 0, Math.sin(a) * 5.4));
      client.speed = 0;
      this.menuClients.push(client);
    }
  }

  private clientContext(): ClientContext {
    return {
      effects: this.effects,
      audio: this.audio,
      arena: this.arena,
      camera: this.camera,
      onAttack: (client, kind) => this.clientAttack(client, kind),
      onScream: () => {
        if (this.time - this.lastScream < 0.55) return false;
        this.lastScream = this.time;
        this.audio.scream(rand(0.85, 1.25));
        return true;
      },
      onDeath: (client) => this.onClientDeath(client),
    };
  }

  // ------------------------------------------------------------------ run control

  startRun(startWeapon?: WeaponId): void {
    window.clearTimeout(this.deathDelay);
    this.audio.unlock();
    this.audio.startMusic();
    this.clearClients();
    for (const c of this.menuClients) c.dispose();
    this.menuClients = [];
    this.projectiles.clear();
    this.effects.clear();
    this.effects.dust(110);
    for (const p of this.papers) {
      this.scene.remove(p.group);
    }
    this.papers.length = 0;
    this.weapons.reset();
    this.viewmodel.setVisible(true);

    this.player.pos.set(0, 0, 0);
    this.player.vel.set(0, 0, 0);
    this.player.yaw = 0;
    this.player.pitch = -0.04;
    this.player.jumpY = 0;
    this.player.vy = 0;
    this.player.hp = this.player.maxHp;
    this.player.lastDamage = -99;
    this.player.dashCd = 0;
    this.player.invuln = 0;
    this.sway.set(0, 0);
    this.shakeAmt = 0;
    this.damageGlow = 0;
    this.hitstopTime = 0;
    this.combo = 0;
    this.bestCombo = 1;
    this.comboTimer = 0;
    this.score = 0;
    this.kills = 0;
    this.rage = 0;
    this.rageOn = false;
    this.rageTimer = 0;
    this.stickyCount = 0;
    this.runTime = 0;
    this.overT = 0;
    this.deathDelay = 0;
    this.wave = 0;
    this.wavePhase = "break";
    this.breakTimer = 1.1;
    this.spawnQueue = 0;
    this.bossPending = false;
    this.waveTitle = WAVE_TITLES[0]!;
    this.state = "playing";
    this.camera.rotation.z = 0;

    if (startWeapon) {
      const index = WEAPONS.findIndex((w) => w.id === startWeapon);
      if (index >= 0) this.weapons.select(index);
    }
    this.weapons.setActive(true);
    this.hud.setWeapon(this.weapons.current);
    this.hud.resetRun();
    this.hud.showScreen("playing");
    this.hud.setRage(false);
    this.hud.banner("THE PITCH ROOM", "SHIFT 01", "DO NOT NEGOTIATE. DO NOT CIRCLE BACK.");
    this.input.requestLock();
    this.input.clear();
  }

  private pause(): void {
    if (this.state !== "playing") return;
    this.state = "pause";
    this.weapons.setActive(false);
    this.audio.stopMusic();
    this.input.exitLock();
    this.input.clear();
    this.hud.showScreen("pause");
  }

  private resume(): void {
    if (this.state !== "pause") return;
    this.state = "playing";
    this.weapons.setActive(true);
    this.audio.startMusic();
    this.hud.showScreen("playing");
    this.input.clear();
    this.input.requestLock();
  }

  private endRun(): void {
    if (this.state === "over") return;
    this.state = "over";
    this.overT = 0;
    this.weapons.setActive(false);
    this.audio.stopMusic();
    this.audio.death();
    this.hud.setRage(false);
    this.input.exitLock();
    this.input.clear();
    const newBest = this.score > this.best;
    if (newBest) {
      this.best = this.score;
      try {
        localStorage.setItem("clientmania.best", String(this.best));
      } catch {
        /* ignore */
      }
      this.hud.setBest(this.best);
    }
    this.deathDelay = window.setTimeout(() => {
      this.hud.showGameOver({
        score: this.score,
        best: this.best,
        wave: this.wave,
        kills: this.kills,
        bestCombo: this.bestCombo,
        time: this.runTime,
        quip: pick(DEATH_QUIPS),
        newBest,
      });
    }, 1500);
  }

  private clearClients(): void {
    for (const c of this.clients) c.dispose();
    this.clients.length = 0;
  }

  // -------------------------------------------------------------------- waves

  private updateWaves(dt: number): void {
    if (this.wavePhase === "break") {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) this.startWave();
      return;
    }
    if (this.wavePhase === "spawning") {
      if (this.spawnQueue > 0) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0 && this.clients.length < 26) {
          this.spawnTimer = Math.max(0.22, 0.62 - this.wave * 0.015);
          this.spawnClient(false);
          this.spawnQueue--;
        }
      } else if (!this.bossPending) {
        this.wavePhase = "active";
      }
    }
    if (this.wavePhase === "active" || this.wavePhase === "spawning") {
      if (this.bossPending && this.spawnQueue === 0) {
        this.bossPending = false;
        this.spawnClient(true);
      }
      if (this.clients.length === 0 && this.spawnQueue === 0 && !this.bossPending) {
        this.completeWave();
      }
    }
  }

  private startWave(): void {
    this.wave++;
    this.waveTitle = pick(WAVE_TITLES);
    const boss = this.wave % 5 === 0;
    this.spawnQueue = Math.min(24, 3 + this.wave * 2) + (boss ? 2 : 0);
    this.bossPending = boss;
    this.spawnTimer = 0.35;
    this.wavePhase = "spawning";
    this.audio.wave();
    this.hud.banner(
      `WAVE ${String(this.wave).padStart(2, "0")}${boss ? " · BOSS" : ""}`,
      this.waveTitle,
      boss ? "THE STAKEHOLDER HAS JOINED THE CALL" : `${this.spawnQueue} CLIENTS INBOUND`,
    );
    if (boss) {
      this.hud.toast("BOSS: " + BOSS_NAMES[this.wave % BOSS_NAMES.length], 3);
    }
  }

  private completeWave(): void {
    this.wavePhase = "break";
    this.breakTimer = 3.4;
    const bonus = 250 * this.wave;
    this.score += bonus;
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 18);
    this.hud.banner("WAVE CLEARED", `+${bonus.toLocaleString("en-US")}`, "COMPOSURE PARTIALLY RESTORED");
    this.hud.toast(`WAVE ${this.wave} CLEARED — TAKE A BREATH. THEY'LL BE BACK.`, 2.6);
    this.audio.wave();
    this.effects.confetti(this.player.pos.clone().setY(2.4), 34);
    this.effects.ring(this.player.pos.clone().setY(0.06), COLORS.acid, 6, 0.6);
  }

  private spawnClient(boss: boolean): void {
    const point = this.arena.randomSpawnPoint(15, 27);
    const client = new Client(this.scene, this.nextId++, boss, this.wave, this.clientContext());
    client.spawnAt(point);
    this.clients.push(client);
    this.effects.ring(point, boss ? COLORS.gold : COLORS.magenta, boss ? 4 : 1.6, 0.55, 0.7);
    this.effects.spark(point.clone().setY(0.6), boss ? COLORS.gold : COLORS.magenta, boss ? 26 : 8, {
      speed: 4,
      spread: 1,
      up: 1.2,
      life: 0.7,
      gravity: 4,
    });
    if (boss) {
      this.audio.rage();
      this.shake(0.8);
    } else if (Math.random() < 0.3) {
      this.audio.scream(rand(0.85, 1.2));
    }
  }

  private onClientDeath(client: Client): void {
    this.kills++;
    this.rage = Math.min(100, this.rage + (client.isBoss ? 30 : 3.5));
    const gained = Math.round((client.isBoss ? 2500 : 140) * this.multiplier());
    this.score += gained;
    this.hud.killFeed(client.name, pick(KILL_QUIPS), client.isBoss);
    this.hud.hit(true);
    this.effects.confetti(client.position.clone().setY(1.4), client.isBoss ? 80 : 12);
    if (client.isBoss) {
      this.hud.banner("STAKEHOLDER ESCORTED OUT", "THE CALL IS OVER", "+2,500 · COMPOSURE RESTORED");
      this.effects.explosion(client.position.clone().setY(1.6), COLORS.gold, 6.5);
      this.effects.ring(client.position.clone().setY(0.06), COLORS.gold, 10, 0.9);
      for (const c of this.clients) {
        if (c !== client && !c.dead && c.position.distanceTo(client.position) < 7) {
          const d = c.position.clone().sub(client.position).setY(0).normalize();
          this.damageClient(c, 130, c.position.clone().setY(1.2), d, { heavy: true, color: COLORS.gold, big: true });
        }
      }
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 30);
      this.audio.explode();
      this.audio.rage();
      this.shake(2);
      this.hitstop(0.09);
    } else {
      this.audio.squish();
    }
    this.onStickyChange(this.projectiles.stickies.length);
  }

  // -------------------------------------------------------------------- combat

  private clientAttack(client: Client, kind: "slap" | "paper"): void {
    if (this.state !== "playing" || client.dead) return;
    const dist = client.position.distanceTo(this.player.pos);
    if (kind === "slap") {
      if (dist < 3.4) this.hurtPlayer(client.isBoss ? 22 : 8, client.position);
      client.showScream(pick(["DO IT FOR EXPOSURE!!", "QUICK CALL?!", "I'M THE CLIENT!!", "ONE MORE REVISION!!"]));
      if (client.isBoss) {
        const p = client.position.clone().setY(0.07);
        this.effects.ring(p, COLORS.gold, 4.5, 0.5);
        this.shake(0.9);
      }
    } else {
      const count = client.isBoss ? 3 : 1;
      for (let i = 0; i < count; i++) this.spawnPaper(client);
      this.audio.whoosh();
    }
  }

  private spawnPaper(client: Client): void {
    const group = new THREE.Group();
    const wing = new THREE.Mesh(this.paperGeo, this.paperMat);
    group.add(wing);
    const start = client.position.clone().setY(client.isBoss ? 3 : 1.4);
    group.position.copy(start);
    const target = this.player.pos.clone().setY(1.0).addScaledVector(this.player.vel, 0.18);
    const dir = target.clone().sub(start).normalize();
    dir.x += rand(-0.03, 0.03);
    dir.z += rand(-0.03, 0.03);
    dir.y += 0.1;
    dir.normalize();
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    this.scene.add(group);
    this.papers.push({
      group,
      vel: dir.multiplyScalar(client.isBoss ? 23 : 17),
      life: 3.5,
      spin: new THREE.Vector3(rand(-8, 8), rand(-4, 4), rand(-8, 8)),
    });
  }

  private updatePapers(dt: number): void {
    for (let i = this.papers.length - 1; i >= 0; i--) {
      const p = this.papers[i]!;
      p.life -= dt;
      p.vel.y -= 3.2 * dt;
      p.group.position.addScaledVector(p.vel, dt);
      p.group.rotation.x += p.spin.x * dt;
      p.group.rotation.y += p.spin.y * dt;
      p.group.rotation.z += p.spin.z * dt;
      const chest = this.player.pos.clone().setY(this.player.jumpY + 1.0);
      const hit = p.group.position.distanceTo(chest) < 0.72;
      if (hit && this.state === "playing") {
        this.hurtPlayer(7, p.group.position);
        this.effects.spark(chest, COLORS.paper, 7, { speed: 3, up: 0.6, life: 0.4 });
        this.scene.remove(p.group);
        this.papers.splice(i, 1);
        continue;
      }
      if (p.life <= 0 || p.group.position.y < 0 || p.group.position.length() > 34) {
        this.scene.remove(p.group);
        this.papers.splice(i, 1);
      }
    }
  }

  private hurtPlayer(amount: number, from: THREE.Vector3): void {
    if (this.state !== "playing" || this.time < this.player.invuln) return;
    this.player.invuln = this.time + 0.32;
    this.player.hp -= amount;
    this.player.lastDamage = this.time;
    this.damageGlow = Math.min(1, this.damageGlow + 0.7);
    this.hud.damage(amount);
    this.audio.hurt();
    this.shake(0.55);
    this.combo = 0;
    this.comboTimer = 0;
    const away = this.player.pos.clone().sub(from).setY(0).normalize();
    this.player.vel.addScaledVector(away, 2.2);
    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.endRun();
    }
  }

  private multiplier(): number {
    return 1 + Math.min(this.combo, 50) * 0.1;
  }

  private activateRage(): void {
    if (this.rageOn || this.rage < 100) {
      if (this.rage < 100) this.hud.toast("RAGE LAYER NOT READY.", 1.4);
      return;
    }
    this.rageOn = true;
    this.rageTimer = 9;
    this.rage = 100;
    this.audio.rage();
    this.hud.setRage(true);
    this.hud.banner("RAGE LAYER", "NO MORE MR. NICE DELIVERABLE", "DAMAGE ×1.8 · COOLDOWNS ×0.62");
    this.effects.ring(this.player.pos.clone().setY(0.06), COLORS.magenta, 9, 0.9);
    this.hud.toast("RAGE LAYER ACTIVE — CRUSH THE ROADMAP.", 3);
    this.shake(1.4);
  }

  // -------------------------------------------------------------------- player

  private updatePlayer(dt: number): void {
    const p = this.player;
    p.dashCd = Math.max(0, p.dashCd - dt);
    const wish = new THREE.Vector3();
    if (this.input.down("KeyW")) wish.z -= 1;
    if (this.input.down("KeyS")) wish.z += 1;
    if (this.input.down("KeyA")) wish.x -= 1;
    if (this.input.down("KeyD")) wish.x += 1;
    const moving = wish.lengthSq() > 0;
    if (moving) wish.normalize();
    const forward = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const target = forward.multiplyScalar(-wish.z).addScaledVector(right, wish.x);
    const speed = 5.6;
    const accel = moving ? 42 : 14;
    p.vel.x = damp(p.vel.x, target.x * speed, moving ? 9 : 12, dt);
    p.vel.z = damp(p.vel.z, target.z * speed, moving ? 9 : 12, dt);
    p.vel.x += target.x * accel * dt * 0.02;
    p.vel.z += target.z * accel * dt * 0.02;

    if (this.input.pressed("ShiftLeft") || this.input.pressed("ShiftRight")) {
      if (p.dashCd <= 0) {
        p.dashCd = 1.4;
        p.vel.addScaledVector(forward, 13);
        this.audio.whoosh();
        this.shake(0.25);
        this.effects.ring(p.pos.clone().setY(0.06), COLORS.acid, 2.2, 0.35, 0.6);
      }
    }

    p.pos.addScaledVector(p.vel, dt);
    this.arena.clampToBounds(p.pos, 0.7);

    if ((this.input.pressed("Space") || this.input.pressed("KeyZ")) && p.jumpY <= 0) {
      p.vy = 5.2;
      this.audio.whoosh();
    }
    if (p.vy !== 0 || p.jumpY > 0) {
      p.vy -= 17 * dt;
      p.jumpY += p.vy * dt;
      if (p.jumpY <= 0) {
        p.jumpY = 0;
        p.vy = 0;
      }
    }

    const planar = Math.hypot(p.vel.x, p.vel.z);
    const bob = Math.sin(this.time * 10) * 0.032 * clamp(planar / 5.6, 0, 1);
    this.camera.position.set(p.pos.x, 1.68 + p.jumpY + bob, p.pos.z);
    this.camera.rotation.set(p.pitch, p.yaw, 0);

    this.sway.x = damp(this.sway.x, clamp(-this.input.mouseDX * 0.004, -0.6, 0.6), 10, dt);
    this.sway.y = damp(this.sway.y, clamp(this.input.mouseDY * 0.004, -0.5, 0.5), 10, dt);

    if (p.hp < p.maxHp && this.time - p.lastDamage > 6) {
      p.hp = Math.min(p.maxHp, p.hp + 4.5 * dt);
    }
    p.invuln = Math.max(p.invuln, 0);
  }

  private updateClients(dt: number): void {
    for (const c of this.clients) {
      c.update(dt, this.player.pos);
    }
    // separation so the queue doesn't merge into one super-client
    for (let i = 0; i < this.clients.length; i++) {
      const a = this.clients[i]!;
      if (a.dead) continue;
      for (let j = i + 1; j < this.clients.length; j++) {
        const b = this.clients[j]!;
        if (b.dead) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const min = a.radius + b.radius + 0.16;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.0001 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.5;
          const nx = dx / d;
          const nz = dz / d;
          a.position.x -= nx * push;
          a.position.z -= nz * push;
          b.position.x += nx * push;
          b.position.z += nz * push;
        }
      }
    }
    const before = this.clients.length;
    this.clients = this.clients.filter((c) => {
      if (c.removed) {
        c.dispose();
        return false;
      }
      return true;
    });
    if (this.clients.length !== before) this.onStickyChange(this.projectiles.stickies.length);
  }

  private updateRage(dt: number): void {
    if (this.rageOn) {
      this.rageTimer -= dt;
      this.rage = clamp((this.rageTimer / 9) * 100, 0, 100);
      if (this.rageTimer <= 0) {
        this.rageOn = false;
        this.rage = 0;
        this.hud.setRage(false);
        this.hud.toast("RAGE LAYER OFFLINE. THE FEEDBACK RESUMES.", 3);
      }
    }
  }

  private updateCombo(dt: number): void {
    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 0;
        this.comboTimer = 0;
      }
    }
    this.bestCombo = Math.max(this.bestCombo, this.multiplier());
  }

  private handleKeys(): void {
    if (this.state === "playing") {
      for (let i = 1; i <= 9; i++) {
        if (this.input.pressed(`Digit${i}`)) {
          this.weapons.select(i - 1);
          this.hud.setWeapon(this.weapons.current);
        }
      }
      if (this.input.pressed("KeyQ") || this.input.wheel < 0) {
        this.weapons.selectDelta(-1);
        this.hud.setWeapon(this.weapons.current);
      }
      if (this.input.pressed("KeyE") || this.input.wheel > 0) {
        this.weapons.selectDelta(1);
        this.hud.setWeapon(this.weapons.current);
      }
      if (this.input.pressed("KeyR")) this.weapons.detonateStickies();
      if (this.input.pressed("KeyF")) this.activateRage();
      if (this.input.pressed("KeyL")) {
        this.autoQualityTried = true;
        this.applyQuality(!this.lowQuality);
        this.hud.toast(this.lowQuality ? "QUALITY: POTATO (STILL FUN)" : "QUALITY: FULL BLOOM", 2);
      }
      if (this.input.pressed("Escape") || this.input.pressed("KeyP")) this.pause();
    } else if (this.state === "pause") {
      if (this.input.pressed("Escape") || this.input.pressed("KeyP")) this.resume();
    }
    if (this.input.pressed("KeyM")) {
      this.audio.unlock();
      const muted = this.audio.toggleMute();
      this.hud.setMuted(muted);
      if (!muted) this.hud.toast("SOUND ON", 1.2);
    }
  }

  private updateCameraShake(dt: number): void {
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 3.2);
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt;
      this.camera.rotation.x += rand(-s, s) * 0.012;
      this.camera.rotation.y += rand(-s, s) * 0.012;
      this.camera.rotation.z += rand(-s, s) * 0.02;
      this.camera.position.x += rand(-s, s) * 0.04;
      this.camera.position.y += rand(-s, s) * 0.04;
    }
  }

  // ---------------------------------------------------------------------- loop

  private loop(nowMs: number): void {
    requestAnimationFrame(this.loop);
    const real = Math.max(0.0001, (nowMs - this.clockLast) / 1000);
    const raw = Math.min(0.05, real);
    this.clockLast = nowMs;
    this.rawTime += raw;

    if (this.state === "playing" && !this.lowQuality && !this.forceFull && !this.autoQualityTried && this.rawTime > 5) {
      this.fpsFrames++;
      this.fpsTime += real;
      if (this.fpsTime > 2) {
        const fps = this.fpsFrames / this.fpsTime;
        this.fpsFrames = 0;
        this.fpsTime = 0;
        if (fps < 34) {
          this.autoQualityTried = true;
          this.applyQuality(true);
          this.hud.toast("FRAME RATE LOW — PERFORMANCE MODE ON. PRESS [L] TO TOGGLE.", 4);
        }
      }
    }

    if (this.hitstopTime > 0) {
      this.hitstopTime = Math.max(0, this.hitstopTime - raw);
      this.update(raw * 0.16);
    } else {
      this.update(raw);
    }
    this.input.endFrame();
  }

  private update(rawDt: number): void {
    const dt = rawDt;
    this.time += dt;

    if (this.state === "menu") {
      this.updateMenu(dt);
    } else if (this.state === "playing") {
      this.runTime += dt;
      this.handleKeys();
      const look = 0.0022;
      this.player.yaw -= this.input.mouseDX * look;
      this.player.pitch = clamp(this.player.pitch - this.input.mouseDY * look, -1.4, 1.4);
      this.updatePlayer(dt);

      const cacheOpen = this.input.down("Tab");
      if (cacheOpen) this.weapons.setHeld(false, false);
      else this.weapons.setHeld(this.input.primary, this.input.secondary);
      this.hud.showCache(cacheOpen);

      this.weapons.update(dt);
      this.updateClients(dt);
      this.updatePapers(dt);
      this.updateWaves(dt);
      this.updateRage(dt);
      this.updateCombo(dt);
      this.projectiles.update(dt);

      if (this.projectiles.stickies.length !== this.stickyCount) {
        this.stickyCount = this.projectiles.stickies.length;
        if (this.stickyCount === 0) this.hud.showCache(false);
      }

      this.damageGlow = Math.max(0, this.damageGlow - dt * 1.8);

      this.hud.update({
        score: this.score,
        best: this.best,
        wave: this.wave,
        waveTitle: this.waveTitle,
        hp: this.player.hp,
        maxHp: this.player.maxHp,
        rage: this.rage,
        combo: this.combo,
        multiplier: this.multiplier(),
        sticky: this.stickyCount,
        rageActive: this.rageOn,
        rageReady: this.rage >= 100 && !this.rageOn,
        kills: this.kills,
      });
    } else if (this.state === "pause") {
      this.handleKeys();
      this.hud.showCache(false);
    } else if (this.state === "over") {
      this.overT += dt;
      this.camera.rotation.z = -Math.min(0.55, this.overT * 0.65);
      this.camera.position.y = Math.max(0.55, 1.68 - this.overT * 1.1);
      this.camera.rotation.x += dt * 0.06;
      if (this.overT > 1.4) this.input.exitLock();
    }

    if (this.state !== "playing") {
      this.hud.showCache(false);
    }

    // world ambience always runs
    this.arena.update(dt);
    this.effects.update(dt);
    this.updateCameraShake(dt);
    if (this.state === "playing") {
      this.viewmodel.update(dt, Math.hypot(this.player.vel.x, this.player.vel.z), this.sway.x, this.sway.y);
    } else if (this.state === "menu") {
      this.viewmodel.update(dt, 0, 0, 0);
    }
    this.viewmodel.setVisible(this.state === "playing" || this.state === "pause" || this.state === "over");

    const rageGlow = this.rageOn ? 0.55 + Math.sin(this.rawTime * 7) * 0.15 : 0;
    this.post.render(dt, rageGlow, this.damageGlow, this.rawTime);
  }

  private updateMenu(dt: number): void {
    this.menuAngle += dt * 0.12;
    const radius = 13.5;
    this.camera.position.set(Math.cos(this.menuAngle) * radius, 5.2 + Math.sin(this.menuAngle * 1.7) * 0.7, Math.sin(this.menuAngle) * radius);
    this.camera.lookAt(0, 1.4, 0);
    for (const c of this.menuClients) {
      c.update(dt, this.camera.position);
    }
    this.viewmodel.setVisible(false);
  }

  private applyQuality(low: boolean): void {
    this.lowQuality = low;
    this.post.setLow(low);
    this.renderer.shadowMap.enabled = !low;
    this.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.needsUpdate = true;
      }
    });
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.post.resize(w, h);
  }

  dispose(): void {
    window.clearTimeout(this.deathDelay);
    this.clearClients();
    for (const c of this.menuClients) c.dispose();
    this.menuClients = [];
    this.audio.dispose();
    this.hud.close();
  }
}

function makePaperGeo(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const vertices = new Float32Array([
    // left wing
    0, 0, 0.3, -0.42, 0, -0.22, 0, 0, 0.02,
    // right wing
    0, 0, 0.3, 0.42, 0, -0.22, 0, 0, 0.02,
    // keel
    0, 0, 0.3, 0, 0.14, -0.22, 0, 0, 0.02,
  ]);
  geo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geo.computeVertexNormals();
  return geo;
}
