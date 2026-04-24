// Grimoire Desktop — shell + sidebar

function DesktopShell({ children, active = 'library', title = 'Grimoire' }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      background: G.ink,
      color: G.bone, fontFamily: FONT_SANS,
      display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Title bar */}
      <div style={{
        height: 36, flexShrink: 0,
        background: '#060509',
        borderBottom: `0.5px solid ${G.ash}`,
        display: 'flex', alignItems: 'center', padding: '0 16px',
        gap: 10, position: 'relative', zIndex: 10,
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <WinDot color="#ff5f57"/>
          <WinDot color="#febc2e"/>
          <WinDot color="#28c840"/>
        </div>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 11,
          color: G.mist, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 600 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Sigil kind="moon" size={10} color={G.gold} stroke={1.3}/>
            {title}
          </span>
        </div>
        <div style={{ width: 48 }}/>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
        <Sidebar active={active}/>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function WinDot({ color }) {
  return <div style={{ width: 12, height: 12, borderRadius: 6, background: color, boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.25)' }}/>;
}

function Sidebar({ active }) {
  const items = [
    { id: 'library', label: 'Library', icon: 'library' },
    { id: 'player', label: 'Now Playing', icon: 'play' },
    { id: 'market', label: 'Marketplace', icon: 'compass' },
  ];
  return (
    <div style={{
      width: 232, flexShrink: 0,
      background: G.obsidian,
      borderRight: `0.5px solid ${G.ash}`,
      display: 'flex', flexDirection: 'column',
      position: 'relative',
    }}>
      {/* Ambient amethyst glow at top */}
      <div style={{ position: 'absolute', top: -80, left: -40, right: -40, height: 200,
        background: G.glow, pointerEvents: 'none', opacity: 0.6 }}/>

      {/* Brand */}
      <div style={{ padding: '22px 22px 28px', position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: `linear-gradient(145deg, ${G.plum}, ${G.smoke})`,
          border: `0.5px solid ${G.ash}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 4px 14px ${G.amethyst}30`,
        }}>
          <Sigil kind="moon" size={16} color={G.gold} stroke={1.3}/>
        </div>
        <div>
          <div style={{ fontFamily: FONT_SERIF, fontSize: 20, fontWeight: 500, color: G.bone, lineHeight: 1, letterSpacing: -0.3 }}>Grimoire</div>
          <div style={{ fontSize: 9, color: G.mist, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 3, fontFamily: FONT_MONO }}>v1.2.0</div>
        </div>
      </div>

      {/* Nav */}
      <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
        <SideSection label="Main"/>
        {items.map(it => <SideItem key={it.id} {...it} active={it.id === active}/>)}

        <SideSection label="Collections" style={{ marginTop: 18 }}/>
        {[
          { label: 'Currently Reading', sigil: 'circle', count: 3 },
          { label: 'Midnight Shelf', sigil: 'moon', count: 18 },
          { label: 'Tomes to Finish', sigil: 'tri', count: 7 },
          { label: 'Favourites', sigil: 'star', count: 12 },
        ].map((c, i) => <CollectionItem key={i} {...c}/>)}
      </div>

      <div style={{ flex: 1 }}/>

      {/* Now playing mini */}
      <NowPlayingMini/>

      {/* Footer / user */}
      <div style={{ padding: '12px 16px 14px', borderTop: `0.5px solid ${G.ash}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: 14,
          background: 'linear-gradient(145deg, #3D2860, #1C1825)',
          border: `0.5px solid ${G.ash}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: FONT_SERIF, fontSize: 12, color: G.parchment }}>EM</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: G.bone, fontWeight: 600 }}>Ellis Marrow</div>
          <div style={{ fontSize: 10, color: G.mist, fontFamily: FONT_MONO, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: 3, background: '#6FB3A0', boxShadow: '0 0 4px #6FB3A0' }}/>
            Synced · just now
          </div>
        </div>
        <Icon name="settings" size={14} color={G.mist}/>
      </div>
    </div>
  );
}

function SideSection({ label, style }) {
  return <div style={{ padding: '6px 10px 6px', fontSize: 10, letterSpacing: 2, color: G.mist, textTransform: 'uppercase', fontWeight: 600, ...style }}>{label}</div>;
}

function SideItem({ icon, label, active }) {
  return (
    <div style={{
      height: 34, borderRadius: 8, padding: '0 12px',
      display: 'flex', alignItems: 'center', gap: 10,
      background: active ? 'linear-gradient(90deg, rgba(139,92,246,0.18), rgba(139,92,246,0.04))' : 'transparent',
      color: active ? G.bone : G.pearl,
      fontWeight: active ? 600 : 500, fontSize: 13,
      position: 'relative',
      border: active ? `0.5px solid rgba(139,92,246,0.22)` : '0.5px solid transparent',
    }}>
      {active && <div style={{ position: 'absolute', left: -12, top: 8, bottom: 8, width: 2, borderRadius: 2, background: G.violet, boxShadow: `0 0 8px ${G.violet}` }}/>}
      <Icon name={icon} size={15} color={active ? G.violet : G.pearl} sw={1.6}/>
      <span>{label}</span>
    </div>
  );
}

function CollectionItem({ label, sigil, count }) {
  return (
    <div style={{
      height: 30, borderRadius: 8, padding: '0 12px',
      display: 'flex', alignItems: 'center', gap: 10,
      color: G.pearl, fontSize: 12,
    }}>
      <Sigil kind={sigil} size={12} color={G.gold} stroke={1.3}/>
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontSize: 10, color: G.mist, fontFamily: FONT_MONO }}>{count}</span>
    </div>
  );
}

function NowPlayingMini() {
  const book = BOOKS.atlas;
  return (
    <div style={{ padding: '12px 12px', margin: '0 12px 10px', borderRadius: 12,
      background: G.raven, border: `0.5px solid ${G.ash}`, display: 'flex', gap: 10, alignItems: 'center' }}>
      <BookCover {...book} w={38} h={38} style={{ borderRadius: 6 }}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: G.bone, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{book.title}</div>
        <div style={{ fontSize: 9, color: G.mist, fontFamily: FONT_MONO, marginTop: 1 }}>Ch. 7 · 04:01:22</div>
      </div>
      <div style={{ width: 24, height: 24, borderRadius: 12, background: G.violet, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="pause" size={10} color={G.bone} sw={2}/>
      </div>
    </div>
  );
}

Object.assign(window, { DesktopShell });
