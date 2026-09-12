"""Cut the fly out of Hannah Davis's microscope photograph, keeping the wing.

The background is a sheet of white paper lit unevenly, so it is modelled as a smooth surface fitted to
the border of the frame and subtracted; what is left is what is darker than the paper. Two thresholds and
a hysteresis fill keep the faint translucent wing attached to the solid body without dragging in the cast
shadow, which is broad, soft and never crosses the strong threshold.
"""
import numpy as np, sys
from PIL import Image
from scipy import ndimage as ndi

src, out_dir = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
a = np.asarray(im).astype(np.float64) / 255.0
h, w, _ = a.shape
lum = a @ np.array([0.2126, 0.7152, 0.0722])

# --- background: a quadratic surface fitted to a border frame of the image, which is all paper
yy, xx = np.mgrid[0:h, 0:w] / max(h, w)
border = np.zeros((h, w), bool)
m = int(0.06 * min(h, w))
border[:m, :] = border[-m:, :] = border[:, :m] = border[:, -m:] = True
A = np.stack([np.ones_like(xx), xx, yy, xx * xx, xx * yy, yy * yy], -1)
coef, *_ = np.linalg.lstsq(A[border], lum[border], rcond=None)
bg = A @ coef
resid = bg - lum                      # positive where the subject is darker than the paper

# --- saturation helps: the fly is warm, the paper and its shadow are neutral
mx, mn = a.max(-1), a.min(-1)
sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)

strong = (resid > 0.20) | ((resid > 0.11) & (sat > 0.22))
weak = (resid > 0.075) | (sat > 0.17)   # the contact shadow is neutral and soft; this clears it
strong = ndi.binary_opening(strong, np.ones((5, 5)))
lab, n = ndi.label(strong)
if n:
    sizes = ndi.sum(strong, lab, range(1, n + 1))
    strong = lab == (1 + int(np.argmax(sizes)))   # the fly, not a speck of paper grain
mask = ndi.binary_propagation(strong, mask=weak)  # grow into the faint wing, stop at the paper
mask = ndi.binary_closing(mask, np.ones((5, 5)))

# Fill only SMALL holes. A 9x9 closing plus an unconditional fill bridged the gaps between the legs and
# under the abdomen, so the cutout carried patches of white paper that read as a halo on a dark page.
holes = ndi.binary_fill_holes(mask) & ~mask
hl, hn = ndi.label(holes)
if hn:
    hs = ndi.sum(holes, hl, range(1, hn + 1))
    # A hole is part of the fly (a specular highlight on the cuticle) if it is dark relative to the paper.
    # A hole that is as pale as the paper IS the paper, seen between the legs, whatever its size.
    hr = ndi.mean(resid, hl, range(1, hn + 1))
    keep_h = 1 + np.flatnonzero((hs < 2500) & (np.asarray(hr) > 0.10))
    mask = mask | np.isin(hl, keep_h)

# The contact shadow reaches the same weak threshold the wing does, and it is attached to the feet, so it
# cannot be dropped as a separate component. It is neutral and pale, and the fly is neither.
# Only pale regions that reach the OUTSIDE of the silhouette are shadow. A pale patch entirely inside the
# fly is a specular highlight on the cuticle, and removing those punched black holes through the thorax.
pale = (resid < 0.10) & (sat < 0.14) & mask
pl, pn = ndi.label(pale)
if pn:
    outside = ndi.binary_dilation(~mask, np.ones((3, 3)))
    touches = ndi.sum(outside, pl, range(1, pn + 1))
    ps = ndi.sum(pale, pl, range(1, pn + 1))
    mask &= ~np.isin(pl, 1 + np.flatnonzero((np.asarray(touches) > 0) & (np.asarray(ps) > 150)))

# No blanket "looks like paper" subtraction: it punched holes in every specular highlight on the
# cuticle, which on a dark page read as white speckles all over the fly. Leaving the small-hole rule to
# do the work keeps the gaps between the legs open, which is what the halo actually was.
mask = ndi.binary_opening(mask, np.ones((3, 3)))
lab, n = ndi.label(mask)
sizes = ndi.sum(mask, lab, range(1, n + 1))
keep = 1 + np.flatnonzero(sizes > 0.02 * sizes.max())   # body, wing and legs; not paper grain
mask = np.isin(lab, keep)

# Erode by a pixel before feathering: a JPEG edge carries half a pixel of background colour with it, and
# on a dark page that shows up as a bright rim.
mask_e = ndi.binary_erosion(mask, np.ones((3, 3)))
alpha = ndi.gaussian_filter(mask_e.astype(np.float64), 1.2)
alpha = np.clip((alpha - 0.40) / 0.40, 0, 1)

ys, xs = np.where(alpha > 0.02)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
pad = 6
y0, x0 = max(0, y0 - pad), max(0, x0 - pad)
y1, x1 = min(h, y1 + pad), min(w, x1 + pad)
rgba = np.dstack([a, alpha])[y0:y1, x0:x1]
print(f"mask {mask.sum()} px, bbox {x1-x0} x {y1-y0}, coverage {mask.sum()/((y1-y0)*(x1-x0)):.1%}")

cut = Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), 'RGBA')
cut.save(f'{out_dir}/fly_cut_full.png')
for wpx in (512, 256, 128):
    cut.resize((wpx, max(1, round(wpx * cut.height / cut.width))), Image.LANCZOS).save(f'{out_dir}/fly_{wpx}.png')
print('wrote', cut.size)
