import { useEffect, useRef } from 'react';

/**
 * A fruit fly that walks and flies around the viewport.
 *
 * She is a photograph, not a drawing: a female Drosophila melanogaster photographed on a sheet of
 * white paper under a USB microscope by Hannah Davis, CC BY-SA 4.0, from Wikimedia Commons, with the
 * paper subtracted by scripts/cutout_fly.py and nothing painted in. web/public/fly/CREDITS.md carries
 * the full attribution and the colophon shows it on the site. The drawn SVG fly this replaces was a
 * careful reconstruction and still looked like a reconstruction.
 *
 * She is decoration and nothing else: she carries no data, she is `pointer-events: none`, and she is
 * the only image on this site that is not read out of a data file (the colophon says so). She is
 * painted *over* the page, casts a soft shadow onto it, and never intercepts a click. She is disabled
 * entirely when the browser asks for reduced motion, and the colophon switch turns her off (she starts
 * off on touch screens and small viewports).
 *
 * The motion is a fixed-timestep integration: she steers toward a wander target with a limited turn
 * rate, hovers, and every so often lands, stops beating her wings, grooms, and takes off again. The
 * photograph is a side view, so heading is applied as a rotation only within a quarter turn of level
 * and as a mirror beyond it: a fly does not fly upside down, and rotating a side view through 180
 * degrees is exactly what that would look like. The wingbeat is a pair of blurred ellipses behind her,
 * because at 200 beats a second that is what a wing actually looks like.
 */

/** Body length in CSS pixels. The cut-out photograph is 256 x 126, nose-right. */
const FLY_W = 52;
const FLY_H = Math.round((FLY_W * 126) / 256);
/** Where the wing bases sit in the photograph, as a fraction of its width and height. */
const WING_X = 0.52;
const WING_Y = 0.34;
const STEP = 1 / 60; // fixed timestep, seconds
const MARGIN = 30; // keep the whole body inside the viewport

type Mode = 'cruise' | 'hover' | 'settle' | 'land' | 'takeoff';

interface State {
  x: number;
  y: number;
  /** heading in radians; 0 points right, which is the direction the drawn fly faces */
  a: number;
  speed: number;
  /** bank angle, radians, eased toward the turn rate */
  bank: number;
  /** apparent size, 1 while flying and a little smaller while settled on the page */
  scale: number;
  tx: number;
  ty: number;
  mode: Mode;
  /** seconds left in the current mode, or until the next target while cruising */
  timer: number;
  /** 0 while flying, 1 while the wings are folded */
  folded: number;
  /** grooming phase while landed, radians */
  groom: number;
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

function newTarget(s: State, w: number, h: number) {
  // A target somewhere else on the screen, biased away from where the fly already is.
  for (let i = 0; i < 8; i++) {
    const tx = rand(MARGIN, Math.max(MARGIN + 1, w - MARGIN));
    const ty = rand(MARGIN, Math.max(MARGIN + 1, h - MARGIN));
    if (Math.hypot(tx - s.x, ty - s.y) > Math.min(w, h) * 0.25) {
      s.tx = tx;
      s.ty = ty;
      return;
    }
  }
  s.tx = rand(MARGIN, Math.max(MARGIN + 1, w - MARGIN));
  s.ty = rand(MARGIN, Math.max(MARGIN + 1, h - MARGIN));
}

export default function FlyOrnament() {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const wingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The Layout also refuses to mount the fly under reduced motion and the CSS hides it; this is the
    // component's own guard, so the rAF loop never runs invisibly if it is ever mounted from elsewhere.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const vw = () => window.innerWidth;
    const vh = () => window.innerHeight;

    const s: State = {
      x: rand(MARGIN, Math.max(MARGIN + 1, vw() - MARGIN)),
      y: rand(MARGIN, Math.max(MARGIN + 1, vh() * 0.6)),
      a: rand(-Math.PI, Math.PI),
      speed: 90,
      bank: 0,
      scale: 1,
      tx: 0,
      ty: 0,
      mode: 'cruise',
      timer: rand(1.5, 4),
      folded: 0,
      groom: 0,
    };
    newTarget(s, vw(), vh());

    const advance = (dt: number) => {
      const w = vw();
      const h = vh();
      // Clamp before the mode switch, not after it: a window narrowed (or a phone rotated) while the
      // fly is sitting would otherwise leave it parked outside the viewport for the whole rest.
      s.x = Math.min(Math.max(MARGIN, s.x), Math.max(MARGIN + 1, w - MARGIN));
      s.y = Math.min(Math.max(MARGIN, s.y), Math.max(MARGIN + 1, h - MARGIN));
      s.timer -= dt;

      if (s.mode === 'land') {
        // wings folded over the abdomen, sitting a touch smaller, front legs grooming
        s.speed = 0;
        s.folded = Math.min(1, s.folded + dt * 4);
        s.scale += (0.94 - s.scale) * Math.min(1, dt * 4);
        s.groom += dt * 7.5;
        s.bank += (0 - s.bank) * Math.min(1, dt * 6);
        if (s.timer <= 0) {
          s.mode = 'takeoff';
          s.timer = 0.45;
          newTarget(s, w, h);
        }
        return;
      }

      if (s.mode === 'takeoff') {
        s.folded = Math.max(0, s.folded - dt * 8);
        s.scale += (1 - s.scale) * Math.min(1, dt * 6);
        // a short vertical-ish burst before it commits to the new heading
        s.speed += (170 - s.speed) * Math.min(1, dt * 5);
        s.x += Math.cos(s.a) * s.speed * dt * 0.35;
        s.y += Math.sin(s.a) * s.speed * dt * 0.35 - 26 * dt;
        if (s.timer <= 0) {
          s.mode = 'cruise';
          s.timer = rand(1.6, 4.2);
        }
        return;
      }

      const dx = s.tx - s.x;
      const dy = s.ty - s.y;
      const dist = Math.hypot(dx, dy);
      const want = Math.atan2(dy, dx);
      // shortest signed turn toward the target, rate-limited so the path curves like flight
      let diff = want - s.a;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      const turnRate = s.mode === 'settle' ? 3.0 : s.mode === 'hover' ? 2.2 : 5.0;
      const turn = Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
      s.a += turn;
      // a little erratic wobble: a fly does not fly straight lines
      const wobble = rand(-0.55, 0.55) * dt;
      s.a += wobble;
      // Bank into the turn, the way a real fly rolls: the body leans toward the inside of the arc.
      const wantBank = Math.max(-0.5, Math.min(0.5, ((turn + wobble) / Math.max(1e-4, dt)) * 0.09));
      s.bank += (wantBank - s.bank) * Math.min(1, dt * 7);
      s.folded = Math.max(0, s.folded - dt * 8);
      s.scale += (1 - s.scale) * Math.min(1, dt * 5);

      if (s.mode === 'hover') {
        // holding station: almost no forward speed, a small bob
        s.speed += (10 - s.speed) * Math.min(1, dt * 4);
        s.y += Math.sin(performance.now() / 190) * 9 * dt;
        if (s.timer <= 0) {
          s.mode = 'cruise';
          s.timer = rand(1.4, 4);
          newTarget(s, w, h);
        }
      } else if (s.mode === 'settle') {
        s.speed = Math.max(0, s.speed - 250 * dt);
        if (dist < 9 || s.speed <= 2) {
          s.mode = 'land';
          s.speed = 0;
          s.groom = 0;
          s.timer = rand(1.4, 3.6);
          return;
        }
      } else {
        const cruise = 155;
        s.speed += (cruise - s.speed) * Math.min(1, 2.4 * dt);
        if (dist < 34 || s.timer <= 0) {
          // arrive: land for a moment, hold station, or pick somewhere else and keep going
          const r = Math.random();
          if (r < 0.3) {
            s.mode = 'settle';
            s.timer = 2.5;
          } else if (r < 0.5) {
            s.mode = 'hover';
            s.timer = rand(0.6, 1.6);
          } else {
            s.timer = rand(1.5, 4.5);
            newTarget(s, w, h);
          }
        }
      }

      s.x += Math.cos(s.a) * s.speed * dt;
      s.y += Math.sin(s.a) * s.speed * dt;

      // Bounce off the edges rather than wrapping, so it never disappears.
      const lo = MARGIN;
      const hiX = Math.max(lo + 1, w - MARGIN);
      const hiY = Math.max(lo + 1, h - MARGIN);
      if (s.x < lo || s.x > hiX) {
        s.x = Math.min(hiX, Math.max(lo, s.x));
        s.a = Math.PI - s.a;
        newTarget(s, w, h);
      }
      if (s.y < lo || s.y > hiY) {
        s.y = Math.min(hiY, Math.max(lo, s.y));
        s.a = -s.a;
        newTarget(s, w, h);
      }
    };

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    // Attribute writes invalidate style for the subtree they touch, so each is written only when
    // the value it carries has actually changed.
    let flyingNow = true;
    let mirrored = false;
    const frame = (now: number) => {
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= STEP) {
        advance(STEP);
        acc -= STEP;
      }
      // A side view cannot be rotated through half a turn: that draws a fly flying upside down. So the
      // heading is carried as a rotation while she is pointing rightwards and as a mirror plus the
      // supplementary rotation while she is pointing leftwards, which keeps her the right way up on
      // every heading. The switch has a dead band so a fly flying almost straight up does not flicker.
      const c = Math.cos(s.a);
      if (c < -0.1) mirrored = true;
      else if (c > 0.1) mirrored = false;
      const ang = mirrored ? s.a + Math.PI : s.a;
      el.style.transform = `translate3d(${s.x - FLY_W / 2}px, ${s.y - FLY_H / 2}px, 0) rotate(${ang}rad)`;
      const body = bodyRef.current;
      if (body) {
        // Grooming is a small rock of the whole body: with a photograph there is no separate foreleg to
        // sweep, and a fly cleaning its eyes does rock.
        const rock = s.mode === 'land' ? Math.sin(s.groom) * 2.6 : 0;
        const sx = (mirrored ? -s.scale : s.scale).toFixed(3);
        body.style.transform = `scale(${sx}, ${s.scale.toFixed(3)}) rotate(${rock.toFixed(2)}deg)`;
      }
      const flying = s.mode !== 'land';
      if (flying !== flyingNow) {
        flyingNow = flying;
        wingsRef.current?.setAttribute('data-flying', flying ? 'true' : 'false');
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={ref} className="fly" aria-hidden="true">
      <div ref={bodyRef} className="fly__body">
        {/* the shadow she casts on the page she is flying over */}
        <div className="fly__shadow" />
        {/* At about 200 beats a second a wing is a blur and not a shape, so it is drawn as one: two
            soft ellipses at the wing bases, hidden the moment she lands. The photograph's own wings are
            folded over her abdomen, which is exactly where a landed fly keeps them. */}
        <div ref={wingsRef} className="fly__wingblur" data-flying="true" style={{ left: `${WING_X * 100}%`, top: `${WING_Y * 100}%` }}>
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
