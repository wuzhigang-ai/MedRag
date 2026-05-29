import { useRef, useEffect } from 'react';

const VERT_SRC = [
  'attribute vec2 a_pos;',
  'void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }',
].join('\n');

const FRAG_SRC = [
  'precision highp float;',
  'uniform float u_time;',
  'uniform vec2 u_res;',
  'uniform float u_flowSpeed;',
  'uniform float u_sheenIntensity;',
  'uniform vec2 u_mouse;',
  '',
  'float hash12(vec2 p){',
  '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
  '  p3 += dot(p3, p3.yzx + 33.33);',
  '  return fract((p3.x + p3.y) * p3.z);',
  '}',
  '',
  'float vnoise(vec2 p){',
  '  vec2 i = floor(p); vec2 f = fract(p);',
  '  f = f * f * (3.0 - 2.0 * f);',
  '  float a = hash12(i);',
  '  float b = hash12(i + vec2(1.0, 0.0));',
  '  float c = hash12(i + vec2(0.0, 1.0));',
  '  float d = hash12(i + vec2(1.0, 1.0));',
  '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
  '}',
  '',
  'float fbm3(vec2 p){',
  '  float v = 0.0; float a = 0.5;',
  '  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);',
  '  for(int i = 0; i < 3; i++){',
  '    v += a * vnoise(p); p = rot * p * 2.0; a *= 0.5;',
  '  }',
  '  return v;',
  '}',
  '',
  'float fbm2(vec2 p){',
  '  float v = 0.5 * vnoise(p);',
  '  p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.0;',
  '  v += 0.25 * vnoise(p);',
  '  return v;',
  '}',
  '',
  'vec2 domainWarp(vec2 p, float t, float scale, float seed){',
  '  return vec2(',
  '    fbm3(p * scale + vec2(1.7 + seed, 9.2) + t * 0.15),',
  '    fbm3(p * scale + vec2(8.3, 2.8 + seed) - t * 0.12)',
  '  );',
  '}',
  '',
  'vec2 domainWarpLite(vec2 p, float t, float scale, float seed){',
  '  return vec2(',
  '    fbm2(p * scale + vec2(1.7 + seed, 9.2) + t * 0.15),',
  '    fbm2(p * scale + vec2(8.3, 2.8 + seed) - t * 0.12)',
  '  );',
  '}',
  '',
  'vec3 fabricFold(vec2 p, float t, float seed, float freq, float flow){',
  '  float ts = t * flow;',
  '  vec2 warp = domainWarp(p + seed * 3.7, ts, 1.2, seed);',
  '  vec2 wp = p + warp * 0.55;',
  '  float h = 0.0; vec2 g = vec2(0.0);',
  '  float f1x = freq * 0.7; float f1y = freq * 0.4;',
  '  float ph1 = wp.x * f1x + wp.y * f1y + ts * 0.3 + seed * 2.1;',
  '  h += sin(ph1) * 0.35; g += cos(ph1) * 0.35 * vec2(f1x, f1y);',
  '  float f2x = -freq * 0.3; float f2y = freq * 0.9;',
  '  float ph2 = wp.x * f2x + wp.y * f2y + ts * 0.25 + seed * 1.3;',
  '  h += sin(ph2) * 0.25; g += cos(ph2) * 0.25 * vec2(f2x, f2y);',
  '  float f3 = freq * 0.6;',
  '  float ph3 = (wp.x + wp.y) * f3 + ts * 0.2 + seed * 4.5;',
  '  h += sin(ph3) * 0.18; g += cos(ph3) * 0.18 * vec2(f3, f3);',
  '  float f4x = freq * 1.8; float f4y = freq * 1.2;',
  '  float ph4 = wp.x * f4x + wp.y * f4y - ts * 0.35 + seed * 0.7;',
  '  h += sin(ph4) * 0.08; g += cos(ph4) * 0.08 * vec2(f4x, f4y);',
  '  h += vnoise(wp * freq * 0.9 + seed * 10.0 + ts * 0.04) * 0.12 - 0.06;',
  '  return vec3(h, g);',
  '}',
  '',
  'vec3 fabricFoldLite(vec2 p, float t, float seed, float freq, float flow){',
  '  float ts = t * flow;',
  '  vec2 warp = domainWarpLite(p + seed * 3.7, ts, 1.2, seed);',
  '  vec2 wp = p + warp * 0.55;',
  '  float h = 0.0; vec2 g = vec2(0.0);',
  '  float f1x = freq * 0.7; float f1y = freq * 0.4;',
  '  float ph1 = wp.x * f1x + wp.y * f1y + ts * 0.3 + seed * 2.1;',
  '  h += sin(ph1) * 0.35; g += cos(ph1) * 0.35 * vec2(f1x, f1y);',
  '  float f2x = -freq * 0.3; float f2y = freq * 0.9;',
  '  float ph2 = wp.x * f2x + wp.y * f2y + ts * 0.25 + seed * 1.3;',
  '  h += sin(ph2) * 0.25; g += cos(ph2) * 0.25 * vec2(f2x, f2y);',
  '  float f3 = freq * 0.6;',
  '  float ph3 = (wp.x + wp.y) * f3 + ts * 0.2 + seed * 4.5;',
  '  h += sin(ph3) * 0.18; g += cos(ph3) * 0.18 * vec2(f3, f3);',
  '  float f4x = freq * 1.8; float f4y = freq * 1.2;',
  '  float ph4 = wp.x * f4x + wp.y * f4y - ts * 0.35 + seed * 0.7;',
  '  h += sin(ph4) * 0.08; g += cos(ph4) * 0.08 * vec2(f4x, f4y);',
  '  return vec3(h, g);',
  '}',
  '',
  'float kajiyaSpec(vec2 grad, vec3 L, vec3 V, float shine){',
  '  float gl2 = dot(grad, grad);',
  '  if(gl2 < 0.0001) return 0.0;',
  '  vec2 tg = vec2(-grad.y, grad.x) / sqrt(gl2);',
  '  vec3 T = normalize(vec3(tg, 0.0));',
  '  vec3 H = normalize(L + V);',
  '  float TdH = dot(T, H);',
  '  return pow(sqrt(max(1.0 - TdH * TdH, 0.0)), shine);',
  '}',
  '',
  'vec4 shadeLayer(',
  '  vec2 p, float t, float seed, float freq, float flow,',
  '  vec3 darkCol, vec3 midCol, vec3 brightCol, vec3 specCol,',
  '  float opacity, float shine, vec3 L1, vec3 L2, vec3 V, float sheenMul',
  '){',
  '  vec3 fold = opacity < 0.35 ? fabricFoldLite(p, t, seed, freq, flow) : fabricFold(p, t, seed, freq, flow);',
  '  float h = fold.x; vec2 grad = fold.yz;',
  '  vec3 N = normalize(vec3(-grad * 1.8, 1.0));',
  '  float NdL1 = max(dot(N, L1), 0.0);',
  '  float NdL2 = max(dot(N, L2), 0.0);',
  '  float lit = NdL1 * 0.75 + NdL2 * 0.12;',
  '  float depth = smoothstep(-0.8, 0.4, h);',
  '  float shade = lit * depth;',
  '  float midBlend = smoothstep(0.0, 0.35, shade);',
  '  float brightBlend = smoothstep(0.25, 0.7, shade);',
  '  vec3 fabric = mix(darkCol, midCol, midBlend);',
  '  fabric = mix(fabric, brightCol, brightBlend * 0.5);',
  '  float sp = kajiyaSpec(grad, L1, V, shine) * 0.9;',
  '  sp += kajiyaSpec(grad, L2, V, shine * 0.6) * 0.15;',
  '  sp *= sheenMul;',
  '  float specPow = sp * sp * sp;',
  '  fabric += specCol * specPow * 0.9;',
  '  float trans = smoothstep(0.3, 0.9, depth) * lit * 0.08;',
  '  fabric += vec3(0.15) * trans;',
  '  float sparkle = hash12(floor(p * 500.0 + t * 0.7));',
  '  sparkle = step(0.9992, sparkle) * specPow * 20.0 * sheenMul;',
  '  fabric += specCol * min(sparkle, 2.0);',
  '  float alpha = opacity * (0.65 + depth * 0.35);',
  '  return vec4(fabric, alpha);',
  '}',
  '',
  'void main(){',
  '  vec2 uv = gl_FragCoord.xy / u_res;',
  '  float aspect = u_res.x / u_res.y;',
  '  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);',
  '  float t = u_time * u_flowSpeed;',
  '',
  '  vec3 L1 = normalize(vec3(0.4 + sin(t * 0.07) * 0.3, 0.9 + cos(t * 0.09) * 0.15, 0.8));',
  '  if(u_mouse.x > 0.0){',
  '    vec2 mUV = u_mouse / u_res - 0.5;',
  '    L1 = normalize(vec3(mUV.x * 2.0, mUV.y * 2.0 + 0.5, 0.8));',
  '  }',
  '  vec3 L2 = normalize(vec3(-0.7 + cos(t * 0.06) * 0.2, -0.3 + sin(t * 0.08) * 0.15, 0.6));',
  '  vec3 V = vec3(0.0, 0.0, 1.0);',
  '',
  '  // Background: pure black',
  '  float bgD = length(p);',
  '  vec3 bg = mix(vec3(0.015), vec3(0.002), smoothstep(0.0, 1.0, bgD));',
  '',
  '  // Layer 1: dark silk',
  '  vec4 ly1 = shadeLayer(',
  '    p * 0.8 + vec2(0.15, t * 0.015), t,',
  '    0.0, 2.0, 0.5,',
  '    vec3(0.02),',
  '    vec3(0.07),',
  '    vec3(0.16),',
  '    vec3(0.50),',
  '    0.22, 26.0, L1, L2, V, u_sheenIntensity * 0.5',
  '  );',
  '',
  '  // Layer 2: mid silk',
  '  vec4 ly2 = shadeLayer(',
  '    p * 1.0 + vec2(t * 0.012, -0.1), t,',
  '    1.0, 3.2, 0.75,',
  '    vec3(0.015),',
  '    vec3(0.06),',
  '    vec3(0.15),',
  '    vec3(0.48),',
  '    0.28, 40.0, L1, L2, V, u_sheenIntensity * 0.6',
  '  );',
  '',
  '  // Layer 3: front silk',
  '  vec4 ly3 = shadeLayer(',
  '    p * 1.2 + vec2(-t * 0.008, t * 0.02), t,',
  '    2.0, 4.5, 1.0,',
  '    vec3(0.018),',
  '    vec3(0.06),',
  '    vec3(0.15),',
  '    vec3(0.52),',
  '    0.35, 55.0, L1, L2, V, u_sheenIntensity * 0.7',
  '  );',
  '',
  '  // Composite back-to-front',
  '  vec3 col = bg;',
  '  col = mix(col, ly1.rgb, ly1.a);',
  '  col += vec3(0.04) * ly1.a * ly2.a * 0.06;',
  '  col = mix(col, ly2.rgb, ly2.a);',
  '  col += vec3(0.03) * ly2.a * ly3.a * 0.04;',
  '  col = mix(col, ly3.rgb, ly3.a);',
  '',
  '  // Strong vignette — push edges to black',
  '  float vig = 1.0 - smoothstep(0.15, 0.95, length(p * vec2(0.85, 1.0)));',
  '  col *= 0.4 + 0.6 * vig;',
  '',
  '  // Full desaturate — pure white light',
  '  float lum = dot(col, vec3(0.299, 0.587, 0.114));',
  '  col = vec3(lum);',
  '',
  '  // Darken overall — keep contrast, not foggy',
  '  col = pow(col, vec3(1.6)) * 1.8;',
  '',
  '  // ACES tone mapping',
  '  col = col * (2.51 * col + 0.03) / (col * (2.43 * col + 0.59) + 0.14);',
  '  col = pow(max(col, vec3(0.0)), vec3(0.4545));',
  '',
  '  // Film grain',
  '  float grain = hash12(gl_FragCoord.xy + fract(u_time * 7.13) * 100.0);',
  '  col += (grain - 0.5) * 0.012;',
  '',
  '  gl_FragColor = vec4(clamp(col, vec3(0.0), vec3(1.0)), 1.0);',
  '}',
].join('\n');

export default function FlowField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) { console.error('WebGL not available'); return; }

    // Compile shaders
    function compile(type: number, src: string) {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
        console.error('Shader error:', gl!.getShaderInfoLog(s));
        return null;
      }
      return s;
    }

    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Link error:', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    // Full-screen triangle
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Uniforms
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uFlow = gl.getUniformLocation(prog, 'u_flowSpeed');
    const uSheen = gl.getUniformLocation(prog, 'u_sheenIntensity');
    const uMouse = gl.getUniformLocation(prog, 'u_mouse');

    let mx = -1.0, my = -1.0;
    let needsResize = true;
    let running = true;
    let animId = 0;

    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = canvas!.clientHeight - e.clientY;
    };
    const onLeave = () => { mx = -1.0; my = -1.0; };
    const onResize = () => { needsResize = true; };

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    window.addEventListener('resize', onResize);

    function resize() {
      needsResize = false;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas!.width = w;
      canvas!.height = h;
      canvas!.style.width = w + 'px';
      canvas!.style.height = h + 'px';
      gl!.viewport(0, 0, w, h);
      gl!.uniform2f(uRes, w, h);
    }

    function render(now: number) {
      if (!running) return;
      if (needsResize) resize();
      gl!.uniform1f(uTime, now * 0.001);
      gl!.uniform1f(uFlow, 0.4);
      gl!.uniform1f(uSheen, 1.0);
      gl!.uniform2f(uMouse, mx, my);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      animId = requestAnimationFrame(render);
    }

    resize();
    animId = requestAnimationFrame(render);

    const onVis = () => {
      if (document.hidden) { running = false; }
      else { running = true; animId = requestAnimationFrame(render); }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false;
      cancelAnimationFrame(animId);
      canvas!.removeEventListener('mousemove', onMove);
      canvas!.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0"
      style={{ zIndex: 0, width: '100vw', height: '100vh' }}
    />
  );
}
