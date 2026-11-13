// Chunky 16-bit soldier sprites, painted procedurally pixel by pixel and cached.
// Muddy palette to match the dossier portraits. Facing right; flipped copies are cached too.
//
// Grid: 16 x 14 sprite pixels, feet anchored at (FEET_X, 13). One sprite pixel = one
// backing-canvas pixel = PX world units (see engine.ts).

export const SPR_W = 16;
export const SPR_H = 14;
export const FEET_X = 5;

export type Pose = "stand" | "walkA" | "walkB" | "shoot" | "crouch" | "hit" | "kneel" | "dead" | "prone" | "proneA" | "proneB";
export type Weapon = "rifle" | "smg" | "mg" | "sniper" | "bazooka" | "panzerfaust" | "pistol" | "mortar" | "flak" | "none" | "thompson" | "springfield" | "mp40" | "carbine" | "trench" | "bar" | "fg42";
export type Head = "us" | "us-medic" | "stahl" | "para" | "cap" | "officer" | "us-net" | "us-para" | "us-jeep" | "us-pile" | "us-hbt";

export interface Palette {
  helmet: string;
  helmetHi: string;
  uni: string;
  uniDark: string;
  pants: string;
  pantsDark: string;
  boots: string;
  gear: string;
  camo?: string[];
  band?: string;
}

const SKIN = "#C99A72";
const SKIN_D = "#93664A";
const METAL = "#24221D";
const METAL_HI = "#4A4740";
const WOOD = "#6B4A2A";
const OUTLINE = [16, 14, 10];

export const PAL: Record<string, Palette> = {
  us: { helmet: "#4B5430", helmetHi: "#68723F", uni: "#5E6539", uniDark: "#41472A", pants: "#6F6844", pantsDark: "#514B30", boots: "#2E2417", gear: "#8A7A4E" },
  usNpc: { helmet: "#4E5636", helmetHi: "#6D7548", uni: "#646A44", uniDark: "#474C31", pants: "#78714D", pantsDark: "#595337", boots: "#2E2417", gear: "#9A8A5A" },
  wehr: { helmet: "#474D44", helmetHi: "#626A5D", uni: "#5F675A", uniDark: "#424840", pants: "#535A4D", pantsDark: "#3D4239", boots: "#1E1C18", gear: "#3A3226" },
  volks: { helmet: "#3E3A32", helmetHi: "#57514A", uni: "#5E4B36", uniDark: "#463726", pants: "#4A4136", pantsDark: "#383128", boots: "#221D16", gear: "#2E261C", band: "#8A3A2E" },
  para: { helmet: "#4C4F46", helmetHi: "#666A5E", uni: "#6E6A48", uniDark: "#555233", pants: "#5A5A4A", pantsDark: "#454538", boots: "#1E1C18", gear: "#3A3226", camo: ["#4A5234", "#7D6A4A", "#3E4430"] },
  sniperDe: { helmet: "#3F4834", helmetHi: "#566146", uni: "#4F5A3A", uniDark: "#3A4329", pants: "#4A503C", pantsDark: "#383D2D", boots: "#1E1C18", gear: "#2E2A1E", camo: ["#36402A", "#6A6440", "#2C3322"] },
  officer: { helmet: "#4F554A", helmetHi: "#6A7262", uni: "#4C5247", uniDark: "#363B33", pants: "#3F443B", pantsDark: "#2F332C", boots: "#121110", gear: "#2A2218" },
};

type Px = (x: number, y: number, c: string) => void;

function paint(px: Px, pal: Palette, pose: Pose, weapon: Weapon, head: Head) {
  if (pose === "prone" || pose === "proneA" || pose === "proneB") {
    // Flat on his belly, head up on his elbows, weapon aimed
    // forward. Same horizontal layout as the dead pose, but
    // alive: helmet high, face up, arms under the gun.
    // proneA / proneB are the crawl cycle (Josh, 2026-11-12):
    // the legs scissor and an arm reaches, alternating, so a
    // crawling man visibly pulls himself along. "prone" is
    // the still pose: holding, or firing from the ground.
    const crawl = pose === "proneA" ? 1 : pose === "proneB" ? 2 : 0;
    if (crawl === 1) {
      // Rear leg bent up, toe dug in to push; front leg flat.
      px(0, 9, pal.boots);
      px(1, 9, pal.boots);
      px(0, 10, pal.pantsDark);
      px(1, 10, pal.pants);
      for (let x = 2; x <= 5; x++) {
        px(x, 10, pal.pants);
        px(x, 11, pal.pantsDark);
      }
    } else if (crawl === 2) {
      // Front leg bent under him; rear leg flat.
      for (let x = 0; x <= 3; x++) {
        px(x, 10, pal.pants);
        px(x, 11, pal.pantsDark);
      }
      px(4, 9, pal.boots);
      px(5, 9, pal.boots);
      px(4, 10, pal.pants);
      px(5, 10, pal.pantsDark);
    } else {
      for (let x = 0; x <= 1; x++) {
        px(x, 10, pal.boots);
        px(x, 11, pal.boots);
      }
      for (let x = 1; x <= 5; x++) {
        px(x, 10, pal.pants);
        px(x, 11, pal.pantsDark);
      }
    }
    for (let x = 5; x <= 10; x++) {
      for (let y = 9; y <= 11; y++) {
        let c = y === 11 ? pal.uniDark : pal.uni;
        if (pal.camo && (x * 7 + y * 3) % 4 === 0) c = pal.camo[(x + y) % pal.camo.length];
        px(x, y, c);
      }
    }
    px(7, 10, pal.gear); // pack strap across the back
    px(10, 10, pal.uni); // elbows on the ground
    px(11, 10, pal.uni);
    if (crawl === 1) px(11, 11, SKIN_D); // hand reached out ahead, pulling
    if (crawl === 2) px(9, 11, SKIN_D); // hand planted under the chest, pushing
    // Head raised at the front.
    for (let x = 11; x <= 13; x++) px(x, 6, pal.helmetHi);
    for (let x = 11; x <= 13; x++) px(x, 7, pal.helmet);
    for (let x = 10; x <= 13; x++) px(x, 8, pal.helmet); // brim
    px(12, 8, SKIN);
    px(13, 8, SKIN);
    px(12, 9, SKIN_D);
    px(13, 9, SKIN);
    if (head === "us-medic") {
      px(12, 6, "#D8D6C8");
      px(12, 7, "#A0302A");
    }
    // Earned headgear, prone (Barracks update): wool and HBT
    // caps ride in cap tones, the pile cap keeps its flaps, the
    // netted helmet keeps its scrim ticks.
    if (head === "us-jeep" || head === "us-pile" || head === "us-hbt") {
      const capTone = head === "us-hbt" ? "#6A7050" : head === "us-pile" ? "#6B6C52" : "#565840";
      for (let x = 11; x <= 13; x++) { px(x, 6, capTone); px(x, 7, capTone); px(x, 8, capTone); }
      if (head === "us-pile") { px(10, 8, "#4C4E38"); px(10, 9, "#4C4E38"); }
    }
    if (head === "us-net") { px(11, 6, pal.uniDark); px(13, 7, pal.uniDark); px(10, 8, "#4A5232"); }
    if (head === "us-para") { px(10, 8, "#2E2A20"); px(10, 9, "#2E2A20"); }
    // The weapon, aimed forward along the ground.
    if (weapon === "rifle") {
      for (let x = 11; x <= 15; x++) px(x, 9, x <= 12 ? WOOD : METAL);
    } else if (weapon === "mg") {
      for (let x = 11; x <= 15; x++) px(x, 9, METAL);
      px(14, 10, METAL); // bipod leg
      px(15, 9, METAL_HI);
    } else if (weapon === "sniper") {
      for (let x = 11; x <= 15; x++) px(x, 9, METAL);
      px(13, 8, METAL); // scope
    } else if (weapon === "thompson") {
      for (let x = 11; x <= 14; x++) px(x, 9, METAL);
      px(12, 10, METAL); // the drum, flat against the ground
    } else if (weapon === "springfield") {
      for (let x = 11; x <= 15; x++) px(x, 9, METAL);
      px(13, 8, METAL); // scope
    } else if (weapon === "mp40") {
      for (let x = 11; x <= 14; x++) px(x, 9, "#2A2A26");
      px(12, 10, "#2A2A26"); // stick magazine
    } else if (weapon === "carbine") {
      for (let x = 11; x <= 14; x++) px(x, 9, x <= 12 ? WOOD : METAL);
      px(12, 10, METAL);
    } else if (weapon === "trench") {
      for (let x = 11; x <= 13; x++) { px(x, 9, METAL); px(x, 10, "#3E3E38"); }
    } else if (weapon === "bar") {
      for (let x = 11; x <= 15; x++) px(x, 9, METAL);
      px(12, 8, "#24231E"); // top magazine
      px(14, 10, METAL); // bipod leg
    } else if (weapon === "fg42") {
      for (let x = 11; x <= 15; x++) px(x, 9, "#33322C");
      px(12, 10, "#24231E"); // side magazine
    } else if (weapon === "bazooka") {
      for (let x = 10; x <= 14; x++) {
        px(x, 8, "#4A5234");
        px(x, 9, "#3E4A34");
      }
    } else if (weapon === "smg" || weapon === "pistol") {
      for (let x = 11; x <= 13; x++) px(x, 9, METAL);
    }
    return;
  }
  if (pose === "dead") {
    // Lying on his side, weapon dropped.
    for (let x = 0; x <= 2; x++) for (let y = 9; y <= 11; y++) px(x, y, y === 9 ? pal.helmetHi : pal.helmet);
    px(3, 10, SKIN);
    px(3, 11, SKIN_D);
    for (let x = 3; x <= 7; x++) for (let y = 9; y <= 11; y++) px(x + (x === 3 ? 1 : 0), y, y === 11 ? pal.uniDark : pal.uni);
    px(5, 10, pal.gear);
    for (let x = 8; x <= 11; x++) {
      px(x, 10, pal.pants);
      px(x, 11, pal.pantsDark);
    }
    px(12, 10, pal.boots);
    px(12, 11, pal.boots);
    if (weapon !== "none" && weapon !== "flak" && weapon !== "mortar") for (let x = 2; x <= 8; x++) px(x, 13, x < 4 ? WOOD : METAL);
    return;
  }

  const crouch = pose === "crouch" || pose === "kneel";
  const dy = crouch ? 3 : 0; // upper body drops when crouched
  const dx = pose === "shoot" ? -1 : pose === "hit" ? -1 : 0; // recoil / knocked back
  const hx = pose === "hit" ? -1 : 0;

  // --- legs & boots
  const leg = (pts: Array<[number, number]>, c: string) => pts.forEach(([x, y]) => px(x, y, c));
  if (crouch) {
    leg([[2, 12], [3, 12], [4, 12], [5, 12], [5, 11], [6, 11]], pal.pantsDark); // shin on ground
    leg([[6, 10 + 0], [7, 10], [7, 11], [7, 12]], pal.pants); // front thigh + shin
    px(1, 12, pal.boots);
    px(7, 13, pal.boots);
    px(8, 13, pal.boots);
    px(1, 13, pal.boots);
  } else if (pose === "walkA" || pose === "walkB") {
    const fwd: Array<[number, number]> = [[5, 10], [6, 10], [6, 11], [7, 11], [7, 12], [8, 12]];
    const back: Array<[number, number]> = [[3, 10], [4, 10], [3, 11], [2, 11], [2, 12], [1, 12]];
    leg(pose === "walkA" ? back : fwd, pal.pantsDark);
    leg(pose === "walkA" ? fwd : back, pal.pants);
    for (const [x] of [[7], [8], [9]]) px(x, 13, pal.boots);
    for (const [x] of [[0], [1], [2]]) px(x, 13, pal.boots);
  } else {
    leg([[3, 10], [4, 10], [3, 11], [4, 11], [3, 12], [4, 12]], pal.pantsDark);
    leg([[5, 10], [6, 10], [5, 11], [6, 11], [5, 12], [6, 12]], pal.pants);
    for (const x of [3, 4, 5, 6, 7]) px(x, 13, pal.boots);
  }

  // --- torso
  for (let y = 6; y <= 9; y++) {
    for (let x = 3; x <= 6; x++) {
      let c = x === 3 ? pal.uniDark : pal.uni;
      if (pal.camo && (x * 7 + y * 3) % 4 === 0) c = pal.camo[(x + y) % pal.camo.length];
      px(x + dx, y + dy, c);
    }
  }
  for (let x = 3; x <= 6; x++) px(x + dx, 9 + dy, pal.gear); // belt
  px(5 + dx, 6 + dy, pal.gear); // webbing strap
  px(4 + dx, 7 + dy, pal.gear);
  if (pal.band) px(3 + dx, 7 + dy, pal.band);
  if (head === "us-medic") {
    px(3 + dx, 7 + dy, "#D8D6C8");
    px(3 + dx, 6 + dy, "#D8D6C8");
  }

  // --- head
  const H = (x: number, y: number, c: string) => px(x + dx + hx, y + dy, c);
  H(4, 4, SKIN);
  H(5, 4, SKIN);
  H(6, 4, SKIN);
  H(4, 5, SKIN_D);
  H(5, 5, SKIN);
  H(6, 4, SKIN);
  H(6, 4, "#2A1E16"); // eye
  H(7, 4, SKIN);
  if (head === "us-jeep" || head === "us-pile" || head === "us-hbt") {
    // Earned caps (Barracks update): the wool jeep cap, the
    // pile cap with its ear flaps, the herringbone fatigue cap.
    // No steel dome — the man chose comfort or work over cover.
    const dome = head === "us-hbt" ? "#6A7050" : head === "us-pile" ? "#6B6C52" : "#565840";
    const cuff = head === "us-hbt" ? "#59603F" : "#484A36";
    for (let x = 3; x <= 7; x++) H(x, 1, dome);
    for (let x = 3; x <= 7; x++) H(x, 2, dome);
    for (let x = 2; x <= 8; x++) H(x, 3, cuff);
    if (head === "us-hbt") { H(7, 3, "#121110"); H(8, 3, "#121110"); } // short brim
    if (head === "us-pile") {
      H(2, 4, "#4C4E38"); H(2, 5, "#4C4E38"); // ear flap, near side
      H(8, 4, "#4C4E38"); H(8, 5, "#4C4E38"); // ear flap, far side
    }
    if (head === "us-jeep") H(5, 1, "#6A6B4E"); // knit fold catching light
  } else if (head === "cap" || head === "officer") {
    for (let x = 3; x <= 6; x++) H(x, 2, pal.helmet);
    for (let x = 3; x <= 6; x++) H(x, 1, x === 5 ? pal.helmetHi : pal.helmet);
    H(4, 0, pal.helmet);
    H(5, 0, pal.helmet);
    H(6, 3, "#121110");
    H(7, 3, "#121110"); // visor
    for (let x = 3; x <= 5; x++) H(x, 3, pal.helmet);
    if (head === "officer") H(5, 1, "#C9A227");
  } else {
    for (let x = 4; x <= 6; x++) H(x, 1, pal.helmetHi);
    for (let x = 3; x <= 7; x++) H(x, 2, pal.helmet);
    const brim = head === "us" || head === "us-medic" ? [2, 3, 4, 5, 6, 7, 8] : [3, 4, 5, 6, 7];
    for (const x of brim) H(x, 3, head === "para" ? pal.helmet : pal.uniDark === pal.helmet ? pal.helmet : pal.helmet);
    H(brim[0], 3, pal.uniDark);
    if (head === "stahl") {
      H(3, 4, pal.helmet); // coal-scuttle neck guard
      H(2, 4, pal.helmet);
    }
    if (head === "para") H(3, 4, pal.helmet);
    if (head === "us-medic") {
      H(5, 1, "#D8D6C8");
      H(4, 2, "#D8D6C8");
      H(5, 2, "#A0302A");
      H(6, 2, "#D8D6C8");
    }
    if (head === "us-net") {
      // Netting over the dome and scrim strips at the brim:
      // the veteran's broken outline.
      H(4, 1, pal.uniDark);
      H(6, 1, pal.uniDark);
      H(5, 2, pal.uniDark);
      H(3, 4, "#4A5232");
      H(7, 4, "#6B5A34");
      H(4, 4, "#55603A");
    }
    if (head === "us-para") {
      // The M1C worn tight: chin straps down both sides and a
      // darker band where the cup grips.
      H(2, 4, "#2E2A20");
      H(8, 4, "#2E2A20");
      H(2, 5, "#2E2A20");
      H(8, 5, "#2E2A20");
      H(4, 1, pal.uniDark);
      H(6, 1, pal.uniDark);
    }
  }

  // --- weapon + arms
  const W = (x: number, y: number, c: string) => px(x + dx, y + dy, c);
  const aimed = pose === "shoot" || crouch;
  const wy = pose === "hit" ? 4 : aimed ? 6 : 7;
  const arm = () => {
    W(6, wy === 7 ? 7 : 6, pal.uni);
    W(7, wy === 7 ? 7 : 6, pal.uni);
    W(8, wy, SKIN);
  };
  switch (weapon) {
    case "rifle":
      for (let x = 7; x <= 12; x++) W(x, wy, x === 12 ? METAL_HI : METAL);
      W(4, wy + 1, WOOD);
      W(5, wy + 1, WOOD);
      W(6, wy + 1, WOOD);
      arm();
      break;
    case "smg":
      for (let x = 7; x <= 10; x++) W(x, wy, METAL);
      W(8, wy + 1, METAL);
      W(8, wy + 2, METAL);
      arm();
      break;
    case "mg":
      for (let x = 6; x <= 13; x++) {
        W(x, wy, METAL);
        if (x < 11) W(x, wy + 1, x < 8 ? WOOD : METAL);
      }
      W(12, wy + 1, METAL_HI);
      W(9, wy - 1, METAL_HI); // feed cover
      arm();
      break;
    case "sniper":
      for (let x = 7; x <= 14; x++) W(x, wy, METAL);
      W(8, wy - 1, METAL_HI);
      W(9, wy - 1, METAL_HI);
      W(10, wy - 1, METAL_HI);
      W(4, wy + 1, WOOD);
      W(5, wy + 1, WOOD);
      W(6, wy + 1, WOOD);
      arm();
      break;
    case "thompson":
      for (let x = 7; x <= 11; x++) W(x, wy, METAL);
      W(11, wy, METAL_HI);
      W(9, wy + 1, "#24231E"); // the drum
      W(10, wy + 1, "#24231E");
      W(9, wy + 2, "#24231E");
      W(10, wy + 2, "#24231E");
      W(5, wy + 1, WOOD); // pistol grip and stock
      W(6, wy + 1, WOOD);
      arm();
      break;
    case "springfield":
      for (let x = 7; x <= 15; x++) W(x, wy, METAL);
      W(8, wy - 1, METAL_HI); // the scope
      W(9, wy - 1, "#D8E4E0");
      W(10, wy - 1, METAL_HI);
      W(4, wy + 1, WOOD);
      W(5, wy + 1, WOOD);
      W(6, wy + 1, WOOD);
      arm();
      break;
    case "mp40":
      for (let x = 7; x <= 11; x++) W(x, wy, "#2A2A26");
      W(8, wy + 1, "#2A2A26"); // stick magazine
      W(8, wy + 2, "#2A2A26");
      W(5, wy, METAL); // folded stock
      W(6, wy + 1, "#2A2A26");
      arm();
      break;
    case "carbine":
      for (let x = 7; x <= 11; x++) W(x, wy, x <= 8 ? WOOD : METAL);
      W(9, wy + 1, METAL); // the slim 15-round magazine
      W(5, wy + 1, WOOD);
      W(6, wy + 1, WOOD);
      arm();
      break;
    case "trench":
      for (let x = 7; x <= 10; x++) { W(x, wy, METAL); W(x, wy + 1, "#3E3E38"); } // fat barrel and heat shield
      W(8, wy + 2, WOOD); // the pump
      W(5, wy, WOOD);
      W(6, wy, WOOD);
      arm();
      break;
    case "bar":
      for (let x = 6; x <= 15; x++) W(x, wy, x <= 8 ? WOOD : METAL);
      W(15, wy, METAL_HI);
      W(9, wy - 1, "#24231E"); // the top magazine
      W(10, wy - 1, "#24231E");
      W(13, wy + 1, METAL); // bipod leg folded down
      arm();
      break;
    case "fg42":
      for (let x = 6; x <= 14; x++) W(x, wy, "#33322C");
      W(14, wy, METAL_HI); // muzzle brake
      W(9, wy + 1, "#24231E"); // side magazine, angled down
      W(9, wy + 2, "#24231E");
      W(5, wy, WOOD);
      arm();
      break;
    case "bazooka": {
      const ty = 4;
      for (let x = 1; x <= 12; x++) W(x, ty + (crouch ? 0 : 1), x > 10 ? METAL : "#3E4A34");
      W(12, ty, METAL);
      W(7, 7, SKIN);
      W(6, 7, pal.uni);
      break;
    }
    case "panzerfaust":
      for (let x = 5; x <= 9; x++) W(x, wy - 1, "#4E4A36");
      W(10, wy - 2, "#5E5640");
      W(11, wy - 2, "#5E5640");
      W(10, wy - 1, "#5E5640");
      W(11, wy - 1, "#6E6648");
      W(10, wy, "#5E5640");
      W(11, wy, "#5E5640");
      arm();
      break;
    case "pistol":
      W(9, wy, METAL);
      W(10, wy, METAL);
      W(9, wy + 1, METAL);
      arm();
      break;
    case "mortar":
      for (let i = 0; i <= 5; i++) px(9 + Math.floor(i * 0.6), 12 - i, METAL);
      px(10, 7, METAL_HI);
      for (let x = 8; x <= 11; x++) px(x, 13, METAL_HI);
      px(8, 9, METAL);
      px(7, 10, METAL);
      break;
    case "flak":
      // Gun shield, twin-mount barrel, carriage.
      for (let y = 5; y <= 10; y++) {
        px(9, y, "#4A4E3E");
        px(10, y, y === 5 ? "#5E6250" : "#3C4032");
      }
      for (let x = 10; x <= 15; x++) {
        px(x, 6, METAL);
        px(x, 7, x === 15 ? METAL_HI : METAL);
      }
      for (let x = 7; x <= 13; x++) px(x, 12, METAL);
      px(8, 11, METAL);
      px(12, 11, METAL);
      px(8, 13, METAL_HI);
      px(12, 13, METAL_HI);
      W(7, 7, SKIN);
      break;
    case "none":
      W(6, 8, SKIN);
      break;
  }
  if (pose === "hit") {
    px(5 + dx, 7, "#9A2020");
    px(6 + dx, 8, "#7A1818");
  }
}

const cache = new Map<string, HTMLCanvasElement>();

/** Cached sprite canvas (SPR_W x SPR_H) with a dark 1px outline; `flip` faces left. */
export function sprite(palKey: string, pose: Pose, weapon: Weapon, head: Head, flip: boolean): HTMLCanvasElement {
  const key = `${palKey}|${pose}|${weapon}|${head}|${flip ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pal = PAL[palKey] ?? PAL.us;
  const c = document.createElement("canvas");
  c.width = SPR_W;
  c.height = SPR_H;
  const g = c.getContext("2d")!;
  paint(
    (x, y, col) => {
      if (x < 0 || y < 0 || x >= SPR_W || y >= SPR_H) return;
      g.fillStyle = col;
      g.fillRect(flip ? SPR_W - 1 - x : x, y, 1, 1);
    },
    pal,
    pose,
    weapon,
    head
  );
  // Outline pass: classic dark 1px rim around every opaque pixel.
  const img = g.getImageData(0, 0, SPR_W, SPR_H);
  const d = img.data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < SPR_W && y < SPR_H && d[(y * SPR_W + x) * 4 + 3] > 200;
  const rim: number[] = [];
  for (let y = 0; y < SPR_H; y++)
    for (let x = 0; x < SPR_W; x++)
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) rim.push(y * SPR_W + x);
  for (const i of rim) {
    d[i * 4] = OUTLINE[0];
    d[i * 4 + 1] = OUTLINE[1];
    d[i * 4 + 2] = OUTLINE[2];
    d[i * 4 + 3] = 215;
  }
  g.putImageData(img, 0, 0);
  cache.set(key, c);
  return c;
}

/** Turn a smooth full-res painting into a chunky, palette-reduced, dithered pixel canvas. */
export function pixelize(src: HTMLCanvasElement, px: number): HTMLCanvasElement {
  const w = Math.ceil(src.width / px);
  const h = Math.ceil(src.height / px);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const g = out.getContext("2d")!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const STEP = 14;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * STEP;
      for (let k = 0; k < 3; k++) {
        // Slight mud push: desaturate toward olive-brown before quantizing.
        const v = d[i + k] + t;
        d[i + k] = Math.max(0, Math.min(255, Math.round(v / STEP) * STEP));
      }
    }
  }
  g.putImageData(img, 0, 0);
  return out;
}

/** Pixel explosion: white core → amber fireball → dithered smoke, in 2x2 pixel blocks. */
export function drawBoom(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, k: number, PXW: number) {
  const B = PXW * 2;
  const R = size * (0.35 + 0.65 * Math.min(1, k * 2.2));
  const core = R * Math.max(0, 0.75 - k);
  const n = Math.ceil(R / B);
  const cx = Math.round(x / B) * B;
  const cy = Math.round(y / B) * B;
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const d = Math.hypot(i * B, j * B * 1.15);
      if (d > R) continue;
      const edge = d / R;
      const checker = (i + j) & 1;
      let c: string | null;
      if (d < core * 0.45) c = k < 0.25 ? "#FFF6D8" : "#FFD97D";
      else if (d < core) c = checker ? "#F2A03A" : "#E5793A";
      else if (k < 0.5) c = edge > 0.85 && checker ? null : checker ? "#B4462A" : "#7A2E1E";
      else c = checker || edge < 0.6 ? `rgba(58,54,46,${(1 - k) * 1.6})` : null;
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(cx + i * B - B / 2, cy + j * B - B / 2, B, B);
    }
  }
}
