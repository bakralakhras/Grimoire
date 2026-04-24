// Grimoire Desktop — Marketplace + Upload modal + Context menu

function DesktopMarketplace({ showModal, showMenu }) {
  const { atlas, black_garden, hollow_king, salt_wives, quiet_machines, vesper, widow_tide, ink_bones } = BOOKS;
  const sagas = [
    { name: 'The Hollow King Saga', sub: 'T. R. Mercer · 4 volumes', books: [hollow_king, atlas, salt_wives, vesper] },
    { name: 'The Quiet Machines Trilogy', sub: 'Felix Ardent · 3 volumes', books: [quiet_machines, widow_tide, ink_bones] },
    { name: 'Standalones', sub: 'Curated this week', books: [black_garden, salt_wives, atlas, vesper, ink_bones] },
  ];

  return (
    <DesktopShell active="market" title="Marketplace">
      <div style={{ height: 64, borderBottom: `0.5px solid ${G.ash}`,
        display: 'flex', alignItems: 'center', padding: '0 28px', gap: 14 }}>
        <div>
          <div style={{ fontFamily: FONT_SERIF, fontSize: 24, color: G.bone, fontWeight: 500, letterSpacing: -0.3, lineHeight: 1 }}>Marketplace</div>
          <div style={{ fontSize: 10, color: G.mist, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 4, fontWeight: 600 }}>Shared tomes from your circle</div>
        </div>
        <div style={{ flex: 1 }}/>
        <div style={{ height: 34, width: 260, borderRadius: 8,
          background: G.raven, border: `0.5px solid ${G.ash}`,
          display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
          <Icon name="search" size={14} color={G.mist}/>
          <div style={{ color: G.mist, fontSize: 12, flex: 1 }}>Search marketplace…</div>
        </div>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: G.raven, border: `0.5px solid ${G.ash}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="back15" size={14} color={G.pearl}/>
        </div>
        <DesktopBtn icon="plus" label="Upload Book" solid/>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px 30px', position: 'relative' }}>
        {sagas.map((s, si) => (
          <div key={si} style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <Sigil kind={si === 0 ? 'rune' : si === 1 ? 'circle' : 'star'} size={12} color={G.gold} stroke={1.3}/>
                <div style={{ fontFamily: FONT_SERIF, fontSize: 20, color: G.bone, fontWeight: 500, letterSpacing: -0.2 }}>{s.name}</div>
                <div style={{ fontSize: 11, color: G.mist }}>· {s.sub}</div>
              </div>
              <div style={{ fontSize: 11, color: G.pearl, display: 'flex', alignItems: 'center', gap: 4 }}>View all <Icon name="chev" size={10} color={G.pearl}/></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 18 }}>
              {s.books.map((b, i) => (
                <MarketCard key={i} book={b} owned={(si + i) % 3 === 0} selected={si === 0 && i === 1 && showMenu}/>
              ))}
            </div>
          </div>
        ))}

        {showMenu && <ContextMenu/>}
      </div>

      {showModal && <UploadModal/>}
    </DesktopShell>
  );
}

function MarketCard({ book, owned, selected }) {
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10,
      outline: selected ? `1.5px solid ${G.violet}` : 'none',
      outlineOffset: 6, borderRadius: 4 }}>
      <div style={{ position: 'relative' }}>
        <BookCover {...book} w={null} h={null} style={{ width: '100%', aspectRatio: '0.67', height: 'auto' }}/>
        {owned && (
          <div style={{ position: 'absolute', top: 10, left: 10, padding: '4px 8px',
            background: 'rgba(111,179,160,0.2)', backdropFilter: 'blur(8px)',
            border: '0.5px solid rgba(111,179,160,0.45)', borderRadius: 4,
            fontSize: 9, fontWeight: 700, color: '#A6D4C5', letterSpacing: 1.2 }}>IN LIBRARY</div>
        )}
        <div style={{ position: 'absolute', bottom: 10, right: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 15,
            background: owned ? 'rgba(10,8,14,0.7)' : G.violet,
            backdropFilter: 'blur(6px)',
            border: owned ? `0.5px solid ${G.ash}` : 'none',
            boxShadow: owned ? 'none' : `0 6px 16px ${G.amethyst}60`,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={owned ? 'check' : 'download'} size={12} color={G.bone} sw={2}/>
          </div>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: G.bone, lineHeight: 1.25,
          display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{book.title}</div>
        <div style={{ fontSize: 10, color: G.mist, marginTop: 3 }}>{book.author}</div>
        <div style={{ fontSize: 9, color: G.gold, fontFamily: FONT_MONO, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Sigil kind="star" size={8} color={G.gold} stroke={1.5}/>{book.rating} · <span style={{ color: G.mist }}>{book.duration}</span>
        </div>
      </div>
    </div>
  );
}

function ContextMenu() {
  const items = [
    { label: 'Download', icon: 'download', shortcut: '⌘D' },
    { label: 'Edit Book…', icon: 'settings' },
    { label: 'Attach EPUB…', icon: 'book', gold: true },
    { divider: true },
    { label: 'Open in Library', icon: 'library' },
    { label: 'Copy Share Link', icon: 'share' },
    { divider: true },
    { label: 'Remove from Marketplace', icon: 'x', danger: true },
  ];
  return (
    <div style={{
      position: 'absolute', top: 220, left: '32%', width: 220,
      background: 'rgba(14,12,20,0.92)',
      backdropFilter: 'blur(24px) saturate(180%)',
      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      border: `0.5px solid rgba(244,239,230,0.1)`,
      borderRadius: 12, padding: 6,
      boxShadow: '0 20px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)',
      zIndex: 50,
    }}>
      {items.map((it, i) => it.divider ? (
        <div key={i} style={{ height: 0.5, background: G.ash, margin: '4px 6px' }}/>
      ) : (
        <div key={i} style={{ height: 30, padding: '0 10px', borderRadius: 6,
          display: 'flex', alignItems: 'center', gap: 10,
          background: i === 0 ? 'rgba(139,92,246,0.15)' : 'transparent',
          color: it.danger ? '#E88A7C' : it.gold ? G.gold : G.bone,
          fontSize: 12 }}>
          <Icon name={it.icon} size={12} color="currentColor" sw={1.6}/>
          <span style={{ flex: 1 }}>{it.label}</span>
          {it.shortcut && <span style={{ fontSize: 10, color: G.mist, fontFamily: FONT_MONO }}>{it.shortcut}</span>}
        </div>
      ))}
    </div>
  );
}

function UploadModal() {
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 100,
      background: 'rgba(8,7,11,0.7)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 460, borderRadius: 20,
        background: `linear-gradient(180deg, ${G.smoke} 0%, ${G.raven} 100%)`,
        border: `0.5px solid ${G.ash}`,
        boxShadow: '0 40px 100px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)',
        padding: 28, position: 'relative',
      }}>
        {/* Sigil flourish */}
        <div style={{ position: 'absolute', top: -1, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 72, height: 1, background: `linear-gradient(90deg, transparent, ${G.gold}, transparent)`, opacity: 0.6 }}/>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14,
            background: `linear-gradient(145deg, ${G.plum}, ${G.smoke})`,
            border: `0.5px solid ${G.ash}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 10px 30px ${G.amethyst}40` }}>
            <Icon name="download" size={24} color={G.gold} sw={1.5}/>
          </div>
        </div>
        <div style={{ textAlign: 'center', fontFamily: FONT_SERIF, fontSize: 24, color: G.bone, fontWeight: 500, letterSpacing: -0.3 }}>
          Upload Book to Marketplace
        </div>
        <div style={{ textAlign: 'center', fontSize: 13, color: G.pearl, marginTop: 8, lineHeight: 1.5 }}>
          Select a folder containing the audiobook's audio files.<br/>
          <span style={{ color: G.mist }}>Grimoire will detect chapters automatically.</span>
        </div>

        <div style={{ margin: '24px 0 8px', padding: '18px 16px', borderRadius: 10,
          background: G.obsidian, border: `1px dashed ${G.ash}`,
          display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: G.raven, border: `0.5px solid ${G.ash}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="library" size={16} color={G.gold}/>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: G.bone, fontWeight: 600 }}>No folder selected</div>
            <div style={{ fontSize: 11, color: G.mist, marginTop: 2 }}>.mp3, .m4a, .m4b, .flac, .opus</div>
          </div>
        </div>

        <div style={{ marginTop: 20, height: 44, borderRadius: 10,
          background: `linear-gradient(145deg, ${G.violet}, ${G.plum})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          fontSize: 14, fontWeight: 600, color: G.bone,
          boxShadow: `0 10px 30px ${G.amethyst}55` }}>
          <Icon name="library" size={14} color={G.bone} sw={1.8}/>
          Choose Folder…
        </div>

        <div style={{ marginTop: 12, textAlign: 'center', fontSize: 13, color: G.pearl, fontWeight: 500 }}>Cancel</div>
      </div>
    </div>
  );
}

window.DesktopMarketplace = DesktopMarketplace;
