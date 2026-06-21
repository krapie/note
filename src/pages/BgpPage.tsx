import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type Dir = 'a2b' | 'b2a'
type Hi  = 'adjOut' | 'adjIn' | 'locRib' | 'fib'

interface Entry { prefix: string; attrs: string }

interface RouterState {
  adjOut?: Entry[]
  adjIn?:  Entry[]
  locRib?: Entry[]
  fib?:    Entry[]
}

interface BgpFrame {
  ra:      RouterState
  rb:      RouterState
  raHi?:   Hi
  rbHi?:   Hi
  msg?:    { dir: Dir; label: string }
  ibgp?:   boolean
  ibgpLink?: 'rc' | 'rd'
  rc?:     RouterState
  rd?:     RouterState
  rcHi?:   Hi
  rdHi?:   Hi
}

// ── Static route data ─────────────────────────────────────────────────────────

const RA_OUT: Entry[] = [{ prefix: '10.1.0.0/24', attrs: 'path [65001]  nh 192.168.1.1  origin IGP' }]
const RA_FIB: Entry[] = [{ prefix: '10.2.0.0/24', attrs: 'via 192.168.1.2' }]
const RB_ADJ: Entry[] = [{ prefix: '10.1.0.0/24', attrs: 'path [65001]  nh 192.168.1.1' }]
const RB_LOC: Entry[] = [{ prefix: '10.1.0.0/24', attrs: 'path [65001]  nh 192.168.1.1  locpref 100' }]
const RB_FIB: Entry[] = [{ prefix: '10.1.0.0/24', attrs: 'via 192.168.1.1' }]
const RC_ADJ: Entry[] = [{ prefix: '10.1.0.0/24', attrs: 'path [65001]  nh 192.168.1.1  locpref 100' }]
const RC_FIB: Entry[] = [{ prefix: '10.1.0.0/24', attrs: 'via → R-B  (IGP recursive)' }]

const FRAMES: BgpFrame[] = [
  // 0 — session up, tables empty
  { ra: { adjOut: RA_OUT, fib: [] }, rb: { adjIn: [], locRib: [], fib: [] } },
  // 1 — R-A sends UPDATE → R-B Adj-RIB-In
  { msg: { dir: 'a2b', label: 'UPDATE 10.1.0.0/24' },
    ra: { adjOut: RA_OUT, fib: [] },
    rb: { adjIn: RB_ADJ, locRib: [], fib: [] }, rbHi: 'adjIn' },
  // 2 — best-path → Loc-RIB
  { ra: { adjOut: RA_OUT, fib: [] },
    rb: { adjIn: RB_ADJ, locRib: RB_LOC, fib: [] }, rbHi: 'locRib' },
  // 3 — push to FIB
  { ra: { adjOut: RA_OUT, fib: [] },
    rb: { adjIn: RB_ADJ, locRib: RB_LOC, fib: RB_FIB }, rbHi: 'fib' },
  // 4 — R-B advertises back → R-A FIB
  { msg: { dir: 'b2a', label: 'UPDATE 10.2.0.0/24' },
    ra: { adjOut: RA_OUT, fib: RA_FIB }, raHi: 'fib',
    rb: { adjIn: RB_ADJ, locRib: RB_LOC, fib: RB_FIB } },
  // 5 — iBGP R-B → R-C
  { ibgp: true, ibgpLink: 'rc',
    ra: { adjOut: RA_OUT, fib: RA_FIB }, rb: { adjIn: RB_ADJ, locRib: RB_LOC, fib: RB_FIB },
    rc: { adjIn: RC_ADJ, fib: [] }, rcHi: 'adjIn',
    rd: { adjIn: [], fib: [] } },
  // 6 — R-C FIB
  { ibgp: true,
    ra: { adjOut: RA_OUT, fib: RA_FIB }, rb: { adjIn: RB_ADJ, locRib: RB_LOC, fib: RB_FIB },
    rc: { adjIn: RC_ADJ, fib: RC_FIB }, rcHi: 'fib',
    rd: { adjIn: [], fib: [] } },
  // 7 — iBGP R-B → R-D
  { ibgp: true, ibgpLink: 'rd',
    ra: { adjOut: RA_OUT, fib: RA_FIB }, rb: { adjIn: RB_ADJ, locRib: RB_LOC, fib: RB_FIB },
    rc: { adjIn: RC_ADJ, fib: RC_FIB },
    rd: { adjIn: RC_ADJ, fib: [] }, rdHi: 'adjIn' },
  // 8 — R-D FIB
  { ibgp: true,
    ra: { adjOut: RA_OUT, fib: RA_FIB }, rb: { adjIn: RB_ADJ, locRib: RB_LOC, fib: RB_FIB },
    rc: { adjIn: RC_ADJ, fib: RC_FIB },
    rd: { adjIn: RC_ADJ, fib: RC_FIB }, rdHi: 'fib' },
  // 9 — convergence complete
  { ibgp: true,
    ra: { adjOut: RA_OUT, fib: RA_FIB }, rb: { adjIn: RB_ADJ, locRib: RB_LOC, fib: RB_FIB },
    rc: { adjIn: RC_ADJ, fib: RC_FIB },
    rd: { adjIn: RC_ADJ, fib: RC_FIB } },
]

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title: 'BGP route advertisement and propagation',
    readTime: '5 min',
    intro: 'How two eBGP peers in different ASes advertise prefixes and install them through the Adj-RIB-In → Loc-RIB → FIB pipeline — then how the border router propagates those routes to internal iBGP peers.',
    adjOut: 'Adj-RIB-Out', adjOutSub: 'advertised to peer',
    adjIn:  'Adj-RIB-In',  adjInSub:  'raw · from peer',
    locRib: 'Loc-RIB',     locSub:    'best-path selected',
    fib:    'FIB',          fibSub:    'kernel · forwarding',
    empty: '—',
    border: 'border', internal: 'internal',
    ibgpTitle: 'iBGP propagation within AS65002',
    frames: [
      { title: 'eBGP session up — tables empty',
        note: 'R-A (AS65001) and R-B (AS65002) have established an eBGP TCP session. R-A has 10.1.0.0/24 in its Adj-RIB-Out — ready to advertise. All R-B tables are empty. No routes exchanged yet.' },
      { title: 'R-A advertises 10.1.0.0/24 → Adj-RIB-In',
        note: 'R-A sends a BGP UPDATE: NLRI = 10.1.0.0/24, AS_PATH [65001], NEXT_HOP 192.168.1.1, ORIGIN IGP. R-B receives it and stores it in Adj-RIB-In — the raw receive table, before any import policy or best-path processing.' },
      { title: 'Best-path selection → Loc-RIB',
        note: 'Only one path candidate for 10.1.0.0/24, so it wins automatically. Any import policy (route-maps, prefix-lists) runs before this step. The route is now in Loc-RIB — the BGP decision table.' },
      { title: 'Best path pushed to FIB',
        note: 'The winner in Loc-RIB is installed into the FIB (kernel routing table). R-B can now forward packets destined to 10.1.0.0/24 via 192.168.1.1 (R-A\'s link address). Hardware forwarding is active.' },
      { title: 'R-B advertises 10.2.0.0/24 → R-A FIB',
        note: 'R-B sends its own prefix back to R-A: UPDATE 10.2.0.0/24, AS_PATH [65002], NEXT_HOP 192.168.1.2. R-A runs the same Adj-RIB-In → Loc-RIB → FIB pipeline. The eBGP session is now fully bidirectional.' },
      { title: 'iBGP: R-B sends UPDATE to R-C',
        note: 'R-B propagates 10.1.0.0/24 to internal peer R-C via iBGP. Key difference from eBGP: NEXT_HOP is preserved as 192.168.1.1 (R-A\'s address) — not replaced with R-B\'s. R-C must resolve that next-hop via IGP (OSPF/IS-IS).' },
      { title: 'R-C installs via recursive next-hop',
        note: 'R-C\'s FIB can\'t use 192.168.1.1 directly — it\'s not directly connected. Recursive lookup: BGP NEXT_HOP 192.168.1.1 → IGP route → R-B interface. FIB entry: 10.1.0.0/24 via R-B.' },
      { title: 'iBGP: R-B sends UPDATE to R-D',
        note: 'R-B sends the same iBGP UPDATE to R-D. iBGP requires a full-mesh by default: every iBGP speaker must peer directly with every other (N(N-1)/2 sessions at scale). Route Reflectors eliminate the full-mesh requirement.' },
      { title: 'R-D installs via recursive next-hop',
        note: 'R-D performs the same recursive next-hop lookup: 192.168.1.1 → IGP → R-B. Route installed in R-D\'s FIB.' },
      { title: 'Full convergence — AS65002',
        note: 'All routers in AS65002 have 10.1.0.0/24 in their FIB. Traffic from any internal router: → IGP toward R-B → eBGP link → R-A. The iBGP NEXT_HOP (192.168.1.1) is never in the IGP — always resolved recursively at each router.' },
    ],
  },
  ko: {
    title: 'BGP 경로 광고와 전파',
    readTime: '5분',
    intro: '서로 다른 AS의 두 eBGP 피어가 프리픽스를 광고하고 Adj-RIB-In → Loc-RIB → FIB 파이프라인을 통해 설치하는 과정 — 이후 경계 라우터가 iBGP를 통해 내부 피어에 경로를 전파하는 흐름.',
    adjOut: 'Adj-RIB-Out', adjOutSub: '피어에게 광고',
    adjIn:  'Adj-RIB-In',  adjInSub:  '원시 · 피어 수신',
    locRib: 'Loc-RIB',     locSub:    '최적 경로 선택',
    fib:    'FIB',          fibSub:    '커널 · 포워딩',
    empty: '—',
    border: '경계', internal: '내부',
    ibgpTitle: 'AS65002 내부 iBGP 전파',
    frames: [
      { title: 'eBGP 세션 수립 — 테이블 비어 있음',
        note: 'R-A(AS65001)와 R-B(AS65002) 간 eBGP TCP 세션 수립. R-A는 Adj-RIB-Out에 10.1.0.0/24를 보유 — 광고 준비 완료. R-B의 모든 테이블은 비어 있습니다. 아직 경로 교환 없음.' },
      { title: 'R-A가 10.1.0.0/24 광고 → Adj-RIB-In',
        note: 'R-A가 BGP UPDATE 전송: NLRI = 10.1.0.0/24, AS_PATH [65001], NEXT_HOP 192.168.1.1, ORIGIN IGP. R-B는 이를 Adj-RIB-In에 저장 — Import 정책 및 최적 경로 처리 이전의 원시 수신 테이블입니다.' },
      { title: '최적 경로 선택 → Loc-RIB',
        note: '10.1.0.0/24 후보가 하나뿐이므로 자동으로 선택됩니다. Import 정책(route-map, prefix-list)은 이 단계 이전에 실행됩니다. 경로가 Loc-RIB — BGP 결정 테이블에 설치됩니다.' },
      { title: '최적 경로를 FIB로 푸시',
        note: 'Loc-RIB의 최적 경로가 FIB(커널 라우팅 테이블)에 설치됩니다. R-B는 이제 10.1.0.0/24 목적지 패킷을 192.168.1.1(R-A의 링크 주소)로 포워딩할 수 있습니다.' },
      { title: 'R-B가 10.2.0.0/24 광고 → R-A FIB',
        note: 'R-B가 자신의 프리픽스를 R-A에게 광고: UPDATE 10.2.0.0/24, AS_PATH [65002], NEXT_HOP 192.168.1.2. R-A는 동일한 Adj-RIB-In → Loc-RIB → FIB 파이프라인을 처리합니다. eBGP 세션이 완전한 양방향으로 동작합니다.' },
      { title: 'iBGP: R-B가 R-C에게 UPDATE 전송',
        note: 'R-B가 iBGP를 통해 내부 피어 R-C에게 10.1.0.0/24를 전파합니다. eBGP와의 핵심 차이: NEXT_HOP이 192.168.1.1(R-A의 주소)로 유지됨 — R-B의 주소로 교체되지 않습니다. R-C는 IGP(OSPF/IS-IS)를 통해 해당 next-hop을 해석해야 합니다.' },
      { title: 'R-C: 재귀 next-hop으로 FIB 설치',
        note: 'R-C는 192.168.1.1을 직접 사용할 수 없음 — 직접 연결되지 않았습니다. 재귀 룩업: BGP NEXT_HOP 192.168.1.1 → IGP 경로 → R-B 인터페이스. FIB 항목: 10.1.0.0/24 via R-B.' },
      { title: 'iBGP: R-B가 R-D에게 UPDATE 전송',
        note: 'R-B가 동일한 iBGP UPDATE를 R-D에게 전송합니다. iBGP는 기본적으로 완전 메시가 필요합니다: 모든 iBGP 스피커가 서로 직접 피어링해야 합니다(대규모 시 N(N-1)/2 세션). Route Reflector가 이 문제를 해결합니다.' },
      { title: 'R-D: 재귀 next-hop으로 FIB 설치',
        note: 'R-D도 동일한 재귀 next-hop 룩업 수행: 192.168.1.1 → IGP → R-B. 경로가 R-D의 FIB에 설치됩니다.' },
      { title: '완전 수렴 — AS65002',
        note: 'AS65002의 모든 라우터가 FIB에 10.1.0.0/24를 보유합니다. 내부 라우터의 트래픽 경로: → IGP를 통해 R-B로 → eBGP 링크 → R-A. iBGP NEXT_HOP(192.168.1.1)은 IGP에 없으며 각 라우터에서 재귀적으로 해석됩니다.' },
    ],
  },
}

// ── Components ─────────────────────────────────────────────────────────────────

function RtrTable({ name, sub, entries, hi, empty }: {
  name: string; sub: string; entries?: Entry[]; hi?: boolean; empty: string
}) {
  const ents = entries ?? []
  return (
    <div className={`bgp2-table${hi ? ' bgp2-table-hi' : ''}`}>
      <div className="bgp2-table-head">
        <span className="bgp2-table-name">{name}</span>
        <span className="bgp2-table-sub">{sub}</span>
      </div>
      <div className="bgp2-table-body">
        {ents.length === 0
          ? <span className="bgp2-table-empty">{empty}</span>
          : ents.map((e, i) => (
              <div key={i} className="bgp2-table-row">
                <code className="bgp2-prefix">{e.prefix}</code>
                <span className="bgp2-attrs">{e.attrs}</span>
              </div>
            ))}
      </div>
    </div>
  )
}

function RtrHead({ name, asn, role }: { name: string; asn: string; role?: string }) {
  return (
    <div className="bgp2-router-head">
      <span className="bgp2-router-name">{name}</span>
      <code className="bgp2-router-asn">{asn}</code>
      {role && <span className="bgp2-router-role">{role}</span>}
    </div>
  )
}

function useExplorer(length: number) {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [animKey, setAnimKey] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLast = step >= length - 1

  useEffect(() => {
    if (!playing) return
    if (isLast) { setPlaying(false); return }
    timerRef.current = setTimeout(() => { setStep(s => s + 1); setAnimKey(k => k + 1) }, 1100)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [playing, step, isLast])

  const reset    = () => { setPlaying(false); setStep(0); setAnimKey(k => k + 1) }
  const stepFwd  = () => { if (!isLast) { setStep(s => s + 1); setAnimKey(k => k + 1) } }
  const handlePlay = () => {
    if (isLast) { reset(); setTimeout(() => setPlaying(true), 50); return }
    setPlaying(p => !p)
  }
  return { step, playing, animKey, isLast, reset, stepFwd, handlePlay, length }
}

function ExplorerControls({ ex }: { ex: ReturnType<typeof useExplorer> }) {
  const { step, playing, isLast, length, reset, stepFwd, handlePlay } = ex
  const { lang } = useLang()
  const lbl = {
    reset:  lang === 'ko' ? '초기화'    : 'Reset',
    play:   lang === 'ko' ? '재생'      : 'Play',
    pause:  lang === 'ko' ? '일시정지'  : 'Pause',
    resume: lang === 'ko' ? '계속'      : 'Resume',
    replay: lang === 'ko' ? '다시 보기' : 'Replay',
    step:   lang === 'ko' ? '다음 →'   : 'Step →',
  }
  return (
    <>
      <div className="tcp-controls">
        <button className="btn-secondary" onClick={reset}>{lbl.reset}</button>
        <button className="btn-primary" onClick={handlePlay}>
          {playing ? lbl.pause : isLast ? lbl.replay : step === 0 ? lbl.play : lbl.resume}
        </button>
        <button className="btn-secondary" onClick={stepFwd} disabled={playing || isLast}>{lbl.step}</button>
      </div>
      <div className="tcp-progress">
        <div className="tcp-progress-fill" style={{ width: `${(step / (length - 1)) * 100}%` }} />
      </div>
    </>
  )
}

// ── eBGP layout ────────────────────────────────────────────────────────────────

function EbgpLayout({ frame, animKey, t }: { frame: BgpFrame; animKey: number; t: typeof T['en'] }) {
  return (
    <div className="bgp2-ebgp-layout">
      {/* R-A */}
      <div className="bgp2-router">
        <RtrHead name="R-A" asn="AS65001" />
        <RtrTable name={t.adjOut} sub={t.adjOutSub} entries={frame.ra.adjOut} hi={frame.raHi === 'adjOut'} empty={t.empty} />
        <RtrTable name={t.fib}    sub={t.fibSub}    entries={frame.ra.fib}    hi={frame.raHi === 'fib'}    empty={t.empty} />
      </div>

      {/* Message lane */}
      <div className="bgp2-msg-lane">
        <span className="bgp2-session-tag">eBGP</span>
        <div className="bgp2-session-line" />
        {frame.msg && (
          <div className="bgp2-msg" key={`msg-${animKey}`}>
            <span className="bgp2-msg-pill">
              {frame.msg.dir === 'a2b' ? '→ ' : '← '}{frame.msg.label}
            </span>
          </div>
        )}
        <div className="bgp2-session-line" />
      </div>

      {/* R-B */}
      <div className="bgp2-router">
        <RtrHead name="R-B" asn="AS65002" />
        <RtrTable name={t.adjIn}  sub={t.adjInSub} entries={frame.rb.adjIn}  hi={frame.rbHi === 'adjIn'}  empty={t.empty} />
        <RtrTable name={t.locRib} sub={t.locSub}   entries={frame.rb.locRib} hi={frame.rbHi === 'locRib'} empty={t.empty} />
        <RtrTable name={t.fib}    sub={t.fibSub}   entries={frame.rb.fib}    hi={frame.rbHi === 'fib'}    empty={t.empty} />
      </div>
    </div>
  )
}

// ── iBGP layout ────────────────────────────────────────────────────────────────

function IbgpLayout({ frame, animKey, t }: { frame: BgpFrame; animKey: number; t: typeof T['en'] }) {
  const rcActive = frame.ibgpLink === 'rc'
  const rdActive = frame.ibgpLink === 'rd'
  return (
    <div className="bgp2-ibgp-layout">
      {/* R-B — border router */}
      <div className="bgp2-router bgp2-router-border">
        <RtrHead name="R-B" asn="AS65002" role={t.border} />
        <RtrTable name={t.adjIn}  sub={t.adjInSub} entries={frame.rb.adjIn}  empty={t.empty} />
        <RtrTable name={t.locRib} sub={t.locSub}   entries={frame.rb.locRib} empty={t.empty} />
        <RtrTable name={t.fib}    sub={t.fibSub}   entries={frame.rb.fib}    empty={t.empty} />
      </div>

      {/* iBGP link lanes */}
      <div className="bgp2-ibgp-lanes">
        <div className={`bgp2-ibgp-link${rcActive ? ' bgp2-ibgp-link-active' : ''}`}>
          <div className="bgp2-ibgp-link-line">
            {rcActive && <div className="bgp-ibgp-dot" key={`rc-${animKey}`} />}
          </div>
          <span className="bgp2-ibgp-tag">iBGP</span>
        </div>
        <div className={`bgp2-ibgp-link${rdActive ? ' bgp2-ibgp-link-active' : ''}`}>
          <div className="bgp2-ibgp-link-line">
            {rdActive && <div className="bgp-ibgp-dot" key={`rd-${animKey}`} />}
          </div>
          <span className="bgp2-ibgp-tag">iBGP</span>
        </div>
      </div>

      {/* R-C and R-D */}
      <div className="bgp2-ibgp-targets">
        <div className="bgp2-ibgp-target">
          <RtrHead name="R-C" asn="AS65002" role={t.internal} />
          <RtrTable name={t.adjIn} sub={t.adjInSub} entries={frame.rc?.adjIn} hi={frame.rcHi === 'adjIn'} empty={t.empty} />
          <RtrTable name={t.fib}   sub={t.fibSub}   entries={frame.rc?.fib}   hi={frame.rcHi === 'fib'}   empty={t.empty} />
        </div>
        <div className="bgp2-ibgp-target">
          <RtrHead name="R-D" asn="AS65002" role={t.internal} />
          <RtrTable name={t.adjIn} sub={t.adjInSub} entries={frame.rd?.adjIn} hi={frame.rdHi === 'adjIn'} empty={t.empty} />
          <RtrTable name={t.fib}   sub={t.fibSub}   entries={frame.rd?.fib}   hi={frame.rdHi === 'fib'}   empty={t.empty} />
        </div>
      </div>
    </div>
  )
}

// ── Main explorer ──────────────────────────────────────────────────────────────

function BgpExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const ex = useExplorer(FRAMES.length)
  const { step, animKey } = ex
  const frame = FRAMES[step]
  const ft = t.frames[step]
  const isIbgp = !!frame.ibgp

  return (
    <div className="bgp-explorer">
      <div className="bgp2-phases">
        <span className={`bgp2-phase-pill${!isIbgp ? ' active' : ''}`}>eBGP</span>
        <span className="bgp2-phase-sep">→</span>
        <span className={`bgp2-phase-pill${isIbgp ? ' active' : ''}`}>iBGP</span>
      </div>

      {isIbgp
        ? <IbgpLayout frame={frame} animKey={animKey} t={t} />
        : <EbgpLayout frame={frame} animKey={animKey} t={t} />
      }

      <ExplorerControls ex={ex} />

      <div className="bgp2-detail">
        <div className="bgp2-detail-title">{ft.title}</div>
        <p className="bgp2-detail-body">{ft.note}</p>
        <span className="tcp-step-counter">{step + 1} / {FRAMES.length}</span>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BgpPage() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-06-21"
      readTime={t.readTime}
      tags={['networking', 'bgp', 'routing']}
      intro={t.intro}
    >
      <div className="bgp-root">
        <BgpExplorer />
      </div>
    </NoteLayout>
  )
}
