import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ────────────────────────────────────────────────────────────────────────

type EcmpNodeId = 'esrc' | 'rtw' | 'rte' | 'edst'
type EcmpNodeSt = 'idle' | 'active' | 'done' | 'down'
type EcmpLinkId = 'esrc_rtw' | 'esrc_rte' | 'rtw_edst' | 'rte_edst'
type EcmpLinkSt = 'idle' | 'active' | 'done' | 'failed'

interface EcmpFrame {
  nodes: Record<EcmpNodeId, EcmpNodeSt>
  links: Record<EcmpLinkId, EcmpLinkSt>
}

// ── Graph geometry ───────────────────────────────────────────────────────────────

const EGW = 500
const EGH = 165

const ECMP_PX: Record<EcmpNodeId, [number, number]> = {
  esrc: [70,  82],
  rtw:  [260, 25],
  rte:  [260, 140],
  edst: [440, 82],
}
const ECMP_NODE_IDS: EcmpNodeId[] = ['esrc', 'rtw', 'rte', 'edst']

const ECMP_LINKS: Array<{ id: EcmpLinkId; from: EcmpNodeId; to: EcmpNodeId }> = [
  { id: 'esrc_rtw', from: 'esrc', to: 'rtw'  },
  { id: 'esrc_rte', from: 'esrc', to: 'rte'  },
  { id: 'rtw_edst', from: 'rtw',  to: 'edst' },
  { id: 'rte_edst', from: 'rte',  to: 'edst' },
]

const ECMP_LINK_PATHS: Record<EcmpLinkId, string> = {
  esrc_rtw: `M ${ECMP_PX.esrc[0]} ${ECMP_PX.esrc[1]} L ${ECMP_PX.rtw[0]} ${ECMP_PX.rtw[1]}`,
  esrc_rte: `M ${ECMP_PX.esrc[0]} ${ECMP_PX.esrc[1]} L ${ECMP_PX.rte[0]} ${ECMP_PX.rte[1]}`,
  rtw_edst: `M ${ECMP_PX.rtw[0]} ${ECMP_PX.rtw[1]} L ${ECMP_PX.edst[0]} ${ECMP_PX.edst[1]}`,
  rte_edst: `M ${ECMP_PX.rte[0]} ${ECMP_PX.rte[1]} L ${ECMP_PX.edst[0]} ${ECMP_PX.edst[1]}`,
}

// ── Frame data ───────────────────────────────────────────────────────────────────

const EN0: Record<EcmpNodeId, EcmpNodeSt> = { esrc: 'idle', rtw: 'idle', rte: 'idle', edst: 'idle' }
const EL0: Record<EcmpLinkId, EcmpLinkSt> = { esrc_rtw: 'idle', esrc_rte: 'idle', rtw_edst: 'idle', rte_edst: 'idle' }

const ECMP_FRAMES: EcmpFrame[] = [
  { nodes: EN0, links: EL0 },
  {
    nodes: { ...EN0, esrc: 'active', rtw: 'active', edst: 'active' },
    links: { ...EL0, esrc_rtw: 'active', rtw_edst: 'active' },
  },
  {
    nodes: { ...EN0, esrc: 'active', rte: 'active', edst: 'active' },
    links: { ...EL0, esrc_rte: 'active', rte_edst: 'active' },
  },
  {
    nodes: { ...EN0, esrc: 'active', rtw: 'active', rte: 'active', edst: 'active' },
    links: { ...EL0, esrc_rtw: 'active', esrc_rte: 'active', rtw_edst: 'active', rte_edst: 'active' },
  },
  {
    nodes: { ...EN0, esrc: 'active', rtw: 'down', rte: 'active', edst: 'active' },
    links: { ...EL0, esrc_rtw: 'failed', rtw_edst: 'failed', esrc_rte: 'active', rte_edst: 'active' },
  },
]

// ── Translations ─────────────────────────────────────────────────────────────────

interface HashRow { flow: string; srcPort: string; bucket: string; nexthop: string }

const T = {
  en: {
    title:    'ECMP — equal-cost multi-path routing',
    readTime: '4 min',
    intro:    `When two paths to the same destination have equal routing cost, a router normally picks one and ignores the other. ECMP (Equal-Cost Multi-Path) changes that: it installs all equal-cost next-hops into the forwarding table simultaneously and distributes traffic across them. The key design constraint is that all packets in a single TCP flow must take the same path — mixing paths mid-flow causes out-of-order delivery and TCP performance collapse. A per-flow 5-tuple hash (src IP, dst IP, protocol, src port, dst port) solves this: the same 5-tuple always hashes to the same bucket, always maps to the same next-hop.`,
    sectionExplorer: 'Path selection and failure',
    sectionHash:     'Hash bucket assignment',
    nodeLabel: { esrc: 'Source', rtw: 'Router W', rte: 'Router E', edst: 'Destination' } as Record<EcmpNodeId, string>,
    nodeSub:   { esrc: '10.0.0.5', rtw: 'cost 10', rte: 'cost 10', edst: '203.0.113.1' } as Record<EcmpNodeId, string>,
    downBadge: 'down',
    frames: [
      {
        title: 'Topology — two equal-cost paths to the same destination',
        note:  `Router W and Router E both advertise a route to 203.0.113.1 with metric 10. The source router sees two equal-cost next-hops and installs both in its FIB. Without ECMP only one next-hop would be active; ECMP activates all of them simultaneously, doubling available bandwidth between these two points.`,
      },
      {
        title: 'Flow A — 5-tuple hash selects Router W',
        note:  `The router hashes the 5-tuple of Flow A (src IP 10.0.0.5, dst IP 203.0.113.1, TCP, src port 52341, dst port 443). The result maps to bucket 0, which points to Router W. Every packet in Flow A — regardless of how many there are or how long the connection lasts — follows this same path. Per-flow consistency is what prevents TCP from receiving out-of-order segments.`,
      },
      {
        title: 'Flow B — 5-tuple hash selects Router E',
        note:  `Flow B has source port 49102. A different source port produces a different hash output, a different bucket, a different next-hop. Two TCP connections between the exact same pair of hosts — same src IP, same dst IP — can use different physical paths simultaneously without either connection reordering packets. The only difference between them is the source port.`,
      },
      {
        title: 'Both flows in flight — full bandwidth utilization',
        note:  `With many flows the hash distributes traffic across all equal-cost next-hops roughly evenly. Spine-leaf data center fabrics rely on this: every server can reach every other server via multiple spines, and ECMP uses all of them simultaneously. Anycast also pairs with ECMP: BGP routes each client to the nearest PoP, then ECMP within the PoP distributes flows across servers.`,
      },
      {
        title: 'Router W fails — all flows reshuffled to Router E',
        note:  `Router W goes down. The source router removes it from the FIB and ECMP must re-hash all flows against a single remaining next-hop. Flow B, which was already on Router E, stays there. Flow A, which was on Router W, moves to Router E. But with standard modulo hashing the entire bucket table is recomputed when the next-hop count changes from 2 to 1 — even flows that were happily on Router E may remap to different buckets, disrupting more connections than strictly necessary. Resilient ECMP solves this by pre-allocating a large fixed bucket table; on failure only the buckets assigned to the dead next-hop get remapped.`,
      },
    ],
    hashTitle:   'How flows map to paths (2 next-hops)',
    hashHeaders: ['Flow', 'Src port', 'Bucket', 'Next-hop'],
    hashRows: [
      { flow: 'A', srcPort: '52341', bucket: '0', nexthop: 'Router W' },
      { flow: 'B', srcPort: '49102', bucket: '1', nexthop: 'Router E' },
      { flow: 'C', srcPort: '61024', bucket: '0', nexthop: 'Router W' },
      { flow: 'D', srcPort: '38571', bucket: '1', nexthop: 'Router E' },
    ] as HashRow[],
    hashNote: `With 2 next-hops the hash produces 2 buckets (0 and 1). Bucket 0 → Router W, bucket 1 → Router E. When Router W is removed, the bucket count collapses to 1 — both bucket 0 and bucket 1 now map to Router E, so all flows are affected, not just the ones that were on Router W.`,
  },
  ko: {
    title:    'ECMP — 동일 비용 다중 경로 라우팅',
    readTime: '4분',
    intro:    `동일 목적지로 향하는 두 경로의 라우팅 비용이 같을 때, 라우터는 보통 하나를 선택하고 나머지를 무시합니다. ECMP(Equal-Cost Multi-Path)는 이를 바꿉니다: 동일 비용 넥스트홉 모두를 포워딩 테이블에 동시에 설치하고 트래픽을 분산합니다. 핵심 설계 제약은 하나의 TCP 플로우 내 모든 패킷이 동일한 경로를 따라야 한다는 것입니다 — 중간에 경로가 바뀌면 순서가 틀어지고 TCP 성능이 급락합니다. 플로우별 5-튜플 해시(출발지 IP, 목적지 IP, 프로토콜, 출발지 포트, 목적지 포트)가 이를 해결합니다: 같은 5-튜플은 항상 같은 버킷으로 해시되어 항상 같은 넥스트홉으로 연결됩니다.`,
    sectionExplorer: '경로 선택과 장애',
    sectionHash:     '해시 버킷 할당',
    nodeLabel: { esrc: '출발지', rtw: '라우터 W', rte: '라우터 E', edst: '목적지' } as Record<EcmpNodeId, string>,
    nodeSub:   { esrc: '10.0.0.5', rtw: '비용 10', rte: '비용 10', edst: '203.0.113.1' } as Record<EcmpNodeId, string>,
    downBadge: '장애',
    frames: [
      {
        title: '토폴로지 — 동일 목적지로 향하는 두 개의 동일 비용 경로',
        note:  `라우터 W와 라우터 E 모두 203.0.113.1로의 경로를 메트릭 10으로 광고합니다. 출발지 라우터는 두 개의 동일 비용 넥스트홉을 확인하고 FIB에 모두 설치합니다. ECMP 없이는 넥스트홉 하나만 활성화됩니다. ECMP는 두 경로를 동시에 활성화하여 이 구간의 가용 대역폭을 두 배로 늘립니다.`,
      },
      {
        title: '플로우 A — 5-튜플 해시로 라우터 W 선택',
        note:  `라우터가 플로우 A의 5-튜플(출발지 IP 10.0.0.5, 목적지 IP 203.0.113.1, TCP, 출발지 포트 52341, 목적지 포트 443)을 해시합니다. 결과는 버킷 0에 매핑되며, 이는 라우터 W를 가리킵니다. 플로우 A의 모든 패킷은 — 수량이나 연결 지속 시간에 관계없이 — 동일한 경로를 따릅니다. 플로우별 일관성이 TCP의 순서 역전을 방지합니다.`,
      },
      {
        title: '플로우 B — 5-튜플 해시로 라우터 E 선택',
        note:  `플로우 B의 출발지 포트는 49102입니다. 다른 출발지 포트는 다른 해시 출력을 만들고, 다른 버킷을 거쳐, 다른 넥스트홉으로 연결됩니다. 완전히 동일한 두 호스트 쌍 간의 두 TCP 연결이 어느 쪽도 패킷 순서를 잃지 않고 동시에 서로 다른 물리 경로를 사용할 수 있습니다. 두 플로우의 유일한 차이는 출발지 포트입니다.`,
      },
      {
        title: '두 플로우 동시 전송 — 전체 대역폭 활용',
        note:  `많은 플로우가 있을 때 해시는 트래픽을 모든 동일 비용 넥스트홉에 고르게 분산합니다. 스파인-리프 데이터센터 패브릭이 이 원리에 의존합니다: 모든 서버가 여러 스파인을 통해 다른 서버에 도달할 수 있고, ECMP는 이를 동시에 활용합니다. 애니캐스트도 ECMP와 함께 작동합니다: BGP가 각 클라이언트를 가장 가까운 PoP으로 라우팅하면, PoP 내부에서 ECMP가 플로우를 서버에 분산합니다.`,
      },
      {
        title: '라우터 W 장애 — 모든 플로우가 라우터 E로 재분산',
        note:  `라우터 W가 다운됩니다. 출발지 라우터는 FIB에서 라우터 W를 제거하고, ECMP는 남은 하나의 넥스트홉(라우터 E)에 대해 모든 플로우를 재해시해야 합니다. 라우터 E에 있던 플로우 B는 그대로 유지됩니다. 라우터 W에 있던 플로우 A는 라우터 E로 이동합니다. 그런데 표준 모듈로 해싱에서는 넥스트홉 수가 2에서 1로 바뀌면 버킷 테이블 전체가 재계산됩니다 — 원래 라우터 E에 있던 플로우도 다른 버킷에 할당될 수 있어 불필요하게 더 많은 연결이 끊깁니다. Resilient ECMP는 고정된 대규모 버킷 테이블을 사전에 할당하여, 장애 시 다운된 넥스트홉에 할당된 버킷만 재매핑합니다.`,
      },
    ],
    hashTitle:   '플로우가 경로에 매핑되는 방식 (넥스트홉 2개)',
    hashHeaders: ['플로우', '출발지 포트', '버킷', '넥스트홉'],
    hashRows: [
      { flow: 'A', srcPort: '52341', bucket: '0', nexthop: '라우터 W' },
      { flow: 'B', srcPort: '49102', bucket: '1', nexthop: '라우터 E' },
      { flow: 'C', srcPort: '61024', bucket: '0', nexthop: '라우터 W' },
      { flow: 'D', srcPort: '38571', bucket: '1', nexthop: '라우터 E' },
    ] as HashRow[],
    hashNote: `넥스트홉 2개에서 해시는 버킷 0과 1을 생성합니다. 버킷 0 → 라우터 W, 버킷 1 → 라우터 E. 라우터 W가 제거되면 버킷 수가 1로 줄어들어 버킷 0과 1 모두 라우터 E로 매핑됩니다 — 라우터 W에 있던 플로우뿐만 아니라 모든 플로우가 영향을 받습니다.`,
  },
}

// ── EcmpGraph ─────────────────────────────────────────────────────────────────────

function EcmpGraph({ frame, t }: { frame: EcmpFrame; t: typeof T['en'] }) {
  return (
    <div className="ecmp-graph-canvas">
      <svg viewBox={`0 0 ${EGW} ${EGH}`} className="ecmp-graph-svg" preserveAspectRatio="none">
        <defs>
          {ECMP_LINKS.map(({ id }) => (
            <path key={id} id={`ecmpp-${id}`} d={ECMP_LINK_PATHS[id]} fill="none" />
          ))}
        </defs>

        {ECMP_LINKS.map(({ id, from, to }) => {
          const [x1, y1] = ECMP_PX[from]
          const [x2, y2] = ECMP_PX[to]
          return (
            <line key={id} x1={x1} y1={y1} x2={x2} y2={y2}
              className={`ecmp-sline ecmp-sline-${frame.links[id]}`} strokeWidth="2" />
          )
        })}

        {ECMP_LINKS.map(({ id }) => {
          if (frame.links[id] !== 'active') return null
          return (
            <circle key={`dot-${id}`} r="5" className="ecmp-gdot">
              <animateMotion dur="0.9s" repeatCount="indefinite">
                <mpath href={`#ecmpp-${id}`} />
              </animateMotion>
            </circle>
          )
        })}
      </svg>

      {ECMP_NODE_IDS.map(nid => {
        const [px, py] = ECMP_PX[nid]
        const st = frame.nodes[nid]
        return (
          <div key={nid}
            className={`ecmp-gnode ecmp-gnode-${st}`}
            style={{ left: `${(px / EGW) * 100}%`, top: `${(py / EGH) * 100}%` }}
          >
            <span className="ecmp-gnode-label">{t.nodeLabel[nid]}</span>
            <span className="ecmp-gnode-sub">{t.nodeSub[nid]}</span>
            {st === 'down' && <span className="ecmp-down-badge">{t.downBadge}</span>}
          </div>
        )
      })}
    </div>
  )
}

// ── EcmpExplorer ──────────────────────────────────────────────────────────────────

function EcmpExplorer() {
  const { lang } = useLang()
  const t     = T[lang]
  const total = ECMP_FRAMES.length
  const [step, setStep]       = useState(0)
  const [playing, setPlaying] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLast   = step >= total - 1

  useEffect(() => {
    if (!playing) return
    if (isLast) { setPlaying(false); return }
    timerRef.current = setTimeout(() => setStep(s => s + 1), 1400)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [playing, step, isLast])

  function reset()   { setPlaying(false); setStep(0) }
  function stepFwd() { if (!isLast) setStep(s => s + 1) }
  function handlePlay() {
    if (isLast) { reset(); setTimeout(() => setPlaying(true), 50); return }
    setPlaying(p => !p)
  }

  const lbl = {
    reset:  lang === 'ko' ? '초기화'   : 'Reset',
    play:   lang === 'ko' ? '재생'     : 'Play',
    pause:  lang === 'ko' ? '일시정지' : 'Pause',
    resume: lang === 'ko' ? '계속'     : 'Resume',
    replay: lang === 'ko' ? '다시보기' : 'Replay',
    step:   lang === 'ko' ? '다음 →'  : 'Step →',
  }
  const ft = t.frames[step]

  return (
    <div className="inet-root">
      <EcmpGraph frame={ECMP_FRAMES[step]} t={t} />
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

// ── Hash table ────────────────────────────────────────────────────────────────────

function HashTable() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <div className="ov-proto-section">
      <div className="bgp2-section-title">{t.hashTitle}</div>
      <table className="ov-proto-table">
        <thead>
          <tr>{t.hashHeaders.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.hashRows.map(r => (
            <tr key={r.flow}>
              <td><code>Flow {r.flow}</code></td>
              <td><code className="ecmp-port-code">{r.srcPort}</code></td>
              <td><code>{r.bucket}</code></td>
              <td>{r.nexthop}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ecmp-hash-note">{t.hashNote}</p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────────

export default function EcmpPage() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-06-23"
      readTime={t.readTime}
      tags={['networking', 'routing', 'ecmp', 'datacenter']}
      intro={t.intro}
    >
      <div className="bgp2-section-title">{t.sectionExplorer}</div>
      <EcmpExplorer />
      <div className="bgp2-section-title" style={{ marginTop: 28 }}>{t.sectionHash}</div>
      <HashTable />
    </NoteLayout>
  )
}
