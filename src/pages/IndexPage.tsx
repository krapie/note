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
    id: 'mtr',
    title: 'Reading MTR output',
    date: '2026-06-13',
    read: '3 min',
    tags: ['networking', 'troubleshooting'],
    blurb: 'How to distinguish ICMP deprioritization (a false alarm) from real packet loss. Includes an interactive MTR table with two annotated scenarios.',
  },
  {
    id: 'tcp',
    title: 'All about TCP',
    date: '2026-06-13',
    read: '4 min',
    tags: ['networking', 'tcp'],
    blurb: 'What SYN, SYN-ACK, and ACK actually do — stepped through, packet by packet. Includes teardown, data transfer, state machine, and MTU/MSS.',
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
    id: 'mtr',
    title: 'MTR 출력 읽기',
    date: '2026-06-13',
    read: '3분',
    tags: ['networking', 'troubleshooting'],
    blurb: 'ICMP 역우선화(오탐)와 실제 패킷 손실을 구별하는 방법. 주석이 달린 두 가지 시나리오의 인터랙티브 MTR 테이블 포함.',
  },
  {
    id: 'tcp',
    title: 'TCP 완전 해설',
    date: '2026-06-13',
    read: '4분',
    tags: ['networking', 'tcp'],
    blurb: 'SYN, SYN-ACK, ACK가 실제로 무엇을 하는지 — 패킷 하나씩 단계적으로. 종료, 데이터 전송, 상태 머신, MTU/MSS 포함.',
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
        <div className="note-list">
          {notes.map(note => (
            <Link key={note.id} to={`/${note.id}`} className="note-row">
              <div className="note-row-main">
                <div className="note-row-title">{note.title}</div>
                <div className="note-row-blurb">{note.blurb}</div>
                <div className="note-row-tags">
                  {note.tags.map(t => (
                    <span key={t} className="note-tag">{t}</span>
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
