# Neuron map: visual specification

Validated by rendering the real atlas offline; see the reference image the owner was sent. Reproduce this.

## Framing

*Superseded in part: the map is now an orbitable 3D point cloud, not a set of fixed 2D projections. The
frontal view is the camera's default orientation (azimuth 0, elevation 0) rather than a choice of projection,
and there are no dorsal and sagittal buttons because both are orbit angles. Everything else below still
holds. See "The map is a 3D point cloud the reader can orbit" at the end of this file.*

- Default orientation **frontal**: horizontal = atlas x, vertical = atlas y **increasing downward**. Dorsal
  (x, z) and sagittal (z, y) are reached by orbiting rather than by a control.
- **Frame the brain, not the full soma extent.** Use `view_boxes.brain` from `neuron_atlas.json`, and draw only
  neurons inside it by default. A bounding box over every soma includes the 1,820 ascending neurons whose cell
  bodies sit in the ventral nerve cord and squashes the brain into the top third of the frame - that was the
  bug. Offer a "show ventral nerve cord somata" toggle that switches to `view_boxes.all`; when it is on, say
  that those neurons are simulated and only their somata lie outside the brain (`soma_outside_brain_note`).
- Preserve aspect ratio, centre in the canvas, pad about 1.5% of the box on each side. Brain aspect ratios:
  frontal 1.87:1, dorsal 2.68:1, sagittal 0.70:1. The canvas takes the frontal aspect, which is the aspect at
  the default camera; orbiting away from it does not reshape the panel.

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
- *Superseded:* the offscreen-blit scheme below was for the 2D projections. In the 3D renderer every point
  moves whenever the camera moves, so there is nothing static to cache: the whole cloud is uploaded to the GPU
  once and redrawn each frame as nine `drawArrays` calls plus one for the lit neurons.
- Show the count of neurons spiking in the current window, read from the data.

## Panel furniture
Legend with a swatch, the group name and its count read from `group_counts_in_brain_view`. A one-line source
statement naming what is playing. Controls: zoom in, zoom out, reset view, play/pause, and the condition and
seed of the run being played. There is no projection control: orbiting replaced it.
Caption: these are soma positions, not morphology; receptor neurons have no soma in the volume and are absent
from the map though still simulated (use the sidecar's counts and `soma_outside_brain_note`, never hard-coded).

## Corrections from reviewing the live site

1. **Default projection is frontal**, not dorsal. Frontal is the view a reader recognises as a fly brain
   (optic lobes either side, mushroom-body calyces at the top). The panel's aspect should follow the
   projection rather than the projection being chosen to fit a fixed panel aspect.
2. **Do not burn the caption into the canvas.** The source line and the run's identity belong in the panel's
   HTML below the canvas, where they are selectable and translatable. Drawing them into the bitmap as well
   duplicates the text and clutters the image. Keep only the scale bar and the orientation readout on the
   canvas itself. (The reference clips this originally referred to no longer exist: the map plays the
   experiment's own output or nothing.)
3. **Give the main column more room.** At 1440 px the content should be roughly 780-820 px wide with the rail
   at 380-400 px, rather than leaving a wide empty margin.

## The map must be live on every page

Reported by the owner: "the neuron map only does stuff on the replay page none of the other pages."

The cause is that the panel only renders activity that the Replay page publishes into a shared context, so on
Overview, Criticality, Learning and Methods the canvas is a still image.

Required behaviour: the map panel loads and plays activity **itself**, on every route, and does not depend on
any page publishing to it.

- The panel owns a condition selector (sleep, wake, sleep_naive) and a seed selector, populated from the
  `replay/activity_<condition>_seed<k>.json` files that actually exist. It defaults to the sleep condition and
  the lowest available seed.
- On the Replay page, if the reader changes the seed or condition there, the panel follows that selection, so
  the two stay in step. On every other route the panel's own selection governs.
- Playback starts automatically on every route, except under `prefers-reduced-motion`, where it starts paused
  with a visible play control.
- Only files the experiment produced may play. If the selected condition and seed have no activity file, the
  panel says so, names the missing file and `scripts/06_replay.py`, and shows the static atlas. It must never
  fall back to another seed's data silently, and there are no reference clips any more.
- Load lazily: fetch only the selected file, not all of them. The activity binaries total tens of megabytes.

## The map is a 3D point cloud the reader can orbit

Reported by the owner: "for the neuron maps screw the simulations. i want only the real thing there.
also make it a 3d model the user can move around and zoom in and out on."

This replaces the three fixed projections above: they are all still reachable, as orbit angles, and the
projection control is gone.

- **Default view = the frontal projection.** At azimuth 0 and elevation 0 the camera looks along the
  anterior-posterior axis with atlas x horizontal and atlas y increasing downward. Orbiting from there
  reaches the dorsal (x, z) and sagittal (z, y) views and everything between them.
- **Controls.** Drag to orbit; scroll or pinch to zoom; `+` / `-` buttons; a reset control that returns to
  the default view at the framing distance; arrow keys to turn, `+` / `-` to zoom and `0` to reset when the
  canvas has focus. Orbiting has momentum and damping, and the view turns slowly by itself after a few
  seconds of no interaction, stopping the instant the reader touches it and never running at all under
  `prefers-reduced-motion`.
- **Touch and wheel must never trap the page.** `touch-action: pan-y` on the canvas: a drag the browser
  reads as a vertical pan is a page scroll and never reaches the map, a drag that starts sideways orbits in
  both axes, and two fingers pinch to zoom. A wheel that arrives while the page is already scrolling passes
  straight through; a trackpad pinch (ctrl+wheel) always zooms; at either end of the zoom range the wheel is
  not swallowed at all.
- **Renderer.** Hand-rolled WebGL, no new dependency: one vertex per soma, all 126,109 uploaded once, and a
  frame is nine `drawArrays` calls plus one for the neurons that spiked (measured at 1.2 ms per frame with a
  GPU sync, so the whole atlas is drawn every frame and nothing is subsampled). A browser with no WebGL falls
  back to a JavaScript painter's renderer with depth bucketing, which caps the two *background* populations
  (optic, other, unlisted codes) and never the named ones, and the panel then prints how many of how many
  points it drew.
- **Framing.** Still `view_boxes.brain` by default, with the ventral-nerve-cord toggle switching to
  `view_boxes.all`. The canvas takes the frontal aspect of that box and the framing distance is the eye
  distance at which the frontal face exactly fills the frame with 1.5% of the box padded on each side; zoom
  is a multiple of that distance.
- **Depth.** There is no depth test: the paint order in the table above stays absolute, so 32 dFB cells are
  never lost behind 90,805 optic-lobe cells. Depth is carried by point size and by fading with distance
  instead, for the lit neurons exactly as for the static cloud, and the caption says so. A point smaller than
  one device pixel is drawn at one pixel with its alpha scaled by the area it should have covered rather than
  being floored.
- **Text stays out of the bitmap.** Only the scale bar and the orientation readout sit over the picture, and
  both are HTML overlays. The scale bar is true at the depth of the box centre only, and says so.

## The rail has no scrollbar of its own

Reported by the owner: "dont have that have an individual scroll just let it use the main pages scroll."

No `max-height` and no `overflow-y` on `.rail`. It is sized to its content and scrolls with the page. When
the panel is taller than the viewport its sticky offset is set to minus its overflow, so it travels with the
page and pins by its bottom; pinning by the top would make its own provenance line permanently unreachable.
