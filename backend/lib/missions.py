"""Campaign definitions — the single source of truth for mission structure and hire costs."""

from typing import List

from models.models import MissionOut

# Hire costs, in requisition points. Mirrored in frontend/src/game/data.ts.
UNIT_COSTS = {
    "rifleman": 100,
    "medic": 150,
    "mg": 220,
    "sniper": 260,
    "at": 300,
}

MISSIONS: List[dict] = [
    {
        "id": "op_01",
        "code": "OPERATION OVERLORD",
        "location": "Normandy, France — 6 June 1944",
        "objective": "D-Day. Get ashore or get down from the sky, break the coastal defense, silence the MG42",
        "difficulty": "MODERATE",
        "reward": 250,
        "terrain": "dday",
        "brief": (
            "D-Day. Choose how your squad goes in: across Omaha Beach in a Higgins boat, "
            "under the bluffs and the steel hedgehogs, or by C-47 in the dark with the "
            "airborne — scattered across the hedgerows behind the Atlantic Wall. Either way an "
            "MG42 is waiting. Use the gaps, keep moving, and remember: every man you lose is "
            "gone for good."
        ),
        "enemies": [
            {"type": "volks", "wave": 1, "count": 4},
            {"type": "medic", "wave": 1, "count": 1},
            {"type": "grenadier", "wave": 1, "count": 2},
            {"type": "mg42", "wave": 1, "count": 1},
            {"type": "volks", "wave": 2, "count": 4},
            {"type": "grenadier", "wave": 2, "count": 2},
            {"type": "medic", "wave": 2, "count": 1},
            {"type": "scharfschutze", "wave": 2, "count": 1},
            {"type": "volks", "wave": 3, "count": 4},
            {"type": "medic", "wave": 3, "count": 1},
            {"type": "grenadier", "wave": 3, "count": 3},
            {"type": "mg42", "wave": 3, "count": 1},
            {"type": "scharfschutze", "wave": 3, "count": 1},
        ],
    },
    {
        "id": "op_02",
        "code": "OPERATION SILENT CHATEAU",
        "location": "Valognes Estate",
        "objective": "Eliminate the SS Signals Officer and clear the estate grounds",
        "difficulty": "HARD",
        "reward": 400,
        "terrain": "town",
        "brief": (
            "An SS Hauptmann is running the estate as a signals relay. His presence "
            "stiffens every gun in the village — kill him and the defense wavers. "
            "Fight house to house. Grenadiers in the streets, an MG42 dug in the "
            "courtyard. Short ranges, no room to run."
        ),
        "enemies": [
            {"type": "grenadier", "wave": 1, "count": 3},
            {"type": "volks", "wave": 1, "count": 3},
            {"type": "medic", "wave": 1, "count": 1},
            {"type": "officer", "wave": 2, "count": 1},
            {"type": "grenadier", "wave": 2, "count": 2},
            {"type": "medic", "wave": 2, "count": 1},
            {"type": "mg42", "wave": 2, "count": 1},
            {"type": "fallschirmjager", "wave": 2, "count": 3},
            {"type": "mortar", "wave": 2, "count": 1},
            {"type": "volks", "wave": 3, "count": 2},
            {"type": "medic", "wave": 3, "count": 1},
            {"type": "grenadier", "wave": 3, "count": 3},
            {"type": "officer", "wave": 3, "count": 1},
            {"type": "fallschirmjager", "wave": 3, "count": 3},
            {"type": "mortar", "wave": 3, "count": 1},
        ],
    },
    {
        "id": "op_03",
        "code": "OPERATION IRON CROSSROADS",
        "location": "Carentan Causeway",
        "objective": "Destroy the twin MG42 nests and hold against the counter-attack",
        "difficulty": "SEVERE",
        "reward": 650,
        "terrain": "causeway",
        "brief": (
            "A narrow causeway over flooded ground — one way in, one way out. Two "
            "interlocking MG42 nests cover the crossing and a Panzerfaust team hunts "
            "anything that stops. Take the nests, then dig in: they always "
            "counter-attack across the flats."
        ),
        "enemies": [
            {"type": "grenadier", "wave": 1, "count": 3},
            {"type": "panzerfaust", "wave": 1, "count": 2},
            {"type": "mg42", "wave": 1, "count": 1},
            {"type": "volks", "wave": 1, "count": 1},
            {"type": "medic", "wave": 1, "count": 1},
            {"type": "volks", "wave": 2, "count": 4},
            {"type": "medic", "wave": 2, "count": 1},
            {"type": "grenadier", "wave": 2, "count": 3},
            {"type": "officer", "wave": 2, "count": 1},
            {"type": "mortar", "wave": 1, "count": 1},
            {"type": "scharfschutze", "wave": 1, "count": 1},
            {"type": "fallschirmjager", "wave": 2, "count": 3},
            {"type": "volks", "wave": 3, "count": 4},
            {"type": "medic", "wave": 3, "count": 1},
            {"type": "grenadier", "wave": 3, "count": 3},
            {"type": "panzerfaust", "wave": 3, "count": 2},
            {"type": "mg42", "wave": 3, "count": 1},
        ],
    },
    {
        "id": "op_04",
        "code": "OPERATION PERMAFROST FLAK",
        "location": "Hürtgen Forest Bunker Complex",
        "objective": "Demolish the Flak 38 battery and break the bunker garrison",
        "difficulty": "NIGHTMARE",
        "reward": 1000,
        "terrain": "forest",
        "brief": (
            "Last leg of the line: a Flak 38 emplacement zeroed on the forest road, "
            "an officer's command post, and every grenadier they can scrape together. "
            "Cold enough to freeze a rifle bolt. Get the gun, break the garrison, "
            "and bring everyone home you can."
        ),
        "enemies": [
            {"type": "grenadier", "wave": 1, "count": 3},
            {"type": "officer", "wave": 1, "count": 1},
            {"type": "mg42", "wave": 1, "count": 1},
            {"type": "flak", "wave": 1, "count": 1},
            {"type": "volks", "wave": 1, "count": 1},
            {"type": "medic", "wave": 1, "count": 1},
            {"type": "volks", "wave": 2, "count": 3},
            {"type": "medic", "wave": 2, "count": 1},
            {"type": "grenadier", "wave": 2, "count": 3},
            {"type": "panzerfaust", "wave": 2, "count": 3},
            {"type": "mortar", "wave": 1, "count": 1},
            {"type": "scharfschutze", "wave": 2, "count": 3},
            {"type": "fallschirmjager", "wave": 2, "count": 3},
            {"type": "volks", "wave": 3, "count": 4},
            {"type": "medic", "wave": 3, "count": 1},
            {"type": "grenadier", "wave": 3, "count": 4},
            {"type": "fallschirmjager", "wave": 3, "count": 3},
            {"type": "panzerfaust", "wave": 3, "count": 2},
            {"type": "scharfschutze", "wave": 3, "count": 2},
        ],
    },
]


def mission_list() -> List[MissionOut]:
    out: List[MissionOut] = []
    for i, m in enumerate(MISSIONS):
        out.append(MissionOut(index=i, **m))
    return out


def mission_by_index(index: int) -> MissionOut | None:
    missions = mission_list()
    if 0 <= index < len(missions):
        return missions[index]
    return None
