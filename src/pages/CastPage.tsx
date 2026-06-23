import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ────────────────────────────────────────────────────────────────────────

type CastNodeId = 'src' | 'rtr' | 'sva' | 'svb' | 'svc'
type CastNodeSt = 'idle' | 'active' | 'done' | 'nearest'
type CastLinkId = 'src_rtr' | 'rtr_sva' | 'rtr_svb' | 'rtr_svc'
type CastLinkSt = 'idle' | 'active' | 'done'
type CastMode   = 'none' | 'unicast' | 'multicast' | 'anycast'

interface CastFrame {
  nodes:   Record<CastNodeId, CastNodeSt>
  links:   Record<CastLinkId, CastLinkSt>
  mode:    CastMode
  members: CastNodeId[]
}

type EcmpNodeId = 'esrc' | 'rtw' | 'rte' | 'edst'
type EcmpNodeSt = 'idle' | 'active' | 'done'
type EcmpLinkId = 'esrc_rtw' | 'esrc_rte' | 'rtw_edst' | 'rte_edst'
type EcmpLinkSt = 'idle' | 'active' | 'done'

interface EcmpFrame {
  nodes: Record<EcmpNodeId, EcmpNodeSt>
  links: Record<EcmpLinkId, EcmpLinkSt>
}

// ── Graph geometry ───────────────────────────────────────────────────────────────

const CGW = 500
const CGH = 185

const CAST_PX: Record<CastNodeId, [number, number]> = {
  src: [70,  92],
  rtr: [240, 92],
  sva: [420, 25],
  svb: [420, 92],
  svc: [420, 160],
}
const CAST_NODE_IDS: CastNodeId[] = ['src', 'rtr', 'sva', 'svb', 'svc']

const CAST_LINKS: Array<{ id: CastLinkId; from: CastNodeId; to: CastNodeId }> = [
  { id: 'src_rtr', from: 'src', to: 'rtr' },
  { id: 'rtr_sva', from: 'rtr', to: 'sva' },
  { id: 'rtr_svb', from: 'rtr', to: 'svb' },
  { id: 'rtr_svc', from: 'rtr', to: 'svc' },
]

const CAST_LINK_PATHS: Record<CastLinkId, string> = {
  src_rtr: `M ${CAST_PX.src[0]} ${CAST_PX.src[1]} L ${CAST_PX.rtr[0]} ${CAST_PX.rtr[1]}`,
  rtr_sva: `M ${CAST_PX.rtr[0]} ${CAST_PX.rtr[1]} L ${CAST_PX.sva[0]} ${CAST_PX.sva[1]}`,
  rtr_svb: `M ${CAST_PX.rtr[0]} ${CAST_PX.rtr[1]} L ${CAST_PX.svb[0]} ${CAST_PX.svb[1]}`,
  rtr_svc: `M ${CAST_PX.rtr[0]} ${CAST_PX.rtr[1]} L ${CAST_PX.svc[0]} ${CAST_PX.svc[1]}`,
}

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

const CN0: Record<CastNodeId, CastNodeSt> = { src: 'idle', rtr: 'idle', sva: 'idle', svb: 'idle', svc: 'idle' }
const CL0: Record<CastLinkId, CastLinkSt> = { src_rtr: 'idle', rtr_sva: 'idle', rtr_svb: 'idle', rtr_svc: 'idle' }

const CAST_FRAMES: CastFrame[] = [
  { nodes: CN0, links: CL0, mode: 'none', members: [] },
  {
    nodes: { ...CN0, src: 'active', rtr: 'active', svb: 'active' },
    links: { ...CL0, src_rtr: 'active', rtr_svb: 'active' },
    mode: 'unicast', members: [],
  },
  {
    nodes: { ...CN0, src: 'active', rtr: 'active', sva: 'active', svc: 'active' },
    links: { ...CL0, src_rtr: 'active', rtr_sva: 'active', rtr_svc: 'active' },
    mode: 'multicast', members: ['sva', 'svc'],
  },
  {
    nodes: { ...CN0, src: 'active', rtr: 'active', sva: 'nearest' },
    links: { ...CL0, src_rtr: 'active', rtr_sva: 'active' },
    mode: 'anycast', members: [],
  },
]

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
]

// ── Translations ─────────────────────────────────────────────────────────────────

const T = {
  en: {
    title:    'Unicast, multicast, and anycast',
    readTime: '5 min',
    intro:    `Every packet needs a destination address — but not all addresses work the same way. Unicast sends to one specific host. Multicast sends to every host that joined a group. Anycast sends to the nearest of several hosts that all share the same IP. These three models cover most of what happens on the internet. ECMP (Equal-Cost Multi-Path) is not an addressing mode itself but the routing mechanism that makes anycast and load-balanced unicast work at scale — it distributes flows across parallel paths using a per-flow 5-tuple hash.`,
    sectionCast: 'Addressing modes',
    sectionEcmp: 'ECMP — equal-cost multi-path',
    castNodeLabel: { src: 'Sender', rtr: 'Router', sva: 'Server A', svb: 'Server B', svc: 'Server C' } as Record<CastNodeId, string>,
    castNodeSub:        { src: '10.0.0.1', rtr: 'core-rtr', sva: '10.0.1.1', svb: '10.0.1.2', svc: '10.0.1.3' } as Record<CastNodeId, string>,
    castNodeSubAnycast: { src: '10.0.0.1', rtr: 'core-rtr', sva: '1.1.1.1 · PoP A', svb: '1.1.1.1 · PoP B', svc: '1.1.1.1 · PoP C' } as Record<CastNodeId, string>,
    modeBadge:    { unicast: 'UNICAST', multicast: 'MULTICAST', anycast: 'ANYCAST' } as Record<string, string>,
    nearestBadge: 'nearest',
    memberBadge:  'group member',
    ecmpNodeLabel: { esrc: 'Source', rtw: 'Router W', rte: 'Router E', edst: 'Destination' } as Record<EcmpNodeId, string>,
    ecmpNodeSub:   { esrc: '10.0.0.5', rtw: 'cost 10', rte: 'cost 10', edst: '203.0.113.1' } as Record<EcmpNodeId, string>,
    castFrames: [
      {
        title: 'Topology — one sender, one router, three servers',
        note: `The topology is a single sender connected via a router to three servers. In unicast each server has a unique IP. In multicast servers subscribe to a shared group address. In anycast all three servers advertise the same IP. The addressing mode determines which server actually receives the packet — the router's forwarding logic is different in each case.`,
      },
      {
        title: 'Unicast — one source, one specific receiver',
        note: `The sender specifies Server B's IP (10.0.1.2) as the destination. The router looks up 10.0.1.2 in its forwarding table and delivers the packet to exactly one host. Servers A and C never see it. Unicast is the default for all TCP connections, HTTP, and SSH — any time you need a guaranteed, point-to-point channel to a known address.`,
      },
      {
        title: 'Multicast — one packet, delivered to all group members',
        note: `The sender addresses the packet to a multicast group (224.0.0.5). Servers A and C joined this group via IGMP; Server B has not. The router delivers a copy only to group members — A and C. One transmission from the sender, one copy per subscribing branch. Used for video streaming, OSPF hello packets, and PIM route updates where sending N unicast copies would waste bandwidth.`,
      },
      {
        title: 'Anycast — same IP on multiple servers, nearest one wins',
        note: `All three servers advertise the same IP (1.1.1.1) into BGP. The router selects the route with the shortest BGP path — Server A is topologically nearest. The sender's packet is forwarded there without knowing the other servers exist. Cloudflare's 1.1.1.1 and all 13 DNS root server clusters work this way: the IP is fixed, but which datacenter answers depends on where in the world you are.`,
      },
    ],
    ecmpFrames: [
      {
        title: 'ECMP — two equal-cost paths to the same destination',
        note: `Router W and Router E both have the same routing cost (metric 10) to 203.0.113.1. The source router installs both next-hops in its forwarding table simultaneously. Without ECMP only one path would carry traffic and the other would sit idle; ECMP lets both operate at full capacity at the same time.`,
      },
      {
        title: 'Flow A — 5-tuple hash selects the West path',
        note: `The router computes a hash over the 5-tuple (src IP, dst IP, protocol, src port, dst port). Flow A's source port 52341 hashes to bucket 0, mapping to Router W. Every packet in Flow A follows the same path — per-flow consistency is essential so TCP does not receive out-of-order segments from packets taking different paths at different speeds.`,
      },
      {
        title: 'Flow B — 5-tuple hash selects the East path',
        note: `Flow B's source port 49102 hashes to bucket 1 — Router E. A different source port produces a different hash output, a different bucket, a different next-hop. Two concurrent TCP connections between the exact same pair of hosts can use different physical paths simultaneously without either connection reordering packets.`,
      },
      {
        title: 'Both flows in flight — traffic balanced across paths',
        note: `With many flows the hash distributes traffic across all equal-cost next-hops roughly evenly. ECMP is how spine-leaf data center fabrics use every uplink simultaneously. It also underlies anycast at scale: ECMP within a PoP distributes flows across servers inside the datacenter, while anycast BGP routes each client to the nearest PoP cluster.`,
      },
    ],
    tableTitle:   'Addressing mode comparison',
    tableHeaders: ['Mode', 'Destination address', 'Receivers', 'Typical use'],
    tableRows: [
      { mode: 'Unicast',   dest: 'Specific IP (e.g. 10.0.1.2)',  recv: 'Exactly 1',           use: 'TCP, HTTP, SSH, DNS response' },
      { mode: 'Multicast', dest: '224.0.0.0/4 · FF00::/8',       recv: 'All group members',   use: 'Video streaming, OSPF, PIM, mDNS' },
      { mode: 'Anycast',   dest: 'Shared IP (N nodes)',           recv: 'Nearest 1',           use: 'DNS root servers, CDN PoPs, 1.1.1.1' },
      { mode: 'Broadcast', dest: '255.255.255.255',               recv: 'All hosts on subnet', use: 'ARP, DHCP discovery' },
      { mode: 'ECMP',      dest: '(path-selection mechanism)',    recv: '1 path per flow',     use: 'Spine-leaf fabric, anycast load split' },
    ],
  },
  ko: {
    title:    '유니캐스트, 멀티캐스트, 애니캐스트',
    readTime: '5분',
    intro:    `모든 패킷에는 목적지 주소가 필요하지만 주소가 모두 같은 방식으로 동작하지는 않습니다. 유니캐스트는 특정 호스트 하나에 전송하고, 멀티캐스트는 그룹에 가입한 모든 호스트에 전송하며, 애니캐스트는 동일한 IP를 공유하는 여러 호스트 중 가장 가까운 곳에 전송합니다. 이 세 가지 모델이 인터넷에서 일어나는 대부분의 통신을 담당합니다. ECMP(Equal-Cost Multi-Path)는 주소 지정 모드 자체는 아니지만, 애니캐스트와 로드 밸런싱된 유니캐스트를 규모 있게 동작시키는 라우팅 메커니즘입니다. 플로우별 5-튜플 해시를 사용해 트래픽을 여러 병렬 경로에 분산합니다.`,
    sectionCast: '주소 지정 모드',
    sectionEcmp: 'ECMP — 동일 비용 다중 경로',
    castNodeLabel: { src: '송신자', rtr: '라우터', sva: '서버 A', svb: '서버 B', svc: '서버 C' } as Record<CastNodeId, string>,
    castNodeSub:        { src: '10.0.0.1', rtr: 'core-rtr', sva: '10.0.1.1', svb: '10.0.1.2', svc: '10.0.1.3' } as Record<CastNodeId, string>,
    castNodeSubAnycast: { src: '10.0.0.1', rtr: 'core-rtr', sva: '1.1.1.1 · PoP A', svb: '1.1.1.1 · PoP B', svc: '1.1.1.1 · PoP C' } as Record<CastNodeId, string>,
    modeBadge:    { unicast: 'UNICAST', multicast: 'MULTICAST', anycast: 'ANYCAST' } as Record<string, string>,
    nearestBadge: '가장 가까운',
    memberBadge:  '그룹 멤버',
    ecmpNodeLabel: { esrc: '출발지', rtw: '라우터 W', rte: '라우터 E', edst: '목적지' } as Record<EcmpNodeId, string>,
    ecmpNodeSub:   { esrc: '10.0.0.5', rtw: '비용 10', rte: '비용 10', edst: '203.0.113.1' } as Record<EcmpNodeId, string>,
    castFrames: [
      {
        title: '토폴로지 — 송신자 1개, 라우터 1개, 서버 3개',
        note: `토폴로지는 라우터를 통해 세 서버에 연결된 하나의 송신자입니다. 유니캐스트에서 각 서버는 고유한 IP를 가집니다. 멀티캐스트에서 서버들은 공유 그룹 주소를 구독합니다. 애니캐스트에서는 세 서버 모두 동일한 IP를 광고합니다. 주소 지정 모드에 따라 어느 서버가 실제로 패킷을 받을지 결정됩니다 — 각 경우에 라우터의 포워딩 로직이 다르게 동작합니다.`,
      },
      {
        title: '유니캐스트 — 출발지 1개, 특정 수신자 1개',
        note: `송신자가 서버 B의 IP(10.0.1.2)를 목적지로 지정합니다. 라우터는 포워딩 테이블에서 10.0.1.2를 조회하여 정확히 하나의 호스트에 패킷을 전달합니다. 서버 A와 C는 이 패킷을 받지 못합니다. 유니캐스트는 모든 TCP 연결, HTTP, SSH의 기본 모드입니다. 알려진 주소의 특정 엔드포인트와 보장된 지점 간 채널이 필요할 때 사용됩니다.`,
      },
      {
        title: '멀티캐스트 — 패킷 하나, 모든 그룹 멤버에게 전달',
        note: `송신자가 패킷을 멀티캐스트 그룹(224.0.0.5)으로 보냅니다. 서버 A와 C는 IGMP를 통해 이 그룹에 가입했고 서버 B는 가입하지 않았습니다. 라우터는 그룹 멤버인 A와 C에게만 복사본을 전달합니다. 송신자로부터 하나의 전송으로 구독 브랜치별 복사본이 생성됩니다. N개의 유니캐스트 복사본 전송이 대역폭을 낭비할 때 사용됩니다. 비디오 스트리밍, OSPF 헬로 패킷, PIM 경로 업데이트에 활용됩니다.`,
      },
      {
        title: '애니캐스트 — 여러 서버가 같은 IP, 가장 가까운 서버가 응답',
        note: `세 서버 모두 동일한 IP(1.1.1.1)를 BGP에 광고합니다. 라우터는 BGP 경로가 가장 짧은 경로를 선택합니다 — 서버 A가 위상적으로 가장 가깝습니다. 송신자의 패킷은 다른 서버들의 존재를 알지 못한 채 그곳으로 전달됩니다. Cloudflare의 1.1.1.1과 13개 DNS 루트 서버 클러스터가 이 방식으로 동작합니다: IP는 고정되어 있지만, 어느 데이터센터가 응답하는지는 위치에 따라 달라집니다.`,
      },
    ],
    ecmpFrames: [
      {
        title: 'ECMP — 동일 목적지로 향하는 두 개의 동일 비용 경로',
        note: `라우터 W와 라우터 E 모두 203.0.113.1까지의 라우팅 비용이 동일합니다(메트릭 10). 출발지 라우터는 두 넥스트홉을 동시에 포워딩 테이블에 설치합니다. ECMP 없이는 하나의 경로만 트래픽을 전달하고 나머지는 유휴 상태가 됩니다. ECMP를 통해 두 경로가 동시에 최대 용량으로 동작할 수 있습니다.`,
      },
      {
        title: '플로우 A — 5-튜플 해시로 West 경로 선택',
        note: `라우터는 5-튜플(출발지 IP, 목적지 IP, 프로토콜, 출발지 포트, 목적지 포트)에 대해 해시를 계산합니다. 플로우 A의 출발지 포트 52341은 버킷 0으로 해시되어 라우터 W에 매핑됩니다. 플로우 A의 모든 패킷이 동일한 경로를 따릅니다 — 플로우별 일관성은 서로 다른 속도의 경로를 통해 패킷이 도착했을 때 TCP가 순서를 잃지 않도록 보장하는 데 필수적입니다.`,
      },
      {
        title: '플로우 B — 5-튜플 해시로 East 경로 선택',
        note: `플로우 B의 출발지 포트는 49102입니다. 다른 출발지 포트는 다른 해시 출력을 만들고, 다른 버킷을 거쳐, 다른 넥스트홉으로 연결됩니다. 완전히 동일한 두 호스트 쌍 간의 두 TCP 연결이 어느 쪽도 패킷 순서를 잃지 않고 동시에 서로 다른 물리적 경로를 사용할 수 있습니다.`,
      },
      {
        title: '두 플로우 동시 전송 — 경로 간 트래픽 분산',
        note: `많은 플로우가 있을 때 해시 함수는 트래픽을 모든 동일 비용 넥스트홉에 고르게 분산합니다. ECMP는 스파인-리프 데이터센터 패브릭이 모든 업링크를 동시에 활용하는 방법입니다. 또한 대규모 애니캐스트의 핵심이기도 합니다: PoP 내 ECMP는 데이터센터 내 서버들에 플로우를 분산하고, 애니캐스트 BGP는 각 클라이언트를 가장 가까운 PoP 클러스터로 라우팅합니다.`,
      },
    ],
    tableTitle:   '주소 지정 모드 비교',
    tableHeaders: ['모드', '목적지 주소', '수신자', '주요 용도'],
    tableRows: [
      { mode: '유니캐스트',   dest: '특정 IP (예: 10.0.1.2)',       recv: '정확히 1개',          use: 'TCP, HTTP, SSH, DNS 응답' },
      { mode: '멀티캐스트',   dest: '224.0.0.0/4 · FF00::/8',      recv: '모든 그룹 멤버',      use: '비디오 스트리밍, OSPF, PIM' },
      { mode: '애니캐스트',   dest: '여러 노드가 공유하는 IP',       recv: '가장 가까운 1개',     use: 'DNS 루트, CDN PoP, 1.1.1.1' },
      { mode: '브로드캐스트', dest: '255.255.255.255',              recv: '서브넷의 모든 호스트', use: 'ARP, DHCP 탐색' },
      { mode: 'ECMP',        dest: '(경로 선택 메커니즘)',           recv: '플로우당 1개 경로',   use: '스파인-리프 패브릭, 애니캐스트 분산' },
    ],
  },
}

// ── Shared controls ───────────────────────────────────────────────────────────────

function ctrlLbls(lang: string) {
  return {
    reset:  lang === 'ko' ? '초기화'   : 'Reset',
    play:   lang === 'ko' ? '재생'     : 'Play',
    pause:  lang === 'ko' ? '일시정지' : 'Pause',
    resume: lang === 'ko' ? '계속'     : 'Resume',
    replay: lang === 'ko' ? '다시보기' : 'Replay',
    step:   lang === 'ko' ? '다음 →'  : 'Step →',
  }
}

// ── CastGraph ─────────────────────────────────────────────────────────────────────

function CastGraph({ frame, t }: { frame: CastFrame; t: typeof T['en'] }) {
  const nodeSub = frame.mode === 'anycast' ? t.castNodeSubAnycast : t.castNodeSub
  return (
    <div className="cast-graph-canvas">
      <svg viewBox={`0 0 ${CGW} ${CGH}`} className="cast-graph-svg" preserveAspectRatio="none">
        <defs>
          {CAST_LINKS.map(({ id }) => (
            <path key={id} id={`castp-${id}`} d={CAST_LINK_PATHS[id]} fill="none" />
          ))}
        </defs>

        {CAST_LINKS.map(({ id, from, to }) => {
          const [x1, y1] = CAST_PX[from]
          const [x2, y2] = CAST_PX[to]
          return (
            <line key={id} x1={x1} y1={y1} x2={x2} y2={y2}
              className={`cast-sline cast-sline-${frame.links[id]}`} strokeWidth="2" />
          )
        })}

        {CAST_LINKS.map(({ id }) => {
          if (frame.links[id] !== 'active') return null
          return (
            <circle key={`dot-${id}`} r="5" className="cast-gdot">
              <animateMotion dur="0.9s" repeatCount="indefinite">
                <mpath href={`#castp-${id}`} />
              </animateMotion>
            </circle>
          )
        })}
      </svg>

      {frame.mode !== 'none' && (
        <span className={`cast-mode-badge cast-mode-${frame.mode}`}>
          {t.modeBadge[frame.mode]}
        </span>
      )}

      {CAST_NODE_IDS.map(nid => {
        const [px, py] = CAST_PX[nid]
        const st = frame.nodes[nid]
        const isMember = frame.members.includes(nid)
        return (
          <div key={nid}
            className={`cast-gnode cast-gnode-${st}`}
            style={{ left: `${(px / CGW) * 100}%`, top: `${(py / CGH) * 100}%` }}
          >
            <span className="cast-gnode-label">{t.castNodeLabel[nid]}</span>
            <span className="cast-gnode-sub">{nodeSub[nid]}</span>
            {st === 'nearest' && <span className="cast-near-badge">{t.nearestBadge}</span>}
            {isMember && <span className="cast-member-badge">{t.memberBadge}</span>}
          </div>
        )
      })}
    </div>
  )
}

// ── CastExplorer ──────────────────────────────────────────────────────────────────

function CastExplorer() {
  const { lang } = useLang()
  const t     = T[lang]
  const total = CAST_FRAMES.length
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

  function reset() { setPlaying(false); setStep(0) }
  function stepFwd() { if (!isLast) setStep(s => s + 1) }
  function handlePlay() {
    if (isLast) { reset(); setTimeout(() => setPlaying(true), 50); return }
    setPlaying(p => !p)
  }

  const lbl = ctrlLbls(lang)
  const ft  = t.castFrames[step]

  return (
    <div className="inet-root">
      <CastGraph frame={CAST_FRAMES[step]} t={t} />
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

// ── EcmpGraph ─────────────────────────────────────────────────────────────────────

function EcmpGraph({ frame, t }: { frame: EcmpFrame; t: typeof T['en'] }) {
  return (
    <div className="cast-graph-canvas" style={{ height: EGH }}>
      <svg viewBox={`0 0 ${EGW} ${EGH}`} className="cast-graph-svg" preserveAspectRatio="none">
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
              className={`cast-sline cast-sline-${frame.links[id]}`} strokeWidth="2" />
          )
        })}

        {ECMP_LINKS.map(({ id }) => {
          if (frame.links[id] !== 'active') return null
          return (
            <circle key={`dot-${id}`} r="5" className="cast-gdot">
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
            className={`cast-gnode cast-gnode-${st}`}
            style={{ left: `${(px / EGW) * 100}%`, top: `${(py / EGH) * 100}%` }}
          >
            <span className="cast-gnode-label">{t.ecmpNodeLabel[nid]}</span>
            <span className="cast-gnode-sub">{t.ecmpNodeSub[nid]}</span>
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

  function reset() { setPlaying(false); setStep(0) }
  function stepFwd() { if (!isLast) setStep(s => s + 1) }
  function handlePlay() {
    if (isLast) { reset(); setTimeout(() => setPlaying(true), 50); return }
    setPlaying(p => !p)
  }

  const lbl = ctrlLbls(lang)
  const ft  = t.ecmpFrames[step]

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

// ── Mode table ────────────────────────────────────────────────────────────────────

function ModeTable() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <div className="ov-proto-section">
      <div className="bgp2-section-title">{t.tableTitle}</div>
      <table className="ov-proto-table cast-mode-table">
        <thead>
          <tr>{t.tableHeaders.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.tableRows.map(r => (
            <tr key={r.mode}>
              <td><code>{r.mode}</code></td>
              <td><code className="cast-addr-code">{r.dest}</code></td>
              <td>{r.recv}</td>
              <td>{r.use}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────────

export default function CastPage() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-06-22"
      readTime={t.readTime}
      tags={['networking', 'routing', 'multicast', 'anycast']}
      intro={t.intro}
    >
      <div className="bgp2-section-title">{t.sectionCast}</div>
      <CastExplorer />
      <div className="bgp2-section-title" style={{ marginTop: 28 }}>{t.sectionEcmp}</div>
      <EcmpExplorer />
      <ModeTable />
    </NoteLayout>
  )
}
