// Grimoire — Follow-along (whispersync), Onboarding, Constellation, Sleep timer, Highlights

// ══════════════════════════════════════════════════════════════
// FOLLOW-ALONG READER — voice travels through text
// ══════════════════════════════════════════════════════════════
function FollowAlongScreen() {
  const book = BOOKS.atlas;
  // Current narrated sentence highlighted; previous sentences slightly dimmed
  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: '#12101A', color: G.bone, fontFamily: FONT_SANS,
    }}>
      <StatusBar />

      {/* Top bar — shows voice indicator */}
      <div style={{ padding: '54px 20px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Icon name="back" size={22} color={G.pearl}/>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: G.gold, textTransform: 'uppercase', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
            <VoicePulse/>Follow Along · Ch. 7
          </div>
          <div style={{ fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 13, color: G.parchment, marginTop: 3 }}>Idris Okafor reading</div>
        </div>
        <Icon name="text" size={20} color={G.pearl}/>
      </div>

      {/* Reading */}
      <div style={{ padding: '20px 30px 0' }}>
        <p style={{ fontFamily: FONT_SERIF, fontSize: 18, lineHeight: 1.7, color: G.mist, margin: 0 }}>
          The atlas was bound in split calfskin, gone soft at the corners from years of a hand that no longer turned its pages.
        </p>
        <p style={{ fontFamily: FONT_SERIF, fontSize: 18, lineHeight: 1.7, color: G.pearl, margin: '14px 0 0' }}>
          Mara had inherited it the way one inherits a draft from an open window — unwelcome, and unignorable.
        </p>
        <p style={{ fontFamily: FONT_SERIF, fontSize: 18, lineHeight: 1.7, margin: '14px 0 0' }}>
          <span style={{ color: G.parchment }}>Inside, the names were the ones her father had taught her: </span>
          <span style={{
            background: `linear-gradient(180deg, transparent 0%, transparent 30%, ${G.amethyst}55 30%, ${G.amethyst}55 95%, transparent 95%)`,
            color: G.bone, padding: '0 2px', borderRadius: 2,
            boxShadow: `0 0 16px ${G.amethyst}44`,
          }}>the Hollow Shore, the Violet Deep, the country called Uncalm.</span>
          <span style={{ color: G.whisper }}> Places he swore he had walked, though none of them appeared on any map a customs officer could stamp. What she was looking for, she realized at last, was not a place at all.</span>
        </p>
      </div>

      {/* Traveling cursor indicator on margin */}
      <div style={{ position: 'absolute', left: 14, top: 280, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <Sigil kind="moon" size={10} color={G.gold} stroke={1.3}/>
        <div style={{ width: 1, height: 60, background: `linear-gradient(180deg, ${G.gold}, transparent)` }}/>
      </div>

      {/* Bottom glass player */}
      <div style={{
        position: 'absolute', bottom: 20, left: 16, right: 16, padding: 14,
        borderRadius: 20, background: 'rgba(20,17,25,0.85)',
        backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        border: `0.5px solid ${G.ash}`,
        boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BookCover {...book} w={44} h={44} style={{ borderRadius: 8 }}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: G.bone, fontWeight: 600 }}>Voice & text synced</div>
            <div style={{ fontSize: 10, color: G.mist, fontFamily: FONT_MONO, marginTop: 2 }}>04:01:22 · ¶ 142 · sentence 3</div>
          </div>
          <div style={{ width: 40, height: 40, borderRadius: 20,
            background: `linear-gradient(145deg, ${G.violet}, ${G.plum})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 6px 16px ${G.amethyst}66` }}>
            <Icon name="pause" size={14} color={G.bone} sw={2}/>
          </div>
        </div>
        {/* Word-level waveform */}
        <div style={{ marginTop: 12, display: 'flex', gap: 1.5, height: 22, alignItems: 'center' }}>
          {[...Array(44)].map((_, i) => {
            const played = i < 15;
            const current = i === 15;
            const h = 4 + Math.abs(Math.sin(i * 0.7) * 10 + Math.cos(i * 0.3) * 6);
            return <div key={i} style={{
              flex: 1, height: Math.min(h, 18), borderRadius: 1,
              background: current ? G.gold : played ? G.violet : 'rgba(244,239,230,0.14)',
              boxShadow: current ? `0 0 8px ${G.gold}` : 'none',
            }}/>;
          })}
        </div>
      </div>
    </div>
  );
}

function VoicePulse() {
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      {[4, 8, 5, 9, 6].map((h, i) => (
        <div key={i} style={{ width: 2, height: h, borderRadius: 1, background: G.gold }}/>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ONBOARDING — pick your sigil
// ══════════════════════════════════════════════════════════════
function OnboardingScreen() {
  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: G.obsidian, color: G.bone, fontFamily: FONT_SANS,
    }}>
      {/* Ambient glow */}
      <div style={{ position: 'absolute', top: -140, left: '50%', transform: 'translateX(-50%)',
        width: 440, height: 440, borderRadius: '50%',
        background: `radial-gradient(50% 50% at 50% 50%, ${G.plum} 0%, transparent 70%)`, filter: 'blur(40px)', opacity: 0.8 }}/>

      <StatusBar />

      {/* Step indicator */}
      <div style={{ padding: '60px 24px 0', display: 'flex', gap: 6, justifyContent: 'center' }}>
        {[1,2,3,4].map(i => (
          <div key={i} style={{ height: 2, flex: 1, borderRadius: 2, maxWidth: 48,
            background: i <= 2 ? G.violet : 'rgba(244,239,230,0.12)' }}/>
        ))}
      </div>

      <div style={{ padding: '48px 32px 0', textAlign: 'center' }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: G.gold, fontWeight: 700, textTransform: 'uppercase' }}>Step 2 of 4</div>
        <div style={{ fontFamily: FONT_SERIF, fontSize: 34, lineHeight: 1.1, color: G.bone, marginTop: 14, letterSpacing: -0.5, fontWeight: 500, textWrap: 'balance' }}>
          Choose a sigil for your grimoire
        </div>
        <div style={{ fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 15, color: G.pearl, marginTop: 14, lineHeight: 1.5, textWrap: 'balance' }}>
          Your personal mark. Appears beside your notes, your shelves, and the constellations you build.
        </div>
      </div>

      {/* Sigil grid */}
      <div style={{ padding: '36px 32px 0', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {[
          { k: 'moon', n: 'Waning' },
          { k: 'eye', n: 'Seer', active: true },
          { k: 'star', n: 'North' },
          { k: 'sun', n: 'Vesper' },
          { k: 'tri', n: 'Rite' },
          { k: 'circle', n: 'Bound' },
        ].map((s, i) => (
          <div key={i} style={{
            aspectRatio: '1', borderRadius: 16,
            background: s.active ? `linear-gradient(145deg, ${G.plum}, ${G.smoke})` : G.raven,
            border: s.active ? `1px solid ${G.violet}` : `0.5px solid ${G.ash}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
            boxShadow: s.active ? `0 10px 30px ${G.amethyst}33` : 'none',
            position: 'relative',
          }}>
            <Sigil kind={s.k} size={34} color={s.active ? G.gold : G.pearl} stroke={1.3}/>
            <div style={{ fontFamily: FONT_SERIF, fontSize: 13, color: s.active ? G.bone : G.mist, fontStyle: 'italic' }}>{s.n}</div>
            {s.active && <div style={{ position: 'absolute', top: 8, right: 8, width: 14, height: 14, borderRadius: 7, background: G.violet, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={8} color={G.bone} sw={3}/>
            </div>}
          </div>
        ))}
      </div>

      <div style={{ position: 'absolute', bottom: 40, left: 24, right: 24 }}>
        <div style={{ height: 50, borderRadius: 25,
          background: `linear-gradient(145deg, ${G.violet}, ${G.plum})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          fontSize: 15, fontWeight: 600, color: G.bone,
          boxShadow: `0 10px 30px ${G.amethyst}66` }}>
          Continue <Icon name="chev" size={14} color={G.bone} sw={2}/>
        </div>
        <div style={{ textAlign: 'center', fontSize: 13, color: G.mist, marginTop: 16 }}>Skip for now</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// CONSTELLATION — reading stats as stars
// ══════════════════════════════════════════════════════════════
function ConstellationScreen() {
  // Deterministic star positions
  const stars = [];
  for (let i = 0; i < 32; i++) {
    const a = i * 137.5 * Math.PI / 180;
    const r = Math.sqrt(i) * 22 + 20;
    stars.push({ x: 195 + Math.cos(a) * r, y: 230 + Math.sin(a) * r * 0.8, size: 2 + (i % 4), bright: i % 5 === 0 });
  }
  // Lines between a few constellation members
  const lines = [[0,3], [3,7], [7,12], [12,18], [5,10], [10,15], [15,22], [2,8], [8,14]];

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: G.ink, color: G.bone, fontFamily: FONT_SANS,
    }}>
      <StatusBar />

      {/* Header */}
      <div style={{ padding: '56px 24px 0' }}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: G.gold, textTransform: 'uppercase', fontWeight: 700 }}>Year of 2026</div>
        <div style={{ fontFamily: FONT_SERIF, fontSize: 34, fontWeight: 500, color: G.bone, lineHeight: 1, letterSpacing: -0.5, marginTop: 6 }}>Your Constellation</div>
        <div style={{ fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 15, color: G.pearl, marginTop: 10 }}>32 tomes finished — a minor house.</div>
      </div>

      {/* Sky */}
      <div style={{ margin: '24px 24px 0', height: 340, borderRadius: 24, overflow: 'hidden',
        background: `radial-gradient(80% 60% at 50% 30%, #1a1130 0%, ${G.ink} 80%)`,
        border: `0.5px solid ${G.ash}`,
        position: 'relative' }}>
        <svg width="100%" height="100%" viewBox="0 0 390 340" style={{ position: 'absolute', inset: 0 }}>
          {/* connector lines */}
          {lines.map(([a, b], i) => {
            const sa = stars[a], sb = stars[b]; if (!sa || !sb) return null;
            return <line key={i} x1={sa.x} y1={sa.y - 20} x2={sb.x} y2={sb.y - 20} stroke={G.gold} strokeWidth="0.4" opacity="0.4"/>;
          })}
          {/* stars */}
          {stars.map((s, i) => (
            <g key={i}>
              {s.bright && <circle cx={s.x} cy={s.y - 20} r={s.size + 4} fill={G.gold} opacity="0.15"/>}
              <circle cx={s.x} cy={s.y - 20} r={s.size * 0.6} fill={s.bright ? G.gold : G.bone} opacity={s.bright ? 1 : 0.7}/>
            </g>
          ))}
        </svg>
        {/* Label callout */}
        <div style={{ position: 'absolute', bottom: 14, left: 14, padding: '8px 12px', borderRadius: 8,
          background: 'rgba(8,7,11,0.7)', backdropFilter: 'blur(10px)',
          border: `0.5px solid ${G.ash}` }}>
          <div style={{ fontSize: 9, letterSpacing: 1.5, color: G.gold, fontWeight: 700 }}>HOUSE OF FERRYMEN</div>
          <div style={{ fontFamily: FONT_SERIF, fontSize: 13, color: G.bone, fontStyle: 'italic', marginTop: 2 }}>Fantasy · 12 tomes</div>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ padding: '20px 24px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <StatCard big="184h" small="heard" sigil="moon"/>
        <StatCard big="12,408" small="pages read" sigil="eye"/>
        <StatCard big="32" small="tomes finished" sigil="star"/>
        <StatCard big="61" small="night streak" sigil="sun"/>
      </div>

      <div style={{ padding: '18px 24px 0', fontSize: 11, letterSpacing: 2, color: G.mist, fontWeight: 700, textTransform: 'uppercase' }}>Houses this year</div>
      <div style={{ padding: '10px 24px 30px', display: 'flex', gap: 10, overflowX: 'auto' }}>
        {[
          { name: 'Fantasy', n: 12, sigil: 'rune' },
          { name: 'Literary', n: 9, sigil: 'moon' },
          { name: 'Sci-Fi', n: 6, sigil: 'circle' },
          { name: 'Poetry', n: 5, sigil: 'star' },
        ].map(h => (
          <div key={h.name} style={{ flexShrink: 0, padding: '12px 14px', borderRadius: 12,
            background: G.raven, border: `0.5px solid ${G.ash}`, minWidth: 130 }}>
            <Sigil kind={h.sigil} size={16} color={G.gold} stroke={1.3}/>
            <div style={{ fontFamily: FONT_SERIF, fontSize: 15, color: G.bone, marginTop: 10 }}>{h.name}</div>
            <div style={{ fontSize: 10, color: G.mist, fontFamily: FONT_MONO, marginTop: 2 }}>{h.n} tomes</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ big, small, sigil }) {
  return (
    <div style={{ padding: 16, borderRadius: 14,
      background: G.raven, border: `0.5px solid ${G.ash}`,
      display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontFamily: FONT_SERIF, fontSize: 28, color: G.bone, fontWeight: 500, letterSpacing: -0.5, lineHeight: 1 }}>{big}</div>
        <Sigil kind={sigil} size={14} color={G.gold} stroke={1.3}/>
      </div>
      <div style={{ fontSize: 10, color: G.mist, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 600 }}>{small}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SLEEP TIMER — bottom sheet
// ══════════════════════════════════════════════════════════════
function SleepTimerScreen() {
  const book = BOOKS.atlas;
  const times = ['End of sentence', 'End of chapter', '10 min', '15 min', '25 min', '45 min', '1 hour', 'Until dawn'];
  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: G.obsidian, color: G.bone, fontFamily: FONT_SANS,
    }}>
      {/* Dimmed player below */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.35 }}>
        <PlayerScreen/>
      </div>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(8,7,11,0.65)', backdropFilter: 'blur(8px)' }}/>

      {/* Sheet */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        borderRadius: '28px 28px 0 0',
        background: `linear-gradient(180deg, ${G.smoke} 0%, ${G.raven} 100%)`,
        borderTop: `0.5px solid ${G.ash}`,
        boxShadow: '0 -30px 80px rgba(0,0,0,0.6)',
        padding: '14px 24px 40px',
      }}>
        {/* handle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <div style={{ width: 44, height: 4, borderRadius: 2, background: G.ash }}/>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <Icon name="moon" size={22} color={G.gold}/>
          <div>
            <div style={{ fontFamily: FONT_SERIF, fontSize: 22, color: G.bone, fontWeight: 500, letterSpacing: -0.3 }}>Until Dawn</div>
            <div style={{ fontSize: 11, color: G.mist }}>Fade to silence gently</div>
          </div>
        </div>

        <div style={{ margin: '18px 0 6px', fontSize: 10, letterSpacing: 2, color: G.mist, fontWeight: 700, textTransform: 'uppercase' }}>When to stop</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {times.map((t, i) => {
            const active = i === 4;
            const poetic = i < 2;
            return <div key={t} style={{
              height: 54, borderRadius: 12, padding: '0 14px',
              background: active ? 'rgba(139,92,246,0.15)' : G.obsidian,
              border: `0.5px solid ${active ? 'rgba(139,92,246,0.4)' : G.ash}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              color: active ? G.bone : G.pearl,
            }}>
              <span style={{
                fontFamily: poetic ? FONT_SERIF : FONT_SANS,
                fontStyle: poetic ? 'italic' : 'normal',
                fontSize: poetic ? 15 : 14, fontWeight: active ? 600 : 500,
              }}>{t}</span>
              {active && <Sigil kind="moon" size={12} color={G.gold} stroke={1.3}/>}
            </div>;
          })}
        </div>

        {/* Fade toggle */}
        <div style={{ marginTop: 18, padding: '14px 16px', borderRadius: 12,
          background: G.obsidian, border: `0.5px solid ${G.ash}`,
          display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: G.bone, fontWeight: 600 }}>Fade voice to a whisper</div>
            <div style={{ fontSize: 11, color: G.mist, marginTop: 2 }}>Last 90 seconds soften to silence</div>
          </div>
          <div style={{ width: 44, height: 26, borderRadius: 13, background: G.violet, padding: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: 22, height: 22, borderRadius: 11, background: G.bone, boxShadow: '0 2px 4px rgba(0,0,0,0.3)' }}/>
          </div>
        </div>

        <div style={{ marginTop: 18, height: 50, borderRadius: 25,
          background: `linear-gradient(145deg, ${G.violet}, ${G.plum})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 600, color: G.bone,
          boxShadow: `0 10px 30px ${G.amethyst}55` }}>
          Begin timer · 25 min
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// HIGHLIGHTS DRAWER — personal grimoire of passages
// ══════════════════════════════════════════════════════════════
function HighlightsScreen() {
  const book = BOOKS.atlas;
  const highlights = [
    { q: 'What she was looking for, she realized at last, was not a place at all but a sentence her father had never finished.', ch: 'Ch. 7', p: 142, note: 'This is the whole book.', date: 'Tonight' },
    { q: 'Her mother, from the next room, began to hum it without knowing.', ch: 'Ch. 7', p: 143, date: 'Tonight' },
    { q: 'I am being taught something I was not supposed to learn yet.', ch: 'Ch. 7', p: 144, note: 'For the tattoo list.', date: 'Tonight' },
    { q: 'Uncalm — a country not on any map a customs officer could stamp.', ch: 'Ch. 3', p: 62, date: '3 days ago' },
  ];
  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative', overflow: 'hidden',
      background: G.obsidian, color: G.bone, fontFamily: FONT_SANS,
    }}>
      <StatusBar />

      <div style={{ padding: '56px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, color: G.gold, fontWeight: 700, textTransform: 'uppercase' }}>Marginalia</div>
          <div style={{ fontFamily: FONT_SERIF, fontSize: 30, fontWeight: 500, color: G.bone, letterSpacing: -0.4, lineHeight: 1, marginTop: 6 }}>Your Grimoire</div>
        </div>
        <Icon name="filter" size={18} color={G.pearl}/>
      </div>

      {/* Book context */}
      <div style={{ margin: '20px 24px 0', padding: 12, borderRadius: 14,
        background: G.raven, border: `0.5px solid ${G.ash}`,
        display: 'flex', gap: 12, alignItems: 'center' }}>
        <BookCover {...book} w={40} h={60} style={{ borderRadius: 4 }}/>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT_SERIF, fontSize: 14, color: G.bone }}>{book.title}</div>
          <div style={{ fontSize: 10, color: G.mist, marginTop: 2, fontFamily: FONT_MONO }}>14 highlights · 3 notes</div>
        </div>
        <Icon name="chev" size={14} color={G.mist}/>
      </div>

      {/* Highlights list */}
      <div style={{ padding: '18px 24px 30px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {highlights.map((h, i) => (
          <div key={i} style={{ position: 'relative', padding: '16px 16px 14px 20px', borderRadius: 14,
            background: G.raven, border: `0.5px solid ${G.ash}` }}>
            {/* Gold rule */}
            <div style={{ position: 'absolute', left: 0, top: 14, bottom: 14, width: 2, borderRadius: 1, background: G.gold, boxShadow: `0 0 6px ${G.gold}` }}/>

            <div style={{ fontFamily: FONT_SERIF, fontSize: 16, lineHeight: 1.45, color: G.parchment, fontStyle: 'italic' }}>
              "{h.q}"
            </div>

            {h.note && (
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8,
                background: 'rgba(139,92,246,0.08)', border: `0.5px solid rgba(139,92,246,0.2)`,
                display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <Sigil kind="eye" size={11} color={G.violet} stroke={1.4}/>
                <div style={{ fontSize: 12, color: G.bone, lineHeight: 1.4 }}>{h.note}</div>
              </div>
            )}

            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10,
              fontSize: 10, fontFamily: FONT_MONO, color: G.mist, letterSpacing: 0.3 }}>
              <span style={{ color: G.gold }}>{h.ch}</span>
              <span>p. {h.p}</span>
              <span style={{ width: 2, height: 2, borderRadius: 1, background: G.whisper }}/>
              <span>{h.date}</span>
              <div style={{ flex: 1 }}/>
              <Icon name="share" size={11} color={G.mist}/>
              <Icon name="more" size={11} color={G.mist}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { FollowAlongScreen, OnboardingScreen, ConstellationScreen, SleepTimerScreen, HighlightsScreen });
