import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type NodeId   = 'client' | 'isp3' | 'isp2' | 'ixp' | 'csp'
type NodeStatus = 'idle' | 'active' | 'done'
type LinkId   = 'lastmile' | 'transit1' | 'transit2' | 'peering' | 'ixpeer'
type LinkStatus = 'idle' | 'active' | 'done'

interface InetFrame {
  nodes: Record<NodeId, NodeStatus>
  links: Record<LinkId, LinkStatus>
  focus: NodeId
}

// ── Frame data ─────────────────────────────────────────────────────────────────

const IDLE_NODES: Record<NodeId, NodeStatus>   = { client: 'idle', isp3: 'idle', isp2: 'idle', ixp: 'idle', csp: 'idle' }
const IDLE_LINKS: Record<LinkId, LinkStatus>   = { lastmile: 'idle', transit1: 'idle', transit2: 'idle', peering: 'idle', ixpeer: 'idle' }

const FRAMES: InetFrame[] = [
  // 0 — initial
  { nodes: IDLE_NODES, links: IDLE_LINKS, focus: 'client' },
  // 1 — client active, last-mile lit
  { nodes: { ...IDLE_NODES, client: 'active' },
    links: { ...IDLE_LINKS, lastmile: 'active' },
    focus: 'client' },
  // 2 — Tier-3 ISP
  { nodes: { ...IDLE_NODES, client: 'done', isp3: 'active' },
    links: { ...IDLE_LINKS, lastmile: 'done', transit1: 'active' },
    focus: 'isp3' },
  // 3 — Tier-2 ISP
  { nodes: { ...IDLE_NODES, client: 'done', isp3: 'done', isp2: 'active' },
    links: { ...IDLE_LINKS, lastmile: 'done', transit1: 'done', transit2: 'active' },
    focus: 'isp2' },
  // 4 — IXP
  { nodes: { ...IDLE_NODES, client: 'done', isp3: 'done', isp2: 'done', ixp: 'active' },
    links: { ...IDLE_LINKS, lastmile: 'done', transit1: 'done', transit2: 'done', peering: 'active' },
    focus: 'ixp' },
  // 5 — CSP / AWS
  { nodes: { ...IDLE_NODES, client: 'done', isp3: 'done', isp2: 'done', ixp: 'done', csp: 'active' },
    links: { lastmile: 'done', transit1: 'done', transit2: 'done', peering: 'done', ixpeer: 'active' },
    focus: 'csp' },
]

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title:    'The Internet: a network of networks',
    readTime: '5 min',
    intro:    'The Internet is not a single network — it is tens of thousands of independently operated Autonomous Systems that agree to exchange routing information via BGP. Each AS has a number (ASN), a set of IP prefixes it owns, and a defined relationship with every neighbor: transit (paid) or peering (free). This note walks a packet from a home client to AWS and shows every AS boundary it crosses.',
    linkLabels: {
      lastmile:  'last-mile',
      transit1:  'transit',
      transit2:  'transit',
      peering:   'peering',
      ixpeer:    'IX peering',
    },
    nodes: {
      client: {
        label:   'Client',
        sub:     'home · mobile',
        badge:   'end device',
        badgeCls: 'inet-badge-client',
        asn:     '—  (no ASN)',
        role:    'An end device — laptop, phone, or desktop — is not an Autonomous System. It has no ASN, no BGP session, and no routing table beyond a default route pointing at the home router. The ISP assigns an IP via DHCP (often behind CGNAT). BGP starts at the ISP\'s edge, not at the client.',
        links:   'Connected to the Tier-3 ISP via last-mile access: fiber-to-the-home (FTTH), cable (DOCSIS), DSL, or 4G/5G. The home router performs NAT — the client\'s RFC 1918 address (192.168.x.x) is never visible on the public internet.',
        examples: 'Your laptop at home. A smartphone on LTE. Any device behind a home router.',
      },
      isp3: {
        label:   'Tier-3 ISP',
        sub:     'access / local',
        badge:   'ISP tier-3',
        badgeCls: 'inet-badge-isp3',
        asn:     'e.g. AS12345',
        role:    'A small access ISP sells last-mile connectivity to homes and businesses. It buys all of its upstream transit from a Tier-2 or Tier-1 provider — it has no peering agreements and no IX presence. Every route in its table comes from its upstream. If the upstream is down, the Tier-3 ISP is offline.',
        links:   'Upstream: pays a Tier-2 ISP for full transit (default-free table or partial routes). Downstream: sells access to residential and SMB customers. BGP is used between the Tier-3 and Tier-2 edge routers — the Tier-3 announces its own prefix block to the Tier-2.',
        examples: 'Small regional ISP, local cable company, rural broadband provider.',
      },
      isp2: {
        label:   'Tier-2 ISP',
        sub:     'regional carrier',
        badge:   'ISP tier-2',
        badgeCls: 'inet-badge-isp2',
        asn:     'e.g. AS7922',
        role:    'A regional or national carrier that both buys transit and peers. It has its own backbone and presence at Internet Exchanges. Peering at IXes replaces expensive upstream transit for traffic destined to IX members — reducing cost and latency. It may still buy Tier-1 transit for destinations it cannot reach via peering.',
        links:   'Upstream: partial or full transit from one or more Tier-1 carriers. Peers: bilateral or multilateral BGP sessions at IXes. Downstream: sells transit to Tier-3 ISPs and enterprise customers. A Tier-2 typically has a default-free routing table (full BGP table, ~1M prefixes).',
        examples: 'Comcast (AS7922), Deutsche Telekom (AS3320), Verizon (AS701).',
      },
      ixp: {
        label:   'IXP',
        sub:     'Internet Exchange',
        badge:   'exchange',
        badgeCls: 'inet-badge-ixp',
        asn:     'Route Server ASN',
        role:    'An Internet Exchange Point is a neutral facility with a shared Layer-2 switching fabric. Members connect a router to the switch and establish BGP sessions with other members — without paying transit fees. Traffic that flows across the IX avoids the public internet backbone entirely, reducing hops and latency.',
        links:   'Members peer bilaterally (direct BGP session per pair) or via a Route Server (RS). The RS has its own ASN, accepts routes from all members, and redistributes them — one BGP session gets you routes from every participating member. The IX fabric itself does not route IP — it is transparent L2.',
        examples: 'DE-CIX Frankfurt (largest by traffic), AMS-IX Amsterdam, Equinix IX, LINX London.',
      },
      csp: {
        label:   'CSP / AWS',
        sub:     'AS16509',
        badge:   'cloud',
        badgeCls: 'inet-badge-csp',
        asn:     'AS16509',
        role:    'Cloud providers like AWS operate massive, multi-homed ASes with global presence. AWS peers at 100+ IXes worldwide and has private peering agreements with major ISPs. Once traffic hits an AWS edge PoP, it travels over AWS\'s private backbone — not the public internet — to the destination region.',
        links:   'Inbound: IX peering, private peering (AWS Direct Connect partner locations), and some upstream transit as fallback. Internal: AWS Global Accelerator and the backbone carry traffic between edge PoPs and regional endpoints. The customer\'s EC2 instance sits deep inside a VPC behind several network layers.',
        examples: 'AWS (AS16509), Google (AS15169), Cloudflare (AS13335), Microsoft Azure (AS8075).',
      },
    },
    frames: [
      { title: 'Overview — Internet as Autonomous Systems',
        note:  'The Internet is ~80,000 Autonomous Systems, each independently operated and identified by an ASN (Autonomous System Number). They exchange reachability information using BGP (Border Gateway Protocol). Every AS decides its own routing policy: who it accepts routes from, who it sends routes to, and at what cost. No central authority controls the routing table.' },
      { title: 'Client — end device, no ASN',
        note:  'A home laptop or phone initiates a connection to 52.1.2.3 (an AWS IP). The device has no ASN — it is not part of the routing fabric. The home router performs NAT and forwards the packet to the ISP\'s edge. The last-mile link (fiber, cable, 4G) carries the packet to the first real AS boundary: the ISP\'s ingress router.' },
      { title: 'Tier-3 ISP — buys all transit upstream',
        note:  'The packet enters the Tier-3 ISP\'s network. The ISP announces its own prefix block (e.g., 203.0.113.0/24) to its upstream Tier-2 via BGP. For the return path, the Tier-3 has a default route (0.0.0.0/0) pointing upstream — it does not carry the full internet routing table. Transit from the Tier-2 is paid by the Tier-3.' },
      { title: 'Tier-2 ISP — transit and IX peering',
        note:  'The Tier-2 ISP carries the full BGP table (~1 million prefixes). It knows that 52.1.2.3 (AS16509 / AWS) is reachable via the IXP where both the Tier-2 and AWS peer. Instead of routing this traffic through a paid Tier-1 transit link, the Tier-2 sends it toward the IX — saving cost and reducing latency.' },
      { title: 'IXP — neutral Layer-2 fabric',
        note:  'The packet crosses the IX switching fabric. The Tier-2 ISP and AWS both have a router plugged into the IX. They have a BGP session established (either directly or via the Route Server). No transit fees are paid for IX traffic. The IX fabric does not modify the packet — it is transparent Ethernet switching at Layer 2.' },
      { title: 'CSP / AWS — edge PoP to VPC',
        note:  'AWS receives the packet at its IX-connected edge router. The destination IP (52.1.2.3) is in AWS\'s own address block — internal routing takes over. AWS Global Accelerator or the internal backbone carries the traffic to the correct region. The packet arrives at the EC2 instance inside a VPC, having crossed 4 AS boundaries and 1 IX fabric on the way.' },
    ],
  },
  ko: {
    title:    '인터넷: 네트워크들의 네트워크',
    readTime: '5분',
    intro:    '인터넷은 단일 네트워크가 아닙니다 — BGP를 통해 라우팅 정보를 교환하기로 합의한 수만 개의 독립적으로 운영되는 자율 시스템(AS)입니다. 각 AS는 AS 번호(ASN), 소유한 IP 프리픽스 집합, 그리고 각 이웃과의 관계(Transit 또는 Peering)를 가집니다. 이 노트는 홈 클라이언트에서 AWS까지 패킷을 따라가며 통과하는 모든 AS 경계를 보여줍니다.',
    linkLabels: {
      lastmile:  '라스트 마일',
      transit1:  'transit',
      transit2:  'transit',
      peering:   'peering',
      ixpeer:    'IX peering',
    },
    nodes: {
      client: {
        label:   '클라이언트',
        sub:     '가정 · 모바일',
        badge:   '엔드 디바이스',
        badgeCls: 'inet-badge-client',
        asn:     '— (ASN 없음)',
        role:    '노트북, 스마트폰, 데스크톱 같은 엔드 디바이스는 자율 시스템이 아닙니다. ASN도, BGP 세션도, 기본 경로 이외의 라우팅 테이블도 없습니다. ISP가 DHCP로 IP를 할당합니다(종종 CGNAT 뒤에서). BGP는 ISP 엣지에서 시작되며 클라이언트에서 시작되지 않습니다.',
        links:   '라스트 마일 액세스(광섬유, 케이블, DSL, 4G/5G)를 통해 Tier-3 ISP에 연결됩니다. 홈 라우터가 NAT를 수행합니다 — 클라이언트의 RFC 1918 주소(192.168.x.x)는 공개 인터넷에 노출되지 않습니다.',
        examples: '집에서 사용하는 노트북, LTE 스마트폰, 홈 라우터 뒤의 모든 기기.',
      },
      isp3: {
        label:   'Tier-3 ISP',
        sub:     '액세스 / 로컬',
        badge:   'ISP tier-3',
        badgeCls: 'inet-badge-isp3',
        asn:     '예: AS12345',
        role:    '소규모 액세스 ISP는 가정과 기업에 라스트 마일 연결을 판매합니다. 모든 상위 transit을 Tier-2 또는 Tier-1 제공자로부터 구매합니다 — 피어링 계약이나 IX 존재가 없습니다. 라우팅 테이블의 모든 경로는 상위 제공자에서 옵니다. 상위가 다운되면 Tier-3 ISP도 오프라인이 됩니다.',
        links:   '업스트림: Tier-2 ISP에 전체 transit 비용 지불. 다운스트림: 주거용 및 중소기업 고객에게 액세스 판매. Tier-3와 Tier-2 엣지 라우터 간에 BGP를 사용합니다 — Tier-3는 Tier-2에 자신의 프리픽스 블록을 공고합니다.',
        examples: '소규모 지역 ISP, 로컬 케이블 회사, 농촌 광대역 제공자.',
      },
      isp2: {
        label:   'Tier-2 ISP',
        sub:     '지역 통신사',
        badge:   'ISP tier-2',
        badgeCls: 'inet-badge-isp2',
        asn:     '예: AS7922',
        role:    'transit을 구매하면서도 피어링하는 지역 또는 국가 통신사입니다. 자체 백본과 인터넷 익스체인지 존재를 가집니다. IX에서 피어링은 IX 멤버 대상 트래픽에 대해 비싼 상위 transit을 대체합니다 — 비용과 지연시간을 줄입니다. 피어링으로 도달할 수 없는 목적지에는 Tier-1 transit을 구매할 수 있습니다.',
        links:   '업스트림: 하나 이상의 Tier-1 통신사로부터 부분 또는 전체 transit. 피어: IX에서 양자 또는 다자 BGP 세션. 다운스트림: Tier-3 ISP와 기업 고객에게 transit 판매. Tier-2는 일반적으로 디폴트 프리 라우팅 테이블(전체 BGP 테이블, ~100만 프리픽스)을 보유합니다.',
        examples: 'Comcast (AS7922), Deutsche Telekom (AS3320), Verizon (AS701).',
      },
      ixp: {
        label:   'IXP',
        sub:     '인터넷 익스체인지',
        badge:   '익스체인지',
        badgeCls: 'inet-badge-ixp',
        asn:     'Route Server ASN',
        role:    '인터넷 익스체인지 포인트는 공유 Layer-2 스위칭 패브릭을 갖춘 중립 시설입니다. 멤버는 스위치에 라우터를 연결하고 transit 비용 없이 다른 멤버와 BGP 세션을 맺습니다. IX를 통해 흐르는 트래픽은 공개 인터넷 백본을 완전히 피합니다.',
        links:   '멤버는 양자 피어링(쌍별 직접 BGP 세션) 또는 Route Server(RS)를 통해 피어링합니다. RS는 자체 ASN을 갖고 모든 멤버의 경로를 수락하여 재배포합니다 — BGP 세션 하나로 모든 참여 멤버의 경로를 얻습니다. IX 패브릭 자체는 IP를 라우팅하지 않습니다 — 투명한 L2입니다.',
        examples: 'DE-CIX 프랑크푸르트, AMS-IX 암스테르담, Equinix IX, LINX 런던.',
      },
      csp: {
        label:   'CSP / AWS',
        sub:     'AS16509',
        badge:   '클라우드',
        badgeCls: 'inet-badge-csp',
        asn:     'AS16509',
        role:    'AWS 같은 클라우드 제공자는 전 세계적으로 대규모 멀티홈 AS를 운영합니다. AWS는 전 세계 100개 이상의 IX에서 피어링하고 주요 ISP와 프라이빗 피어링 계약을 맺고 있습니다. 트래픽이 AWS 엣지 PoP에 도달하면 공개 인터넷이 아닌 AWS의 프라이빗 백본을 통해 목적지 리전으로 이동합니다.',
        links:   '인바운드: IX 피어링, 프라이빗 피어링(AWS Direct Connect 파트너 위치), 일부 상위 transit(폴백). 내부: AWS Global Accelerator와 백본이 엣지 PoP와 리전 엔드포인트 간 트래픽을 전달합니다. 고객의 EC2 인스턴스는 VPC 내부 깊숙이 여러 네트워크 레이어 뒤에 있습니다.',
        examples: 'AWS (AS16509), Google (AS15169), Cloudflare (AS13335), Microsoft Azure (AS8075).',
      },
    },
    frames: [
      { title: '개요 — 자율 시스템으로서의 인터넷',
        note:  '인터넷은 약 8만 개의 자율 시스템으로 구성되며, 각각 독립적으로 운영되고 ASN(자율 시스템 번호)으로 식별됩니다. BGP(경계 게이트웨이 프로토콜)를 통해 도달 가능성 정보를 교환합니다. 각 AS는 자체 라우팅 정책을 결정합니다. 라우팅 테이블을 제어하는 중앙 기관은 없습니다.' },
      { title: '클라이언트 — 엔드 디바이스, ASN 없음',
        note:  '홈 노트북 또는 스마트폰이 52.1.2.3(AWS IP)에 연결을 시작합니다. 디바이스는 ASN이 없습니다 — 라우팅 패브릭의 일부가 아닙니다. 홈 라우터가 NAT를 수행하고 패킷을 ISP 엣지로 전달합니다. 라스트 마일 링크(광섬유, 케이블, 4G)가 첫 번째 AS 경계인 ISP 인그레스 라우터로 패킷을 전달합니다.' },
      { title: 'Tier-3 ISP — 모든 transit을 상위에서 구매',
        note:  '패킷이 Tier-3 ISP 네트워크에 진입합니다. ISP는 자신의 프리픽스 블록을 BGP로 상위 Tier-2에 공고합니다. 리턴 경로에서 Tier-3는 상위를 가리키는 기본 경로(0.0.0.0/0)를 가집니다 — 전체 인터넷 라우팅 테이블을 보유하지 않습니다. Tier-2의 transit 비용은 Tier-3가 지불합니다.' },
      { title: 'Tier-2 ISP — transit과 IX 피어링',
        note:  'Tier-2 ISP는 전체 BGP 테이블(~100만 프리픽스)을 보유합니다. 52.1.2.3(AS16509/AWS)이 Tier-2와 AWS가 모두 피어링하는 IXP를 통해 도달 가능함을 알고 있습니다. 유료 Tier-1 transit 링크 대신 IX로 트래픽을 보냅니다 — 비용 절감과 지연시간 감소.' },
      { title: 'IXP — 중립 Layer-2 패브릭',
        note:  '패킷이 IX 스위칭 패브릭을 통과합니다. Tier-2 ISP와 AWS 모두 IX에 라우터를 연결했습니다. 직접 또는 Route Server를 통해 BGP 세션이 수립되어 있습니다. IX 트래픽에는 transit 비용이 없습니다. IX 패브릭은 패킷을 수정하지 않습니다 — Layer 2의 투명한 이더넷 스위칭입니다.' },
      { title: 'CSP / AWS — 엣지 PoP에서 VPC로',
        note:  'AWS가 IX 연결 엣지 라우터에서 패킷을 수신합니다. 목적지 IP(52.1.2.3)가 AWS의 자체 주소 블록에 있습니다 — 내부 라우팅이 인계받습니다. AWS Global Accelerator 또는 내부 백본이 트래픽을 올바른 리전으로 전달합니다. 패킷은 4개의 AS 경계와 1개의 IX 패브릭을 통과하여 VPC 내부의 EC2 인스턴스에 도달합니다.' },
    ],
  },
}

// ── Topology component ─────────────────────────────────────────────────────────

const NODE_ORDER: NodeId[] = ['client', 'isp3', 'isp2', 'ixp', 'csp']
const LINK_ORDER: LinkId[] = ['lastmile', 'transit1', 'transit2', 'peering', 'ixpeer']

function TopoNode({ id, status, label, sub, onClick, active }: {
  id: NodeId; status: NodeStatus; label: string; sub: string
  onClick: () => void; active: boolean
}) {
  return (
    <button
      className={`inet-node inet-node-${id} inet-node-${status}${active ? ' inet-node-focus' : ''}`}
      onClick={onClick}
      type="button"
    >
      <span className="inet-node-label">{label}</span>
      <span className="inet-node-sub">{sub}</span>
    </button>
  )
}

function TopoLink({ id, status, label }: { id: LinkId; status: LinkStatus; label: string }) {
  return (
    <div className={`inet-link inet-link-${status}`}>
      <div className="inet-link-line">
        {status === 'active' && <div className="inet-link-dot" key={id} />}
      </div>
      <span className="inet-link-label">{label}</span>
    </div>
  )
}

function Topology({ frame, focus, onFocus, linkLabels, nodeLabels }: {
  frame: InetFrame
  focus: NodeId
  onFocus: (id: NodeId) => void
  linkLabels: Record<LinkId, string>
  nodeLabels: Record<NodeId, { label: string; sub: string }>
}) {
  return (
    <div className="inet-topo">
      {NODE_ORDER.map((nid, i) => (
        <>
          <TopoNode
            key={nid}
            id={nid}
            status={frame.nodes[nid]}
            label={nodeLabels[nid].label}
            sub={nodeLabels[nid].sub}
            onClick={() => onFocus(nid)}
            active={focus === nid}
          />
          {i < LINK_ORDER.length && (
            <TopoLink
              key={LINK_ORDER[i]}
              id={LINK_ORDER[i]}
              status={frame.links[LINK_ORDER[i]]}
              label={linkLabels[LINK_ORDER[i]]}
            />
          )}
        </>
      ))}
    </div>
  )
}

// ── Detail card ────────────────────────────────────────────────────────────────

function DetailCard({ nodeId, t, lang }: { nodeId: NodeId; t: typeof T['en']; lang: string }) {
  const node = t.nodes[nodeId]
  return (
    <div className="inet-detail">
      <div className="inet-detail-head">
        <span className="inet-detail-name">{node.label}</span>
        <code className="inet-detail-asn">{node.asn}</code>
        <span className={`inet-badge ${node.badgeCls}`}>{node.badge}</span>
      </div>
      <div className="inet-detail-body">
        <p className="inet-detail-role">{node.role}</p>
        <div className="inet-detail-row">
          <span className="inet-detail-key">{lang === 'ko' ? '연결' : 'Links'}</span>
          <span className="inet-detail-val">{node.links}</span>
        </div>
        <div className="inet-detail-row">
          <span className="inet-detail-key">{lang === 'ko' ? '사례' : 'Examples'}</span>
          <span className="inet-detail-val">{node.examples}</span>
        </div>
      </div>
    </div>
  )
}

// ── Explorer ───────────────────────────────────────────────────────────────────

function InetExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const total = FRAMES.length
  const [step, setStep]       = useState(0)
  const [focus, setFocus]     = useState<NodeId>('client')
  const [playing, setPlaying] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLast = step >= total - 1

  useEffect(() => {
    if (!playing) return
    if (isLast) { setPlaying(false); return }
    timerRef.current = setTimeout(() => {
      const next = step + 1
      setStep(next)
      setFocus(FRAMES[next].focus)
    }, 1200)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [playing, step, isLast])

  function reset() {
    setPlaying(false); setStep(0); setFocus(FRAMES[0].focus)
  }
  function stepFwd() {
    if (!isLast) { const next = step + 1; setStep(next); setFocus(FRAMES[next].focus) }
  }
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

  const nodeLabels: Record<NodeId, { label: string; sub: string }> = {
    client: { label: t.nodes.client.label, sub: t.nodes.client.sub },
    isp3:   { label: t.nodes.isp3.label,   sub: t.nodes.isp3.sub   },
    isp2:   { label: t.nodes.isp2.label,   sub: t.nodes.isp2.sub   },
    ixp:    { label: t.nodes.ixp.label,    sub: t.nodes.ixp.sub    },
    csp:    { label: t.nodes.csp.label,    sub: t.nodes.csp.sub    },
  }

  return (
    <div className="inet-root">
      <Topology
        frame={frame}
        focus={focus}
        onFocus={setFocus}
        linkLabels={t.linkLabels}
        nodeLabels={nodeLabels}
      />

      <DetailCard nodeId={focus} t={t} lang={lang} />

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

// ── Page ───────────────────────────────────────────────────────────────────────

export default function InetPage() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-06-22"
      readTime={t.readTime}
      tags={['networking', 'internet', 'bgp', 'routing', 'isp']}
      intro={t.intro}
    >
      <InetExplorer />
    </NoteLayout>
  )
}
