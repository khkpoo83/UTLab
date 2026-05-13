import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/client'

/* ══════════════════════════════════════════════════════════
   테마 색상 — 시즌별 파티클/배경 색상 (HTML 파일과 동일)
   ══════════════════════════════════════════════════════════ */
interface Theme {
  bg: string; bgEdge: string
  particle: [number, number, number]
  highlight: [number, number, number]
}
const THEMES: Record<string, Theme> = {
  default: { bg: '#0a1530', bgEdge: '#050a1c', particle: [188, 214, 255], highlight: [230, 240, 255] },
  spring:  { bg: '#2c0a1e', bgEdge: '#180510', particle: [255, 196, 218], highlight: [255, 224, 234] },
  summer:  { bg: '#062a36', bgEdge: '#03151c', particle: [148, 226, 226], highlight: [196, 245, 240] },
  autumn:  { bg: '#2c1408', bgEdge: '#170902', particle: [255, 178, 108], highlight: [255, 214, 168] },
  winter:  { bg: '#101838', bgEdge: '#070b1c', particle: [208, 216, 255], highlight: [232, 238, 255] },
  mono:    { bg: '#000000', bgEdge: '#000000', particle: [232, 232, 232], highlight: [255, 255, 255] },
}

/* ── 상수 ──────────────────────────────────────────────────────────────── */
const W = 1920, H = 1080
const shapeCx = 960, shapeCy = 540   // 텍스트 중심 — 캔버스 정중앙
const PARTICLE_COUNT = 6000

const TL = {
  entryEnd:     0.5,
  morph1End:    2.9,
  hold1End:     4.9,
  recomposeEnd: 7.0,
  hold2End:     9.4,
  scatterEnd:  10.7,
  exitEnd:     11.3,
}
const LOOP = TL.exitEnd

/* ── 타입 ──────────────────────────────────────────────────────────────── */
type Point = { x: number; y: number }
interface Mask { filled: Point[]; outline: Point[] }
interface Particle {
  sx: number; sy: number
  tx1: number; ty1: number; edge1: boolean
  tx2: number; ty2: number; edge2: boolean
  size: number; bright: number; isHighlight: boolean
  delay1: number; dur1: number
  delay2: number; dur2: number
  driftAmp: number; driftFreq: number; driftPhase: number
}

/* ── 결정론적 RNG ──────────────────────────────────────────────────────── */
let _s = 0xC0FFEE
function rand() { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 0xFFFFFFFF }

/* ── 이징 ──────────────────────────────────────────────────────────────── */
function easeInOutCubic(t: number) { return t < 0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2 }
function easeInCubic(t: number)   { return t*t*t }
function smoothstep(t: number)    { t = Math.max(0,Math.min(1,t)); return t*t*(3-2*t) }

/* ── 텍스트 → 픽셀 마스크 ─────────────────────────────────────────────── */
function rasterize(drawFn: (ctx: CanvasRenderingContext2D) => void): Mask {
  const off = document.createElement('canvas')
  off.width = W; off.height = H
  const oc = off.getContext('2d', { willReadFrequently: true })!
  oc.fillStyle = '#000'; oc.fillRect(0, 0, W, H)
  oc.fillStyle = '#fff'
  drawFn(oc)
  const data = oc.getImageData(0, 0, W, H).data
  const step = 2
  const filled: Point[] = [], outline: Point[] = []
  for (let y = 0; y < H; y += step)
    for (let x = 0; x < W; x += step)
      if (data[(y * W + x) * 4] > 128) filled.push({ x, y })
  const lit = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < W && y < H && data[(y*W+x)*4] > 128
  for (const p of filled)
    if (!lit(p.x-step,p.y)||!lit(p.x+step,p.y)||!lit(p.x,p.y-step)||!lit(p.x,p.y+step))
      outline.push(p)
  return { filled, outline }
}

function sampleTargets(mask: Mask, count: number, fillRatio: number) {
  const out: { x: number; y: number; edge: boolean }[] = []
  const nFill = Math.floor(count * fillRatio)
  for (let i = 0; i < nFill; i++) {
    const p = mask.filled[Math.floor(rand() * mask.filled.length)]
    out.push({ x: p.x+(rand()-0.5)*2.2, y: p.y+(rand()-0.5)*2.2, edge: false })
  }
  for (let i = nFill; i < count; i++) {
    const p = mask.outline[Math.floor(rand() * mask.outline.length)]
    out.push({ x: p.x+(rand()-0.5)*2.0, y: p.y+(rand()-0.5)*2.0, edge: true })
  }
  return out
}

function buildParticles(): Particle[] {
  _s = 0xC0FFEE   // RNG 리셋 (결정론적 결과 보장)

  const fontStack = '"SF Pro Display","Pretendard Variable","Helvetica Neue",system-ui,sans-serif'

  const utMask = rasterize((oc) => {
    oc.textAlign = 'center'; oc.textBaseline = 'middle'
    oc.font = `900 600px ${fontStack}`
    for (const g of [{ ch: 'U', dx: -230 }, { ch: '.', dx: 0 }, { ch: 'T', dx: 200 }])
      oc.fillText(g.ch, shapeCx + g.dx, shapeCy)
  })

  const labMask = rasterize((oc) => {
    oc.textBaseline = 'middle'; oc.textAlign = 'left'
    oc.font = `500 200px ${fontStack}`
    const chars = 'LABORATORY'
    const ws: number[] = []
    let sumW = 0
    for (const ch of chars) { const w = oc.measureText(ch).width; ws.push(w); sumW += w }
    const gap = (1080 - sumW) / (chars.length - 1)
    let cursor = shapeCx - 540
    for (let i = 0; i < chars.length; i++) {
      oc.fillText(chars[i], cursor, shapeCy); cursor += ws[i] + gap
    }
  })

  const utT  = sampleTargets(utMask,  PARTICLE_COUNT, 0.74)
  const labT = sampleTargets(labMask, PARTICLE_COUNT, 0.70)

  return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    const a = utT[i], b = labT[i]
    const mx = (a.x+b.x)*0.5, my = (a.y+b.y)*0.5
    const ang = Math.atan2(my-shapeCy, mx-shapeCx) + (rand()-0.5)*2.0
    const dist = 380 + rand()*720
    const r = rand()
    return {
      sx: shapeCx + Math.cos(ang)*dist + (rand()-0.5)*220,
      sy: shapeCy + Math.sin(ang)*dist + (rand()-0.5)*220,
      tx1: a.x, ty1: a.y, edge1: a.edge,
      tx2: b.x, ty2: b.y, edge2: b.edge,
      size: r < 0.80 ? 0.9+rand()*0.7 : r < 0.97 ? 1.5+rand()*0.9 : 2.2+rand()*1.0,
      bright: rand() < 0.06 ? 232+Math.floor(rand()*22) : 120+Math.floor(rand()*110),
      isHighlight: rand() < 0.06,
      delay1: rand()*0.65, dur1: 1.5+rand()*1.1,
      delay2: rand()*0.65, dur2: 1.5+rand()*1.1,
      driftAmp: 0.35+rand()*0.7, driftFreq: 0.25+rand()*0.55,
      driftPhase: rand()*Math.PI*2,
    }
  })
}

/* ══════════════════════════════════════════════════════════
   파티클 캔버스 컴포넌트
   ══════════════════════════════════════════════════════════ */
const ParticleCanvas: React.FC<{ bgColor: string }> = ({ bgColor }) => {
  const wrapRef  = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const wrap = wrapRef.current, frameEl = frameRef.current, canvas = canvasRef.current
    if (!wrap || !frameEl || !canvas) return

    const theme = THEMES.default

    const ctx = canvas.getContext('2d', { alpha: false })!
    ctx.imageSmoothingEnabled = false

    /* cover 스케일 — 레터박스 없이 컨테이너 전체 채움 */
    function fitFrame() {
      if (!wrap || !frameEl) return
      const cw = wrap.clientWidth, ch = wrap.clientHeight
      const s = Math.max(cw / W, ch / H)   // min→max: cover 방식
      frameEl.style.transform = `scale(${s})`
      frameEl.style.left = `${(cw - W*s) / 2}px`
      frameEl.style.top  = `${(ch - H*s) / 2}px`
    }
    fitFrame()
    const ro = new ResizeObserver(fitFrame)
    ro.observe(wrap)

    /* 배경 그라디언트 */
    let bgFill: string | CanvasGradient = theme.bg
    if (theme.bgEdge !== theme.bg) {
      const g = ctx.createRadialGradient(W*0.42, H*0.5, 0, W*0.42, H*0.5, Math.hypot(W,H)*0.55)
      g.addColorStop(0, theme.bg); g.addColorStop(1, theme.bgEdge)
      bgFill = g
    }

    const [PR, PG, PB] = theme.particle
    const [HR, HG, HB] = theme.highlight

    let particles: Particle[] = []
    let timeSec = 0, lastT = performance.now(), rafId = 0

    function computeMorphs(t: number, p: Particle) {
      let m1 = 0, m2 = 0
      if (t < TL.entryEnd) {
        /* entry — both 0 */
      } else if (t < TL.morph1End) {
        const local = (t - TL.entryEnd - p.delay1) / p.dur1
        m1 = local <= 0 ? 0 : local >= 1 ? 1 : easeInOutCubic(local)
      } else if (t < TL.hold1End) {
        m1 = 1
      } else if (t < TL.recomposeEnd) {
        const stagger = p.delay2 * 0.55
        const local = (t - TL.hold1End - stagger) / (TL.recomposeEnd - TL.hold1End - stagger - 0.15)
        const u = local <= 0 ? 0 : local >= 1 ? 1 : easeInOutCubic(local)
        m1 = 1 - u; m2 = u
      } else if (t < TL.hold2End) {
        m2 = 1
      } else if (t < TL.scatterEnd) {
        const local = (t - TL.hold2End - (0.55 - p.delay2)*0.6) / 1.1
        m2 = local <= 0 ? 1 : local >= 1 ? 0 : 1 - easeInCubic(local)
      }
      return { m1, m2 }
    }

    function draw() {
      const now = performance.now()
      const dt = Math.min(0.05, (now - lastT) / 1000)
      lastT = now
      timeSec = (timeSec + dt) % LOOP

      ctx.fillStyle = bgFill
      ctx.fillRect(0, 0, W, H)

      const t = timeSec
      let envelope: number
      if (t < TL.entryEnd)        envelope = smoothstep(t / TL.entryEnd)
      else if (t < TL.scatterEnd) envelope = 1
      else if (t < TL.exitEnd)    envelope = smoothstep(1 - (t-TL.scatterEnd)/(TL.exitEnd-TL.scatterEnd))
      else                        envelope = 0

      if (envelope < 0.004) { rafId = requestAnimationFrame(draw); return }

      const hold1T = (t >= TL.morph1End && t < TL.hold1End)
        ? (t-TL.morph1End)/(TL.hold1End-TL.morph1End) : 0
      const hold2T = (t >= TL.recomposeEnd && t < TL.hold2End)
        ? (t-TL.recomposeEnd)/(TL.hold2End-TL.recomposeEnd) : 0
      const breath1 = 1 + Math.sin(hold1T*Math.PI*2*0.55)*0.0035
      const breath2 = 1 + Math.sin(hold2T*Math.PI*2*0.55)*0.0035

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        const { m1, m2 } = computeMorphs(t, p)
        const formed = Math.min(1, m1+m2)
        const drift  = (1-formed)*(1-formed)

        const ph = p.driftPhase + t*p.driftFreq*2.0
        const driftX = Math.cos(ph)*p.driftAmp*22*drift
        const driftY = Math.sin(ph*1.13)*p.driftAmp*16*drift
        const jAmp = drift*0.65 + 0.10
        const jx = (Math.sin(i*12.9898+t*7.3)*43758.5453 % 1)*jAmp
        const jy = (Math.cos(i*78.233 +t*5.7)*12345.6789 % 1)*jAmp

        let t1x = p.tx1, t1y = p.ty1, t2x = p.tx2, t2y = p.ty2
        if (hold1T > 0) {
          t1x = shapeCx + (p.tx1-shapeCx)*breath1
          t1y = shapeCy + (p.ty1-shapeCy)*breath1
          if (p.edge1) { t1x += Math.sin(hold1T*Math.PI*2*1.3+i*0.07)*0.5; t1y += Math.cos(hold1T*Math.PI*2*1.1+i*0.05)*0.4 }
        }
        if (hold2T > 0) {
          t2x = shapeCx + (p.tx2-shapeCx)*breath2
          t2y = shapeCy + (p.ty2-shapeCy)*breath2
          if (p.edge2) { t2x += Math.sin(hold2T*Math.PI*2*1.3+i*0.07)*0.5; t2y += Math.cos(hold2T*Math.PI*2*1.1+i*0.05)*0.4 }
        }

        const x = p.sx + m1*(t1x-p.sx) + m2*(t2x-p.sx) + driftX + jx
        const y = p.sy + m1*(t1y-p.sy) + m2*(t2y-p.sy) + driftY + jy

        const edgeNow = m1 > 0.5 ? p.edge1 : m2 > 0.5 ? p.edge2 : false
        const b = Math.min(255, Math.max(38, p.bright + formed*(edgeNow?28:10) - (1-formed)*25)) * envelope
        const k = b / 255
        const cr = Math.min(255, PR*k)|0, cg = Math.min(255, PG*k)|0, cb = Math.min(255, PB*k)|0
        const size = p.size * (1 + formed*0.18)

        if (size < 1.6) {
          ctx.fillStyle = `rgb(${cr},${cg},${cb})`
          ctx.fillRect(x|0, y|0, 1, 1)
        } else if (size < 2.4) {
          ctx.fillStyle = `rgb(${cr},${cg},${cb})`
          ctx.fillRect((x-1)|0, (y-1)|0, 2, 2)
        } else {
          ctx.fillStyle = `rgba(${cr},${cg},${cb},0.96)`
          ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI*2); ctx.fill()
          if (p.isHighlight && formed > 0.3) {
            const hr=(HR*k)|0, hg=(HG*k)|0, hb=(HB*k)|0
            ctx.fillStyle = `rgba(${hr},${hg},${hb},0.10)`
            ctx.beginPath(); ctx.arc(x, y, size*2.4, 0, Math.PI*2); ctx.fill()
          }
        }
      }

      rafId = requestAnimationFrame(draw)
    }

    // 폰트 로드 완료 후 파티클 생성 & 루프 시작
    document.fonts.ready.then(() => {
      particles = buildParticles()
      lastT = performance.now()
      rafId = requestAnimationFrame(draw)
    })

    return () => { cancelAnimationFrame(rafId); ro.disconnect() }
  }, [])

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: bgColor }}>
      <div
        ref={frameRef}
        style={{ position: 'absolute', width: `${W}px`, height: `${H}px`, transformOrigin: 'top left' }}
      >
        <canvas ref={canvasRef} width={W} height={H} style={{ display: 'block' }} />
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   입력 필드
   ══════════════════════════════════════════════════════════ */
interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const InputField: React.FC<InputFieldProps> = (props) => {
  const [focused, setFocused] = React.useState(false)
  const base: React.CSSProperties  = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(80,90,160,0.18)', color: 'rgba(210,218,255,0.88)' }
  const focus: React.CSSProperties = { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(90,160,255,0.48)', color: 'rgba(210,218,255,0.88)' }
  return (
    <input
      {...props}
      className="w-full rounded-lg outline-none transition-all"
      style={{ ...( focused ? focus : base), padding: '6px 10px', fontSize: '12px' }}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e) }}
      onBlur={(e)  => { setFocused(false); props.onBlur?.(e) }}
    />
  )
}

/* ══════════════════════════════════════════════════════════
   로그인 페이지
   ══════════════════════════════════════════════════════════ */
const Login: React.FC = () => {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const theme = THEMES.default

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { data } = await authApi.login(username, password)
      localStorage.setItem('token', data.access_token)
      navigate('/portfolio', { replace: true })
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string }; status?: number } }
      if (ax.response?.status === 429)
        setError(ax.response.data?.detail ?? '계정이 잠겼습니다. 잠시 후 다시 시도하세요.')
      else if (ax.response?.status === 401)
        setError('아이디 또는 비밀번호가 올바르지 않습니다.')
      else
        setError('로그인 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex" style={{ background: theme.bgEdge }}>

      {/* ── 좌측: 파티클 애니메이션 ──────────────────────────────────── */}
      <div className="hidden md:block relative" style={{ flex: '1 1 0', minWidth: 0, background: theme.bgEdge }}>
        <ParticleCanvas bgColor={theme.bgEdge} />

        {/* 우측 페이드 */}
        <div
          className="absolute inset-y-0 right-0 w-32 pointer-events-none"
          style={{ background: `linear-gradient(to right, transparent, ${theme.bgEdge})` }}
        />

        {/* 하단 브랜딩 */}
        <p
          className="absolute bottom-6 left-7 text-xs font-mono pointer-events-none select-none"
          style={{ color: `rgba(${theme.particle.join(',')}, 0.22)`, fontSize: '11px' }}
        >
          UT.Lab
        </p>
      </div>

      {/* ── 우측: 로그인 폼 ───────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 w-full flex flex-col items-center justify-center px-7 py-10"
        style={{
          maxWidth: '300px',
          background: theme.bgEdge,
          borderLeft: `1px solid rgba(${theme.particle.join(',')}, 0.08)`,
        }}
      >
        {/* 앱 타이틀 */}
        <div className="w-full mb-7">
          <h1
            className="font-bold tracking-tight"
            style={{ fontSize: '18px', color: `rgba(${theme.highlight.join(',')}, 0.90)`, letterSpacing: '-0.025em' }}
          >
            UT<span style={{ color: `rgba(${theme.particle.join(',')}, 0.9)` }}>.</span>Lab
          </h1>
        </div>

        {/* 입력 폼 */}
        <form onSubmit={handleSubmit} className="w-full space-y-3">
          <div className="space-y-2.5">
            <div>
              <label
                className="block font-medium mb-1"
                style={{ fontSize: '11px', color: `rgba(${theme.particle.join(',')}, 0.55)` }}
              >
                아이디
              </label>
              <InputField type="text" autoComplete="username" value={username}
                onChange={(e) => setUsername(e.target.value)} placeholder="admin" required />
            </div>
            <div>
              <label
                className="block font-medium mb-1"
                style={{ fontSize: '11px', color: `rgba(${theme.particle.join(',')}, 0.55)` }}
              >
                비밀번호
              </label>
              <InputField type="password" autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
          </div>

          {error && (
            <div className="px-2.5 py-1.5 rounded-lg" style={{
              fontSize: '11px',
              background: 'rgba(220,38,38,0.12)',
              border: '1px solid rgba(220,38,38,0.22)',
              color: 'rgba(252,165,165,0.88)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full font-medium rounded-lg transition-opacity disabled:opacity-50"
            style={{
              padding: '7px 0',
              fontSize: '12px',
              marginTop: '4px',
              background: `rgba(${theme.particle.join(',')}, 0.18)`,
              border: `1px solid rgba(${theme.particle.join(',')}, 0.30)`,
              color: `rgba(${theme.highlight.join(',')}, 0.92)`,
            }}
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login
