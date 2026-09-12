import { useEffect, useRef } from 'react';

/**
 * A fruit fly, drawn as inline SVG, that flies around the viewport.
 *
 * It is decoration and nothing else: it carries no data, it is `pointer-events: none`, and it is
 * the only drawing on this site that is not read out of a data file (the colophon says so). It is
 * painted *over* the page, so it has a soft drop shadow and reads as being above the paper, and it
 * never intercepts a click. It is disabled entirely when the browser asks for reduced motion, and
 * the colophon switch turns it off (it starts off on touch screens and small viewports).
 *
 * The drawing is a dorsal view of Drosophila melanogaster at roughly life proportions: head about
 * a fifth of the body, a tan thorax with a darker scutum and the two rows of dorsocentral and
 * acrostichal bristles, a banded abdomen of five visible tergites tapering to a point, two large
 * red compound eyes with a specular highlight, short aristate antennae, six jointed legs with
 * femur, tibia and a five-segment tarsus, and two hyaline wings carrying the real vein pattern
 * (costa, subcosta, L1 to L5, the two crossveins and the alula).
 *
 * The motion is a fixed-timestep integration: the fly steers toward a wander target with a limited
 * turn rate, banks into its turns, hovers, and every so often lands, folds its wings, grooms, and
 * takes off again.
 */

/** Body length in CSS pixels. The SVG is 64 x 46 user units, drawn nose-right. */
const FLY_W = 46;
const FLY_H = Math.round((FLY_W * 46) / 64);
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
  const bodyRef = useRef<SVGGElement>(null);
  const wingsRef = useRef<SVGGElement>(null);
  const legsRef = useRef<SVGGElement>(null);
  const foreleg = useRef<SVGGElement>(null);

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
    let groomNow = false;
    const frame = (now: number) => {
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= STEP) {
        advance(STEP);
        acc -= STEP;
      }
      // The wrapper carries position and heading; the inner group carries the bank and the sit, so
      // the wing animation's own transform-origin is not disturbed by either.
      el.style.transform = `translate3d(${s.x - FLY_W / 2}px, ${s.y - FLY_H / 2}px, 0) rotate(${s.a}rad)`;
      const body = bodyRef.current;
      if (body) body.style.transform = `scale(${s.scale.toFixed(3)}, ${(s.scale * Math.cos(s.bank)).toFixed(3)})`;
      const flying = s.mode !== 'land';
      if (flying !== flyingNow) {
        flyingNow = flying;
        wingsRef.current?.setAttribute('data-flying', flying ? 'true' : 'false');
        legsRef.current?.setAttribute('data-tucked', flying ? 'true' : 'false');
      }
      const grooming = s.mode === 'land';
      if (grooming) {
        const g = foreleg.current;
        // the front legs sweep over the head, the way a fly cleans its eyes
        if (g) g.style.transform = `rotate(${(Math.sin(s.groom) * 13).toFixed(2)}deg)`;
        groomNow = true;
      } else if (groomNow) {
        groomNow = false;
        const g = foreleg.current;
        if (g) g.style.transform = '';
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={ref} className="fly" aria-hidden="true">
      <svg width={FLY_W} height={FLY_H} viewBox="0 0 64 46" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <g ref={bodyRef} className="fly__body">
          {/* the shadow the fly casts on the page it is flying over */}
          <ellipse className="fly__shadow" cx="26" cy="25.5" rx="19" ry="8.5" />

          {/* legs: three a side, each femur, tibia and a five-segment tarsus. They splay while the
              fly is sitting and tuck up under the thorax while it is in the air. */}
          <g ref={legsRef} className="fly__legs" data-tucked="true">
            <g className="fly__leg fly__leg--mid-u">
              <path d="M35 19 L29.5 11 L22.5 7" />
              <path className="fly__tarsus" d="M22.5 7 L19 5.6" />
            </g>
            <g className="fly__leg fly__leg--hind-u">
              <path d="M31 18.5 L23 12.5 L15 10.5" />
              <path className="fly__tarsus" d="M15 10.5 L11.2 9.9" />
            </g>
            <g className="fly__leg fly__leg--mid-l">
              <path d="M35 27 L29.5 35 L22.5 39" />
              <path className="fly__tarsus" d="M22.5 39 L19 40.4" />
            </g>
            <g className="fly__leg fly__leg--hind-l">
              <path d="M31 27.5 L23 33.5 L15 35.5" />
              <path className="fly__tarsus" d="M15 35.5 L11.2 36.1" />
            </g>
            <g ref={foreleg} className="fly__leg fly__leg--fore">
              <path d="M40 19.5 L45 12.5 L50.5 9.5" />
              <path className="fly__tarsus" d="M50.5 9.5 L54 8.4" />
              <path d="M40 26.5 L45 33.5 L50.5 36.5" />
              <path className="fly__tarsus" d="M50.5 36.5 L54 37.6" />
            </g>
          </g>

          {/* abdomen: five visible tergites, dark bands over a tan ground, tapering to the point */}
          <path className="fly__abdomen" d="M31 23 C31 15.6 24.4 11.4 17 11.4 C9.2 11.4 3.4 16.4 3.4 23 C3.4 29.6 9.2 34.6 17 34.6 C24.4 34.6 31 30.4 31 23 Z" />
          <g className="fly__tergites">
            <path d="M27.6 15.6 A 9.6 9.6 0 0 1 27.6 30.4" />
            <path d="M22.4 12.6 A 11.6 11.6 0 0 1 22.4 33.4" />
            <path d="M16.6 11.6 A 12 12 0 0 1 16.6 34.4" />
            <path d="M10.6 13.2 A 10.6 10.6 0 0 1 10.6 32.8" />
          </g>
          {/* the male's dark posterior tip */}
          <path className="fly__tip" d="M3.4 23 C3.4 19.4 5 16.4 7.6 14.6 C6 17 5.2 19.9 5.2 23 C5.2 26.1 6 29 7.6 31.4 C5 29.6 3.4 26.6 3.4 23 Z" />

          {/* wings: hyaline, hinged at the scutellum, carrying the real vein pattern. They beat
              while the fly is in the air and fold flat over the abdomen when it lands. */}
          <g ref={wingsRef} className="fly__wings" data-flying="true">
            <g className="fly__wing fly__wing--upper">
              <path
                className="fly__wing-blade"
                d="M34 17.6 C27 10.4 17 5.6 8.2 5.2 C3.6 5 1.4 7 3.6 9.6 C8.6 15.4 20 19.4 30 19.6 Z"
              />
              <g className="fly__veins">
                <path d="M33 17.4 C25 11.4 15.4 7.2 7.2 6.6" />
                <path d="M33.2 18.2 C25.4 13 16.4 9.4 8.6 8.6" />
                <path d="M32.6 19 C25 15.4 16.6 12.6 9.6 11.6" />
                <path d="M31.4 19.5 C25.6 17.4 19 15.6 13.4 14.8" />
                <path d="M22.4 12.9 L21.6 16.3" />
                <path d="M14.4 9.6 L13.6 14.9" />
              </g>
              <path className="fly__alula" d="M34.6 18.4 C32 15.8 29 14.6 27 15.4 C25.6 16 26 18 28 19.2 Z" />
            </g>
            <g className="fly__wing fly__wing--lower">
              <path
                className="fly__wing-blade"
                d="M34 28.4 C27 35.6 17 40.4 8.2 40.8 C3.6 41 1.4 39 3.6 36.4 C8.6 30.6 20 26.6 30 26.4 Z"
              />
              <g className="fly__veins">
                <path d="M33 28.6 C25 34.6 15.4 38.8 7.2 39.4" />
                <path d="M33.2 27.8 C25.4 33 16.4 36.6 8.6 37.4" />
                <path d="M32.6 27 C25 30.6 16.6 33.4 9.6 34.4" />
                <path d="M31.4 26.5 C25.6 28.6 19 30.4 13.4 31.2" />
                <path d="M22.4 33.1 L21.6 29.7" />
                <path d="M14.4 36.4 L13.6 31.1" />
              </g>
              <path className="fly__alula" d="M34.6 27.6 C32 30.2 29 31.4 27 30.6 C25.6 30 26 28 28 26.8 Z" />
            </g>
          </g>

          {/* halteres, the vestigial hind wings a fly beats as gyroscopes */}
          <g className="fly__halteres">
            <path d="M31.5 20.6 L27.4 18.4" />
            <circle cx="26.6" cy="18" r="1.5" />
            <path d="M31.5 25.4 L27.4 27.6" />
            <circle cx="26.6" cy="28" r="1.5" />
          </g>

          {/* thorax: tan ground with a darker scutum, and the scutellum at its back */}
          <ellipse className="fly__thorax" cx="39" cy="23" rx="10.6" ry="8.6" />
          <path className="fly__scutum" d="M43.4 15.6 C37 15 32.2 17.6 31.4 23 C32.2 28.4 37 31 43.4 30.4 C46.6 28.6 48.2 26 48.2 23 C48.2 20 46.6 17.4 43.4 15.6 Z" />
          <path className="fly__scutellum" d="M31.6 19.4 C29.2 20.2 28.4 21.6 28.4 23 C28.4 24.4 29.2 25.8 31.6 26.6 C32.8 25.4 33.2 24.2 33.2 23 C33.2 21.8 32.8 20.6 31.6 19.4 Z" />
          {/* the two rows of dorsocentral and acrostichal bristles that a fly is keyed on */}
          <g className="fly__bristles">
            <path d="M44.6 17.4 L47.6 14.2" />
            <path d="M40.4 16.4 L42.6 12.8" />
            <path d="M36 16.6 L37.6 12.8" />
            <path d="M32.4 18.6 L33.2 15" />
            <path d="M44.6 28.6 L47.6 31.8" />
            <path d="M40.4 29.6 L42.6 33.2" />
            <path d="M36 29.4 L37.6 33.2" />
            <path d="M32.4 27.4 L33.2 31" />
            <path d="M29.6 20.4 L27.6 17.6" />
            <path d="M29.6 25.6 L27.6 28.4" />
          </g>

          {/* head, the two large red compound eyes, the ocellar triangle and the aristate antennae */}
          <ellipse className="fly__head" cx="51.4" cy="23" rx="6" ry="6.6" />
          <path className="fly__eye" d="M50.4 17.2 C54 16.8 56.8 18.4 57.2 20.6 C57.5 22.2 56 23.4 53.4 23.4 C51 23.4 49.2 22 48.9 20.1 C48.7 18.6 49.3 17.4 50.4 17.2 Z" />
          <path className="fly__eye" d="M50.4 28.8 C54 29.2 56.8 27.6 57.2 25.4 C57.5 23.8 56 22.6 53.4 22.6 C51 22.6 49.2 24 48.9 25.9 C48.7 27.4 49.3 28.6 50.4 28.8 Z" />
          <ellipse className="fly__glint" cx="54.6" cy="18.9" rx="1.5" ry="0.9" transform="rotate(-18 54.6 18.9)" />
          <ellipse className="fly__glint" cx="54.6" cy="27.1" rx="1.5" ry="0.9" transform="rotate(18 54.6 27.1)" />
          <path className="fly__face" d="M55.6 21.4 C57.8 21.6 58.8 22.2 58.8 23 C58.8 23.8 57.8 24.4 55.6 24.6 Z" />
          {/* antennae: a short pedicel and funiculus, each with its feathered arista */}
          <g className="fly__antenna">
            <ellipse cx="57.4" cy="21.2" rx="1.7" ry="1.2" transform="rotate(-22 57.4 21.2)" />
            <path className="fly__arista" d="M58.6 20.4 L62.6 18.2" />
            <path className="fly__arista-branch" d="M59.8 19.8 L59.2 18.2" />
            <path className="fly__arista-branch" d="M61.2 19 L60.6 17.4" />
          </g>
          <g className="fly__antenna">
            <ellipse cx="57.4" cy="24.8" rx="1.7" ry="1.2" transform="rotate(22 57.4 24.8)" />
            <path className="fly__arista" d="M58.6 25.6 L62.6 27.8" />
            <path className="fly__arista-branch" d="M59.8 26.2 L59.2 27.8" />
            <path className="fly__arista-branch" d="M61.2 27 L60.6 28.6" />
          </g>
          {/* proboscis */}
          <path className="fly__proboscis" d="M57.2 23 L59.4 23" />
        </g>
      </svg>
    </div>
  );
}
