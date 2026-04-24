// Grimoire — EPUB Reader

function ReaderScreen() {
  const book = BOOKS.atlas;
  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: '#12101A',
      color: G.bone, fontFamily: FONT_SANS,
    }}>
      <StatusBar />

      {/* Top chrome */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '54px 20px 10px',
      }}>
        <Icon name="back" size={22} color={G.pearl}/>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: G.mist, textTransform: 'uppercase', fontWeight: 600 }}>Chapter 7</div>
          <div style={{ fontFamily: FONT_SERIF, fontSize: 14, color: G.parchment, marginTop: 1, fontStyle: 'italic' }}>The Cartographer's Daughter</div>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <Icon name="text" size={20} color={G.pearl}/>
          <Icon name="bookmark" size={20} color={G.gold}/>
        </div>
      </div>

      {/* Reading area */}
      <div style={{ padding: '18px 32px 0', position: 'relative' }}>
        {/* Drop cap paragraph */}
        <div style={{
          fontFamily: FONT_SERIF, fontSize: 19, lineHeight: 1.55,
          color: G.parchment, letterSpacing: 0.1,
        }}>
          <span style={{
            float: 'left', fontFamily: FONT_SERIF, fontSize: 62, lineHeight: 0.85,
            padding: '6px 10px 0 0', color: G.gold, fontWeight: 500,
          }}>T</span>
          he atlas was bound in split calfskin, gone soft at the corners from years of a hand that no longer turned its pages. Mara had inherited it the way one inherits a draft from an open window — unwelcome, and unignorable.
        </div>

        <div style={{
          fontFamily: FONT_SERIF, fontSize: 19, lineHeight: 1.55,
          color: G.parchment, marginTop: 18, textIndent: 20,
        }}>
          Inside, the names were the ones her father had taught her: the Hollow Shore, the Violet Deep, the country called <span style={{ fontStyle: 'italic', color: G.bone }}>Uncalm</span>. Places he swore he had walked, though none of them appeared on any map a customs officer could stamp.
        </div>

        {/* Highlight */}
        <div style={{
          fontFamily: FONT_SERIF, fontSize: 19, lineHeight: 1.55,
          color: G.parchment, marginTop: 18, textIndent: 20,
        }}>
          <span style={{
            background: 'linear-gradient(180deg, transparent 0%, transparent 52%, rgba(201,162,74,0.32) 52%, rgba(201,162,74,0.32) 92%, transparent 92%)',
            paddingBottom: 1, color: G.bone,
          }}>What she was looking for, she realized at last, was not a place at all but a sentence her father had never finished.</span>
          {' '}The book opened easiest at the pages he had worn most, and it was there she began.
        </div>

        <div style={{
          fontFamily: FONT_SERIF, fontSize: 19, lineHeight: 1.55,
          color: G.parchment, marginTop: 18, textIndent: 20, opacity: 0.6,
        }}>
          The first name under her thumb was a coast she had never heard named aloud — though her mother, from the next room, began to hum it without knowing.
        </div>

        {/* Ornament */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '26px 0 10px', gap: 14, opacity: 0.5 }}>
          <div style={{ height: 0.5, flex: 1, background: G.whisper }}/>
          <Sigil kind="moon" size={14} color={G.gold} stroke={1.2}/>
          <div style={{ height: 0.5, flex: 1, background: G.whisper }}/>
        </div>
      </div>

      {/* Bottom scrubber */}
      <div style={{
        position: 'absolute', bottom: 24, left: 20, right: 20,
        padding: '12px 16px',
        borderRadius: 20,
        background: 'rgba(20,17,25,0.8)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `0.5px solid ${G.ash}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{ fontSize: 10, fontFamily: FONT_MONO, color: G.mist }}>p. 142</div>
          <div style={{ flex: 1, height: 2, background: 'rgba(244,239,230,0.1)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
            <div style={{ width: '34%', height: '100%', background: G.gold }}/>
            <div style={{ position: 'absolute', left: '34%', top: -3, width: 8, height: 8, borderRadius: 4, background: G.gold, transform: 'translateX(-4px)', boxShadow: `0 0 8px ${G.gold}`}}/>
          </div>
          <div style={{ fontSize: 10, fontFamily: FONT_MONO, color: G.mist }}>418</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: G.mist }}>
          <span>12 min left in chapter</span>
          <span style={{ color: G.pearl, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon name="play" size={10} color={G.pearl} sw={2}/> Switch to listen
          </span>
        </div>
      </div>
    </div>
  );
}

window.ReaderScreen = ReaderScreen;
