// Grimoire Desktop — Library

function DesktopLibrary() {
  const books = Object.values(BOOKS);
  return (
    <DesktopShell active="library" title="Library">
      {/* Top toolbar */}
      <div style={{
        height: 64, borderBottom: `0.5px solid ${G.ash}`,
        display: 'flex', alignItems: 'center', padding: '0 28px', gap: 14,
      }}>
        <div>
          <div style={{ fontFamily: FONT_SERIF, fontSize: 24, color: G.bone, fontWeight: 500, letterSpacing: -0.3, lineHeight: 1 }}>Your Library</div>
          <div style={{ fontSize: 10, color: G.mist, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 4, fontWeight: 600 }}>{books.length} tomes · 3 in progress</div>
        </div>
        <div style={{ flex: 1 }}/>
        {/* Search */}
        <div style={{ height: 34, width: 280, borderRadius: 8,
          background: G.raven, border: `0.5px solid ${G.ash}`,
          display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
          <Icon name="search" size={14} color={G.mist}/>
          <div style={{ color: G.mist, fontSize: 12, flex: 1 }}>Search titles, authors…</div>
          <div style={{ fontSize: 10, color: G.mist, fontFamily: FONT_MONO, padding: '2px 6px', borderRadius: 4, background: 'rgba(244,239,230,0.06)' }}>⌘K</div>
        </div>
        <DesktopBtn icon="plus" label="New Collection"/>
        <DesktopBtn icon="download" label="Local" solid/>
      </div>

      {/* Filter chips */}
      <div style={{ padding: '18px 28px 10px', display: 'flex', gap: 8, alignItems: 'center', borderBottom: `0.5px solid ${G.ash}` }}>
        {['All', 'Audiobooks', 'EPUB', 'Downloaded', 'In Progress', 'Finished'].map((t, i) => (
          <Chip key={t} label={t} active={i === 0}/>
        ))}
        <div style={{ flex: 1 }}/>
        <Icon name="filter" size={14} color={G.mist}/>
        <div style={{ fontSize: 11, color: G.mist }}>Sort: <span style={{ color: G.bone }}>Recently added</span></div>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px 30px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 22 }}>
          {books.map((b, i) => <LibraryCard key={i} book={b} i={i}/>)}
        </div>
      </div>
    </DesktopShell>
  );
}

function DesktopBtn({ icon, label, solid }) {
  return (
    <div style={{
      height: 34, padding: '0 14px', borderRadius: 8,
      background: solid ? `linear-gradient(145deg, ${G.violet}, ${G.plum})` : G.raven,
      border: solid ? 'none' : `0.5px solid ${G.ash}`,
      display: 'flex', alignItems: 'center', gap: 7,
      fontSize: 12, fontWeight: 600, color: G.bone,
      boxShadow: solid ? `0 6px 18px ${G.amethyst}40` : 'none',
    }}>
      <Icon name={icon} size={13} color={G.bone} sw={1.8}/>
      {label}
    </div>
  );
}

function Chip({ label, active }) {
  return (
    <div style={{ height: 28, padding: '0 12px', borderRadius: 14,
      background: active ? 'rgba(139,92,246,0.15)' : 'transparent',
      border: `0.5px solid ${active ? 'rgba(139,92,246,0.35)' : G.ash}`,
      fontSize: 11, fontWeight: 600, color: active ? G.violet : G.pearl,
      display: 'flex', alignItems: 'center' }}>{label}</div>
  );
}

function LibraryCard({ book, i }) {
  const progress = book.progress || 0;
  const downloaded = i % 3 !== 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <BookCover {...book} w={null} h={null} style={{ width: '100%', aspectRatio: '0.67', height: 'auto' }}/>
        {/* Overlay status */}
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
          <div style={{ width: 22, height: 22, borderRadius: 11,
            background: downloaded ? 'rgba(111,179,160,0.25)' : 'rgba(10,8,14,0.7)',
            border: `0.5px solid ${downloaded ? 'rgba(111,179,160,0.5)' : G.ash}`,
            backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={downloaded ? 'check' : 'download'} size={11} color={downloaded ? '#6FB3A0' : G.pearl} sw={2}/>
          </div>
        </div>
        {/* Progress bar */}
        {progress > 0 && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'rgba(0,0,0,0.5)' }}>
            <div style={{ width: `${progress * 100}%`, height: '100%', background: G.gold, boxShadow: `0 0 6px ${G.gold}` }}/>
          </div>
        )}
        {/* Hover play (static, just indicates) */}
        {progress > 0 && (
          <div style={{ position: 'absolute', bottom: 10, right: 10, width: 32, height: 32, borderRadius: 16,
            background: G.violet, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 6px 16px ${G.amethyst}80` }}>
            <Icon name="play" size={12} color={G.bone} sw={2}/>
          </div>
        )}
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: G.bone, lineHeight: 1.25,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{book.title}</div>
        <div style={{ fontSize: 10, color: G.mist, marginTop: 3 }}>{book.author}</div>
        <div style={{ fontSize: 9, color: G.mist, fontFamily: FONT_MONO, marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>{book.chapters || Math.round(5 + i*3)} ch</span>
          <span style={{ width: 2, height: 2, borderRadius: 1, background: G.whisper }}/>
          <span>{book.duration}</span>
          {progress > 0 && <>
            <span style={{ width: 2, height: 2, borderRadius: 1, background: G.whisper }}/>
            <span style={{ color: G.gold }}>{Math.round(progress * 100)}%</span>
          </>}
        </div>
      </div>
    </div>
  );
}

window.DesktopLibrary = DesktopLibrary;
