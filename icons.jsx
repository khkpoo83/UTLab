// All UT.Lab icon marks. Each component renders a square icon of `size` px.
// Designed for both large display (~240px) and small (32–48px) reuse.

function IconIndigo({ size = 240 }) {
  const r = size * 0.225;
  return (
    <div style={{
      width: size, height: size,
      background: 'linear-gradient(135deg, #6473ff 0%, #3331c4 100%)',
      borderRadius: r,
      display: 'grid', placeItems: 'center',
      boxShadow: '0 8px 28px rgba(50,40,180,0.35), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(0,0,0,0.18)',
      position: 'relative', overflow: 'hidden',
      fontFamily: '"SF Pro Display","Pretendard Variable","Helvetica Neue",system-ui,sans-serif',
    }}>
      <span style={{
        fontWeight: 800, fontSize: size * 0.52, color: '#fff',
        letterSpacing: '-0.07em', lineHeight: 1,
        textShadow: '0 1px 0 rgba(0,0,0,0.12)'
      }}>UT</span>
    </div>
  );
}

function IconCoralPeriod({ size = 240 }) {
  const r = size * 0.225;
  const dot = size * 0.10;
  return (
    <div style={{
      width: size, height: size, background: '#0e1117', borderRadius: r,
      display: 'grid', placeItems: 'center',
      border: `${Math.max(1, size * 0.005)}px solid #1f242e`,
      position: 'relative',
      fontFamily: '"SF Pro Display","Pretendard Variable",sans-serif',
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: size * 0.035,
        fontWeight: 800, fontSize: size * 0.5, color: '#f4f4f6',
        letterSpacing: '-0.06em', lineHeight: 1,
      }}>
        <span>U</span>
        <span style={{
          width: dot, height: dot, borderRadius: '50%',
          background: '#F97316', flex: 'none',
          boxShadow: '0 0 0 ' + (size * 0.012) + 'px rgba(249,115,22,0.18)',
        }} />
        <span>T</span>
      </div>
    </div>
  );
}

function IconCradle({ size = 240 }) {
  const r = size * 0.225;
  return (
    <div style={{
      width: size, height: size,
      background: 'linear-gradient(160deg, #0e4639 0%, #082a23 100%)',
      borderRadius: r, position: 'relative', overflow: 'hidden',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)'
    }}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        {/* U: open cradle */}
        <path d="M24 26 L24 60 A26 26 0 0 0 76 60 L76 26"
              stroke="#34d399" strokeWidth="9" fill="none"
              strokeLinecap="round" strokeLinejoin="round" />
        {/* T: cradled inside U */}
        <path d="M37 44 L63 44" stroke="#ffffff" strokeWidth="8" strokeLinecap="round" />
        <path d="M50 44 L50 72" stroke="#ffffff" strokeWidth="8" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function IconBrutalist({ size = 240 }) {
  const r = size * 0.225;
  return (
    <div style={{
      width: size, height: size, background: '#f4f1ea',
      borderRadius: r, overflow: 'hidden', position: 'relative',
      fontFamily: '"SF Pro Display","Pretendard Variable",sans-serif',
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.05)',
    }}>
      <div style={{
        position: 'absolute', left: size * 0.08, top: size * 0.08, right: size * 0.08, bottom: size * 0.08,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}>
        <div style={{
          fontWeight: 900, fontSize: size * 0.34, color: '#0b0a09',
          letterSpacing: '-0.075em', lineHeight: 0.84,
          transform: 'scaleX(0.92)', transformOrigin: 'left top',
        }}>
          UT.<br/>LAB
        </div>
        <div style={{ display: 'flex', gap: size * 0.018, alignItems: 'flex-end' }}>
          <div style={{ width: size * 0.04, height: size * 0.18, background: '#0b0a09' }} />
          <div style={{ width: size * 0.04, height: size * 0.10, background: '#0b0a09' }} />
          <div style={{ width: size * 0.04, height: size * 0.22, background: '#F97316' }} />
        </div>
      </div>
    </div>
  );
}

function IconFlask({ size = 240 }) {
  const r = size * 0.225;
  return (
    <div style={{
      width: size, height: size, background: '#08111f',
      borderRadius: r, display: 'grid', placeItems: 'center', position: 'relative',
      overflow: 'hidden', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
    }}>
      {/* faint dot grid bg */}
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.18 }}>
        <defs>
          <pattern id="dots-flask" width="6" height="6" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="3" r="0.5" fill="#7cd8e0" />
          </pattern>
        </defs>
        <rect width="100" height="100" fill="url(#dots-flask)" />
      </svg>
      <svg viewBox="0 0 100 100" width={size * 0.62} height={size * 0.62}>
        {/* erlenmeyer flask */}
        <path d="M40 18 L40 38 L22 76 A8 8 0 0 0 30 86 L70 86 A8 8 0 0 0 78 76 L60 38 L60 18 Z"
              fill="none" stroke="#7cd8e0" strokeWidth="3.5"
              strokeLinejoin="round" strokeLinecap="round" />
        {/* neck collar */}
        <line x1="36" y1="22" x2="64" y2="22" stroke="#7cd8e0" strokeWidth="3.5" strokeLinecap="round" />
        {/* liquid line (curved) */}
        <path d="M30 70 Q50 65 70 70" fill="none" stroke="#a9e7ec" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        {/* small UT bubble */}
        <circle cx="50" cy="74" r="3" fill="#7cd8e0" />
      </svg>
    </div>
  );
}

function IconFolio({ size = 240 }) {
  const r = size * 0.225;
  const fold = size * 0.16;
  return (
    <div style={{
      width: size, height: size, background: '#f1ece1',
      borderRadius: r, position: 'relative', overflow: 'hidden',
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.05)',
      fontFamily: '"SF Pro Display","Pretendard Variable",sans-serif',
    }}>
      {/* corner fold triangle */}
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <path d={`M100 0 L100 ${20} L80 0 Z`} fill="rgba(0,0,0,0.08)" />
        <path d={`M82 2 L98 18 L80 18 Z`} fill="#e6ddc9" />
        {/* page rule lines */}
        <line x1="18" y1="62" x2="62" y2="62" stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
        <line x1="18" y1="72" x2="74" y2="72" stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
        <line x1="18" y1="82" x2="54" y2="82" stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
      </svg>
      <div style={{
        position: 'absolute', left: size * 0.13, top: size * 0.18,
        fontWeight: 700, fontSize: size * 0.28, color: '#231c12',
        letterSpacing: '-0.05em', lineHeight: 1,
      }}>
        u<span style={{ color: '#c47a1a' }}>.</span>t
      </div>
    </div>
  );
}

function IconIsoCube({ size = 240 }) {
  const r = size * 0.225;
  return (
    <div style={{
      width: size, height: size,
      background: 'radial-gradient(circle at 30% 25%, #1a223a 0%, #0a0e1a 70%)',
      borderRadius: r, display: 'grid', placeItems: 'center', overflow: 'hidden',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
    }}>
      <svg viewBox="0 0 100 100" width={size * 0.7} height={size * 0.7}>
        {/* shadow under cube */}
        <ellipse cx="50" cy="86" rx="22" ry="3" fill="rgba(0,0,0,0.4)" />
        {/* top face */}
        <path d="M50 18 L78 32 L50 46 L22 32 Z" fill="#7686ff" />
        {/* left face */}
        <path d="M22 32 L22 66 L50 80 L50 46 Z" fill="#3d44c4" />
        {/* right face */}
        <path d="M78 32 L78 66 L50 80 L50 46 Z" fill="#5764e0" />
        {/* inner highlight on top */}
        <path d="M50 22 L72 33 L50 44 L28 33 Z" fill="rgba(255,255,255,0.08)" />
        {/* UT on right face */}
        <text x="60" y="64" fontSize="11" fontFamily='"SF Pro Display",sans-serif' fontWeight="800"
              fill="#fff" letterSpacing="-0.5" transform="skewY(-13)">UT</text>
      </svg>
    </div>
  );
}

function IconParticle({ size = 240 }) {
  const r = size * 0.225;
  // Mask-based stippled "U.T" — dots only inside the letterforms.
  const id = React.useId();
  return (
    <div style={{
      width: size, height: size, background: '#000',
      borderRadius: r, position: 'relative', overflow: 'hidden',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)'
    }}>
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <defs>
          <pattern id={`pat-${id}`} width="2.6" height="2.6" patternUnits="userSpaceOnUse">
            <circle cx="1.3" cy="1.3" r="0.55" fill="#fff" />
            <circle cx="1.3" cy="1.3" r="0.95" fill="#fff" opacity="0.12" />
          </pattern>
          <mask id={`mask-${id}`}>
            <rect width="100" height="100" fill="black" />
            <text x="50" y="62" fontSize="44" fontFamily='"SF Pro Display",sans-serif' fontWeight="900"
                  textAnchor="middle" fill="white" letterSpacing="-2.5">U.T</text>
          </mask>
        </defs>
        <rect width="100" height="100" fill={`url(#pat-${id})`} mask={`url(#mask-${id})`} />
      </svg>
    </div>
  );
}

function IconAperture({ size = 240 }) {
  const r = size * 0.225;
  return (
    <div style={{
      width: size, height: size, background: '#0e1118',
      borderRadius: r, display: 'grid', placeItems: 'center',
      position: 'relative', overflow: 'hidden',
    }}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        {/* outer ring */}
        <circle cx="50" cy="50" r="38" fill="none" stroke="#262d3d" strokeWidth="1" strokeDasharray="0.8 2.5" />
        {/* middle ring */}
        <circle cx="50" cy="50" r="28" fill="none" stroke="#3b4566" strokeWidth="1" strokeDasharray="0.8 2.2" />
        {/* aperture blades */}
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (i * 60) * Math.PI / 180;
          const x1 = 50 + Math.cos(a) * 12, y1 = 50 + Math.sin(a) * 12;
          const x2 = 50 + Math.cos(a) * 22, y2 = 50 + Math.sin(a) * 22;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#6c7bff" strokeWidth="2" strokeLinecap="round" />;
        })}
        {/* center dot */}
        <circle cx="50" cy="50" r="3.2" fill="#6c7bff" />
        <circle cx="50" cy="50" r="6" fill="none" stroke="#6c7bff" strokeWidth="0.6" />
      </svg>
    </div>
  );
}

function IconStack({ size = 240 }) {
  const r = size * 0.225;
  return (
    <div style={{
      width: size, height: size,
      background: 'linear-gradient(180deg, #f7f3ec 0%, #ece6da 100%)',
      borderRadius: r, position: 'relative', overflow: 'hidden',
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.05)'
    }}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        {/* back card */}
        <rect x="22" y="36" width="56" height="48" rx="6" fill="#ccc1a4" />
        {/* middle */}
        <rect x="26" y="30" width="56" height="48" rx="6" fill="#a18d61" />
        {/* top card */}
        <rect x="30" y="20" width="56" height="50" rx="6" fill="#15110a" />
        {/* UT on top card */}
        <text x="58" y="51" fontSize="22" fontFamily='"SF Pro Display",sans-serif' fontWeight="900"
              textAnchor="middle" fill="#f3ead3" letterSpacing="-1.2">UT</text>
        <circle cx="46" cy="52" r="1.8" fill="#f97316" />
      </svg>
    </div>
  );
}

Object.assign(window, {
  IconIndigo, IconCoralPeriod, IconCradle, IconBrutalist, IconFlask,
  IconFolio, IconIsoCube, IconParticle, IconAperture, IconStack
});
