import { useEffect, useRef } from 'react';

/**
 * A fruit fly, drawn as inline SVG, that wanders the viewport.
 *
 * It is decoration and nothing else: it carries no data, it is `pointer-events: none`, and it
 * paints *behind* the page's content (z-index -1 over the page background), so it can never cover
 * a control or a number. It is disabled entirely when the browser asks for reduced motion.
 *
 * Motion is a fixed-timestep integration driven by requestAnimationFrame: the fly steers toward a
 * wander target with a limited turn rate, and every so often it lands, sits still with its wings
 * folded, and takes off again.
 */

/** Body length in CSS pixels (the SVG is 40 x 32 user units). */
const FLY_W = 36;
const FLY_H = Math.round((FLY_W * 32) / 40);
const STEP = 1 / 60; // fixed timestep, seconds
const MARGIN = 26; // keep the whole body inside the viewport

type Mode = 'cruise' | 'settle' | 'rest';

interface State {
  x: number;
  y: number;
  /** heading in radians; 0 points right, which is the direction the drawn fly faces */
  a: number;
  speed: number;
  tx: number;
  ty: number;
  mode: Mode;
  /** seconds left in the current mode (rest) or until the next target (cruise) */
  timer: number;
  /** wing flap phase, seconds */
  phase: number;
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
  const wingsRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vw = () => window.innerWidth;
    const vh = () => window.innerHeight;

    const s: State = {
      x: rand(MARGIN, Math.max(MARGIN + 1, vw() - MARGIN)),
      y: rand(MARGIN, Math.max(MARGIN + 1, vh() * 0.6)),
      a: rand(-Math.PI, Math.PI),
      speed: 90,
      tx: 0,
      ty: 0,
      mode: 'cruise',
      timer: rand(1.5, 4),
      phase: 0,
    };
    newTarget(s, vw(), vh());

    const advance = (dt: number) => {
      const w = vw();
      const h = vh();
      s.timer -= dt;

      if (s.mode === 'rest') {
        s.speed = 0;
        if (s.timer <= 0) {
          s.mode = 'cruise';
          s.timer = rand(2, 5);
          s.speed = 30;
          newTarget(s, w, h);
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
      const turnRate = s.mode === 'settle' ? 3.2 : 5.0;
      s.a += Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
      // a little erratic wobble: a fly does not fly straight lines
      s.a += rand(-0.55, 0.55) * dt;

      if (s.mode === 'settle') {
        s.speed = Math.max(0, s.speed - 260 * dt);
        if (dist < 8 || s.speed <= 1) {
          s.mode = 'rest';
          s.speed = 0;
          s.timer = rand(0.7, 2.6);
          return;
        }
      } else {
        const cruise = 150;
        s.speed += (cruise - s.speed) * Math.min(1, 2.4 * dt);
        if (dist < 34 || s.timer <= 0) {
          // arrive: either land for a moment, or pick somewhere else and keep going
          if (Math.random() < 0.35) {
            s.mode = 'settle';
            s.timer = 2.5;
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

      s.phase += dt;
    };

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = (now: number) => {
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= STEP) {
        advance(STEP);
        acc -= STEP;
      }
      el.style.transform = `translate3d(${s.x - FLY_W / 2}px, ${s.y - FLY_H / 2}px, 0) rotate(${s.a}rad)`;
      const wings = wingsRef.current;
      if (wings) wings.dataset.flying = s.mode === 'rest' ? 'false' : 'true';
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={ref} className="fly" aria-hidden="true">
      <svg width={FLY_W} height={FLY_H} viewBox="0 0 40 32" xmlns="http://www.w3.org/2000/svg" focusable="false">
        {/* legs: six thin bristled legs, three a side, splayed from the thorax */}
        <g className="fly__legs">
          <path d="M21 13 L16 6.5 L13.5 4.5" />
          <path d="M23.5 12.5 L22 5.5 L20 3.6" />
          <path d="M26 13 L27.5 6.5 L29.5 5" />
          <path d="M21 19 L16 25.5 L13.5 27.5" />
          <path d="M23.5 19.5 L22 26.5 L20 28.4" />
          <path d="M26 19 L27.5 25.5 L29.5 27" />
        </g>

        {/* abdomen: dark ellipsoid, tapering to the tip, with faint tergite banding */}
        <ellipse className="fly__abdomen" cx="12" cy="16" rx="9.6" ry="5.3" />
        <g className="fly__bands">
          <path d="M7.2 11.6 A 5.6 5.6 0 0 1 7.2 20.4" />
          <path d="M11.6 11.1 A 6 6 0 0 1 11.6 20.9" />
          <path d="M15.8 11.6 A 5.6 5.6 0 0 1 15.8 20.4" />
        </g>

        {/* wings: translucent, veined, hinged at the front of the abdomen and swept back */}
        <g ref={wingsRef} className="fly__wings" data-flying="true">
          <g className="fly__wing fly__wing--upper">
            <ellipse cx="11.5" cy="6.6" rx="9.4" ry="3.3" transform="rotate(-13 21 11.2)" />
          </g>
          <g className="fly__wing fly__wing--lower">
            <ellipse cx="11.5" cy="25.4" rx="9.4" ry="3.3" transform="rotate(13 21 20.8)" />
          </g>
        </g>

        {/* thorax: rounder, a shade lighter than the abdomen, with a pale scutellum */}
        <ellipse className="fly__thorax" cx="24" cy="16" rx="6.4" ry="5.8" />
        <ellipse className="fly__scutellum" cx="20.4" cy="16" rx="1.9" ry="3.4" />

        {/* head and the two large red compound eyes */}
        <ellipse className="fly__head" cx="30.4" cy="16" rx="3.7" ry="4.3" />
        <ellipse className="fly__eye" cx="31.2" cy="12.6" rx="3.1" ry="2.5" />
        <ellipse className="fly__eye" cx="31.2" cy="19.4" rx="3.1" ry="2.5" />
        <ellipse className="fly__glint" cx="32.4" cy="11.9" rx="0.9" ry="0.6" />
        <ellipse className="fly__glint" cx="32.4" cy="20.1" rx="0.9" ry="0.6" />
        {/* aristae */}
        <path className="fly__arista" d="M33.4 13.6 L36.6 12.2" />
        <path className="fly__arista" d="M33.4 18.4 L36.6 19.8" />
      </svg>
    </div>
  );
}
