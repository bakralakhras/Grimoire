// Grimoire — Audiobook player

function PlayerScreen() {
  const book = BOOKS.atlas;
  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: G.obsidian, color: G.bone, fontFamily: FONT_SANS,
    }}>
      {/* Ambient cover glow */}
      <div style={{
        position: 'absolute', top: -80, left: '50%', transform: 'translateX(-50%)',
        width: 520, height: 520, borderRadius: '50%',
        background: `radial-gradient(50% 50% at 50% 50%, ${book.palette[0]} 0%, rgba(13,11,18,0) 70%)`,
        filter: 'blur(40px)', opacity: 0.9,
      }}/>

      <StatusBar />

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '56px 22px 4px', position: 'relative', zIndex: 2,
      }}>
        <div style={{ width: 36, height: 36, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(244,239,230,0.06)', border: `0.5px solid ${G.ash}` }}>
          <Icon name="chev" size={16} color={G.pearl}/>
          <div style={{ position: 'absolute', transform: 'rotate(90deg)' }}>
            <Icon name="chev" size={16} color={G.pearl}/>
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: G.mist, fontWeight: 600, textTransform: 'uppercase' }}>Now playing</div>
          <div style={{ fontSize: 13, color: G.bone, fontWeight: 600, marginTop: 2 }}>Chapter 7 of 24</div>
        </div>
        <div style={{ width: 36, height: 36, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(244,239,230,0.06)', border: `0.5px solid ${G.ash}` }}>
          <Icon name="more" size={18} color={G.pearl}/>
        </div>
      </div>

      {/* Cover */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 32, position: 'relative', zIndex: 2 }}>
        <div style={{
          position: 'relative',
          boxShadow: `0 40px 80px ${book.palette[0]}60, 0 20px 50px rgba(0,0,0,0.6)`,
          transform: 'perspective(800px) rotateY(-2deg)',
        }}>
          <BookCover {...book} w={232} h={348}/>
        </div>
      </div>

      {/* Title */}
      <div style={{ textAlign: 'center', padding: '24px 24px 0', position: 'relative', zIndex: 2 }}>
        <div style={{ fontFamily: FONT_SERIF, fontSize: 24, fontWeight: 500, color: G.bone, lineHeight: 1.15, letterSpacing: -0.3, textWrap: 'balance' }}>
          {book.title}
        </div>
        <div style={{ fontSize: 12, color: G.pearl, marginTop: 10 }}>
          {book.author} · <span style={{ color: G.mist }}>Narr. {book.narrator}</span>
        </div>
      </div>

      {/* Waveform scrubber */}
      <div style={{ padding: '28px 26px 0', position: 'relative', zIndex: 2 }}>
        <Waveform progress={0.34}/>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8,
          fontSize: 11, fontFamily: FONT_MONO, color: G.mist, letterSpacing: 0.5 }}>
          <span>04:01:22</span>
          <span style={{ color: G.violet }}>– 07:40:38</span>
        </div>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '26px 32px 0', position: 'relative', zIndex: 2,
      }}>
        <CtrlIcon name="queue" size={20}/>
        <CtrlIcon name="back15" size={28}/>
        {/* Play */}
        <div style={{
          width: 76, height: 76, borderRadius: 38,
          background: `linear-gradient(145deg, ${G.violet}, ${G.plum})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 10px 28px ${G.amethyst}66, inset 0 1px 0 rgba(255,255,255,0.2)`,
        }}>
          <Icon name="pause" size={28} color={G.bone} sw={2}/>
        </div>
        <CtrlIcon name="fwd30" size={28}/>
        <CtrlIcon name="list" size={20}/>
      </div>

      {/* Bottom row: speed / sleep / cast / bookmark */}
      <div style={{
        margin: '28px 24px 0', padding: '14px 6px',
        borderTop: `0.5px solid ${G.ash}`, borderBottom: `0.5px solid ${G.ash}`,
        display: 'flex', justifyContent: 'space-around', alignItems: 'center',
        position: 'relative', zIndex: 2,
      }}>
        <BottomAction icon="speed" label="1.1×" active/>
        <BottomAction icon="moon" label="25 min"/>
        <BottomAction icon="bookmark" label="Mark"/>
        <BottomAction icon="text" label="Read"/>
      </div>
    </div>
  );
}

function CtrlIcon({ name, size }) {
  return (
    <div style={{ width: 44, height: 44, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={size} color={G.bone} sw={1.6}/>
    </div>
  );
}

function BottomAction({ icon, label, active }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
      color: active ? G.violet : G.pearl }}>
      <Icon name={icon} size={18} sw={1.6}/>
      <div style={{ fontSize: 10, fontFamily: FONT_MONO, letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function Waveform({ progress = 0.34 }) {
  // 72 bars with pseudo-random heights deterministic
  const bars = [];
  for (let i = 0; i < 68; i++) {
    const t = i / 67;
    const h = 4 + Math.abs(Math.sin(i * 0.6) * 14 + Math.cos(i * 0.23) * 10 + Math.sin(i * 1.2) * 8);
    bars.push({ h: Math.min(h, 28), played: t <= progress });
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 36, position: 'relative' }}>
      {bars.map((b, i) => (
        <div key={i} style={{
          flex: 1, height: b.h, borderRadius: 1,
          background: b.played ? G.violet : 'rgba(244,239,230,0.18)',
          opacity: b.played ? 1 : 1,
          boxShadow: b.played ? `0 0 3px ${G.amethyst}80` : 'none',
        }}/>
      ))}
      {/* playhead */}
      <div style={{
        position: 'absolute', left: `${progress * 100}%`, top: -4, bottom: -4,
        width: 2, background: G.gold, borderRadius: 1,
        boxShadow: `0 0 8px ${G.gold}`,
      }}/>
    </div>
  );
}

window.PlayerScreen = PlayerScreen;
