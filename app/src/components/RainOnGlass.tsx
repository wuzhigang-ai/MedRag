import { useRef, useEffect } from 'react';

export default function RainOnGlass() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ── Tunables ──
    let RAIN_AMOUNT = 1.0;
    let REFRACTION = 1.0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let paused = false;
    let destroyed = false;

    // ── Helpers ──
    function random(from?: any, to?: any, interp?: any): number {
      if (from == null) { from = 0; to = 1; }
      else if (to == null) { to = from; from = 0; }
      if (typeof to === 'function') { interp = to; to = from; from = 0; }
      const delta = to - from;
      if (!interp) interp = (n: number) => n;
      return from + (interp(Math.random()) * delta);
    }
    function chance(c: number) { return Math.random() <= c; }
    function createCanvas(w: number, h: number) {
      const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
    }

    // ── Drop textures ──
    const dropSize = 64;

    function generateDropAlpha(size: number) {
      const c = createCanvas(size, size);
      const ctx = c.getContext('2d')!;
      const img = ctx.createImageData(size, size);
      const d = img.data;
      const cx = size / 2, cy = size / 2;
      for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
          let dx = (px - cx) / cx, dy = (py - cy) / cy;
          dy *= 1.0 + dy * 0.15;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 1) continue;
          const alpha = Math.max(0, 1.0 - Math.pow(dist / 0.35, 6)) * 255;
          const i = (py * size + px) * 4;
          d[i] = d[i + 1] = d[i + 2] = 255;
          d[i + 3] = Math.round(Math.min(255, Math.max(0, alpha)));
        }
      }
      ctx.putImageData(img, 0, 0); return c;
    }

    function generateDropColor(size: number) {
      const c = createCanvas(size, size);
      const ctx = c.getContext('2d')!;
      const img = ctx.createImageData(size, size);
      const d = img.data;
      const cx = size / 2, cy = size / 2;
      for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
          let dx = (px - cx) / cx, dy = (py - cy) / cy;
          dy *= 1.0 + dy * 0.15;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 1) continue;
          const nx = dist > 0.001 ? dx / dist : 0;
          const ny = dist > 0.001 ? dy / dist : 0;
          const strength = dist;
          const i = (py * size + px) * 4;
          d[i] = Math.max(0, Math.min(255, Math.round(ny * 60 * strength + 128)));
          d[i + 1] = Math.max(0, Math.min(255, Math.round(nx * 60 * strength + 128)));
          d[i + 2] = Math.round(Math.sqrt(Math.max(0, 1 - dist * dist)) * 255);
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0); return c;
    }

    const dropAlphaTex = generateDropAlpha(dropSize);
    const dropColorTex = generateDropColor(dropSize);

    // ── Cityscape background ──
    let bgSeed = 42;
    function srand() { bgSeed = (bgSeed * 16807 + 0) % 2147483647; return (bgSeed - 1) / 2147483646; }

    function generateCityBg(w: number, h: number, blurPx: number) {
      const c = createCanvas(w, h); const ctx = c.getContext('2d')!; bgSeed = 42;
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#0c0a1a'); sky.addColorStop(0.15, '#1a1228'); sky.addColorStop(0.35, '#2a1830');
      sky.addColorStop(0.55, '#4a2520'); sky.addColorStop(0.75, '#6a3818'); sky.addColorStop(1, '#8a4a10');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

      const glow = ctx.createLinearGradient(0, h * 0.3, 0, h);
      glow.addColorStop(0, 'rgba(200,100,30,0)'); glow.addColorStop(0.3, 'rgba(200,120,40,0.15)');
      glow.addColorStop(0.6, 'rgba(210,140,50,0.3)'); glow.addColorStop(1, 'rgba(220,150,60,0.5)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);

      const bColors = ['#08060e', '#0a0812', '#0c0a16', '#0e0c1a'];
      for (let b = 0; b < 35; b++) {
        const bx = srand() * w * 1.3 - w * 0.15, bw = w * 0.02 + srand() * w * 0.12;
        const bh = h * 0.15 + srand() * h * 0.55, by = h - bh + srand() * h * 0.05;
        ctx.fillStyle = bColors[b % bColors.length]; ctx.fillRect(bx, by, bw, bh);
        const wRows = Math.floor(bh / (h * 0.04)), wCols = Math.floor(bw / (w * 0.02));
        for (let wr = 0; wr < wRows; wr++) for (let wc = 0; wc < wCols; wc++) {
          if (srand() > 0.45) {
            const wx = bx + w * 0.005 + wc * (w * 0.02), wy = by + h * 0.01 + wr * (h * 0.04);
            const warmth = srand();
            ctx.fillStyle = warmth > 0.3 ? `rgba(255,200,120,${0.4 + srand() * 0.5})` : warmth > 0.1 ? `rgba(255,160,80,${0.3 + srand() * 0.4})` : `rgba(180,220,255,${0.2 + srand() * 0.3})`;
            ctx.fillRect(wx, wy, w * 0.008, h * 0.02);
          }
        }
      }

      for (let i = 0; i < 80; i++) {
        const bkx = srand() * w, bky = h * 0.1 + srand() * h * 0.85, bkr = w * 0.02 + srand() * w * 0.15;
        const rndC = srand();
        let hue: number, sat: number, lit: number;
        if (rndC < 0.45) { hue = 25 + srand() * 20; sat = 80 + srand() * 20; lit = 55 + srand() * 35; }
        else if (rndC < 0.7) { hue = 10 + srand() * 15; sat = 85 + srand() * 15; lit = 50 + srand() * 30; }
        else if (rndC < 0.85) { hue = 40 + srand() * 15; sat = 75 + srand() * 25; lit = 60 + srand() * 30; }
        else if (rndC < 0.93) { hue = 200 + srand() * 30; sat = 60 + srand() * 30; lit = 50 + srand() * 30; }
        else { hue = 330 + srand() * 25; sat = 65 + srand() * 25; lit = 55 + srand() * 25; }
        const alpha = 0.08 + srand() * 0.25;
        const g = ctx.createRadialGradient(bkx, bky, 0, bkx, bky, bkr);
        g.addColorStop(0, `hsla(${hue},${sat}%,${lit}%,${alpha * 1.3})`);
        g.addColorStop(0.3, `hsla(${hue},${sat}%,${lit}%,${alpha * 0.6})`);
        g.addColorStop(0.6, `hsla(${hue},${sat}%,${lit}%,${alpha * 0.15})`);
        g.addColorStop(1, `hsla(${hue},${sat}%,${lit}%,0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bkx, bky, bkr, 0, Math.PI * 2); ctx.fill();
      }

      for (let p = 0; p < 25; p++) {
        const px = srand() * w, py = h * 0.35 + srand() * h * 0.6, pr = w * 0.005 + srand() * w * 0.03;
        const pH = srand() > 0.3 ? (20 + srand() * 25) : (195 + srand() * 30);
        const pg = ctx.createRadialGradient(px, py, 0, px, py, pr);
        pg.addColorStop(0, `hsla(${pH},95%,90%,0.9)`); pg.addColorStop(0.2, `hsla(${pH},90%,75%,0.45)`);
        pg.addColorStop(0.5, `hsla(${pH},85%,60%,0.15)`); pg.addColorStop(1, `hsla(${pH},80%,55%,0)`);
        ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
      }

      const amb = ctx.createLinearGradient(0, h * 0.5, 0, h);
      amb.addColorStop(0, 'rgba(200,130,50,0)'); amb.addColorStop(0.5, 'rgba(200,130,50,0.06)'); amb.addColorStop(1, 'rgba(220,150,60,0.12)');
      ctx.fillStyle = amb; ctx.fillRect(0, 0, w, h);

      if (blurPx > 0) {
        const tmp = createCanvas(w, h); const tctx = tmp.getContext('2d')!;
        tctx.drawImage(c, 0, 0); ctx.clearRect(0, 0, w, h);
        ctx.filter = `blur(${blurPx}px)`; ctx.drawImage(tmp, 0, 0); ctx.filter = 'none';
      }
      return c;
    }

    const textureFgCanvas = generateCityBg(96, 64, 1);
    const textureBgCanvas = generateCityBg(384, 256, 8);

    // ── Drop bitmaps (255 depth levels) ──
    let dropsGfx: HTMLCanvasElement[] = [];
    let clearDropletsGfx: HTMLCanvasElement;

    function renderDropsGfx() {
      const dropBuffer = createCanvas(dropSize, dropSize);
      const dropBufferCtx = dropBuffer.getContext('2d')!;
      dropsGfx = [];
      for (let i = 0; i < 255; i++) {
        const drop = createCanvas(dropSize, dropSize);
        const dropCtx = drop.getContext('2d')!;
        dropBufferCtx.clearRect(0, 0, dropSize, dropSize);
        dropBufferCtx.globalCompositeOperation = 'source-over';
        dropBufferCtx.drawImage(dropColorTex, 0, 0, dropSize, dropSize);
        dropBufferCtx.globalCompositeOperation = 'screen';
        dropBufferCtx.fillStyle = `rgba(0,0,${i},1)`;
        dropBufferCtx.fillRect(0, 0, dropSize, dropSize);
        dropCtx.globalCompositeOperation = 'source-over';
        dropCtx.drawImage(dropAlphaTex, 0, 0, dropSize, dropSize);
        dropCtx.globalCompositeOperation = 'source-in';
        dropCtx.drawImage(dropBuffer, 0, 0, dropSize, dropSize);
        dropsGfx.push(drop);
      }
      clearDropletsGfx = createCanvas(128, 128);
      const clearCtx = clearDropletsGfx.getContext('2d')!;
      clearCtx.fillStyle = '#000'; clearCtx.beginPath(); clearCtx.arc(64, 64, 64, 0, Math.PI * 2); clearCtx.fill();
    }

    // ── Physics ──
    interface DropState { x: number; y: number; r: number; spreadX: number; spreadY: number; momentum: number; momentumX: number; lastSpawn: number; nextSpawn: number; parent: DropState | null; isNew: boolean; killed: boolean; shrink: number; }

    const options = {
      minR: 20, maxR: 50, maxDrops: 900, rainChance: 0.35, rainLimit: 6,
      dropletsRate: 120, dropletsSize: [2, 5] as [number, number],
      dropletsCleaningRadiusMultiplier: 0.28, raining: true, globalTimeScale: 1,
      trailRate: 1, autoShrink: true, spawnArea: [-0.1, 0.95] as [number, number],
      trailScaleRange: [0.25, 0.35] as [number, number], collisionRadius: 0.45,
      collisionRadiusIncrease: 0.0002, dropFallMultiplier: 1,
      collisionBoostMultiplier: 0.05, collisionBoost: 1,
    };

    let rdWidth = 0, rdHeight = 0, rdScale = 1;
    let rdCanvas: HTMLCanvasElement, rdCtx: CanvasRenderingContext2D;
    let dropletsCanvas: HTMLCanvasElement, dropletsCtx: CanvasRenderingContext2D;
    const dropletsPixelDensity = 1;
    let dropletsCounter = 0;
    let drops: DropState[] = [];
    let textureCleaningIterations = 0;
    let rdLastRender: number | null = null;

    function deltaR() { return options.maxR - options.minR; }
    function area() { return (rdWidth * rdHeight) / rdScale; }
    function areaMultiplier() { return Math.sqrt(area() / (1024 * 768)); }

    function drawDrop(ctx: CanvasRenderingContext2D, drop: DropState) {
      if (dropsGfx.length <= 0) return;
      const { x, y, r, spreadX, spreadY } = drop;
      const scaleX = 1, scaleY = 1.5;
      let d = Math.max(0, Math.min(1, ((r - options.minR) / deltaR()) * 0.9));
      d *= 1 / (((spreadX + spreadY) * 0.5) + 1);
      d = Math.floor(d * (dropsGfx.length - 1));
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(dropsGfx[d],
        (x - (r * scaleX * (spreadX + 1))) * rdScale,
        (y - (r * scaleY * (spreadY + 1))) * rdScale,
        (r * 2 * scaleX * (spreadX + 1)) * rdScale,
        (r * 2 * scaleY * (spreadY + 1)) * rdScale);
    }

    function drawDroplet(x: number, y: number, r: number) {
      drawDrop(dropletsCtx, { x: x * dropletsPixelDensity, y: y * dropletsPixelDensity, r: r * dropletsPixelDensity, spreadX: 0, spreadY: 0, momentum: 0, momentumX: 0, lastSpawn: 0, nextSpawn: 0, parent: null, isNew: false, killed: false, shrink: 0 });
    }

    function clearDroplets(x: number, y: number, r?: number) {
      if (!r) r = 30;
      dropletsCtx.globalCompositeOperation = 'destination-out';
      dropletsCtx.drawImage(clearDropletsGfx, (x - r) * dropletsPixelDensity * rdScale, (y - r) * dropletsPixelDensity * rdScale, (r * 2) * dropletsPixelDensity * rdScale, (r * 2) * dropletsPixelDensity * rdScale * 1.5);
    }

    function rdCreateDrop(opts: Partial<DropState>): DropState | null {
      if (drops.length >= options.maxDrops * areaMultiplier()) return null;
      return { x: 0, y: 0, r: 0, spreadX: 0, spreadY: 0, momentum: 0, momentumX: 0, lastSpawn: 0, nextSpawn: 0, parent: null, isNew: true, killed: false, shrink: 0, ...opts };
    }

    function updateRain(timeScale: number): DropState[] {
      const rainDrops: DropState[] = [];
      if (!options.raining) return rainDrops;
      const limit = options.rainLimit * timeScale * areaMultiplier() * RAIN_AMOUNT;
      let count = 0;
      while (chance(options.rainChance * timeScale * areaMultiplier() * RAIN_AMOUNT) && count < limit) {
        count++;
        const r = random(options.minR, options.maxR, (n: number) => Math.pow(n, 3));
        const rd = rdCreateDrop({ x: random(rdWidth / rdScale), y: random((rdHeight / rdScale) * options.spawnArea[0], (rdHeight / rdScale) * options.spawnArea[1]), r, momentum: 1 + ((r - options.minR) * 0.1) + random(2), spreadX: 1.5, spreadY: 1.5 });
        if (rd) rainDrops.push(rd);
      }
      return rainDrops;
    }

    function updateDroplets(timeScale: number) {
      if (textureCleaningIterations > 0) {
        textureCleaningIterations -= 1 * timeScale;
        dropletsCtx.globalCompositeOperation = 'destination-out';
        dropletsCtx.fillStyle = `rgba(0,0,0,${0.05 * timeScale})`;
        dropletsCtx.fillRect(0, 0, rdWidth * dropletsPixelDensity, rdHeight * dropletsPixelDensity);
      }
      if (options.raining) {
        dropletsCounter += options.dropletsRate * timeScale * areaMultiplier() * RAIN_AMOUNT;
        let total = Math.floor(dropletsCounter); dropletsCounter -= total;
        while (total > 0) {
          if (chance(0.8) && total >= 4) {
            const cs = Math.min(total, 4 + Math.floor(Math.random() * 5));
            const cx = random(rdWidth / rdScale), cy = random(rdHeight / rdScale), spread = 4 + Math.random() * 8;
            for (let ci = 0; ci < cs; ci++) {
              const a = Math.random() * Math.PI * 2, dist = Math.random() * spread;
              drawDroplet(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, random(options.dropletsSize[0], options.dropletsSize[1], (n: number) => n * n));
            }
            total -= cs;
          } else {
            drawDroplet(random(rdWidth / rdScale), random(rdHeight / rdScale), random(options.dropletsSize[0], options.dropletsSize[1], (n: number) => n * n));
            total--;
          }
        }
      }
      rdCtx.drawImage(dropletsCanvas, 0, 0, rdWidth, rdHeight);
    }

    function updateDrops(timeScale: number) {
      let newDrops: DropState[] = [];
      updateDroplets(timeScale);
      newDrops = newDrops.concat(updateRain(timeScale));
      drops.sort((a, b) => { const va = a.y * (rdWidth / rdScale) + a.x, vb = b.y * (rdWidth / rdScale) + b.x; return va > vb ? 1 : va === vb ? 0 : -1; });

      for (let i = 0; i < drops.length; i++) {
        const drop = drops[i];
        if (drop.killed) continue;
        if (chance((drop.r - (options.minR * options.dropFallMultiplier)) * (0.1 / deltaR()) * timeScale)) drop.momentum += random((drop.r / options.maxR) * 4);
        if (options.autoShrink && drop.r <= options.minR && chance(0.05 * timeScale)) drop.shrink += 0.01;
        drop.r -= drop.shrink * timeScale;
        if (drop.r <= 0) { drop.killed = true; continue; }
        if (options.raining) {
          drop.lastSpawn += drop.momentum * timeScale * options.trailRate;
          if (drop.lastSpawn > drop.nextSpawn) {
            const trailDrop = rdCreateDrop({ x: drop.x + (random(-drop.r, drop.r) * 0.1), y: drop.y - (drop.r * 0.01), r: drop.r * random(options.trailScaleRange[0], options.trailScaleRange[1]), spreadY: drop.momentum * 0.1, parent: drop });
            if (trailDrop) { newDrops.push(trailDrop); drop.r *= Math.pow(0.97, timeScale); drop.lastSpawn = 0; drop.nextSpawn = random(options.minR, options.maxR) - (drop.momentum * 2 * options.trailRate) + (options.maxR - drop.r); }
          }
        }
        drop.spreadX *= Math.pow(0.4, timeScale); drop.spreadY *= Math.pow(0.7, timeScale);
        const moved = drop.momentum > 0;
        if (moved && !drop.killed) { drop.y += drop.momentum * options.globalTimeScale; drop.x += drop.momentumX * options.globalTimeScale; if (drop.y > (rdHeight / rdScale) + drop.r) drop.killed = true; }
        const checkCollision = (moved || drop.isNew) && !drop.killed;
        drop.isNew = false;
        if (checkCollision) {
          const end = Math.min(i + 70, drops.length);
          for (let j = i + 1; j < end; j++) {
            const d2 = drops[j];
            if (drop === d2 || drop.r <= d2.r || drop.parent === d2 || d2.parent === drop || d2.killed) continue;
            const dx = d2.x - drop.x, dy = d2.y - drop.y, dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < (drop.r + d2.r) * (options.collisionRadius + (drop.momentum * options.collisionRadiusIncrease * timeScale))) {
              const a1 = Math.PI * drop.r * drop.r, a2 = Math.PI * d2.r * d2.r;
              let targetR = Math.sqrt((a1 + (a2 * 0.8)) / Math.PI);
              if (targetR > options.maxR) targetR = options.maxR;
              drop.r = targetR; drop.momentumX += dx * 0.1; drop.spreadX = 0; drop.spreadY = 0; d2.killed = true;
              drop.momentum = Math.max(d2.momentum, Math.min(40, drop.momentum + (targetR * options.collisionBoostMultiplier) + options.collisionBoost));
            }
          }
        }
        drop.momentum -= Math.max(1, (options.minR * 0.5) - drop.momentum) * 0.1 * timeScale;
        if (drop.momentum < 0) drop.momentum = 0;
        drop.momentumX *= Math.pow(0.7, timeScale);
        if (!drop.killed) {
          newDrops.push(drop);
          if (moved && options.dropletsRate > 0) clearDroplets(drop.x, drop.y, drop.r * options.dropletsCleaningRadiusMultiplier);
          drawDrop(rdCtx, drop);
        }
      }
      drops = newDrops;
    }

    function rdUpdate() {
      rdCtx.clearRect(0, 0, rdWidth, rdHeight);
      const now = Date.now();
      if (rdLastRender == null) rdLastRender = now;
      let timeScale = (now - rdLastRender) / ((1 / 60) * 1000);
      if (timeScale > 1.1) timeScale = 1.1;
      timeScale *= options.globalTimeScale;
      rdLastRender = now;
      updateDrops(timeScale);
    }

    function initRaindrops(w: number, h: number, scale: number) {
      rdWidth = w; rdHeight = h; rdScale = scale;
      rdCanvas = createCanvas(rdWidth, rdHeight); rdCtx = rdCanvas.getContext('2d')!;
      dropletsCanvas = createCanvas(rdWidth * dropletsPixelDensity, rdHeight * dropletsPixelDensity); dropletsCtx = dropletsCanvas.getContext('2d')!;
      drops = []; dropletsCounter = 0; rdLastRender = null;
      renderDropsGfx();
    }

    // ── WebGL ──
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) return;

    const vertSrc = 'precision mediump float;\nattribute vec2 a_position;\nvoid main(){ gl_Position=vec4(a_position,0.0,1.0); }';
    const fragSrc = [
      'precision mediump float;',
      'uniform sampler2D u_waterMap;', 'uniform sampler2D u_textureShine;', 'uniform sampler2D u_textureFg;', 'uniform sampler2D u_textureBg;',
      'uniform vec2 u_resolution;', 'uniform vec2 u_parallax;', 'uniform float u_parallaxFg;', 'uniform float u_parallaxBg;',
      'uniform float u_textureRatio;', 'uniform bool u_renderShine;', 'uniform bool u_renderShadow;',
      'uniform float u_minRefraction;', 'uniform float u_refractionDelta;', 'uniform float u_brightness;',
      'uniform float u_alphaMultiply;', 'uniform float u_alphaSubtract;',
      'vec4 blend(vec4 bg,vec4 fg){ vec3 bgm=bg.rgb*bg.a; vec3 fgm=fg.rgb*fg.a; float ia=1.0-fg.a; float a=fg.a+bg.a*ia; vec3 rgb=a!=0.0?(fgm+bgm*ia)/a:vec3(0.0); return vec4(rgb,a); }',
      'vec2 pixel(){ return vec2(1.0)/u_resolution; }',
      'vec2 parallax(float v){ return u_parallax*pixel()*v; }',
      'vec2 texCoord(){ return vec2(gl_FragCoord.x, u_resolution.y-gl_FragCoord.y)/u_resolution; }',
      'vec2 scaledTexCoord(){ float ratio=u_resolution.x/u_resolution.y; vec2 scale=vec2(1.0); vec2 offset=vec2(0.0); float rd=ratio-u_textureRatio; if(rd>=0.0){ scale.y=1.0+rd; offset.y=rd/2.0; } else { scale.x=1.0-rd; offset.x=-rd/2.0; } return (texCoord()+offset)/scale; }',
      'vec4 fgColor(float x,float y){ float p2=u_parallaxFg*2.0; vec2 scale=vec2((u_resolution.x+p2)/u_resolution.x,(u_resolution.y+p2)/u_resolution.y); vec2 stc=texCoord()/scale; vec2 off=vec2((1.0-1.0/scale.x)/2.0,(1.0-1.0/scale.y)/2.0); return texture2D(u_waterMap,(stc+off)+(pixel()*vec2(x,y))+parallax(u_parallaxFg)); }',
      'void main(){',
      '  vec4 bg=texture2D(u_textureBg, scaledTexCoord()+parallax(u_parallaxBg));',
      '  vec4 cur=fgColor(0.0,0.0);',
      '  float d=cur.b; float x=cur.g; float y=cur.r;',
      '  float a=clamp(cur.a*u_alphaMultiply-u_alphaSubtract, 0.0, 1.0);',
      '  vec2 refraction=(vec2(x,y)-0.5)*2.0;',
      '  vec2 refractionPos=scaledTexCoord()+(pixel()*refraction*(u_minRefraction+(d*u_refractionDelta)))+parallax(u_parallaxBg-u_parallaxFg);',
      '  vec4 tex=texture2D(u_textureFg, refractionPos);',
      '  if(u_renderShine){ float maxS=490.0; float minS=maxS*0.18; vec2 sp=vec2(0.5)+((1.0/512.0)*refraction)*-(minS+((maxS-minS)*d)); vec4 shine=texture2D(u_textureShine,sp); tex=blend(tex,shine); }',
      '  vec4 fg=vec4(tex.rgb*u_brightness, a);',
      '  if(u_renderShadow){ float ba=fgColor(0.0,-(d*6.0)).a; ba=ba*u_alphaMultiply-(u_alphaSubtract+0.5); ba=clamp(ba,0.0,1.0)*0.2; fg=blend(vec4(0.0,0.0,0.0,ba),fg); }',
      '  gl_FragColor=blend(bg,fg);',
      '}',
    ].join('\n');

    function compileShader(type: number, src: string) {
      const s = gl!.createShader(type)!; gl!.shaderSource(s, src); gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) console.error('Shader:', gl!.getShaderInfoLog(s));
      return s;
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vertSrc));
    gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error('Link:', gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    const quadVerts = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]);
    const posBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u: Record<string, WebGLUniformLocation | null> = {};
    ['resolution','textureRatio','renderShine','renderShadow','minRefraction','refractionDelta','brightness','alphaMultiply','alphaSubtract','parallaxBg','parallaxFg','parallax','waterMap','textureShine','textureFg','textureBg'].forEach(n => u[n] = gl!.getUniformLocation(prog, 'u_' + n));

    const bgRatio = textureBgCanvas.width / textureBgCanvas.height;

    function initTex(unit: number, source?: HTMLCanvasElement) {
      const t = gl!.createTexture()!; gl!.activeTexture(gl!.TEXTURE0 + unit); gl!.bindTexture(gl!.TEXTURE_2D, t);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
      if (source) gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, source);
      return t;
    }

    const waterTex = initTex(0);
    initTex(1, createCanvas(2, 2));
    initTex(2, textureFgCanvas);
    initTex(3, textureBgCanvas);

    function resize() {
      const w = window.innerWidth, h = window.innerHeight;
      canvas!.width = Math.round(w * dpr); canvas!.height = Math.round(h * dpr);
      canvas!.style.width = w + 'px'; canvas!.style.height = h + 'px';
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
      initRaindrops(canvas!.width, canvas!.height, dpr);
    }

    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    resize();

    const onVis = () => { paused = document.hidden; };
    document.addEventListener('visibilitychange', onVis);

    function render() {
      if (destroyed) return;
      requestAnimationFrame(render);
      if (paused) return;
      rdUpdate();
      gl!.activeTexture(gl!.TEXTURE0); gl!.bindTexture(gl!.TEXTURE_2D, waterTex);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, rdCanvas);
      gl!.useProgram(prog);
      gl!.uniform2f(u.resolution, canvas!.width, canvas!.height);
      gl!.uniform1f(u.textureRatio, bgRatio);
      gl!.uniform1i(u.renderShine, 0); gl!.uniform1i(u.renderShadow, 0);
      gl!.uniform1f(u.minRefraction, 256 * REFRACTION); gl!.uniform1f(u.refractionDelta, 256 * REFRACTION);
      gl!.uniform1f(u.brightness, 1.04); gl!.uniform1f(u.alphaMultiply, 6.0); gl!.uniform1f(u.alphaSubtract, 3.0);
      gl!.uniform1f(u.parallaxBg, 5.0); gl!.uniform1f(u.parallaxFg, 20.0); gl!.uniform2f(u.parallax, 0, 0);
      gl!.uniform1i(u.waterMap, 0); gl!.uniform1i(u.textureShine, 1); gl!.uniform1i(u.textureFg, 2); gl!.uniform1i(u.textureBg, 3);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
    }

    requestAnimationFrame(render);

    return () => {
      destroyed = true;
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0" style={{ zIndex: 0, width: '100vw', height: '100vh', filter: 'saturate(0.7) brightness(0.55)' }} />;
}
