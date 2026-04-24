// Grimoire — Book Detail

function DetailScreen() {
  const book = BOOKS.hollow_king;
  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: G.obsidian, color: G.bone, fontFamily: FONT_SANS,
    }}>
      {/* Cover as ambient backdrop */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 420,
        background: `linear-gradient(180deg, ${book.palette[0]} 0%, ${G.obsidian} 100%)`,
        opacity: 0.9,
      }}/>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 420,
        background: `radial-gradient(70% 50% at 50% 30%, ${book.palette[2]}22 0%, transparent 70%)`,
      }}/>

      <StatusBar />

      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '54px 20px 10px', position: 'relative', zIndex: 2,
      }}>
        <div style={{ width: 36, height: 36, borderRadius: 18, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="back" size={18} color={G.bone}/>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ width: 36, height: 36, borderRadius: 18, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="share" size={16} color={G.bone}/>
          </div>
          <div style={{ width: 36, height: 36, borderRadius: 18, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="more" size={18} color={G.bone}/>
          </div>
        </div>
      </div>

      <div style={{ overflow: 'auto', height: 'calc(100% - 94px)', position: 'relative', zIndex: 2 }}>
        {/* Cover */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <div style={{ boxShadow: '0 30px 60px rgba(0,0,0,0.6)' }}>
            <BookCover {...book} w={180} h={270}/>
          </div>
        </div>

        {/* Title */}
        <div style={{ textAlign: 'center', padding: '24px 28px 0' }}>
          <div style={{ fontFamily: FONT_SERIF, fontSize: 30, lineHeight: 1.05, color: G.bone, fontWeight: 500, letterSpacing: -0.4 }}>
            {book.title}
          </div>
          <div style={{ fontSize: 13, color: G.pearl, marginTop: 8, letterSpacing: 0.3 }}>
            by <span style={{ color: G.bone }}>{book.author}</span>
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 18, alignItems: 'center' }}>
            <Stat value={book.rating} label="Rating" icon/>
            <Divider/>
            <Stat value="18h" label="Listen"/>
            <Divider/>
            <Stat value="418p" label="Read"/>
          </div>
        </div>

        {/* Format toggle */}
        <div style={{ margin: '24px 24px 0', background: G.raven, borderRadius: 14, padding: 4,
          border: `0.5px solid ${G.ash}`, display: 'flex', position: 'relative' }}>
          <FormatTab icon="play" label="Listen" sub="18h 03m" active/>
          <FormatTab icon="text" label="Read" sub="418 pages"/>
          <FormatTab icon="book" label="Both" sub="Synced" rare/>
        </div>

        {/* CTA */}
        <div style={{ padding: '18px 24px 0', display: 'flex', gap: 10 }}>
          <div style={{ flex: 1, height: 48, borderRadius: 24,
            background: `linear-gradient(145deg, ${G.violet}, ${G.plum})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            fontSize: 14, fontWeight: 600, color: G.bone,
            boxShadow: `0 8px 20px ${G.amethyst}55`,
          }}>
            <Icon name="play" size={14} color={G.bone} sw={2}/>
            Begin Chapter 1
          </div>
          <div style={{ width: 48, height: 48, borderRadius: 24, background: G.raven, border: `0.5px solid ${G.ash}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="download" size={18} color={G.bone}/>
          </div>
          <div style={{ width: 48, height: 48, borderRadius: 24, background: G.raven, border: `0.5px solid ${G.ash}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="heart" size={18} color={G.gold}/>
          </div>
        </div>

        {/* Synopsis */}
        <div style={{ padding: '26px 28px 0' }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: G.mist, fontWeight: 600, textTransform: 'uppercase', marginBottom: 10 }}>Synopsis</div>
          <div style={{ fontFamily: FONT_SERIF, fontSize: 15, lineHeight: 1.55, color: G.parchment }}>
            In a kingdom where the dead still vote, a disgraced ferryman is asked to bury a king no one will name. What follows is a pilgrimage through salt, iron, and the stubborn grief of the living — a novel about the countries we keep beneath our tongues.
          </div>
        </div>

        {/* Narrator card */}
        <div style={{ margin: '24px 24px 0', padding: 14, background: G.raven, borderRadius: 16, border: `0.5px solid ${G.ash}`, display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: 24, background: 'linear-gradient(145deg, #3D2860, #1C1825)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT_SERIF, fontSize: 18, color: G.parchment, border: `0.5px solid ${G.ash}` }}>IO</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: G.gold, fontWeight: 600 }}>NARRATED BY</div>
            <div style={{ fontFamily: FONT_SERIF, fontSize: 17, color: G.bone, marginTop: 1 }}>Idris Okafor</div>
            <div style={{ fontSize: 11, color: G.mist, marginTop: 2 }}>42 audiobooks · Dramatic, warm baritone</div>
          </div>
          <Icon name="chev" size={16} color={G.mist}/>
        </div>

        {/* Chapters preview */}
        <div style={{ padding: '26px 28px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: G.mist, fontWeight: 600, textTransform: 'uppercase' }}>Chapters</div>
            <div style={{ fontSize: 11, color: G.pearl }}>32 total</div>
          </div>
          {[
            { n: '1', t: 'A Ferryman in Low Water', d: '42:18' },
            { n: '2', t: 'The King Who Would Not Be Named', d: '38:07' },
            { n: '3', t: 'Salt Lanterns', d: '31:54' },
            { n: '4', t: 'Hyssop and Iron', d: '45:22' },
          ].map((ch, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '12px 0', borderBottom: i < 3 ? `0.5px solid ${G.ash}` : 'none' }}>
              <div style={{ fontFamily: FONT_SERIF, fontSize: 18, color: G.gold, width: 22, fontStyle: 'italic' }}>{ch.n}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: FONT_SERIF, fontSize: 15, color: G.bone }}>{ch.t}</div>
                <div style={{ fontSize: 10, color: G.mist, fontFamily: FONT_MONO, marginTop: 2 }}>{ch.d}</div>
              </div>
              <Icon name="play" size={12} color={G.pearl} sw={2}/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label, icon }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 60 }}>
      <div style={{ fontFamily: FONT_SERIF, fontSize: 17, color: G.bone, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', whiteSpace: 'nowrap' }}>
        {icon && <Sigil kind="star" size={11} color={G.gold} stroke={1.5}/>}
        {value}
      </div>
      <div style={{ fontSize: 9, color: G.mist, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 3, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</div>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 0.5, height: 24, background: G.ash }}/>;
}

function FormatTab({ icon, label, sub, active, rare }) {
  return (
    <div style={{ flex: 1, padding: '10px 8px', borderRadius: 11,
      background: active ? G.smoke : 'transparent',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
      border: active ? `0.5px solid ${G.ash}` : '0.5px solid transparent' }}>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <Icon name={icon} size={13} color={rare ? G.gold : (active ? G.bone : G.pearl)} sw={1.8}/>
        <span style={{ fontSize: 13, fontWeight: 600, color: rare ? G.gold : (active ? G.bone : G.pearl) }}>{label}</span>
      </div>
      <div style={{ fontSize: 9, color: G.mist, fontFamily: FONT_MONO, letterSpacing: 0.3 }}>{sub}</div>
    </div>
  );
}

window.DetailScreen = DetailScreen;
