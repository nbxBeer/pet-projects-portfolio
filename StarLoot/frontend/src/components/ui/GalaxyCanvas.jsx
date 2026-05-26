import { useRef, useEffect, memo } from 'react';

/**
 * GalaxyCanvas — animated spiral galaxy.
 *
 * PERFORMANCE: Renders the galaxy ONCE to a static canvas image,
 * then rotates it via CSS animation (GPU-accelerated, zero CPU cost).
 * No requestAnimationFrame loop, no per-frame JS.
 */
const GalaxyCanvas = memo(function GalaxyCanvas({ size = 180, universe = 1 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S   = size * dpr;
    canvas.width  = S;
    canvas.height = S;

    const cx = S / 2;
    const cy = S / 2;

    const isU2 = Number(universe) === 2;

    // ── Generate & draw galaxy (ONE TIME) ──────────────────────────────────
    const NUM_ARMS  = 4;
    const ARM_STARS = 100;
    const TWIRL     = 3.5;

    // Background
    ctx.fillStyle = '#03030c';
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.49, 0, Math.PI * 2);
    ctx.fill();

    // Nebula blobs (soft glow behind stars)
    for (let arm = 0; arm < NUM_ARMS; arm++) {
      const armBase = (arm / NUM_ARMS) * Math.PI * 2;
      for (let i = 0; i < 5; i++) {
        const t = 0.15 + Math.random() * 0.7;
        const radius = t * S * 0.38;
        const a = armBase + t * TWIRL + (Math.random() - 0.5) * 0.4;
        const x = cx + radius * Math.cos(a);
        const y = cy + radius * Math.sin(a);
        const blobR = (8 + Math.random() * 16) * dpr;
        const r = isU2
          ? 20 + Math.round(Math.random() * 30)
          : 40 + Math.round(Math.random() * 40);
        const g = isU2
          ? 80 + Math.round(Math.random() * 60)
          : 20 + Math.round(Math.random() * 30);
        const b = isU2
          ? 20 + Math.round(Math.random() * 30)
          : 100 + Math.round(Math.random() * 80);
        const alpha = 0.04 + Math.random() * 0.07;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, blobR);
        grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, blobR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Arm stars
    for (let arm = 0; arm < NUM_ARMS; arm++) {
      const armBase = (arm / NUM_ARMS) * Math.PI * 2;
      for (let i = 0; i < ARM_STARS; i++) {
        const t      = i / ARM_STARS;
        const radius = 3 * dpr + t * S * 0.44;
        const spread = (0.12 + t * 0.55) * (Math.random() - 0.5);
        const a      = armBase + t * TWIRL + spread;
        const x = cx + radius * Math.cos(a);
        const y = cy + radius * Math.sin(a);

        let r, g, b;
        if (t < 0.2) {
          if (isU2) {
            r = 255;
            g = 60 + Math.round(t * 200);
            b = 60 + Math.round(t * 100);
          } else {
            r = 255 - Math.round(t * 200); g = 240 - Math.round(t * 300); b = 200 + Math.round(t * 150);
          }
        } else if (t < 0.6) {
          if (isU2) {
            r = 60 + Math.round(t * 100);
            g = 200 + Math.round(t * 55);
            b = 60;
          } else {
            r = 120 + Math.round(t * 80); g = 100 + Math.round(t * 100); b = 255 - Math.round(t * 30);
          }
        } else {
          if (isU2) {
            r = 200 + Math.round(t * 55);
            g = 220 + Math.round(t * 35);
            b = 60 + Math.round(t * 40);
          } else {
            r = 160 + Math.round(t * 95); g = 170 + Math.round(t * 85); b = 255;
          }
        }
        const alpha = 0.35 + Math.random() * 0.65;
        const sz = (0.5 + Math.random() * 1.5) * dpr;

        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.fill();
      }
    }

    // Core cluster (dense bright stars)
    for (let i = 0; i < 35; i++) {
      const a = Math.random() * Math.PI * 2;
      const radius = Math.random() * S * 0.09;
      const x = cx + radius * Math.cos(a);
      const y = cy + radius * Math.sin(a);
      const sz = (0.3 + Math.random() * 1.0) * dpr;
      const alpha = 0.5 + Math.random() * 0.5;
      ctx.beginPath();
      ctx.arc(x, y, sz, 0, Math.PI * 2);
      ctx.fillStyle = isU2
        ? `rgba(255,80,80,${alpha})`
        : `rgba(255,240,200,${alpha})`;
      ctx.fill();
    }

    // Scattered background stars
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * Math.PI * 2;
      const radius = 2 * dpr + Math.random() * S * 0.47;
      const x = cx + radius * Math.cos(a);
      const y = cy + radius * Math.sin(a);
      const sz = (0.2 + Math.random() * 0.6) * dpr;
      const alpha = 0.1 + Math.random() * 0.3;
      ctx.beginPath();
      ctx.arc(x, y, sz, 0, Math.PI * 2);
      ctx.fillStyle = isU2
        ? `rgba(100,255,100,${alpha})`
        : `rgba(180,190,255,${alpha})`;
      ctx.fill();
    }

    // Outer vignette
    const vignette = ctx.createRadialGradient(cx, cy, S * 0.3, cx, cy, S * 0.49);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(3,3,12,0.85)');
    ctx.fillStyle = vignette;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.49, 0, Math.PI * 2);
    ctx.fill();

    // Core glow
    const coreHaze = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.2);
    coreHaze.addColorStop(0,   isU2 ? 'rgba(255,100,100,0.3)' : 'rgba(255,245,200,0.3)');
    coreHaze.addColorStop(0.4, isU2 ? 'rgba(100,255,100,0.12)' : 'rgba(180,140,255,0.12)');
    coreHaze.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = coreHaze;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Core bright point
    const corePt = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.06);
    corePt.addColorStop(0,   isU2 ? 'rgba(255,120,100,0.95)' : 'rgba(255,250,230,0.95)');
    corePt.addColorStop(0.5, isU2 ? 'rgba(100,255,120,0.5)' : 'rgba(220,180,255,0.5)');
    corePt.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = corePt;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.06, 0, Math.PI * 2);
    ctx.fill();

    // Lens flare cross
    ctx.strokeStyle = isU2 ? 'rgba(255,100,100,0.25)' : 'rgba(255,245,210,0.25)';
    ctx.lineWidth = 0.6 * dpr;
    ctx.beginPath();
    ctx.moveTo(cx - S * 0.06, cy); ctx.lineTo(cx + S * 0.06, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - S * 0.06); ctx.lineTo(cx, cy + S * 0.06);
    ctx.stroke();
    // No animation loop — CSS handles rotation
  }, [size, universe]);

  return (
    <canvas
      ref={canvasRef}
      className={`galaxy-canvas ${Number(universe) === 2 ? 'galaxy-canvas-u2' : 'galaxy-canvas-u1'}`}
      style={{ width: size, height: size }}
    />
  );
});

export default GalaxyCanvas;
