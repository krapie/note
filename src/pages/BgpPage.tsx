import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'

type RouterState = 'IDLE' | 'CONNECT' | 'ACTIVE' | 'OPENSENT' | 'OPENCONFIRM' | 'ESTABLISHED'
type MsgType = 'TCP_SYN' | 'TCP_SYNACK' | 'TCP_ACK' | 'OPEN' | 'KEEPALIVE' | 'UPDATE'
type Dir = 'a2b' | 'b2a'
type InternalStatus = 'none' | 'received' | 'installed'

interface BgpMsg { type: MsgType; dir: Dir; label: string; note: string }
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
  return (
    <div className="bgp-rib-panels">
      <div className={`bgp-rib-col${highlight === 'adj' ? ' bgp-rib-active' : ''}`}>
        <div className="bgp-rib-head">
          <span className="bgp-rib-title">Adj-RIB-In</span>
          <span className="bgp-rib-sub">raw · from peer</span>
        </div>
        <div className="bgp-rib-body">
          {adjRibIn.length === 0 ? <span className="bgp-rib-empty">empty</span> : adjRibIn.map((r, i) => (
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
          <span className="bgp-rib-sub">best-path · BGP table</span>
        </div>
        <div className="bgp-rib-body">
          {locRib.length === 0 ? <span className="bgp-rib-empty">empty</span> : locRib.map((r, i) => (
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
          <span className="bgp-rib-sub">kernel · forwarding</span>
        </div>
        <div className="bgp-rib-body">
          {fib.length === 0 ? <span className="bgp-rib-empty">empty</span> : fib.map((r, i) => (
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
  return (
    <>
      <div className="tcp-controls">
        <button className="btn-secondary" onClick={reset}>Reset</button>
        <button className="btn-primary" onClick={handlePlay}>
          {playing ? 'Pause' : isLast ? 'Replay' : step === 0 ? 'Play' : 'Resume'}
        </button>
        <button className="btn-secondary" onClick={stepFwd} disabled={playing || isLast}>Step →</button>
      </div>
      <div className="tcp-progress">
        <div className="tcp-progress-fill" style={{ width: `${(step / (length - 1)) * 100}%` }} />
      </div>
    </>
  )
}

// ── Part 1: Session Establishment ─────────────────────────────────────────────

interface SessionFrame {
  msg?: BgpMsg; stateA: RouterState; stateB: RouterState; annotation?: string
}

const SESSION_FRAMES: SessionFrame[] = [
  { stateA: 'IDLE', stateB: 'IDLE',
    annotation: 'ConnectRetry timer fires on R-A. BGP admin-up on both routers.' },
  { msg: { type: 'TCP_SYN', dir: 'a2b', label: 'TCP SYN',
      note: 'R-A opens TCP to R-B:179. BGP has no built-in reliability — it delegates that entirely to TCP. R-A enters CONNECT, waiting for the handshake. R-B is in ACTIVE: passively listening for an incoming connection from any configured neighbor IP.' },
    stateA: 'CONNECT', stateB: 'ACTIVE' },
  { msg: { type: 'TCP_SYNACK', dir: 'b2a', label: 'TCP SYN-ACK',
      note: 'R-B accepts. It checks the source IP against its neighbor table. If R-A\'s IP is not a configured neighbor, R-B resets the connection immediately. No BGP messages have been exchanged yet.' },
    stateA: 'CONNECT', stateB: 'ACTIVE' },
  { msg: { type: 'TCP_ACK', dir: 'a2b', label: 'TCP ACK',
      note: 'TCP three-way handshake complete on port 179. Both routers immediately send a BGP OPEN — no waiting. Both transition to OPENSENT.' },
    stateA: 'OPENSENT', stateB: 'OPENSENT' },
  { msg: { type: 'OPEN', dir: 'a2b', label: 'OPEN',
      note: 'R-A sends OPEN: { version: 4, my_as: 65001, hold_time: 90 s, bgp_id: 10.0.0.1, capabilities: [multiprotocol, route-refresh, 4-octet-AS] }. Hold time is negotiated — the session uses the minimum of both peers\' proposed values. BGP-ID must be globally unique (usually the highest loopback IP).' },
    stateA: 'OPENSENT', stateB: 'OPENSENT' },
  { msg: { type: 'OPEN', dir: 'b2a', label: 'OPEN',
      note: 'R-B sends OPEN: { my_as: 65002, hold_time: 90 s, bgp_id: 10.0.0.2 }. R-A receives it and validates: the peer ASN must match what R-A has configured. If anything mismatches, a NOTIFICATION is sent and the session resets to IDLE.' },
    stateA: 'OPENCONFIRM', stateB: 'OPENSENT' },
  { msg: { type: 'KEEPALIVE', dir: 'a2b', label: 'KEEPALIVE',
      note: 'R-A accepted R-B\'s OPEN. Sending KEEPALIVE means: "your parameters are valid — session confirmed." R-A enters OPENCONFIRM: it has confirmed the peer but is waiting for the peer\'s KEEPALIVE in return.' },
    stateA: 'OPENCONFIRM', stateB: 'OPENCONFIRM' },
  { msg: { type: 'KEEPALIVE', dir: 'b2a', label: 'KEEPALIVE',
      note: 'R-B accepts R-A\'s OPEN, sends KEEPALIVE. Both routers receive each other\'s KEEPALIVE → both enter ESTABLISHED. From here, KEEPALIVE is sent every 30 s (hold_time ÷ 3) to prove the session is still alive. Missing three in a row triggers the Hold Timer and tears down the session.' },
    stateA: 'ESTABLISHED', stateB: 'ESTABLISHED' },
  { stateA: 'ESTABLISHED', stateB: 'ESTABLISHED',
    annotation: 'BGP session ESTABLISHED · Hold Timer: 90 s · Keepalive: 30 s · UPDATE exchange begins.' },
]

function BgpSessionExplorer() {
  const ex = useExplorer(SESSION_FRAMES.length)
  const { step, animKey, seqRef } = ex
  const frame = SESSION_FRAMES[step]

  const shownMsgs: Array<{ msg: BgpMsg; idx: number; isLive: boolean }> = []
  for (let i = 1; i <= step; i++) {
    if (SESSION_FRAMES[i].msg) shownMsgs.push({ msg: SESSION_FRAMES[i].msg!, idx: i, isLive: false })
  }
  if (shownMsgs.length > 0 && frame.msg) shownMsgs[shownMsgs.length - 1].isLive = true

  return (
    <div className="bgp-explorer">
      <div className="bgp-section-label">Part 1 — eBGP Session Establishment</div>
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
          {frame.annotation && <div className="tcp-annotation">{frame.annotation}</div>}
          <div className="tcp-seq-pad" />
        </div>
      </div>
      <ExplorerControls ex={ex} />
      {frame.msg ? (
        <div className="tcp-detail">
          <div className="tcp-detail-top">
            <span className={`bgp-msg-tag ${MSG_TAG_CLS[frame.msg.type]}`}>{frame.msg.label}</span>
            <span className="bgp-dir-label">{frame.msg.dir === 'a2b' ? 'R-A → R-B' : 'R-B → R-A'}</span>
          </div>
          <p className="tcp-detail-note">{frame.msg.note}</p>
          <span className="tcp-step-counter">{step + 1} / {SESSION_FRAMES.length}</span>
        </div>
      ) : (
        <div className="tcp-detail tcp-detail-ann">
          <span>{frame.annotation}</span>
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
  annotation?: string; highlight?: 'adj' | 'loc' | 'fib'
}

const RIB_FRAMES: RibFrame[] = [
  { stateA: 'ESTABLISHED', stateB: 'ESTABLISHED',
    adjRibIn: [], locRib: [], fib: [],
    annotation: 'Session up. R-B\'s tables are empty. Initial UPDATE exchange begins.' },
  { msg: { type: 'UPDATE', dir: 'a2b', label: 'UPDATE',
      note: 'R-A advertises 10.1.0.0/24. The UPDATE carries NLRI (the prefix) plus mandatory path attributes: AS_PATH [65001], NEXT_HOP 192.168.1.1, ORIGIN IGP. R-B stores the route in Adj-RIB-In — the raw incoming table before any policy or best-path processing.' },
    stateA: 'ESTABLISHED', stateB: 'ESTABLISHED',
    adjRibIn: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    locRib: [], fib: [], highlight: 'adj' },
  { stateA: 'ESTABLISHED', stateB: 'ESTABLISHED',
    adjRibIn: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    locRib: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    fib: [],
    annotation: 'Best-path decision: only one candidate for 10.1.0.0/24, so it wins automatically. Import policy (route-maps, prefix-lists) would apply before this step. Route installed in Loc-RIB.',
    highlight: 'loc' },
  { stateA: 'ESTABLISHED', stateB: 'ESTABLISHED',
    adjRibIn: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    locRib: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    fib: [{ prefix: '10.1.0.0/24', via: '192.168.1.1' }],
    annotation: 'Best path pushed from Loc-RIB → FIB (kernel routing table). Hardware forwarding for 10.1.0.0/24 is now active on R-B.',
    highlight: 'fib' },
  { msg: { type: 'UPDATE', dir: 'b2a', label: 'UPDATE',
      note: 'R-B advertises its own prefix 10.2.0.0/24 back to R-A. R-A runs the same Adj-RIB-In → best-path → Loc-RIB → FIB pipeline on its side. The session is now fully bidirectional.' },
    stateA: 'ESTABLISHED', stateB: 'ESTABLISHED',
    adjRibIn: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    locRib: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    fib: [{ prefix: '10.1.0.0/24', via: '192.168.1.1' }] },
  { stateA: 'ESTABLISHED', stateB: 'ESTABLISHED',
    adjRibIn: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    locRib: [{ prefix: '10.1.0.0/24', aspath: '[65001]', nexthop: '192.168.1.1' }],
    fib: [{ prefix: '10.1.0.0/24', via: '192.168.1.1' }],
    annotation: 'End-of-RIB sent. R-B now propagates 10.1.0.0/24 to internal routers via iBGP → Part 3.' },
]

function BgpRibExplorer() {
  const ex = useExplorer(RIB_FRAMES.length)
  const { step, animKey, seqRef } = ex
  const frame = RIB_FRAMES[step]

  const shownMsgs: Array<{ msg: BgpMsg; idx: number; isLive: boolean }> = []
  for (let i = 1; i <= step; i++) {
    if (RIB_FRAMES[i].msg) shownMsgs.push({ msg: RIB_FRAMES[i].msg!, idx: i, isLive: false })
  }
  if (shownMsgs.length > 0 && frame.msg) shownMsgs[shownMsgs.length - 1].isLive = true

  return (
    <div className="bgp-explorer">
      <div className="bgp-section-label">Part 2 — Route Exchange & RIB/FIB Pipeline</div>
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
          {frame.annotation && <div className="tcp-annotation">{frame.annotation}</div>}
          <div className="tcp-seq-pad" />
        </div>
      </div>
      <RibPanel adjRibIn={frame.adjRibIn} locRib={frame.locRib} fib={frame.fib} highlight={frame.highlight} />
      <ExplorerControls ex={ex} />
      {frame.msg ? (
        <div className="tcp-detail">
          <div className="tcp-detail-top">
            <span className={`bgp-msg-tag ${MSG_TAG_CLS[frame.msg.type]}`}>{frame.msg.label}</span>
            <span className="bgp-dir-label">{frame.msg.dir === 'a2b' ? 'R-A → R-B' : 'R-B → R-A'}</span>
          </div>
          <p className="tcp-detail-note">{frame.msg.note}</p>
          <span className="tcp-step-counter">{step + 1} / {RIB_FRAMES.length}</span>
        </div>
      ) : (
        <div className="tcp-detail tcp-detail-ann">
          <span>{frame.annotation}</span>
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
  annotation: string
}

const IBGP_FRAMES: IbgpFrame[] = [
  { rcStatus: 'none', rdStatus: 'none',
    annotation: 'R-B has 10.1.0.0/24 in its FIB from Part 2. Internal routers R-C and R-D have empty tables. iBGP sessions between R-B↔R-C and R-B↔R-D are already established (same 6-state process as Part 1, within AS65002).' },
  { activeLink: 'rc', rcStatus: 'received', rdStatus: 'none',
    annotation: 'R-B sends iBGP UPDATE to R-C: { prefix: 10.1.0.0/24, AS_PATH: [65001], NEXT_HOP: 192.168.1.1, LOCAL_PREF: 100 }. Critical difference from eBGP: NEXT_HOP is preserved as R-A\'s IP (192.168.1.1), not R-B\'s. R-C must resolve 192.168.1.1 via its IGP (OSPF/IS-IS) — which points to R-B as the next-hop interface.' },
  { rcStatus: 'installed', rdStatus: 'none',
    annotation: 'R-C installs 10.1.0.0/24 via recursive lookup: BGP NEXT_HOP 192.168.1.1 → IGP route → R-B\'s interface. Traffic path: R-C → (IGP toward R-B) → R-B → (eBGP link) → R-A.' },
  { activeLink: 'rd', rcStatus: 'installed', rdStatus: 'received',
    annotation: 'R-B sends the same iBGP UPDATE to R-D. iBGP requires full-mesh peering: every iBGP speaker must have a direct session with every other. With N routers this is N(N−1)/2 sessions — unscalable at hundreds of routers. Route Reflectors (RRs) solve this: one RR redistributes to all clients, eliminating the full-mesh requirement.' },
  { rcStatus: 'installed', rdStatus: 'installed',
    annotation: 'R-D installs 10.1.0.0/24 via IGP-resolved next-hop → R-B. All routers in AS65002 have converged.' },
  { rcStatus: 'installed', rdStatus: 'installed',
    annotation: 'Convergence complete. Any router in AS65002 can now forward traffic to 10.1.0.0/24. The iBGP NEXT_HOP (R-A\'s IP 192.168.1.1) is never in the IGP — it is resolved recursively at each router using the IGP table, which provides the actual forwarding path to R-B\'s interface.' },
]

const STATUS_ICON: Record<InternalStatus, string> = { none: '○', received: '◐', installed: '●' }
const STATUS_CLS: Record<InternalStatus, string> = {
  none: 'bgp-rs-none', received: 'bgp-rs-recv', installed: 'bgp-rs-inst',
}

function RouterStatusCard({ name, status }: { name: string; status: InternalStatus }) {
  return (
    <div className={`bgp-rs-card ${STATUS_CLS[status]}`}>
      <span className="bgp-rs-name">{name}</span>
      <span className="bgp-rs-role">internal</span>
      <span className="bgp-rs-indicator">
        <span className="bgp-rs-icon">{STATUS_ICON[status]}</span>
        <span className="bgp-rs-label">
          {status === 'none' ? 'no route' : status === 'received' ? 'received' : '10.1.0.0/24'}
        </span>
      </span>
    </div>
  )
}

function BgpIbgpExplorer() {
  const ex = useExplorer(IBGP_FRAMES.length)
  const { step } = ex
  const frame = IBGP_FRAMES[step]

  return (
    <div className="bgp-explorer">
      <div className="bgp-section-label">Part 3 — iBGP Propagation & Convergence</div>

      <div className="bgp-ibgp-layout">
        <div className="bgp-ibgp-source">
          <div className="bgp-ibgp-node">
            <span className="bgp-ibgp-name">R-B</span>
            <code className="bgp-asn">AS65002</code>
            <span className="bgp-ibgp-role">border router</span>
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
          {frame.annotation}
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
  return (
    <NoteLayout
      title="BGP peering and route exchange"
      date="2026-06-21"
      readTime="7 min"
      tags={['networking', 'bgp', 'routing']}
      intro="How two BGP routers establish a session, exchange routes, and install them into the forwarding path — then how those routes propagate through the rest of the AS via iBGP. Three interactive walkthroughs: session establishment, the Adj-RIB-In → Loc-RIB → FIB pipeline, and iBGP convergence."
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
