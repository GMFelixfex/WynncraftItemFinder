# Wynncraft → Wynntills Waypoint Converter (Technical Details)

This document contains advanced details for those interested in the technical aspects. For a friendly overview, see [README.md](README.md).

## Usage (Advanced)
- Open [index.html](index.html) locally or use the hosted [GitHub Pages](https://gmfelixfex.github.io/WynncraftApiToWynntills/). Enable the CORS proxy if your browser blocks the API.
- Enter an item name and search. When multiple matches are returned, the `Results` dropdown lists all candidates; `Load Selected` loads the chosen item into the editor.
- You can edit the item JSON directly before conversion.
- Choose an `icon` and `color` (outputs 8-digit hex with full opacity).
- Click `Convert` to generate the waypoints JSON and `Render on Map` to preview.

## How to import into Wynntills
- Copy the output JSON.
- Open the map in Wynntills (Default: `M` key)
- In the map window click on the pin icon "Manage Waypoints" in the toolbar. 
- Click "Import" Button

## Tips
- Multiple results: Short queries (e.g., `Az`) can return many items; use the `Results` dropdown to select the intended item.
- Empty data: If there is no `droppedBy` or `dropMeta`, the output is an empty array.
- Map fit: Use `Fit to Waypoints` to frame all pins within the visible viewport.

---

# Backend Details

If you want to implement similar functionality, here are the relevant details:

## API
- Endpoint: `https://api.wynncraft.com/v3/item/search/{itemName}`
- Example: `https://api.wynncraft.com/v3/item/search/Green%20Opal`
- Coordinate sources:
  - `droppedBy[*].coords`: `[x, y, z, radius]`. Conversion uses `x/y/z`; `radius` (if present) is visualized.
  - `dropMeta.coordinates`: `[x, y, z]`. Included unless `dropMeta.type === "guild"`.

## Waypoint Format
As an example, each coordinate is converted to the following JSON object:

```json
{
  "name": "Angel Of Nature Green Opal 1",
  "color": "#ffffffff",
  "icon": "flag",
  "visibility": "default",
  "location": { "x": 123, "y": 45, "z": -678 }
}
```

Naming rules:
- droppedBy: `droppedBy.name - radius(m) - ItemName - index` (index starts from 1 for each source). This matches the converter output (space-separated).
- dropMeta: `dropMeta.name - ItemName` (hyphen separator; no radius).

### Color format
 - The color picker provides `#RRGGBB`. The tool appends `ff` alpha to produce `#RRGGBBff` (full opacity) to match the 8-digit format used in outputs.

## Supported Icons
`flag, diamond, fireball, sign, star, wall, chestT1, chestT2, chestT3, chestT4, farming, fishing, mining, woodcutting`

## Map Preview
- Map image: local `map/main-map.png` (4034×6414 PNG).
- Mapping: coordinate `x` → pixel `x`, coordinate `z` → pixel `y`.
- Offsets: `pixelX = x + 2383`, `pixelY = z + 6572`.
- Viewport: Canvas is clipped by `.map-viewport` (≈33vh) to focus on the visible region.
- Interactions:
  - Wheel zoom and buttons center on the viewport midpoint using CSS→canvas pixel conversion.
  - Drag panning uses internal canvas pixels for 1:1 movement.
  - Reset View recenters the map midpoint under the viewport midpoint.
  - Fit to Waypoints computes bounds of pins, chooses scale, and centers the bounding box.
  - Go to centers the selected waypoint at a default 6× zoom.
  - Toggles: `Show radius` and `Show labels`.
- Rendering:
  - Pins use the selected color (converted from `#RRGGBBAA` to `rgba(...)`).
  - Radius circles draw when `radius` exists (from `droppedBy[*].coords[3]`).
  - `dropMeta` pins have no radius.

## CORS Proxy
Enable `Use CORS proxy` if your browser blocks the API:
- Request format: `https://cors.io/?u=https://api.wynncraft.com/v3/item/search/{itemName}`
- Proxy wrapper: `{ url, status, headers, body }`, where `body` is the original API JSON as a string; the app parses `body` automatically.

## Project Structure
- [index.html](index.html): UI panels (Search, JSON editor, Waypoints, Map Preview, Notes).
- [script.js](script.js): Search, conversion, map rendering, viewport-aware interactions, multi-result handling.
- [style.css](style.css): Theme, layout, and component styling.

