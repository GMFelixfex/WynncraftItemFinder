# Wynncraft Item Finder for Wynntills

Turn Wynncraft item drops or other items into Wynntills map waypoints. Search an item, convert its drop locations, and see them on the map.

## Quick Start
- Open [index.html](index.html) or use the hosted [GitHub Pages](https://gmfelixfex.github.io/WynncraftApiToWynntills/).
- Type an item name (like Green Opal) and press Search.
- If you see many matches, pick the right one in 'Results' and click 'Load Selected'.
- Choose an icon and a color if you want.
- Click Convert, then Copy to save the waypoints.
- Click Render on Map to see the pins. Use Zoom, Reset View, Fit to Waypoints, and Go to for easy navigation.

## Import into Wynntills
- Open the Wynntills map (default key: M).
- Click Manage Waypoints (pin icon) → Import.
- Paste the JSON and confirm.

## Features
- Fast item search with friendly selection when there are multiple matches.
- Editable item JSON before converting.
- One-click conversion to Wynntills waypoint format.
- Map preview with zoom/pan, labels, radius circles, Fit to Waypoints, and Go to.

## Helpful Tips
- Short names (like “Az”) can return lots of items — use Results.
- If an item has no drop data, the output will be empty, if this happens then it is likely a world event item or normal chest loot.
- If search fails, enable the “Use CORS proxy” toggle.

## Want the technical details?
See the full guide in [DETAILS.md](DETAILS.md). It covers all the technical details, including the API, exact naming rules, coordinate math, map offsets, proxy behavior, and more.

