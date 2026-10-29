export type WeaponId =
  | "hammer"
  | "gun"
  | "flame"
  | "hose"
  | "chainsaw"
  | "paintball"
  | "broom"
  | "blackhole"
  | "rocket"
  | "lightning"
  | "demolition"
  | "bugs"
  | "laser"
  | "acid"
  | "sticky";

export type WeaponGroup = "BASE" | "HEAVY" | "ADVANCED";

export interface WeaponDef {
  id: WeaponId;
  name: string;
  subtitle: string;
  group: WeaponGroup;
  color: number;
  alt: string;
  auto: boolean;
  continuous: boolean;
  cooldown: number;
  slot: string;
}

/** The RageLayer cache: fifteen procedural tools, repurposed for client relations. */
export const WEAPONS: WeaponDef[] = [
  {
    id: "hammer",
    name: "HAMMER",
    subtitle: "SHIP IT",
    group: "BASE",
    color: 0xd7ff3e,
    alt: "GROUND SLAM",
    auto: false,
    continuous: false,
    cooldown: 0.5,
    slot: "01",
  },
  {
    id: "gun",
    name: "GUN",
    subtitle: "SCOPE CREEP",
    group: "BASE",
    color: 0x47e0ff,
    alt: "3-ROUND BURST",
    auto: true,
    continuous: false,
    cooldown: 0.105,
    slot: "02",
  },
  {
    id: "flame",
    name: "FLAMETHROWER",
    subtitle: "HOT TAKE",
    group: "BASE",
    color: 0xff7a1a,
    alt: "FIREBALL",
    auto: true,
    continuous: true,
    cooldown: 0.075,
    slot: "03",
  },
  {
    id: "hose",
    name: "WATER HOSE",
    subtitle: "SCOPE HOSE",
    group: "BASE",
    color: 0x47e0ff,
    alt: "PRESSURE BLAST",
    auto: true,
    continuous: true,
    cooldown: 0.065,
    slot: "04",
  },
  {
    id: "chainsaw",
    name: "CHAINSAW",
    subtitle: "SCOPE CUT",
    group: "BASE",
    color: 0xff2e88,
    alt: "BLOODLESS 360",
    auto: true,
    continuous: true,
    cooldown: 0.085,
    slot: "05",
  },
  {
    id: "paintball",
    name: "PAINTBALL",
    subtitle: "MOOD BOARD",
    group: "BASE",
    color: 0xff2e88,
    alt: "SPLAT SPREAD",
    auto: false,
    continuous: false,
    cooldown: 0.16,
    slot: "06",
  },
  {
    id: "broom",
    name: "BROOM",
    subtitle: "CLEAN SLATE",
    group: "BASE",
    color: 0xf4efe4,
    alt: "360 SWEEP",
    auto: false,
    continuous: false,
    cooldown: 0.42,
    slot: "07",
  },
  {
    id: "blackhole",
    name: "BLACK HOLE",
    subtitle: "RETENTION",
    group: "HEAVY",
    color: 0x8b5cff,
    alt: "COLLAPSE NOW",
    auto: false,
    continuous: false,
    cooldown: 1.4,
    slot: "08",
  },
  {
    id: "rocket",
    name: "ROCKET LAUNCHER",
    subtitle: "GO-TO-MARKET",
    group: "HEAVY",
    color: 0xff7a1a,
    alt: "TRIPLE SALVO",
    auto: false,
    continuous: false,
    cooldown: 0.85,
    slot: "09",
  },
  {
    id: "lightning",
    name: "LIGHTNING",
    subtitle: "URGENT",
    group: "HEAVY",
    color: 0x47e0ff,
    alt: "STORM",
    auto: false,
    continuous: false,
    cooldown: 0.7,
    slot: "10",
  },
  {
    id: "demolition",
    name: "DEMOLITION",
    subtitle: "REBRAND",
    group: "HEAVY",
    color: 0xff3b30,
    alt: "CONTROLLED DEMO",
    auto: false,
    continuous: false,
    cooldown: 1.1,
    slot: "11",
  },
  {
    id: "bugs",
    name: "BUGS",
    subtitle: "QA PASS",
    group: "HEAVY",
    color: 0xd7ff3e,
    alt: "REGRESSION",
    auto: false,
    continuous: false,
    cooldown: 1.6,
    slot: "12",
  },
  {
    id: "laser",
    name: "LASER CUTTER",
    subtitle: "PIXEL PERFECT",
    group: "ADVANCED",
    color: 0xff2e88,
    alt: "OVERCHARGE",
    auto: true,
    continuous: true,
    cooldown: 0.055,
    slot: "13",
  },
  {
    id: "acid",
    name: "ACID JAR",
    subtitle: "FEEDBACK",
    group: "ADVANCED",
    color: 0xd7ff3e,
    alt: "BIG JAR",
    auto: false,
    continuous: false,
    cooldown: 0.9,
    slot: "14",
  },
  {
    id: "sticky",
    name: "STICKY BOMBS",
    subtitle: "ACTION ITEMS",
    group: "ADVANCED",
    color: 0xffc93c,
    alt: "DETONATE ALL",
    auto: false,
    continuous: false,
    cooldown: 0.4,
    slot: "15",
  },
];

export const WEAPON_BY_ID = new Map<WeaponId, WeaponDef>(WEAPONS.map((w) => [w.id, w]));

export function groupLabel(group: WeaponGroup): string {
  return group === "BASE" ? "BASE" : group === "HEAVY" ? "HEAVY" : "ADVANCED";
}
