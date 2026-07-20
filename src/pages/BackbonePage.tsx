import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type NodeId     = 'user' | 't3' | 't2a' | 't1a' | 't1b' | 't2b' | 'cdn'
type NodeStatus = 'idle' | 'active' | 'done'
type LinkId     = 'user_t3' | 't3_t2a' | 't2a_t1a' | 't1a_t1b' | 't1b_t2b' | 't2b_cdn'
type LinkStatus = 'idle' | 'transit' | 'peering' | 'done'

interface BbFrame {
  nodes: Record<NodeId, NodeStatus>
  links: Record<LinkId, LinkStatus>
}

// ── Graph geometry ─────────────────────────────────────────────────────────────

const BGW = 560
const BGH = 240

const NODE_PX: Record<NodeId, [number, number]> = {
  user: [70,  205],
  t3:   [70,  150],
  t2a:  [200,  90],
  t1a:  [320,  40],
  t1b:  [460,  40],
  t2b:  [460, 120],
  cdn:  [460, 195],
}

const NODE_IDS: NodeId[] = ['user', 't3', 't2a', 't1a', 't1b', 't2b', 'cdn']

const LINKS: Array<{ id: LinkId; from: NodeId; to: NodeId }> = [
  { id: 'user_t3',  from: 'user', to: 't3'  },
  { id: 't3_t2a',  from: 't3',   to: 't2a' },
  { id: 't2a_t1a', from: 't2a',  to: 't1a' },
  { id: 't1a_t1b', from: 't1a',  to: 't1b' },
  { id: 't1b_t2b', from: 't1b',  to: 't2b' },
  { id: 't2b_cdn', from: 't2b',  to: 'cdn' },
]

const LINK_PATHS: Record<LinkId, string> = {
  user_t3:  `M ${NODE_PX.user[0]} ${NODE_PX.user[1]} L ${NODE_PX.t3[0]}  ${NODE_PX.t3[1]}`,
  t3_t2a:  `M ${NODE_PX.t3[0]}  ${NODE_PX.t3[1]}  L ${NODE_PX.t2a[0]} ${NODE_PX.t2a[1]}`,
  t2a_t1a: `M ${NODE_PX.t2a[0]} ${NODE_PX.t2a[1]} L ${NODE_PX.t1a[0]} ${NODE_PX.t1a[1]}`,
  t1a_t1b: `M ${NODE_PX.t1a[0]} ${NODE_PX.t1a[1]} L ${NODE_PX.t1b[0]} ${NODE_PX.t1b[1]}`,
  t1b_t2b: `M ${NODE_PX.t1b[0]} ${NODE_PX.t1b[1]} L ${NODE_PX.t2b[0]} ${NODE_PX.t2b[1]}`,
  t2b_cdn: `M ${NODE_PX.t2b[0]} ${NODE_PX.t2b[1]} L ${NODE_PX.cdn[0]}  ${NODE_PX.cdn[1]}`,
}

const T1A_T1B_REV = `M ${NODE_PX.t1b[0]} ${NODE_PX.t1b[1]} L ${NODE_PX.t1a[0]} ${NODE_PX.t1a[1]}`

// ── Frame data ─────────────────────────────────────────────────────────────────

const N0: Record<NodeId, NodeStatus> = {
  user: 'idle', t3: 'idle', t2a: 'idle', t1a: 'idle', t1b: 'idle', t2b: 'idle', cdn: 'idle',
}
const L0: Record<LinkId, LinkStatus> = {
  user_t3: 'idle', t3_t2a: 'idle', t2a_t1a: 'idle', t1a_t1b: 'idle', t1b_t2b: 'idle', t2b_cdn: 'idle',
}

const FRAMES: BbFrame[] = [
  { nodes: N0, links: L0 },
  { nodes: { ...N0, user: 'active', t3: 'active' },
    links: { ...L0, user_t3: 'transit' } },
  { nodes: { ...N0, user: 'done', t3: 'active', t2a: 'active' },
    links: { ...L0, user_t3: 'done', t3_t2a: 'transit' } },
  { nodes: { ...N0, user: 'done', t3: 'done', t2a: 'active', t1a: 'active' },
    links: { ...L0, user_t3: 'done', t3_t2a: 'done', t2a_t1a: 'transit' } },
  { nodes: { ...N0, user: 'done', t3: 'done', t2a: 'done', t1a: 'active', t1b: 'active' },
    links: { ...L0, user_t3: 'done', t3_t2a: 'done', t2a_t1a: 'done', t1a_t1b: 'peering' } },
  { nodes: { ...N0, user: 'done', t3: 'done', t2a: 'done', t1a: 'done', t1b: 'active', t2b: 'active' },
    links: { ...L0, user_t3: 'done', t3_t2a: 'done', t2a_t1a: 'done', t1a_t1b: 'done', t1b_t2b: 'transit' } },
  { nodes: { user: 'done', t3: 'done', t2a: 'done', t1a: 'done', t1b: 'done', t2b: 'done', cdn: 'done' },
    links: { user_t3: 'done', t3_t2a: 'done', t2a_t1a: 'done', t1a_t1b: 'done', t1b_t2b: 'done', t2b_cdn: 'done' } },
]

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title:    'Backbone networks — how packets cross the internet',
    readTime: '6 min',
    intro:    `The internet is not a single network. It is roughly 80,000 Autonomous Systems — ISPs, cloud providers, enterprises, and universities — interconnected by the Border Gateway Protocol (BGP). Tier 1 carriers form the core backbone: a handful of global ISPs that can reach every destination on Earth without paying any upstream provider, because they have settlement-free peering agreements with all other Tier 1s. Every packet you send travels up through your local ISP hierarchy to these backbone links, crosses to the other side, and descends again to the destination.`,
    nodeLabel: {
      user: 'End User',
      t3:   'Local ISP',
      t2a:  'Regional ISP',
      t1a:  'Backbone A',
      t1b:  'Backbone B',
      t2b:  'Regional ISP',
      cdn:  'Destination',
    } as Record<NodeId, string>,
    nodeSub: {
      user: 'src: 203.0.113.5',
      t3:   'Tier 3',
      t2a:  'Tier 2',
      t1a:  'Tier 1 · AS1234',
      t1b:  'Tier 1 · AS5678',
      t2b:  'Tier 2',
      cdn:  'dst: 198.51.100.5',
    } as Record<NodeId, string>,
    linkLabel: {
      user_t3:  'last mile',
      t3_t2a:  'transit',
      t2a_t1a: 'transit',
      t1a_t1b: 'IXP peering',
      t1b_t2b: 'transit',
      t2b_cdn: 'last mile',
    } as Record<LinkId, string>,
    frames: [
      {
        title: 'Internet backbone — global packet transit',
        note:  `The internet is not one network — it is ~80,000 Autonomous Systems (ISPs, cloud providers, universities) interconnected by BGP. Tier 1 ISPs form the backbone: a small set of carriers that reach every destination through settlement-free peering agreements with each other. Packets from a home user travel up through ISP tiers to these backbone links, then descend on the other side.`,
      },
      {
        title: 'Last mile — user to local ISP (Tier 3)',
        note:  `The packet leaves the end user and enters their local ISP — a Tier 3 provider that aggregates last-mile connections (cable, DSL, fiber). Tier 3 ISPs have no peering agreements; they pay a Tier 2 or Tier 1 carrier for all transit to reach the global internet. The last-mile link is often the bottleneck in the entire end-to-end path.`,
      },
      {
        title: 'Transit — Tier 3 to Tier 2 regional ISP',
        note:  `The Tier 3 ISP forwards the packet to its upstream Tier 2 provider via a paid transit link. Transit is a contractual relationship: the customer (Tier 3) pays the provider (Tier 2) for the right to send traffic through its network and reach its routes. Tier 2 ISPs are regional or national carriers that peer with some networks but still purchase Tier 1 transit for global reach.`,
      },
      {
        title: 'Transit — Tier 2 to Tier 1 backbone',
        note:  `The regional ISP forwards the packet to its Tier 1 upstream. Tier 1 ISPs are the backbone — global carriers that reach every IPv4 and IPv6 prefix without paying any upstream. They achieve this by having settlement-free peering agreements with every other Tier 1 network. AT&T, NTT, Lumen, Cogent, and Telia are classic examples.`,
      },
      {
        title: 'Settlement-free peering at the IXP',
        note:  `The two Tier 1 backbones exchange traffic at an Internet Exchange Point (IXP) — a colocation facility where hundreds of networks interconnect over 100G or 400G ethernet. Neither carrier pays the other. Instead, they exchange BGP routes directly. DE-CIX Frankfurt, AMS-IX, and Equinix IX are among the largest globally, each handling multiple terabits per second of peak traffic.`,
      },
      {
        title: 'Transit — Tier 1 to far-side regional ISP',
        note:  `After crossing the backbone, the packet arrives at the Tier 1 ISP serving the destination region. That Tier 1 has a transit relationship with the far-side Tier 2 regional ISP. The packet is handed down the hierarchy, with BGP selecting the optimal next-hop at each AS boundary based on shortest AS-path and local routing policy.`,
      },
      {
        title: 'Packet delivered — full backbone path traversed',
        note:  `The packet has crossed two transit relationships, one settlement-free peering session, and multiple AS boundaries. BGP ran at every hop to choose the path. The total number of hops (TTL decrements) is typically 10–25 for a cross-continental journey. The backbone links themselves — long-haul submarine cables and terrestrial fiber — carry the bulk of the world\'s internet traffic between continents.`,
      },
    ],
    tierTitle:   'ISP tiers and transit economics',
    tierHeaders: ['Tier', 'Role', 'Examples', 'Connectivity'],
    tiers: [
      { tier: 'Tier 1', role: 'Global backbone — reaches every AS via settlement-free peering; no upstream payments', examples: 'AT&T, NTT, Lumen, Cogent, Telia', conn: 'Peering only' },
      { tier: 'Tier 2', role: 'Regional or national ISP — peers with some networks, buys Tier 1 transit for global reach', examples: 'KT, Deutsche Telekom, Zayo, Tata', conn: 'Peering + transit' },
      { tier: 'Tier 3', role: 'Last-mile or local ISP — aggregates consumer connections; purchases all transit', examples: 'Local cable and DSL providers', conn: 'Transit only' },
    ],
  },
  ko: {
    title:    '백본 네트워크 — 패킷이 인터넷을 건너는 방법',
    readTime: '6분',
    intro:    `인터넷은 하나의 네트워크가 아닙니다. BGP(Border Gateway Protocol)로 상호 연결된 약 8만 개의 자율 시스템(ISP, 클라우드 사업자, 기업, 대학 등)입니다. Tier 1 사업자가 핵심 백본을 형성합니다: 모든 다른 Tier 1과 정산 없는 피어링 협약을 맺어 어떤 업스트림 사업자에게도 비용을 지불하지 않고 지구상 모든 목적지에 도달할 수 있는 소수의 글로벌 ISP입니다. 당신이 보내는 모든 패킷은 로컬 ISP 계층을 따라 올라가 이 백본 링크를 통과한 뒤 반대편으로 내려가 목적지에 도달합니다.`,
    nodeLabel: {
      user: '엔드 유저',
      t3:   '로컬 ISP',
      t2a:  '리저널 ISP',
      t1a:  '백본 A',
      t1b:  '백본 B',
      t2b:  '리저널 ISP',
      cdn:  '목적지',
    } as Record<NodeId, string>,
    nodeSub: {
      user: 'src: 203.0.113.5',
      t3:   'Tier 3',
      t2a:  'Tier 2',
      t1a:  'Tier 1 · AS1234',
      t1b:  'Tier 1 · AS5678',
      t2b:  'Tier 2',
      cdn:  'dst: 198.51.100.5',
    } as Record<NodeId, string>,
    linkLabel: {
      user_t3:  '라스트 마일',
      t3_t2a:  '트랜짓',
      t2a_t1a: '트랜짓',
      t1a_t1b: 'IXP 피어링',
      t1b_t2b: '트랜짓',
      t2b_cdn: '라스트 마일',
    } as Record<LinkId, string>,
    frames: [
      {
        title: '인터넷 백본 — 글로벌 패킷 전송',
        note:  'BGP로 상호 연결된 약 8만 개의 자율 시스템(ISP, 클라우드 사업자, 대학 등)으로 이루어진 것이 인터넷입니다. Tier 1 ISP가 백본을 형성합니다: 서로 간의 정산 없는 피어링 협약으로 모든 목적지에 도달할 수 있는 소수의 사업자들입니다. 가정 사용자의 패킷은 ISP 계층을 따라 올라가 이 백본 링크를 통과한 뒤 반대편으로 내려갑니다.',
      },
      {
        title: '라스트 마일 — 사용자에서 로컬 ISP (Tier 3)',
        note:  '패킷이 엔드 유저를 떠나 로컬 ISP에 진입합니다 — 케이블, DSL, 광섬유 등 라스트 마일 연결을 집선하는 Tier 3 사업자입니다. Tier 3 ISP는 자체 피어링 협약이 없습니다. Tier 2 또는 Tier 1 사업자에게 글로벌 인터넷 도달을 위한 모든 트랜짓 비용을 지불합니다. 라스트 마일 링크는 종종 전체 엔드투엔드 경로에서 병목이 됩니다.',
      },
      {
        title: '트랜짓 — Tier 3에서 Tier 2 리저널 ISP',
        note:  'Tier 3 ISP가 유상 트랜짓 링크를 통해 업스트림 Tier 2 사업자에게 패킷을 전달합니다. 트랜짓은 계약 관계입니다: 고객(Tier 3)이 사업자(Tier 2)에게 네트워크를 통해 트래픽을 보내고 경로에 도달하는 권리를 구매합니다. Tier 2 ISP는 일부 네트워크와 피어링하지만 글로벌 도달을 위해 Tier 1 트랜짓을 구매하는 리저널/내셔널 사업자입니다.',
      },
      {
        title: '트랜짓 — Tier 2에서 Tier 1 백본',
        note:  '리저널 ISP가 Tier 1 업스트림으로 패킷을 전달합니다. Tier 1 ISP가 바로 백본입니다 — 누구에게도 비용을 지불하지 않고 모든 IPv4·IPv6 프리픽스에 도달할 수 있는 글로벌 사업자들입니다. 이는 다른 모든 Tier 1 네트워크와의 정산 없는 피어링 협약을 통해 가능합니다. AT&T, NTT, Lumen, Cogent, Telia가 대표적인 예입니다.',
      },
      {
        title: 'IXP에서 정산 없는 피어링',
        note:  '두 Tier 1 백본이 인터넷 교환 포인트(IXP)에서 트래픽을 교환합니다 — 수백 개의 네트워크가 100G 또는 400G 이더넷으로 상호 연결하는 코로케이션 시설입니다. 어느 사업자도 상대방에게 비용을 지불하지 않습니다. 대신 BGP 경로를 직접 교환합니다. DE-CIX 프랑크푸르트, AMS-IX, Equinix IX는 세계 최대 규모로, 각각 수 테라비트/초의 피크 트래픽을 처리합니다.',
      },
      {
        title: '트랜짓 — Tier 1에서 원격 리저널 ISP',
        note:  '백본을 가로지른 후 패킷이 목적지 리전을 담당하는 Tier 1 ISP에 도착합니다. 해당 Tier 1은 원격 Tier 2 리저널 ISP와 트랜짓 관계를 맺고 있습니다. 패킷이 계층을 따라 내려가며 BGP가 각 AS 경계에서 최단 AS-경로와 로컬 라우팅 정책 기반으로 최적 넥스트홉을 선택합니다.',
      },
      {
        title: '패킷 도착 — 전체 백본 경로 완료',
        note:  '패킷이 두 개의 트랜짓 관계, 하나의 정산 없는 피어링 세션, 여러 AS 경계를 통과했습니다. 모든 홉에서 BGP가 실행되어 경로를 선택했습니다. 대륙 간 이동의 경우 총 홉 수(TTL 감소)는 일반적으로 10~25개입니다. 백본 링크 자체 — 장거리 해저 케이블과 육상 광섬유 — 가 대륙 간 인터넷 트래픽 대부분을 운반합니다.',
      },
    ],
    tierTitle:   'ISP 계층과 트랜짓 경제',
    tierHeaders: ['계층', '역할', '예시', '연결 방식'],
    tiers: [
      { tier: 'Tier 1', role: '글로벌 백본 — 정산 없는 피어링으로 모든 AS에 도달; 업스트림 비용 없음', examples: 'AT&T, NTT, Lumen, Cogent, Telia', conn: '피어링 전용' },
      { tier: 'Tier 2', role: '리저널/내셔널 ISP — 일부 네트워크와 피어링, 글로벌 도달을 위해 Tier 1 트랜짓 구매', examples: 'KT, 도이체텔레콤, Zayo, Tata', conn: '피어링 + 트랜짓' },
      { tier: 'Tier 3', role: '라스트 마일/로컬 ISP — 소비자 연결 집선; 모든 트랜짓 구매', examples: '로컬 케이블, DSL 사업자', conn: '트랜짓 전용' },
    ],
  },
}

// ── Graph ──────────────────────────────────────────────────────────────────────

function BbGraph({ frame, t }: { frame: BbFrame; t: typeof T['en'] }) {
  return (
    <div className="bb-graph-canvas">
      <svg viewBox={`0 0 ${BGW} ${BGH}`} className="bb-graph-svg" preserveAspectRatio="none">
        <defs>
          {LINKS.map(({ id }) => (
            <path key={id} id={`bbp-${id}`} d={LINK_PATHS[id]} fill="none" />
          ))}
          <path id="bbp-t1a_t1b_rev" d={T1A_T1B_REV} fill="none" />
        </defs>

        {/* Link lines */}
        {LINKS.map(({ id, from, to }) => {
          const [x1, y1] = NODE_PX[from]
          const [x2, y2] = NODE_PX[to]
          const st = frame.links[id]
          return (
            <line key={id} x1={x1} y1={y1} x2={x2} y2={y2}
              className={`bb-sline bb-sline-${st}`} strokeWidth="2" />
          )
        })}

        {/* Animated dots — forward direction */}
        {LINKS.map(({ id }) => {
          const st = frame.links[id]
          if (st !== 'transit' && st !== 'peering') return null
          return (
            <circle key={`dot-${id}`} r="5" className="bb-gdot">
              <animateMotion dur="1.1s" repeatCount="indefinite">
                <mpath href={`#bbp-${id}`} />
              </animateMotion>
            </circle>
          )
        })}

        {/* Reverse dot for peering (bidirectional) */}
        {frame.links.t1a_t1b === 'peering' && (
          <circle r="5" className="bb-gdot bb-gdot-peer">
            <animateMotion dur="1.1s" repeatCount="indefinite" begin="0.55s">
              <mpath href="#bbp-t1a_t1b_rev" />
            </animateMotion>
          </circle>
        )}
      </svg>

      {/* Link labels */}
      {LINKS.map(({ id, from, to }) => {
        const [x1, y1] = NODE_PX[from]
        const [x2, y2] = NODE_PX[to]
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        const st = frame.links[id]
        const dx = x2 - x1, dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const ox = (-dy / len) * 16
        const oy = ( dx / len) * 16
        return (
          <span key={`lbl-${id}`}
            className={`graph-linklabel${st !== 'idle' ? ' graph-linklabel-on' : ''}`}
            style={{ left: `${((mx + ox) / BGW) * 100}%`, top: `${((my + oy) / BGH) * 100}%` }}
          >
            {t.linkLabel[id]}
          </span>
        )
      })}

      {/* Node boxes */}
      {NODE_IDS.map(nid => {
        const [px, py] = NODE_PX[nid]
        const st = frame.nodes[nid]
        return (
          <div key={nid}
            className={`bb-gnode bb-gnode-${st}`}
            style={{ left: `${(px / BGW) * 100}%`, top: `${(py / BGH) * 100}%` }}
          >
            <span className="bb-gnode-label">{t.nodeLabel[nid]}</span>
            <span className="bb-gnode-sub">{t.nodeSub[nid]}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Explorer ───────────────────────────────────────────────────────────────────

function BbExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const total = FRAMES.length
  const [step, setStep]       = useState(0)
  const [playing, setPlaying] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLast = step >= total - 1

  useEffect(() => {
    if (!playing) return
    if (isLast) { setPlaying(false); return }
    timerRef.current = setTimeout(() => { setStep(s => s + 1) }, 1300)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [playing, step, isLast])

  function reset() { setPlaying(false); setStep(0) }
  function stepFwd() { if (!isLast) setStep(s => s + 1) }
  function handlePlay() {
    if (isLast) { reset(); setTimeout(() => setPlaying(true), 50); return }
    setPlaying(p => !p)
  }

  const frame = FRAMES[step]
  const ft    = t.frames[step]
  const lbl = {
    reset:  lang === 'ko' ? '초기화'    : 'Reset',
    play:   lang === 'ko' ? '재생'      : 'Play',
    pause:  lang === 'ko' ? '일시정지'  : 'Pause',
    resume: lang === 'ko' ? '계속'      : 'Resume',
    replay: lang === 'ko' ? '다시 보기' : 'Replay',
    step:   lang === 'ko' ? '다음 →'   : 'Step →',
  }

  return (
    <div className="inet-root">
      <BbGraph frame={frame} t={t} />
      <div className="tcp-controls">
        <button className="btn-secondary" onClick={reset}>{lbl.reset}</button>
        <button className="btn-primary" onClick={handlePlay}>
          {playing ? lbl.pause : isLast ? lbl.replay : step === 0 ? lbl.play : lbl.resume}
        </button>
        <button className="btn-secondary" onClick={stepFwd} disabled={playing || isLast}>{lbl.step}</button>
      </div>
      <div className="tcp-progress">
        <div className="tcp-progress-fill" style={{ width: `${(step / (total - 1)) * 100}%` }} />
      </div>
      <div className="bgp2-detail">
        <div className="bgp2-detail-title">{ft.title}</div>
        <p className="bgp2-detail-body">{ft.note}</p>
        <span className="tcp-step-counter">{step + 1} / {total}</span>
      </div>
    </div>
  )
}

// ── Tier table ─────────────────────────────────────────────────────────────────

function TierTable() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <div className="ov-proto-section">
      <div className="bgp2-section-title">{t.tierTitle}</div>
      <table className="ov-proto-table">
        <thead>
          <tr>{t.tierHeaders.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.tiers.map(r => (
            <tr key={r.tier}>
              <td><code>{r.tier}</code></td>
              <td>{r.role}</td>
              <td>{r.examples}</td>
              <td><code>{r.conn}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BackbonePage() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-07-20"
      readTime={t.readTime}
      tags={['networking', 'backbone', 'isp', 'bgp', 'infrastructure']}
      intro={t.intro}
    >
      <BbExplorer />
      <TierTable />
    </NoteLayout>
  )
}
