import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

type RouterState = 'IDLE' | 'CONNECT' | 'ACTIVE' | 'OPENSENT' | 'OPENCONFIRM' | 'ESTABLISHED'
type MsgType = 'TCP_SYN' | 'TCP_SYNACK' | 'TCP_ACK' | 'OPEN' | 'KEEPALIVE' | 'UPDATE'
type Dir = 'a2b' | 'b2a'
type InternalStatus = 'none' | 'received' | 'installed'

interface BgpMsg { type: MsgType; dir: Dir; label: string }
interface RibEntry { prefix: string; aspath: string; nexthop: string }
interface FibEntry { prefix: string; via: string }

const STATE_CLS: Record<RouterState, string> = {
  IDLE: 'bgp-st-idle', CONNECT: 'bgp-st-transit', ACTIVE: 'bgp-st-transit',
  OPENSENT: 'bgp-st-transit', OPENCONFIRM: 'bgp-st-transit', ESTABLISHED: 'bgp-st-est',
}
const MSG_TAG_CLS: Record<MsgType, string> = {
  TCP_SYN: 'bgp-tag-tcp', TCP_SYNACK: 'bgp-tag-tcp', TCP_ACK: 'bgp-tag-tcp',
  OPEN: 'bgp-tag-open', KEEPALIVE: 'bgp-tag-ka', UPDATE: 'bgp-tag-update',
}

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title: 'BGP peering and route exchange',
    readTime: '7 min',
    intro: 'How two BGP routers establish a session, exchange routes, and install them into the forwarding path — then how those routes propagate through the rest of the AS via iBGP. Three interactive walkthroughs: session establishment, the Adj-RIB-In → Loc-RIB → FIB pipeline, and iBGP convergence.',
    part1: 'Part 1 — eBGP Session Establishment',
    part2: 'Part 2 — Route Exchange & RIB/FIB Pipeline',
    part3: 'Part 3 — iBGP Propagation & Convergence',
    adjSub: 'raw · from peer',
    locSub: 'best-path · BGP table',
    fibSub: 'kernel · forwarding',
    empty: 'empty',
    noRoute: 'no route',
    received: 'received',
    borderRouter: 'border router',
    internal: 'internal',
    session: [
      { annotation: 'ConnectRetry timer fires on R-A. BGP admin-up on both routers.' },
      { note: 'R-A opens TCP to R-B:179. BGP has no built-in reliability — it delegates that entirely to TCP. R-A enters CONNECT, waiting for the handshake. R-B is in ACTIVE: passively listening for an incoming connection from any configured neighbor IP.' },
      { note: 'R-B accepts. It checks the source IP against its neighbor table. If R-A\'s IP is not a configured neighbor, R-B resets the connection immediately. No BGP messages have been exchanged yet.' },
      { note: 'TCP three-way handshake complete on port 179. Both routers immediately send a BGP OPEN — no waiting. Both transition to OPENSENT.' },
      { note: 'R-A sends OPEN: { version: 4, my_as: 65001, hold_time: 90 s, bgp_id: 10.0.0.1, capabilities: [multiprotocol, route-refresh, 4-octet-AS] }. Hold time is negotiated — the session uses the minimum of both peers\' proposed values. BGP-ID must be globally unique (usually the highest loopback IP).' },
      { note: 'R-B sends OPEN: { my_as: 65002, hold_time: 90 s, bgp_id: 10.0.0.2 }. R-A receives it and validates: the peer ASN must match what R-A has configured. If anything mismatches, a NOTIFICATION is sent and the session resets to IDLE.' },
      { note: 'R-A accepted R-B\'s OPEN. Sending KEEPALIVE means: "your parameters are valid — session confirmed." R-A enters OPENCONFIRM: it has confirmed the peer but is waiting for the peer\'s KEEPALIVE in return.' },
      { note: 'R-B accepts R-A\'s OPEN, sends KEEPALIVE. Both routers receive each other\'s KEEPALIVE → both enter ESTABLISHED. From here, KEEPALIVE is sent every 30 s (hold_time ÷ 3) to prove the session is still alive. Missing three in a row triggers the Hold Timer and tears down the session.' },
      { annotation: 'BGP session ESTABLISHED · Hold Timer: 90 s · Keepalive: 30 s · UPDATE exchange begins.' },
    ],
    rib: [
      { annotation: 'Session up. R-B\'s tables are empty. Initial UPDATE exchange begins.' },
      { note: 'R-A advertises 10.1.0.0/24. The UPDATE carries NLRI (the prefix) plus mandatory path attributes: AS_PATH [65001], NEXT_HOP 192.168.1.1, ORIGIN IGP. R-B stores the route in Adj-RIB-In — the raw incoming table before any policy or best-path processing.' },
      { annotation: 'Best-path decision: only one candidate for 10.1.0.0/24, so it wins automatically. Import policy (route-maps, prefix-lists) would apply before this step. Route installed in Loc-RIB.' },
      { annotation: 'Best path pushed from Loc-RIB → FIB (kernel routing table). Hardware forwarding for 10.1.0.0/24 is now active on R-B.' },
      { note: 'R-B advertises its own prefix 10.2.0.0/24 back to R-A. R-A runs the same Adj-RIB-In → best-path → Loc-RIB → FIB pipeline on its side. The session is now fully bidirectional.' },
      { annotation: 'End-of-RIB sent. R-B now propagates 10.1.0.0/24 to internal routers via iBGP → Part 3.' },
    ],
    ibgp: [
      { annotation: 'R-B has 10.1.0.0/24 in its FIB from Part 2. Internal routers R-C and R-D have empty tables. iBGP sessions between R-B↔R-C and R-B↔R-D are already established (same 6-state process as Part 1, within AS65002).' },
      { annotation: 'R-B sends iBGP UPDATE to R-C: { prefix: 10.1.0.0/24, AS_PATH: [65001], NEXT_HOP: 192.168.1.1, LOCAL_PREF: 100 }. Critical difference from eBGP: NEXT_HOP is preserved as R-A\'s IP (192.168.1.1), not R-B\'s. R-C must resolve 192.168.1.1 via its IGP (OSPF/IS-IS) — which points to R-B as the next-hop interface.' },
      { annotation: 'R-C installs 10.1.0.0/24 via recursive lookup: BGP NEXT_HOP 192.168.1.1 → IGP route → R-B\'s interface. Traffic path: R-C → (IGP toward R-B) → R-B → (eBGP link) → R-A.' },
      { annotation: 'R-B sends the same iBGP UPDATE to R-D. iBGP requires full-mesh peering: every iBGP speaker must have a direct session with every other. With N routers this is N(N−1)/2 sessions — unscalable at hundreds of routers. Route Reflectors (RRs) solve this: one RR redistributes to all clients, eliminating the full-mesh requirement.' },
      { annotation: 'R-D installs 10.1.0.0/24 via IGP-resolved next-hop → R-B. All routers in AS65002 have converged.' },
      { annotation: 'Convergence complete. Any router in AS65002 can now forward traffic to 10.1.0.0/24. The iBGP NEXT_HOP (R-A\'s IP 192.168.1.1) is never in the IGP — it is resolved recursively at each router using the IGP table, which provides the actual forwarding path to R-B\'s interface.' },
    ],
  },
  ko: {
    title: 'BGP 피어링과 경로 교환',
    readTime: '7분',
    intro: '두 BGP 라우터가 세션을 수립하고 경로를 교환하고 포워딩 경로에 설치하는 과정 — 이후 iBGP를 통해 AS 내부 라우터로 경로가 전파되는 흐름. 세션 수립, Adj-RIB-In → Loc-RIB → FIB 파이프라인, iBGP 수렴 등 세 가지 인터랙티브 데모.',
    part1: 'Part 1 — eBGP 세션 수립',
    part2: 'Part 2 — 경로 교환 & RIB/FIB 파이프라인',
    part3: 'Part 3 — iBGP 전파 & 수렴',
    adjSub: '원시 · 피어 수신',
    locSub: '최적 경로 · BGP 테이블',
    fibSub: '커널 · 포워딩',
    empty: '비어 있음',
    noRoute: '경로 없음',
    received: '수신됨',
    borderRouter: '경계 라우터',
    internal: '내부',
    session: [
      { annotation: 'R-A에서 ConnectRetry 타이머가 만료됩니다. 두 라우터 모두 BGP admin-up 상태입니다.' },
      { note: 'R-A가 R-B:179로 TCP 연결을 시도합니다. BGP는 자체 신뢰성 메커니즘이 없으며, 신뢰성을 TCP에 완전히 위임합니다. R-A는 CONNECT 상태로 진입해 핸드셰이크를 기다립니다. R-B는 ACTIVE 상태: 설정된 이웃 IP로부터 들어오는 연결을 수동 대기합니다.' },
      { note: 'R-B가 연결을 수락합니다. 소스 IP를 이웃 테이블과 대조해 확인합니다. R-A의 IP가 설정된 이웃 목록에 없으면 R-B는 즉시 연결을 리셋합니다. 아직 BGP 메시지는 교환되지 않았습니다.' },
      { note: '포트 179에서 TCP 3-way 핸드셰이크 완료. 두 라우터 모두 즉시 BGP OPEN을 전송합니다 — 대기 없이 바로 보냅니다. 두 라우터 모두 OPENSENT로 전환됩니다.' },
      { note: 'R-A가 OPEN 전송: { version: 4, my_as: 65001, hold_time: 90초, bgp_id: 10.0.0.1, capabilities: [multiprotocol, route-refresh, 4-octet-AS] }. Hold time은 협상으로 결정 — 양측이 제안한 값 중 더 낮은 쪽을 사용합니다. BGP-ID는 전역적으로 고유해야 합니다 (보통 가장 높은 루프백 IP).' },
      { note: 'R-B가 OPEN 전송: { my_as: 65002, hold_time: 90초, bgp_id: 10.0.0.2 }. R-A가 수신 후 검증: 피어 ASN이 R-A에 설정된 값과 일치해야 합니다. 불일치 시 NOTIFICATION을 전송하고 세션이 IDLE로 리셋됩니다.' },
      { note: 'R-A가 R-B의 OPEN을 수락했습니다. KEEPALIVE 전송은 "파라미터가 유효합니다 — 세션을 확인합니다"를 의미합니다. R-A는 OPENCONFIRM 상태 진입: 피어를 확인했지만 피어의 KEEPALIVE를 대기 중.' },
      { note: 'R-B가 R-A의 OPEN을 수락하고 KEEPALIVE를 전송합니다. 양측이 서로의 KEEPALIVE를 수신 → 두 라우터 모두 ESTABLISHED 진입. 이후 KEEPALIVE는 30초마다(hold_time ÷ 3) 전송되어 세션 유지를 증명합니다. 세 번 연속 미수신 시 Hold Timer가 만료되어 세션이 종료됩니다.' },
      { annotation: 'BGP 세션 ESTABLISHED · Hold Timer: 90초 · Keepalive: 30초 · UPDATE 교환 시작.' },
    ],
    rib: [
      { annotation: '세션 수립 완료. R-B의 테이블은 비어 있습니다. 초기 UPDATE 교환이 시작됩니다.' },
      { note: 'R-A가 10.1.0.0/24를 광고합니다. UPDATE에는 NLRI(프리픽스)와 필수 경로 속성이 포함됩니다: AS_PATH [65001], NEXT_HOP 192.168.1.1, ORIGIN IGP. R-B는 해당 경로를 Adj-RIB-In에 저장합니다 — 정책 적용이나 최적 경로 선택 전의 원시 수신 테이블입니다.' },
      { annotation: '최적 경로 결정: 10.1.0.0/24에 대한 후보가 하나뿐이므로 자동으로 선택됩니다. Import 정책(route-map, prefix-list)은 이 단계 이전에 적용됩니다. 경로가 Loc-RIB에 설치됩니다.' },
      { annotation: '최적 경로가 Loc-RIB에서 FIB(커널 라우팅 테이블)로 푸시됩니다. R-B에서 10.1.0.0/24에 대한 하드웨어 포워딩이 활성화됩니다.' },
      { note: 'R-B가 자신의 프리픽스 10.2.0.0/24를 R-A에게 광고합니다. R-A는 동일한 Adj-RIB-In → 최적 경로 → Loc-RIB → FIB 파이프라인을 자체적으로 실행합니다. 세션이 이제 완전한 양방향으로 동작합니다.' },
      { annotation: 'End-of-RIB 전송. R-B는 이제 10.1.0.0/24를 iBGP를 통해 내부 라우터로 전파합니다 → Part 3.' },
    ],
    ibgp: [
      { annotation: 'R-B는 Part 2에서 FIB에 10.1.0.0/24를 가지고 있습니다. 내부 라우터 R-C와 R-D는 빈 테이블을 가지고 있습니다. R-B↔R-C, R-B↔R-D 간 iBGP 세션은 이미 수립되어 있습니다(Part 1과 동일한 6-상태 프로세스, AS65002 내부).' },
      { annotation: 'R-B가 R-C에게 iBGP UPDATE 전송: { prefix: 10.1.0.0/24, AS_PATH: [65001], NEXT_HOP: 192.168.1.1, LOCAL_PREF: 100 }. eBGP와의 핵심 차이: NEXT_HOP은 R-B의 IP가 아닌 R-A의 IP(192.168.1.1)로 그대로 유지됩니다. R-C는 IGP(OSPF/IS-IS)를 통해 192.168.1.1을 해석해야 합니다 — R-B를 next-hop 인터페이스로 가리킵니다.' },
      { annotation: 'R-C가 재귀 룩업을 통해 10.1.0.0/24를 설치합니다: BGP NEXT_HOP 192.168.1.1 → IGP 경로 → R-B 인터페이스. 트래픽 경로: R-C → (IGP를 통해 R-B로) → R-B → (eBGP 링크) → R-A.' },
      { annotation: 'R-B가 동일한 iBGP UPDATE를 R-D에게 전송합니다. iBGP는 완전 메시(full-mesh) 피어링을 요구합니다: 모든 iBGP 스피커가 서로 직접 세션을 가져야 합니다. N개 라우터의 경우 N(N−1)/2개 세션 필요 — 수백 대 규모에서는 확장이 불가합니다. Route Reflector(RR)가 이를 해결합니다: RR 하나가 모든 클라이언트에 재배포하여 완전 메시 요구사항을 제거합니다.' },
      { annotation: 'R-D가 IGP로 해석한 next-hop → R-B를 통해 10.1.0.0/24를 설치합니다. AS65002의 모든 라우터가 수렴을 완료했습니다.' },
      { annotation: '수렴 완료. AS65002 내 어떤 라우터도 이제 10.1.0.0/24로 트래픽을 포워딩할 수 있습니다. iBGP NEXT_HOP(R-A의 IP 192.168.1.1)은 IGP에 없습니다 — 각 라우터에서 IGP 테이블을 사용해 재귀적으로 해석되며, R-B 인터페이스로의 실제 포워딩 경로를 제공합니다.' },
    ],
  },
}

// ── Shared components ──────────────────────────────────────────────────────────

function RouterBox({ label, asn, state }: { label: string; asn: string; state: RouterState }) {
  return (
    <div className="tcp-entity">
      <span className="tcp-entity-name">{label}</span>
      <code className="bgp-asn">{asn}</code>
      <span className={`tcp-state-badge ${STATE_CLS[state]}`}>{state}</span>
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

// ── useExplorer hook ───────────────────────────────────────────────────────────

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

// ── Part 1: Session Establishment ─────────────────────────────────────────────

interface SessionFrame {
  msg?: BgpMsg; stateA: RouterState; stateB: RouterState; hasAnnotation?: boolean
}

const SESSION_FRAMES: SessionFrame[] = [
  { stateA: 'IDLE', stateB: 'IDLE', hasAnnotation: true },
  { msg: { type: 'TCP_SYN', dir: 'a2b', label: 'TCP SYN' }, stateA: 'CONNECT', stateB: 'ACTIVE' },
  { msg: { type: 'TCP_SYNACK', dir: 'b2a', label: 'TCP SYN-ACK' }, stateA: 'CONNECT', stateB: 'ACTIVE' },
  { msg: { type: 'TCP_ACK', dir: 'a2b', label: 'TCP ACK' }, stateA: 'OPENSENT', stateB: 'OPENSENT' },
  { msg: { type: 'OPEN', dir: 'a2b', label: 'OPEN' }, stateA: 'OPENSENT', stateB: 'OPENSENT' },
  { msg: { type: 'OPEN', dir: 'b2a', label: 'OPEN' }, stateA: 'OPENCONFIRM', stateB: 'OPENSENT' },
  { msg: { type: 'KEEPALIVE', dir: 'a2b', label: 'KEEPALIVE' }, stateA: 'OPENCONFIRM', stateB: 'OPENCONFIRM' },
  { msg: { type: 'KEEPALIVE', dir: 'b2a', label: 'KEEPALIVE' }, stateA: 'ESTABLISHED', stateB: 'ESTABLISHED' },
  { stateA: 'ESTABLISHED', stateB: 'ESTABLISHED', hasAnnotation: true },
]

function BgpSessionExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const ex = useExplorer(SESSION_FRAMES.length)
  const { step, animKey, seqRef } = ex
  const frame = SESSION_FRAMES[step]
  const text = t.session[step]

  const shownMsgs: Array<{ msg: BgpMsg; idx: number; isLive: boolean }> = []
  for (let i = 1; i <= step; i++) {
    if (SESSION_FRAMES[i].msg) shownMsgs.push({ msg: SESSION_FRAMES[i].msg!, idx: i, isLive: false })
  }
  if (shownMsgs.length > 0 && frame.msg) shownMsgs[shownMsgs.length - 1].isLive = true

  const annotation = 'annotation' in text ? text.annotation : undefined

  return (
    <div className="bgp-explorer">
      <div className="bgp-section-label">{t.part1}</div>
      <div className="tcp-diagram">
        <div className="tcp-entity-row">
          <RouterBox label="R-A" asn="AS65001" state={frame.stateA} />
          <RouterBox label="R-B" asn="AS65002" state={frame.stateB} />
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
                  <span className={`tcp-pkt-name bgp-msg-tag ${MSG_TAG_CLS[msg.type]}`}>{msg.label}</span>
                </div>
                {isLive && <div className="tcp-arrow-dot" />}
              </div>
            </div>
          ))}
          {annotation && <div className="tcp-annotation">{annotation}</div>}
          <div className="tcp-seq-pad" />
        </div>
      </div>
      <ExplorerControls ex={ex} />
      {'note' in text ? (
        <div className="tcp-detail">
          <div className="tcp-detail-top">
            <span className={`bgp-msg-tag ${MSG_TAG_CLS[frame.msg!.type]}`}>{frame.msg!.label}</span>
            <span className="bgp-dir-label">{frame.msg!.dir === 'a2b' ? 'R-A → R-B' : 'R-B → R-A'}</span>
          </div>
          <p className="tcp-detail-note">{text.note}</p>
          <span className="tcp-step-counter">{step + 1} / {SESSION_FRAMES.length}</span>
        </div>
      ) : (
        <div className="tcp-detail tcp-detail-ann">
          <span>{annotation}</span>
          <span className="tcp-step-counter">{step + 1} / {SESSION_FRAMES.length}</span>
        </div>
      )}
    </div>
  )
}

// ── Part 2: Route Exchange + RIB/FIB Pipeline ─────────────────────────────────

interface RibFrame {
  msg?: BgpMsg; stateA: RouterState; stateB: RouterState
  adjRibIn: RibEntry[]; locRib: RibEntry[]; fib: FibEntry[]
  hasAnnotation?: boolean; highlight?: 'adj' | 'loc' | 'fib'
}

const RIB_FRAMES: RibFrame[] = [
  { stateA: 'ESTABLISHED', stateB: 'ESTABLISHED', adjRibIn: [], locRib: [], fib: [], hasAnnotation: true },
  { msg: { type: 'UPDATE', dir: 'a2b', label: 'UPDATE' },
    stateA: 'ESTABLISHED', stateB: 'ESTABLISHED',
    adjRibIn: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    locRib: [], fib: [], highlight: 'adj' },
  { stateA: 'ESTABLISHED', stateB: 'ESTABLISHED',
    adjRibIn: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    locRib: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    fib: [], hasAnnotation: true, highlight: 'loc' },
  { stateA: 'ESTABLISHED', stateB: 'ESTABLISHED',
    adjRibIn: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    locRib: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    fib: [{ prefix: '10.1.0.0/24', via: '192.168.1.1' }], hasAnnotation: true, highlight: 'fib' },
  { msg: { type: 'UPDATE', dir: 'b2a', label: 'UPDATE' },
    stateA: 'ESTABLISHED', stateB: 'ESTABLISHED',
    adjRibIn: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    locRib: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    fib: [{ prefix: '10.1.0.0/24', via: '192.168.1.1' }] },
  { stateA: 'ESTABLISHED', stateB: 'ESTABLISHED',
    adjRibIn: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    locRib: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    fib: [{ prefix: '10.1.0.0/24', via: '192.168.1.1' }], hasAnnotation: true },
]

function BgpRibExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const ex = useExplorer(RIB_FRAMES.length)
  const { step, animKey, seqRef } = ex
  const frame = RIB_FRAMES[step]
  const text = t.rib[step]

  const shownMsgs: Array<{ msg: BgpMsg; idx: number; isLive: boolean }> = []
  for (let i = 1; i <= step; i++) {
    if (RIB_FRAMES[i].msg) shownMsgs.push({ msg: RIB_FRAMES[i].msg!, idx: i, isLive: false })
  }
  if (shownMsgs.length > 0 && frame.msg) shownMsgs[shownMsgs.length - 1].isLive = true

  const annotation = 'annotation' in text ? text.annotation : undefined

  return (
    <div className="bgp-explorer">
      <div className="bgp-section-label">{t.part2}</div>
      <div className="tcp-diagram">
        <div className="tcp-entity-row">
          <RouterBox label="R-A" asn="AS65001" state={frame.stateA} />
          <RouterBox label="R-B" asn="AS65002" state={frame.stateB} />
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
                  <span className={`tcp-pkt-name bgp-msg-tag ${MSG_TAG_CLS[msg.type]}`}>{msg.label}</span>
                </div>
                {isLive && <div className="tcp-arrow-dot" />}
              </div>
            </div>
          ))}
          {annotation && <div className="tcp-annotation">{annotation}</div>}
          <div className="tcp-seq-pad" />
        </div>
      </div>
      <RibPanel adjRibIn={frame.adjRibIn} locRib={frame.locRib} fib={frame.fib} highlight={frame.highlight} />
      <ExplorerControls ex={ex} />
      {'note' in text ? (
        <div className="tcp-detail">
          <div className="tcp-detail-top">
            <span className={`bgp-msg-tag ${MSG_TAG_CLS[frame.msg!.type]}`}>{frame.msg!.label}</span>
            <span className="bgp-dir-label">{frame.msg!.dir === 'a2b' ? 'R-A → R-B' : 'R-B → R-A'}</span>
          </div>
          <p className="tcp-detail-note">{text.note}</p>
          <span className="tcp-step-counter">{step + 1} / {RIB_FRAMES.length}</span>
        </div>
      ) : (
        <div className="tcp-detail tcp-detail-ann">
          <span>{annotation}</span>
          <span className="tcp-step-counter">{step + 1} / {RIB_FRAMES.length}</span>
        </div>
      )}
    </div>
  )
}

// ── Part 3: iBGP Propagation & Convergence ────────────────────────────────────

interface IbgpFrame {
  activeLink?: 'rc' | 'rd'
  rcStatus: InternalStatus; rdStatus: InternalStatus
}

const IBGP_FRAMES: IbgpFrame[] = [
  { rcStatus: 'none', rdStatus: 'none' },
  { activeLink: 'rc', rcStatus: 'received', rdStatus: 'none' },
  { rcStatus: 'installed', rdStatus: 'none' },
  { activeLink: 'rd', rcStatus: 'installed', rdStatus: 'received' },
  { rcStatus: 'installed', rdStatus: 'installed' },
  { rcStatus: 'installed', rdStatus: 'installed' },
]

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

function BgpIbgpExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const ex = useExplorer(IBGP_FRAMES.length)
  const { step } = ex
  const frame = IBGP_FRAMES[step]

  return (
    <div className="bgp-explorer">
      <div className="bgp-section-label">{t.part3}</div>

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
            <div className={`bgp-ibgp-link${frame.activeLink === 'rc' ? ' bgp-ibgp-link-active' : ''}`}>
              <div className="bgp-ibgp-link-line">
                {frame.activeLink === 'rc' && <div className="bgp-ibgp-dot" key={`rc-${step}`} />}
              </div>
              <span className="bgp-ibgp-link-tag">iBGP</span>
            </div>
            <RouterStatusCard name="R-C" status={frame.rcStatus} />
          </div>
          <div className="bgp-ibgp-pair">
            <div className={`bgp-ibgp-link${frame.activeLink === 'rd' ? ' bgp-ibgp-link-active' : ''}`}>
              <div className="bgp-ibgp-link-line">
                {frame.activeLink === 'rd' && <div className="bgp-ibgp-dot" key={`rd-${step}`} />}
              </div>
              <span className="bgp-ibgp-link-tag">iBGP</span>
            </div>
            <RouterStatusCard name="R-D" status={frame.rdStatus} />
          </div>
        </div>
      </div>

      <ExplorerControls ex={ex} />

      <div className="tcp-detail tcp-detail-ann" style={{ alignItems: 'flex-start', minHeight: 'auto' }}>
        <span style={{ lineHeight: 'var(--kp-leading-relaxed)', fontSize: 'var(--kp-text-sm)' }}>
          {t.ibgp[step].annotation}
        </span>
        <span className="tcp-step-counter" style={{ flexShrink: 0 }}>
          {step + 1} / {IBGP_FRAMES.length}
        </span>
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
        <BgpSessionExplorer />
        <div className="bgp-sep" />
        <BgpRibExplorer />
        <div className="bgp-sep" />
        <BgpIbgpExplorer />
      </div>
    </NoteLayout>
  )
}
