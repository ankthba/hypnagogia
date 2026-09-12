/**
 * A small point-cloud renderer for the neuron map: 126,109 soma positions, orbited in 3D.
 *
 * Two back ends behind one interface. `webgl` is the one that runs: every point is a `gl.POINTS`
 * vertex, uploaded once, and a frame is nine `drawArrays` calls plus one for the neurons that
 * spiked. `canvas2d` is the fallback for a browser with no WebGL at all; it projects and paints in
 * JavaScript, so it subsamples the two background populations to a cap and reports how many points
 * it actually drew, which the panel prints. The named populations (KC, MBON, DAN, dFB, ALPN, CX,
 * ORN) are never subsampled by either back end.
 *
 * Nothing in here knows anything about the data: positions, colours, radii and counts are all
 * handed in by the caller, which reads them from `neuron_atlas.json` and MAP_SPEC.md.
 */

/** One population, as a contiguous run of vertices in the shared position buffer. */
export interface GroupDraw {
  /** first vertex index of this group inside the positions array */
  start: number;
  count: number;
  /** 0..1 linear RGB-ish (plain sRGB components / 255) */
  color: [number, number, number];
  /** point radius in CSS pixels at the reference canvas width, before the canvas-width scale */
  radius: number;
  alpha: number;
}

/** The camera, in the caller's own terms. */
export interface Camera {
  /** rotation about the world's vertical axis, radians; 0 is the frontal view */
  yaw: number;
  /** elevation, radians, clamped by the caller */
  pitch: number;
  /** eye distance from the box centre, in the atlas's own micrometres */
  dist: number;
}

/** The neurons lit by spikes in the current window, as parallel arrays. */
export interface LitPoints {
  /** world positions, 3 floats per lit point (already centred the same way as the static cloud) */
  pos: Float32Array;
  /** 0..1 decay value per lit point: 1 at the instant of the spike, 0 at the end of the tail */
  age: Float32Array;
  /** per-lit-point group radius in the same units as GroupDraw.radius */
  radius: Float32Array;
  /** per-lit-point base colour, 3 floats, blended toward the accent by `age` */
  color: Float32Array;
  /**
   * per-lit-point group alpha: what the point fades back to as its tail decays.
   *
   * Without it the lit pass drew every point at alpha 1, which defeated the ramp in the shader: a
   * point whose tail had fully decayed (age 0) stayed at full opacity in its group colour instead
   * of returning to the group's own alpha, so a decayed optic or "other" soma (spec alpha 0.55)
   * sat about 1.8x brighter than its unlit neighbours for the whole window.
   */
  alpha: Float32Array;
  n: number;
}

export interface DrawOpts {
  /** the whole scene's radius in micrometres; drives the depth-cue range */
  sceneRadius: number;
  /** background colour, as 0..1 rgb */
  bg: [number, number, number];
  /** the accent a spiking neuron is drawn in, 0..1 rgb */
  accent: [number, number, number];
  /** a lit neuron is drawn at this multiple of its group radius at the instant of the spike */
  litGain: number;
  /** radii are quoted at the reference width and scaled by this */
  radiusScale: number;
  /**
   * The distance at which a point is drawn at exactly its spec radius. It is the framing distance,
   * fixed for a given box and canvas, not the camera's current distance: making it the current
   * distance would keep every point the same size as the reader zoomed, which is not zooming.
   */
  fitDist: number;
}

export interface CloudRenderer {
  readonly kind: 'webgl' | 'canvas2d';
  /** upload the static cloud; `positions` is 3 floats per point, ordered so each group is a run */
  setStatic(positions: Float32Array, groups: GroupDraw[]): void;
  /** CSS size and backing-store ratio */
  resize(wCss: number, hCss: number, dpr: number): void;
  draw(cam: Camera, lit: LitPoints | null, opts: DrawOpts): void;
  dispose(): void;
  /** how many static points the last `setStatic` will actually draw (the 2D back end may cap) */
  drawnPoints(): number;
}

// ---------------------------------------------------------------- matrices

/** column-major 4x4, the layout WebGL wants */
type Mat4 = Float32Array;

function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

/** view matrix for an eye looking at the origin with up = +Y */
function lookAtOrigin(ex: number, ey: number, ez: number): Mat4 {
  // forward = normalize(eye - target) = normalize(eye)
  const l = Math.hypot(ex, ey, ez) || 1;
  const zx = ex / l;
  const zy = ey / l;
  const zz = ez / l;
  // right = normalize(cross(up, forward)), up = (0,1,0)
  let xx = zz * 1 - 0 * zy;
  let xy = 0 * zx - zz * 0;
  let xz = 0 * zy - 1 * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl;
  xy /= xl;
  xz /= xl;
  // up' = cross(forward, right)
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx;
  m[1] = yx;
  m[2] = zx;
  m[3] = 0;
  m[4] = xy;
  m[5] = yy;
  m[6] = zy;
  m[7] = 0;
  m[8] = xz;
  m[9] = yz;
  m[10] = zz;
  m[11] = 0;
  m[12] = -(xx * ex + xy * ey + xz * ez);
  m[13] = -(yx * ex + yy * ey + yz * ez);
  m[14] = -(zx * ex + zy * ey + zz * ez);
  m[15] = 1;
  return m;
}

/** The eye position for an orbit camera looking at the origin. */
export function eyeOf(cam: Camera): [number, number, number] {
  const cp = Math.cos(cam.pitch);
  return [cam.dist * cp * Math.sin(cam.yaw), cam.dist * Math.sin(cam.pitch), cam.dist * cp * Math.cos(cam.yaw)];
}

/** Vertical field of view of both back ends, radians. Shared so the two agree pixel for pixel. */
export const FOV_Y = (32 * Math.PI) / 180;

// ---------------------------------------------------------------- WebGL back end

/** floats per vertex in the interleaved lit attribute buffer: age, radius, r, g, b, alpha */
const LIT_STRIDE = 6;

const VERT = `
precision highp float;
attribute vec3 aPos;
attribute float aAge;      // 0 for a static point; 0..1 decay for a lit one
attribute float aRadius;   // CSS-pixel radius at the reference width
attribute vec3 aColor;
attribute float aAlpha;    // the point's own group alpha; a generic attribute for the static pass
uniform mat4 uProj;
uniform mat4 uView;
uniform float uPointScale; // 2 * radiusScale * dpr * fitDist
uniform vec3 uAccent;
uniform float uLitGain;
uniform vec2 uFog;         // near, far distance for the depth cue
uniform float uMaxSize;
varying vec4 vColor;
void main() {
  vec4 mv = uView * vec4(aPos, 1.0);
  gl_Position = uProj * mv;
  float dist = max(1.0, -mv.z);
  float grow = 1.0 + (uLitGain - 1.0) * aAge;
  float size = aRadius * grow * uPointScale / dist;
  // A point smaller than one device pixel is drawn at one pixel with its alpha scaled by the area
  // it should have covered, rather than being floored: a floor would systematically exaggerate the
  // 90,805 optic-lobe cells, which are the smallest points on the map.
  float shrink = min(1.0, size);
  gl_PointSize = clamp(size, 1.0, uMaxSize);
  float fog = clamp((uFog.y - dist) / max(1.0, uFog.y - uFog.x), 0.30, 1.0);
  vec3 rgb = mix(aColor, uAccent, aAge);
  float a = aAlpha + (1.0 - aAlpha) * aAge;
  vColor = vec4(rgb, a * fog * shrink * shrink);
}
`;

const FRAG = `
precision mediump float;
varying vec4 vColor;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float edge = smoothstep(0.25, 0.14, r2);
  float a = vColor.a * edge;
  gl_FragColor = vec4(vColor.rgb * a, a);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

class WebGLCloud implements CloudRenderer {
  readonly kind = 'webgl';
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private att: Record<string, number> = {};
  private bufPos: WebGLBuffer | null = null;
  private bufAttr: WebGLBuffer | null = null; // interleaved [age, radius, r, g, b] per static vertex
  private litPos: WebGLBuffer | null = null;
  private litAttr: WebGLBuffer | null = null;
  private litCap = 0;
  private litScratch: Float32Array = new Float32Array(0);
  private groups: GroupDraw[] = [];
  private nStatic = 0;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private maxPointSize = 64;

  constructor(gl: WebGLRenderingContext, prog: WebGLProgram) {
    this.gl = gl;
    this.prog = prog;
    for (const u of ['uProj', 'uView', 'uPointScale', 'uAccent', 'uLitGain', 'uFog', 'uMaxSize']) {
      this.loc[u] = gl.getUniformLocation(prog, u);
    }
    for (const a of ['aPos', 'aAge', 'aRadius', 'aColor', 'aAlpha']) this.att[a] = gl.getAttribLocation(prog, a);
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
    if (range && range.length === 2 && Number.isFinite(range[1])) this.maxPointSize = Math.min(96, Math.max(2, range[1]));
  }

  static create(canvas: HTMLCanvasElement): WebGLCloud | null {
    const attrs: WebGLContextAttributes = { alpha: false, antialias: false, depth: false, premultipliedAlpha: true, powerPreference: 'high-performance' };
    const gl = (canvas.getContext('webgl', attrs) ?? canvas.getContext('experimental-webgl', attrs)) as WebGLRenderingContext | null;
    if (!gl) return null;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    if (!prog) return null;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    return new WebGLCloud(gl, prog);
  }

  drawnPoints() {
    return this.nStatic;
  }

  setStatic(positions: Float32Array, groups: GroupDraw[]) {
    const gl = this.gl;
    this.groups = groups;
    this.nStatic = positions.length / 3;
    // Per-vertex attributes that never change: age 0, the group's radius, the group's colour.
    // They live in the vertex buffer rather than in uniforms so the lit pass, whose points come
    // from every group at once, can use the same shader.
    const attr = new Float32Array(this.nStatic * 5);
    for (const g of groups) {
      for (let i = g.start; i < g.start + g.count; i++) {
        const b = i * 5;
        attr[b] = 0;
        attr[b + 1] = g.radius;
        attr[b + 2] = g.color[0];
        attr[b + 3] = g.color[1];
        attr[b + 4] = g.color[2];
      }
    }
    if (!this.bufPos) this.bufPos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    if (!this.bufAttr) this.bufAttr = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufAttr);
    gl.bufferData(gl.ARRAY_BUFFER, attr, gl.STATIC_DRAW);
  }

  resize(wCss: number, hCss: number, dpr: number) {
    this.w = Math.max(1, wCss);
    this.h = Math.max(1, hCss);
    this.dpr = dpr;
    const cv = this.gl.canvas as HTMLCanvasElement;
    const pw = Math.round(this.w * dpr);
    const ph = Math.round(this.h * dpr);
    if (cv.width !== pw) cv.width = pw;
    if (cv.height !== ph) cv.height = ph;
    this.gl.viewport(0, 0, pw, ph);
  }

  draw(cam: Camera, lit: LitPoints | null, o: DrawOpts) {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const aspect = this.w / this.h;
    const near = Math.max(0.5, cam.dist * 0.02);
    const far = cam.dist + o.sceneRadius * 3 + 10;
    const proj = perspective(FOV_Y, aspect, near, far);
    const [ex, ey, ez] = eyeOf(cam);
    const view = lookAtOrigin(ex, ey, ez);

    gl.useProgram(this.prog);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    // premultiplied alpha out of the fragment shader
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(o.bg[0], o.bg[1], o.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.uniformMatrix4fv(this.loc.uProj, false, proj);
    gl.uniformMatrix4fv(this.loc.uView, false, view);
    gl.uniform3f(this.loc.uAccent, o.accent[0], o.accent[1], o.accent[2]);
    gl.uniform1f(this.loc.uMaxSize, this.maxPointSize);
    gl.uniform1f(this.loc.uLitGain, o.litGain);
    gl.uniform2f(this.loc.uFog, Math.max(1, cam.dist - o.sceneRadius), cam.dist + o.sceneRadius);
    // A point of radius r CSS px at the fit distance keeps that radius: size = 2 r * dpr * fit / d.
    gl.uniform1f(this.loc.uPointScale, 2 * o.radiusScale * this.dpr * o.fitDist);

    // Static populations, in the caller's paint order: the two background groups first and the
    // named ones last, so 32 dFB cells are not lost among 90,805 optic-lobe cells.
    if (this.bufPos && this.bufAttr && this.nStatic > 0) {
      this.bindStatic();
      for (const g of this.groups) {
        if (g.count === 0) continue;
        // the group's alpha as a constant vertex attribute: the same shader then serves the lit
        // pass, whose points come from every group at once and carry an alpha each
        gl.vertexAttrib1f(this.att.aAlpha, g.alpha);
        gl.drawArrays(gl.POINTS, g.start, g.count);
      }
    }

    if (lit && lit.n > 0) {
      this.drawLit(lit);
    }
  }

  private bindStatic() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.enableVertexAttribArray(this.att.aPos);
    gl.vertexAttribPointer(this.att.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufAttr);
    const S = 5 * 4;
    gl.enableVertexAttribArray(this.att.aAge);
    gl.vertexAttribPointer(this.att.aAge, 1, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(this.att.aRadius);
    gl.vertexAttribPointer(this.att.aRadius, 1, gl.FLOAT, false, S, 4);
    gl.enableVertexAttribArray(this.att.aColor);
    gl.vertexAttribPointer(this.att.aColor, 3, gl.FLOAT, false, S, 8);
    if (this.att.aAlpha >= 0) gl.disableVertexAttribArray(this.att.aAlpha);
  }

  private drawLit(lit: LitPoints) {
    const gl = this.gl;
    if (!this.litPos) this.litPos = gl.createBuffer();
    if (!this.litAttr) this.litAttr = gl.createBuffer();
    if (lit.n > this.litCap) {
      this.litCap = Math.ceil(lit.n * 1.5);
      this.litScratch = new Float32Array(this.litCap * LIT_STRIDE);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.litPos);
      gl.bufferData(gl.ARRAY_BUFFER, this.litCap * 3 * 4, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.litAttr);
      gl.bufferData(gl.ARRAY_BUFFER, this.litCap * LIT_STRIDE * 4, gl.DYNAMIC_DRAW);
    }
    const a = this.litScratch;
    for (let i = 0; i < lit.n; i++) {
      const b = i * LIT_STRIDE;
      a[b] = lit.age[i];
      a[b + 1] = lit.radius[i];
      a[b + 2] = lit.color[i * 3];
      a[b + 3] = lit.color[i * 3 + 1];
      a[b + 4] = lit.color[i * 3 + 2];
      a[b + 5] = lit.alpha[i];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.litPos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, lit.pos.subarray(0, lit.n * 3));
    gl.enableVertexAttribArray(this.att.aPos);
    gl.vertexAttribPointer(this.att.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.litAttr);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, a.subarray(0, lit.n * LIT_STRIDE));
    const S = LIT_STRIDE * 4;
    gl.enableVertexAttribArray(this.att.aAge);
    gl.vertexAttribPointer(this.att.aAge, 1, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(this.att.aRadius);
    gl.vertexAttribPointer(this.att.aRadius, 1, gl.FLOAT, false, S, 4);
    gl.enableVertexAttribArray(this.att.aColor);
    gl.vertexAttribPointer(this.att.aColor, 3, gl.FLOAT, false, S, 8);
    // the group alpha travels with each lit vertex, so the shader's `a = base + (1 - base) * age`
    // ramp actually ramps: full opacity at the spike, the group's own alpha when the tail is spent
    if (this.att.aAlpha >= 0) {
      gl.enableVertexAttribArray(this.att.aAlpha);
      gl.vertexAttribPointer(this.att.aAlpha, 1, gl.FLOAT, false, S, 20);
    }
    gl.drawArrays(gl.POINTS, 0, lit.n);
  }

  dispose() {
    const gl = this.gl;
    for (const b of [this.bufPos, this.bufAttr, this.litPos, this.litAttr]) if (b) gl.deleteBuffer(b);
    gl.deleteProgram(this.prog);
  }
}

// ---------------------------------------------------------------- 2D canvas fallback

/**
 * The fallback for a browser with no WebGL: projection and painting in JavaScript.
 *
 * It cannot draw 126,109 points at 60 fps, so it caps the two background populations (and any
 * group code the sidecar does not name) at `BG_CAP` points, chosen by an even stride through the
 * group so the sample is spatially uniform. The named populations are drawn in full, always. The
 * caller reads `drawnPoints()` and prints it beside the real total.
 */
const BG_CAP = 26000;
/** Depth buckets for the painter's algorithm: far bucket first, near bucket last. */
const DEPTH_BUCKETS = 48;

class Canvas2DCloud implements CloudRenderer {
  readonly kind = 'canvas2d';
  private ctx: CanvasRenderingContext2D;
  private pos: Float32Array = new Float32Array(0);
  private groups: GroupDraw[] = [];
  /** for a capped group, the stride through its run; 1 when it is drawn in full */
  private stride: number[] = [];
  private w = 1;
  private h = 1;
  private dpr = 1;
  private drawn = 0;
  /**
   * Scratch for the painter's algorithm, sized to the largest group the renderer will draw.
   *
   * This used to be `DEPTH_BUCKETS` fixed-capacity arrays of `n / DEPTH_BUCKETS * 4` points each,
   * and points that overflowed a bucket were dropped in silence while `drawnPoints()` went on
   * reporting the stride-derived total, so the panel's "draws X of the Y somata" overstated what
   * was painted. Occupancy is nowhere near uniform - at the default framing the somata occupy
   * about a third of the fog span, so the densest bucket holds well over four times the average
   * and the overflow was reached on the first frame. It is now a two-pass counting sort into one
   * flat run per group: every projected point is drawn, in exact far-to-near bucket order, and
   * `drawnPoints()` is true again.
   */
  private tmpX = new Float32Array(0);
  private tmpY = new Float32Array(0);
  private tmpS = new Float32Array(0);
  private tmpB = new Int32Array(0);
  private outX = new Float32Array(0);
  private outY = new Float32Array(0);
  private outS = new Float32Array(0);
  private bucketN = new Int32Array(DEPTH_BUCKETS);
  private bucketAt = new Int32Array(DEPTH_BUCKETS + 1);

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  static create(canvas: HTMLCanvasElement): Canvas2DCloud | null {
    const ctx = canvas.getContext('2d');
    return ctx ? new Canvas2DCloud(ctx) : null;
  }

  drawnPoints() {
    return this.drawn;
  }

  setStatic(positions: Float32Array, groups: GroupDraw[]) {
    this.pos = positions;
    this.groups = groups;
    this.stride = groups.map((g) => (g.count > BG_CAP && g.radius <= 0.5 ? Math.ceil(g.count / BG_CAP) : 1));
    this.drawn = groups.reduce((s, g, i) => s + Math.ceil(g.count / this.stride[i]), 0);
  }

  resize(wCss: number, hCss: number, dpr: number) {
    this.w = Math.max(1, wCss);
    this.h = Math.max(1, hCss);
    this.dpr = dpr;
    const cv = this.ctx.canvas;
    const pw = Math.round(this.w * dpr);
    const ph = Math.round(this.h * dpr);
    if (cv.width !== pw) cv.width = pw;
    if (cv.height !== ph) cv.height = ph;
  }

  /** Room for every point of the biggest group, so nothing can ever be dropped for want of space. */
  private ensureScratch(n: number) {
    if (this.tmpX.length >= n) return;
    const cap = Math.max(1024, n);
    this.tmpX = new Float32Array(cap);
    this.tmpY = new Float32Array(cap);
    this.tmpS = new Float32Array(cap);
    this.tmpB = new Int32Array(cap);
    this.outX = new Float32Array(cap);
    this.outY = new Float32Array(cap);
    this.outS = new Float32Array(cap);
  }

  draw(cam: Camera, lit: LitPoints | null, o: DrawOpts) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = `rgb(${Math.round(o.bg[0] * 255)}, ${Math.round(o.bg[1] * 255)}, ${Math.round(o.bg[2] * 255)})`;
    ctx.fillRect(0, 0, this.w, this.h);

    const [ex, ey, ez] = eyeOf(cam);
    const view = lookAtOrigin(ex, ey, ez);
    const halfH = this.h / 2;
    const halfW = this.w / 2;
    const focal = halfH / Math.tan(FOV_Y / 2);
    const near = Math.max(0.5, cam.dist * 0.02);
    const fogNear = Math.max(1, cam.dist - o.sceneRadius);
    const fogFar = cam.dist + o.sceneRadius;
    const fogSpan = Math.max(1, fogFar - fogNear);
    const sizeScale = 2 * o.radiusScale * o.fitDist;

    let maxCount = 0;
    for (let gi = 0; gi < this.groups.length; gi++) maxCount = Math.max(maxCount, Math.ceil(this.groups[gi].count / this.stride[gi]));
    this.ensureScratch(maxCount);

    for (let gi = 0; gi < this.groups.length; gi++) {
      const g = this.groups[gi];
      if (g.count === 0) continue;
      const step = this.stride[gi];
      this.bucketN.fill(0);
      // pass 1: project, cull, and count how many points land in each depth bucket
      let m = 0;
      for (let i = g.start; i < g.start + g.count; i += step) {
        const b = i * 3;
        const x = this.pos[b];
        const y = this.pos[b + 1];
        const z = this.pos[b + 2];
        const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
        const d = -vz;
        if (d <= near) continue;
        const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
        const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
        const sx = halfW + (vx * focal) / d;
        const sy = halfH - (vy * focal) / d;
        if (sx < -4 || sy < -4 || sx > this.w + 4 || sy > this.h + 4) continue;
        let bi = Math.floor(((fogFar - d) / fogSpan) * DEPTH_BUCKETS);
        bi = bi < 0 ? 0 : bi >= DEPTH_BUCKETS ? DEPTH_BUCKETS - 1 : bi;
        this.tmpX[m] = sx;
        this.tmpY[m] = sy;
        this.tmpS[m] = (g.radius * sizeScale) / d;
        this.tmpB[m] = bi;
        this.bucketN[bi]++;
        m++;
      }
      if (m === 0) continue;
      // pass 2: prefix sums, then scatter into one flat run ordered far bucket first
      let acc = 0;
      for (let bi = 0; bi < DEPTH_BUCKETS; bi++) {
        this.bucketAt[bi] = acc;
        acc += this.bucketN[bi];
      }
      this.bucketAt[DEPTH_BUCKETS] = acc;
      const cursor = this.bucketN; // reused as the write cursor, rebuilt from bucketAt below
      for (let bi = 0; bi < DEPTH_BUCKETS; bi++) cursor[bi] = this.bucketAt[bi];
      for (let k = 0; k < m; k++) {
        const p = cursor[this.tmpB[k]]++;
        this.outX[p] = this.tmpX[k];
        this.outY[p] = this.tmpY[k];
        this.outS[p] = this.tmpS[k];
      }
      // far bucket first, near bucket last: a painter's algorithm inside the group
      ctx.fillStyle = `rgb(${Math.round(g.color[0] * 255)}, ${Math.round(g.color[1] * 255)}, ${Math.round(g.color[2] * 255)})`;
      for (let bi = 0; bi < DEPTH_BUCKETS; bi++) {
        const from = this.bucketAt[bi];
        const to = this.bucketAt[bi + 1];
        if (to === from) continue;
        const fog = 0.3 + 0.7 * (bi / (DEPTH_BUCKETS - 1));
        ctx.globalAlpha = Math.min(1, g.alpha * fog);
        for (let k = from; k < to; k++) {
          const s = this.outS[k];
          if (s >= 1.4) {
            ctx.beginPath();
            ctx.arc(this.outX[k], this.outY[k], s / 2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillRect(this.outX[k] - s / 2, this.outY[k] - s / 2, s, s);
          }
        }
      }
    }

    if (lit && lit.n > 0) {
      const ar = o.accent[0] * 255;
      const ag = o.accent[1] * 255;
      const ab = o.accent[2] * 255;
      for (let i = 0; i < lit.n; i++) {
        const b = i * 3;
        const x = lit.pos[b];
        const y = lit.pos[b + 1];
        const z = lit.pos[b + 2];
        const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
        const d = -vz;
        if (d <= near) continue;
        const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
        const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
        const sx = halfW + (vx * focal) / d;
        const sy = halfH - (vy * focal) / d;
        const age = lit.age[i];
        const size = (lit.radius[i] * (1 + (o.litGain - 1) * age) * sizeScale) / d;
        const fog = Math.max(0.3, Math.min(1, (fogFar - d) / fogSpan));
        // Exactly what the vertex shader does, so the two back ends agree. The old 0.4 CSS-px
        // radius floor reintroduced the very exaggeration the WebGL path exists to avoid: at rail
        // width an optic soma is ~0.30 px, so the floor bit for the last quarter of every 150 ms
        // tail and painted those cells at 1.3x the radius and 1.7x the area they should have.
        // A point under one pixel is drawn at one pixel with its alpha scaled by the area it
        // should have covered, and the alpha ramps from the group's own alpha up to 1 with age.
        const shrink = Math.min(1, size);
        const base = lit.alpha[i];
        const a = base + (1 - base) * age;
        ctx.globalAlpha = Math.min(1, a * fog * shrink * shrink);
        const cr = lit.color[b] * 255;
        const cg = lit.color[b + 1] * 255;
        const cb = lit.color[b + 2] * 255;
        ctx.fillStyle = `rgb(${Math.round(cr + (ar - cr) * age)}, ${Math.round(cg + (ag - cg) * age)}, ${Math.round(cb + (ab - cb) * age)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(0.5, size / 2), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  dispose() {
    /* nothing to release: the 2D context dies with the canvas */
  }
}

/** WebGL if the browser has it, the JavaScript painter otherwise, and null if neither works. */
export function createRenderer(canvas: HTMLCanvasElement): CloudRenderer | null {
  return WebGLCloud.create(canvas) ?? Canvas2DCloud.create(canvas);
}
