"""Barracks upgrades and squad stores (Josh, 2026-11-13).

Two systems, both earned in game only — no real money anywhere
near them (Josh's standing no-paid-RP / no-pay-to-win rule):

UPGRADES belong to the man. A survivor of a filed battle earns
upgrade points — 2 for coming through it, +1 per 2 kills,
capped at +2 — and spends them in the Barracks at 2 points per
level, 3 levels per track, 6 tracks. They live on his soldier
doc, carry over a new campaign like his rank and kills do, and
die with him.

STORES belong to the squad. Items — field gear, earned
headgear, and guns — come from battlefield loot crates
(alongside their 25 RP), a guaranteed award item for a
victory, and an RP price in the Barracks. A man carries at
most EQUIP_SLOTS items, never two of the same. Equipped gear
is drawn on the man in battle, in the game's own style.

DEATH TAKES EVERYTHING (Josh's correction, 2026-11-13): when
a man falls — or deserts — his upgrades, his unspent points
and every item he carries are lost with him. Nothing returns
to stores; only what sits unequipped in stores survives him.
The plain M1 helmet and the standard bandolier are issue kit
every man already has — they are not items and never appear
here; the headgear below is earned wear, over and above issue.
"""

import random

# track id -> display is frontend-side; the backend only needs
# the ids, the cost and the cap.
UPGRADE_TRACKS = [
    "toughness",
    "marksmanship",
    "steady",
    "legs",
    "nerve",
    "eyes",
]
UPGRADE_COST = 2
UPGRADE_CAP = 3

EQUIP_SLOTS = 2

# item id -> RP price, class restriction (None = any class),
# and the weight for crate / victory award rolls.
ITEMS = {
    # Field gear, 40 RP, common finds.
    "entrench": {"price": 40, "restrict": None, "weight": 3},
    "ammo": {"price": 40, "restrict": None, "weight": 3},
    "canteen": {"price": 40, "restrict": None, "weight": 3},
    "dressing": {"price": 40, "restrict": None, "weight": 3},
    "jeepcap": {"price": 40, "restrict": None, "weight": 3},
    # The rare and class pieces, 75 RP.
    "binoculars": {"price": 75, "restrict": ["recon", "sniper"], "weight": 1},
    "charm": {"price": 75, "restrict": None, "weight": 1},
    "batteries": {"price": 75, "restrict": ["radioman"], "weight": 1},
    "aidbag": {"price": 75, "restrict": ["medic"], "weight": 1},
    "nethelmet": {"price": 75, "restrict": None, "weight": 1},
    "parahelmet": {"price": 75, "restrict": None, "weight": 1},
    "pilecap": {"price": 75, "restrict": None, "weight": 1},
    "hbtcap": {"price": 75, "restrict": ["engineer"], "weight": 1},
    # Off-duty wear: cheap, and lost like everything else.
    "garrisoncap": {"price": 25, "restrict": None, "weight": 2},
    # Guns, 100 RP: a carried weapon over his issue piece.
    "thompson": {"price": 100, "restrict": ["rifleman", "medic", "radioman", "recon", "engineer"], "weight": 1},
    "springfield": {"price": 100, "restrict": ["sniper", "recon"], "weight": 1},
    "mp40": {"price": 100, "restrict": ["rifleman", "medic", "radioman", "recon", "engineer", "sniper"], "weight": 1},
}


def points_for_battle(kills: int) -> int:
    """What a survivor earns from one filed battle: 2 for
    surviving it, +1 per 2 kills up to +2 more."""
    return 2 + min(2, max(0, kills) // 2)


def roll_item(rng: random.Random) -> str:
    """A weighted random stores item (crate loot / victory award)."""
    ids = list(ITEMS.keys())
    weights = [ITEMS[i]["weight"] for i in ids]
    return rng.choices(ids, weights=weights, k=1)[0]
