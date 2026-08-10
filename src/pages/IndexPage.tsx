import { useState } from 'react'
import { Link } from 'react-router-dom'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { useLang } from '../App'

interface NoteEntry {
  id: string
  title: string
  date: string
  read: string
  tags: string[]
  blurb: string
}

interface Collection {
  id: string
  title: string
  sub: string
  noteIds: string[]
}

const NOTES_EN: NoteEntry[] = [
  {
    id: 'fwd',
    title: 'L2 vs L3 — how packets actually move',
    date: '2026-08-09',
    read: '5 min',
    tags: ['networking', 'ethernet', 'ip', 'arp', 'switching', 'routing'],
    blurb: `The IP header carries source and destination end-to-end, unchanged across every router. The Ethernet header is rewritten at every hop. Two interactive scenarios show exactly how ARP resolves MACs, how a switch forwards by MAC table, and how a router strips one L2 envelope and writes a new one for the next link.`,
  },
  {
    id: 'dc',
    title: 'Datacenter networking — from rack to border',
    date: '2026-07-24',
    read: '7 min',
    tags: ['networking', 'datacenter', 'infrastructure', 'switching', 'bgp'],
    blurb: `How packets move inside a datacenter — from server NIC through ToR, Access, Aggregation, and Core switches — and how east-west (server-to-server), internet egress, and direct peer traffic each take different paths out through the border router.`,
  },
  {
    id: 'lg',
    title: 'Looking Glass & PeeringDB — BGP visibility tools',
    date: '2026-07-21',
    read: '5 min',
    tags: ['networking', 'bgp', 'peering', 'tools', 'infrastructure'],
    blurb: `The two tools every network engineer opens when investigating BGP routing: PeeringDB for finding a network's peering policy, IXP memberships, and contacts — and Looking Glass for running live BGP queries against an ISP's production router from the outside.`,
  },
  {
    id: 'backbone',
    title: 'Backbone networks — how packets cross the internet',
    date: '2026-07-20',
    read: '6 min',
    tags: ['networking', 'backbone', 'isp', 'bgp', 'infrastructure'],
    blurb: `How packets travel from a home user through Tier 3, Tier 2, and Tier 1 ISPs to reach a destination on the other side of the internet — covering transit economics, settlement-free peering, IXPs, and the backbone links that carry the world's traffic.`,
  },
  {
    id: 'snmp',
    title: 'SNMP — polling, traps, and the MIB',
    date: '2026-07-20',
    read: '6 min',
    tags: ['networking', 'monitoring', 'snmp', 'infrastructure'],
    blurb: `How network managers poll thousands of devices without logging into each one — and how devices proactively push notifications when something changes. Covers GetRequest, GetResponse, TRAP, InformRequest, and the OID hierarchy inside the MIB.`,
  },
  {
    id: 'retry',
    title: 'Retry and exponential backoff',
    date: '2026-07-19',
    read: '5 min',
    tags: ['distributed-systems', 'reliability', 'backoff', 'resilience'],
    blurb: `Why immediate retry makes overloaded servers worse, how exponential backoff gives the server time to recover, and why adding jitter is the key step that breaks the thundering herd.`,
  },
  {
    id: 'ecmp',
    title: 'ECMP — equal-cost multi-path routing',
    date: '2026-06-23',
    read: '4 min',
    tags: ['networking', 'routing', 'ecmp', 'datacenter'],
    blurb: `How a router distributes traffic across two equal-cost paths using a per-flow 5-tuple hash — and what happens to all those flows when one path goes down.`,
  },
  {
    id: 'cast',
    title: 'Unicast, multicast, and anycast',
    date: '2026-06-22',
    read: '5 min',
    tags: ['networking', 'routing', 'multicast', 'anycast'],
    blurb: `How the same destination address can mean one receiver, all group members, or the nearest of many — and how ECMP distributes flows across parallel equal-cost paths using a per-flow 5-tuple hash.`,
  },
  {
    id: 'crdt',
    title: 'CRDT — conflict-free collaborative editing',
    date: '2026-06-22',
    read: '6 min',
    tags: ['distributed-systems', 'crdt', 'collaboration', 'yorkie'],
    blurb: 'How Conflict-free Replicated Data Types let multiple users edit the same document without a central server. Covers OT vs CRDT, LWW-Register with Lamport timestamps, and RGA — the sequence CRDT powering Yorkie.',
  },
  {
    id: 'dns',
    title: 'DNS — how a query is resolved',
    date: '2026-06-22',
    read: '5 min',
    tags: ['networking', 'dns', 'resolvers', 'infrastructure'],
    blurb: 'How a hostname becomes an IP address — traced from stub resolver to recursive resolver, through root, TLD, and authoritative nameservers. Covers caching, TTL, and all common record types.',
  },
  {
    id: 'overlay',
    title: 'Overlay and underlay networks',
    date: '2026-06-22',
    read: '5 min',
    tags: ['networking', 'overlay', 'vxlan', 'tunneling', 'virtualization'],
    blurb: 'How a virtual network rides on top of a physical one — encapsulation, VTEPs, and why transit routers need zero reconfiguration. Covers VXLAN, GRE, IPsec, and WireGuard through a six-frame interactive demo.',
  },
  {
    id: 'inet',
    title: 'The Internet: a network of networks',
    date: '2026-06-22',
    read: '5 min',
    tags: ['networking', 'internet', 'bgp', 'routing', 'isp'],
    blurb: 'How ~80,000 Autonomous Systems (ISPs, IXPs, cloud providers, and end clients) interconnect via BGP transit and peering — traced step by step from a home client to AWS.',
  },
  {
    id: 'ipsec',
    title: 'IPSec: ESP encapsulation and decapsulation',
    date: '2026-06-21',
    read: '5 min',
    tags: ['networking', 'ipsec', 'security', 'vpn'],
    blurb: 'What happens inside the xfrm subsystem when a packet hits an IPSec policy — from original datagram to encrypted wire format and back. Outbound and inbound transforms, step by step.',
  },
  {
    id: 'bgp',
    title: 'BGP route advertisement and propagation',
    date: '2026-06-21',
    read: '5 min',
    tags: ['networking', 'bgp', 'routing'],
    blurb: 'How two eBGP peers advertise prefixes and install them through the Adj-RIB-In → Loc-RIB → FIB pipeline — then how the border router propagates those routes to internal iBGP peers.',
  },
  {
    id: 'mtu',
    title: 'MTU, MSS, and Path MTU Discovery',
    date: '2026-06-21',
    read: '4 min',
    tags: ['networking', 'tcp', 'mtu'],
    blurb: 'Why large packets get silently dropped mid-path — and how TCP discovers the smallest MTU across all hops without fragmenting. Interactive PMTUD sequence with ICMP feedback loop.',
  },
  {
    id: 'conntrack',
    title: 'Linux connection tracking (conntrack)',
    date: '2026-06-21',
    read: '4 min',
    tags: ['networking', 'linux', 'conntrack', 'firewall'],
    blurb: 'How the Linux kernel tracks every active network flow and how conntrack states feed into stateful firewall rules. Three scenarios: TCP lifecycle, UDP timeout, and RELATED entry for FTP.',
  },
  {
    id: 'mtr',
    title: 'Reading MTR output',
    date: '2026-06-13',
    read: '3 min',
    tags: ['networking', 'troubleshooting'],
    blurb: 'How to distinguish ICMP deprioritization (a false alarm) from real packet loss. Includes an interactive MTR table with two annotated scenarios.',
  },
  {
    id: 'tcp',
    title: 'The TCP three-way handshake',
    date: '2026-06-13',
    read: '4 min',
    tags: ['networking', 'tcp'],
    blurb: 'What SYN, SYN-ACK, and ACK actually do — stepped through, packet by packet. Covers the full lifecycle: handshake, data transfer, and four-way teardown with state machine visualization.',
  },
  {
    id: 'vpc',
    title: 'VPC packet flow',
    date: '2026-06-13',
    read: '5 min',
    tags: ['aws', 'networking', 'vpc'],
    blurb: 'How packets move inside AWS VPC — Nitro cards, Mapping Service, Hyperplane, and Blackfoot edge. Three scenarios: VM→VM, VM→Internet, VM→NLB.',
  },
  {
    id: 'clos',
    title: 'Clos vs. RNG topology',
    date: '2026-06-13',
    read: '6 min',
    tags: ['networking', 'datacenter'],
    blurb: 'How AWS replaced hierarchical fat-tree (Clos) data center networks with a flat quasi-random topology — fewer routers, more paths, less power.',
  },
]

const NOTES_KO: NoteEntry[] = [
  {
    id: 'fwd',
    title: 'L2 vs L3 — 패킷이 실제로 이동하는 방법',
    date: '2026-08-09',
    read: '5분',
    tags: ['networking', 'ethernet', 'ip', 'arp', 'switching', 'routing'],
    blurb: `IP 헤더는 출발지와 목적지를 종단 간 변하지 않고 전달합니다. 이더넷 헤더는 매 홉마다 새로 씁니다. 두 가지 인터랙티브 시나리오로 ARP가 MAC을 어떻게 찾는지, 스위치가 MAC 테이블로 포워딩하는 방법, 라우터가 L2 봉투를 벗기고 다음 링크를 위해 새로 쓰는 과정을 단계별로 확인할 수 있습니다.`,
  },
  {
    id: 'dc',
    title: '데이터센터 네트워킹 — 랙에서 경계까지',
    date: '2026-07-24',
    read: '7분',
    tags: ['networking', 'datacenter', 'infrastructure', 'switching', 'bgp'],
    blurb: `패킷이 데이터센터 내에서 이동하는 방법 — 서버 NIC부터 ToR, Access, Aggregation, Core 스위치까지 — 그리고 East-West(서버 간), 인터넷 이그레스, 직접 피어 트래픽이 각각 Border Router를 통해 어떻게 다른 경로로 나가는지.`,
  },
  {
    id: 'lg',
    title: 'Looking Glass & PeeringDB — BGP 가시성 도구',
    date: '2026-07-21',
    read: '5분',
    tags: ['networking', 'bgp', 'peering', 'tools', 'infrastructure'],
    blurb: `BGP 라우팅 조사 시 모든 네트워크 엔지니어가 여는 두 가지 도구: 피어링 정책·IXP 멤버십·연락처 조회를 위한 PeeringDB, 그리고 외부에서 ISP의 운영 라우터에 직접 BGP 쿼리를 실행할 수 있는 Looking Glass.`,
  },
  {
    id: 'backbone',
    title: '백본 네트워크 — 패킷이 인터넷을 건너는 방법',
    date: '2026-07-20',
    read: '6분',
    tags: ['networking', 'backbone', 'isp', 'bgp', 'infrastructure'],
    blurb: `가정 사용자의 패킷이 Tier 3, Tier 2, Tier 1 ISP를 거쳐 인터넷 반대편 목적지에 도달하는 방법 — 트랜짓 경제, 정산 없는 피어링, IXP, 그리고 전 세계 트래픽을 운반하는 백본 링크를 다룹니다.`,
  },
  {
    id: 'snmp',
    title: 'SNMP — 폴링, 트랩, MIB',
    date: '2026-07-20',
    read: '6분',
    tags: ['networking', 'monitoring', 'snmp', 'infrastructure'],
    blurb: `네트워크 매니저가 일일이 접속하지 않고 수천 대의 기기를 폴링하는 방법 — 그리고 기기가 변화 발생 시 매니저에게 능동적으로 알리는 방법. GetRequest, GetResponse, TRAP, InformRequest, MIB 내부의 OID 계층 구조를 다룹니다.`,
  },
  {
    id: 'retry',
    title: '재시도와 지수 백오프',
    date: '2026-07-19',
    read: '5분',
    tags: ['distributed-systems', 'reliability', 'backoff', 'resilience'],
    blurb: `즉시 재시도가 과부하된 서버를 더 악화시키는 이유, 지수 백오프가 서버 복구 시간을 주는 방법, 그리고 지터(jitter)가 천둥 무리 문제를 해결하는 핵심인 이유.`,
  },
  {
    id: 'ecmp',
    title: 'ECMP — 동일 비용 다중 경로 라우팅',
    date: '2026-06-23',
    read: '4분',
    tags: ['networking', 'routing', 'ecmp', 'datacenter'],
    blurb: `라우터가 플로우별 5-튜플 해시로 두 개의 동일 비용 경로에 트래픽을 분산하는 방법 — 그리고 경로 하나가 다운되었을 때 모든 플로우에 어떤 일이 일어나는지.`,
  },
  {
    id: 'cast',
    title: '유니캐스트, 멀티캐스트, 애니캐스트',
    date: '2026-06-22',
    read: '5분',
    tags: ['networking', 'routing', 'multicast', 'anycast'],
    blurb: `동일한 목적지 주소가 수신자 하나, 모든 그룹 멤버, 또는 가장 가까운 호스트를 의미할 수 있는 방법 — 그리고 ECMP가 플로우별 5-튜플 해시를 사용해 트래픽을 여러 동일 비용 경로에 분산하는 방식.`,
  },
  {
    id: 'crdt',
    title: 'CRDT — 충돌 없는 분산 협업 편집',
    date: '2026-06-22',
    read: '6분',
    tags: ['distributed-systems', 'crdt', 'collaboration', 'yorkie'],
    blurb: 'CRDT가 중앙 서버 없이 여러 사용자의 동시 편집을 병합하는 방법. OT vs CRDT 비교, Lamport 타임스탬프를 사용한 LWW-Register, 그리고 Yorkie의 핵심인 RGA까지 다룹니다.',
  },
  {
    id: 'dns',
    title: 'DNS — 쿼리가 해석되는 방법',
    date: '2026-06-22',
    read: '5분',
    tags: ['networking', 'dns', 'resolvers', 'infrastructure'],
    blurb: '호스트명이 IP 주소가 되는 과정 — 스텁 리졸버에서 재귀 리졸버, 루트, TLD, 권위 네임서버까지 단계별 추적. 캐싱, TTL, 주요 레코드 타입 포함.',
  },
  {
    id: 'overlay',
    title: '오버레이와 언더레이 네트워크',
    date: '2026-06-22',
    read: '5분',
    tags: ['networking', 'overlay', 'vxlan', 'tunneling', 'virtualization'],
    blurb: '가상 네트워크가 물리 네트워크 위에서 동작하는 방법 — 캡슐화, VTEP, 중간 라우터가 설정 변경 없이 동작하는 이유. 6단계 인터랙티브 데모로 VXLAN, GRE, IPsec, WireGuard를 다룹니다.',
  },
  {
    id: 'inet',
    title: '인터넷: 네트워크들의 네트워크',
    date: '2026-06-22',
    read: '5분',
    tags: ['networking', 'internet', 'bgp', 'routing', 'isp'],
    blurb: '약 8만 개의 자율 시스템(ISP, IXP, 클라우드 제공자, 엔드 클라이언트)이 BGP transit과 peering으로 연결되는 방식 — 홈 클라이언트에서 AWS까지 단계별 추적.',
  },
  {
    id: 'ipsec',
    title: 'IPSec: ESP 캡슐화와 역캡슐화',
    date: '2026-06-21',
    read: '5분',
    tags: ['networking', 'ipsec', 'security', 'vpn'],
    blurb: '패킷이 IPSec 정책에 도달했을 때 xfrm 서브시스템 내부에서 일어나는 일 — 원본 데이터그램에서 암호화된 전송 포맷까지, 그리고 다시 되돌아오는 과정. 단계별 아웃바운드/인바운드 변환.',
  },
  {
    id: 'bgp',
    title: 'BGP 경로 광고와 전파',
    date: '2026-06-21',
    read: '5분',
    tags: ['networking', 'bgp', 'routing'],
    blurb: '서로 다른 AS의 두 eBGP 피어가 프리픽스를 광고하고 Adj-RIB-In → Loc-RIB → FIB 파이프라인을 통해 설치하는 과정 — 이후 iBGP를 통한 내부 전파.',
  },
  {
    id: 'mtu',
    title: 'MTU, MSS, 경로 MTU 탐색',
    date: '2026-06-21',
    read: '4분',
    tags: ['networking', 'tcp', 'mtu'],
    blurb: '대형 패킷이 경로 중간에서 조용히 손실되는 이유 — 그리고 TCP가 단편화 없이 모든 홉에서 가장 작은 MTU를 탐색하는 방법. ICMP 피드백 루프를 포함한 인터랙티브 PMTUD 시퀀스.',
  },
  {
    id: 'conntrack',
    title: 'Linux 연결 추적 (conntrack)',
    date: '2026-06-21',
    read: '4분',
    tags: ['networking', 'linux', 'conntrack', 'firewall'],
    blurb: 'Linux 커널이 모든 활성 네트워크 흐름을 추적하는 방법과 conntrack 상태가 방화벽 규칙에 연결되는 방식. 세 가지 시나리오: TCP 생명주기, UDP 타임아웃, FTP용 RELATED 항목.',
  },
  {
    id: 'mtr',
    title: 'MTR 출력 읽기',
    date: '2026-06-13',
    read: '3분',
    tags: ['networking', 'troubleshooting'],
    blurb: 'ICMP 역우선화(오탐)와 실제 패킷 손실을 구별하는 방법. 주석이 달린 두 가지 시나리오의 인터랙티브 MTR 테이블 포함.',
  },
  {
    id: 'tcp',
    title: 'TCP 3-Way 핸드셰이크',
    date: '2026-06-13',
    read: '4분',
    tags: ['networking', 'tcp'],
    blurb: 'SYN, SYN-ACK, ACK가 실제로 무엇을 하는지 — 패킷 하나씩 단계적으로. 핸드셰이크, 데이터 전송, 4-way 종료의 전체 생명주기와 상태 머신 시각화 포함.',
  },
  {
    id: 'vpc',
    title: 'VPC 패킷 흐름',
    date: '2026-06-13',
    read: '5분',
    tags: ['aws', 'networking', 'vpc'],
    blurb: 'AWS VPC 내에서 패킷이 이동하는 방법 — Nitro 카드, Mapping Service, Hyperplane, Blackfoot 엣지. 세 가지 시나리오: VM→VM, VM→인터넷, VM→NLB.',
  },
  {
    id: 'clos',
    title: 'Clos vs. RNG 토폴로지',
    date: '2026-06-13',
    read: '6분',
    tags: ['networking', 'datacenter'],
    blurb: 'AWS가 계층형 fat-tree(Clos) 데이터센터 네트워크를 평탄한 준난수 토폴로지로 교체한 방법 — 더 적은 라우터, 더 많은 경로, 더 적은 전력.',
  },
]

// ── Collections ────────────────────────────────────────────────────────────────

const COLLECTIONS_EN: Collection[] = [
  {
    id: 'osi',
    title: 'Networking — layer by layer',
    sub: 'Follow a packet bottom-up through the OSI stack, from Ethernet frames to application protocols',
    noteIds: ['fwd', 'mtu', 'tcp', 'conntrack', 'ipsec', 'overlay', 'dns', 'snmp', 'mtr'],
  },
  {
    id: 'internet',
    title: 'From host to internet',
    sub: 'How traffic leaves a single machine, crosses routing boundaries, and reaches the other side of the world',
    noteIds: ['fwd', 'ecmp', 'cast', 'bgp', 'inet', 'backbone', 'lg'],
  },
  {
    id: 'dc',
    title: 'Datacenter networking',
    sub: 'Fabric design, topology trade-offs, and cloud infrastructure — from rack to cloud VPC',
    noteIds: ['fwd', 'dc', 'clos', 'ecmp', 'vpc'],
  },
]

const COLLECTIONS_KO: Collection[] = [
  {
    id: 'osi',
    title: '네트워킹 — 레이어 by 레이어',
    sub: '이더넷 프레임부터 애플리케이션 프로토콜까지 OSI 스택을 아래서 위로 따라가는 경로',
    noteIds: ['fwd', 'mtu', 'tcp', 'conntrack', 'ipsec', 'overlay', 'dns', 'snmp', 'mtr'],
  },
  {
    id: 'internet',
    title: '호스트에서 인터넷까지',
    sub: '단일 머신에서 트래픽이 출발해 라우팅 경계를 넘어 지구 반대편까지 도달하는 과정',
    noteIds: ['fwd', 'ecmp', 'cast', 'bgp', 'inet', 'backbone', 'lg'],
  },
  {
    id: 'dc',
    title: '데이터센터 네트워킹',
    sub: '패브릭 설계, 토폴로지 트레이드오프, 클라우드 인프라 — 랙에서 클라우드 VPC까지',
    noteIds: ['fwd', 'dc', 'clos', 'ecmp', 'vpc'],
  },
]

// ── Collection section ─────────────────────────────────────────────────────────

function CollectionSection({
  col,
  noteMap,
}: {
  col: Collection
  noteMap: Map<string, NoteEntry>
}) {
  return (
    <div className="idx-collection">
      <div className="idx-col-head">
        <div className="idx-col-title">{col.title}</div>
        <div className="idx-col-sub">{col.sub}</div>
      </div>
      <ol className="idx-col-body">
        {col.noteIds.map((id, i) => {
          const note = noteMap.get(id)
          if (!note) return null
          return (
            <li key={`${id}-${i}`} className="idx-col-item">
              <Link to={`/${id}`} className="idx-col-row">
                <span className="idx-col-num">{i + 1}</span>
                <span className="idx-col-row-info">
                  <span className="idx-col-row-title">{note.title}</span>
                </span>
                <span className="idx-col-row-read">{note.read}</span>
                <svg className="idx-col-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

type View = 'paths' | 'all'

export default function IndexPage() {
  const { lang } = useLang()
  const notes = lang === 'ko' ? NOTES_KO : NOTES_EN
  const collections = lang === 'ko' ? COLLECTIONS_KO : COLLECTIONS_EN

  const noteMap = new Map(notes.map(n => [n.id, n]))

  const [view, setView] = useState<View>('paths')
  const [query, setQuery] = useState('')

  function handleSearch(val: string) {
    setQuery(val)
    if (val.trim()) setView('all')
  }

  const q = query.trim().toLowerCase()
  const filtered = q === ''
    ? notes
    : notes.filter(n =>
        n.title.toLowerCase().includes(q) ||
        n.blurb.toLowerCase().includes(q)
      )

  const lblPaths  = lang === 'ko' ? '경로'      : 'Paths'
  const lblAll    = lang === 'ko' ? '전체 노트'  : 'All notes'
  const lblSearch = lang === 'ko' ? '제목 또는 내용으로 검색' : 'Search by title or content'
  const lblEmpty  = lang === 'ko' ? '검색 결과가 없습니다.' : 'No notes match your search.'

  return (
    <div className="app">
      <Header />
      <main className="kp-main">
        <div className="note-index-intro">
          <h1 className="note-index-title">{lang === 'ko' ? '노트' : 'Note'}</h1>
          <p className="note-index-sub">
            {lang === 'ko'
              ? '인터랙티브 기술 노트 — 각 노트는 텍스트가 아닌 직접 단계별로 탐색할 수 있는 데모입니다.'
              : 'Interactive technical notes — each one is a working demo you can step through, not just text.'}
          </p>
        </div>

        {/* View toggle */}
        <div className="idx-view-tabs">
          <button
            className={`idx-view-tab${view === 'paths' ? ' idx-view-tab-active' : ''}`}
            onClick={() => setView('paths')}
          >
            {lblPaths}
          </button>
          <button
            className={`idx-view-tab${view === 'all' ? ' idx-view-tab-active' : ''}`}
            onClick={() => setView('all')}
          >
            {lblAll}
          </button>
        </div>

        {/* Paths view */}
        {view === 'paths' && (
          <div className="idx-paths">
            {collections.map(col => (
              <CollectionSection key={col.id} col={col} noteMap={noteMap} />
            ))}
          </div>
        )}

        {/* All notes view */}
        {view === 'all' && (
          <>
            <div className="note-search-wrap">
              <svg className="note-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
              </svg>
              <input
                className="note-search-input"
                type="search"
                value={query}
                onChange={e => handleSearch(e.target.value)}
                placeholder={lblSearch}
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
            </div>
            <div className="note-list">
              {filtered.length === 0 && (
                <p className="note-empty-state">{lblEmpty}</p>
              )}
              {filtered.map(note => (
                <Link key={note.id} to={`/${note.id}`} className="note-row">
                  <div className="note-row-main">
                    <div className="note-row-title">{note.title}</div>
                    <div className="note-row-blurb">{note.blurb}</div>
                  </div>
                  <div className="note-row-meta">
                    <span>{note.date}</span>
                    <span>{note.read}</span>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
