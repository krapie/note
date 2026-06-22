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

const NOTES_EN: NoteEntry[] = [
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

export default function IndexPage() {
  const { lang } = useLang()
  const notes = lang === 'ko' ? NOTES_KO : NOTES_EN
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())

  const allTags = Array.from(new Set(NOTES_EN.flatMap(n => n.tags))).sort()

  function toggleTag(tag: string) {
    setSelectedTags(prev => {
      const next = new Set(prev)
      next.has(tag) ? next.delete(tag) : next.add(tag)
      return next
    })
  }

  const filtered = selectedTags.size === 0
    ? notes
    : notes.filter(n => n.tags.some(t => selectedTags.has(t)))

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
        <div className="note-filter-bar">
          {allTags.map(tag => (
            <button
              key={tag}
              className={`note-filter-tag${selectedTags.has(tag) ? ' active' : ''}`}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
        <div className="note-list">
          {filtered.length === 0 && (
            <p className="note-empty-state">
              {lang === 'ko' ? '선택한 태그에 해당하는 노트가 없습니다.' : 'No notes match the selected tags.'}
            </p>
          )}
          {filtered.map(note => (
            <Link key={note.id} to={`/${note.id}`} className="note-row">
              <div className="note-row-main">
                <div className="note-row-title">{note.title}</div>
                <div className="note-row-blurb">{note.blurb}</div>
                <div className="note-row-tags">
                  {note.tags.map(t => (
                    <button
                      key={t}
                      className={`note-tag note-tag-btn${selectedTags.has(t) ? ' active' : ''}`}
                      onClick={e => { e.preventDefault(); toggleTag(t) }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="note-row-meta">
                <span>{note.date}</span>
                <span>{note.read}</span>
              </div>
            </Link>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  )
}
