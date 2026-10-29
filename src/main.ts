import "./style.css";
import { Game } from "./game/Game";
import { HUD } from "./game/HUD";

const canvas = document.getElementById("scene") as HTMLCanvasElement | null;
const hud = new HUD();

if (!canvas) {
  throw new Error("Game canvas missing");
}

let game: Game;
try {
  game = new Game(canvas, hud);
} catch (error) {
  console.error(error);
  const boot = document.getElementById("boot");
  if (boot) {
    boot.innerHTML = `<div class="boot-mark">NO WEBGL</div><p>Your browser refused the engagement. Try a modern browser with hardware acceleration.</p>`;
  }
  throw error;
}

// Debug handle for poking at the simulation from the console (?debug=1 also works in prod).
if (import.meta.env.DEV || new URLSearchParams(window.location.search).has("debug")) {
  (window as unknown as { clientmania: unknown }).clientmania = game;
}

const boot = document.getElementById("boot");
window.setTimeout(() => {
  boot?.classList.add("gone");
  window.setTimeout(() => boot?.remove(), 700);
}, 420);

// Enter starts the engagement from the menu.
window.addEventListener("keydown", (e) => {
  if (e.code === "Enter" && !document.getElementById("menu")?.classList.contains("hidden")) {
    document.getElementById("start")?.click();
  }
});

