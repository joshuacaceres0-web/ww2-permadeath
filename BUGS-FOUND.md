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
