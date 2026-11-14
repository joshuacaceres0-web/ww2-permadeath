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

---

# Bug hunt sweep 2026-11-13 #2 (tank focused, base HEAD 6d2bc2f)

Second sweep, run in an isolated worktree (~/workspace/ww2-sweep-work) so the parallel graphics job's tree was never touched. Scratch drivers zz-sweep / zz-probe2 (seeded mulberry32 RNG installed as Math.random, so every run reproduces exactly from its seed; drivers deleted after, never committed, main save untouched). Six-man squad (rifleman leader, rifleman, radioman, medic, MG, AT), commander level 8, real backend compositions, Sherman called at T+5s in every run. Invariants checked every second of every run: finite positions/hp/morale, hp at or under max, mag and altMag inside their tubes, reload timers non-negative, nobody alive far out of the map. Every damage event of every run was audited at the damage() seam: armor class of the target vs the source type. Turret angles were checked every tick against the per-type traverse cap. Battle reports were validated at filing: fallen + deserted + survivors partition the squad exactly, each man's filed kills equal the engine's count, lootRp equals 25 x crates looted, at most one crate, victory flag matches battleState.

## Play-test results (10 full AUTO runs + duel + retreat)
- Overlord beach, seeds 11 / 77: VICTORY 185s / 212s, squad 3/6 and 2/6 alive. Sherman untouched (500) both, 3 and 4 kills. Wave-3 Panzer died in both. Crate looted in seed 77 (25 RP, exactly once).
- Overlord airborne, seeds 23 / 91: VICTORY 169s / 145s, squad 5/6 and 4/6. All three Panzers (wave 3 + the 2 convoy) died in both; Sherman untouched. Crate looted in both (25 RP each).
- Silent Chateau, seeds 31 / 55: VICTORY 178s / 154s, squad 3/6 both. Sherman untouched, Panzer died in both.
- Iron Crossroads, seed 41: VICTORY 196s, squad 2/6, Sherman ground down to 60 hp by Panzer + panzerfaust fire and lived; both Panzers died. Seed 97: DEFEAT in 39s — wave 1 (twin MG42 nests + panzerfausts) wiped the squad before the Sherman could matter; filed cleanly. (Balance cliff, already an open design decision — not a bug.)
- Permafrost, seed 61: VICTORY 249s, squad 1/6, the Sherman DIED this time (armor sources only, per the audit) after 3 kills; both Panzers died. Seed 83: DEFEAT 152s, squad wiped, Sherman alive at 500 with 3 kills, the last Panzer alive at 150 hp when the battle filed — filed cleanly as a defeat.
- Duel micro-scenario (lone Panzer + 2 volks vs rifleman/radioman/AT/MG, Sherman called): VICTORY 25s — the AT man's bazooka killed the Panzer before the Sherman engaged. Armor sources only.
- Retreat probe (Chateau, retreat at 25s): filed as a defeat, report fallen 2 / survivors 4 (extracted men counted, no drops, no doubles). Fit-map flag was still on at battle end on that engine instance, and a second setup() on the SAME engine started clean (flag reset, squad whole, phase fresh) — no leak into the next battle.

## New bugs found
- NONE. No table entries: nothing met the bar for #25. Zero invariant violations, zero armor violations across every audited damage event of all 13 runs, zero turret over-traverse ticks, zero stuck-vehicle candidates (no vehicle ended a battle alive after 60s+ of no movement and no damage dealt), zero soft-locks (longest battle 249s against a 1200s cap), zero HUD log nonsense hits.

## Verified working (this sweep)
- Armor rule under audit, not sampling: in 13 battles, no tank-armor target ever lost HP to a source outside ARMOR_SOURCES. The one Sherman death (Permafrost seed 61) and the 60-hp survival (Crossroads seed 41) came only from Panzer guns and panzerfaust rockets.
- Halftrack half-damage: a full airborne battle audited at the damage seam — no small-arms event ever applied more than 0.7x of its raw hit to the convoy halftrack (the halving plus the marked-target ceiling is 0.65x).
- Tank call gates: first call lands, second call refused (one Sherman only), call with a dead radioman refused and no tank spawns.
- Deserter filing end-to-end: a staged break (flee roll forced, radioman + medic + the NPC radioman first removed through the real damage path) ran west, deserted at t=4s, filed in report.deserted — NOT in fallen (no Memorial entry) — and the battle filed as a defeat on the spot, partition exact. Note the layering that made the staging take three tries: a fleeing man is rescued by design at every layer — the squad radioman's Rally Call steadies him at 65, a morphine medic does the same, and the 2nd Platoon's NPC radioman mirrors the rally onto player men too (Pfc. Novak rescued the probe man twice). All three rescues are documented behavior, not bugs — but it means a desertion only ever completes when every rally source is dead or out of reach, which matches how rarely it fires in real play (zero deserters across all 10 open runs, with natural morale).
- Crates: spawned in several runs, looted in 3, paid exactly 25 RP each time, never twice, never more than one crate on a map; lootItem stayed null whenever no crate was looted.
- Kill accounting: in every run, each filed man's kills equaled the engine's own count, and the report partition matched the squad roster exactly — fallen, deserted and survivors, nobody dropped or double counted.

---

# Bug hunt sweep 2026-11-13 #3 (finished package build, base HEAD d3d3da2)

Third sweep, on the finished package build: Phase A (bars/control), Phase B (vault/dive), Phase C (vehicle scale/honesty), the controls+fire job (C key, fullscreen battle, dive cooldown, click-fire rework, aim mode), the explosives pass (grenade fuse/range/flee, mine instant kill, mine visibility/avoidance) and Phase D conquest (no waves, trench control points, retakes). Method as before: seeded mulberry32 RNG installed as Math.random, real backend compositions (the local save mirror's /missions), seven-man squad (rifleman leader, rifleman, radioman, medic, MG, AT, engineer), commander level 8, Sherman called from t=5s in every run. Audits ran live inside every battle: the armor rule on every damage() event (target armor class vs source type, plus the halftrack small-arms ceiling), per-second invariants (finite positions/hp/morale, hp at or under max, mag/altMag inside their tubes, reload timers non-negative, nobody alive far out of the map), frag lifespans against the 2s fuse, mine detonations (every armed-to-gone mine must have an allied mine-source death beside it; revealed mines watched for steppers and for AI men lingering inside the trigger ring), control-point progress bounds and flip logging, stuck scans for infantry and vehicles, and full filing audits at battle end (files exactly once, report partitions the roster exactly, per-man kills match the engine, lootRp is 25 x crates looted and never more, victory only with every point held). Scratch drivers deleted after, never committed.

## Play-test results (10 full AUTO runs, conquest rules)

| Run | Result | Duration | Notes |
| --- | --- | --- | --- |
| Overlord beach, seed 101 | VICTORY | 236s | Roster 3/7, axis 51/51 dead. 6 point flips, including axis recaptures (C @175s, B @197s) — retakes work live. Sherman wedged — bug #25 below. |
| Overlord beach, seed 202 | VICTORY | 319s | Roster 1/7. Same Sherman wedge at the identical spot. |
| Overlord airborne, seed 303 | VICTORY | 231s | Sherman engaged and fought (no wedge on airborne geometry). |
| Overlord airborne, seed 404 | VICTORY | 306s | Clean. |
| Silent Chateau, seed 505 | VICTORY | 241s | Axis 39 dead: the base 33 plus the timed counter-attack pair and Funker call-ins — legal reinforcements, not a spawn error. |
| Silent Chateau, seed 606 | VICTORY | 220s | Clean. |
| Iron Crossroads, seed 707 | DEFEAT | 155s | Squad wipe against the full deployed force — the known full-force cliff (Josh's open call, not re-litigated). Filed cleanly. |
| Iron Crossroads, seed 808 | VICTORY | 128s | Clean. |
| Permafrost, seed 909 | DEFEAT | 171s | Point C taken @134s, retaken by axis @147s; squad ground down after. Filed cleanly. |
| Permafrost, seed 111 | DEFEAT | 156s | Nightmare op; filed cleanly. |

Every battle filed exactly once; every report audit passed. Zero invariant violations across all 10 runs.

## New bugs found

| # | Symptom & evidence | Where | Severity | Fixed? | Commit |
| --- | --- | --- | --- | --- | --- |
| 25 | The called-in Sherman never fought on the beach. In both seeded Overlord beach runs it rolled east on the road, stopped at exactly (501,650) around t=20s and sat there at full health for the rest of the battle (200s+), never firing (nearest enemy 516+ away). Root cause, bisected with a moveToward wrapper: its step target was (621,650); the full step was refused because a hedgehog at (515,604) puts a blocked grid cell inside the Phase C hull footprint (vehicle body radius 30, up from 22) — but the perpendicular "slide" step moved it ~0.01 units (the target was almost dead ahead), so moveToward accepted the hair slide forever and the pocket escape built for exactly this case never got a turn. The grid cell patch is coarser than the true circle geometry (a thread exists at y~658), and no stuck detector watches the tank-road branch, so nothing ever rescued it. Also stalls the same way under manual play (the Sherman is AI-driven in every mode). | engine.ts moveToward (step attempts + pocket escape) | HIGH — a paid radio call (60 RP) delivers a tank that sits out the whole battle on the flagship map. Not CRITICAL: the battle still files and infantry can win without it. | Yes — a vehicle's axis slide must actually close on its target (>= 0.1x the step; the hair slide closed at ~0.002x), and a wedged vehicle probes toward its waypoint first in the pocket escape instead of backing down the road into the same cell. Footmen keep the plain slide and the back-out-first order: the bug #1 stuck detector is their backstop (wedge.test.ts worst stuck ~2s, unchanged). Regression test beach-sherman.test.ts drives the real op_01 in AUTO on seed 101 and pins the Sherman through the belt (x > 900): fails pre-fix at exactly (501,650), passes post-fix (x~1100 by t=40, fighting). | 007a464 |

## Test staging repair (not a game bug)

leader-controls.test.ts flipped two tests on the untouched build (the assigned "a follower fires on his own at an enemy in range" ~1 run in 3; "left click on an enemy makes the leader fire without chasing" ~1 in 6). Diagnosed with a scratch harness (10–20 stagings per variant): since Phase D the staged foe is a trench-garrison man whose patrol re-picks a trench spot — overriding a plain home/patrol pin — and walks him east out of the shot inside the window (740 → 828 in every staging); the follower, teleported 150 from his leader, correctly walks back to his formation slot and fires only marginally on the way; and the left-click's single semi-auto shot at the old 160 range is a ~4-in-5 hit roll even at a stationary foe (8/10 stagings). Repairs are staging-only (no assertion weakened, no game code touched): the follower test stages the leader beside the follower; both tests pin the foe's home/patrol to the staged spot (Phase D's own repair pattern) and make him a static post so the patrol re-pick cannot override the pin; the left-click foe stages at 60, where the click's shot connects (20/20). Proof: 5 of 5 solo runs of the file, 10/10 tests each (baseline flipped in 3 of 6). Commit dcd0ae8.

## Verified working (this sweep)

- Armor rule under full audit: about 7,900 damage events across the 10 battles — no tank-class target ever lost HP to a source outside ARMOR_SOURCES, and no halftrack small-arms event ever applied more than 0.85x of its raw hit. Zero violations.
- Conquest filing: every victory filed only with all points held at once; point progress stayed inside [0, CAPTURE_TIME] in every sample; axis recaptures observed live (beach C and B, Permafrost C) with retake parties arriving, garrisoning and re-flipping points — no loops, no stranded parties in the stuck scans.
- Mines: 7 detonations observed in the beach probe run (3 of 24 mines revealed by the engineer); across all 10 battles, zero detonations without an allied stepper beside the mine, zero AI men stepping on a revealed mine, zero AI men lingering inside a revealed mine's trigger ring. The stepper died by the mine rule each time (no lucky-charm save), as designed.
- Grenade fuses: every frag tracked from cast burst inside the audit window around the 2s fuse — none instant, none missing, none lingering past 3s.
- The depth Panzer at (3948,1092) flagged by the stuck scan in both beach runs is LEGAL, not stuck: a camp-and-defend depth post with nothing in range (the fight was 2000+ away); it engaged and died at its post in both runs once the fight reached it.
- Deserter filing end-to-end (staged the same way as sweep #2 — rally sources killed first through the real damage path, then witnessed deaths broke a Skittish rifleman): seeds 7 and 8 broke and fell back (the flee roll is 40% for a coward; falling back is the designed miss). Seed 9 rolled the flee: he ran, deserted with cause "Broke and ran", his 2 credited kills rode in report.deserted (never in fallen, no Memorial entry), the battle filed as a defeat on the desertion itself, the report partition was exact (fallen = the 3 dead, survivors = the 2 still standing), and POSTing the report to the local backend paid his 20 kill RP. One staging lesson worth keeping: Overlord's intro runs update() alone (no morale, elapsed frozen) until it ends — burn it before staging anything timed on op_01.
- Filing end-to-end with the save's own squad: the founding squad fought real op_01, 3 kills credited through damage(), full wipe filed a defeat; POSTing the engine report paid exactly 30 RP (3 x 10, no win reward, no loot), etched all five fallen into the Memorial, removed them from the squad, and POSTing the identical report a second time paid 0 (battle_id idempotency), with battles_lost up exactly 1.
- No new balance findings: the three known open items (Crossroads full-force difficulty, the no-AT-vs-panzer cliff, tank duel hardness) were not re-litigated; nothing else met the bar for an entry.
