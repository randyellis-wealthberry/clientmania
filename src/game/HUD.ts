import { WEAPONS, type WeaponDef } from "./weaponDefs";
import type { WeaponId } from "./weaponDefs";

export interface HudState {
  score: number;
  best: number;
  wave: number;
  waveTitle: string;
  hp: number;
  maxHp: number;
  rage: number;
  combo: number;
  multiplier: number;
  sticky: number;
  rageActive: boolean;
  rageReady: boolean;
  kills: number;
}

export interface RunStats {
  score: number;
  best: number;
  wave: number;
  kills: number;
  bestCombo: number;
  time: number;
  quip: string;
  newBest: boolean;
}

const HEX = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

export class HUD {
  private scoreEl: HTMLElement;
  private bestEl: HTMLElement;
  private waveEl: HTMLElement;
  private waveTitleEl: HTMLElement;
  private hpFill: HTMLElement;
  private hpNum: HTMLElement;
  private rageFill: HTMLElement;
  private rageHint: HTMLElement;
  private comboEl: HTMLElement;
  private weaponName: HTMLElement;
  private weaponSub: HTMLElement;
  private weaponSlot: HTMLElement;
  private weaponAlt: HTMLElement;
  private weaponCard: HTMLElement;
  private stickyEl: HTMLElement;
  private bannerEl: HTMLElement;
  private toastEl: HTMLElement;
  private killfeed: HTMLElement;
  private crosshair: HTMLElement;
  private vignette: HTMLElement;
  private hud: HTMLElement;
  private menu: HTMLElement;
  private pause: HTMLElement;
  private gameover: HTMLElement;
  private cache: HTMLElement;
  private startBtn: HTMLButtonElement;
  private resumeBtn: HTMLButtonElement;
  private restartBtn: HTMLButtonElement;
  private muteBtn: HTMLButtonElement;
  private muteLabel: HTMLElement;
  private lastCombo = 0;
  private lastRageReady = false;
  private bannerTimer = 0;
  private toastTimer = 0;
  private killTimers: number[] = [];

  constructor() {
    const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
      const node = document.getElementById(id);
      if (!node) throw new Error(`Missing UI element #${id}`);
      return node as T;
    };
    this.hud = el("hud");
    this.scoreEl = el("score");
    this.bestEl = el("best");
    this.waveEl = el("wave");
    this.waveTitleEl = el("wave-title");
    this.hpFill = el("hp-fill");
    this.hpNum = el("hp-num");
    this.rageFill = el("rage-fill");
    this.rageHint = el("rage-hint");
    this.comboEl = el("combo");
    this.weaponName = el("w-name");
    this.weaponSub = el("w-sub");
    this.weaponSlot = el("w-slot");
    this.weaponAlt = el("w-alt");
    this.weaponCard = el("weapon-card");
    this.stickyEl = el("sticky-count");
    this.bannerEl = el("banner");
    this.toastEl = el("toast");
    this.killfeed = el("killfeed");
    this.crosshair = el("crosshair");
    this.vignette = el("damage-vignette");
    this.menu = el("menu");
    this.pause = el("pause");
    this.gameover = el("gameover");
    this.cache = el("cache");
    this.startBtn = el<HTMLButtonElement>("start");
    this.resumeBtn = el<HTMLButtonElement>("resume");
    this.restartBtn = el<HTMLButtonElement>("restart");
    this.muteBtn = el<HTMLButtonElement>("mute");
    this.muteLabel = el("mute-label");

    this.buildCache(el("menu-cache"), false);
    this.buildCache(el("pause-cache"), true);
    this.buildCache(el("cache-grid"), true);
    this.setWeapon(WEAPONS[0]!);
  }

  private buildCache(container: HTMLElement, compact: boolean): void {
    container.innerHTML = "";
    for (const w of WEAPONS) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `cache-card${compact ? " compact" : ""}`;
      card.dataset.id = w.id;
      card.style.setProperty("--c", HEX(w.color));
      card.innerHTML = `
        <span class="cc-slot">${w.slot}</span>
        <span class="cc-group">${w.group}</span>
        <span class="cc-name">${w.name}</span>
        <span class="cc-sub">${w.subtitle}</span>
        <span class="cc-alt">RMB · ${w.alt}</span>
      `;
      container.appendChild(card);
    }
  }

  onStart(fn: () => void): void {
    this.startBtn.addEventListener("click", fn);
  }

  onResume(fn: () => void): void {
    this.resumeBtn.addEventListener("click", fn);
  }

  onRestart(fn: () => void): void {
    this.restartBtn.addEventListener("click", fn);
  }

  onMute(fn: () => void): void {
    this.muteBtn.addEventListener("click", fn);
  }

  onCachePick(fn: (id: WeaponId) => void): void {
    document.addEventListener("click", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".cache-card");
      if (!card) return;
      const id = card.dataset.id as WeaponId | undefined;
      if (id) fn(id);
    });
  }

  setWeapon(def: WeaponDef, cache: readonly WeaponDef[] = WEAPONS): void {
    this.weaponName.textContent = def.name;
    this.weaponSub.textContent = def.subtitle;
    this.weaponSlot.textContent = def.slot;
    this.weaponAlt.textContent = `RMB — ${def.alt}`;
    this.weaponCard.style.setProperty("--c", HEX(def.color));
    document.documentElement.style.setProperty("--weapon", HEX(def.color));
    const active = cache.findIndex((w) => w.id === def.id);
    document.querySelectorAll<HTMLElement>(".cache-card").forEach((card) => {
      const isActive = card.dataset.id === def.id;
      card.classList.toggle("active", isActive);
      if (card.closest("#cache-grid") && active >= 0) {
        card.style.animationDelay = `${active * 0.012}s`;
      }
    });
  }

  update(s: HudState): void {
    this.scoreEl.textContent = s.score.toLocaleString("en-US");
    this.bestEl.textContent = s.best.toLocaleString("en-US");
    this.waveEl.textContent = `WAVE ${String(s.wave).padStart(2, "0")}`;
    this.waveTitleEl.textContent = s.waveTitle;
    const hp = Math.max(0, s.hp) / s.maxHp;
    this.hpFill.style.transform = `scaleX(${hp})`;
    this.hpNum.textContent = String(Math.max(0, Math.ceil(s.hp)));
    this.hpFill.classList.toggle("low", hp < 0.3);
    const rage = Math.min(1, s.rage / 100);
    this.rageFill.style.transform = `scaleX(${rage})`;
    this.rageHint.textContent = s.rageActive ? "RAGING" : s.rageReady ? "[F] RAGE" : `${Math.floor(s.rage)}%`;
    this.rageFill.classList.toggle("ready", s.rageReady || s.rageActive);
    if (s.rageReady && !this.lastRageReady) this.toast("RAGE LAYER READY — PRESS [F]", 2.2);
    this.lastRageReady = s.rageReady;

    const showCombo = s.combo > 1;
    if (s.combo !== this.lastCombo) {
      this.comboEl.textContent = showCombo ? `×${s.multiplier.toFixed(1)}` : "";
      this.comboEl.classList.remove("pop");
      void this.comboEl.offsetWidth;
      if (showCombo) this.comboEl.classList.add("pop");
      this.lastCombo = s.combo;
    }
    this.comboEl.classList.toggle("visible", showCombo);

    this.stickyEl.textContent = s.sticky > 0 ? `ACTION ITEMS ×${s.sticky} · [R]` : "";
    this.stickyEl.classList.toggle("visible", s.sticky > 0);
    this.hpNum.dataset.kills = String(s.kills);
  }

  setRage(active: boolean): void {
    document.body.classList.toggle("rage", active);
    this.rageHint.textContent = active ? "RAGING" : this.rageHint.textContent;
  }

  hit(kill = false): void {
    this.crosshair.classList.remove("hit", "kill");
    void this.crosshair.offsetWidth;
    this.crosshair.classList.add(kill ? "kill" : "hit");
    window.setTimeout(() => this.crosshair.classList.remove("hit", "kill"), 140);
  }

  damage(amount: number): void {
    this.vignette.classList.remove("flash");
    void this.vignette.offsetWidth;
    this.vignette.style.setProperty("--dmg", String(Math.min(1, 0.35 + amount / 40)));
    this.vignette.classList.add("flash");
  }

  banner(kicker: string, title: string, sub: string): void {
    this.bannerEl.innerHTML = `<span class="b-kicker">${kicker}</span><strong class="b-title">${title}</strong><span class="b-sub">${sub}</span>`;
    this.bannerEl.classList.remove("show");
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add("show");
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove("show"), 2600);
  }

  toast(text: string, seconds = 3): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), seconds * 1000);
  }

  killFeed(name: string, quip: string, boss = false): void {
    const item = document.createElement("div");
    item.className = `feed-item${boss ? " boss" : ""}`;
    item.innerHTML = `<span class="feed-name">${name}</span><span class="feed-quip">${quip}</span>`;
    this.killfeed.prepend(item);
    while (this.killfeed.children.length > 5) this.killfeed.lastElementChild?.remove();
    const t = window.setTimeout(() => {
      item.classList.add("out");
      window.setTimeout(() => item.remove(), 400);
    }, 3200);
    this.killTimers.push(t);
  }

  showScreen(screen: "menu" | "playing" | "pause" | "gameover"): void {
    this.menu.classList.toggle("hidden", screen !== "menu");
    this.pause.classList.toggle("hidden", screen !== "pause");
    this.gameover.classList.toggle("hidden", screen !== "gameover");
    this.hud.classList.toggle("active", screen === "playing" || screen === "pause");
    document.body.classList.toggle("in-game", screen === "playing" || screen === "pause");
    if (screen !== "playing") this.cache.classList.remove("open");
    if (screen === "menu") this.killfeed.innerHTML = "";
  }

  showCache(open: boolean): void {
    this.cache.classList.toggle("open", open);
  }

  setMuted(muted: boolean): void {
    this.muteLabel.textContent = muted ? "SOUND OFF" : "SOUND ON";
    this.muteBtn.classList.toggle("muted", muted);
  }

  showGameOver(stats: RunStats): void {
    this.gameover.querySelector<HTMLElement>("#go-quip")!.textContent = stats.quip;
    this.gameover.querySelector<HTMLElement>("#go-score")!.textContent = stats.score.toLocaleString("en-US");
    this.gameover.querySelector<HTMLElement>("#go-best")!.textContent = stats.best.toLocaleString("en-US");
    this.gameover.querySelector<HTMLElement>("#go-wave")!.textContent = String(stats.wave);
    this.gameover.querySelector<HTMLElement>("#go-kills")!.textContent = String(stats.kills);
    this.gameover.querySelector<HTMLElement>("#go-combo")!.textContent = `×${stats.bestCombo.toFixed(1)}`;
    const mins = Math.floor(stats.time / 60);
    const secs = Math.floor(stats.time % 60);
    this.gameover.querySelector<HTMLElement>("#go-time")!.textContent = `${mins}:${String(secs).padStart(2, "0")}`;
    this.gameover.classList.toggle("new-best", stats.newBest);
    this.showScreen("gameover");
  }

  setBest(best: number): void {
    this.bestEl.textContent = best.toLocaleString("en-US");
  }

  resetRun(): void {
    this.killfeed.innerHTML = "";
    this.bannerEl.classList.remove("show");
    this.toastEl.classList.remove("show");
    this.comboEl.classList.remove("visible", "pop");
    this.comboEl.textContent = "";
    this.stickyEl.classList.remove("visible");
    this.lastCombo = 0;
    this.lastRageReady = false;
    this.cache.classList.remove("open");
    for (const t of this.killTimers) window.clearTimeout(t);
    this.killTimers.length = 0;
  }

  close(): void {
    for (const t of this.killTimers) window.clearTimeout(t);
    this.killTimers.length = 0;
  }
}
