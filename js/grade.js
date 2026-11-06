'use strict';
/* ==========================================================================
   13d. BILDEFILTER – et kamerafilter over hele kartbildet (bakke, bygg, biler og lys) som gjør det mer fotorealistisk:
   skarphet, glød rundt sterkt lys (bloom), dis mot horisonten, filmisk kontrast, kjølige skygger og varme høylys,
   litt dempede «leketøysfarger», svak vignett og fint filmkorn. Dag, natt og regn gir ulik tone.
   Tegnes som det siste laget i kartet: bildet kopieres til en tekstur og tegnes på nytt gjennom en shader (krever WebGL2).
   ========================================================================== */
const Grade = {
  on: true, ok: false, paused: false, soft: false, prog: null, vao: null, tex: null, w: 0, h: 0, loc: {},
  VS: `#version 300 es
out vec2 vUv;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`,
  FS: `#version 300 es
precision highp float;
uniform sampler2D T; uniform vec2 px; uniform float uNight, uWet, uTime, uHaze, uMip, uAmt;
in vec2 vUv; out vec4 o;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 uv = vUv; vec3 src = textureLod(T, uv, 0.0).rgb, c = src;
  // skarphet: fremhever kanter og detaljer (uskarp maske)
  vec3 nb = (textureLod(T, uv + vec2(px.x, 0.0), 0.0).rgb + textureLod(T, uv - vec2(px.x, 0.0), 0.0).rgb + textureLod(T, uv + vec2(0.0, px.y), 0.0).rgb + textureLod(T, uv - vec2(0.0, px.y), 0.0).rgb) * 0.25;
  c += (c - nb) * 0.5;
  // glød rundt sterkt lys (gatelys, blålys, sol i glass) fra nedskalerte utgaver av bildet
  vec3 b1 = textureLod(T, uv, uMip).rgb, b2 = textureLod(T, uv, uMip + 2.0).rgb;
  vec3 bloom = max(b1 - 0.7, 0.0) * 0.65 + max(b2 - 0.62, 0.0) * 0.55;
  c += bloom * mix(0.3, 1.0, uNight);
  // dis mot horisonten: toppen av bildet er lengst unna når kartet er vippet (luftperspektiv)
  float far = smoothstep(0.5, 1.0, uv.y) * uHaze;
  vec3 haze = mix(vec3(0.80, 0.85, 0.90), vec3(0.09, 0.12, 0.20), uNight);
  c = mix(c, haze, far * (0.18 + 0.27 * uWet));
  // filmisk kontrast (myk S-kurve)
  c = clamp(c, 0.0, 1.0); c = mix(c, c * c * (3.0 - 2.0 * c), 0.28);
  // fargetone: kjølige skygger og varme høylys om dagen, blåere om natten
  float l = luma(c);
  vec3 shadowTint = mix(vec3(0.96, 0.995, 1.05), vec3(0.88, 0.95, 1.12), uNight);
  vec3 highTint = mix(vec3(1.045, 1.01, 0.955), vec3(1.02, 0.99, 0.95), uNight);
  c *= mix(shadowTint, highTint, smoothstep(0.15, 0.85, l));
  // naturlige farger: litt mindre metning (mer i regn)
  c = mix(vec3(luma(c)), c, 0.9 - 0.18 * uWet);
  // vignett
  vec2 d = uv - 0.5; c *= 1.0 - 0.26 * smoothstep(0.12, 0.95, dot(d, d) * 2.0);
  // filmkorn
  c += (hash(uv / px + fract(uTime) * 61.0) - 0.5) * 0.02;
  o = vec4(mix(src, clamp(c, 0.0, 1.0), uAmt), 1.0);
}`,
  init() { try { if (localStorage.getItem('nodbyen.filter') === '0') Grade.on = false; } catch (e) { /* ignorer */ } },
  toggle() { Grade.on = !Grade.on; try { localStorage.setItem('nodbyen.filter', Grade.on ? '1' : '0'); } catch (e) { /* ignorer */ } if (R.map) R.map.triggerRepaint(); return Grade.on; },
  layer: { id: 'grade', type: 'custom', renderingMode: '2d', onAdd(m, gl) { Grade.setup(gl); }, render(gl) { Grade.draw(gl); } },
  setup(gl) {
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return;   // eldre nettlesere: uten filter
    // uten skjermkort (programvaretegning) blir filteret og ekstra oppløsning altfor tungt: slå dem av (…?filter=1 tvinger filteret på)
    let name = ''; try { const dbg = gl.getExtension('WEBGL_debug_renderer_info'); name = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch (e) { /* ignorer */ }
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name) && !/[?&]filter=1/.test(location.search)) { Grade.soft = true; if (Game.ultra) { Game.ultra = false; setTimeout(() => R.applyGfx(), 0); } console.log('[NødByen] Programvaretegning (' + name + '): bildefilter og ultra er av'); return; }
    try {
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, Grade.VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, Grade.FS)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      Grade.prog = p; for (const n of ['T', 'px', 'uNight', 'uWet', 'uTime', 'uHaze', 'uMip', 'uAmt']) Grade.loc[n] = gl.getUniformLocation(p, n);
      Grade.vao = gl.createVertexArray(); Grade.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, Grade.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.bindTexture(gl.TEXTURE_2D, null);
      Grade.ok = true; Grade.w = Grade.h = 0;
    } catch (e) { console.warn('[NødByen] Bildefilteret er slått av:', e); Grade.ok = false; }
  },
  draw(gl) {
    if (!Grade.on || !Grade.ok || Grade.paused) return;
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight; if (W < 4 || H < 4) return;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, Grade.tex);
    if (W !== Grade.w || H !== Grade.h) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); Grade.w = W; Grade.h = H; }
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H); gl.generateMipmap(gl.TEXTURE_2D);
    if (gl.getError() !== gl.NO_ERROR) { Grade.fails = (Grade.fails || 0) + 1; if (Grade.fails > 5) { Grade.ok = false; console.warn('[NødByen] Bildefilteret støttes ikke her og er slått av'); } gl.bindTexture(gl.TEXTURE_2D, null); return; }
    gl.useProgram(Grade.prog); gl.bindVertexArray(Grade.vao);
    for (const cap of [gl.DEPTH_TEST, gl.STENCIL_TEST, gl.BLEND, gl.CULL_FACE, gl.SCISSOR_TEST]) gl.disable(cap);
    gl.colorMask(true, true, true, true); gl.depthMask(false); gl.viewport(0, 0, W, H);
    const env = R.env || {}, night = clamp(1 - (env.daylight == null ? 1 : env.daylight), 0, 1), wet = env.weather === 'regn' || env.weather === 'storm' ? 1 : env.weather === 'snø' ? .5 : 0;
    const L = Grade.loc; gl.uniform1i(L.T, 0); gl.uniform2f(L.px, 1 / W, 1 / H); gl.uniform1f(L.uNight, night); gl.uniform1f(L.uWet, wet); gl.uniform1f(L.uTime, (performance.now() / 1000) % 100);
    gl.uniform1f(L.uHaze, R.map ? clamp(R.map.getPitch() / 70, 0, 1) : 0); gl.uniform1f(L.uMip, Math.max(1, Math.log2(Math.max(W, H) / 360))); gl.uniform1f(L.uAmt, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null); gl.bindTexture(gl.TEXTURE_2D, null); gl.useProgram(null); gl.depthMask(true);
  }
};
