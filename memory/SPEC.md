# VANGUARD '44 — App Spec

Hardcore top-down WW2 real-time tactics game with tactical pause, units to hire,
and TRUE permadeath. React 19 canvas engine frontend + FastAPI/Mongo meta backend.

## What it does
- **War Room (`/`)**: current operation briefing, enemy intel, campaign progress,
  squad readiness, requisition ledger. Deploy button launches the battle.
- **Battlefield (`/game`)**: full-viewport HTML5 canvas battle engine (1600×900 map,
  scaled to fit). Real-time combat with SPACE = tactical pause; LMB drag marquee /
  click select; RMB = move or attack order (SHIFT queues); 1-5 selects soldiers;
  Q casts the selected unit's ability; ESC cancels. Fog of war (unexplored black /
  explored dim / visible clear, per-unit vision radii), suppression (bullets near a
  unit build suppression; ≥55 = PINNED: slower, fires less accurately), medic heal
  aura, SS officer fire-rate aura, waves of enemies from the east, vector soldier
  sprites, tracers, blood decals, permanent corpses etched into the terrain.
- **Barracks (`/barracks`)**: hire Rifleman 100 / Medic 150 / MG 220 / Sniper 260 /
  AT 300 RP; promote/bench between deployment squad (max 5) and reserves.
  Emergency rule: if the roster is completely empty, the next hire is FREE.
- **Memorial (`/memorial`)**: every fallen soldier, forever (name, rank, kills,
  ops survived, cause of death, mission). Survives campaign resets.

## Progression (added in v2)
- **Soldier ranks**: one promotion per VICTORY survived while deployed — Pvt. → Pfc. → Cpl. →
  Sgt. → S/Sgt. → T/Sgt. → 1st Sgt. (level = min(missions, 6), server-derived `level`/`rank`).
  Each level: spread ×(1−0.07·L) (aim), fire interval ×(1−0.04·L), and target-acquisition
  reaction delay (0.7−0.08·L)s (min 0.12s). See `levelBonus` in `src/game/data.ts`.
- **Frozen reserve**: `status: reserve` men are excluded from battle; battle/complete ignores any
  survivor whose status isn't `active`, so reserves gain no XP/kills/promotions until redeployed.
- **Commander (the player)**: name editable (PUT /api/state/commander). Level = 1 + career_wins//2
  (max 7: 2nd Lt. → 1st Lt. → Capt. → Major → Lt. Col. → Col. → Brig. Gen.). `career_wins`
  survives campaign reset. Unlocks: max squad 4+level (cap 8), hire discount 5%/level above 1
  (cap 30%, server returns `hire_costs`), combat bonus 4%/level above 1 (aim + reaction for all).
- **Identity**: 1940s US first names, melting-pot surnames, hometown, nickname, division (1st ID,
  29th ID, 2nd Rangers, 4th ID, 101st, 82nd, 9th ID, 28th ID) and a backstory composed from
  details in real first-hand accounts (fiction, disclosed on the memorial page). `portrait_seed`
  drives a procedural 16×16 pixel portrait (`src/components/Portrait.tsx`, no AI).
- **Memorial stories**: on death the server writes `story` = backstory + how/where he fell + epitaph.
- **Graveyard** (inside /memorial): each memorial row has `grave_x/grave_y` (0..1 or null = in the
  tray). Player lays stones from the tray, places tributes (poppies, roses, lilies, wreath, candle,
  flag — `graveyard_decor` collection, max 300), drags to rearrange, CLEAR tool removes a tribute
  or lifts a stone back to the tray. Endpoints: PUT /api/memorial/{id}/grave, GET/POST
  /api/graveyard/decor, PUT/DELETE /api/graveyard/decor/{id}.

## v3 additions
- **Full reset** (War Room → START ALL OVER → type RESET): POST /api/campaign/wipe {confirm:"RESET"}
  (400 otherwise) deletes soldiers, memorial, graveyard_decor, game_state; re-creates default state
  + founding squad, memorial stays EMPTY (founding memorial only seeds on a brand-new save).
- **Map**: 2400×1350 world, camera shows 1600×900; WASD/arrows scroll; 1-8 select + center.
  A* pathfinding (CELL 24, LOS-smoothed) for move orders, attack-move and Axis chase; fire needs LOS.
  Obstacles drawn as readable bush clumps / trees / buildings / steel hedgehogs, legend on HUD;
  every hedgerow has dirt-marked gaps. Dev probe: `window.__vanguard.debugAllies()`, `.centerOn(x,y)`.
- **D-Day**: op_01 = OPERATION OVERLORD (terrain "dday"). Before the briefing the player picks
  BEACH LANDING (sea/sand/hedgehogs, bluffs with 3 draws, squad together) or AIRBORNE DROP (night
  bocage, men scattered across the western fields).
- **Medals** (backend/lib/medals.py ↔ frontend MEDALS in game/data.ts): CIB (survived op), Combat
  Medical Badge (medic healed ≥100), Purple Heart (≥40 dmg taken, or posthumous; repeatable),
  Bronze Star (≥4 kills or medic ≥180 healed; repeatable), Silver Star (killed MG42/Flak/officer;
  repeatable), DSC (≥8 kills), Medal of Honor (≥12 kills or sole survivor of a victory). Bonuses
  applied at spawn (HP/dmg/aim/fire rate/vision/heal/reaction). Battle report carries per-man
  damage_taken/healed/heavy_kills/officer_kills; result returns medals_awarded. Soldier + memorial
  rows have `medals: string[]`; ribbons shown in dossier, barracks rows, war room, wall cards and
  on tombstones in the graveyard.

## v4 additions
- **Save slots**: every request sends `X-Save-Id` (frontend `saveId()` in lib/api.ts reads
  localStorage `vanguard-save-id`, default "main" = the user's original save). Backend middleware
  sets a contextvar; `lib/save.py` `S.<collection>` scopes every query/insert by `save_id`.
  New slot => fresh state + founding squad. TESTS MUST set localStorage `vanguard-save-id` (and the
  header for curl) to a test id — never touch "main".
- **Saving fixes**: battle reports auto-file the moment a battle ends; leaving the battle page or
  closing the tab mid-battle files a retreat (keepalive fetch) so the dead stay dead; debrief shows
  RETRY if filing fails. Deployed mission+squad are frozen for the battle's lifetime.
- **Cover**: covers (sandbags 0.65, ruins 0.8, crates 0.55, wrecked tanks 0.85, trees 0.6, bushes 0.45,
  hedgehogs 0.35, beach shingle 0.6). A unit within reach of cover gets ◆ marker; a bullet from the far
  side is stopped with probability q; suppression taken ×0.6. TAKE COVER (C key / COVER button /
  touch COVER) sends selected men to the nearest cover facing the enemy (≤340px). Axis + AI allies
  seek cover when in range.
- **Map props**: coverField() scatters sandbags/ruins/crates/wrecks on every map; town has ruin rows;
  causeway sandbag lines + wrecks; forest bunker sandbags; beach German trench line.
- **AI allies (2nd Platoon)**: 2 + min(3, mission index) NPC GIs (`npc:true`) advance east, fight,
  take cover; not selectable, not in the dock, no permadeath/report; defeat = player squad wiped.
- **New enemies**: scharfschutze (sniper), mortar (Granatwerfer 34, static, indirect fire every 6s
  ≤620px, no LOS needed), fallschirmjager (FG42). Added to mission waves.
- **Mobile**: coarse pointer or <1024px => TouchControls (D-pad hold-scroll, ALL, COVER, ABILITY,
  PAUSE); tap own soldier = select, tap ground/enemy = order, drag = scroll map. Combat log/legend
  hidden on small screens.

## v5 additions
- **Mobile squad orders**: touch BOX button (next drag draws a selection box, auto-off after) and press-and-hold (>350ms) then drag = box. Formation buttons WEDGE / LINE / COLUMN / SPREAD (touch row + desktop status-bar picker, `F` cycles). Formation shapes every move order (slots oriented along travel direction); picking one re-forms the selected men on their current objective.
- **Allied reinforcements**: status-bar RADIO menu, max 3 calls per battle. Rifle squad (3 riflemen) 15 RP, Heavy team (MG + bazooka) 25 RP. `POST /api/battle/reinforce {mission_id, kind: "rifle"|"heavy"}` → `{kind, cost, requisition}`; atomic RP deduction (402 if insufficient, 409 if mission isn't current). Engine `spawnReinforcements(kind)` adds AI 2nd Platoon units at the allied (west) edge level with the squad. No permadeath for them.
- **Destructible cover**: sandbags (110 hp) and crates (70 hp, also blockers) take explosion damage (grenades, rockets, mortars); protection scales down with hp; at 0 they're removed (crates free the path) and debris is painted. Ruins, wrecks, walls, trees are indestructible.
- **Briefing fix**: briefing panel scrolls; BEGIN THE ASSAULT sits in a fixed footer so it's always tappable regardless of squad size.
- **Landscape on phones**: BEGIN requests fullscreen + `screen.orientation.lock("landscape")` (Android); if still portrait during battle, a "Turn your phone sideways" overlay pauses the fight. Short landscape (`short:` variant = landscape & max-height 520px) hides the app header and the combat log, docks the squad list as a right-hand column.

## v6 — Pixel art pass
- **Battlefield renders as real pixel art**: low-res backing canvas (1 px = 3 world units, `PX` in engine.ts) upscaled with `image-rendering: pixelated`; min zoom 0.7 so sprites read. Terrain is painted smooth then crushed by `pixelize()` (palette-reduced + Bayer dither). Bullets, grenades, particles, health bars, selection rings are drawn in whole pixels; canvas labels use Silkscreen.
- **Animated 16-bit sprites** (`src/game/sprites.ts`, procedural + cached, dark outline): poses stand / walkA / walkB (walk cycle) / shoot (recoil + muzzle flash) / crouch (in cover, pinned, emplacements) / hit → kneel → dead (death animation ~0.75s, then a persistent corpse sprite + pixel blood pool). Per-faction looks: US olive with M1 helmet (medic red-cross helmet, MG, sniper scope, bazooka), 2nd Platoon AI lighter olive, Wehrmacht field-grey stahlhelm (MP40, MG42, Panzerfaust, mortar tube, Flak gun shield), Volkssturm brown coat + cap + armband, Fallschirmjäger camo smock, SS officer peaked cap. Explosions are pixel fireballs (white core → amber → dithered smoke) with pixel craters.
- **Sandbags** are always stacked vertically (top to bottom).
- **Pixel UI everywhere**: fonts Pixelify Sans (headings), VT323 (body, self-hosted `/fonts/vt323.woff2` with size-adjust 138%), Silkscreen (canvas). Zero radius, 2px bevel buttons with press-in, stepped hard shadows on olive panels, dithered body backdrop, chunky scrollbars, crisp-edged icons.
- No campaign map exists (by design).

## v7 — Campaign map (War Room)
- War Room has a LIST / MAP switch at the top (`warroom-view-list|map`, choice kept in localStorage `vanguard-warroom-view`). MAP replaces the campaign list in place.
- `src/components/map/CampaignMap.tsx` + `mapArt.ts`: stylised pixel field map (painted then `pixelize()`d, 240x150 px) from Normandy to the Hürtgen (Cotentin, Channel, Seine/Meuse/Rhine, forests, German border, towns). Markers per op index at OP_POS (Omaha, Valognes, Carentan, Hürtgen); status SECURED / ACTIVE / LOCKED from `state.mission_index` + `campaign_complete` (same rule as list). Route: fought segments solid amber (stepped draw-in), road ahead dashed/dim.
- Tap a marker → briefing (side panel on md+, bottom sheet on phones): code, location, threat, RP, objective, intel by wave, fallen count there. DEPLOY only on ACTIVE (same as War Room deploy → /game, D-Day choice there).
- Each Memorial entry = a red pixel poppy in a stable (hashed) arc above its operation's marker (matched by `mission_code`), unknown → "UNKNOWN GROUND" bottom-left. Tap → rank, name, cause + Memorial link. Read-only: no writes.

## v8 — Start menu
- `/` = StartMenu (outside Layout): animated pixel backdrop (`StartScene.tsx`, dusk ruins + marching squad sprites, 8 fps), title VANGUARD '44, subtitle PERMAFROST, THE SACRIFICE DIVISION. Buttons: CONTINUE (→ /war-room; disabled with "No campaign yet" when no save), NEW GAME (dialog "Start a new campaign? Your current squad, RP, and Memorial will be lost." Cancel/Confirm → only Confirm calls POST /api/campaign/wipe then → /war-room), HOW TO PLAY (/how-to-play, back to /), MEMORIAL (/memorial, with ◂ START MENU buttons top & bottom).
- Footer (only when a save exists): operation n/4 + code (or CAMPAIGN COMPLETE), RP, squad size (active), fallen count.
- `GET /api/save/summary` → `{exists, mission_code, mission_index, campaign_complete, requisition, squad_size, fallen}` — read-only, does NOT create a save (unlike /state). The start menu only calls this; nothing resets on load.
- War Room moved from `/` to `/war-room` (nav, brand link, barracks back, battle exit/debrief all point there). Unknown routes → `/`.

## Missions (sequential, victory advances; defeat does not)
1. op_01 OPERATION HEDGE-CLEAR — bocage — 250 RP — MODERATE
2. op_02 OPERATION SILENT CHATEAU — town — 400 RP — HARD
3. op_03 OPERATION IRON CROSSROADS — causeway — 650 RP — SEVERE
4. op_04 OPERATION PERMAFROST FLAK — forest — 1000 RP — NIGHTMARE
Campaign complete after op_04 → restart keeps the memorial, resets state+roster.

## Enemies
volks (Kar98k), grenadier (MP40), mg42 (static nest), officer (Luger + aura),
panzerfaust (rocket), flak (static autocannon). Threat tiers LOW→CRITICAL.

## Data model (Mongo `app` db)
- `game_state` — singleton `id:"main"`: requisition, mission_index, battles_won/lost,
  campaign_complete. Starts 300 RP / mission 0.
- `soldiers` — id (uuid str), name, type (rifleman|medic|mg|sniper|at), status
  (active|reserve), xp, kills, missions, quirk, hometown, hired_at. Rank derived
  from XP: 0 Pvt / 100 Cpl / 250 Sgt / 450 2nd Lt / 700 1st Lt / 1000 Capt.
  XP = 20/kill + 50 per mission survived (computed server-side).
- `memorial` — id, name, type, rank, kills, missions_survived, cause, mission_code,
  died_at. Written by battle/complete; never deleted except never.
- `status_checks` — template leftover, harmless.

## API (all on api_router, prefix /api)
- POST /battle/reinforce — spend RP mid-battle for an AI team (v5)
- GET `/state` → GameStateOut; GET `/missions` → [MissionOut]; GET `/squad` → [SoldierOut]
- POST `/squad/hire` {type} → SoldierOut (402 if broke; free if roster empty)
- POST `/squad/{id}/status` {status} → SoldierOut (409 if active squad full)
- POST `/battle/complete` {mission_id, victory, duration_sec, fallen:[{soldier_id,
  cause, kills}], survivors:[{soldier_id, kills}]} → BattleResultOut. 409 if not the
  current mission. Permadeath happens here: fallen deleted → memorial rows inserted.
- POST `/campaign/reset` → fresh state + founding squad; memorial untouched.
- GET `/memorial` → [MemorialOut]

## Seed facts (idempotent, runs at boot via server lifespan + `python seed.py`)
- NOTE: the live DB holds the user's real campaign (lost battles, 9 fallen). Never wipe it; test
  battle logic against a throwaway DB (`DB_NAME=app_selftest`) instead.
- Founding squad (7): active — Cpl Frank Hayes (RIF), Pvt Walter Kowalski (RIF),
  Pvt James Baker (RIF), Pvt Chester Pruitt (MED), Cpl Raymond Boyd (MG);
  reserve — Cpl Earl Whitaker (SNIPER), Pvt Norman Doyle (RIF).
- Memorial pre-seeded: Cpl Dale Mercer, Cpl Otis Crane (pre-war casualties).
- No auth — single-player, no login, no credentials anywhere.

## Frontend structure
- `src/game/engine.ts` — the battle engine (sim + render + fog + input); TS strict.
- `src/game/data.ts` — unit/enemy stat blocks (mirror of backend costs) + rank ladder.
- `src/components/game/` — BattleCanvas (engine lifecycle), SquadDock, CombatLog.
- `src/lib/types.ts` — hand-written mirrors of every Pydantic model (keep in sync).
- TanStack Query keys: "state", "squad", "missions", "memorial" — invalidated after
  battle-complete / hire / status mutations.
- Theme: dark olive war-room palette (#121411 bg, #E5A93C amber, #E24A4A crimson,
  #4ECDC4 cyan orders), Space Grotesk headings + IBM Plex Mono body (fontsource).
