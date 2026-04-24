// Grimoire design system
// Dark, atmospheric, modern. Obsidian + amethyst + parchment gold.

const G = {
  // Surfaces — layered obsidian
  ink:       '#08070B',    // deepest bg
  obsidian:  '#0D0B12',    // base
  raven:     '#141119',    // card
  smoke:     '#1C1825',    // elevated card
  ash:       '#26212F',    // border / divider

  // Accents
  amethyst:  '#8B5CF6',    // primary
  violet:    '#A78BFA',    // primary light
  plum:      '#4C1D95',    // primary deep
  gold:      '#C9A24A',    // rare accent (flourishes, ratings)
  parchment: '#E8E1D1',    // warm off-white for serifs

  // Text
  bone:      '#F4EFE6',    // primary text (warm white)
  pearl:     'rgba(244,239,230,0.72)',  // secondary
  mist:      'rgba(244,239,230,0.48)',  // tertiary
  whisper:   'rgba(244,239,230,0.24)',  // disabled / hairline

  // Utility
  gradient:  'linear-gradient(135deg, #2B1B4E 0%, #0D0B12 55%, #1A0B2E 100%)',
  glow:      'radial-gradient(60% 60% at 50% 40%, rgba(139,92,246,0.35) 0%, rgba(139,92,246,0) 70%)',
};

// Serif for brand/titles, sans for UI, mono for times
const FONT_SERIF = '"Cormorant Garamond", "EB Garamond", Georgia, serif';
const FONT_SANS  = '"Inter", -apple-system, system-ui, sans-serif';
const FONT_MONO  = '"JetBrains Mono", "SF Mono", ui-monospace, monospace';

// ─────────────────────────────────────────────────────────────
// Book cover — stylized, no real art. Uses gradient + sigil.
// ─────────────────────────────────────────────────────────────
function BookCover({ title, author, palette, sigil = 'moon', w = 120, h = 180, style = {} }) {
  const p = palette || ['#2B1B4E', '#0D0B12'];
  // When w is null/undefined (responsive width via style), use a fallback for font sizing
  const tw = w || 180;
  return (
    <div style={{
      width: w, height: h, flexShrink: 0,
      background: `linear-gradient(145deg, ${p[0]} 0%, ${p[1]} 100%)`,
      borderRadius: 3,
      position: 'relative', overflow: 'hidden',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5), inset 0 0 0 0.5px rgba(255,255,255,0.08), inset 2px 0 3px rgba(0,0,0,0.4)',
      ...style,
    }}>
      {/* paper texture */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(120% 80% at 30% 20%, rgba(255,255,255,0.06), transparent 60%)',
      }} />
      {/* sigil */}
      <div style={{
        position: 'absolute', top: '18%', left: '50%', transform: 'translateX(-50%)',
        opacity: 0.4,
      }}>
        <Sigil kind={sigil} size={tw * 0.38} color={p[2] || G.gold} />
      </div>
      {/* spine shadow */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
        background: 'linear-gradient(90deg, rgba(0,0,0,0.5), transparent)',
      }} />
      {/* title */}
      <div style={{
        position: 'absolute', bottom: 14, left: 10, right: 10,
        fontFamily: FONT_SERIF, fontWeight: 500,
        fontSize: tw * 0.11, lineHeight: 1.15,
        color: p[2] || G.parchment, letterSpacing: 0.3,
        textAlign: 'center', textWrap: 'balance',
      }}>{title}</div>
      {/* author */}
      {author && <div style={{
        position: 'absolute', top: 10, left: 10, right: 10,
        fontFamily: FONT_SANS, fontSize: tw * 0.055,
        color: (p[2] || G.parchment), opacity: 0.55,
        textAlign: 'center', letterSpacing: 1.2, textTransform: 'uppercase',
      }}>{author}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sigil — simple geometric arcane marks, pure SVG
// ─────────────────────────────────────────────────────────────
function Sigil({ kind = 'moon', size = 24, color = G.gold, stroke = 1 }) {
  const s = size, c = s / 2;
  const props = { width: s, height: s, viewBox: `0 0 ${s} ${s}`, fill: 'none', stroke: color, strokeWidth: stroke };
  switch (kind) {
    case 'moon':
      return <svg {...props}>
        <circle cx={c} cy={c} r={c - 2}/>
        <path d={`M ${c} ${2} A ${c-2} ${c-2} 0 0 1 ${c} ${s-2} A ${(c-2)*0.55} ${c-2} 0 0 0 ${c} ${2} Z`} fill={color} stroke="none"/>
      </svg>;
    case 'eye':
      return <svg {...props}>
        <path d={`M 2 ${c} Q ${c} 3 ${s-2} ${c} Q ${c} ${s-3} 2 ${c} Z`}/>
        <circle cx={c} cy={c} r={c * 0.35} fill={color} stroke="none"/>
      </svg>;
    case 'star':
      return <svg {...props}>
        <path d={`M ${c} 2 L ${s-2} ${s-4} L 2 ${s*0.4} L ${s-2} ${s*0.4} L 2 ${s-4} Z`}/>
      </svg>;
    case 'tri':
      return <svg {...props}>
        <path d={`M ${c} 3 L ${s-3} ${s-3} L 3 ${s-3} Z`}/>
        <path d={`M 3 ${s*0.68} L ${s-3} ${s*0.68}`}/>
      </svg>;
    case 'circle':
      return <svg {...props}>
        <circle cx={c} cy={c} r={c - 2}/>
        <circle cx={c} cy={c} r={c * 0.55}/>
        <circle cx={c} cy={c} r={c * 0.2} fill={color} stroke="none"/>
      </svg>;
    case 'sun':
      return <svg {...props}>
        <circle cx={c} cy={c} r={c * 0.42}/>
        {[...Array(8)].map((_, i) => {
          const a = (i * Math.PI * 2) / 8;
          const r1 = c * 0.55, r2 = c * 0.92;
          return <line key={i} x1={c + Math.cos(a)*r1} y1={c + Math.sin(a)*r1} x2={c + Math.cos(a)*r2} y2={c + Math.sin(a)*r2}/>;
        })}
      </svg>;
    case 'rune':
      return <svg {...props}>
        <path d={`M ${c} 3 L ${c} ${s-3} M 3 ${c*0.7} L ${c} 3 L ${s-3} ${c*0.7}`}/>
      </svg>;
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Icon set — minimal linework
// ─────────────────────────────────────────────────────────────
function Icon({ name, size = 22, color = 'currentColor', sw = 1.6 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: sw, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'home':     return <svg {...p}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>;
    case 'compass':  return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>;
    case 'library':  return <svg {...p}><path d="M4 3v18M8 3v18M12 7l2 14M18 5l3 15"/></svg>;
    case 'user':     return <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>;
    case 'search':   return <svg {...p}><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>;
    case 'play':     return <svg {...p}><path d="M7 4l13 8-13 8z" fill={color}/></svg>;
    case 'pause':    return <svg {...p}><rect x="6" y="4" width="4" height="16" fill={color}/><rect x="14" y="4" width="4" height="16" fill={color}/></svg>;
    case 'back15':   return <svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><text x="12" y="15" fontSize="8" fill={color} stroke="none" fontFamily="sans-serif" fontWeight="600" textAnchor="middle">15</text></svg>;
    case 'fwd30':    return <svg {...p}><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/><text x="12" y="15" fontSize="8" fill={color} stroke="none" fontFamily="sans-serif" fontWeight="600" textAnchor="middle">30</text></svg>;
    case 'moon':     return <svg {...p}><path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"/></svg>;
    case 'speed':    return <svg {...p}><path d="M4 14a8 8 0 1 1 16 0"/><path d="M12 14l4-3"/></svg>;
    case 'list':     return <svg {...p}><path d="M4 6h16M4 12h16M4 18h10"/></svg>;
    case 'book':     return <svg {...p}><path d="M4 4h7a3 3 0 0 1 3 3v14M20 4h-7a3 3 0 0 0-3 3v14"/></svg>;
    case 'heart':    return <svg {...p}><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.7A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>;
    case 'download': return <svg {...p}><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>;
    case 'check':    return <svg {...p}><path d="M4 12l5 5L20 6"/></svg>;
    case 'bookmark': return <svg {...p}><path d="M6 3h12v18l-6-4-6 4z"/></svg>;
    case 'settings': return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>;
    case 'chev':     return <svg {...p}><path d="M9 6l6 6-6 6"/></svg>;
    case 'back':     return <svg {...p}><path d="M15 6l-6 6 6 6"/></svg>;
    case 'more':     return <svg {...p}><circle cx="5" cy="12" r="1.2" fill={color}/><circle cx="12" cy="12" r="1.2" fill={color}/><circle cx="19" cy="12" r="1.2" fill={color}/></svg>;
    case 'plus':     return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>;
    case 'x':        return <svg {...p}><path d="M6 6l12 12M18 6l-12 12"/></svg>;
    case 'filter':   return <svg {...p}><path d="M3 5h18M6 12h12M10 19h4"/></svg>;
    case 'queue':    return <svg {...p}><path d="M4 6h13M4 12h13M4 18h9M19 15v6M19 15l-2 2M19 15l2 2"/></svg>;
    case 'text':     return <svg {...p}><path d="M4 7V5h16v2M10 5v14M7 19h6"/></svg>;
    case 'share':    return <svg {...p}><path d="M12 4v12M8 8l4-4 4 4M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"/></svg>;
    default: return null;
  }
}

// Shared tab bar (liquid glass, dark)
function TabBar({ active = 'home' }) {
  const tabs = [
    { id: 'home', label: 'Library', icon: 'library' },
    { id: 'discover', label: 'Discover', icon: 'compass' },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'me', label: 'You', icon: 'user' },
  ];
  return (
    <div style={{
      position: 'absolute', bottom: 24, left: 16, right: 16,
      height: 68, borderRadius: 32,
      display: 'flex', alignItems: 'center', justifyContent: 'space-around',
      background: 'rgba(20,17,25,0.72)',
      backdropFilter: 'blur(24px) saturate(180%)',
      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      border: '0.5px solid rgba(244,239,230,0.08)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)',
      zIndex: 40,
    }}>
      {tabs.map(t => {
        const isActive = t.id === active;
        return (
          <div key={t.id} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            color: isActive ? G.violet : G.mist,
            position: 'relative',
          }}>
            {isActive && <div style={{
              position: 'absolute', top: -20, width: 4, height: 4, borderRadius: 4,
              background: G.violet, boxShadow: `0 0 8px ${G.violet}`,
            }} />}
            <Icon name={t.icon} size={22} sw={isActive ? 2 : 1.5}/>
            <div style={{
              fontFamily: FONT_SANS, fontSize: 10, letterSpacing: 0.3,
              fontWeight: isActive ? 600 : 500,
            }}>{t.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// Status bar (dark variant)
function StatusBar() {
  return <IOSStatusBar dark={true} />;
}

Object.assign(window, { G, FONT_SERIF, FONT_SANS, FONT_MONO, BookCover, Sigil, Icon, TabBar, StatusBar });
