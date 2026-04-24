// Grimoire — Home / Library screen

function HomeScreen() {
  const { atlas, black_garden, hollow_king, salt_wives, quiet_machines, vesper, widow_tide, ink_bones } = BOOKS;
  const continuing = [atlas, black_garden, hollow_king];
  const shelves = [
    { name: 'Recently Added', books: [salt_wives, vesper, quiet_machines, widow_tide] },
    { name: 'On the Night Table', books: [ink_bones, black_garden, atlas, salt_wives] },
  ];

  return (
    <div style={{
      width: '100%', height: '100%',
      background: G.obsidian,
      color: G.bone, fontFamily: FONT_SANS,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Ambient glow */}
      <div style={{
        position: 'absolute', top: -160, left: -80, right: -80, height: 480,
        background: G.glow, pointerEvents: 'none', opacity: 0.8,
      }}/>

      <StatusBar />

      {/* Header */}
      <div style={{
        padding: '58px 24px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative', zIndex: 2,
      }}>
        <div>
          <div style={{
            fontSize: 11, letterSpacing: 3, color: G.mist,
            textTransform: 'uppercase', fontWeight: 500, marginBottom: 4,
          }}>Waning Crescent · 11:34 pm</div>
          <div style={{
            fontFamily: FONT_SERIF, fontSize: 38, fontWeight: 500,
            color: G.bone, lineHeight: 1, letterSpacing: -0.5,
          }}>Your Grimoire</div>
        </div>
        <div style={{
          width: 38, height: 38, borderRadius: 19,
          background: 'linear-gradient(145deg, #3D2860, #1C1825)',
          border: `0.5px solid ${G.ash}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: FONT_SERIF, fontSize: 16, color: G.parchment,
        }}>EM</div>
      </div>

      {/* Segmented */}
      <div style={{
        margin: '20px 24px 0', display: 'flex', gap: 22,
        borderBottom: `0.5px solid ${G.ash}`, position: 'relative', zIndex: 2,
      }}>
        {['Library', 'Shelves', 'Downloads', 'Finished'].map((t, i) => (
          <div key={t} style={{
            paddingBottom: 12, fontSize: 14, fontWeight: i === 0 ? 600 : 500,
            color: i === 0 ? G.bone : G.mist,
            borderBottom: i === 0 ? `1.5px solid ${G.violet}` : 'none',
            marginBottom: -0.75,
          }}>{t}</div>
        ))}
      </div>

      {/* Continue reading / listening — hero */}
      <div style={{ padding: '22px 24px 8px', position: 'relative', zIndex: 2 }}>
        <div style={{
          fontFamily: FONT_SERIF, fontSize: 18, color: G.parchment,
          fontStyle: 'italic', marginBottom: 14,
        }}>Continue your reading</div>

        {/* Hero card */}
        <HeroCard book={atlas} />
      </div>

      {/* Currently In Progress — horizontal */}
      <div style={{ marginTop: 24, position: 'relative', zIndex: 2 }}>
        <div style={{
          padding: '0 24px 12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase', color: G.pearl, fontWeight: 600 }}>In Progress</div>
          <div style={{ fontSize: 12, color: G.mist }}>{continuing.length} books</div>
        </div>
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', padding: '0 24px 6px' }}>
          {continuing.map((b, i) => <ProgressTile key={i} book={b}/>)}
        </div>
      </div>

      {/* Shelves */}
      {shelves.map((shelf, si) => (
        <div key={shelf.name} style={{ marginTop: 24, position: 'relative', zIndex: 2 }}>
          <div style={{
            padding: '0 24px 12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <Sigil kind={si === 0 ? 'star' : 'moon'} size={10} color={G.gold} stroke={1.2}/>
              <div style={{ fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase', color: G.pearl, fontWeight: 600 }}>{shelf.name}</div>
            </div>
            <div style={{ fontSize: 12, color: G.mist }}>See all</div>
          </div>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '0 24px 6px' }}>
            {shelf.books.map((b, i) => (
              <div key={i} style={{ flexShrink: 0, width: 112 }}>
                <BookCover {...b} w={112} h={168}/>
                <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: G.bone, lineHeight: 1.25,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>{b.title}</div>
                <div style={{ fontSize: 11, color: G.mist, marginTop: 2 }}>{b.author}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ height: 200 }}/>

      {/* Mini player */}
      <MiniPlayer book={atlas}/>

      <TabBar active="home"/>
    </div>
  );
}

function HeroCard({ book }) {
  return (
    <div style={{
      borderRadius: 20, overflow: 'hidden',
      background: `linear-gradient(135deg, ${book.palette[0]} 0%, ${G.smoke} 100%)`,
      padding: 18, display: 'flex', gap: 16, alignItems: 'flex-start',
      border: `0.5px solid ${G.ash}`,
      boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      position: 'relative',
    }}>
      <BookCover {...book} w={96} h={144} />
      <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
        <div style={{ fontSize: 10, letterSpacing: 2, color: G.gold, fontWeight: 600, marginBottom: 6 }}>CHAPTER 7 / 24</div>
        <div style={{
          fontFamily: FONT_SERIF, fontSize: 22, lineHeight: 1.1,
          color: G.bone, fontWeight: 500, marginBottom: 4, letterSpacing: -0.3,
        }}>{book.title}</div>
        <div style={{ fontSize: 12, color: G.pearl, marginBottom: 14 }}>{book.author}</div>

        {/* Progress arc */}
        <div style={{ height: 3, background: 'rgba(244,239,230,0.12)', borderRadius: 2, overflow: 'hidden', marginBottom: 10 }}>
          <div style={{ width: `${book.progress * 100}%`, height: '100%', background: G.gold }}/>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: G.mist, marginBottom: 14, fontFamily: FONT_MONO }}>
          <span>4h 01m in</span><span>7h 41m left</span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{
            flex: 1, height: 38, borderRadius: 19,
            background: G.bone, color: G.ink,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            fontSize: 13, fontWeight: 600,
          }}>
            <Icon name="play" size={13} color={G.ink} sw={2}/>
            Resume
          </div>
          <div style={{
            width: 38, height: 38, borderRadius: 19,
            background: 'rgba(244,239,230,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `0.5px solid ${G.ash}`,
          }}>
            <Icon name="book" size={16} color={G.bone}/>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressTile({ book }) {
  return (
    <div style={{
      flexShrink: 0, width: 220,
      padding: 12, borderRadius: 14,
      background: G.raven,
      border: `0.5px solid ${G.ash}`,
      display: 'flex', gap: 12,
    }}>
      <BookCover {...book} w={56} h={84}/>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: G.bone, lineHeight: 1.2,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{book.title}</div>
          <div style={{ fontSize: 10, color: G.mist, marginTop: 3 }}>{book.author}</div>
        </div>
        <div>
          <div style={{ height: 2, background: 'rgba(244,239,230,0.1)', borderRadius: 2, marginBottom: 4 }}>
            <div style={{ width: `${(book.progress || 0) * 100}%`, height: '100%', background: G.violet }}/>
          </div>
          <div style={{ fontSize: 9, color: G.mist, fontFamily: FONT_MONO, letterSpacing: 0.5 }}>
            {Math.round((book.progress || 0) * 100)}% · {book.duration}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniPlayer({ book }) {
  return (
    <div style={{
      position: 'absolute', bottom: 100, left: 16, right: 16,
      height: 58, borderRadius: 16,
      background: 'rgba(28,24,37,0.9)',
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      border: '0.5px solid rgba(244,239,230,0.08)',
      display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px 0 10px',
      zIndex: 35,
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    }}>
      <BookCover {...book} w={42} h={42} style={{ borderRadius: 8 }}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: G.bone, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {book.title}
        </div>
        <div style={{ fontSize: 10, color: G.mist, fontFamily: FONT_MONO, marginTop: 1 }}>4:01:22 / 11:42:00</div>
      </div>
      <div style={{ width: 34, height: 34, borderRadius: 17, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.08)' }}>
        <Icon name="play" size={13} color={G.bone} sw={2}/>
      </div>
      {/* Progress bar at bottom */}
      <div style={{ position: 'absolute', bottom: 0, left: 12, right: 12, height: 1.5, background: 'rgba(244,239,230,0.08)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: '34%', height: '100%', background: G.violet }}/>
      </div>
    </div>
  );
}

window.HomeScreen = HomeScreen;
