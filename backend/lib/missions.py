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
        "code": "OPERATION HEDGE-CLEAR",
        "location": "Bocage Outskirts, Normandy",
        "objective": "Break the scout line, silence the MG nest, secure the crossroads",
        "difficulty": "MODERATE",
        "reward": 250,
        "terrain": "bocage",
        "brief": (
            "Sunrise in the bocage. Kraut scouts hold the hedgerows ahead with a "
            "sandbagged MG42 covering the crossroads. Push east through the fields, "
            "hug the hedgerows, and put fire on that gun before it finds your range. "
            "Watch your people — every man you lose is gone for good."
        ),
        "enemies": [
            {"type": "volks", "wave": 1, "count": 3},
            {"type": "grenadier", "wave": 1, "count": 1},
            {"type": "volks", "wave": 2, "count": 2},
            {"type": "grenadier", "wave": 2, "count": 1},
            {"type": "mg42", "wave": 2, "count": 1},
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
            {"type": "grenadier", "wave": 1, "count": 2},
            {"type": "volks", "wave": 1, "count": 2},
            {"type": "officer", "wave": 2, "count": 1},
            {"type": "grenadier", "wave": 2, "count": 2},
            {"type": "mg42", "wave": 2, "count": 1},
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
            {"type": "grenadier", "wave": 1, "count": 2},
            {"type": "panzerfaust", "wave": 1, "count": 1},
            {"type": "mg42", "wave": 1, "count": 1},
            {"type": "volks", "wave": 2, "count": 3},
            {"type": "grenadier", "wave": 2, "count": 2},
            {"type": "officer", "wave": 2, "count": 1},
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
            {"type": "grenadier", "wave": 1, "count": 2},
            {"type": "officer", "wave": 1, "count": 1},
            {"type": "mg42", "wave": 1, "count": 1},
            {"type": "flak", "wave": 1, "count": 1},
            {"type": "volks", "wave": 2, "count": 2},
            {"type": "grenadier", "wave": 2, "count": 2},
            {"type": "panzerfaust", "wave": 2, "count": 2},
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
