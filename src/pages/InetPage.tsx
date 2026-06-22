import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type NodeId     = 'client' | 'isp3' | 'isp2' | 'ixp' | 'csp'
type NodeStatus = 'idle' | 'active' | 'done'
type LinkId     = 'lastmile' | 'transit' | 'peering' | 'ixpeer'
type LinkStatus = 'idle' | 'active' | 'done'

interface InetFrame {
  nodes: Record<NodeId, NodeStatus>
  links: Record<LinkId, LinkStatus>
  focus: NodeId
}

// ── Graph geometry ─────────────────────────────────────────────────────────────

const GW = 600
const GH = 240

// Pixel positions within GW×GH coordinate space
const NODE_PX: Record<NodeId, [number, number]> = {
  client: [48,  68],
  isp3:   [54,  172],
  isp2:   [272, 120],
  ixp:    [484, 50],
  csp:    [484, 190],
}

interface GLink { id: LinkId; from: NodeId; to: NodeId }
const GLINKS: GLink[] = [
  { id: 'lastmile', from: 'client', to: 'isp3' },
  { id: 'transit',  from: 'isp3',   to: 'isp2' },
  { id: 'peering',  from: 'isp2',   to: 'ixp'  },
  { id: 'ixpeer',   from: 'ixp',    to: 'csp'  },
]

// ── Frame data ─────────────────────────────────────────────────────────────────

const N0: Record<NodeId, NodeStatus>  = { client: 'idle', isp3: 'idle', isp2: 'idle', ixp: 'idle', csp: 'idle' }
const L0: Record<LinkId, LinkStatus>  = { lastmile: 'idle', transit: 'idle', peering: 'idle', ixpeer: 'idle' }

const FRAMES: InetFrame[] = [
  { nodes: N0, links: L0, focus: 'client' },
  { nodes: { ...N0, client: 'active' },
    links: { ...L0, lastmile: 'active' }, focus: 'client' },
  { nodes: { ...N0, client: 'done', isp3: 'active' },
    links: { ...L0, lastmile: 'done', transit: 'active' }, focus: 'isp3' },
  { nodes: { ...N0, client: 'done', isp3: 'done', isp2: 'active' },
    links: { ...L0, lastmile: 'done', transit: 'done', peering: 'active' }, focus: 'isp2' },
  { nodes: { ...N0, client: 'done', isp3: 'done', isp2: 'done', ixp: 'active' },
    links: { ...L0, lastmile: 'done', transit: 'done', peering: 'done', ixpeer: 'active' }, focus: 'ixp' },
  { nodes: { ...N0, client: 'done', isp3: 'done', isp2: 'done', ixp: 'done', csp: 'active' },
    links: { lastmile: 'done', transit: 'done', peering: 'done', ixpeer: 'done' }, focus: 'csp' },
]

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title: 'The Internet: a network of networks',
    readTime: '5 min',
    intro: 'The Internet is not a single network — it is tens of thousands of independently operated Autonomous Systems that agree to exchange routing information via BGP. Each AS has a number (ASN), a set of IP prefixes it owns, and a defined relationship with every neighbor: transit (paid) or peering (free). This note walks a packet from a home client to AWS and shows every AS boundary it crosses.',
    linkLabels: { lastmile: 'last-mile', transit: 'transit', peering: 'peering', ixpeer: 'IX peering' },
    nodes: {
      client: {
        label: 'Client', sub: 'home · mobile', badge: 'end device', badgeCls: 'inet-badge-client',
        asn: '—  (no ASN)',
        role: 'An end device — laptop, phone, or desktop — is not an Autonomous System. It has no ASN, no BGP session, and no routing table beyond a default route pointing at the home router. The ISP assigns an IP via DHCP (often behind CGNAT). BGP starts at the ISP\'s edge, not at the client.',
        links: 'Connected to the Tier-3 ISP via last-mile access: FTTH, cable (DOCSIS), DSL, or 4G/5G. The home router performs NAT — the client\'s RFC 1918 address is never visible on the public internet.',
        examples: 'Your laptop at home. A smartphone on LTE. Any device behind a home router.',
      },
      isp3: {
        label: 'Tier-3 ISP', sub: 'access / local', badge: 'ISP tier-3', badgeCls: 'inet-badge-isp3',
        asn: 'e.g. AS12345',
        role: 'A small access ISP sells last-mile connectivity to homes and businesses. It buys all of its upstream transit from a Tier-2 or Tier-1 provider — no peering agreements and no IX presence. Every route in its table comes from its upstream. If the upstream is down, the Tier-3 ISP is offline.',
        links: 'Upstream: pays a Tier-2 ISP for full transit. Downstream: sells access to residential and SMB customers. BGP announces its own prefix block to the Tier-2.',
        examples: 'Small regional ISP, local cable company, rural broadband provider.',
      },
      isp2: {
        label: 'Tier-2 ISP', sub: 'regional carrier', badge: 'ISP tier-2', badgeCls: 'inet-badge-isp2',
        asn: 'e.g. AS7922',
        role: 'A regional or national carrier that both buys transit and peers. It has its own backbone and presence at Internet Exchanges. Peering at IXes replaces expensive transit for traffic destined to IX members — reducing cost and latency.',
        links: 'Upstream: partial or full transit from Tier-1 carriers. Peers: BGP sessions at IXes. Downstream: sells transit to Tier-3 ISPs and enterprise customers. Carries a default-free routing table (~1M prefixes).',
        examples: 'Comcast (AS7922), Deutsche Telekom (AS3320), Verizon (AS701).',
      },
      ixp: {
        label: 'IXP', sub: 'Internet Exchange', badge: 'exchange', badgeCls: 'inet-badge-ixp',
        asn: 'Route Server ASN',
        role: 'An Internet Exchange Point is a neutral facility with a shared Layer-2 switching fabric. Members connect a router and establish BGP sessions — without paying transit fees. Traffic across the IX avoids the public internet backbone, reducing hops and latency.',
        links: 'Members peer bilaterally (per-pair BGP sessions) or via a Route Server. The RS accepts routes from all members and redistributes them — one session gets routes from every participant. The IX fabric is transparent L2.',
        examples: 'DE-CIX Frankfurt, AMS-IX Amsterdam, Equinix IX, LINX London.',
      },
      csp: {
        label: 'CSP / AWS', sub: 'AS16509', badge: 'cloud', badgeCls: 'inet-badge-csp',
        asn: 'AS16509',
        role: 'Cloud providers like AWS operate massive, multi-homed ASes with global presence. AWS peers at 100+ IXes worldwide. Once traffic hits an AWS edge PoP, it travels over AWS\'s private backbone — not the public internet — to the destination region.',
        links: 'Inbound: IX peering, private peering (Direct Connect partner locations), some upstream transit as fallback. Internal: AWS backbone carries traffic between edge PoPs and regional endpoints.',
        examples: 'AWS (AS16509), Google (AS15169), Cloudflare (AS13335), Azure (AS8075).',
      },
    },
    frames: [
      { title: 'Overview — Internet as Autonomous Systems',
        note: 'The Internet is ~80,000 Autonomous Systems, each independently operated and identified by an ASN. They exchange reachability information using BGP. Every AS decides its own routing policy: who it accepts routes from, who it sends routes to, and at what cost. No central authority controls the routing table.' },
      { title: 'Client — end device, no ASN',
        note: 'A home laptop initiates a connection to 52.1.2.3 (an AWS IP). The device has no ASN — it is not part of the routing fabric. The home router NATs and forwards to the ISP edge. The last-mile link carries the packet to the first real AS boundary: the ISP\'s ingress router.' },
      { title: 'Tier-3 ISP — buys all transit upstream',
        note: 'The Tier-3 ISP\'s network carries the packet. It has a default route (0.0.0.0/0) pointing upstream — no full internet table. Transit from the Tier-2 is paid. The Tier-3 announces its own prefix block to the Tier-2 via BGP.' },
      { title: 'Tier-2 ISP — transit and IX peering',
        note: 'The Tier-2 carries the full BGP table (~1M prefixes). It knows 52.1.2.3 (AS16509) is reachable via the IXP where both peer. Instead of routing through a paid Tier-1 transit link, it sends toward the IX — saving cost and reducing latency.' },
      { title: 'IXP — neutral Layer-2 fabric',
        note: 'The packet crosses the IX switching fabric. Tier-2 ISP and AWS both have a router on the IX. They have a BGP session (direct or via Route Server). No transit fees for IX traffic. The IX fabric does not modify the packet — transparent Ethernet switching at Layer 2.' },
      { title: 'CSP / AWS — edge PoP to VPC',
        note: 'AWS receives the packet at its IX-connected edge router. The destination IP is in AWS\'s own address block — internal routing takes over. AWS backbone carries traffic to the correct region. The packet arrives at the EC2 instance having crossed 4 AS boundaries and 1 IX fabric.' },
    ],
  },
  ko: {
    title: '인터넷: 네트워크들의 네트워크',
    readTime: '5분',
    intro: '인터넷은 단일 네트워크가 아닙니다 — BGP를 통해 라우팅 정보를 교환하는 수만 개의 독립 자율 시스템(AS)입니다. 각 AS는 ASN, 소유한 IP 프리픽스, 이웃과의 관계(Transit/Peering)를 가집니다. 이 노트는 홈 클라이언트에서 AWS까지 패킷이 통과하는 모든 AS 경계를 추적합니다.',
    linkLabels: { lastmile: '라스트 마일', transit: 'transit', peering: 'peering', ixpeer: 'IX peering' },
    nodes: {
      client: {
        label: '클라이언트', sub: '가정 · 모바일', badge: '엔드 디바이스', badgeCls: 'inet-badge-client',
        asn: '— (ASN 없음)',
        role: '노트북, 스마트폰 같은 엔드 디바이스는 자율 시스템이 아닙니다. ASN도, BGP 세션도, 기본 경로 이외의 라우팅 테이블도 없습니다. ISP가 DHCP로 IP를 할당합니다(종종 CGNAT). BGP는 ISP 엣지에서 시작됩니다.',
        links: '라스트 마일(광섬유, 케이블, DSL, 4G/5G)을 통해 Tier-3 ISP에 연결. 홈 라우터가 NAT 수행 — RFC 1918 주소는 공개 인터넷에 노출되지 않습니다.',
        examples: '집 노트북, LTE 스마트폰, 홈 라우터 뒤의 모든 기기.',
      },
      isp3: {
        label: 'Tier-3 ISP', sub: '액세스 / 로컬', badge: 'ISP tier-3', badgeCls: 'inet-badge-isp3',
        asn: '예: AS12345',
        role: '소규모 액세스 ISP는 가정과 기업에 라스트 마일 연결을 제공합니다. 모든 상위 transit을 Tier-2에서 구매하며 피어링 계약이나 IX 존재가 없습니다. 상위가 다운되면 함께 오프라인됩니다.',
        links: '업스트림: Tier-2에 transit 비용 지불. 다운스트림: 주거용/중소기업에 액세스 판매. 자신의 프리픽스를 Tier-2에 BGP 공고.',
        examples: '소규모 지역 ISP, 로컬 케이블 회사, 농촌 광대역 제공자.',
      },
      isp2: {
        label: 'Tier-2 ISP', sub: '지역 통신사', badge: 'ISP tier-2', badgeCls: 'inet-badge-isp2',
        asn: '예: AS7922',
        role: 'transit을 구매하면서도 IX에서 피어링하는 지역/국가 통신사입니다. 자체 백본과 IX 존재를 가집니다. IX 피어링은 IX 멤버 대상 트래픽의 비싼 transit을 대체합니다.',
        links: '업스트림: Tier-1에서 일부/전체 transit. 피어: IX에서 BGP 세션. 다운스트림: Tier-3와 기업에 transit 판매. 전체 BGP 테이블(~100만 프리픽스) 보유.',
        examples: 'Comcast (AS7922), Deutsche Telekom (AS3320), Verizon (AS701).',
      },
      ixp: {
        label: 'IXP', sub: '인터넷 익스체인지', badge: '익스체인지', badgeCls: 'inet-badge-ixp',
        asn: 'Route Server ASN',
        role: '공유 Layer-2 스위칭 패브릭을 갖춘 중립 시설입니다. 멤버는 라우터를 연결하고 transit 없이 BGP 세션을 맺습니다. IX 트래픽은 공개 인터넷 백본을 피해 홉과 지연시간을 줄입니다.',
        links: '양자 피어링(쌍별 BGP) 또는 Route Server를 통한 피어링. RS는 모든 멤버의 경로를 수집·재배포합니다. IX 패브릭은 투명한 L2 이더넷 스위칭입니다.',
        examples: 'DE-CIX 프랑크푸르트, AMS-IX 암스테르담, Equinix IX, LINX 런던.',
      },
      csp: {
        label: 'CSP / AWS', sub: 'AS16509', badge: '클라우드', badgeCls: 'inet-badge-csp',
        asn: 'AS16509',
        role: 'AWS는 전 세계 100개 이상의 IX에서 피어링하는 대규모 멀티홈 AS입니다. 트래픽이 엣지 PoP에 도달하면 공개 인터넷이 아닌 AWS 프라이빗 백본으로 목적지 리전까지 이동합니다.',
        links: '인바운드: IX 피어링, 프라이빗 피어링(Direct Connect 파트너), 일부 transit(폴백). 내부: AWS 백본이 엣지 PoP와 리전 간 트래픽을 전달합니다.',
        examples: 'AWS (AS16509), Google (AS15169), Cloudflare (AS13335), Azure (AS8075).',
      },
    },
    frames: [
      { title: '개요 — 자율 시스템으로서의 인터넷',
        note: '인터넷은 약 8만 개의 자율 시스템으로 구성되며 ASN으로 식별됩니다. BGP로 도달 가능성 정보를 교환하며 각 AS가 자체 라우팅 정책을 결정합니다. 라우팅 테이블을 제어하는 중앙 기관은 없습니다.' },
      { title: '클라이언트 — 엔드 디바이스, ASN 없음',
        note: '홈 노트북이 52.1.2.3(AWS IP)에 연결을 시작합니다. 디바이스는 ASN이 없습니다. 홈 라우터가 NAT를 수행하고 ISP 엣지로 전달합니다. 라스트 마일이 첫 AS 경계인 ISP 인그레스 라우터로 패킷을 전달합니다.' },
      { title: 'Tier-3 ISP — 모든 transit을 상위에서 구매',
        note: 'Tier-3 네트워크가 패킷을 전달합니다. 상위를 가리키는 기본 경로(0.0.0.0/0)만 보유합니다. Tier-2의 transit 비용을 지불하며 자신의 프리픽스를 BGP로 공고합니다.' },
      { title: 'Tier-2 ISP — transit과 IX 피어링',
        note: 'Tier-2는 전체 BGP 테이블(~100만 프리픽스)을 보유합니다. 52.1.2.3(AS16509)이 IX를 통해 도달 가능함을 알고 있어 유료 Tier-1 transit 대신 IX로 전송합니다.' },
      { title: 'IXP — 중립 Layer-2 패브릭',
        note: '패킷이 IX 스위칭 패브릭을 통과합니다. Tier-2와 AWS 모두 IX에 라우터를 연결했고 BGP 세션을 맺고 있습니다. IX 트래픽은 무료이며 패브릭은 패킷을 수정하지 않습니다.' },
      { title: 'CSP / AWS — 엣지 PoP에서 VPC로',
        note: 'AWS가 IX 연결 엣지에서 패킷을 수신합니다. 목적지 IP가 AWS 주소 블록이므로 내부 라우팅이 인계합니다. AWS 백본이 올바른 리전으로 전달하며 패킷은 4개의 AS 경계와 1개의 IX 패브릭을 통과합니다.' },
    ],
  },
}

// ── SVG Graph ──────────────────────────────────────────────────────────────────

const NODE_IDS: NodeId[] = ['client', 'isp3', 'isp2', 'ixp', 'csp']

function perpOffset(x1: number, y1: number, x2: number, y2: number, d: number): [number, number] {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  return [-dy / len * d, dx / len * d]
}

function InetGraph({ frame, focus, onFocus, linkLabels, nodeLabels }: {
  frame: InetFrame
  focus: NodeId
  onFocus: (id: NodeId) => void
  linkLabels: Record<LinkId, string>
  nodeLabels: Record<NodeId, { label: string; sub: string }>
}) {
  return (
    <div className="inet-graph-canvas">
      {/* SVG layer: lines + labels */}
      <svg viewBox={`0 0 ${GW} ${GH}`} className="inet-graph-svg" preserveAspectRatio="none">
        <defs>
          {GLINKS.map(({ id, from, to }) => {
            const [x1, y1] = NODE_PX[from]
            const [x2, y2] = NODE_PX[to]
            return <path key={id} id={`inp-${id}`} d={`M ${x1} ${y1} L ${x2} ${y2}`} fill="none" />
          })}
        </defs>

        {GLINKS.map(({ id, from, to }) => {
          const [x1, y1] = NODE_PX[from]
          const [x2, y2] = NODE_PX[to]
          const status = frame.links[id]
          const mx = (x1 + x2) / 2
          const my = (y1 + y2) / 2
          const [ox, oy] = perpOffset(x1, y1, x2, y2, 16)
          return (
            <g key={id}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} className={`inet-gline inet-gline-${status}`} strokeWidth="2" />
              {status === 'active' && (
                <circle r="5" className="inet-gdot" fill="currentColor">
                  <animateMotion dur="1.1s" repeatCount="indefinite">
                    <mpath href={`#inp-${id}`} />
                  </animateMotion>
                </circle>
              )}
              <text x={mx + ox} y={my + oy} textAnchor="middle" dominantBaseline="central"
                className={`inet-glabel${status !== 'idle' ? ' inet-glabel-on' : ''}`}>
                {linkLabels[id]}
              </text>
            </g>
          )
        })}
      </svg>

      {/* HTML node boxes */}
      {NODE_IDS.map(nid => {
        const [px, py] = NODE_PX[nid]
        const status = frame.nodes[nid]
        return (
          <button
            key={nid}
            type="button"
            className={`inet-gnode inet-gnode-${status}${focus === nid ? ' inet-gnode-focus' : ''}`}
            style={{ left: `${(px / GW) * 100}%`, top: `${(py / GH) * 100}%` }}
            onClick={() => onFocus(nid)}
          >
            <span className="inet-gnode-label">{nodeLabels[nid].label}</span>
            <span className="inet-gnode-sub">{nodeLabels[nid].sub}</span>
          </button>
        )
      })}
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
      setStep(next); setFocus(FRAMES[next].focus)
    }, 1200)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [playing, step, isLast])

  function reset() { setPlaying(false); setStep(0); setFocus(FRAMES[0].focus) }
  function stepFwd() { if (!isLast) { const n = step + 1; setStep(n); setFocus(FRAMES[n].focus) } }
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
  const nodeLabels = {
    client: { label: t.nodes.client.label, sub: t.nodes.client.sub },
    isp3:   { label: t.nodes.isp3.label,   sub: t.nodes.isp3.sub   },
    isp2:   { label: t.nodes.isp2.label,   sub: t.nodes.isp2.sub   },
    ixp:    { label: t.nodes.ixp.label,    sub: t.nodes.ixp.sub    },
    csp:    { label: t.nodes.csp.label,    sub: t.nodes.csp.sub    },
  }

  return (
    <div className="inet-root">
      <InetGraph
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
