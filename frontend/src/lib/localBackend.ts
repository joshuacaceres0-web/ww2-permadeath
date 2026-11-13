/**
 * LOCAL SAVE BACKEND — the itch / standalone browser build only.
 *
 * Built with VITE_LOCAL_SAVE=1, api.ts routes every request here
 * instead of the FastAPI server: an itch page is static hosting,
 * so the campaign lives in the player's own browser
 * (localStorage) and this module plays the backend's part.
 *
 * It is a faithful port of the Python backend's rules, file by
 * file, so the game plays by the same numbers it does behind
 * the real server:
 *   lib/missions.py  — mission list, kill RP, radio costs
 *   lib/items.py     — stores, prices, restrictions, rolls
 *   lib/gen.py       — names, stories, ranks, commander ladder
 *   lib/medals.py    — decoration criteria
 *   lib/graves.py    — graveyard layout + tribute positions
 *   lib/state.py     — default state, founding squad + wall
 *   routers/*.py     — endpoint rules, error text, filing math
 * Randomness is the browser's (the server's seeded Python RNG
 * has no twin here), so a local campaign writes its own stories
 * from the same pools and templates. Nothing leaves the device.
 */
import { ApiError } from "./api";

// ------------------------------------------------------------------
// small utilities
// ------------------------------------------------------------------

type Dict = Record<string, unknown>;

function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

/** Python's round(): half to even. Hire costs depend on it. */
function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

function bigId(rng: Rng): string {
  // A 122-bit decimal string, the shape the server mints.
  let s = "";
  for (let i = 0; i < 37; i++) s += Math.floor(rng() * 10).toString();
  return s.replace(/^0+/, "") || "1";
}

function err(status: number, detail: string): never {
  throw new ApiError(status, { detail });
}

// ------------------------------------------------------------------
// lib/gen.py — identity, stories, ranks
// ------------------------------------------------------------------

const FIRST_NAMES = [
  "Robert", "John", "James", "William", "Charles", "George", "Joseph", "Richard",
  "Edward", "Donald", "Thomas", "Frank", "Harold", "Paul", "Raymond", "Walter",
  "Jack", "Henry", "Kenneth", "Arthur", "Albert", "Clarence", "Fred", "Harry",
  "Eugene", "Lawrence", "Earl", "Howard", "Carl", "Ralph", "Roy", "Louis",
  "Francis", "Leonard", "Herbert", "Stanley", "Elmer", "Melvin", "Chester",
  "Lloyd", "Floyd", "Wilbur", "Virgil", "Leroy", "Vernon", "Orville", "Homer",
  "Clifford", "Woodrow", "Marvin", "Alvin", "Lester", "Willard", "Delbert",
];
const LAST_NAMES = [
  "Kowalski", "O'Brien", "Russo", "Novak", "Lindqvist", "Murphy", "Sullivan",
  "Esposito", "Hernandez", "Yazzie", "Petersen", "Kaminski", "Romano", "Walsh",
  "Jablonski", "Gallagher", "Brennan", "Ortiz", "Dubois", "Fontaine", "Olson",
  "Hansen", "Mueller", "Baker", "Miller", "Turner", "Whitaker", "Doyle",
  "Holloway", "Pruitt", "Callahan", "Mercer", "Boyd", "Slater", "Rasmussen",
  "Yoder", "Barrett", "Mullins", "Tate", "Hodge", "Kozlowski", "DeLuca",
  "Svoboda", "McAllister", "Takahashi", "Begay", "Wojcik", "Schultz",
];
const HOMETOWNS = [
  "Duluth, MN", "Amarillo, TX", "Erie, PA", "Mobile, AL", "Tulsa, OK",
  "Provo, UT", "Bend, OR", "Savannah, GA", "Cedar Falls, IA", "Roanoke, VA",
  "Laredo, TX", "Bismarck, ND", "Boise, ID", "Wheeling, WV", "Fresno, CA",
  "Dover, DE", "Chattanooga, TN", "Topeka, KS", "Hamtramck, MI", "Gallup, NM",
  "Scranton, PA", "Bedford, VA", "Lowell, MA", "Butte, MT", "Paterson, NJ",
];
const QUIRKS = [
  "Eagle Eye", "Tough Bastard", "Shellshocked", "Adrenaline Junkie",
  "Preacher", "Quiet One", "Bar Fly", "Brooklyn", "Farm Boy", "Lucky",
  "Grumbler", "Fast Talker", "Night Owl", "Dead Shot", "Chow Hound", "Windy",
  "Professor", "Hillbilly", "Cowboy", "Pops", "Kid", "Deacon",
  "Skittish", "Jumpy",
];
const OCCUPATIONS = [
  "worked the night shift at a steel mill",
  "drove a milk truck before dawn every day",
  "boxed Golden Gloves at the county armory",
  "pumped gas at a station on Route 66",
  "taught Sunday school and sang bass in the choir",
  "worked his family's dairy farm",
  "planted pine with the Civilian Conservation Corps in Montana",
  "sold newspapers on a downtown corner",
  "was a cub reporter on the town weekly",
  "apprenticed as a machinist at the rail yard",
  "played second base for a semi-pro ball club",
  "gutted salmon at a cannery",
  "cut hair in his uncle's barbershop",
  "was halfway through a teaching certificate",
  "hauled coal out of a West Virginia mine",
];
const DIVISIONS: Record<string, [string, string[]]> = {
  "1st Infantry Division": ["Big Red One", [
    "came ashore at Omaha Beach with the second wave and spent the first night in a shingle trench under the bluffs",
    "helped carry the line from the Normandy beaches to the 39-day fight for Aachen",
    "took Hill 232 in freezing rain with the machine-gun section",
  ]],
  "29th Infantry Division": ["Blue and Gray", [
    "landed at Dog Green on Omaha Beach, where whole boat teams from small Virginia towns were lost in minutes",
    "fought through the hedgerows toward Saint-Lô, where a good day meant twenty yards of ground",
  ]],
  "2nd Ranger Battalion": ["Rangers Lead the Way", [
    "climbed the cliffs at Pointe du Hoc on ropes soaked with sea spray, in a battalion that lost sixty percent that day",
  ]],
  "4th Infantry Division": ["Ivy", [
    "waded ashore at Utah Beach and pushed inland toward Cherbourg",
    "dug a log-roofed foxhole against the tree bursts in the Hürtgen Forest",
  ]],
  "101st Airborne Division": ["Screaming Eagles", [
    "jumped into Normandy in the dark miles off his drop zone and found his squad with a cricket clicker",
    "held the causeways behind Utah Beach until the seaborne troops came through",
  ]],
  "82nd Airborne Division": ["All American", [
    "dropped near Sainte-Mère-Église and fought for the bridge at La Fière",
  ]],
  "9th Infantry Division": ["Old Reliables", [
    "went through the Saint-Lô breakout after the Cobra bombing, when the ground shook for an hour",
    "spent October in the Hürtgen, where artillery turned the treetops into shrapnel",
  ]],
  "28th Infantry Division": ["Keystone", [
    "fought at Schmidt and Kommerscheidt in the Hürtgen, the division's 'Bloody Bucket' month",
  ]],
};
const PERSONAL = [
  "he wrote his mother every night, and the censor cut half of every letter to ribbons",
  "he kept a photograph of his girl tucked inside his helmet liner",
  "he carried the rosary his mother pressed into his hand at the train station",
  "he shared his last K-ration with a French farm family near Saint-Lô",
  "he traded cigarettes for fresh eggs every time the line stopped moving",
  "he could field-strip a Garand blindfolded and liked to prove it",
  "he whistled Glenn Miller to keep the new men calm under shelling",
  "he kept a pocket Bible with the date of every battle penciled inside the cover",
  "he promised his kid brother a German helmet and meant to keep the promise",
  "he dried his socks inside his shirt so his feet wouldn't rot in the wet",
];
const EPITAPHS = [
  "His last letter home was found in his breast pocket, sealed and unsent.",
  "One dog tag stayed with him. The other went home to his mother.",
  "His buddies marked the spot with his rifle, bayonet down, helmet on the stock.",
  "The squad never sang Glenn Miller again without him.",
  "A French girl left flowers at his marker every Sunday until the war ended.",
  "His mother kept a blue star in the window until the telegram came.",
  "He was twenty-one. The men who were there never forgot his name.",
];

const RANKS = ["Pvt.", "Pfc.", "Cpl.", "Sgt.", "S/Sgt.", "T/Sgt.", "1st Sgt."];
const MAX_LEVEL = RANKS.length - 1;
const COMMANDER_RANKS = ["2nd Lt.", "1st Lt.", "Capt.", "Major", "Lt. Col.", "Col.", "Brig. Gen.", "Maj. Gen."];
const WINS_PER_COMMANDER_LEVEL = 2;
const XP_PER_KILL = 20;
const XP_PER_MISSION = 50;

const levelFor = (missions: number) => Math.max(0, Math.min(MAX_LEVEL, missions));
const rankFor = (missions: number) => RANKS[levelFor(missions)];
const commanderLevel = (wins: number) =>
  Math.min(COMMANDER_RANKS.length, 1 + Math.floor(wins / WINS_PER_COMMANDER_LEVEL));

function makeBackstory(name: string, hometown: string, quirk: string, rng: Rng): { unit: string; backstory: string } {
  const division = pick(rng, Object.keys(DIVISIONS));
  const [nickname, episodes] = DIVISIONS[division];
  const first = name.split(" ")[0];
  const backstory =
    `${name} of ${hometown} ${pick(rng, OCCUPATIONS)} before he enlisted in ` +
    `${pick(rng, ["1941", "1942", "1943"])}. With the ${division} ("${nickname}") ` +
    `he ${pick(rng, episodes)}. The men called him "${quirk}" — ` +
    `${pick(rng, PERSONAL)}. ${first} meant to go home when it was over.`;
  return { unit: division, backstory };
}

function causePhrase(cause: string): string {
  if (cause.trim().toLowerCase() === "killed in action") return "enemy fire";
  if (cause.length > 1 && cause[1] === cause[1].toLowerCase() && cause[1] !== cause[1].toUpperCase()) {
    return cause[0].toLowerCase() + cause.slice(1);
  }
  return cause;
}

function makeEpitaph(doc: Dict, cause: string, missionCode: string, location: string, kills: number): string {
  const rng = mulberry32(hashSeed(String(doc.id)));
  const rank = rankFor(Number(doc.missions ?? 0));
  const first = String(doc.name).split(" ")[0];
  const ops = Number(doc.missions ?? 0);
  const record = ops
    ? `${ops} operation${ops !== 1 ? "s" : ""} behind him and ${kills} confirmed`
    : `his first operation, ${kills} confirmed`;
  return (
    `${String(doc.backstory ?? "")} \n\n${rank} ${String(doc.name)} was killed by ${causePhrase(cause)} ` +
    `during ${missionCode} at ${location} — ${record}. ${pick(rng, EPITAPHS)} ` +
    `${first} never made it home.`
  ).trim();
}

function makeSoldier(unitType: string, status = "reserve"): Dict {
  const rng = Math.random;
  const name = `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
  const hometown = pick(rng, HOMETOWNS);
  const quirk = pick(rng, QUIRKS);
  return {
    id: bigId(rng),
    name,
    type: unitType,
    status,
    xp: 0,
    kills: 0,
    missions: 0,
    points: 0,
    upgrades: {},
    equipment: [],
    medals: [],
    quirk,
    hometown,
    portrait_seed: Math.floor(rng() * 2 ** 31),
    hired_at: nowIso(),
    ...makeBackstory(name, hometown, quirk, rng),
  };
}

// ------------------------------------------------------------------
// lib/missions.py — campaign definitions + radio economy
// ------------------------------------------------------------------

const KILL_RP = 10;

function battleReward(reward: number, victory: boolean, kills: number, lootRp = 0): number {
  return (victory ? reward : 0) + kills * KILL_RP + lootRp;
}

const RADIO_SUPPORT_COST: Record<string, number> = {
  supply: 10, recon: 10, mortar: 20, smoke: 15, artillery: 30, tank: 60,
};

function radioCost(base: number, radiomanLevel: number): number {
  return Math.max(0, Math.floor(base * (1 - 0.05 * radiomanLevel) + 0.5));
}

const UNIT_COSTS: Record<string, number> = {
  rifleman: 100, medic: 150, mg: 220, sniper: 260, at: 300, radioman: 150, recon: 180, engineer: 170,
};

interface MissionDef {
  id: string; code: string; location: string; objective: string;
  difficulty: string; reward: number; terrain: string; brief: string;
  enemies: { type: string; wave: number; count: number }[];
}

const MISSIONS: MissionDef[] = [
  {
    id: "op_01", code: "OPERATION OVERLORD", location: "Normandy, France — 6 June 1944",
    objective: "D-Day. Get ashore or get down from the sky, break the coastal defense, silence the MG42",
    difficulty: "MODERATE", reward: 250, terrain: "dday",
    brief: "D-Day. Choose how your squad goes in: across Omaha Beach in a Higgins boat, under the bluffs and the steel hedgehogs, or by C-47 in the dark with the airborne — scattered across the hedgerows behind the Atlantic Wall. Either way an MG42 is waiting. Use the gaps, keep moving, and remember: every man you lose is gone for good.",
    enemies: [
      { type: "volks", wave: 1, count: 6 }, { type: "funk", wave: 1, count: 1 }, { type: "medic", wave: 1, count: 1 },
      { type: "grenadier", wave: 1, count: 3 }, { type: "mg42", wave: 1, count: 9 }, { type: "mortar", wave: 1, count: 3 },
      { type: "volks", wave: 2, count: 4 }, { type: "funk", wave: 2, count: 1 }, { type: "grenadier", wave: 2, count: 2 },
      { type: "medic", wave: 2, count: 1 }, { type: "scharfschutze", wave: 2, count: 1 },
      { type: "volks", wave: 3, count: 3 }, { type: "panzer", wave: 3, count: 1 }, { type: "funk", wave: 3, count: 1 },
      { type: "medic", wave: 3, count: 1 }, { type: "grenadier", wave: 3, count: 3 }, { type: "mg42", wave: 3, count: 1 },
      { type: "scharfschutze", wave: 3, count: 1 },
    ],
  },
  {
    id: "op_02", code: "OPERATION SILENT CHATEAU", location: "Valognes Estate",
    objective: "Eliminate the SS Signals Officer and clear the estate grounds",
    difficulty: "HARD", reward: 400, terrain: "town",
    brief: "An SS Hauptmann is running the estate as a signals relay. His presence stiffens every gun in the village — kill him and the defense wavers. Fight house to house. Grenadiers in the streets, an MG42 dug in the courtyard. Short ranges, no room to run.",
    enemies: [
      { type: "grenadier", wave: 1, count: 3 }, { type: "volks", wave: 1, count: 3 }, { type: "funk", wave: 1, count: 1 },
      { type: "medic", wave: 1, count: 1 }, { type: "mg42", wave: 1, count: 3 },
      { type: "officer", wave: 2, count: 1 }, { type: "grenadier", wave: 2, count: 1 }, { type: "funk", wave: 2, count: 1 },
      { type: "medic", wave: 2, count: 1 }, { type: "mg42", wave: 2, count: 1 }, { type: "fallschirmjager", wave: 2, count: 3 },
      { type: "mortar", wave: 2, count: 1 }, { type: "volks", wave: 2, count: 1 },
      { type: "panzer", wave: 3, count: 1 }, { type: "funk", wave: 3, count: 1 }, { type: "medic", wave: 3, count: 1 },
      { type: "grenadier", wave: 3, count: 3 }, { type: "officer", wave: 3, count: 1 }, { type: "fallschirmjager", wave: 3, count: 3 },
      { type: "mortar", wave: 3, count: 1 }, { type: "volks", wave: 3, count: 1 },
    ],
  },
  {
    id: "op_03", code: "OPERATION IRON CROSSROADS", location: "Carentan Causeway",
    objective: "Destroy the twin MG42 nests and hold against the counter-attack",
    difficulty: "SEVERE", reward: 650, terrain: "causeway",
    brief: "A narrow causeway over flooded ground — one way in, one way out. Two interlocking MG42 nests cover the crossing and a Panzerfaust team hunts anything that stops. Take the nests, then dig in: they always counter-attack across the flats.",
    enemies: [
      { type: "grenadier", wave: 1, count: 2 }, { type: "funk", wave: 1, count: 1 }, { type: "panzerfaust", wave: 1, count: 2 },
      { type: "mg42", wave: 1, count: 3 }, { type: "volks", wave: 1, count: 2 }, { type: "medic", wave: 1, count: 1 },
      { type: "volks", wave: 2, count: 3 }, { type: "panzer", wave: 2, count: 1 }, { type: "funk", wave: 2, count: 1 },
      { type: "medic", wave: 2, count: 1 }, { type: "grenadier", wave: 2, count: 3 }, { type: "officer", wave: 2, count: 1 },
      { type: "mortar", wave: 1, count: 1 }, { type: "scharfschutze", wave: 1, count: 1 }, { type: "fallschirmjager", wave: 2, count: 3 },
      { type: "volks", wave: 3, count: 3 }, { type: "panzer", wave: 3, count: 1 }, { type: "funk", wave: 3, count: 1 },
      { type: "medic", wave: 3, count: 1 }, { type: "grenadier", wave: 3, count: 3 }, { type: "panzerfaust", wave: 3, count: 2 },
      { type: "mg42", wave: 3, count: 1 },
    ],
  },
  {
    id: "op_04", code: "OPERATION PERMAFROST FLAK", location: "Hürtgen Forest Bunker Complex",
    objective: "Demolish the Flak 38 battery and break the bunker garrison",
    difficulty: "NIGHTMARE", reward: 1000, terrain: "forest",
    brief: "Last leg of the line: a Flak 38 emplacement zeroed on the forest road, an officer's command post, and every grenadier they can scrape together. Cold enough to freeze a rifle bolt. Get the gun, break the garrison, and bring everyone home you can.",
    enemies: [
      { type: "grenadier", wave: 1, count: 2 }, { type: "funk", wave: 1, count: 1 }, { type: "officer", wave: 1, count: 1 },
      { type: "mg42", wave: 1, count: 3 }, { type: "flak", wave: 1, count: 1 }, { type: "volks", wave: 1, count: 2 },
      { type: "medic", wave: 1, count: 1 },
      { type: "volks", wave: 2, count: 2 }, { type: "panzer", wave: 2, count: 1 }, { type: "funk", wave: 2, count: 1 },
      { type: "medic", wave: 2, count: 1 }, { type: "grenadier", wave: 2, count: 3 }, { type: "panzerfaust", wave: 2, count: 3 },
      { type: "mortar", wave: 1, count: 1 }, { type: "scharfschutze", wave: 2, count: 3 }, { type: "fallschirmjager", wave: 2, count: 3 },
      { type: "volks", wave: 3, count: 3 }, { type: "panzer", wave: 3, count: 1 }, { type: "funk", wave: 3, count: 1 },
      { type: "medic", wave: 3, count: 1 }, { type: "grenadier", wave: 3, count: 4 }, { type: "fallschirmjager", wave: 3, count: 3 },
      { type: "panzerfaust", wave: 3, count: 2 }, { type: "scharfschutze", wave: 3, count: 2 },
    ],
  },
];

const missionList = () => MISSIONS.map((m, index) => ({ ...m, index }));
const missionByIndex = (i: number) => (i >= 0 && i < MISSIONS.length ? { ...MISSIONS[i], index: i } : null);

// ------------------------------------------------------------------
// lib/items.py — stores
// ------------------------------------------------------------------

const UPGRADE_TRACKS = ["toughness", "marksmanship", "steady", "legs", "nerve", "eyes"];
const UPGRADE_COST = 2;
const UPGRADE_CAP = 3;
const EQUIP_SLOTS = 2;
const ALL_BUT_AT = ["rifleman", "medic", "mg", "sniper", "radioman", "recon", "engineer"];

const ITEMS: Record<string, { price: number; restrict: string[] | null; weight: number }> = {
  entrench: { price: 40, restrict: null, weight: 3 },
  ammo: { price: 40, restrict: null, weight: 3 },
  canteen: { price: 40, restrict: null, weight: 3 },
  dressing: { price: 40, restrict: null, weight: 3 },
  jeepcap: { price: 40, restrict: null, weight: 3 },
  binoculars: { price: 75, restrict: ["recon"], weight: 1 },
  charm: { price: 75, restrict: null, weight: 1 },
  batteries: { price: 75, restrict: ["radioman"], weight: 1 },
  aidbag: { price: 75, restrict: ["medic"], weight: 1 },
  nethelmet: { price: 75, restrict: null, weight: 1 },
  parahelmet: { price: 75, restrict: null, weight: 1 },
  pilecap: { price: 75, restrict: null, weight: 1 },
  hbtcap: { price: 75, restrict: ["engineer"], weight: 1 },
  garrisoncap: { price: 25, restrict: null, weight: 2 },
  bayonet: { price: 75, restrict: ["rifleman"], weight: 1 },
  grenades: { price: 75, restrict: ["rifleman"], weight: 1 },
  surgical: { price: 75, restrict: ["medic"], weight: 1 },
  morphine: { price: 75, restrict: ["medic"], weight: 1 },
  barrel: { price: 75, restrict: ["mg"], weight: 1 },
  bearerbox: { price: 75, restrict: ["mg"], weight: 1 },
  ghillie: { price: 75, restrict: ["sniper"], weight: 1 },
  matchammo: { price: 75, restrict: ["sniper"], weight: 1 },
  shaped: { price: 75, restrict: ["at"], weight: 1 },
  satchel: { price: 75, restrict: ["at"], weight: 1 },
  antenna: { price: 75, restrict: ["radioman"], weight: 1 },
  codebook: { price: 75, restrict: ["radioman"], weight: 1 },
  camonet: { price: 75, restrict: ["recon"], weight: 1 },
  flares: { price: 75, restrict: ["recon"], weight: 1 },
  probekit: { price: 75, restrict: ["engineer"], weight: 1 },
  toolroll: { price: 75, restrict: ["engineer"], weight: 1 },
  thompson: { price: 0, restrict: ALL_BUT_AT, weight: 1.0 },
  mp40: { price: 0, restrict: ALL_BUT_AT, weight: 1.0 },
  carbine: { price: 0, restrict: ALL_BUT_AT, weight: 1.0 },
  springfield: { price: 0, restrict: ["sniper", "recon"], weight: 0.7 },
  trench97: { price: 0, restrict: ALL_BUT_AT, weight: 0.7 },
  bar: { price: 0, restrict: ["mg"], weight: 0.5 },
  fg42: { price: 0, restrict: ALL_BUT_AT, weight: 0.3 },
};
const GUNS = new Set(["thompson", "mp40", "carbine", "springfield", "trench97", "bar", "fg42"]);
const HEADGEAR = new Set(["jeepcap", "nethelmet", "parahelmet", "pilecap", "hbtcap", "garrisoncap"]);

const pointsForBattle = (kills: number) => 2 + Math.min(2, Math.max(0, Math.floor(kills / 2)));

function rollItem(): string {
  const ids = Object.keys(ITEMS);
  const total = ids.reduce((s, id) => s + ITEMS[id].weight, 0);
  let r = Math.random() * total;
  for (const id of ids) {
    r -= ITEMS[id].weight;
    if (r <= 0) return id;
  }
  return ids[ids.length - 1];
}

// ------------------------------------------------------------------
// lib/medals.py — decorations
// ------------------------------------------------------------------

const MEDAL_NAMES: Record<string, string> = {
  cib: "Combat Infantryman Badge",
  cmb: "Combat Medical Badge",
  purple_heart: "Purple Heart",
  bronze_star: "Bronze Star",
  silver_star: "Silver Star",
  dsc: "Distinguished Service Cross",
  moh: "Medal of Honor",
};
const REPEATABLE = new Set(["purple_heart", "bronze_star", "silver_star"]);

interface BattleStats {
  kills: number; healed?: number; damage_taken?: number; heavy_kills?: number; officer_kills?: number;
}

function awardMedals(stats: BattleStats, unitType: string, survived: boolean, victory: boolean, soleSurvivor: boolean, existing: string[]): string[] {
  const got: string[] = [];
  const have = new Set(existing);
  const give = (code: string) => {
    if (REPEATABLE.has(code) || (!have.has(code) && !got.includes(code))) got.push(code);
  };
  const kills = stats.kills;
  if (survived && unitType !== "medic") give("cib");
  if (unitType === "medic" && (stats.healed ?? 0) >= 100) give("cmb");
  if ((stats.damage_taken ?? 0) >= 40 || !survived) give("purple_heart");
  if (kills >= 4 || (unitType === "medic" && (stats.healed ?? 0) >= 180)) give("bronze_star");
  if ((stats.heavy_kills ?? 0) >= 1 || (stats.officer_kills ?? 0) >= 1) give("silver_star");
  if (kills >= 8) give("dsc");
  if (kills >= 12 || (soleSurvivor && victory && survived)) give("moh");
  return got;
}

// ------------------------------------------------------------------
// lib/graves.py — graveyard layout
// ------------------------------------------------------------------

const GCOLS = 10;
const GX0 = 0.07, GDX = 0.093, GY0 = 0.28, GDY = 0.15;
const MIN_DX = 0.06, MIN_DY = 0.09;
const graveSlot = (i: number): [number, number] => [GX0 + (i % GCOLS) * GDX, GY0 + Math.floor(i / GCOLS) * GDY];

function assignGraves(entries: Dict[]): Record<string, [number, number]> {
  const placed: [number, number][] = entries
    .filter((e) => e.grave_x != null && e.grave_y != null)
    .map((e) => [Number(e.grave_x), Number(e.grave_y)]);
  const collides = (x: number, y: number) => placed.some(([px, py]) => Math.abs(x - px) < MIN_DX && Math.abs(y - py) < MIN_DY);
  const out: Record<string, [number, number]> = {};
  entries.forEach((e, i) => {
    if (e.grave_x != null && e.grave_y != null) return;
    let idx = i;
    let [x, y] = graveSlot(idx);
    while (collides(x, y)) {
      idx += 1;
      [x, y] = graveSlot(idx);
    }
    out[String(e.id)] = [x, y];
    placed.push([x, y]);
  });
  return out;
}

const DECOR_OFFSETS: Record<string, [number, number]> = {
  poppies: [-0.035, 0.012], roses: [0.035, 0.012], lilies: [-0.018, 0.026],
  wreath: [0.0, 0.03], candle: [0.02, 0.028], flag: [0.045, -0.018],
};
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function decorPosition(gx: number, gy: number, kind: string, sameKindCount: number): [number, number] {
  const [dx, dy] = DECOR_OFFSETS[kind] ?? [0.0, 0.02];
  const col = sameKindCount % 3;
  const row = Math.floor(sameKindCount / 3);
  return [
    clampN(gx + dx + (col - 1) * 0.016, 0.03, 0.97),
    clampN(gy + dy + row * 0.014, 0.16, 0.97),
  ];
}

// ------------------------------------------------------------------
// lib/state.py — the stored save: default state, seeding, shapes
// ------------------------------------------------------------------

const STATE_ID = "main";

interface SaveDoc {
  state: Dict;
  soldiers: Dict[];
  memorial: Dict[];
  decor: Dict[];
}

function defaultState(): Dict {
  return {
    id: STATE_ID,
    requisition: 300,
    mission_index: 0,
    battles_won: 0,
    battles_lost: 0,
    campaign_complete: false,
    commander_name: "Commander",
    career_wins: 0,
    reinforcements_used: 0,
    reinforcements_mission: null,
    inventory: {},
    filed_battles: [],
    last_battle: null,
  };
}

const INITIAL_SQUAD: [string, string, string, number, number, string, string][] = [
  ["Frank Hayes", "rifleman", "active", 7, 2, "Eagle Eye", "Duluth, MN"],
  ["Walter Kowalski", "rifleman", "active", 3, 1, "Farm Boy", "Hamtramck, MI"],
  ["James Baker", "rifleman", "active", 0, 0, "Brooklyn", "Erie, PA"],
  ["Chester Pruitt", "medic", "active", 1, 2, "Preacher", "Savannah, GA"],
  ["Raymond Boyd", "mg", "active", 6, 2, "Tough Bastard", "Amarillo, TX"],
  ["Earl Whitaker", "sniper", "reserve", 8, 3, "Dead Shot", "Bend, OR"],
  ["Leroy Novak", "rifleman", "reserve", 0, 0, "Quiet One", "Scranton, PA"],
];

const INITIAL_MEMORIAL: [string, string, number, number, string, string, string, string, string][] = [
  ["Dale Mercer", "mg", 11, 3, "MG42 fire", "OPERATION OVERLORD", "Omaha Beach, Normandy", "1944-06-06T00:00:00Z", "Bedford, VA"],
  ["Otis Crane", "rifleman", 5, 1, "Mortar bombardment", "OPERATION COBRA", "Saint-Lô, Normandy", "1944-07-25T00:00:00Z", "Butte, MT"],
];

function seedSquadInto(doc: SaveDoc): void {
  const existing = new Set(doc.soldiers.map((d) => d.name));
  for (const [name, unitType, status, kills, missions, quirk, hometown] of INITIAL_SQUAD) {
    if (existing.has(name)) continue;
    const rng = mulberry32(hashSeed(name));
    const soldier = makeSoldier(unitType, status);
    Object.assign(soldier, {
      name,
      kills,
      missions,
      xp: kills * XP_PER_KILL + missions * XP_PER_MISSION,
      quirk,
      hometown,
      portrait_seed: Math.floor(rng() * 2 ** 31),
      ...makeBackstory(name, hometown, quirk, rng),
    });
    doc.soldiers.push(soldier);
  }
}

function seedFoundingMemorial(doc: SaveDoc): void {
  INITIAL_MEMORIAL.forEach(([name, utype, kills, ops, cause, code, location, died, hometown], i) => {
    if (doc.memorial.some((d) => d.id === `founding-${i + 1}`)) return;
    const rng = mulberry32(hashSeed(name));
    const info = makeBackstory(name, hometown, "Pops", rng);
    doc.memorial.push({
      id: `founding-${i + 1}`,
      name,
      type: utype,
      rank: rankFor(ops),
      kills,
      missions_survived: ops,
      cause,
      mission_code: code,
      died_at: died,
      hometown,
      unit: info.unit,
      portrait_seed: Math.floor(rng() * 2 ** 31),
      story:
        `${info.backstory}\n\n${rankFor(ops)} ${name} was killed by ${causePhrase(cause)} ` +
        `during ${code} at ${location} — ${ops} operations behind him and ${kills} confirmed. ` +
        `His mother kept a blue star in the window until the telegram came.`,
      grave_x: 0.2 + 0.18 * i,
      grave_y: 0.35,
    });
  });
}

function freshSave(): SaveDoc {
  const doc: SaveDoc = { state: defaultState(), soldiers: [], memorial: [], decor: [] };
  seedSquadInto(doc);
  seedFoundingMemorial(doc);
  return doc;
}

// One JSON document per save slot, in the player's own browser.
function storeKey(): string {
  let id = "main";
  try {
    id = localStorage.getItem("vanguard-save-id") || "main";
  } catch { /* private mode: fall through with the default slot */ }
  return `vanguard-local-save::${id}`;
}

function loadRaw(): SaveDoc | null {
  try {
    const raw = localStorage.getItem(storeKey());
    return raw ? (JSON.parse(raw) as SaveDoc) : null;
  } catch {
    return null;
  }
}

function persist(doc: SaveDoc): void {
  try {
    localStorage.setItem(storeKey(), JSON.stringify(doc));
  } catch { /* storage full/blocked: the session still plays */ }
}

function ensureSave(): SaveDoc {
  let doc = loadRaw();
  if (!doc) {
    doc = freshSave();
    persist(doc);
  }
  return doc;
}

const careerWins = (state: Dict) => Number(state.career_wins ?? state.battles_won ?? 0);

function commanderInfo(state: Dict): Dict {
  const wins = careerWins(state);
  const level = commanderLevel(wins);
  const discount = Math.min(0.3, 0.05 * (level - 1));
  const winsToNext = level >= COMMANDER_RANKS.length ? 0 : level * WINS_PER_COMMANDER_LEVEL - wins;
  return {
    commander_name: (state.commander_name as string) || "Commander",
    commander_level: level,
    commander_rank: COMMANDER_RANKS[level - 1],
    commander_max_level: COMMANDER_RANKS.length,
    wins_to_next_level: winsToNext,
    max_squad: Math.min(8, 4 + level),
    hire_discount: Number(discount.toFixed(2)),
    combat_bonus: Number((0.04 * (level - 1)).toFixed(2)),
    hire_costs: Object.fromEntries(
      Object.entries(UNIT_COSTS).map(([k, v]) => [k, pyRound(v * (1 - discount))]),
    ),
  };
}

function stateOut(state: Dict): Dict {
  return {
    requisition: state.requisition,
    mission_index: state.mission_index,
    battles_won: state.battles_won,
    battles_lost: state.battles_lost,
    campaign_complete: state.campaign_complete,
    inventory: (state.inventory as Dict) ?? {},
    ...commanderInfo(state),
  };
}

function soldierOut(doc: Dict): Dict {
  const missions = Number(doc.missions ?? 0);
  return { ...doc, level: levelFor(missions), rank: rankFor(missions) };
}

function radiomanLevel(doc: SaveDoc): number {
  const levels = doc.soldiers
    .filter((d) => d.status === "active" && d.type === "radioman")
    .map((d) => levelFor(Number(d.missions ?? 0)));
  return levels.length ? Math.max(...levels) : 0;
}

function ensureGraves(doc: SaveDoc): void {
  const assignments = assignGraves(doc.memorial);
  for (const [id, [x, y]] of Object.entries(assignments)) {
    const entry = doc.memorial.find((d) => String(d.id) === id);
    if (entry) {
      entry.grave_x = x;
      entry.grave_y = y;
    }
  }
}

// ------------------------------------------------------------------
// routers — the endpoint surface, same rules and error text
// ------------------------------------------------------------------

interface BattleEntry extends BattleStats {
  soldier_id: string;
  cause?: string;
}

function battleComplete(doc: SaveDoc, input: Dict): Dict {
  const state = doc.state;
  const fallen = (input.fallen ?? []) as BattleEntry[];
  const deserted = (input.deserted ?? []) as BattleEntry[];
  const survivors = (input.survivors ?? []) as BattleEntry[];
  const victory = Boolean(input.victory);
  const lootRp = Number(input.loot_rp ?? 0);
  const lootItem = (input.loot_item as string | null) ?? null;

  // Idempotency, as the server: a filed battle_id (or an identical
  // report's fingerprint) returns the standing result untouched.
  let filingKey: string | null = (input.battle_id as string | null) ?? null;
  if (!filingKey) {
    const fp = {
      mission_id: input.mission_id,
      victory,
      duration_sec: Math.round(Number(input.duration_sec ?? 0) * 10) / 10,
      fallen: fallen.map((f) => [f.soldier_id, f.cause ?? "", f.kills]).sort(),
      deserted: deserted.map((f) => [f.soldier_id, f.cause ?? "", f.kills]).sort(),
      loot_rp: lootRp,
      loot_item: lootItem,
      survivors: survivors.map((s) => [s.soldier_id, s.kills]).sort(),
    };
    filingKey = `fp:${hashSeed(JSON.stringify(fp)).toString(16).padStart(8, "0")}`;
  }
  const filed = (state.filed_battles as string[]) ?? [];
  if (filed.includes(filingKey)) {
    return {
      requisition: state.requisition,
      mission_index: state.mission_index,
      campaign_complete: state.campaign_complete,
      memorial_names: [],
      promotions: [],
      medals_awarded: [],
      commander_promoted: false,
      commander_rank: COMMANDER_RANKS[commanderLevel(careerWins(state)) - 1],
      points_gained: {},
      items_gained: [],
      gear_lost: [],
    };
  }
  if (state.campaign_complete) err(409, "Campaign already complete");
  const mission = missionByIndex(Number(state.mission_index));
  if (!mission || mission.id !== input.mission_id) err(409, "That mission is not the current operation");
  const m = mission as MissionDef & { index: number };

  const now = nowIso();
  const memorialNames: string[] = [];
  const promotions: string[] = [];
  const medalsAwarded: string[] = [];
  const soleSurvivor = survivors.length === 1;
  const inventory: Record<string, number> = { ...((state.inventory as Record<string, number>) ?? {}) };
  const itemsGained: { item: string; source: string }[] = [];
  const gearLost: string[] = [];
  const pointsGained: Record<string, number> = {};

  const findSoldier = (id: string) => doc.soldiers.find((d) => String(d.id) === id);

  for (const f of fallen) {
    const sdoc = findSoldier(f.soldier_id);
    if (!sdoc) continue;
    const kills = Number(sdoc.kills ?? 0) + f.kills;
    const cause = f.cause || "Killed in action";
    const newMedals = awardMedals(f, String(sdoc.type), false, victory, false, (sdoc.medals as string[]) ?? []);
    for (const medal of newMedals) medalsAwarded.push(`${String(sdoc.name)} — ${MEDAL_NAMES[medal]} (posthumous)`);
    for (const item of (sdoc.equipment as string[]) ?? []) gearLost.push(item);
    if (!doc.memorial.some((d) => String(d.id) === String(sdoc.id))) {
      const entry: Dict = {
        id: sdoc.id,
        name: sdoc.name,
        type: sdoc.type,
        rank: rankFor(Number(sdoc.missions ?? 0)),
        kills,
        missions_survived: Number(sdoc.missions ?? 0),
        cause,
        mission_code: m.code,
        died_at: now,
        unit: sdoc.unit ?? "",
        hometown: sdoc.hometown ?? "",
        portrait_seed: sdoc.portrait_seed ?? 0,
        medals: [...((sdoc.medals as string[]) ?? []), ...newMedals],
        story: makeEpitaph(sdoc, cause, m.code, m.location, kills),
        grave_x: null,
        grave_y: null,
      };
      doc.memorial.push(entry);
      const [gx, gy] = Object.entries(assignGraves(doc.memorial)).find(([id]) => id === String(sdoc.id))?.[1] ?? graveSlot(doc.memorial.length - 1);
      entry.grave_x = gx;
      entry.grave_y = gy;
    }
    doc.soldiers = doc.soldiers.filter((d) => String(d.id) !== f.soldier_id);
    memorialNames.push(String(sdoc.name));
  }

  for (const g of deserted) {
    const sdoc = findSoldier(g.soldier_id);
    if (!sdoc) continue;
    for (const item of (sdoc.equipment as string[]) ?? []) gearLost.push(item);
    doc.soldiers = doc.soldiers.filter((d) => String(d.id) !== g.soldier_id);
  }

  for (const s of survivors) {
    const sdoc = findSoldier(s.soldier_id);
    if (!sdoc || sdoc.status !== "active") continue;
    const before = rankFor(Number(sdoc.missions ?? 0));
    const addMission = victory ? 1 : 0;
    const after = rankFor(Number(sdoc.missions ?? 0) + addMission);
    const gained = pointsForBattle(s.kills);
    pointsGained[s.soldier_id] = gained;
    const newMedals = awardMedals(s, String(sdoc.type), true, victory, soleSurvivor, (sdoc.medals as string[]) ?? []);
    sdoc.kills = Number(sdoc.kills ?? 0) + s.kills;
    sdoc.xp = Number(sdoc.xp ?? 0) + s.kills * XP_PER_KILL + (victory ? XP_PER_MISSION : 0);
    sdoc.missions = Number(sdoc.missions ?? 0) + addMission;
    sdoc.points = Number(sdoc.points ?? 0) + gained;
    if (newMedals.length) sdoc.medals = [...((sdoc.medals as string[]) ?? []), ...newMedals];
    for (const medal of newMedals) medalsAwarded.push(`${String(sdoc.name)} — ${MEDAL_NAMES[medal]}`);
    if (after !== before) promotions.push(`${String(sdoc.name)}: ${before} → ${after}`);
  }

  if (lootItem && lootItem in ITEMS) {
    inventory[lootItem] = (inventory[lootItem] ?? 0) + 1;
    itemsGained.push({ item: lootItem, source: "loot" });
  }
  if (victory) {
    const awarded = rollItem();
    inventory[awarded] = (inventory[awarded] ?? 0) + 1;
    itemsGained.push({ item: awarded, source: "mission" });
  }

  const oldLevel = commanderLevel(careerWins(state));
  const newLevel = commanderLevel(careerWins(state) + (victory ? 1 : 0));
  const totalKills =
    fallen.reduce((s, f) => s + f.kills, 0) +
    deserted.reduce((s, f) => s + f.kills, 0) +
    survivors.reduce((s, sv) => s + sv.kills, 0);
  const reward = battleReward(m.reward, victory, totalKills, lootRp);

  let missionIndex = Number(state.mission_index);
  let campaignComplete = Boolean(state.campaign_complete);
  if (victory) {
    missionIndex = Math.min(missionIndex + 1, MISSIONS.length);
    campaignComplete = missionIndex >= MISSIONS.length;
  }
  state.mission_index = missionIndex;
  state.campaign_complete = campaignComplete;
  state.career_wins = careerWins(state) + (victory ? 1 : 0);
  state.reinforcements_used = 0;
  state.reinforcements_mission = null;
  state.inventory = inventory;
  state.last_battle = {
    mission_code: m.code,
    victory,
    fallen: memorialNames,
    survivors: survivors.length,
    at: now,
  };
  state.requisition = Number(state.requisition) + reward;
  state.battles_won = Number(state.battles_won) + (victory ? 1 : 0);
  state.battles_lost = Number(state.battles_lost) + (victory ? 0 : 1);
  (state.filed_battles as string[]).push(filingKey);
  persist(doc);

  return {
    requisition: state.requisition,
    mission_index: missionIndex,
    campaign_complete: campaignComplete,
    memorial_names: memorialNames,
    promotions,
    medals_awarded: medalsAwarded,
    commander_promoted: newLevel > oldLevel,
    commander_rank: COMMANDER_RANKS[newLevel - 1],
    points_gained: pointsGained,
    items_gained: itemsGained,
    gear_lost: gearLost,
  };
}

const REINFORCEMENT_COST: Record<string, number> = { rifle: 15, heavy: 25 };
const MAX_REINFORCEMENTS = 3;
const MAX_DECOR = 300;

/**
 * The api seam's local half: same paths, same payloads, same
 * error text as the FastAPI backend. Throws ApiError exactly
 * where the server would answer with that status.
 */
export async function localRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const input = (body ?? {}) as Dict;
  const seg = path.split("/").filter(Boolean);

  // ---- campaign / state ----
  if (method === "GET" && path === "/state") {
    return stateOut(ensureSave().state) as T;
  }
  if (method === "PUT" && path === "/state/commander") {
    const doc = ensureSave();
    doc.state.commander_name = String(input.name ?? "").trim();
    persist(doc);
    return stateOut(doc.state) as T;
  }
  if (method === "GET" && path === "/save/summary") {
    const doc = loadRaw();
    if (!doc) return { exists: false } as T;
    const st = doc.state;
    const m = missionByIndex(Number(st.mission_index));
    return {
      exists: true,
      mission_code: st.campaign_complete || !m ? null : m.code,
      mission_index: st.mission_index,
      campaign_complete: Boolean(st.campaign_complete),
      requisition: st.requisition,
      squad_size: doc.soldiers.filter((d) => d.status === "active").length,
      fallen: doc.memorial.length,
      last_battle: st.last_battle ?? null,
    } as T;
  }
  if (method === "GET" && path === "/missions") {
    return missionList() as T;
  }
  if (method === "POST" && path === "/campaign/wipe") {
    if (input.confirm !== "RESET") err(400, "Type RESET to confirm");
    const doc: SaveDoc = { state: defaultState(), soldiers: [], memorial: [], decor: [] };
    seedSquadInto(doc);
    persist(doc);
    return stateOut(doc.state) as T;
  }
  if (method === "POST" && path === "/campaign/reset") {
    const doc = ensureSave();
    const st = doc.state;
    st.last_battle = null;
    st.requisition = 300;
    st.mission_index = 0;
    st.battles_won = 0;
    st.battles_lost = 0;
    st.campaign_complete = false;
    st.career_wins = careerWins(st);
    st.filed_battles = [];
    st.reinforcements_used = 0;
    st.reinforcements_mission = null;
    if (doc.soldiers.length === 0) seedSquadInto(doc);
    persist(doc);
    return stateOut(st) as T;
  }

  // ---- squad ----
  if (method === "GET" && path === "/squad") {
    const doc = ensureSave();
    const docs = [...doc.soldiers].sort((a, b) => {
      const rank = (d: Dict) => (d.status === "active" ? 0 : 1);
      return rank(a) - rank(b) || String(a.hired_at ?? "").localeCompare(String(b.hired_at ?? ""));
    });
    return docs.map(soldierOut) as T;
  }
  if (method === "POST" && path === "/squad/hire") {
    const doc = ensureSave();
    const info = commanderInfo(doc.state);
    const roster = doc.soldiers.length;
    const cost = roster === 0 ? 0 : Number((info.hire_costs as Record<string, number>)[String(input.type)] ?? 0);
    if (Number(doc.state.requisition) < cost) err(402, "Insufficient requisition points");
    const active = doc.soldiers.filter((d) => d.status === "active").length;
    const soldier = makeSoldier(String(input.type), active < Number(info.max_squad) ? "active" : "reserve");
    doc.soldiers.push(soldier);
    if (cost) doc.state.requisition = Number(doc.state.requisition) - cost;
    persist(doc);
    return soldierOut(soldier) as T;
  }
  if (method === "POST" && seg[0] === "squad" && seg[2] === "status") {
    const doc = ensureSave();
    const soldier = doc.soldiers.find((d) => String(d.id) === seg[1]);
    if (!soldier) err(404, "Soldier not found");
    if (input.status === "active" && soldier.status !== "active") {
      const info = commanderInfo(doc.state);
      const active = doc.soldiers.filter((d) => d.status === "active").length;
      if (active >= Number(info.max_squad)) {
        err(409, `Deployment squad is full (${String(info.max_squad)} men max at your rank) — send someone to reserve first`);
      }
    }
    soldier.status = input.status;
    persist(doc);
    return soldierOut(soldier) as T;
  }
  if (method === "POST" && path === "/squad/upgrade") {
    const doc = ensureSave();
    const soldier = doc.soldiers.find((d) => String(d.id) === String(input.soldier_id));
    if (!soldier) err(404, "Soldier not found");
    if (!UPGRADE_TRACKS.includes(String(input.track))) err(400, "Unknown upgrade track");
    const upgrades: Record<string, number> = { ...((soldier.upgrades as Record<string, number>) ?? {}) };
    const level = upgrades[String(input.track)] ?? 0;
    if (level >= UPGRADE_CAP) err(400, "That upgrade is already at its cap");
    if (Number(soldier.points ?? 0) < UPGRADE_COST) err(402, "Not enough upgrade points — he earns them by surviving battles");
    upgrades[String(input.track)] = level + 1;
    soldier.points = Number(soldier.points ?? 0) - UPGRADE_COST;
    soldier.upgrades = upgrades;
    persist(doc);
    return soldierOut(soldier) as T;
  }
  if (method === "POST" && (path === "/squad/equip" || path === "/squad/unequip")) {
    const doc = ensureSave();
    const item = String(input.item);
    const soldier = doc.soldiers.find((d) => String(d.id) === String(input.soldier_id));
    if (path === "/squad/equip") {
      if (!(item in ITEMS)) err(400, "Unknown item");
      if (!soldier) err(404, "Soldier not found");
      const restrict = ITEMS[item].restrict;
      if (restrict && !restrict.includes(String(soldier.type))) {
        err(400, `Only ${restrict.join(" / ")} can carry that`);
      }
      const equipment: string[] = [...((soldier.equipment as string[]) ?? [])];
      if (equipment.includes(item)) err(400, "He already carries one");
      if (GUNS.has(item) && equipment.some((x) => GUNS.has(x))) err(400, "He already carries a gun. One weapon at a time.");
      if (HEADGEAR.has(item) && equipment.some((x) => HEADGEAR.has(x))) err(400, "He already wears headgear. One head, one cover.");
      if (equipment.length >= EQUIP_SLOTS) err(400, "Both of his slots are full");
      const inventory: Record<string, number> = { ...((doc.state.inventory as Record<string, number>) ?? {}) };
      if ((inventory[item] ?? 0) < 1) err(400, "None in stores");
      inventory[item] -= 1;
      equipment.push(item);
      doc.state.inventory = inventory;
      soldier.equipment = equipment;
      persist(doc);
      return soldierOut(soldier) as T;
    }
    if (!soldier) err(404, "Soldier not found");
    const equipment: string[] = [...((soldier.equipment as string[]) ?? [])];
    if (!equipment.includes(item)) err(400, "He is not carrying that");
    soldier.equipment = equipment.filter((x) => x !== item);
    const inventory: Record<string, number> = { ...((doc.state.inventory as Record<string, number>) ?? {}) };
    inventory[item] = (inventory[item] ?? 0) + 1;
    doc.state.inventory = inventory;
    persist(doc);
    return soldierOut(soldier) as T;
  }
  if (method === "POST" && path === "/inventory/buy") {
    const doc = ensureSave();
    const item = String(input.item);
    if (!(item in ITEMS)) err(400, "Unknown item");
    if (GUNS.has(item)) err(400, "Guns are found on the battlefield, not sold.");
    const price = ITEMS[item].price;
    if (Number(doc.state.requisition) < price) err(402, "Insufficient requisition points");
    const inventory: Record<string, number> = { ...((doc.state.inventory as Record<string, number>) ?? {}) };
    inventory[item] = (inventory[item] ?? 0) + 1;
    doc.state.inventory = inventory;
    doc.state.requisition = Number(doc.state.requisition) - price;
    persist(doc);
    return stateOut(doc.state) as T;
  }

  // ---- battle economy ----
  if (method === "POST" && (path === "/battle/reinforce" || path === "/battle/radio-support")) {
    const doc = ensureSave();
    const state = doc.state;
    const isReinforce = path === "/battle/reinforce";
    if (!isReinforce && !(String(input.kind) in RADIO_SUPPORT_COST)) err(422, "Unknown radio support call");
    const mission = missionByIndex(Number(state.mission_index));
    if (state.campaign_complete || !mission || mission.id !== input.mission_id) {
      err(409, "That mission is not the current operation");
    }
    const level = radiomanLevel(doc);
    if (level === 0 && !doc.soldiers.some((d) => d.status === "active" && d.type === "radioman")) {
      err(409, "Radio is down — no radioman in the squad");
    }
    if (isReinforce) {
      const used = state.reinforcements_mission === input.mission_id ? Number(state.reinforcements_used ?? 0) : 0;
      if (used >= MAX_REINFORCEMENTS) err(409, "No reinforcements left for this operation (max 3)");
      const cost = radioCost(REINFORCEMENT_COST[String(input.kind)], level);
      if (Number(state.requisition) < cost) err(402, "Insufficient requisition points");
      state.requisition = Number(state.requisition) - cost;
      state.reinforcements_used = used + 1;
      state.reinforcements_mission = input.mission_id;
      persist(doc);
      return { kind: input.kind, cost, requisition: state.requisition } as T;
    }
    const cost = radioCost(RADIO_SUPPORT_COST[String(input.kind)], level);
    if (Number(state.requisition) < cost) err(402, "Insufficient requisition points");
    state.requisition = Number(state.requisition) - cost;
    persist(doc);
    return { kind: input.kind, cost, requisition: state.requisition } as T;
  }
  if (method === "POST" && path === "/battle/complete") {
    const doc = ensureSave();
    return battleComplete(doc, input) as T;
  }

  // ---- memorial + graveyard ----
  if (method === "GET" && path === "/memorial") {
    const doc = ensureSave();
    ensureGraves(doc);
    persist(doc);
    const docs = [...doc.memorial].sort((a, b) => String(b.died_at ?? "").localeCompare(String(a.died_at ?? "")));
    return docs as T;
  }
  if (method === "GET" && path === "/graveyard/decor") {
    return ensureSave().decor.slice(0, MAX_DECOR) as T;
  }
  if (method === "POST" && path === "/graveyard/decor") {
    const doc = ensureSave();
    if (doc.decor.length >= MAX_DECOR) err(409, `The graveyard holds at most ${MAX_DECOR} tributes`);
    ensureGraves(doc);
    const entry = doc.memorial.find((d) => String(d.id) === String(input.entry_id));
    if (!entry) err(404, "Memorial entry not found");
    const sameKind = doc.decor.filter((d) => d.entry_id === input.entry_id && d.kind === input.kind).length;
    const [x, y] = decorPosition(Number(entry.grave_x), Number(entry.grave_y), String(input.kind), sameKind);
    const decor = {
      id: bigId(Math.random),
      kind: input.kind,
      x,
      y,
      entry_id: input.entry_id,
    };
    doc.decor.push(decor);
    persist(doc);
    return decor as T;
  }
  if (seg[0] === "graveyard" && seg[1] === "decor" && seg[2]) {
    const doc = ensureSave();
    const decor = doc.decor.find((d) => String(d.id) === seg[2]);
    if (method === "PUT") {
      if (!decor) err(404, "Tribute not found");
      decor.x = input.x;
      decor.y = input.y;
      persist(doc);
      return decor as T;
    }
    if (method === "DELETE") {
      if (!decor) err(404, "Tribute not found");
      doc.decor = doc.decor.filter((d) => String(d.id) !== seg[2]);
      persist(doc);
      return undefined as T;
    }
  }

  // ---- session ----
  if (method === "POST" && path === "/auth/logout") {
    return {} as T;
  }

  err(404, "Not found");
}
