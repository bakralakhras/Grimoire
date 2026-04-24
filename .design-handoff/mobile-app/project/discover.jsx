// Grimoire — Discover / Browse

function DiscoverScreen() {
  const { atlas, black_garden, hollow_king, salt_wives, quiet_machines, vesper, widow_tide, ink_bones } = BOOKS;
  const featured = atlas;
  const categories = [
    { name: 'Fantasy', sigil: 'rune' },
    { name: 'Literary', sigil: 'moon' },
    { name: 'Mystery', sigil: 'eye' },
    { name: 'Sci-Fi', sigil: 'circle' },
    { name: 'Poetry', sigil: 'star' },
    { name: 'History', sigil: 'sun' },
  ];

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: G.obsidian, color: G.bone, fontFamily: FONT_SANS,
    }}>
      <StatusBar />

      {/* Header */}
      <div style={{ padding: '56px 24px 16px' }}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: G.mist, textTransform: 'uppercase', fontWeight: 500, marginBottom: 4 }}>Discover</div>
        <div style={{ fontFamily: FONT_SERIF, fontSize: 34, fontWeight: 500, color: G.bone, lineHeight: 1, letterSpacing: -0.5 }}>Tonight's tomes</div>
      </div>

      {/* Search */}
      <div style={{ margin: '0 24px 20px', height: 44, borderRadius: 14,
        background: G.raven, border: `0.5px solid ${G.ash}`,
        display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px' }}>
        <Icon name="search" size={16} color={G.mist}/>
        <div style={{ color: G.mist, fontSize: 14 }}>Titles, authors, narrators…</div>
      </div>

      {/* Featured hero */}
      <div style={{ margin: '0 24px 24px', borderRadius: 18, overflow: 'hidden',
        background: `linear-gradient(135deg, ${featured.palette[0]} 0%, ${G.obsidian} 120%)`,
        padding: 20, border: `0.5px solid ${G.ash}`, position: 'relative' }}>
        <div style={{ position: 'absolute', top: -30, right: -30, opacity: 0.15 }}>
          <Sigil kind="moon" size={160} color={G.gold} stroke={0.8}/>
        </div>
        <div style={{ fontSize: 10, letterSpacing: 2, color: G.gold, fontWeight: 600, marginBottom: 10 }}>FEATURED · EDITOR'S PICK</div>
        <div style={{ display: 'flex', gap: 16, position: 'relative' }}>
          <BookCover {...featured} w={100} h={150}/>
          <div style={{ flex: 1, paddingTop: 6, minWidth: 0 }}>
            <div style={{ fontFamily: FONT_SERIF, fontSize: 22, lineHeight: 1.1, color: G.bone, letterSpacing: -0.3 }}>
              {featured.title}
            </div>
            <div style={{ fontSize: 12, color: G.pearl, marginTop: 4 }}>{featured.author}</div>
            <div style={{ fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 13, color: G.mist, marginTop: 10, lineHeight: 1.4 }}>
              "A cartography of loss, drawn by a woman who refuses to be an ending."
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
              <div style={{ fontSize: 10, color: G.gold, fontFamily: FONT_MONO, display: 'flex', alignItems: 'center', gap: 3 }}>
                <Sigil kind="star" size={10} color={G.gold} stroke={1.2}/> 4.7
              </div>
              <div style={{ width: 2, height: 2, borderRadius: 1, background: G.whisper }}/>
              <div style={{ fontSize: 10, color: G.mist, fontFamily: FONT_MONO }}>11h 42m</div>
              <div style={{ width: 2, height: 2, borderRadius: 1, background: G.whisper }}/>
              <div style={{ fontSize: 10, color: G.mist, fontFamily: FONT_MONO }}>Audio + Text</div>
            </div>
          </div>
        </div>
      </div>

      {/* Browse by sign */}
      <div style={{ padding: '0 24px 12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase', color: G.pearl, fontWeight: 600 }}>Browse by Sign</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, padding: '0 24px 24px' }}>
        {categories.map(c => (
          <div key={c.name} style={{
            aspectRatio: '1.3', borderRadius: 14,
            background: G.raven, border: `0.5px solid ${G.ash}`,
            padding: 12, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            position: 'relative', overflow: 'hidden',
          }}>
            <Sigil kind={c.sigil} size={22} color={G.gold} stroke={1.2}/>
            <div style={{ fontFamily: FONT_SERIF, fontSize: 15, color: G.bone, fontWeight: 500 }}>{c.name}</div>
          </div>
        ))}
      </div>

      {/* New voices */}
      <div style={{ padding: '0 24px 12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <Sigil kind="star" size={10} color={G.gold} stroke={1.2}/>
          <div style={{ fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase', color: G.pearl, fontWeight: 600 }}>New Voices</div>
        </div>
        <div style={{ fontSize: 12, color: G.mist }}>See all</div>
      </div>
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '0 24px 6px' }}>
        {[salt_wives, quiet_machines, widow_tide, ink_bones].map((b, i) => (
          <div key={i} style={{ flexShrink: 0, width: 124 }}>
            <BookCover {...b} w={124} h={186}/>
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: G.bone, lineHeight: 1.25,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{b.title}</div>
            <div style={{ fontSize: 11, color: G.mist, marginTop: 2 }}>{b.author}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '28px 24px 140px' }}>
        <div style={{ padding: '0 0 12px', fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase', color: G.pearl, fontWeight: 600 }}>Narrated by Moonlight</div>
        <div style={{ display: 'flex', gap: 12, flexDirection: 'column' }}>
          {[vesper, hollow_king, black_garden].map((b, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <BookCover {...b} w={56} h={84}/>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: FONT_SERIF, fontSize: 15, color: G.bone, fontWeight: 500 }}>{b.title}</div>
                <div style={{ fontSize: 11, color: G.mist, marginTop: 2 }}>{b.author} · {b.duration}</div>
                <div style={{ fontSize: 10, color: G.gold, fontFamily: FONT_MONO, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Sigil kind="star" size={8} color={G.gold} stroke={1.5}/> {b.rating}
                </div>
              </div>
              <div style={{ width: 34, height: 34, borderRadius: 17, background: 'rgba(244,239,230,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `0.5px solid ${G.ash}` }}>
                <Icon name="plus" size={14} color={G.bone}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      <TabBar active="discover"/>
    </div>
  );
}

window.DiscoverScreen = DiscoverScreen;
