// Grimoire Desktop — EPUB Reader overlay (on top of Now Playing)

function DesktopReader() {
  const book = BOOKS.atlas;
  const chapters = [
    'Preface', 'I. A House of Opened Books', 'II. The Atlas', 'III. Uncalm',
    'IV. Salt Lanterns', 'V. Hyssop', 'VI. What Mother Hummed',
    'VII. The Cartographer\'s Daughter', 'VIII. A Coast Unnamed',
    'IX. Ferryman', 'X. The Violet Deep', 'XI. The Country of Names',
  ];
  return (
    <DesktopShell active="player" title="Now Playing · Reader">
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
        {/* Dim base (the player behind) */}
        <div style={{ position: 'absolute', inset: 0,
          background: `radial-gradient(60% 50% at 50% 30%, ${book.palette[0]}33 0%, ${G.obsidian} 65%)`,
          opacity: 0.5 }}/>

        {/* Reader overlay */}
        <div style={{
          position: 'absolute', inset: '14px 14px 14px 14px', zIndex: 5,
          borderRadius: 16, overflow: 'hidden',
          background: '#12101A',
          border: `0.5px solid ${G.ash}`,
          boxShadow: '0 40px 120px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Top bar */}
          <div style={{ height: 48, flexShrink: 0, borderBottom: `0.5px solid ${G.ash}`,
            display: 'flex', alignItems: 'center', padding: '0 14px', gap: 12 }}>
            {/* Layout toggles */}
            <div style={{ display: 'flex', gap: 4, background: G.obsidian, border: `0.5px solid ${G.ash}`, borderRadius: 8, padding: 3 }}>
              <LayoutBtn kind="single" active/>
              <LayoutBtn kind="double"/>
              <LayoutBtn kind="scroll"/>
            </div>

            <div style={{ flex: 1, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <div style={{ fontFamily: FONT_SERIF, fontSize: 14, color: G.bone, fontWeight: 500 }}>{book.title}</div>
              <div style={{ color: G.whisper }}>—</div>
              <div style={{ fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 13, color: G.parchment }}>Chapter 7</div>
              <div style={{ color: G.whisper }}>·</div>
              <div style={{ fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 13, color: G.pearl }}>The Cartographer's Daughter</div>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <TopIcon name="search"/>
              <TopIcon name="text"/>
              <TopIcon name="settings"/>
              <TopIcon name="plus" rotate/>
              <TopIcon name="x" close/>
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Chapters panel */}
            <div style={{ width: 260, flexShrink: 0, borderRight: `0.5px solid ${G.ash}`,
              background: 'rgba(14,12,20,0.6)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '16px 18px 8px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 10, letterSpacing: 2, color: G.mist, fontWeight: 700, textTransform: 'uppercase' }}>Table of Contents</div>
                <div style={{ fontSize: 10, color: G.mist, fontFamily: FONT_MONO }}>{chapters.length}</div>
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: '0 10px 16px' }}>
                {chapters.map((c, i) => (
                  <div key={i} style={{
                    padding: '8px 12px', borderRadius: 6, display: 'flex', gap: 10,
                    alignItems: 'center', marginBottom: 1,
                    background: i === 7 ? 'rgba(139,92,246,0.15)' : 'transparent',
                    border: i === 7 ? `0.5px solid rgba(139,92,246,0.3)` : '0.5px solid transparent',
                  }}>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 9, width: 18, color: i === 7 ? G.violet : G.mist }}>{String(i+1).padStart(2, '0')}</div>
                    <div style={{ flex: 1, fontFamily: FONT_SERIF, fontSize: 13, color: i === 7 ? G.bone : G.pearl, lineHeight: 1.3,
                      fontStyle: i === 7 ? 'normal' : 'italic' }}>{c}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Reading column */}
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center',
              background: 'radial-gradient(100% 50% at 50% 0%, rgba(43,27,78,0.25) 0%, transparent 60%)' }}>
              <div style={{ maxWidth: 620, width: '100%', padding: '56px 48px 60px' }}>
                <div style={{ textAlign: 'center', marginBottom: 40 }}>
                  <div style={{ fontSize: 10, letterSpacing: 3, color: G.mist, fontWeight: 600, textTransform: 'uppercase' }}>Chapter Seven</div>
                  <div style={{ fontFamily: FONT_SERIF, fontSize: 30, color: G.violet, fontWeight: 500, letterSpacing: -0.3, marginTop: 10, fontStyle: 'italic' }}>
                    The Cartographer's Daughter
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 22, opacity: 0.6 }}>
                    <div style={{ height: 0.5, width: 60, background: G.whisper }}/>
                    <Sigil kind="moon" size={12} color={G.gold} stroke={1.2}/>
                    <div style={{ height: 0.5, width: 60, background: G.whisper }}/>
                  </div>
                </div>

                <div style={{ fontFamily: FONT_SERIF, fontSize: 18, lineHeight: 1.75, color: G.parchment }}>
                  <span style={{ float: 'left', fontFamily: FONT_SERIF, fontSize: 64, lineHeight: 0.85, padding: '6px 12px 0 0', color: G.gold, fontWeight: 500 }}>T</span>
                  he atlas was bound in split calfskin, gone soft at the corners from years of a hand that no longer turned its pages. Mara had inherited it the way one inherits a draft from an open window — unwelcome, and unignorable.
                </div>

                <div style={{ fontFamily: FONT_SERIF, fontSize: 18, lineHeight: 1.75, color: G.parchment, marginTop: 22, textIndent: 26 }}>
                  Inside, the names were the ones her father had taught her: the Hollow Shore, the Violet Deep, the country called <span style={{ fontStyle: 'italic', color: G.bone }}>Uncalm</span>. Places he swore he had walked, though none of them appeared on any map a customs officer could stamp.
                </div>

                <div style={{ fontFamily: FONT_SERIF, fontSize: 18, lineHeight: 1.75, color: G.parchment, marginTop: 22, textIndent: 26 }}>
                  <span style={{ background: 'linear-gradient(180deg, transparent 0%, transparent 55%, rgba(201,162,74,0.28) 55%, rgba(201,162,74,0.28) 92%, transparent 92%)', color: G.bone }}>
                    What she was looking for, she realized at last, was not a place at all but a sentence her father had never finished.
                  </span>{' '}
                  The book opened easiest at the pages he had worn most, and it was there she began.
                </div>

                <div style={{ fontFamily: FONT_SERIF, fontSize: 18, lineHeight: 1.75, color: G.parchment, marginTop: 22, textIndent: 26 }}>
                  The first name under her thumb was a coast she had never heard named aloud — though her mother, from the next room, began to hum it without knowing. Mara watched the humming without turning, the way a cat watches a door.
                </div>

                <div style={{ fontFamily: FONT_SERIF, fontSize: 18, lineHeight: 1.75, color: G.parchment, marginTop: 22, textIndent: 26 }}>
                  She thought, with the small clean sorrow of the ill-prepared: <span style={{ fontStyle: 'italic' }}>I am being taught something I was not supposed to learn yet.</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, margin: '40px 0 10px', opacity: 0.4 }}>
                  <div style={{ height: 0.5, flex: 1, background: G.whisper }}/>
                  <Sigil kind="star" size={10} color={G.gold} stroke={1.3}/>
                  <div style={{ height: 0.5, flex: 1, background: G.whisper }}/>
                </div>

                <div style={{ textAlign: 'center', fontSize: 10, fontFamily: FONT_MONO, color: G.mist, letterSpacing: 1 }}>p. 142 of 418 · 12 min left in chapter</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <PlayerBar/>
    </DesktopShell>
  );
}

function LayoutBtn({ kind, active }) {
  const rects = kind === 'single' ? [[8,6,8,12]] : kind === 'double' ? [[4,6,5,12],[11,6,5,12]] : [[6,5,8,3],[6,10,8,3],[6,15,8,3]];
  return (
    <div style={{ width: 28, height: 22, borderRadius: 5,
      background: active ? G.smoke : 'transparent',
      border: active ? `0.5px solid ${G.ash}` : '0.5px solid transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="20" height="20" viewBox="0 0 20 20">
        {rects.map((r, i) => <rect key={i} x={r[0]} y={r[1]} width={r[2]} height={r[3]} rx="1" fill="none" stroke={active ? G.violet : G.pearl} strokeWidth="1"/>)}
      </svg>
    </div>
  );
}

function TopIcon({ name, close, rotate }) {
  return (
    <div style={{ width: 28, height: 28, borderRadius: 6,
      background: close ? 'rgba(255,95,87,0.12)' : 'transparent',
      border: `0.5px solid ${close ? 'rgba(255,95,87,0.3)' : 'transparent'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transform: rotate ? 'rotate(45deg)' : 'none' }}>
      <Icon name={name} size={13} color={close ? '#ff8a80' : G.pearl}/>
    </div>
  );
}

window.DesktopReader = DesktopReader;
