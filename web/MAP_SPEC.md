# Neuron map: visual specification

Validated by rendering the real atlas offline; see the reference image the owner was sent. Reproduce this.

## Framing
- Default projection **frontal**: horizontal = atlas x, vertical = atlas y **increasing downward**.
  Also offer **dorsal** (x, z) and **sagittal** (z, y), both with the vertical axis increasing downward.
- **Frame the brain, not the full soma extent.** Use `view_boxes.brain` from `neuron_atlas.json`, and draw only
  neurons inside it by default. A bounding box over every soma includes the 1,820 ascending neurons whose cell
  bodies sit in the ventral nerve cord and squashes the brain into the top third of the frame - that was the
  bug. Offer a "show ventral nerve cord somata" toggle that switches to `view_boxes.all`; when it is on, say
  that those neurons are simulated and only their somata lie outside the brain (`soma_outside_brain_note`).
- Preserve aspect ratio, centre in the canvas, pad about 1.5% of the box on each side. Brain aspect ratios:
  frontal 1.87:1, dorsal 2.68:1, sagittal 0.70:1. The canvas should follow the selected projection's aspect
  rather than being a fixed box, so the brain always fills the frame.

## Colours and point sizes
Point radius in CSS pixels at a canvas width of about 400 px, scaled linearly with canvas width.

| group | dark colour | light colour | radius | alpha | draw order |
|---|---|---|---|---|---|
| optic | `#38342e` | `#d6d2c8` | 0.32 | 0.55 | 1 (first, behind) |
| other | `#413e38` | `#cdc9bf` | 0.40 | 0.55 | 2 |
| ALPN | `#a49d90` | `#6f695e` | 0.80 | 0.95 | 3 |
| CX | `#8fb3d4` | `#2f5575` | 0.80 | 0.95 | 4 |
| ORN | `#a49d90` | `#6f695e` | 0.80 | 0.95 | 5 |
| KC | `#e8e6df` | `#3a3632` | 1.20 (0.85 in light) | 0.95 | 6 |
| DAN | `#8fbf88` | `#4f7a4a` | 1.90 | 1.0 | 7 |
| MBON | `#d98b82` | `#9a3f35` | 2.60 | 1.0 | 8 |
| dFB | `#e0b96a` | `#b07d15` | 3.30 | 1.0 | 9 (last, on top) |

Small populations are drawn last and larger so 32 dFB neurons are not lost among 90,805 optic-lobe cells.
Canvas background = the page background token, so the panel reads as part of the page.

## Activity
- A neuron that spikes inside the current window is drawn **on top** of the static layer, at 2.2x its group
  radius, in the accent colour (`--color-link`: `#8fb3d4` dark / `#2f5575` light), fading to its group colour
  over a 150 ms tail. Never leave a permanently lit point: the tail must decay.
- Draw the static atlas ONCE into an offscreen canvas at device resolution and blit it each frame; only lit
  points are drawn per frame. Redraw the static layer only on resize, projection change, or theme change.
- Show the count of neurons spiking in the current window, read from the data.

## Panel furniture
Legend with a swatch, the group name and its count read from `group_counts_in_brain_view`. A one-line source
statement naming what is playing. Controls: projection, play/pause, source (when more than one is available).
Caption: these are soma positions, not morphology; receptor neurons have no soma in the volume and are absent
from the map though still simulated (use the sidecar's counts and `soma_outside_brain_note`, never hard-coded).

## Corrections from reviewing the live site

1. **Default projection is frontal**, not dorsal. Frontal is the view a reader recognises as a fly brain
   (optic lobes either side, mushroom-body calyces at the top). The panel's aspect should follow the
   projection rather than the projection being chosen to fit a fixed panel aspect.
2. **Do not burn the clip caption into the canvas.** The source line, clip title and "not the replay result"
   label belong in the panel's HTML below the canvas, where they are selectable and translatable. Drawing them
   into the bitmap as well duplicates the text and clutters the image. Keep only the scale bar and the axis
   note on the canvas itself.
3. **Give the main column more room.** At 1440 px the content should be roughly 780-820 px wide with the rail
   at 380-400 px, rather than leaving a wide empty margin.
