/**
 * Ambient particle field behind the page content.
 *
 * Reproduces the look of the Spline scene on particles-studio.webflow.io/home/home-3
 * without embedding it. That page renders
 * `prod.spline.design/9VsQC7LbZM-s90GI/scene.splinecode` through WebGL2, which would
 * mean pulling in Spline's runtime plus a binary scene from a third-party CDN — and
 * the scene belongs to a paid Webflow template, so it is not ours to hotlink. The
 * measurements below were taken off the live page and rebuilt here in canvas 2D.
 *
 * What was measured:
 *   - particles are 1-3px (mean bright-run 2.71px), pure white on a #121212 ground
 *   - the radial density profile peaks near the rim then falls away sharply, which is
 *     the limb-brightening signature of points on a sphere SHELL rather than a
 *     solid ball — hence RADIUS_INNER below
 *   - magnified frames show wispy filaments that evolve over time, i.e. the cloud is
 *     dragged through a smooth flow field rather than merely rotating
 *
 * Renders straight into an ImageData buffer instead of issuing thousands of canvas
 * calls, so a full field costs one putImageData per frame and no per-particle state
 * changes.
 */
(function () {
  "use strict";

  /** Particles per square pixel of viewport, then clamped. */
  var DENSITY = 6000 / (1440 * 900);
  var MIN_PARTICLES = 1800;
  var MAX_PARTICLES = 9000;

  /** Cloud radius as a fraction of the smaller viewport axis. */
  var RADIUS_SCALE = 0.46;
  /** Particles spawn between this and 1.0, which produces the shell/limb brightening. */
  var RADIUS_INNER = 0.62;

  var ROTATION_SPEED = 0.043; // rad/s about Y
  var FLOW_SPEED = 0.021; // units/s along the flow field
  var FLOW_SCALE = 1.7; // flow field frequency
  var PERSPECTIVE = 0.34; // 0 = orthographic

  /** Deterministic 3D value noise — no dependency, and stable across reloads. */
  function hash3(x, y, z) {
    var n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
    return n - Math.floor(n);
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  function noise3(x, y, z) {
    var xi = Math.floor(x);
    var yi = Math.floor(y);
    var zi = Math.floor(z);
    var xf = smooth(x - xi);
    var yf = smooth(y - yi);
    var zf = smooth(z - zi);

    var acc = 0;
    for (var dz = 0; dz <= 1; dz++) {
      var wz = dz ? zf : 1 - zf;
      for (var dy = 0; dy <= 1; dy++) {
        var wy = dy ? yf : 1 - yf;
        for (var dx = 0; dx <= 1; dx++) {
          var wx = dx ? xf : 1 - xf;
          acc += hash3(xi + dx, yi + dy, zi + dz) * wx * wy * wz;
        }
      }
    }
    return acc * 2 - 1;
  }

  /**
   * Curl of the noise field. Divergence-free, so particles are swept into strands
   * instead of piling into sinks — this is what produces the filaments.
   *
   * Only ever called while baking the lookup grid below, never per frame.
   */
  function curl(x, y, z, out) {
    var e = 0.35;
    var n1 = noise3(x, y + e, z);
    var n2 = noise3(x, y - e, z);
    var n3 = noise3(x, y, z + e);
    var n4 = noise3(x, y, z - e);
    var n5 = noise3(x + e, y, z);
    var n6 = noise3(x - e, y, z);

    out[0] = n1 - n2 - (n3 - n4);
    out[1] = n3 - n4 - (n5 - n6);
    out[2] = n5 - n6 - (n1 - n2);
  }

  /**
   * Resolution of the baked flow field. The field is spatially smooth, so a coarse
   * grid plus trilinear interpolation is indistinguishable from evaluating the noise
   * directly — and it is the difference between a playable frame budget and a stalled
   * one.
   *
   * Evaluating curl() per particle per frame meant 6 noise samples x 8 hashed corners
   * x 1 Math.sin each = 48 transcendentals per particle, about 288,000 Math.sin calls
   * per frame at the default count. Baking it once costs GRID^3 evaluations at
   * startup and reduces the per-frame cost to eight array reads and a few lerps.
   */
  var GRID = 15;

  function bakeFlowField() {
    var field = new Float32Array(GRID * GRID * GRID * 3);
    var v = [0, 0, 0];
    for (var k = 0; k < GRID; k++) {
      for (var j = 0; j < GRID; j++) {
        for (var i = 0; i < GRID; i++) {
          // Grid spans [-1, 1] in each axis, matching particle space.
          var x = (i / (GRID - 1)) * 2 - 1;
          var y = (j / (GRID - 1)) * 2 - 1;
          var z = (k / (GRID - 1)) * 2 - 1;
          curl(x * FLOW_SCALE, y * FLOW_SCALE, z * FLOW_SCALE, v);
          var o = ((k * GRID + j) * GRID + i) * 3;
          field[o] = v[0];
          field[o + 1] = v[1];
          field[o + 2] = v[2];
        }
      }
    }
    return field;
  }

  /** Trilinear sample of the baked field. Positions outside [-1,1] are clamped. */
  function sampleField(field, x, y, z, out) {
    var g = GRID - 1;
    var fx = Math.min(g, Math.max(0, ((x + 1) * 0.5) * g));
    var fy = Math.min(g, Math.max(0, ((y + 1) * 0.5) * g));
    var fz = Math.min(g, Math.max(0, ((z + 1) * 0.5) * g));
    var i0 = fx | 0;
    var j0 = fy | 0;
    var k0 = fz | 0;
    var i1 = i0 < g ? i0 + 1 : i0;
    var j1 = j0 < g ? j0 + 1 : j0;
    var k1 = k0 < g ? k0 + 1 : k0;
    var tx = fx - i0;
    var ty = fy - j0;
    var tz = fz - k0;

    for (var c = 0; c < 3; c++) {
      var o = function (i, j, k) {
        return field[((k * GRID + j) * GRID + i) * 3 + c];
      };
      var a = o(i0, j0, k0) + (o(i1, j0, k0) - o(i0, j0, k0)) * tx;
      var b = o(i0, j1, k0) + (o(i1, j1, k0) - o(i0, j1, k0)) * tx;
      var cc = o(i0, j0, k1) + (o(i1, j0, k1) - o(i0, j0, k1)) * tx;
      var d = o(i0, j1, k1) + (o(i1, j1, k1) - o(i0, j1, k1)) * tx;
      var e1 = a + (b - a) * ty;
      var f1 = cc + (d - cc) * ty;
      out[c] = e1 + (f1 - e1) * tz;
    }
  }

  function init() {
    var canvas = document.querySelector(".jarvis-particles");
    if (!canvas) return;
    var ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var width = 0;
    var height = 0;
    var image = null;
    var buf32 = null;
    var bytes = null;

    var count = 0;
    var px = new Float32Array(0);
    var py = new Float32Array(0);
    var pz = new Float32Array(0);

    var seed = function (i) {
      // Uniform direction on the sphere, radius biased outward into a shell.
      var u = Math.random() * 2 - 1;
      var theta = Math.random() * Math.PI * 2;
      var s = Math.sqrt(1 - u * u);
      var r = RADIUS_INNER + (1 - RADIUS_INNER) * Math.cbrt(Math.random());
      px[i] = s * Math.cos(theta) * r;
      py[i] = s * Math.sin(theta) * r;
      pz[i] = u * r;
    };

    var resize = function () {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var cssW = canvas.clientWidth || window.innerWidth;
      var cssH = canvas.clientHeight || window.innerHeight;
      width = Math.max(1, Math.round(cssW * dpr));
      height = Math.max(1, Math.round(cssH * dpr));
      canvas.width = width;
      canvas.height = height;

      image = ctx.createImageData(width, height);
      buf32 = new Uint32Array(image.data.buffer);
      bytes = image.data;

      var next = Math.round(
        Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, cssW * cssH * DENSITY))
      );
      if (next !== count) {
        count = next;
        px = new Float32Array(count);
        py = new Float32Array(count);
        pz = new Float32Array(count);
        for (var i = 0; i < count; i++) seed(i);
      }
    };

    var flowField = bakeFlowField();

    var angle = 0;
    var last = 0;
    var raf = 0;
    var v = [0, 0, 0];

    var draw = function (dt) {
      if (!image || !buf32 || !bytes) return;

      angle += ROTATION_SPEED * dt;
      var cos = Math.cos(angle);
      var sin = Math.sin(angle);

      var cx = width / 2;
      var cy = height / 2;
      var radius = Math.min(width, height) * RADIUS_SCALE;

      // White everywhere, alpha zero — one fill instead of clearing four channels.
      buf32.fill(0x00ffffff);

      for (var i = 0; i < count; i++) {
        var x = px[i];
        var y = py[i];
        var z = pz[i];

        if (dt > 0) {
          sampleField(flowField, x, y, z, v);
          var step = FLOW_SPEED * dt;
          x += v[0] * step;
          y += v[1] * step;
          z += v[2] * step;

          var d2 = x * x + y * y + z * z;
          if (d2 > 1.1) {
            seed(i);
            continue;
          }
          px[i] = x;
          py[i] = y;
          pz[i] = z;
        }

        // Spin about Y, then project.
        var rx = x * cos - z * sin;
        var rz = x * sin + z * cos;
        var depth = 1 / (1 - rz * PERSPECTIVE);
        var sx = (cx + rx * radius * depth) | 0;
        var sy = (cy + y * radius * depth) | 0;
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;

        // Nearer particles read brighter; the far half stays as dust.
        var alpha = (26 + 150 * Math.pow(Math.max(0, (rz + 1) * 0.5), 1.6)) | 0;

        var idx = (sy * width + sx) * 4 + 3;
        var acc = bytes[idx] + alpha;
        bytes[idx] = acc > 255 ? 255 : acc;

        // The closest particles get a second pixel, matching the 1-3px spread
        // measured on the reference.
        if (depth > 1.12 && sx + 1 < width) {
          var idx2 = idx + 4;
          var acc2 = bytes[idx2] + (alpha >> 1);
          bytes[idx2] = acc2 > 255 ? 255 : acc2;
        }
      }

      ctx.putImageData(image, 0, 0);
    };

    var frame = function (now) {
      var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;
      draw(dt);
      raf = requestAnimationFrame(frame);
    };

    var start = function () {
      if (raf || reduced) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    var stop = function () {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    // Not just politeness — a hidden tab would otherwise keep burning frames.
    var onVisibility = function () {
      return document.hidden ? stop() : start();
    };
    var onResize = function () {
      resize();
      if (reduced) draw(0);
    };

    resize();
    if (reduced) draw(0);
    else start();

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
  }

  // Loaded with `defer`, so the DOM is parsed by the time this runs — but the
  // guard keeps the file safe to include without it.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
