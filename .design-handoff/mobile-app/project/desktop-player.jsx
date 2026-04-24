// Grimoire Desktop — Now Playing + persistent bottom player bar

function DesktopPlayer() {
  const book = BOOKS.atlas;
  const chapters = [
    'Preface', 'I. A House of Opened Books', 'II. The Atlas', 'III. Uncalm',
    'IV. Salt Lanterns', 'V. Hyssop', 'VI. What Mother Hummed',
    'VII. The Cartographer\'s Daughter', 'VIII. A Coast Unnamed',
    'IX. Ferryman', 'X. The Violet Deep',
  ];
  return (
    <DesktopShell active="player" title="Now Playing">
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Inner sidebar: chapters + bookmarks */}
        <div style={{ width: 280, flexShrink: 0, borderRight: `0.5px solid ${G.ash}`,
          background: G.obsidian, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '20px 22px 12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: G.mist, fontWeight: 700, textTransform: 'uppercase' }}>Chapters</div>
            <div style={{ fontSize: 10, color: G.mist, fontFamily: FONT_MONO }}>7 / 24</div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '0 12px' }}>
            {chapters.map((c, i) => (
              <div key={i} style={{
                padding: '8px 10px', borderRadius: 8, display: 'flex', gap: 10,
                alignItems: 'center', marginBottom: 1,
                background: i === 7 ? 'linear-gradient(90deg, rgba(139,92,246,0.18), rgba(139,92,246,0.04))' : 'transparent',
                border: i === 7 ? `0.5px solid rgba(139,92,246,0.3)` : '0.5px solid transparent',
                color: i === 7 ? G.bone : i < 7 ? G.pearl : G.mist,
                position: 'relative',
              }}>
                <div style={{ fontFamily: FONT_MONO, fontSize: 10, width: 22, color: i === 7 ? G.violet : G.mist }}>{String(i+1).padStart(2, '0')}</div>
                <div style={{ flex: 1, fontSize: 12, fontWeight: i === 7 ? 600 : 500, lineHeight: 1.3 }}>{c}</div>
                {i < 7 && <Icon name="check" size={11} color={G.mist}/>}
                {i === 7 && <Icon name="play" size={9} color={G.violet} sw={2.2}/>}
              </div>
            ))}
          </div>

          {/* Bookmarks */}
          <div style={{ borderTop: `0.5px solid ${G.ash}`, padding: '16px 22px 8px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: G.mist, fontWeight: 700, textTransform: 'uppercase' }}>Bookmarks</div>
            <div style={{ width: 22, height: 22, borderRadius: 11, background: G.raven, border: `0.5px solid ${G.ash}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="plus" size={11} color={G.gold}/>
            </div>
          </div>
          <div style={{ padding: '0 12px 18px' }}>
            {[
              { t: '"a sentence her father had never finished"', ch: 'Ch. 7', ts: '32:14' },
              { t: 'Mother humming the coast', ch: 'Ch. 7', ts: '41:02' },
              { t: 'Violet Deep — first mention', ch: 'Ch. 3', ts: '18:47' },
            ].map((b, i) => (
              <div key={i} style={{ padding: '10px 10px', borderRadius: 8,
                background: G.raven, border: `0.5px solid ${G.ash}`, marginBottom: 6 }}>
                <div style={{ fontFamily: FONT_SERIF, fontSize: 12, fontStyle: 'italic', color: G.parchment, lineHeight: 1.35 }}>{b.t}</div>
                <div style={{ fontSize: 9, color: G.mist, fontFamily: FONT_MONO, marginTop: 4, display: 'flex', gap: 6 }}>
                  <span style={{ color: G.gold }}>{b.ch}</span>
                  <span>{b.ts}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main playing area */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'auto',
          background: `radial-gradient(60% 50% at 50% 20%, ${book.palette[0]}55 0%, ${G.obsidian} 65%)`,
        }}>
          {/* Crumbs */}
          <div style={{ padding: '18px 28px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 11, color: G.mist, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 600 }}>
              Now Playing <span style={{ color: G.whisper }}>/</span> <span style={{ color: G.pearl }}>{book.title}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: G.mist, fontFamily: FONT_MONO }}>Chapter 7 · 24 total</div>
              <Icon name="more" size={16} color={G.pearl}/>
            </div>
          </div>

          {/* Hero cover */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 34 }}>
            <div style={{ transform: 'perspective(1000px) rotateY(-3deg)',
              boxShadow: `0 50px 100px ${book.palette[0]}80, 0 30px 60px rgba(0,0,0,0.7)` }}>
              <BookCover {...book} w={220} h={330}/>
            </div>
          </div>

          <div style={{ textAlign: 'center', padding: '24px 48px 0' }}>
            <div style={{ fontSize: 10, color: G.gold, letterSpacing: 2, fontWeight: 700 }}>CHAPTER 7 / 24</div>
            <div style={{ fontFamily: FONT_SERIF, fontSize: 30, color: G.bone, fontWeight: 500, letterSpacing: -0.4, marginTop: 8, lineHeight: 1.1 }}>
              {book.title}
            </div>
            <div style={{ fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 16, color: G.parchment, marginTop: 6 }}>
              The Cartographer's Daughter
            </div>
            <div style={{ fontSize: 12, color: G.pearl, marginTop: 12 }}>
              {book.author} · <span style={{ color: G.mist }}>Narrated by {book.narrator}</span>
            </div>

            {/* Rating */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 14, alignItems: 'center' }}>
              {[1,2,3,4,5].map(i => (
                <Sigil key={i} kind="star" size={14} color={i <= 4 ? G.gold : G.ash} stroke={1.4}/>
              ))}
              <span style={{ fontSize: 11, color: G.mist, fontFamily: FONT_MONO, marginLeft: 6 }}>4.7 · 2,148 reviews</span>
            </div>
          </div>

          {/* Progress scrubber */}
          <div style={{ padding: '28px 72px 0' }}>
            <div style={{ height: 4, background: 'rgba(244,239,230,0.1)', borderRadius: 2, position: 'relative' }}>
              <div style={{ width: '34%', height: '100%', background: `linear-gradient(90deg, ${G.violet}, ${G.gold})`, borderRadius: 2 }}/>
              <div style={{ position: 'absolute', left: '34%', top: -4, width: 12, height: 12, borderRadius: 6,
                background: G.gold, boxShadow: `0 0 12px ${G.gold}`, transform: 'translateX(-6px)' }}/>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10,
              fontSize: 11, fontFamily: FONT_MONO, color: G.mist }}>
              <span>04:01:22</span>
              <span style={{ color: G.gold }}>-07:40:38</span>
            </div>
          </div>

          {/* Open EPUB */}
          <div style={{ padding: '20px 72px 120px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ height: 38, padding: '0 18px', borderRadius: 19,
              background: 'rgba(244,239,230,0.06)', border: `0.5px solid ${G.ash}`,
              display: 'flex', alignItems: 'center', gap: 8, color: G.bone,
              fontSize: 12, fontWeight: 600 }}>
              <Icon name="book" size={14} color={G.gold}/>
              Open EPUB · Follow along
            </div>
          </div>
        </div>
      </div>

      {/* Persistent bottom player bar */}
      <PlayerBar/>
    </DesktopShell>
  );
}

function PlayerBar() {
  const book = BOOKS.atlas;
  return (
    <div style={{
      height: 76, flexShrink: 0,
      background: 'rgba(6,5,9,0.94)',
      backdropFilter: 'blur(24px) saturate(180%)',
      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      borderTop: `0.5px solid ${G.ash}`,
      display: 'flex', alignItems: 'center', padding: '0 18px',
      gap: 16, position: 'relative', zIndex: 20,
    }}>
      {/* Now playing */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', width: 280 }}>
        <BookCover {...book} w={48} h={48} style={{ borderRadius: 6 }}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: G.bone, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{book.title}</div>
          <div style={{ fontSize: 11, color: G.mist, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Ch. 7 — The Cartographer's Daughter</div>
        </div>
        <Icon name="heart" size={14} color={G.gold}/>
      </div>

      {/* Transport */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <TransportBtn icon="back" sw={1.8}/>
          <TransportBtn icon="back15"/>
          {/* Play */}
          <div style={{ width: 40, height: 40, borderRadius: 20,
            background: `linear-gradient(145deg, ${G.violet}, ${G.plum})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 6px 16px ${G.amethyst}55`, border: '0.5px solid rgba(255,255,255,0.12)' }}>
            <Icon name="pause" size={14} color={G.bone} sw={2}/>
          </div>
          <TransportBtn icon="fwd30"/>
          <TransportBtn icon="chev" sw={1.8}/>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: 480 }}>
          <div style={{ fontSize: 10, color: G.mist, fontFamily: FONT_MONO, width: 56 }}>04:01:22</div>
          <div style={{ flex: 1, height: 3, background: 'rgba(244,239,230,0.1)', borderRadius: 2, position: 'relative' }}>
            <div style={{ width: '34%', height: '100%', background: G.violet, borderRadius: 2 }}/>
            <div style={{ position: 'absolute', left: '34%', top: -2, width: 7, height: 7, borderRadius: 4, background: G.gold, transform: 'translateX(-3.5px)' }}/>
          </div>
          <div style={{ fontSize: 10, color: G.mist, fontFamily: FONT_MONO, width: 56, textAlign: 'right' }}>11:42:00</div>
        </div>
      </div>

      {/* Right cluster */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: 420, justifyContent: 'flex-end' }}>
        {/* volume */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 100 }}>
          <Icon name="speed" size={14} color={G.pearl}/>
          <div style={{ flex: 1, height: 2, background: 'rgba(244,239,230,0.1)', borderRadius: 2, position: 'relative' }}>
            <div style={{ width: '70%', height: '100%', background: G.pearl, borderRadius: 2 }}/>
          </div>
        </div>
        <Pill label="1.1×"/>
        <BarIcon name="moon" badge="25"/>
        <BarIcon name="bookmark" active/>
        <BarIcon name="queue"/>
        <BarIcon name="text"/>
        <BarIcon name="settings"/>
        <div style={{ width: 0.5, height: 24, background: G.ash, margin: '0 2px' }}/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: G.mist, fontFamily: FONT_MONO }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: '#6FB3A0', boxShadow: '0 0 6px #6FB3A0' }}/>
          Synced
        </div>
        <div style={{ width: 26, height: 26, borderRadius: 13,
          background: 'linear-gradient(145deg, #3D2860, #1C1825)',
          border: `0.5px solid ${G.ash}`,
          fontFamily: FONT_SERIF, fontSize: 11, color: G.parchment,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>EM</div>
      </div>
    </div>
  );
}

function TransportBtn({ icon, sw }) {
  return <div style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <Icon name={icon} size={18} color={G.bone} sw={sw || 1.6}/>
  </div>;
}

function BarIcon({ name, active, badge }) {
  return (
    <div style={{ position: 'relative', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={15} color={active ? G.violet : G.pearl}/>
      {badge && <div style={{ position: 'absolute', top: -2, right: -4, fontSize: 8, fontFamily: FONT_MONO,
        padding: '1px 4px', borderRadius: 4, background: G.plum, color: G.bone, fontWeight: 700 }}>{badge}</div>}
    </div>
  );
}

function Pill({ label }) {
  return <div style={{ height: 24, padding: '0 10px', borderRadius: 12,
    background: G.raven, border: `0.5px solid ${G.ash}`,
    display: 'flex', alignItems: 'center', gap: 4,
    fontSize: 11, fontWeight: 600, color: G.bone, fontFamily: FONT_MONO }}>
    {label} <Icon name="chev" size={8} color={G.mist}/>
  </div>;
}

window.DesktopPlayer = DesktopPlayer;
window.PlayerBar = PlayerBar;
