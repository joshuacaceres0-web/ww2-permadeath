"""Real WWII-era US Army decorations, tied to in-game feats.

Criteria are game adaptations of the real ones: CIB (est. 1943) for satisfactory performance
under fire; Combat Medical Badge (est. 1945) for medics under fire; Purple Heart for wounds
received in action (and posthumously for KIA); Bronze Star (1944) for heroic or meritorious
achievement; Silver Star for gallantry in action; Distinguished Service Cross for extraordinary
heroism; Medal of Honor for conspicuous gallantry above and beyond the call of duty.
Bonuses mirror frontend/src/game/data.ts MEDALS.
"""

ORDER = ["cib", "cmb", "purple_heart", "bronze_star", "silver_star", "dsc", "moh"]

NAMES = {
    "cib": "Combat Infantryman Badge",
    "cmb": "Combat Medical Badge",
    "purple_heart": "Purple Heart",
    "bronze_star": "Bronze Star",
    "silver_star": "Silver Star",
    "dsc": "Distinguished Service Cross",
    "moh": "Medal of Honor",
}

# Medals a man can earn more than once (real: Oak Leaf Clusters).
REPEATABLE = {"purple_heart", "bronze_star", "silver_star"}


def award(stats, unit_type: str, survived: bool, victory: bool, sole_survivor: bool, existing: list[str]) -> list[str]:
    """Return newly earned medal codes for one man's mission."""
    got: list[str] = []
    have = set(existing)

    def give(code: str) -> None:
        if code in REPEATABLE or (code not in have and code not in got):
            got.append(code)

    kills = stats.kills
    if survived and unit_type != "medic":
        give("cib")
    if unit_type == "medic" and stats.healed >= 100:
        give("cmb")
    if stats.damage_taken >= 40 or not survived:
        give("purple_heart")  # wounded in action — posthumous for the fallen
    if kills >= 4 or (unit_type == "medic" and stats.healed >= 180):
        give("bronze_star")
    if stats.heavy_kills >= 1 or stats.officer_kills >= 1:
        give("silver_star")
    if kills >= 8:
        give("dsc")
    if kills >= 12 or (sole_survivor and victory and survived):
        give("moh")
    return got


def label(codes: list[str]) -> list[str]:
    return [NAMES[c] for c in codes]
