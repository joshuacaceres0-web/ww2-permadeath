# VANGUARD '44 — Interactive Campaign Map

A pixel-art map of the division's road from the Normandy beaches to the Hürtgen Forest, drawn in the game's gritty 16-bit style.
It shows the four operations as tappable markers on the route. Each marker opens that operation's briefing, and from there the Active one can be deployed. Poppies mark where your men fell.

## Who it's for
- The player of VANGUARD '44, on desktop or phone, who wants to see where the campaign stands and where their men died.

## Core features and experience
- **Pixel-art map**: Normandy, northern France, Belgium and the German border up to the Hürtgen Forest. It is drawn in the same muddy 16-bit palette, Silkscreen/pixel fonts and bevelled frames as the rest of the game, with coastline, sea, rivers, forest areas and a few town names.
- **Four operation markers, in order**:
  1. OPERATION OVERLORD, Normandy, 6 June 1944
  2. OPERATION SILENT CHATEAU, Valognes Estate
  3. OPERATION IRON CROSSROADS, Carentan Causeway
  4. OPERATION PERMAFROST FLAK, Hürtgen Forest Bunker Complex
- **Status on every marker**: SECURED, ACTIVE or LOCKED, taken from the same campaign progress the War Room uses, so the two always agree.
  - The Active marker pulses in amber.
  - Secured markers show a flag.
  - Locked markers are greyed out with a padlock.
- **Route line**: A dotted pixel line joins the operations in order. The part already fought over is solid, and the road still ahead is dashed and dim.
- **Briefing panel**: Tapping any marker opens that operation's briefing: code name, place, threat level, RP reward, objective, enemy intel by wave, and how many men fell there.
  - **Active operation**: The panel has a DEPLOY button that works exactly like the War Room's Deploy, including the D-Day choice of beach landing or airborne drop.
  - **Secured or Locked operations**: The briefing can be read but has no Deploy button.
- **Fallen men**: Every name on the Memorial Wall appears as a small red pixel poppy around the operation where he died. Tapping a poppy shows his rank, name and cause of death, with a link to the Memorial.
- **Read-only**: The map never changes squad, requisition, save or Memorial data, and it never resets the campaign.

## User flow
1. The player opens the War Room, which shows the list exactly as it does today.
2. They tap the MAP switch at the top of the War Room, and the map replaces the list in place. Tapping LIST brings the list back, and the choice is remembered on that device.
3. They tap a marker, and its briefing opens beside the map on desktop or as a bottom sheet on a phone.
4. On the Active operation they tap DEPLOY. This opens the battle exactly as the War Room's Deploy does, with the D-Day choice for Overlord.
5. They tap a poppy and see who fell there.

## UI/UX feel
- The map should look like a stained wartime field map seen on a 16-bit screen: a dithered parchment-olive land, a dark sea and chunky coastlines.
- Labels are stencil-style, set in the pixel fonts.
- Animation is small and stepped, in keeping with the pixel style:
  - the Active marker blinks
  - the route line draws itself in when the map opens
  - poppies sway slightly
- On phones the whole map fits the screen, held upright or sideways, and the markers are large enough to tap easily.

## Implementation phases
- **Phase 1 (MVP, built now)**: Everything above:
  - the War Room MAP/LIST switch
  - the pixel map with the 4 operations, their status and the route line
  - the tap-to-open briefing, with Deploy for the Active operation only
  - Memorial poppies with tap-for-details
  - a layout that works on phones
- **Phase 2**:
  - the squad's journey drawn on the map after each battle, with date stamps and battle results (win/loss count) at each operation
  - a short animated "advance" when a new operation is unlocked
- **Phase 3**:
  - pinch-to-zoom and pan on the map
  - weather and day/night tinting
  - a tap-to-read divisional history note for each place

## Assumptions
- None of the three questions were answered, so the recommended options were used:
  - the map is a MAP/LIST switch inside the War Room, not a separate tab
  - each fallen man gets his own poppy
  - Secured and Locked briefings can be read, but only the Active operation can be deployed
- The Hürtgen Forest is in Germany, not France. The map extends east past Belgium to the German border so that the last operation is in its real place.
- Markers sit at the real locations: Normandy beaches, Valognes, Carentan and the Hürtgen Forest near Aachen. The map is a stylised drawing, not exact cartography.
- The order of the operations follows the game (Valognes before Carentan), even though Carentan was historically fought first.
- Only Overlord shows a date (6 June 1944), as given. The other markers show their place name and no invented dates.
- The Memorial records which operation a man died in, not an exact spot. Poppies are scattered in a small cluster around that operation's marker, and their positions stay the same on every visit.
- Fallen men whose operation can't be matched, for example from an older save, appear in a small "Unknown ground" group at the edge of the map.
- Only the current, Active operation can be deployed. Secured operations cannot be replayed, the same rule as today.
- When the campaign is complete, all four markers show SECURED and no Deploy button appears.
