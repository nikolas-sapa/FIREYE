# Image lab test scenes

Illustrative inputs, not ground-truth fuel labels or operational incident imagery. Local JPEG copies are resized to a maximum 1,600 px edge. The browser strips metadata when preparing a scene for submission. No external image request is made when opening the proposal.

| Local file | Source and author | Reuse | Suggested check |
|---|---|---|---|
| `forest.jpg` | [Drone Forest](https://commons.wikimedia.org/wiki/File:Drone_Forest_(Unsplash).jpg), Geran de Klerk; Gävle, Sweden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) as documented by Commons for the pre-June-2017 Unsplash publication | Canopy versus shadow; do not invent understory, moisture, or species. |
| `village.jpg` | [Aerial view of small village](https://commons.wikimedia.org/wiki/File:Aerial_view_of_small_village.jpg), U.S. Fish and Wildlife Service | U.S. federal-government public domain, per source page | Buildings and surrounding vegetation; resolution limits on small objects. This is aerial photography, not asserted to be drone footage. |
| `quarry.jpg` | [The surface mine storage place](https://commons.wikimedia.org/wiki/File:The_surface_mine_storage_place._(Unsplash).jpg), Mariusz Prusaczyk; Poland | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) as documented by Commons for the pre-June-2017 Unsplash publication | Material-pile ambiguity. The source describes minerals and brown coal, but that context is NOT sent to the model: assess whether it overclaims composition from pixels. Not a guaranteed non-combustible negative control. |

Sources and licensing checked 2026-11-15. The Commons pages for the two historic Unsplash imports carry review-needed categories; preserve their source history and verify rights again before redistributing outside this prototype.

These scenes are deliberately diverse but do not cover Mediterranean brush, confirmed dead fuels, or labeled woodpiles. Add permission-cleared local drone frames and expert annotations for those conditions before drawing conclusions about performance. Compare missed objects, false alarms, class consistency, and geometry drift across models. Do not score generated overlays as fire-risk truth.
