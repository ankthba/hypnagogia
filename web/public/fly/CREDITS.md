# The fly

`fly-256.png` and `fly-128.png` are cut out of a photograph of a real *Drosophila melanogaster*:

- **Title:** Standing female Drosophila melanogaster
- **Photographer:** Hannah Davis
- **Source:** Wikimedia Commons, https://commons.wikimedia.org/wiki/File:Standing_female_Drosophila_melanogaster.jpg
- **Licence:** Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0),
  https://creativecommons.org/licenses/by-sa/4.0
- **Original:** 2560 x 1920, taken 2019-03-15. The photographer's description: a female *Drosophila
  melanogaster* standing on a white piece of paper, photographed with a USB microscope.

The only change is that the paper behind her has been removed, by `scripts/cutout_fly.py`, which models the
lit paper as a smooth surface, subtracts it, and keeps what is darker. Nothing was painted in and nothing was
retouched; every pixel of the fly is the photograph's own.

Because CC BY-SA 4.0 is a share-alike licence, these two cut-out files are themselves CC BY-SA 4.0. The
attribution appears on the site in the colophon.

## The flying fly

`flight-256.png` and `flight-128.png` are cut out of a second photograph, used while she is in the air,
because the standing fly's wings are folded over her abdomen and a flying fly's are not:

- **Title:** Drosophila melanogaster isometric view
- **Photographer:** Lgcerda
- **Source:** Wikimedia Commons,
  https://commons.wikimedia.org/wiki/File:Drosophila_melanogaster_isometric_view.jpg
- **Licence:** Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0),
  https://creativecommons.org/licenses/by-sa/4.0
- **Original:** 1304 x 1630, taken 2024-08-08. A *Drosophila melanogaster* with her wings raised, on a wet
  surface beside a leaf.

Cut out by `scripts/cutout_fly_flight.py`. This background could not be subtracted the way the first one
was, because the wet brown surface and the green leaf are darker than the fly in places and lighter in
others. What separates them instead is depth of field: the fly is the only thing in focus, so the cut is
made on local high-pass energy, with the leaf removed by green dominance (no part of a fly is green) and
the wet highlights by being pale and neutral (she is neither). The sprite is then rotated by the 31.1
degrees between her body centroid and the centroid of her red eyes, so that her head points along the same
axis as the standing photograph's and one heading serves both.

Nothing was painted in. This file is CC BY-SA 4.0 for the same share-alike reason as the first.
