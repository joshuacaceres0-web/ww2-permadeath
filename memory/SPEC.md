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
- GET `/state` → GameStateOut; GET `/missions` → [MissionOut]; GET `/squad` → [SoldierOut]
- POST `/squad/hire` {type} → SoldierOut (402 if broke; free if roster empty)
- POST `/squad/{id}/status` {status} → SoldierOut (409 if active squad full)
- POST `/battle/complete` {mission_id, victory, duration_sec, fallen:[{soldier_id,
  cause, kills}], survivors:[{soldier_id, kills}]} → BattleResultOut. 409 if not the
  current mission. Permadeath happens here: fallen deleted → memorial rows inserted.
- POST `/campaign/reset` → fresh state + founding squad; memorial untouched.
- GET `/memorial` → [MemorialOut]

## Seed facts (idempotent, runs at boot via server lifespan + `python seed.py`)
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
