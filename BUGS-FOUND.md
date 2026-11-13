# VANGUARD '44 — BUGS FOUND (overnight play-test, 2026-11-10)
Working file, not committed to GitHub. Base: GitHub main f6d8f94, plus in-flight uncommitted fixes from subagent 14f52500 (all tags off, AI stuck in cover, controls missing) — landed as local ccd90b0.

## Overnight fixes, 2026-11-10 (local only, NOT pushed)
Bugs #1, #2, #5, #6, #7, #8, #13, #14, #15, #20 fixed and committed locally in three batches (see table). Bugs #3, #4 (balance) and #9–#12, #16–#19 (LOW/cosmetic) still open. No damage/health/wave counts/RP/NPC counts changed, saveId untouched, "main" save untouched (300 RP, mission 0, 0-0). Frontend vitest 7/7, backend pytest 15/15 (12 before + 2 idempotency + 1 cap test; run with proxy vars stripped — httpx still misparses bracketed IPv6 in NO_PROXY otherwise).
- #2 stalemate breaker is a DESIGN CHOICE Josh can revert: after 60s with no HP change or death on either side, living mobile units are ordered to hunt their nearest enemy (statics are targets, never movers), re-issued every 5s, and a player's attack order is never overridden. It overrides a player's hold position — if Josh does not want that, revert the breaker block in engine.ts update().

## Play-test results (headless GameEngine sims, 16 runs, 4 ops x 2 tactics)
- 0 victories in 16 runs. Wave 2 reached only in Silent Chateau.
- Overlord blind-east: DEFEAT 96s, 7/16 killed. Cover-hold: TIMEOUT 480s, 7/16 killed.
- Silent Chateau blind-east: DEFEAT 76s, 7/16. Cover-hold: DEFEAT 72s, 7/16. Wave 1 clears 40-47s, wave 2 wipes squad in ~30s.
- Iron Crossroads blind-east: DEFEAT 28s, 0/22 killed, full squad wipe. Cover-hold: TIMEOUT 480s, 7/22.
- Permafrost blind-east: DEFEAT 43s, 4/25. Cover-hold: TIMEOUT 480s, 6/25.
- NPC allies (6 weak riflemen) never cleared a wave alone. Mortar never died in sims; MG42 usually last survivor.

## Ranked bug list
| # | Bug | Where | Severity | Fixed? | Commit |
|---|---|---|---|---|---|
| 1 | Cover-boundary wedge: unit hugging a cover blocker (2px clearance, r=11) can never take a ~1.1px/frame step; pointBlocked tests destination + 4 pts at UNIT_R 9, all 16 directions blocked, sidestep only checks sidestep point not first step. Units freeze 400+ s with orders pending. | frontend/src/game/engine.ts:1954 pointBlocked, :1973 moveToward, stuck detector ~1595-1690 | CRITICAL | Yes — VERIFIED. Wedge probe worst stuck 2s (was 400+s); units escape or drop orders. Root cause found during #2 testing: a unit on the push boundary needs ~23 units to clear the blocked cell (5-point body check reaches 9 out, cell is 24 wide), so the pocket escape now probes out to 24x step (~28 units), directions tried away from the waypoint first. Test fix: dead units no longer count as 'stuck' (update() skips them, orders freeze on a corpse). | a443578 |
| 2 | Soft-lock / stalemate, no breaker: cover-hold ends with living units out of range of each other (e.g. allies in cover vs static MG42 at 994-1687, MG42 range 320; mortar out of its own 620 range at 946). No timer, no auto-hunt, no last-enemy advance. | engine.ts battle loop | CRITICAL | Yes — VERIFIED. Breaker added: 60s with no HP change/death on either side orders every living mobile unit to hunt its nearest enemy, re-issued every 5s; attack orders never overridden. Stalemate test passes 4/4 (5/5 hunting at 65s, MG42 killed, victory, minX 384->~1850). DESIGN CHOICE Josh can revert (see note above). | a443578 |
| 3 | Iron Crossroads blind-east: full squad wipe in 28s, 0/22 killed. Mortar + MG42 + Scharfschutze + 2x Panzerfaust focus causeway approach. | missions.py / engine.ts spawn | HIGH (balance) | No — needs design decision, do NOT trim stats blindly | — |
| 4 | Silent Chateau wave-2 cliff: wave 1 clears 40-47s, wave 2 wipes squad in ~30s, both tactics. No run past wave 2 anywhere. | missions.py / engine.ts | HIGH (balance) | No — needs design decision | — |
| 5 | Stuck detector still does not rescue wedged units: max stuck 443-458s in timeout runs, stuckFails oscillates 0-1, drop branch never ran in 80s trace (pre-edit). Post-edit detector also not verified to rescue. | engine.ts:1608+ | MEDIUM | Yes — VERIFIED. Sims show maxStuck 1s, max consecutive stuck 0s; wedge probe worst 2s. The detector now counts a literally stationary second double (disp < 1), so a wedged unit drops in ~2-3s instead of ~6s. | a443578 |
| 6 | ai-stuck.test.ts orders only one man: for loop selectUnit() replaces selection, only Boyd gets the order. | frontend/src/game/__tests__/ai-stuck.test.ts | MEDIUM | Yes — test now uses selectAll() before issuing the order, so all 5 men get it. ai-stuck sim: squad crosses the town, no unit stationary >1s with an active order. | cbefa87 |
| 7 | Rotate banner covers status-bar controls: absolute inset-x-0 top-0 z-30, no positioned ancestor, covers RADIO/PAUSE/COVER/RETREAT while mustRotate on touch portrait. | frontend/src/pages/Battlefield.tsx:606-630 | HIGH | Yes — banner moved in-flow at the top of the Battlefield root div (normal flex child, pushes the status bar down instead of overlaying it). Same testids, dismiss button, mustRotate logic kept. | cbefa87 |
| 8 | SquadDock ability buttons look live during briefing but are no-ops (startAim returns unless phase==battle). | frontend/src/components/game/SquadDock.tsx:60-78, engine.ts:733-734 | MEDIUM | Yes — SquadDock disables ability buttons during briefing (hud.briefing) with a '- AFTER BEGIN' label and tooltip; live again once the battle starts. | cbefa87 |
| 9 | Briefing overlay (z-30) sits above TouchControls (z-20); D-pad unreachable during briefing. | Battlefield.tsx:424, TouchControls.tsx:64 | LOW | No | — |
| 10 | Desktop hint omits Esc and 0. | Battlefield.tsx:392 | LOW/cosmetic | No | — |
| 11 | Dead duplicate Esc handler. | engine.ts:1041-1046 | LOW | No | — |
| 12 | touch detection misfires on narrow desktop: innerWidth <1024 counts as touch. | Battlefield.tsx:46-48 | LOW | No | — |
| 13 | No server-side cap on reinforcements — max-3 is frontend-only; direct API caller can buy unlimited. | backend/routers/campaign.py:68-84 | MEDIUM | Yes — VERIFIED live + test. battle_reinforce enforces max-3 server-side under the save lock, per current mission attempt; counter resets when a battle files or the mission changes. 3x200, 4th -> 409. Old 402 test updated (drains RP via /squad/hire now, since 20 reinforce calls hit the cap). | aa7763d |
| 14 | Filings without battle_id still double-count: two identical defeat POSTs with no battle_id moved battles_lost 2→3→4. | backend/routers/campaign.py:102, Battlefield.tsx:652 | MEDIUM-LOW | Yes — VERIFIED live + test. Filings without battle_id are deduped by content fingerprint (SHA-256 of mission/result/duration/fallen/survivors, first 16 hex, 'fp:' prefix), checked inside the save lock; two identical defeat POSTs move battles_lost 0->1, a genuinely different defeat still counts. | aa7763d |
| 15 | Epitaph reads "was killed by killed in action" (cause_phrase only lowercases first char). | backend/lib/gen.py:180-184, :198 | LOW | Yes — VERIFIED. cause_phrase returns 'enemy fire' for the fallback cause 'Killed in action', so epitaphs now read 'was killed by enemy fire'. Normal causes unchanged ('mortar bombardment'). | aa7763d |
| 16 | Same audio file restarts navigating Start Menu ↔ Memorial (different track keys "menu" vs "memorial"). | frontend/src/game/music.ts:20-25 | LOW/cosmetic | No | — |
| 17 | armUnlock gesture listeners never removed (music.ts:60-68). | frontend/src/game/music.ts:60-68 | LOW | No | — |
| 18 | last_battle.survivors counts whatever client sends, reserves included. | backend/routers/campaign.py:202 | LOW/cosmetic | No | — |
| 19 | Combat log absent on phones (hidden md:block); terrain legend hidden <1024px. | Battlefield.tsx:380-408 | LOW/by design | No | — |
| 20 | Build broken by scratch test files (audit-sim-tmp.test.ts TS2571, debug-cover.test.ts) — untracked, delete before commit. | frontend/src/game/__tests__/audit-sim-tmp.test.ts, debug-cover.test.ts | MEDIUM (build) | Yes — scratch test files audit-sim-tmp / audit-probe-tmp / debug-cover never landed in the tree; the temporary pocket-probe test was deleted after use. tsc clean, npm run build succeeds. | a443578 |

## Verified working (audits, 2026-11-10 overnight)
- Save stable across reloads (3x identical). Battle idempotency with battle_id: victory/defeat/retreat filed twice = counted once. Memorial dedupe (Frank Hayes + Walter Kowalski, no dupes).
- Missions 16/16/22/25, RP 250/400/650/1000, hire 100/150/220/260/300, reinforce rifle 15 / heavy 25, max-3 enforced in engine.
- Music: single shared Audio, one src, no overlap, no restart on re-render, Battlefield/HowToPlay/Settings null, Settings volume/mute ordered correctly, all 4 WAVs HTTP 200.
- No "7 men", no "Awaiting signals"/"offline" strings. War Room first-load correct.
- Controls at HEAD f6d8f94 were broken by old rotate overlay + dead-during-briefing selection; 14f52500 fixed in working tree (uncommitted at audit time).
- Objective markers: drawObjectiveMarkers removed in working tree, drawMortarWarnings only (pulsing red circle + "!" 2.4s). Verify after 14f52500 lands.
- pytest "8 failed / 4 errors" is environmental: httpx misparses bracketed IPv6 in no_proxy. With proxy vars stripped: 12 passed in 11.70s.
- saveId() still returns "main" for every browser — open design decision, pending Josh.

## Open design decisions (do NOT guess)
- saveId per-browser random vs "main" (orphans existing main campaign if changed).
- Balance: Crossroads 28s wipe / Chateau wave-2 cliff — trim Wave 2 / spawn, or leave for Josh play-test? Do not change damage/health/RP blindly.
- Soft-lock breaker: auto-hunt last enemy, timer, or move statics? Needs a choice.

---

# Bug hunt 2026-11-13 (tank focused, base GitHub main 8604e5b)

Headless runs through the real engine (scratch drivers zz-audit / zz-probe2 / zz-probe3, deleted after; never committed, main save untouched). Four full AUTO operations with the Sherman called in at T+5s, an AT-watch run on Crossroads, two retreat probes, an isolated Sherman vs Panzer duel, and an airborne convoy run on Permafrost. Invariants checked every second of every run: finite positions/hp/morale, hp at or under max, mag and altMag inside their tubes, reload timers non-negative, nobody alive out of the map.

## Play-test results
- Overlord: VICTORY 191s, squad 3/5 alive, 51 allied kills. Sherman home untouched (500), Panzer died 19s after both were alive.
- Silent Chateau: VICTORY 226s, squad 1/5, 39 kills. Sherman untouched (500), 4 kills; Panzer died 14s into the overlap.
- Iron Crossroads: VICTORY 348s, squad 1/5, 45 kills. The one Sherman loss of the hunt: killed under combined Panzer + panzerfaust fire over a 120s overlap. 3 wrecks on the field at the end.
- Permafrost: DEFEAT 173s at wave 2, squad wiped by sniper and panzerfaust fire while the Sherman sat unengaged at full 500 hp (nothing armored had reached it). Panzer across the field at 367 hp when the battle filed.
- Isolated duel (town road, no interference): PANZER WINS. Sherman died with 0 kills; Panzer survived at 190 hp. The damage-per-hit gap (120 vs 55) decides a straight trade; the Sherman needs 8 hits, the Panzer 5.
- Zero invariant violations in every run.

| # | Bug | Where | Severity | Fixed? | Commit |
|---|---|---|---|---|---|
| 21 | Retreat report drops extracted men entirely. extract() marks a west-edge escapee alive=false on the field, and getReport() built survivors from alive men only, so an escapee filed in NO list: his kills earned no kill RP (the backend pays kill RP from fallen + deserted + survivors) and none of his battle stats were credited. Proven numerically: a probe credited s2 with 3 kills, retreated from the town spawn, all five men extracted, and the report came back fallen 0, deserted 0, survivors 0. In live play a mid-map retreat probe filed fallen 4, survivors 0 with the fifth man extracted and invisible. | frontend/src/game/engine.ts getReport() survivors filter | HIGH | Yes — survivors now include extracted men (u.alive || u.extracted). Regression test retreat-report.test.ts pins it: the whole squad files, s2's 3 kills ride in survivors, nobody double counted. Backend needed no change (it already sums survivors into total_kills). | be7072f |
| 22 | Isolated Sherman vs Panzer duel is Panzer-favoured (see results above). In full battles the Sherman survived 3 of 4 operations. | data.ts tank specs (dmg 55 vs 120) | BALANCE — Josh's call | CLOSED by Josh 2026-11-13: LEAVE IT HARD, no change. The lone Panzer beating the lone Sherman is accepted as is. | — |
| 23 | An NPC rifleman stood idle about 80s mid-battle on Crossroads with the nearest enemy ~550 away: his squad anchor held position out of range, and only the 60s stalemate breaker eventually moves such men. The t=40 platoon snapshot otherwise showed both NPC squads advanced, in cover, with orders. | engine.ts npcAnchorMove / stalemate breaker | LOW | Yes — FIXED per Josh's call 2026-11-13 (commit PENDING): a separate squad-level clock, NPC_SQUAD_IDLE_PUSH = 25s. Per-squad fight stamps land in spawnBullet and damage (any member fired, hit, or was hit); every 0.5s the checker orders any 2nd Platoon squad quiet for 25s to hunt its nearest enemy on the breaker's own orders mechanism, leader and anchor included (orders run before anchor following, so the hunt overrides the anchor). The shared 60s breaker is unchanged and the player's squad is never touched: no forced split of the breaker was needed. Test npc-idle-push.test.ts: a squad anchored on a test-held leader sits at t=20, the push logs before t=40 with hunt orders on the leader himself, and the men march east 250+ by t=46 while the player's idle squad never moves. Note from testing: in the open a platoon squad advances on its own (600-970 units in 20s), so the sit only happens under an anchor hold, which is what the test reproduces. | 9cb3c33 |
| 24 | Halftrack top MG did not read as a top gun (Josh, 2026-11-13): the spec already carried a mounted MG42 on a traversing pivot, but the sprite drew it as a small dark plate and 20-long dark barrel on a dark hull, easy to miss, and its fire left at the tanks' 42-unit muzzle, visibly past the drawn barrel's tip. | engine.ts drawVehicle halftrack + spawnBullet muzzle | LOW (visual) | Yes — sprite redrawn as a manned top gun in the game's style: a gunner up out of the bay (helmet and shoulders behind the pivot), a pale armoured shield across the gun, a 22-long thick barrel with muzzle brake and a belt drum, still traversing on u.turret (3.2 rad/s, the fastest traverse) and firing its existing mounted-MG42 numbers (dmg 7, interval 0.45, range 260) — no second gun, no firepower change. Muzzle now per type (MUZZLE_LEN: panzer/tank 42, halftrack 24), so its rounds and flash leave at its own barrel tip. Test halftrack-mg.test.ts: turret swings onto an off-line target, fire gated on alignment, every fresh round spawns 16-40 from centre, never at 42. Half-damage small-arms armor confirmed GOOD AS IS by Josh, unchanged. | 9cb3c33 |

## Verified working (this hunt)
- Armor rule in live play: across three operations the called-in Sherman took zero damage from rifles, MG42s and SMGs; only Panzer guns and panzerfaust rockets hurt it (Crossroads loss).
- Turrets: a lone Panzer's turret scans on its own (angle variance 0.49 rad over 15s idle, sweeping around its facing); the Sherman's turret sat up to 0.70 rad off its hull facing while advancing — traverse, line-up gating and muzzle offset all exercised in the duel traces.
- Halftrack: alive at full 220 hp when the convoy made contact at 35.7s on Permafrost; the unload fired (combat log line) with its 6 men (4 volks, 2 grenadiers per the code path); it was destroyed later in the battle and persisted as a wreck.
- Retreat flankers: exactly 6 new axis units by id at +8s (grenadier between two volks on each edge, counter-attack marked, level with the squad's centroid).
- Retreat view: isFitMap() true for the whole retreat (live full map), and setFitMap(false) still refuses while retreating.
- AT split weapons in live play: shotgun-source rounds in the Crossroads AT run; squad AT man #6 emptied his 5-shell tube (altMag 0 at death) with 3 kills and his bazooka never fired; an NPC AT man was present and rocketing on Overlord.
- Radio tank call landed at about 5s in all four operations (living radioman, commander level 8).
- Wrecks persisted to battle end in every run (1 to 3 per operation).
- Bipod exercise in AUTO runs was thin (deployed-MG time 0 to 2s per run): AUTO rarely holds the squad MG prone for long. The mechanic itself is pinned by mg-bipod.test.ts (3/3); Josh's manual play is where it will show.
