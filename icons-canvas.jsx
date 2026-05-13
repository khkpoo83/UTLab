// Design canvas layout for UT.Lab icon concepts.

function Wordmark({ icon, sub, color = '#f4f4f6', sub2 = '#9aa0ac' }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      fontFamily: '"Pretendard Variable","SF Pro Display",sans-serif',
    }}>
      {icon}
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
        <div style={{
          fontSize: 22, fontWeight: 700, color,
          letterSpacing: '-0.025em',
        }}>
          UT<span style={{ color: '#F97316' }}>.</span>Lab
        </div>
        <div style={{
          fontSize: 11, color: sub2, marginTop: 4,
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

function Card({ Mark, name, blurb, theme = 'dark', smallSize = 44 }) {
  // theme: dark | light
  const cardBg = theme === 'dark' ? '#0e1014' : '#f7f4ed';
  const divider = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
  const nameColor = theme === 'dark' ? '#e9eaef' : '#1a1612';
  const subColor = theme === 'dark' ? '#7a8094' : '#7a705e';
  return (
    <div style={{
      width: 380, height: 480, background: cardBg,
      borderRadius: 18, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      boxShadow: theme === 'dark'
        ? '0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 32px rgba(0,0,0,0.4)'
        : '0 1px 0 rgba(255,255,255,0.7) inset, 0 12px 32px rgba(50,40,20,0.10)',
      fontFamily: '"Pretendard Variable","SF Pro Display",sans-serif',
    }}>
      {/* large icon */}
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 40 }}>
        <Mark size={240} />
      </div>
      <div style={{ height: 1, background: divider, margin: '0 24px' }} />
      {/* wordmark lockup */}
      <div style={{ padding: '20px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Wordmark
          icon={<Mark size={smallSize} />}
          sub={name}
          color={nameColor}
          sub2={subColor}
        />
        <div style={{ fontSize: 11, color: subColor, fontVariantNumeric: 'tabular-nums' }}>
          {blurb}
        </div>
      </div>
    </div>
  );
}

// ---------- favicon-strip: rows of small icons in different sizes
function FaviconStrip({ Mark, theme = 'dark' }) {
  const bg = theme === 'dark' ? '#0e1014' : '#f7f4ed';
  const sub = theme === 'dark' ? '#7a8094' : '#8e8270';
  const sizes = [16, 24, 32, 48, 64];
  return (
    <div style={{
      width: 380, height: 200, background: bg,
      borderRadius: 18, padding: 24,
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      boxShadow: theme === 'dark'
        ? '0 12px 32px rgba(0,0,0,0.4)'
        : '0 12px 32px rgba(50,40,20,0.10)',
      fontFamily: '"Pretendard Variable","SF Pro Display",sans-serif',
    }}>
      <div style={{
        fontSize: 11, color: sub, textTransform: 'uppercase', letterSpacing: '0.08em',
      }}>
        Scaled — 16 / 24 / 32 / 48 / 64 px
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 28, justifyContent: 'center', flex: 1 }}>
        {sizes.map((s) => (
          <div key={s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <Mark size={s} />
            <div style={{ fontSize: 10, color: sub, fontVariantNumeric: 'tabular-nums' }}>{s}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IconsCanvas() {
  return (
    <DesignCanvas
      bg="#191b22"
      caption="UT.Lab — Icon explorations · 10 directions"
    >
      <DCSection
        id="typographic"
        title="Typographic"
        subtitle="레터폼 기반 — 가장 인식 잘됨, 풍부한 변주 가능"
      >
        <DCArtboard id="indigo" label="01 · Indigo Mono" width={380} height={480}>
          <Card Mark={IconIndigo} name="Indigo Mono" blurb="01" />
        </DCArtboard>
        <DCArtboard id="coral" label="02 · Coral Period" width={380} height={480}>
          <Card Mark={IconCoralPeriod} name="Coral Period" blurb="02" />
        </DCArtboard>
        <DCArtboard id="cradle" label="03 · Cradle (U holds T)" width={380} height={480}>
          <Card Mark={IconCradle} name="Cradle" blurb="03" />
        </DCArtboard>
        <DCArtboard id="brutalist" label="04 · Brutalist" width={380} height={480}>
          <Card Mark={IconBrutalist} name="Brutalist" blurb="04" theme="light" />
        </DCArtboard>
      </DCSection>

      <DCSection
        id="metaphor"
        title="Object metaphor"
        subtitle="구체적 사물 — 'Lab' / '개인 공간' 의 의미를 직접적으로"
      >
        <DCArtboard id="flask" label="05 · Flask" width={380} height={480}>
          <Card Mark={IconFlask} name="Flask" blurb="05" />
        </DCArtboard>
        <DCArtboard id="folio" label="06 · Folio (journal)" width={380} height={480}>
          <Card Mark={IconFolio} name="Folio" blurb="06" theme="light" />
        </DCArtboard>
        <DCArtboard id="cube" label="07 · Iso Cube" width={380} height={480}>
          <Card Mark={IconIsoCube} name="Iso Cube" blurb="07" />
        </DCArtboard>
        <DCArtboard id="stack" label="08 · Stack (layered)" width={380} height={480}>
          <Card Mark={IconStack} name="Stack" blurb="08" theme="light" />
        </DCArtboard>
      </DCSection>

      <DCSection
        id="abstract"
        title="Abstract"
        subtitle="기호적 · 시스템적 — 데이터/실험실 분위기"
      >
        <DCArtboard id="particle" label="09 · Particle" width={380} height={480}>
          <Card Mark={IconParticle} name="Particle" blurb="09 · 위 애니메이션 호환" />
        </DCArtboard>
        <DCArtboard id="aperture" label="10 · Aperture" width={380} height={480}>
          <Card Mark={IconAperture} name="Aperture" blurb="10" />
        </DCArtboard>
      </DCSection>

      <DCSection
        id="scaling"
        title="Scaling check"
        subtitle="작은 사이즈에서도 또렷한지 — favicon · UI corner 활용"
      >
        <DCArtboard id="s-indigo" label="01 · Indigo" width={380} height={200}>
          <FaviconStrip Mark={IconIndigo} />
        </DCArtboard>
        <DCArtboard id="s-coral" label="02 · Coral Period" width={380} height={200}>
          <FaviconStrip Mark={IconCoralPeriod} />
        </DCArtboard>
        <DCArtboard id="s-cradle" label="03 · Cradle" width={380} height={200}>
          <FaviconStrip Mark={IconCradle} />
        </DCArtboard>
        <DCArtboard id="s-particle" label="09 · Particle" width={380} height={200}>
          <FaviconStrip Mark={IconParticle} />
        </DCArtboard>
        <DCArtboard id="s-aperture" label="10 · Aperture" width={380} height={200}>
          <FaviconStrip Mark={IconAperture} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<IconsCanvas />);
