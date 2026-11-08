"""Procedural soldier identity + rank helpers (server-side, so data stays consistent)."""

import random
from datetime import datetime, timezone

FIRST_NAMES = [
    "Henry", "Walter", "James", "Frank", "Earl", "Raymond", "Chester", "Norman",
    "Virgil", "Harold", "Clarence", "Stanley", "Lloyd", "Dexter", "Otis", "Roy",
    "Glen", "Willard", "Curtis", "Alton", "Buford", "Wilbur", "Lowell", "Merle",
]
LAST_NAMES = [
    "Kowalski", "Miller", "Baker", "Hayes", "Turner", "Whitaker", "Doyle",
    "Frazier", "Holloway", "Pruitt", "Callahan", "Mercer", "Boyd", "Slater",
    "Vance", "Rasmussen", "Dietz", "Yoder", "Slocum", "Barrett", "Crane",
    "Mullins", "Tate", "Hodge",
]
HOMETOWNS = [
    "Duluth, MN", "Amarillo, TX", "Erie, PA", "Mobile, AL", "Tulsa, OK",
    "Provo, UT", "Bend, OR", "Savannah, GA", "Cedar Falls, IA", "Roanoke, VA",
    "Laredo, TX", "Bismarck, ND", "Boise, ID", "Wheeling, WV", "Fresno, CA",
    "Dover, DE", "Chattanooga, TN", "Topeka, KS",
]
QUIRKS = [
    "Eagle Eye", "Tough Bastard", "Shellshocked", "Adrenaline Junkie",
    "Bible Thumper", "Quiet One", "Bar Fly", "Brooklyn Brawler", "Farm Boy",
    "Lucky Charm", "Grumbler", "Fast Talker", "Night Owl", "Dead Shot",
    "Chow Hound", "Windy",
]

# xp thresholds -> rank
RANKS = [
    (0, "Pvt."),
    (100, "Cpl."),
    (250, "Sgt."),
    (450, "2nd Lt."),
    (700, "1st Lt."),
    (1000, "Capt."),
]

XP_PER_KILL = 20
XP_PER_MISSION = 50


def rank_for(xp: int) -> str:
    rank = RANKS[0][1]
    for threshold, name in RANKS:
        if xp >= threshold:
            rank = name
    return rank


def make_soldier(unit_type: str, status: str = "reserve") -> dict:
    rng = random.SystemRandom()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "id": str(rng.getrandbits(128)),
        "name": f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}",
        "type": unit_type,
        "status": status,
        "xp": 0,
        "kills": 0,
        "missions": 0,
        "quirk": rng.choice(QUIRKS),
        "hometown": rng.choice(HOMETOWNS),
        "hired_at": now,
    }
