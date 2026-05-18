import React, { useEffect, useRef } from 'react'
import { THEMES } from './ParticleCanvas'

// Oblique near-ground water ripple — wave height field approach.
//
// Each cell in an 84×48 grid on the water surface gets a height value:
//   h = superposition of all active ring contributions (waveH)
//
// waveH(d, env): d = distance BEHIND the ring wavefront (px).
//   d=0 → crest (+env); d=WAVE_PX/2 → trough (−env·decay); negative → no wave.
//
// Natural interference: where crest + trough ≈ 0, |h| < THRESHOLD → cell skipped
//   → visible dark gaps = "파쇄" (destructive cancellation).
//
// 3D height: py = gsy − h * wz * H * H3D_SCALE
//   Near-viewer (large wz) → large vertical swing; horizon → barely moves.

const HORIZON    = 0.13   // horizon: 13% from top  (very close = oblique view)
const ASPECT     = 0.13   // ry / rx  (very flat ellipses)
const GNX        = 84     // grid columns  (world x: 0 → 1)
const GNZ        = 48     // grid rows     (world depth: 0.05 → 0.92)
const WAVE_PX    = 46     // wavelength in screen pixels
const DECAY_PX   = 62     // amplitude e-fold decay distance (px)
const THRESHOLD  = 0.07   // skip cells with |h| < this → dark cancellation gaps
const H3D_SCALE  = 0.092  // 3-D height scale (fraction of H per unit h)

const N_RINGS    = 3
const RING_DELAY = 0.22
const RING_LIFE  = 5.5

// ── Helpers ────────────────────────────────────────────────────────────────────
function screenY(wz: number, H: number) {
  return H * HORIZON + wz * H * (1 - HORIZON)
}
function screenX(wx: number, wz: number, W: number) {
  return W / 2 + (wx - 0.5) * W * wz * 1.92
}
function project(cx: number, depth: number, W: number, H: number) {
  return { sx: screenX(cx, depth, W), sy: screenY(depth, H) }
}

// Wave height: d = px behind the ring's expanding wavefront.
// Ring has passed through points with d > 0; outside the ring d < 0 → no wave.
function waveH(d: number, env: number): number {
  if (d < 0 || d > DECAY_PX * 3.2) return 0
  return env * Math.cos(2 * Math.PI * d / WAVE_PX) * Math.exp(-d / DECAY_PX)
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface Ring {
  cx: number; depth: number
  born: number; life: number; maxR: number
  worldR: number; progress: number
  sx: number; sy: number; rx: number; ry: number; envelope: number
}
interface Drop {
  cx: number; depth: number
  born: number; dur: number; spawned: boolean
}

// ── Component ──────────────────────────────────────────────────────────────────
const RaindropCanvas: React.FC<{ isLight: boolean }> = ({ isLight }) => {
  const ctnRef = useRef<HTMLDivElement>(null)
  const cvRef  = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctn = ctnRef.current, cv = cvRef.current
    if (!ctn || !cv) return
    const ctx = cv.getContext('2d', { alpha: false })!

    const theme = isLight ? THEMES.light : THEMES.default
    const [PR, PG, PB] = theme.particle
    const [HR, HG, HB] = theme.highlight

    let bgFill: CanvasGradient | null = null
    const rebuildBg = () => {
      const g = ctx.createRadialGradient(
        cv.width * 0.50, cv.height * 0.50, 0,
        cv.width * 0.50, cv.height * 0.50, Math.hypot(cv.width, cv.height) * 0.60,
      )
      g.addColorStop(0, theme.bg); g.addColorStop(1, theme.bgEdge)
      bgFill = g
    }
    const resize = () => { cv.width = ctn.clientWidth; cv.height = ctn.clientHeight; rebuildBg() }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(ctn)

    // Dot renderer — mirrors ParticleCanvas exactly
    function drawDot(px: number, py: number, size: number, bright: number, env: number, isHigh: boolean) {
      const b  = Math.min(255, Math.max(12, bright)) * Math.max(0, env)
      const kk = b / 255
      const cr = Math.min(255, PR * kk) | 0
      const cg = Math.min(255, PG * kk) | 0
      const cb = Math.min(255, PB * kk) | 0
      if (size < 1.6) {
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`
        ctx.fillRect(px | 0, py | 0, 1, 1)
      } else if (size < 2.4) {
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`
        ctx.fillRect((px - 1) | 0, (py - 1) | 0, 2, 2)
      } else {
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.96)`
        ctx.beginPath(); ctx.arc(px, py, size, 0, Math.PI * 2); ctx.fill()
        if (isHigh) {
          const hlr = Math.min(255, HR * kk) | 0
          const hlg = Math.min(255, HG * kk) | 0
          const hlb = Math.min(255, HB * kk) | 0
          ctx.fillStyle = `rgba(${hlr},${hlg},${hlb},0.10)`
          ctx.beginPath(); ctx.arc(px, py, size * 2.4, 0, Math.PI * 2); ctx.fill()
        }
      }
    }

    // Simulation state
    const drops: Drop[] = []
    const rings: Ring[] = []
    let nextDropAt = 0.06
    let raf = 0, t = 0, prevTs = -1

    // Pre-seed rings so the surface is alive on frame 1
    for (let i = 0; i < 5; i++) {
      const cx    = 0.08 + Math.random() * 0.84
      const depth = 0.22 + Math.random() * 0.68
      const maxR  = 0.28 + depth * 0.36 + Math.random() * 0.18
      rings.push({
        cx, depth, born: -(0.4 + Math.random() * 3.5), life: RING_LIFE,
        maxR, worldR: 0, progress: 0, sx: 0, sy: 0, rx: 0, ry: 0, envelope: 0,
      })
    }

    function draw(ts: number) {
      if (!cv) return
      if (prevTs < 0) prevTs = ts
      const dt = Math.min(0.05, (ts - prevTs) / 1000)
      prevTs = ts
      t += dt

      const W = cv.width, H = cv.height

      ctx.fillStyle = bgFill ?? theme.bg
      ctx.fillRect(0, 0, W, H)

      // ── Spawn raindrop ─────────────────────────────────────────────────────
      if (t >= nextDropAt) {
        drops.push({
          cx:      0.05 + Math.random() * 0.90,
          depth:   0.18 + Math.random() * 0.78,
          born:    t,
          dur:     0.36 + Math.random() * 0.24,
          spawned: false,
        })
        nextDropAt = t + 0.14 + Math.random() * 0.36
      }

      // ── Update ring cache ──────────────────────────────────────────────────
      for (let i = rings.length - 1; i >= 0; i--) {
        const rg  = rings[i]
        const age = t - rg.born
        if (age >= rg.life) { rings.splice(i, 1); continue }
        if (age < 0) { rg.envelope = 0; continue }

        rg.progress = age / rg.life
        rg.worldR   = rg.maxR * Math.sqrt(rg.progress)
        rg.sx = screenX(rg.cx, rg.depth, W)
        rg.sy = screenY(rg.depth, H)
        rg.rx = rg.worldR * rg.depth * W * 0.50
        rg.ry = rg.rx * ASPECT

        const fadeIn  = Math.min(1, age / 0.15)
        const fadeOut = 1 - rg.progress * rg.progress
        rg.envelope   = fadeIn * fadeOut * Math.pow(rg.depth, 0.45)
      }

      // ── Wave height field ──────────────────────────────────────────────────
      const activeRings = rings.filter(r => r.envelope > 0.02 && r.rx >= 1)

      if (activeRings.length > 0) {
        for (let gz = 0; gz < GNZ; gz++) {
          const wz  = 0.05 + (gz / (GNZ - 1)) * 0.87
          const gsy = screenY(wz, H)

          for (let gx = 0; gx < GNX; gx++) {
            const wx  = gx / (GNX - 1)
            const gsx = screenX(wx, wz, W)
            if (gsx < -2 || gsx > W + 2) continue

            // Superpose ring wave contributions (natural interference)
            let h = 0
            for (const rg of activeRings) {
              const ddx = (gsx - rg.sx) / rg.rx
              const ddy = (gsy - rg.sy) / rg.ry
              const nd  = Math.sqrt(ddx * ddx + ddy * ddy)
              // d > 0: inside ring (wavefront has passed) — wave exists
              // d < 0: outside ring — waveH returns 0
              h += waveH((1.0 - nd) * rg.rx, rg.envelope)
            }

            // Destructive zone: |h| below threshold → skip → dark gap ("파쇄")
            if (Math.abs(h) < THRESHOLD) continue

            // 3-D: displace screen-y by wave height (perspective-scaled by depth)
            const py = gsy - h * wz * H * H3D_SCALE
            if (py < 0 || py >= H) continue

            // Crest bright, trough dim; near-viewer brighter (perspective shading)
            const hc = Math.max(-1.4, Math.min(1.4, h))
            const rawBright = hc > 0
              ? 55  + hc * 185        // crest: 55 → ~314 (→255)
              : 8   + (1 + hc) * 48   // trough: 8 → 56
            const kk = Math.min(255, rawBright * (0.22 + wz * 0.78)) / 255

            const cr = Math.min(255, PR * kk) | 0
            const cg = Math.min(255, PG * kk) | 0
            const cb = Math.min(255, PB * kk) | 0

            if (hc > 0.60 && wz > 0.30) {
              // Bright crest → arc particle (same as ParticleCanvas highlights)
              const sz = 1.4 + hc * 0.95
              ctx.fillStyle = `rgba(${cr},${cg},${cb},0.95)`
              ctx.beginPath(); ctx.arc(gsx, py, sz, 0, Math.PI * 2); ctx.fill()
              if (hc > 1.05) {
                const hlr = Math.min(255, HR * kk) | 0
                const hlg = Math.min(255, HG * kk) | 0
                const hlb = Math.min(255, HB * kk) | 0
                ctx.fillStyle = `rgba(${hlr},${hlg},${hlb},0.10)`
                ctx.beginPath(); ctx.arc(gsx, py, sz * 2.4, 0, Math.PI * 2); ctx.fill()
              }
            } else if (wz > 0.48) {
              ctx.fillStyle = `rgb(${cr},${cg},${cb})`
              ctx.fillRect((gsx - 1) | 0, (py - 1) | 0, 2, 2)
            } else {
              ctx.fillStyle = `rgb(${cr},${cg},${cb})`
              ctx.fillRect(gsx | 0, py | 0, 1, 1)
            }
          }
        }
      }

      // ── Falling drops + impact ─────────────────────────────────────────────
      for (let i = drops.length - 1; i >= 0; i--) {
        const drop  = drops[i]
        const age   = t - drop.born
        const phase = age / drop.dur

        if (phase > 1.22) { drops.splice(i, 1); continue }

        const { sx, sy } = project(drop.cx, drop.depth, W, H)

        // Spawn rings when drop hits the surface (~75% of fall)
        if (!drop.spawned && phase >= 0.75) {
          drop.spawned = true
          for (let ri = 0; ri < N_RINGS; ri++) {
            const maxR = 0.26 + drop.depth * 0.38 + Math.random() * 0.14
            rings.push({
              cx: drop.cx, depth: drop.depth,
              born: t + ri * RING_DELAY,
              life: RING_LIFE * (0.65 + ri * 0.28),
              maxR,
              worldR: 0, progress: 0, sx: 0, sy: 0, rx: 0, ry: 0, envelope: 0,
            })
          }
        }

        // Falling particle (cubic ease-in = gravity feel)
        if (phase < 0.75) {
          const fall  = phase / 0.75
          const fallE = fall * fall * fall
          const dropH = drop.depth * H * 0.18
          const dropY = sy - dropH * (1 - fallE)
          const env   = Math.min(1, fall * 5) * (1 - Math.max(0, fall - 0.85) / 0.15)
          drawDot(sx, dropY, drop.depth > 0.5 ? 1.6 : 1.0, 210, env, false)
          for (let ti = 1; ti <= 3; ti++) {
            const tf = Math.max(0, fall - ti * 0.055)
            drawDot(sx, sy - dropH * (1 - tf * tf * tf), 0.9, 155, env * (1 - ti / 4) * 0.34, false)
          }
        }

        // Impact burst
        if (phase >= 0.75) {
          const fp  = (phase - 0.75) / 0.47
          const env = 1 - fp
          const nB  = 12 + (drop.depth * 12 | 0)
          const br  = drop.depth * W * 0.040 * (0.32 + fp * 1.1)
          for (let k = 0; k < nB; k++) {
            const ang = (k / nB) * Math.PI * 2
            drawDot(
              sx + Math.cos(ang) * br,
              sy + Math.sin(ang) * br * ASPECT,
              0.9 + (k % 3) * 0.36, 180, env * 0.72, false,
            )
          }
        }
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [isLight])

  return (
    <div ref={ctnRef} style={{ position: 'absolute', inset: 0, background: isLight ? THEMES.light.bg : THEMES.default.bg }}>
      <canvas ref={cvRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  )
}

export default RaindropCanvas
