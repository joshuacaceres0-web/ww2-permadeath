"""Soldier identity, story and rank helpers (server-side, so data stays consistent).

Stories are fiction, composed from details documented in real first-hand accounts:
Library of Congress Veterans History Project interviews, D-Day letters home (PBS
American Experience), the Dawson letters (1st ID, Omaha → Aachen), 2nd Ranger
Battalion journals (Pointe du Hoc), 745th Tank Bn oral histories (hedgerow fighting,
Cullin cutters) and 1st ID machine-gunner memoirs (Hürtgen, Hill 232).
"""

import random
from datetime import datetime, timezone

# Most common US boys' names of the 1915-1926 birth years (the men who served).
FIRST_NAMES = [
    "Robert", "John", "James", "William", "Charles", "George", "Joseph", "Richard",
    "Edward", "Donald", "Thomas", "Frank", "Harold", "Paul", "Raymond", "Walter",
    "Jack", "Henry", "Kenneth", "Arthur", "Albert", "Clarence", "Fred", "Harry",
    "Eugene", "Lawrence", "Earl", "Howard", "Carl", "Ralph", "Roy", "Louis",
    "Francis", "Leonard", "Herbert", "Stanley", "Elmer", "Melvin", "Chester",
    "Lloyd", "Floyd", "Wilbur", "Virgil", "Leroy", "Vernon", "Orville", "Homer",
    "Clifford", "Woodrow", "Marvin", "Alvin", "Lester", "Willard", "Delbert",
]
# The melting-pot rosters of a 1944 rifle company.
LAST_NAMES = [
    "Kowalski", "O'Brien", "Russo", "Novak", "Lindqvist", "Murphy", "Sullivan",
    "Esposito", "Hernandez", "Yazzie", "Petersen", "Kaminski", "Romano", "Walsh",
    "Jablonski", "Gallagher", "Brennan", "Ortiz", "Dubois", "Fontaine", "Olson",
    "Hansen", "Mueller", "Baker", "Miller", "Turner", "Whitaker", "Doyle",
    "Holloway", "Pruitt", "Callahan", "Mercer", "Boyd", "Slater", "Rasmussen",
    "Yoder", "Barrett", "Mullins", "Tate", "Hodge", "Kozlowski", "DeLuca",
    "Svoboda", "McAllister", "Takahashi", "Begay", "Wojcik", "Schultz",
]
HOMETOWNS = [
    "Duluth, MN", "Amarillo, TX", "Erie, PA", "Mobile, AL", "Tulsa, OK",
    "Provo, UT", "Bend, OR", "Savannah, GA", "Cedar Falls, IA", "Roanoke, VA",
    "Laredo, TX", "Bismarck, ND", "Boise, ID", "Wheeling, WV", "Fresno, CA",
    "Dover, DE", "Chattanooga, TN", "Topeka, KS", "Hamtramck, MI", "Gallup, NM",
    "Scranton, PA", "Bedford, VA", "Lowell, MA", "Butte, MT", "Paterson, NJ",
]
QUIRKS = [
    "Eagle Eye", "Tough Bastard", "Shellshocked", "Adrenaline Junkie",
    "Preacher", "Quiet One", "Bar Fly", "Brooklyn", "Farm Boy", "Lucky",
    "Grumbler", "Fast Talker", "Night Owl", "Dead Shot", "Chow Hound", "Windy",
    "Professor", "Hillbilly", "Cowboy", "Pops", "Kid", "Deacon",
    # Cowardly quirks: a man with one of these runs for the edge of the
    # battlefield when his morale breaks, and deserts if he reaches it.
    "Skittish", "Jumpy",
]
OCCUPATIONS = [
    "worked the night shift at a steel mill",
    "drove a milk truck before dawn every day",
    "boxed Golden Gloves at the county armory",
    "pumped gas at a station on Route 66",
    "taught Sunday school and sang bass in the choir",
    "worked his family's dairy farm",
    "planted pine with the Civilian Conservation Corps in Montana",
    "sold newspapers on a downtown corner",
    "was a cub reporter on the town weekly",
    "apprenticed as a machinist at the rail yard",
    "played second base for a semi-pro ball club",
    "gutted salmon at a cannery",
    "cut hair in his uncle's barbershop",
    "was halfway through a teaching certificate",
    "hauled coal out of a West Virginia mine",
]
# Division -> (nickname, episodes drawn from that unit's documented experience).
DIVISIONS = {
    "1st Infantry Division": (
        "Big Red One",
        [
            "came ashore at Omaha Beach with the second wave and spent the first night in a shingle trench under the bluffs",
            "helped carry the line from the Normandy beaches to the 39-day fight for Aachen",
            "took Hill 232 in freezing rain with the machine-gun section",
        ],
    ),
    "29th Infantry Division": (
        "Blue and Gray",
        [
            "landed at Dog Green on Omaha Beach, where whole boat teams from small Virginia towns were lost in minutes",
            "fought through the hedgerows toward Saint-Lô, where a good day meant twenty yards of ground",
        ],
    ),
    "2nd Ranger Battalion": (
        "Rangers Lead the Way",
        [
            "climbed the cliffs at Pointe du Hoc on ropes soaked with sea spray, in a battalion that lost sixty percent that day",
        ],
    ),
    "4th Infantry Division": (
        "Ivy",
        [
            "waded ashore at Utah Beach and pushed inland toward Cherbourg",
            "dug a log-roofed foxhole against the tree bursts in the Hürtgen Forest",
        ],
    ),
    "101st Airborne Division": (
        "Screaming Eagles",
        [
            "jumped into Normandy in the dark miles off his drop zone and found his squad with a cricket clicker",
            "held the causeways behind Utah Beach until the seaborne troops came through",
        ],
    ),
    "82nd Airborne Division": (
        "All American",
        [
            "dropped near Sainte-Mère-Église and fought for the bridge at La Fière",
        ],
    ),
    "9th Infantry Division": (
        "Old Reliables",
        [
            "went through the Saint-Lô breakout after the Cobra bombing, when the ground shook for an hour",
            "spent October in the Hürtgen, where artillery turned the treetops into shrapnel",
        ],
    ),
    "28th Infantry Division": (
        "Keystone",
        [
            "fought at Schmidt and Kommerscheidt in the Hürtgen, the division's 'Bloody Bucket' month",
        ],
    ),
}
PERSONAL = [
    "he wrote his mother every night, and the censor cut half of every letter to ribbons",
    "he kept a photograph of his girl tucked inside his helmet liner",
    "he carried the rosary his mother pressed into his hand at the train station",
    "he shared his last K-ration with a French farm family near Saint-Lô",
    "he traded cigarettes for fresh eggs every time the line stopped moving",
    "he could field-strip a Garand blindfolded and liked to prove it",
    "he whistled Glenn Miller to keep the new men calm under shelling",
    "he kept a pocket Bible with the date of every battle penciled inside the cover",
    "he promised his kid brother a German helmet and meant to keep the promise",
    "he dried his socks inside his shirt so his feet wouldn't rot in the wet",
]
EPITAPHS = [
    "His last letter home was found in his breast pocket, sealed and unsent.",
    "One dog tag stayed with him. The other went home to his mother.",
    "His buddies marked the spot with his rifle, bayonet down, helmet on the stock.",
    "The squad never sang Glenn Miller again without him.",
    "A French girl left flowers at his marker every Sunday until the war ended.",
    "His mother kept a blue star in the window until the telegram came.",
    "He was twenty-one. The men who were there never forgot his name.",
]

# Enlisted promotion ladder — one step for every mission survived.
RANKS = ["Pvt.", "Pfc.", "Cpl.", "Sgt.", "S/Sgt.", "T/Sgt.", "1st Sgt."]
MAX_LEVEL = len(RANKS) - 1

# The player's own ladder.
COMMANDER_RANKS = ["2nd Lt.", "1st Lt.", "Capt.", "Major", "Lt. Col.", "Col.", "Brig. Gen.", "Maj. Gen."]
WINS_PER_COMMANDER_LEVEL = 2

XP_PER_KILL = 20
XP_PER_MISSION = 50


def level_for(missions: int) -> int:
    return max(0, min(MAX_LEVEL, missions))


def rank_for(missions: int) -> str:
    return RANKS[level_for(missions)]


def commander_level(battles_won: int) -> int:
    """1-based. Promoted every WINS_PER_COMMANDER_LEVEL victories."""
    return min(len(COMMANDER_RANKS), 1 + battles_won // WINS_PER_COMMANDER_LEVEL)


def make_backstory(name: str, hometown: str, quirk: str, rng: random.Random) -> dict:
    division = rng.choice(list(DIVISIONS.keys()))
    nickname, episodes = DIVISIONS[division]
    first = name.split(" ")[0]
    backstory = (
        f"{name} of {hometown} {rng.choice(OCCUPATIONS)} before he enlisted in "
        f"{rng.choice(['1941', '1942', '1943'])}. With the {division} (\"{nickname}\") "
        f"he {rng.choice(episodes)}. The men called him \"{quirk}\" — "
        f"{rng.choice(PERSONAL)}. {first} meant to go home when it was over."
    )
    return {"unit": division, "backstory": backstory}


def cause_phrase(cause: str) -> str:
    """'Mortar bombardment' -> 'mortar bombardment', but keep 'MG42 fire' / 'K98 rifle fire'.

    The fallback cause is 'Killed in action', which lowercasing turns
    into 'killed in action' — and the epitaph template already says
    "was killed by", so it read "was killed by killed in action"
    (bug #15). A generic cause becomes 'enemy fire' instead.
    """
    if cause.strip().lower() == "killed in action":
        return "enemy fire"
    if len(cause) > 1 and cause[1].islower():
        return cause[0].lower() + cause[1:]
    return cause


def make_epitaph(doc: dict, cause: str, mission_code: str, location: str, kills: int) -> str:
    rng = random.Random(doc["id"])
    rank = rank_for(doc.get("missions", 0))
    first = doc["name"].split(" ")[0]
    ops = doc.get("missions", 0)
    record = (
        f"{ops} operation{'s' if ops != 1 else ''} behind him and {kills} confirmed"
        if ops
        else f"his first operation, {kills} confirmed"
    )
    return (
        f"{doc.get('backstory', '')} \n\n{rank} {doc['name']} was killed by {cause_phrase(cause)} "
        f"during {mission_code} at {location} — {record}. {rng.choice(EPITAPHS)} "
        f"{first} never made it home."
    ).strip()


def make_soldier(unit_type: str, status: str = "reserve") -> dict:
    rng = random.Random(random.SystemRandom().getrandbits(64))
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
    hometown = rng.choice(HOMETOWNS)
    quirk = rng.choice(QUIRKS)
    return {
        "id": str(rng.getrandbits(122)),
        "name": name,
        "type": unit_type,
        "status": status,
        "xp": 0,
        "kills": 0,
        "missions": 0,
        "quirk": quirk,
        "hometown": hometown,
        "portrait_seed": rng.getrandbits(31),
        "hired_at": now,
        **make_backstory(name, hometown, quirk, rng),
    }
