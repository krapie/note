import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

type Dir = 'a2b' | 'b2a'
type InternalStatus = 'none' | 'received' | 'installed'

interface BgpMsg { dir: Dir; label: string }
interface RibEntry { prefix: string; aspath: string; nexthop: string }
interface FibEntry { prefix: string; via: string }

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title: 'BGP route advertisement and propagation',
    readTime: '5 min',
    intro: 'How two eBGP peers in different ASes advertise prefixes and install them through the Adj-RIB-In → Loc-RIB → FIB pipeline — then how the border router propagates those routes to internal iBGP peers.',
    sectionEbgp: 'eBGP route advertisement',
    ribLabel: 'R-B routing tables',
    ibgpLabel: 'iBGP propagation (AS65002)',
    adjSub: 'raw · from peer',
    locSub: 'best-path · BGP table',
    fibSub: 'kernel · forwarding',
    empty: 'empty',
    noRoute: 'no route',
    received: 'received',
    borderRouter: 'border router',
    internal: 'internal',
    frames: [
      { annotation: 'eBGP session established between R-A (AS65001) and R-B (AS65002). Both routing tables are empty — initial UPDATE exchange begins.' },
      { note: 'R-A advertises its prefix 10.1.0.0/24. The UPDATE carries: NLRI (the prefix), AS_PATH [65001], NEXT_HOP 192.168.1.1, ORIGIN IGP. R-B stores it in Adj-RIB-In — the raw receive table before any import policy or best-path processing.' },
      { annotation: 'Best-path selection: only one candidate for 10.1.0.0/24, so it wins automatically. Any import policy (route-maps, prefix-lists) runs before this step. Route installed in Loc-RIB.' },
      { annotation: 'Best path pushed from Loc-RIB to FIB (kernel routing table). Hardware forwarding for 10.1.0.0/24 via 192.168.1.1 is now active on R-B.' },
      { note: 'R-B advertises its own prefix 10.2.0.0/24 back to R-A: AS_PATH [65002], NEXT_HOP 192.168.1.2. R-A runs the same Adj-RIB-In → Loc-RIB → FIB pipeline on its side. The session is now fully bidirectional.' },
      { annotation: 'iBGP phase begins. R-B sends an iBGP UPDATE to R-C: { prefix: 10.1.0.0/24, AS_PATH: [65001], NEXT_HOP: 192.168.1.1, LOCAL_PREF: 100 }. Critical difference from eBGP: NEXT_HOP is preserved as R-A\'s address — not replaced with R-B\'s. R-C must resolve 192.168.1.1 via its IGP (OSPF/IS-IS), which points to R-B as the outbound interface.' },
      { annotation: 'R-C installs 10.1.0.0/24 via recursive next-hop lookup: BGP NEXT_HOP 192.168.1.1 → IGP route → R-B\'s interface. Traffic path: R-C → (IGP toward R-B) → R-B → (eBGP link) → R-A.' },
      { annotation: 'R-B sends the same iBGP UPDATE to R-D. iBGP requires full-mesh peering: every iBGP speaker must peer directly with every other — N(N−1)/2 sessions at scale. Route Reflectors solve this: a single RR redistributes to all clients, eliminating the full-mesh requirement.' },
      { annotation: 'R-D installs 10.1.0.0/24 via IGP-resolved next-hop → R-B. All routers in AS65002 have converged.' },
      { annotation: 'Convergence complete. Any router in AS65002 can now forward traffic to 10.1.0.0/24 in AS65001. The iBGP NEXT_HOP (192.168.1.1) is not in the IGP — it is resolved recursively at each router using the IGP table.' },
    ] as Array<{ annotation: string } | { note: string }>,
  },
  ko: {
    title: 'BGP 경로 광고와 전파',
    readTime: '5분',
    intro: '서로 다른 AS의 두 eBGP 피어가 프리픽스를 광고하고 Adj-RIB-In → Loc-RIB → FIB 파이프라인을 통해 설치하는 과정 — 이후 경계 라우터가 iBGP를 통해 내부 피어에 경로를 전파하는 흐름.',
    sectionEbgp: 'eBGP 경로 광고',
    ribLabel: 'R-B 라우팅 테이블',
    ibgpLabel: 'iBGP 전파 (AS65002)',
    adjSub: '원시 · 피어 수신',
    locSub: '최적 경로 · BGP 테이블',
    fibSub: '커널 · 포워딩',
    empty: '비어 있음',
    noRoute: '경로 없음',
    received: '수신됨',
    borderRouter: '경계 라우터',
    internal: '내부',
    frames: [
      { annotation: 'R-A(AS65001)와 R-B(AS65002) 간 eBGP 세션 수립. 두 라우팅 테이블 모두 비어 있습니다 — 초기 UPDATE 교환이 시작됩니다.' },
      { note: 'R-A가 자신의 프리픽스 10.1.0.0/24를 광고합니다. UPDATE에는 NLRI(프리픽스), AS_PATH [65001], NEXT_HOP 192.168.1.1, ORIGIN IGP가 포함됩니다. R-B는 이를 Adj-RIB-In에 저장합니다 — Import 정책 및 최적 경로 선택 이전의 원시 수신 테이블입니다.' },
      { annotation: '최적 경로 선택: 10.1.0.0/24 후보가 하나뿐이므로 자동으로 선택됩니다. Import 정책(route-map, prefix-list)은 이 단계 이전에 적용됩니다. 경로가 Loc-RIB에 설치됩니다.' },
      { annotation: '최적 경로가 Loc-RIB에서 FIB(커널 라우팅 테이블)로 푸시됩니다. R-B에서 192.168.1.1 경유 10.1.0.0/24 포워딩이 활성화됩니다.' },
      { note: 'R-B가 자신의 프리픽스 10.2.0.0/24를 R-A에게 광고합니다: AS_PATH [65002], NEXT_HOP 192.168.1.2. R-A는 동일한 Adj-RIB-In → Loc-RIB → FIB 파이프라인을 처리합니다. 세션이 이제 완전한 양방향으로 동작합니다.' },
      { annotation: 'iBGP 단계 시작. R-B가 R-C에게 iBGP UPDATE 전송: { prefix: 10.1.0.0/24, AS_PATH: [65001], NEXT_HOP: 192.168.1.1, LOCAL_PREF: 100 }. eBGP와의 핵심 차이: NEXT_HOP은 R-B의 주소로 교체되지 않고 R-A의 주소로 유지됩니다. R-C는 IGP(OSPF/IS-IS)를 통해 192.168.1.1을 해석하며, 이는 R-B를 아웃바운드 인터페이스로 가리킵니다.' },
      { annotation: 'R-C가 재귀 next-hop 룩업을 통해 10.1.0.0/24를 설치합니다: BGP NEXT_HOP 192.168.1.1 → IGP 경로 → R-B 인터페이스. 트래픽 경로: R-C → (IGP를 통해 R-B로) → R-B → (eBGP 링크) → R-A.' },
      { annotation: 'R-B가 동일한 iBGP UPDATE를 R-D에게 전송합니다. iBGP는 완전 메시(full-mesh)가 필요합니다: 모든 iBGP 스피커가 서로 직접 피어링해야 하며, 대규모에서 N(N−1)/2 세션이 필요합니다. Route Reflector가 이를 해결합니다.' },
      { annotation: 'R-D가 IGP 해석 next-hop → R-B를 통해 10.1.0.0/24를 설치합니다. AS65002 내 모든 라우터가 수렴을 완료했습니다.' },
      { annotation: '수렴 완료. AS65002 내 모든 라우터가 AS65001의 10.1.0.0/24로 트래픽을 포워딩할 수 있습니다. iBGP NEXT_HOP(192.168.1.1)은 IGP에 없으며, 각 라우터에서 IGP 테이블을 통해 재귀적으로 해석됩니다.' },
    ] as Array<{ annotation: string } | { note: string }>,
  },
}

// ── Frame data ─────────────────────────────────────────────────────────────────

interface RouteFrame {
  msg?: BgpMsg
  adjRibIn: RibEntry[]; locRib: RibEntry[]; fib: FibEntry[]
  highlight?: 'adj' | 'loc' | 'fib'
  ibgpLink?: 'rc' | 'rd'
  rcStatus: InternalStatus; rdStatus: InternalStatus
  hasAnnotation?: boolean
}

const R_ADJ: RibEntry[] = [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }]
const R_LOC: RibEntry[] = [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }]
const R_FIB: FibEntry[] = [{ prefix: '10.1.0.0/24', via: '192.168.1.1' }]

const ROUTE_FRAMES: RouteFrame[] = [
  { adjRibIn: [], locRib: [], fib: [], rcStatus: 'none', rdStatus: 'none', hasAnnotation: true },
  { msg: { dir: 'a2b', label: 'UPDATE 10.1.0.0/24' },
    adjRibIn: R_ADJ, locRib: [], fib: [], highlight: 'adj', rcStatus: 'none', rdStatus: 'none' },
  { adjRibIn: R_ADJ, locRib: R_LOC, fib: [], highlight: 'loc', rcStatus: 'none', rdStatus: 'none', hasAnnotation: true },
  { adjRibIn: R_ADJ, locRib: R_LOC, fib: R_FIB, highlight: 'fib', rcStatus: 'none', rdStatus: 'none', hasAnnotation: true },
  { msg: { dir: 'b2a', label: 'UPDATE 10.2.0.0/24' },
    adjRibIn: R_ADJ, locRib: R_LOC, fib: R_FIB, rcStatus: 'none', rdStatus: 'none' },
  { adjRibIn: R_ADJ, locRib: R_LOC, fib: R_FIB, ibgpLink: 'rc',
    rcStatus: 'received', rdStatus: 'none', hasAnnotation: true },
  { adjRibIn: R_ADJ, locRib: R_LOC, fib: R_FIB,
    rcStatus: 'installed', rdStatus: 'none', hasAnnotation: true },
  { adjRibIn: R_ADJ, locRib: R_LOC, fib: R_FIB, ibgpLink: 'rd',
    rcStatus: 'installed', rdStatus: 'received', hasAnnotation: true },
  { adjRibIn: R_ADJ, locRib: R_LOC, fib: R_FIB,
    rcStatus: 'installed', rdStatus: 'installed', hasAnnotation: true },
  { adjRibIn: R_ADJ, locRib: R_LOC, fib: R_FIB,
    rcStatus: 'installed', rdStatus: 'installed', hasAnnotation: true },
]

// ── Shared components ──────────────────────────────────────────────────────────

function PeerCard({ label, asn }: { label: string; asn: string }) {
  return (
    <div className="tcp-entity">
      <span className="tcp-entity-name">{label}</span>
      <code className="bgp-asn">{asn}</code>
    </div>
  )
}

function RibPanel({ adjRibIn, locRib, fib, highlight }: {
  adjRibIn: RibEntry[]; locRib: RibEntry[]; fib: FibEntry[]
  highlight?: 'adj' | 'loc' | 'fib'
}) {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <div className="bgp-rib-panels">
      <div className={`bgp-rib-col${highlight === 'adj' ? ' bgp-rib-active' : ''}`}>
        <div className="bgp-rib-head">
          <span className="bgp-rib-title">Adj-RIB-In</span>
          <span className="bgp-rib-sub">{t.adjSub}</span>
        </div>
        <div className="bgp-rib-body">
          {adjRibIn.length === 0 ? <span className="bgp-rib-empty">{t.empty}</span> : adjRibIn.map((r, i) => (
            <div key={i} className="bgp-rib-row">
              <code className="bgp-rib-prefix">{r.prefix}</code>
              <div className="bgp-rib-attrs">
                <span><span className="bgp-k">path</span>{r.aspath}</span>
                <span><span className="bgp-k">nh</span>{r.nexthop}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <span className="bgp-rib-arrow">→</span>
      <div className={`bgp-rib-col${highlight === 'loc' ? ' bgp-rib-active' : ''}`}>
        <div className="bgp-rib-head">
          <span className="bgp-rib-title">Loc-RIB</span>
          <span className="bgp-rib-sub">{t.locSub}</span>
        </div>
        <div className="bgp-rib-body">
          {locRib.length === 0 ? <span className="bgp-rib-empty">{t.empty}</span> : locRib.map((r, i) => (
            <div key={i} className="bgp-rib-row">
              <code className="bgp-rib-prefix">{r.prefix}</code>
              <div className="bgp-rib-attrs">
                <span><span className="bgp-k">path</span>{r.aspath}</span>
                <span><span className="bgp-k">nh</span>{r.nexthop}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <span className="bgp-rib-arrow">→</span>
      <div className={`bgp-rib-col${highlight === 'fib' ? ' bgp-rib-active' : ''}`}>
        <div className="bgp-rib-head">
          <span className="bgp-rib-title">FIB</span>
          <span className="bgp-rib-sub">{t.fibSub}</span>
        </div>
        <div className="bgp-rib-body">
          {fib.length === 0 ? <span className="bgp-rib-empty">{t.empty}</span> : fib.map((r, i) => (
            <div key={i} className="bgp-rib-row">
              <code className="bgp-rib-prefix">{r.prefix}</code>
              <div className="bgp-rib-attrs">
                <span><span className="bgp-k">via</span>{r.via}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const STATUS_ICON: Record<InternalStatus, string> = { none: '○', received: '◐', installed: '●' }
const STATUS_CLS: Record<InternalStatus, string> = {
  none: 'bgp-rs-none', received: 'bgp-rs-recv', installed: 'bgp-rs-inst',
}

function RouterStatusCard({ name, status }: { name: string; status: InternalStatus }) {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <div className={`bgp-rs-card ${STATUS_CLS[status]}`}>
      <span className="bgp-rs-name">{name}</span>
      <span className="bgp-rs-role">{t.internal}</span>
      <span className="bgp-rs-indicator">
        <span className="bgp-rs-icon">{STATUS_ICON[status]}</span>
        <span className="bgp-rs-label">
          {status === 'none' ? t.noRoute : status === 'received' ? t.received : '10.1.0.0/24'}
        </span>
      </span>
    </div>
  )
}

// ── useExplorer + Controls ─────────────────────────────────────────────────────

function useExplorer(length: number) {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [animKey, setAnimKey] = useState(0)
  const seqRef = useRef<HTMLDivElement>(null)
  const isLast = step >= length - 1

  useEffect(() => {
    if (!playing) return
    if (isLast) { setPlaying(false); return }
    const t = setTimeout(() => { setStep(s => s + 1); setAnimKey(k => k + 1) }, 900)
    return () => clearTimeout(t)
  }, [playing, step, isLast])

  useEffect(() => {
    if (seqRef.current) seqRef.current.scrollTop = seqRef.current.scrollHeight
  }, [step])

  const reset = () => { setPlaying(false); setStep(0); setAnimKey(k => k + 1) }
  const stepFwd = () => { if (!isLast) { setStep(s => s + 1); setAnimKey(k => k + 1) } }
  const handlePlay = () => {
    if (isLast) { reset(); setTimeout(() => setPlaying(true), 50); return }
    setPlaying(p => !p)
  }
  return { step, playing, animKey, seqRef, isLast, reset, stepFwd, handlePlay, length }
}

function ExplorerControls({ ex }: { ex: ReturnType<typeof useExplorer> }) {
  const { step, playing, isLast, length, reset, stepFwd, handlePlay } = ex
  const { lang } = useLang()
  const lbl = {
    reset: lang === 'ko' ? '초기화' : 'Reset',
    play: lang === 'ko' ? '재생' : 'Play',
    pause: lang === 'ko' ? '일시정지' : 'Pause',
    resume: lang === 'ko' ? '계속' : 'Resume',
    replay: lang === 'ko' ? '다시 보기' : 'Replay',
    step: lang === 'ko' ? '다음 →' : 'Step →',
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

// ── Unified Route Explorer ─────────────────────────────────────────────────────

function BgpRouteExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const ex = useExplorer(ROUTE_FRAMES.length)
  const { step, animKey, seqRef } = ex
  const frame = ROUTE_FRAMES[step]
  const frameText = t.frames[step]

  const shownMsgs: Array<{ msg: BgpMsg; idx: number; isLive: boolean }> = []
  for (let i = 1; i <= step; i++) {
    if (ROUTE_FRAMES[i].msg) shownMsgs.push({ msg: ROUTE_FRAMES[i].msg!, idx: i, isLive: false })
  }
  if (shownMsgs.length > 0 && frame.msg) shownMsgs[shownMsgs.length - 1].isLive = true

  const annotation = 'annotation' in frameText ? frameText.annotation : undefined
  const ibgpActive = step >= 5

  return (
    <div className="bgp-explorer">
      <div className="bgp-section-label">{t.sectionEbgp}</div>

      <div className="tcp-diagram">
        <div className="tcp-entity-row">
          <PeerCard label="R-A" asn="AS65001" />
          <PeerCard label="R-B" asn="AS65002" />
        </div>
        <div className="tcp-seq-body" ref={seqRef}>
          <div className="tcp-lifeline tcp-lifeline-l" />
          <div className="tcp-lifeline tcp-lifeline-r" />
          {shownMsgs.map(({ msg, idx, isLive }) => (
            <div key={idx} className={`tcp-pkt-row${isLive ? ' live' : ' past'}`}>
              <div
                className={`tcp-arrow ${msg.dir === 'a2b' ? 'c2s' : 's2c'}${isLive ? ' animating' : ''}`}
                style={{ '--travel': '680ms' } as React.CSSProperties}
                key={isLive ? `live-${animKey}` : `past-${idx}`}
              >
                <div className="tcp-arrow-line" />
                <div className="tcp-arrow-head" />
                <div className="tcp-arrow-label">
                  <span className="tcp-pkt-name bgp-msg-tag bgp-tag-update">{msg.label}</span>
                </div>
                {isLive && <div className="tcp-arrow-dot" />}
              </div>
            </div>
          ))}
          {annotation && <div className="tcp-annotation">{annotation}</div>}
          <div className="tcp-seq-pad" />
        </div>
      </div>

      <div className="bgp-sub-label">{t.ribLabel}</div>
      <RibPanel adjRibIn={frame.adjRibIn} locRib={frame.locRib} fib={frame.fib} highlight={frame.highlight} />

      <div className={`bgp-ibgp-section${ibgpActive ? '' : ' bgp-ibgp-dim'}`}>
        <div className="bgp-sub-label">{t.ibgpLabel}</div>
        <div className="bgp-ibgp-layout">
          <div className="bgp-ibgp-source">
            <div className="bgp-ibgp-node">
              <span className="bgp-ibgp-name">R-B</span>
              <code className="bgp-asn">AS65002</code>
              <span className="bgp-ibgp-role">{t.borderRouter}</span>
              <span className="bgp-ibgp-route">● 10.1.0.0/24</span>
            </div>
          </div>
          <div className="bgp-ibgp-right">
            <div className="bgp-ibgp-pair">
              <div className={`bgp-ibgp-link${frame.ibgpLink === 'rc' ? ' bgp-ibgp-link-active' : ''}`}>
                <div className="bgp-ibgp-link-line">
                  {frame.ibgpLink === 'rc' && <div className="bgp-ibgp-dot" key={`rc-${step}`} />}
                </div>
                <span className="bgp-ibgp-link-tag">iBGP</span>
              </div>
              <RouterStatusCard name="R-C" status={frame.rcStatus} />
            </div>
            <div className="bgp-ibgp-pair">
              <div className={`bgp-ibgp-link${frame.ibgpLink === 'rd' ? ' bgp-ibgp-link-active' : ''}`}>
                <div className="bgp-ibgp-link-line">
                  {frame.ibgpLink === 'rd' && <div className="bgp-ibgp-dot" key={`rd-${step}`} />}
                </div>
                <span className="bgp-ibgp-link-tag">iBGP</span>
              </div>
              <RouterStatusCard name="R-D" status={frame.rdStatus} />
            </div>
          </div>
        </div>
      </div>

      <ExplorerControls ex={ex} />

      {'note' in frameText ? (
        <div className="tcp-detail">
          <div className="tcp-detail-top">
            <span className="bgp-msg-tag bgp-tag-update">{frame.msg!.label}</span>
            <span className="bgp-dir-label">{frame.msg!.dir === 'a2b' ? 'R-A → R-B' : 'R-B → R-A'}</span>
          </div>
          <p className="tcp-detail-note">{frameText.note}</p>
          <span className="tcp-step-counter">{step + 1} / {ROUTE_FRAMES.length}</span>
        </div>
      ) : (
        <div className="tcp-detail tcp-detail-ann">
          <span>{annotation}</span>
          <span className="tcp-step-counter">{step + 1} / {ROUTE_FRAMES.length}</span>
        </div>
      )}
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
        <BgpRouteExplorer />
      </div>
    </NoteLayout>
  )
}
