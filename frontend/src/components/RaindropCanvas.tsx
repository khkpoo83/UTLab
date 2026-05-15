import React, { useEffect, useRef } from 'react'

// Oblique close-view of a water surface.
//
// Dense sample grid (GNX × GNZ) covers the visible water plane.
// Each cell asks the wave field for h(x,z,t) by summing contributions
// from N active ripples (real interference). The sample is then displaced
// vertically on screen by -h * perspective_factor, and rendered as a dot
// whose brightness is driven by h (crest bright, trough dark,
// |h|<threshold skipped → visible "파쇄" gaps where waves cancel).
//
// HORIZON_Y_FRAC = 0.04 → only 4% sky, water fills the canvas.
// Non-linear perspective so near-surface waves are big and detailed.

const THEMES_R = {
  default: { bg: '#0a1530', bgEdge: '#050a1c', particle: [188, 214, 255] as [number,number,number], highlight: [230, 240, 255] as [number,number,number] },
  light:   { bg: '#f4f6fb', bgEdge: '#e8ecf4', particle: [22,  32,  78]  as [number,number,number], highlight: [10,  18,  50]  as [number,number,number] },
}

// ───────────────────────── Geometry ─────────────────────────
const HORIZON_Y_FRAC = 0.04
const FOV_NEAR = 2.30
const FOV_FAR  = 0.20
const PERSP_EXP = 1.65

const GNX = 220
const GNZ = 130

// ───────────────────────── Wave model ───────────────────────
const WAVE_C     = 0.34
const WAVE_LAM   = 0.082
const DECAY_LEN  = 0.20
const WAVE_AMP   = 0.058
const CANCEL_EPS = 0.0042
const DISP_SCALE = 0.27

const TARGET_ACTIVE = 9
const RIPPLE_LIFE   = 7.0
const SPAWN_MIN     = 0.18
const SPAWN_MAX     = 0.55

// ───────────────────────── Helpers ──────────────────────────
function zFromRow(rowFrac: number) {
  return Math.pow(1 - rowFrac, PERSP_EXP)
}
function screenYofRow(rowFrac: number, H_: number, horizonY: number) {
  return horizonY + rowFrac * (H_ - horizonY)
}
function fovWidthFactor(wz: number) {
  return FOV_FAR + (1 - wz) * (FOV_NEAR - FOV_FAR)
}
function screenXofWorldX(wx: number, wz: number, W_: number) {
  return W_ * 0.5 + wx * 0.5 * W_ * fovWidthFactor(wz)
}

function ringContribution(d: number, ringR: number, env: number) {
  if (d > ringR) return 0
  const behind = ringR - d
  if (behind > DECAY_LEN * 4) return 0
  const radialAtten = 1 / Math.sqrt(0.4 + d * 6)
  return env * WAVE_AMP * radialAtten *
    Math.cos((2 * Math.PI * behind) / WAVE_LAM) *
    Math.exp(-behind / DECAY_LEN)
}

// ───────────────────────── Types ────────────────────────────
interface Ripple {
  cx: number; cz: number
  born: number; life: number
}
interface Drop {
  cx: number; cz: number
  born: number; dur: number; spawned: boolean
  _sx?: number; _sy?: number; _phase?: number
}
interface ActiveRipple {
  cx: number; cz: number; R: number; env: number
}

// ───────────────────────── Component ────────────────────────
const RaindropCanvas: React.FC<{ isLight: boolean }> = ({ isLight }) => {
  const ctnRef = useRef<HTMLDivElement>(null)
  const cvRef  = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctn = ctnRef.current, cv = cvRef.current
    if (!ctn || !cv) return
    const ctx = cv.getContext('2d', { alpha: false })!

    const theme = isLight ? THEMES_R.light : THEMES_R.default
    const [PR, PG, PB] = theme.particle
    const [HR, HG, HB] = theme.highlight

    let bgFill: CanvasGradient | string = theme.bg
    function rebuildBg() {
      const g = ctx.createRadialGradient(
        cv!.width * 0.50, cv!.height * 0.62, 0,
        cv!.width * 0.50, cv!.height * 0.55, Math.hypot(cv!.width, cv!.height) * 0.62,
      )
      g.addColorStop(0, theme.bg)
      g.addColorStop(1, theme.bgEdge)
      bgFill = g
    }
    function resize() {
      cv!.width  = ctn!.clientWidth
      cv!.height = ctn!.clientHeight
      rebuildBg()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(ctn)

    // ─── Simulation state ────────────────────────────────────
    const ripples: Ripple[] = []
    const drops: Drop[] = []

    let nextDropAt = 0.05
    let t = 0, prevTs = -1, raf = 0

    // Pre-seed ripples so the first frame already looks alive
    for (let i = 0; i < 8; i++) {
      ripples.push({
        cx: (Math.random() * 2 - 1) * 0.85,
        cz: 0.05 + Math.random() * 0.90,
        born: -(Math.random() * RIPPLE_LIFE * 0.85),
        life: RIPPLE_LIFE * (0.7 + Math.random() * 0.55),
      })
    }

    function envelopeOf(rg: Ripple, time: number) {
      const age = time - rg.born
      if (age < 0) return 0
      const k = age / rg.life
      if (k >= 1) return 0
      const fadeIn  = Math.min(1, age / 0.18)
      const fadeOut = 1 - k * k
      return fadeIn * fadeOut
    }

    function draw(ts: number) {
      if (prevTs < 0) prevTs = ts
      const dt = Math.min(0.05, (ts - prevTs) / 1000)
      prevTs = ts
      t += dt

      const W_ = cv!.width, H_ = cv!.height
      const horizonY = H_ * HORIZON_Y_FRAC

      ctx.fillStyle = bgFill
      ctx.fillRect(0, 0, W_, H_)

      // ── Maintain pool ────────────────────────────────────
      for (let i = ripples.length - 1; i >= 0; i--) {
        if (t - ripples[i].born >= ripples[i].life) ripples.splice(i, 1)
      }
      if (t >= nextDropAt) {
        drops.push({
          cx:      (Math.random() * 2 - 1) * 0.95,
          cz:      0.04 + Math.random() * 0.92,
          born:    t,
          dur:     0.32 + Math.random() * 0.22,
          spawned: false,
        })
        const def = Math.max(0, TARGET_ACTIVE - ripples.length)
        nextDropAt = t + SPAWN_MIN + Math.random() * (SPAWN_MAX - def * 0.04)
      }

      // ── Process drops ────────────────────────────────────
      for (let i = drops.length - 1; i >= 0; i--) {
        const drop  = drops[i]
        const age   = t - drop.born
        const phase = age / drop.dur
        if (phase > 1.25) { drops.splice(i, 1); continue }

        const sx = screenXofWorldX(drop.cx, drop.cz, W_)
        const yFrac = 1 - Math.pow(drop.cz, 1 / PERSP_EXP)
        const sy    = screenYofRow(yFrac, H_, horizonY)

        if (!drop.spawned && phase >= 0.75) {
          drop.spawned = true
          const n = 1 + (Math.random() < 0.6 ? 1 : 0) + (Math.random() < 0.3 ? 1 : 0)
          for (let r = 0; r < n; r++) {
            ripples.push({
              cx: drop.cx, cz: drop.cz,
              born: t + r * 0.13,
              life: RIPPLE_LIFE * (0.7 + Math.random() * 0.55),
            })
          }
        }

        drop._sx = sx; drop._sy = sy; drop._phase = phase
      }

      // ── Wave height field ─────────────────────────────────
      const active: ActiveRipple[] = []
      for (const rg of ripples) {
        const env = envelopeOf(rg, t)
        if (env < 0.02) continue
        active.push({ cx: rg.cx, cz: rg.cz, R: WAVE_C * (t - rg.born), env })
      }

      for (let iz = 1; iz < GNZ; iz++) {
        const rowFrac = iz / (GNZ - 1)
        const wz  = zFromRow(rowFrac)
        const sy0 = screenYofRow(rowFrac, H_, horizonY)
        const foreground = 1 - wz
        const dispPx = DISP_SCALE * H_ * (0.18 + foreground * 0.82)

        for (let ix = 0; ix < GNX; ix++) {
          const wx = (ix / (GNX - 1)) * 2 - 1
          const sx = screenXofWorldX(wx, wz, W_)
          if (sx < -2 || sx > W_ + 2) continue

          let h = 0
          for (let k = 0; k < active.length; k++) {
            const rg = active[k]
            const dx = wx - rg.cx
            const dz = wz - rg.cz
            const d  = Math.sqrt(dx * dx + dz * dz * 1.7)
            h += ringContribution(d, rg.R, rg.env)
          }

          const ah = Math.abs(h)
          if (ah < CANCEL_EPS) continue

          const py = sy0 - h * dispPx * 20
          if (py < horizonY - 4 || py >= H_) continue

          const norm = Math.max(-1.6, Math.min(1.6, h / WAVE_AMP))
          let rawB: number
          if (norm > 0) {
            rawB = 45 + Math.pow(norm, 0.55) * 215
          } else {
            rawB = 6  + (1.6 + norm) * 22
          }
          const kk = Math.min(255, rawB * (0.34 + foreground * 0.78)) / 255

          const cr = Math.min(255, PR * kk) | 0
          const cg = Math.min(255, PG * kk) | 0
          const cb = Math.min(255, PB * kk) | 0

          if (norm > 0.72 && foreground > 0.18) {
            const sz = 1.25 + norm * 0.95
            ctx.fillStyle = `rgba(${cr},${cg},${cb},0.96)`
            ctx.beginPath(); ctx.arc(sx, py, sz, 0, Math.PI * 2); ctx.fill()
            if (norm > 1.15) {
              const hlr = Math.min(255, HR * kk) | 0
              const hlg = Math.min(255, HG * kk) | 0
              const hlb = Math.min(255, HB * kk) | 0
              ctx.fillStyle = `rgba(${hlr},${hlg},${hlb},0.12)`
              ctx.beginPath(); ctx.arc(sx, py, sz * 2.4, 0, Math.PI * 2); ctx.fill()
            }
          } else if (foreground > 0.30 && ah > CANCEL_EPS * 2) {
            ctx.fillStyle = `rgb(${cr},${cg},${cb})`
            ctx.fillRect((sx - 1) | 0, (py - 1) | 0, 2, 2)
          } else {
            ctx.fillStyle = `rgb(${cr},${cg},${cb})`
            ctx.fillRect(sx | 0, py | 0, 1, 1)
          }
        }
      }

      // ── Falling drop streaks + impact splash ──────────────
      for (const drop of drops) {
        const phase = drop._phase
        if (phase == null) continue
        const sx = drop._sx!, sy = drop._sy!
        const wz = drop.cz
        const foreground = 1 - wz

        if (phase < 0.75) {
          const fall  = phase / 0.75
          const fallE = fall * fall * fall
          const dropH = (0.10 + foreground * 0.20) * H_
          const dropY = sy - dropH * (1 - fallE)

          const env = Math.min(1, fall * 5) * (1 - Math.max(0, fall - 0.92) / 0.08)
          const baseB = 210
          const k = baseB * env / 255
          const cr = Math.min(255, PR * k) | 0
          const cg = Math.min(255, PG * k) | 0
          const cb = Math.min(255, PB * k) | 0
          ctx.fillStyle = `rgb(${cr},${cg},${cb})`
          ctx.fillRect((sx - 1) | 0, (dropY - 1) | 0, 2, 2)
          for (let ti = 1; ti <= 4; ti++) {
            const tf = Math.max(0, fall - ti * 0.05)
            const ty  = sy - dropH * (1 - tf * tf * tf)
            const tk  = (baseB * env * (1 - ti / 5) * 0.5) / 255
            const tr  = Math.min(255, PR * tk) | 0
            const tg_ = Math.min(255, PG * tk) | 0
            const tb  = Math.min(255, PB * tk) | 0
            ctx.fillStyle = `rgb(${tr},${tg_},${tb})`
            ctx.fillRect(sx | 0, ty | 0, 1, 1)
          }
          if (fall > 0.65) {
            const close = (fall - 0.65) / 0.10
            ctx.fillStyle = `rgba(${PR},${PG},${PB},${0.10 * close})`
            ctx.beginPath(); ctx.arc(sx, dropY, (1.1 + foreground * 0.9) * 2.4, 0, Math.PI * 2); ctx.fill()
          }
        } else {
          const fp = (phase - 0.75) / 0.50
          if (fp <= 1) {
            const env = 1 - fp
            const nB  = (14 + (foreground * 12)) | 0
            const burst = (0.025 + fp * 0.060) * W_ * (0.5 + foreground * 0.5)
            const aspect = 0.32
            for (let kk = 0; kk < nB; kk++) {
              const ang = (kk / nB) * Math.PI * 2
              const px  = sx + Math.cos(ang) * burst
              const py  = sy + Math.sin(ang) * burst * aspect
              const k = 200 * env * 0.75 / 255
              const cr = Math.min(255, PR * k) | 0
              const cg = Math.min(255, PG * k) | 0
              const cb = Math.min(255, PB * k) | 0
              ctx.fillStyle = `rgb(${cr},${cg},${cb})`
              ctx.fillRect(px | 0, py | 0, 1, 1)
            }
          }
        }
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [isLight])

  return (
    <div ref={ctnRef} style={{ position: 'absolute', inset: 0, background: isLight ? THEMES_R.light.bg : THEMES_R.default.bg }}>
      <canvas ref={cvRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  )
}

export default RaindropCanvas
