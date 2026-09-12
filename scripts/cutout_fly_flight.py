"""Cut the wings-out fly out of the isometric photograph, using focus rather than brightness.

The background here is a wet brown surface and a green leaf, both of which are darker than the fly in
places and lighter in others, so the subtract-the-paper trick that worked for the standing photograph is
useless. What does separate them is depth of field: the fly is the only thing in focus. Local high-pass
energy finds it, and the wings, whose veins are sharp, come with it.
"""
import numpy as np, sys
from PIL import Image
from scipy import ndimage as ndi

im = Image.open(sys.argv[1]).convert('RGB')
a = np.asarray(im).astype(np.float64) / 255.0
lum = a @ np.array([0.2126, 0.7152, 0.0722])

# local sharpness: energy of the difference between the image and a blurred copy
hp = lum - ndi.gaussian_filter(lum, 2.0)
energy = ndi.uniform_filter(hp * hp, 11)
e = energy / (energy.max() + 1e-12)

# The leaf she is standing on is in focus too, so focus alone is not enough. It is green, and no part
# of a fly is: cutting on green dominance removes it and cannot touch the tan cuticle or the red eyes.
mx, mn = a.max(-1), a.min(-1)
sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
green = (a[..., 1] > a[..., 0] * 1.02) & (sat > 0.10)
# The wet surface under her is in focus in places as well. It is pale and neutral, and she is neither.
palewet = (lum > 0.66) & (sat < 0.11)
notfly = green | palewet

strong = (e > 0.055) & ~notfly
strong = ndi.binary_opening(strong, np.ones((7, 7)))
lab, n = ndi.label(ndi.binary_closing(strong, np.ones((15, 15))))
if n:
    sizes = ndi.sum(strong, lab, range(1, n + 1))
    strong = lab == (1 + int(np.argmax(sizes)))
weak = (e > 0.012) & ~notfly
mask = ndi.binary_propagation(strong, mask=ndi.binary_closing(weak, np.ones((5, 5))))
mask = ndi.binary_closing(mask, np.ones((13, 13)))
holes = ndi.binary_fill_holes(mask) & ~mask
hl, hn = ndi.label(holes)
if hn:
    hs = ndi.sum(holes, hl, range(1, hn + 1))
    mask |= np.isin(hl, 1 + np.flatnonzero(hs < 20000))
mask &= ~green   # a hole fill must not put the leaf back
# Close the speckle the focus threshold leaves inside the wings and on the thorax: those are parts of
# the fly that happen to be smooth, not background, and at 32 px a chewed wing edge is all you see.
mask = ndi.binary_closing(mask, np.ones((9, 9)))
mask = ndi.binary_fill_holes(mask) & ~green
lab, n = ndi.label(mask)
sizes = ndi.sum(mask, lab, range(1, n + 1))
mask = lab == (1 + int(np.argmax(sizes)))

alpha = ndi.gaussian_filter(ndi.binary_erosion(mask, np.ones((3, 3))).astype(np.float64), 1.4)
alpha = np.clip((alpha - 0.40) / 0.40, 0, 1)
ys, xs = np.where(alpha > 0.02)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
pad = 6
h, w = alpha.shape
y0, x0 = max(0, y0 - pad), max(0, x0 - pad)
y1, x1 = min(h, y1 + pad), min(w, x1 + pad)
cut = Image.fromarray((np.clip(np.dstack([a, alpha])[y0:y1, x0:x1], 0, 1) * 255).astype(np.uint8), 'RGBA')
print(f"mask {mask.sum()} px, bbox {x1-x0} x {y1-y0}, coverage {mask.sum()/((y1-y0)*(x1-x0)):.1%}")
cut.save('iso_cut.png')
for wpx in (256, 128):
    cut.resize((wpx, max(1, round(wpx * cut.height / cut.width))), Image.LANCZOS).save(f'iso_{wpx}.png')
bg = Image.new('RGBA', cut.size, (26, 26, 26, 255)); bg.alpha_composite(cut); bg.convert('RGB').save('iso_dark.png')
