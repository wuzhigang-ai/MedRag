import { useRef, useEffect } from 'react';

const VERT = 'attribute vec2 a_pos;\nvoid main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }';

const FRAG = [
  'precision highp float;',
  'uniform float u_time;',
  'uniform vec2 u_res;',
  'uniform vec2 u_mouse;',
  '',
  '#define PI 3.14159265359',
  '#define WAVE_LAYERS 7',
  '',
  'vec4 sea(vec2 p, float t){',
  '  float h=0.0; vec2 dh=vec2(0.0);',
  '  float freq=1.0, amp=0.15, angle=0.0;',
  '  float decay=0.5;',
  '  for(int i=0;i<WAVE_LAYERS;i++){',
  '    float c=cos(angle), s=sin(angle);',
  '    vec2 pp=vec2(c*p.x+s*p.y, -s*p.x+c*p.y);',
  '    float fi=float(i);',
  '    float spd=sqrt(freq)*0.8;',
  '    float phase=(pp.y+fi)*freq - t*spd;',
  '    float sn=sin(phase), cn=cos(phase);',
  '    h+=sn*amp;',
  '    float dy=freq*amp*cn;',
  '    dh+=vec2(-s*dy, c*dy);',
  '    angle+=fi+1.2;',
  '    freq*=1.3; amp*=decay;',
  '  }',
  '  vec3 N=normalize(vec3(-dh.x, 1.0, -dh.y));',
  '  return vec4(h, N);',
  '}',
  '',
  'vec3 moonDir(){ return normalize(vec3(0.15, 0.35, 1.0)); }',
  '',
  'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }',
  '',
  'vec3 skyColor(vec3 rd){',
  '  vec3 md=moonDir();',
  '  vec3 sky=mix(vec3(0.04,0.04,0.05), vec3(0.02,0.02,0.025), max(rd.y,0.0));',
  '  vec3 mc=vec3(0.9,0.9,0.92);',
  '  float moonDot=max(dot(rd,md),0.0);',
  '  float moonAngle=acos(clamp(moonDot,0.0,1.0));',
  '  float moonR=0.04;',
  '  float disc=smoothstep(moonR, moonR*0.7, moonAngle);',
  '  if(disc>0.0){',
  '    vec3 up=vec3(0.0,1.0,0.0);',
  '    vec3 right=normalize(cross(up,md));',
  '    vec3 mup=cross(md,right);',
  '    vec2 muv=vec2(dot(rd-md,right),dot(rd-md,mup))*25.0;',
  '    float crater=hash(floor(muv*2.0))*0.25+hash(floor(muv*4.0))*0.15;',
  '    float dark=1.0-crater*smoothstep(moonR*0.9,moonR*0.4,moonAngle);',
  '    float limb=smoothstep(0.0,moonR,moonAngle);',
  '    dark*=mix(1.0,0.7,limb*limb);',
  '    sky+=mc*disc*0.75*dark;',
  '  }',
  '  sky+=mc*0.2*pow(moonDot,40.0);',
  '  sky+=mc*0.9*pow(moonDot,400.0);',
  '  return sky;',
  '}',
  '',
  'void main(){',
  '  float aspect=u_res.x/u_res.y;',
  '  vec2 uv=-1.0+2.0*gl_FragCoord.xy/u_res;',
  '  uv.x*=aspect;',
  '  float t=u_time*0.5;',
  '',
  '  float tiltRad=0.15*0.7;',
  '  vec3 ro=vec3(0.0,8.0,0.0);',
  '  vec3 ww=normalize(vec3(0.0,-sin(tiltRad),cos(tiltRad)));',
  '  vec3 uu=normalize(cross(vec3(0.0,1.0,0.0),ww));',
  '  vec3 vv=normalize(cross(ww,uu));',
  '  vec3 rd=normalize(uv.x*uu+uv.y*vv+2.5*ww);',
  '',
  '  vec3 md=moonDir();',
  '  vec3 mc=vec3(0.9,0.9,0.92);',
  '  vec3 sky=skyColor(rd);',
  '  vec3 col=sky;',
  '',
  '  float dsea=-ro.y/rd.y;',
  '  if(dsea>0.0){',
  '    vec3 wp=ro+dsea*rd;',
  '    vec4 s=sea(wp.xz,t);',
  '    float h=s.x; vec3 nor=s.yzw;',
  '',
  '    if(u_mouse.x>0.0){',
  '      vec2 mUV=-1.0+2.0*u_mouse/u_res;',
  '      mUV.x*=aspect;',
  '      vec3 mrd=normalize(mUV.x*uu+mUV.y*vv+2.5*ww);',
  '      float mdsea=-ro.y/mrd.y;',
  '      if(mdsea>0.0){',
  '        vec3 mwp=ro+mdsea*mrd;',
  '        vec2 mdelta=wp.xz-mwp.xz;',
  '        float md2=length(mdelta);',
  '        float mphase=md2*4.0-t*5.0;',
  '        float mamp=exp(-md2*0.15)*0.3;',
  '        h+=sin(mphase)*mamp;',
  '        float mcos=cos(mphase)*mamp*4.0;',
  '        vec2 mgrad=md2>0.01?(mdelta/md2)*mcos:vec2(0.0);',
  '        nor=normalize(nor+vec3(-mgrad.x,0.0,-mgrad.y)*2.0);',
  '      }',
  '    }',
  '    nor=mix(nor,vec3(0.0,1.0,0.0),smoothstep(0.0,300.0,dsea));',
  '',
  '    float fre=clamp(1.0-dot(-nor,rd),0.0,1.0);',
  '    fre=pow(fre,3.0);',
  '    float dif=mix(0.25,1.0,max(dot(nor,md),0.0));',
  '',
  '    vec3 refl=skyColor(reflect(rd,nor));',
  '    vec3 seaCol1=vec3(0.03,0.03,0.04);',
  '    vec3 seaCol2=vec3(0.06,0.06,0.07);',
  '    vec3 refr=seaCol1+dif*mc*seaCol2*0.15;',
  '    col=mix(refr,0.9*refl,fre);',
  '',
  '    float atten=max(1.0-dsea*dsea*0.0005,0.0);',
  '    col+=seaCol2*(wp.y-h)*1.5*atten;',
  '    col=mix(col,sky,1.0-exp(-0.008*dsea));',
  '  }',
  '',
  '  col=pow(max(col,vec3(0.0)),vec3(0.85));',
  '  // Darken for background use',
  '  float lum=dot(col,vec3(0.299,0.587,0.114));',
  '  col=vec3(lum)*0.7;',
  '  gl_FragColor=vec4(col,1.0);',
  '}',
].join('\n');

export default function MoonlitRipple() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) return;

    function compile(type: number, src: string) {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS))
        console.error('Shader:', gl!.getShaderInfoLog(s));
      return s;
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      console.error('Link:', gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uMouse = gl.getUniformLocation(prog, 'u_mouse');

    let mx = -1, my = -1, needsResize = true, running = true, animId = 0;

    const onMove = (e: MouseEvent) => { mx = e.clientX; my = canvas!.clientHeight - e.clientY; };
    const onLeave = () => { mx = -1; my = -1; };
    const onResize = () => { needsResize = true; };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    window.addEventListener('resize', onResize);

    function resize() {
      needsResize = false;
      const w = window.innerWidth, h = window.innerHeight;
      canvas!.width = w; canvas!.height = h;
      gl!.viewport(0, 0, w, h);
      gl!.uniform2f(uRes, w, h);
    }

    function render(now: number) {
      if (!running) return;
      if (needsResize) resize();
      gl!.uniform1f(uTime, now * 0.001);
      gl!.uniform2f(uMouse, mx, my);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      animId = requestAnimationFrame(render);
    }

    resize();
    animId = requestAnimationFrame(render);

    const onVis = () => { if (document.hidden) running = false; else { running = true; animId = requestAnimationFrame(render); } };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false; cancelAnimationFrame(animId);
      canvas!.removeEventListener('mousemove', onMove);
      canvas!.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0" style={{ zIndex: 0, width: '100vw', height: '100vh' }} />;
}
