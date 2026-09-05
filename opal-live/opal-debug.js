// On-page diagnostic overlay for the web build — the mobile equivalent of
// tools/webcheck.mjs.
//
// WHY THIS EXISTS: a Godot shader compile/link failure on the web prints to the
// browser console and NOTHING else — the object simply is not drawn. On desktop
// you open devtools. On an iPhone you cannot, and Safari Web Inspector needs a
// cabled Mac, which is exactly what the remote read does not have. So the page
// shows its own console.
//
// It also runs three targeted WebGL2 probes on the real device, because knowing
// "the shader failed" is only half an answer — we need to know WHICH limit bit.
//
// Injected into the exported index.html by tools/publish-web.sh. Touches no game
// code, and every part is wrapped so a probe failure can never take down a boot
// that would otherwise have worked.

(function () {
  'use strict';

  var BUILD = '4716b83 2026-09-05 12:43'; // substituted at publish time
  window.OPAL_BUILD = BUILD; // read by the game for perf telemetry (perf_telemetry.gd)
  // Raw handles captured BEFORE the tee wraps console, so say() can echo to the
  // real console without recursing into itself.
  var RAW = {
    log: console.log ? console.log.bind(console) : function () {},
    error: console.error ? console.error.bind(console) : function () {},
  };
  var lines = [];
  var panel = null, btn = null, body = null;
  var ALERT = /error|fail|cannot|unable|invalid|shader|compil|link|out of memory|context lost/i;
  var alerted = false;

  function stamp() {
    var t = (performance.now() / 1000).toFixed(1);
    return t.length < 5 ? '  '.slice(0, 5 - t.length) + t : t;
  }

  function push(kind, text) {
    var line = stamp() + ' [' + kind + '] ' + text;
    lines.push(line);
    if (lines.length > 600) lines.shift();
    if (body) render();
    // Godot routes plain WARNING: lines through console.error, so treating every `err` as an
    // alert makes the badge permanently red and therefore meaningless. Red should mean a real
    // failure — so warnings only count if their text names one.
    var real = ALERT.test(text) || (kind === 'err' && !/^\s*WARNING:/.test(text));
    if (!alerted && real) {
      alerted = true;
      if (btn) { btn.style.background = '#a2202c'; btn.textContent = 'LOG !'; }
    }
  }

  // Anything WE generate (probe results, build stamp) goes to the overlay AND the
  // real console, so one implementation serves both the phone read and the
  // headless check in tools/webcheck.mjs. Teed console lines use push() alone —
  // they are already in the real console by definition.
  function say(kind, text) {
    push(kind, text);
    try { (kind === 'err' ? RAW.error : RAW.log)('[opal-debug] ' + text); } catch (e) {}
  }

  // --- console tee: installed IMMEDIATELY so nothing before DOM ready is lost ---
  ['log', 'warn', 'error', 'info'].forEach(function (k) {
    var orig = console[k] ? console[k].bind(console) : function () {};
    console[k] = function () {
      try {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i];
          parts.push(typeof a === 'string' ? a : (function () {
            try { return JSON.stringify(a); } catch (e) { return String(a); }
          })());
        }
        push(k === 'error' ? 'err' : k === 'warn' ? 'wrn' : 'log', parts.join(' '));
      } catch (e) { /* never let logging break the page */ }
      orig.apply(null, arguments);
    };
  });

  window.addEventListener('error', function (e) {
    push('err', 'window.onerror: ' + (e.message || e) + ' @ ' + (e.filename || '?') + ':' + (e.lineno || 0));
  });
  window.addEventListener('unhandledrejection', function (e) {
    push('err', 'unhandled rejection: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });

  // --- the overlay ---
  function render() {
    body.textContent = lines.join('\n');
  }

  function build() {
    btn = document.createElement('button');
    btn.textContent = 'LOG';
    // Bottom-LEFT deliberately: the game's `?` button owns the top-right, the
    // feed lever owns the right edge, and New rough/Inspect own the top-left.
    // The lower-left strip holds only a status label, so nothing is stolen.
    btn.setAttribute('style', [
      'position:fixed', 'bottom:92px', 'left:6px', 'z-index:2147483647',
      'font:600 11px ui-monospace,Menlo,monospace', 'color:#fff',
      'background:#2a3140', 'border:1px solid #55607a', 'border-radius:6px',
      'padding:6px 9px', 'opacity:.85', '-webkit-appearance:none',
    ].join(';'));

    panel = document.createElement('div');
    panel.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:2147483646', 'display:none',
      'background:rgba(8,10,14,.97)', 'color:#d8dee9',
      'font:11px/1.45 ui-monospace,Menlo,monospace',
      'padding:44px 8px 8px', 'box-sizing:border-box',
      'overflow:auto', '-webkit-overflow-scrolling:touch',
      'white-space:pre-wrap', 'word-break:break-word', 'user-select:text',
      '-webkit-user-select:text',
    ].join(';'));

    var bar = document.createElement('div');
    bar.setAttribute('style', 'position:fixed;top:6px;left:6px;z-index:2147483647;display:none;gap:6px');
    var mk = function (label, fn) {
      var b = document.createElement('button');
      b.textContent = label;
      b.setAttribute('style', 'font:600 12px ui-monospace,monospace;color:#fff;background:#2a3140;' +
        'border:1px solid #55607a;border-radius:6px;padding:7px 11px;margin-right:6px;-webkit-appearance:none');
      b.addEventListener('click', fn);
      bar.appendChild(b);
      return b;
    };
    mk('COPY', function () {
      var text = lines.join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { push('log', '--- copied ' + text.length + ' chars to clipboard ---'); },
          function () { push('wrn', '--- clipboard blocked; select the text manually ---'); }
        );
      } else {
        push('wrn', '--- no clipboard API; select the text manually ---');
      }
    });
    mk('PROBE', function () { probe(); });

    body = document.createElement('div');
    panel.appendChild(body);

    btn.addEventListener('click', function () {
      var open = panel.style.display === 'none';
      panel.style.display = open ? 'block' : 'none';
      bar.style.display = open ? 'flex' : 'none';
      btn.textContent = open ? 'HIDE' : (alerted ? 'LOG !' : 'LOG');
      if (open) render();
    });

    document.body.appendChild(panel);
    document.body.appendChild(bar);
    document.body.appendChild(btn);
    render();
  }

  // --- WebGL2 probes: the three hypotheses, tested on the real device ---
  //
  // The stone is invisible while everything else renders, which means the
  // raymarch never registers a hit. Candidate causes, in order of suspicion:
  //   A. `uniform float grind_cuts[128]` blows the fragment uniform budget.
  //   B. the ~240-iteration march loop is too large to compile.
  //   C. the RGBAH (half-float) mipmapped 3D textures do not allocate/filter.
  // Each gets a direct, self-contained test.

  var FS_HEAD = '#version 300 es\nprecision highp float;\nprecision highp sampler3D;\nout vec4 o;\n';
  var VS = '#version 300 es\nin vec4 p;\nvoid main(){gl_Position=p;}\n';

  function tryProgram(gl, fs, label) {
    var v = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(v, VS); gl.compileShader(v);
    var f = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(f, fs); gl.compileShader(f);
    if (!gl.getShaderParameter(f, gl.COMPILE_STATUS)) {
      say('err', label + ': FRAGMENT COMPILE FAILED — ' + (gl.getShaderInfoLog(f) || '(no log)').trim());
      return false;
    }
    var p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      say('err', label + ': LINK FAILED — ' + (gl.getProgramInfoLog(p) || '(no log)').trim());
      return false;
    }
    say('log', label + ': ok');
    return true;
  }

  function probe() {
    var c, gl;
    try {
      c = document.createElement('canvas');
      c.width = c.height = 4;
      gl = c.getContext('webgl2', { antialias: false, depth: false });
      if (!gl) { say('err', 'PROBE: no webgl2 context available'); return; }
    } catch (e) {
      say('err', 'PROBE: context creation threw — ' + e); return;
    }

    try {
      say('log', '=== WebGL2 device limits ===');
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        say('log', 'renderer: ' + gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
        say('log', 'vendor:   ' + gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL));
      }
      [['MAX_FRAGMENT_UNIFORM_VECTORS', gl.MAX_FRAGMENT_UNIFORM_VECTORS],
       ['MAX_VERTEX_UNIFORM_VECTORS', gl.MAX_VERTEX_UNIFORM_VECTORS],
       ['MAX_FRAGMENT_UNIFORM_BLOCKS', gl.MAX_FRAGMENT_UNIFORM_BLOCKS],
       ['MAX_UNIFORM_BLOCK_SIZE', gl.MAX_UNIFORM_BLOCK_SIZE],
       ['MAX_VARYING_VECTORS', gl.MAX_VARYING_VECTORS],
       ['MAX_TEXTURE_IMAGE_UNITS', gl.MAX_TEXTURE_IMAGE_UNITS],
       ['MAX_3D_TEXTURE_SIZE', gl.MAX_3D_TEXTURE_SIZE],
       ['MAX_TEXTURE_SIZE', gl.MAX_TEXTURE_SIZE]].forEach(function (kv) {
        say('log', kv[0] + ' = ' + gl.getParameter(kv[1]));
      });
      say('log', 'OES_texture_float_linear: ' + !!gl.getExtension('OES_texture_float_linear'));
      say('log', 'EXT_color_buffer_half_float: ' + !!gl.getExtension('EXT_color_buffer_half_float'));

      // --- A: the 128-element scalar uniform array ---
      say('log', '=== A: uniform float arr[128] ===');
      tryProgram(gl, FS_HEAD + 'uniform float arr[128];\nuniform int n;\n' +
        'void main(){float s=0.0;for(int i=0;i<n;i++){s+=arr[i];}o=vec4(s);}\n', 'A/128-float-array');

      // --- B: a 240-iteration march with 3D samples (shape of the real loop) ---
      say('log', '=== B: 240-iteration march loop ===');
      var t0 = performance.now();
      var okB = tryProgram(gl, FS_HEAD + 'uniform sampler3D t;\nuniform vec3 ro;\nuniform vec3 rd;\n' +
        'void main(){vec3 p=ro;float a=0.0;for(int i=0;i<240;i++){p+=rd*0.003;' +
        'vec4 s=texture(t,p*0.5+0.5);a+=s.r*0.01;if(a>1.0)break;}o=vec4(a);}\n', 'B/240-march');
      say('log', 'B compile+link took ' + (performance.now() - t0).toFixed(0) + ' ms' + (okB ? '' : ' (failed)'));

      // --- C: the actual texture the stone samples: 112^3 RGBA16F, mipmapped, linear ---
      say('log', '=== C: 112^3 RGBA16F 3D texture, mipmapped ===');
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, tex);
      while (gl.getError() !== gl.NO_ERROR) { /* drain */ }
      var n = 112;
      // A full mip chain is floor(log2(max dim)) + 1 — asking for more is an
      // INVALID_OPERATION in its own right and would masquerade as a device limit.
      var mips = Math.floor(Math.log2(n)) + 1;
      gl.texStorage3D(gl.TEXTURE_3D, mips, gl.RGBA16F, n, n, n);
      var e1 = gl.getError();
      say(e1 ? 'err' : 'log', 'texStorage3D(RGBA16F,112^3,' + mips + ' mips): ' + (e1 ? 'GL error 0x' + e1.toString(16) : 'ok'));
      var bytes = new Uint16Array(n * n * n * 4);
      gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, n, n, n, gl.RGBA, gl.HALF_FLOAT, bytes);
      var e2 = gl.getError();
      say(e2 ? 'err' : 'log', 'texSubImage3D upload (' + (bytes.byteLength / 1048576).toFixed(1) + ' MB): ' +
        (e2 ? 'GL error 0x' + e2.toString(16) : 'ok'));
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.generateMipmap(gl.TEXTURE_3D);
      var e3 = gl.getError();
      say(e3 ? 'err' : 'log', 'generateMipmap + LINEAR filter: ' + (e3 ? 'GL error 0x' + e3.toString(16) : 'ok'));
      gl.deleteTexture(tex);

      say('log', '=== probe complete ===');
    } catch (e) {
      say('err', 'PROBE threw: ' + (e && e.message ? e.message : e));
    } finally {
      try {
        var lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();   // never starve Godot's own context
      } catch (e) { /* ignore */ }
    }
  }

  function start() {
    try { build(); } catch (e) { /* overlay is best-effort */ }
    say('log', 'opal-debug ready · build ' + BUILD);
    say('log', 'UA: ' + navigator.userAgent);
    // Run the probe only after Godot has its own GL context, so we can never be
    // the reason the engine fails to get one. `?probe=<ms>` overrides the delay
    // so the headless check (tools/webcheck.mjs) does not have to wait it out.
    var delay = 9000;
    var m = /[?&]probe=(\d+)/.exec(location.search);
    if (m) delay = Math.max(0, parseInt(m[1], 10));
    setTimeout(function () { try { probe(); } catch (e) { say('err', 'probe: ' + e); } }, delay);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
