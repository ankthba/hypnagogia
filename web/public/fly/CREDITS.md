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
