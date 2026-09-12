import { useEffect, useRef } from 'react';

/**
 * A fruit fly on the inside of the screen.
 *
 * She is a photograph, not a drawing: a female Drosophila melanogaster photographed on a sheet of
 * white paper under a USB microscope by Hannah Davis, CC BY-SA 4.0, from Wikimedia Commons, with the
 * paper subtracted by scripts/cutout_fly.py and nothing painted in. web/public/fly/CREDITS.md carries
 * the full attribution and the colophon shows it on the site.
 *
 * The photograph was never the problem. What made the first version read as a sticker was the
 * MOTION: it cruised in smooth arcs at a constant speed, banked into its turns like an aircraft, and
 * drifted to a halt. Real flies do almost none of that. What they do, and what this does now:
 *
 *  - They WALK, most of the time, in bursts of a second or two separated by dead stops.
 *  - They turn in saccades. A fly's heading changes in near-instant steps of tens of degrees, not in
 *    arcs, and the smooth curve was the single most artificial thing about the old motion.
 *  - They bob. The body rises and falls with the stepping gait, around ten steps a second.
 *  - They stop dead and groom, front legs over the head, for seconds at a time.
 *  - They fly rarely, briefly and fast: a burst of several hundred pixels a second lasting well under
 *    a second, ending in an abrupt arrival rather than a glide.
 *  - They flick their wings while standing, every few seconds, for about a tenth of a second.
 *  - And they startle. Move a hand near a fly and it is gone before you have finished moving. The
 *    pointer is tracked for exactly that: come within about a hundred pixels and she bolts, away from
 *    it, at once. Nothing else here makes her read as alive the way that does.
 *
 * She is decoration and nothing else: she carries no data, she is `pointer-events: none`, and she is
 * the only image on this site that is not read out of a data file (the colophon says so). She is
 * disabled entirely when the browser asks for reduced motion, and the colophon switch turns her off
 * (she starts off on touch screens and small viewports, where there is no pointer to flee).
 */

/**
 * Body length in CSS pixels. A Drosophila is about 2.5 mm and a house fly about 7 mm; at the 96 CSS
 * pixels per inch a browser assumes, those are 9 px and 26 px. 32 px is a large house fly, which is
 * the size that still reads as a fly rather than as a speck of grit. The photograph is 256 x 126.
 */
const FLY_W = 32;
const FLY_H = Math.round((FLY_W * 126) / 256);
const STEP = 1 / 60;
const MARGIN = 18;
/** Where the wing bases sit in the photograph, as a fraction of its box. */
const WING_X = 0.52;
const WING_Y = 0.34;
/** How close the pointer gets before she bolts, in CSS pixels. */
const STARTLE_PX = 110;
/** Stepping frequency of a walking fly, in steps per second. */
const STEP_HZ = 10.5;

type Mode = 'walk' | 'pause' | 'groom' | 'flight' | 'land';

interface State {
  x: number;
  y: number;
  /** heading in radians; 0 points right, which is the direction the photographed fly faces */
  a: number;
  speed: number;
  mode: Mode;
  /** seconds left in the current mode */
  timer: number;
  /** seconds until the next heading saccade while walking */
  nextTurn: number;
  /** seconds until the next idle wing flick */
  nextFlick: number;
  /** seconds until she takes off of her own accord */
  nextFlight: number;
  /** gait phase, radians */
  gait: number;
  /** grooming phase, radians */
  groom: number;
  /** apparent size: she is a little nearer the glass in the air than on it */
  scale: number;
  /** 1 while the wings are beating, eased */
  wing: number;
  tx: number;
  ty: number;
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const wrapPi = (r: number) => {
  let v = r;
  while (v > Math.PI) v -= 2 * Math.PI;
  while (v < -Math.PI) v += 2 * Math.PI;
  return v;
};

export default function FlyOrnament() {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const wingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The Layout also refuses to mount her under reduced motion and the CSS hides her; this is the
    // component's own guard, so the rAF loop never runs invisibly if it is ever mounted elsewhere.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const vw = () => window.innerWidth;
    const vh = () => window.innerHeight;

    const s: State = {
      x: rand(MARGIN, Math.max(MARGIN + 1, vw() - MARGIN)),
      y: rand(MARGIN, Math.max(MARGIN + 1, vh() * 0.6)),
      a: rand(-Math.PI, Math.PI),
      speed: 0,
      mode: 'pause',
      timer: rand(0.4, 1.6),
      nextTurn: rand(0.15, 0.7),
      nextFlick: rand(2, 7),
      nextFlight: rand(7, 22),
      gait: 0,
      groom: 0,
      scale: 1,
      wing: 0,
      tx: 0,
      ty: 0,
    };

    /** The pointer, in viewport coordinates, and whether it has ever moved. */
    const ptr = { x: -1e4, y: -1e4, seen: false };
    const onPointer = (e: PointerEvent) => {
      ptr.x = e.clientX;
      ptr.y = e.clientY;
      ptr.seen = true;
    };
    window.addEventListener('pointermove', onPointer, { passive: true });

    const newTarget = () => {
      const w = vw();
      const h = vh();
      for (let i = 0; i < 8; i++) {
        const tx = rand(MARGIN, Math.max(MARGIN + 1, w - MARGIN));
        const ty = rand(MARGIN, Math.max(MARGIN + 1, h - MARGIN));
        if (Math.hypot(tx - s.x, ty - s.y) > Math.min(w, h) * 0.2) {
          s.tx = tx;
          s.ty = ty;
          return;
        }
      }
      s.tx = rand(MARGIN, Math.max(MARGIN + 1, w - MARGIN));
      s.ty = rand(MARGIN, Math.max(MARGIN + 1, h - MARGIN));
    };
    newTarget();

    /** Take off. `away` is a heading she is fleeing along, if this is a startle. */
    const takeOff = (away?: number) => {
      s.mode = 'flight';
      // A startled fly leaves at once and fast; an unhurried one is slower and shorter.
      s.speed = away === undefined ? rand(260, 430) : rand(520, 820);
      s.timer = away === undefined ? rand(0.35, 0.9) : rand(0.5, 1.1);
      s.a = away === undefined ? s.a + rand(-0.7, 0.7) : away + rand(-0.45, 0.45);
      s.nextFlight = rand(7, 22);
      newTarget();
    };

    const advance = (dt: number) => {
      const w = vw();
      const h = vh();
      s.x = Math.min(Math.max(MARGIN, s.x), Math.max(MARGIN + 1, w - MARGIN));
      s.y = Math.min(Math.max(MARGIN, s.y), Math.max(MARGIN + 1, h - MARGIN));
      s.timer -= dt;
      s.nextFlight -= dt;

      // Startle. Checked in every grounded mode and before anything else, because the whole point of
      // it is that it interrupts whatever she was doing.
      if (ptr.seen && s.mode !== 'flight') {
        const dx = s.x - ptr.x;
        const dy = s.y - ptr.y;
        const d = Math.hypot(dx, dy);
        if (d < STARTLE_PX) {
          // Nearly always fly. Occasionally just run, which is what a fly does when the threat is
          // still some way off.
          if (d < STARTLE_PX * 0.72 || Math.random() < 0.7) {
            takeOff(Math.atan2(dy, dx));
          } else {
            s.mode = 'walk';
            s.speed = rand(95, 150);
            s.a = Math.atan2(dy, dx) + rand(-0.5, 0.5);
            s.timer = rand(0.5, 1.1);
            s.nextTurn = rand(0.2, 0.5);
          }
        }
      }

      if (s.mode === 'flight') {
        s.wing += (1 - s.wing) * Math.min(1, dt * 30);
        s.scale += (1.14 - s.scale) * Math.min(1, dt * 10);
        // She steers toward the target, but loosely: a flying fly is not tracking a waypoint.
        const want = Math.atan2(s.ty - s.y, s.tx - s.x);
        s.a += Math.max(-6 * dt, Math.min(6 * dt, wrapPi(want - s.a))) * 0.55;
        s.a += rand(-2.4, 2.4) * dt;
        s.x += Math.cos(s.a) * s.speed * dt;
        s.y += Math.sin(s.a) * s.speed * dt;
        if (s.timer <= 0) {
          s.mode = 'land';
          s.timer = 0.13;
        }
      } else if (s.mode === 'land') {
        // Abrupt. A fly does not flare out; it arrives.
        s.speed *= Math.pow(0.0008, dt);
        s.wing += (0 - s.wing) * Math.min(1, dt * 14);
        s.scale += (1 - s.scale) * Math.min(1, dt * 12);
        s.x += Math.cos(s.a) * s.speed * dt;
        s.y += Math.sin(s.a) * s.speed * dt;
        if (s.timer <= 0) {
          s.mode = 'pause';
          s.timer = rand(0.25, 1.2);
          s.speed = 0;
          s.nextFlick = rand(0.3, 1.4); // a wing flick shortly after landing, which is what they do
        }
      } else if (s.mode === 'walk') {
        s.wing += (0 - s.wing) * Math.min(1, dt * 12);
        s.scale += (1 - s.scale) * Math.min(1, dt * 8);
        s.gait += dt * STEP_HZ * 2 * Math.PI;
        s.nextTurn -= dt;
        if (s.nextTurn <= 0) {
          // The saccade. Mostly small course corrections, sometimes a sharp turn, and the whole
          // change lands inside a single frame rather than being eased into.
          const big = Math.random() < 0.22;
          s.a += (Math.random() < 0.5 ? -1 : 1) * (big ? rand(1.3, 2.6) : rand(0.15, 0.9));
          s.nextTurn = rand(0.12, 0.85);
        }
        // and a slow curve between saccades, so the straight lines are not perfectly straight
        s.a += rand(-0.55, 0.55) * dt;
        s.x += Math.cos(s.a) * s.speed * dt;
        s.y += Math.sin(s.a) * s.speed * dt;
        if (s.timer <= 0) {
          const r = Math.random();
          s.mode = r < 0.42 ? 'groom' : 'pause';
          s.timer = s.mode === 'groom' ? rand(1.1, 3.8) : rand(0.35, 2.6);
          s.speed = 0;
          s.groom = 0;
        }
      } else {
        // pause and groom: stopped dead. A stopped fly is stopped, not drifting.
        s.wing += (0 - s.wing) * Math.min(1, dt * 12);
        s.scale += (1 - s.scale) * Math.min(1, dt * 8);
        if (s.mode === 'groom') s.groom += dt * 8.5;
        if (s.timer <= 0) {
          s.mode = 'walk';
          s.speed = rand(28, 78);
          s.timer = rand(0.5, 2.4);
          s.nextTurn = rand(0.1, 0.5);
          if (Math.random() < 0.35) s.a += (Math.random() < 0.5 ? -1 : 1) * rand(0.3, 2.2);
        }
      }

      if (s.nextFlight <= 0 && (s.mode === 'walk' || s.mode === 'pause' || s.mode === 'groom')) takeOff();

      // Bounce off the edges rather than wrapping, so she never disappears.
      const lo = MARGIN;
      const hiX = Math.max(lo + 1, w - MARGIN);
      const hiY = Math.max(lo + 1, h - MARGIN);
      if (s.x <= lo || s.x >= hiX) {
        s.x = Math.min(hiX, Math.max(lo, s.x));
        s.a = Math.PI - s.a + rand(-0.3, 0.3);
        newTarget();
      }
      if (s.y <= lo || s.y >= hiY) {
        s.y = Math.min(hiY, Math.max(lo, s.y));
        s.a = -s.a + rand(-0.3, 0.3);
        newTarget();
      }
    };

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    // Attribute writes invalidate style for the subtree they touch, so each is written only when the
    // value it carries has actually changed.
    let wingOn = false;
    let mirrored = false;
    let lifted = false;
    let flickUntil = 0;

    const frame = (now: number) => {
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= STEP) {
        advance(STEP);
        acc -= STEP;
      }

      // The idle wing flick: a tenth of a second of wingbeat while she is standing, every few
      // seconds. It is a small thing and it is most of what makes a stationary fly look alive.
      if (s.mode !== 'flight' && s.mode !== 'land') {
        s.nextFlick -= STEP;
        if (s.nextFlick <= 0) {
          flickUntil = now + rand(70, 150);
          s.nextFlick = rand(2.2, 8);
        }
      }

      // A side view cannot be rotated through half a turn: that draws a fly walking upside down.
      // Heading is a rotation while she points right and a mirror plus the supplementary rotation
      // while she points left, with a dead band so a near-vertical heading does not flicker.
      const c = Math.cos(s.a);
      if (c < -0.1) mirrored = true;
      else if (c > 0.1) mirrored = false;
      const ang = mirrored ? s.a + Math.PI : s.a;
      el.style.transform =
        `translate3d(${(s.x - FLY_W / 2).toFixed(2)}px, ${(s.y - FLY_H / 2).toFixed(2)}px, 0) rotate(${ang.toFixed(4)}rad)`;

      const body = bodyRef.current;
      if (body) {
        // The gait bob, the grooming rock and the flight scale, in her own frame, so the bob is
        // vertical relative to her body rather than to the page.
        const bob = s.mode === 'walk' ? Math.sin(s.gait) * 0.55 : 0;
        const sway = s.mode === 'walk' ? Math.sin(s.gait / 2) * 1.6 : 0;
        const rock = s.mode === 'groom' ? Math.sin(s.groom) * 3.2 : 0;
        const sx = (mirrored ? -s.scale : s.scale).toFixed(3);
        body.style.transform =
          `translateY(${bob.toFixed(2)}px) scale(${sx}, ${s.scale.toFixed(3)}) rotate(${(rock + sway).toFixed(2)}deg)`;
      }

      const beating = s.wing > 0.25 || now < flickUntil;
      if (beating !== wingOn) {
        wingOn = beating;
        wingsRef.current?.setAttribute('data-flying', beating ? 'true' : 'false');
      }
      // In the air she is off the glass, so her shadow falls further away and softer.
      const nowLifted = s.scale > 1.03;
      if (nowLifted !== lifted) {
        lifted = nowLifted;
        el.setAttribute('data-lifted', nowLifted ? 'true' : 'false');
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
    };
  }, []);

  return (
    <div ref={ref} className="fly" aria-hidden="true" data-lifted="false">
      <div ref={bodyRef} className="fly__body">
        {/* the shadow she casts on the page under her: tight while she is standing on it, thrown
            further and softer while she is in the air */}
        <div className="fly__shadow" />
        {/* At about 200 beats a second a wing is a blur and not a shape, so it is drawn as one. The
            photograph's own wings are folded over her abdomen, which is where a standing fly keeps
            them. */}
        <div ref={wingsRef} className="fly__wingblur" data-flying="false" style={{ left: `${WING_X * 100}%`, top: `${WING_Y * 100}%` }}>
          <span className="fly__wingblur-a" />
          <span className="fly__wingblur-b" />
        </div>
        <img
          className="fly__photo"
          src={`${import.meta.env.BASE_URL}fly/fly-256.png`}
          width={FLY_W}
          height={FLY_H}
          alt=""
          draggable={false}
          decoding="async"
        />
      </div>
    </div>
  );
}
