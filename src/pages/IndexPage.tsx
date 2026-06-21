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
    title: 'IPSec: IKEv2 negotiation and ESP tunnel',
    date: '2026-06-21',
    read: '8 min',
    tags: ['networking', 'ipsec', 'security', 'vpn'],
    blurb: 'How two gateways negotiate a secure tunnel via IKEv2 — DH key exchange, authentication, SA creation — then how every packet is ESP-encapsulated. Covers IKE_SA_INIT, IKE_AUTH, SPD/SAD setup, and step-by-step outbound/inbound packet transformation.',
  },
  {
    id: 'bgp',
    title: 'BGP peering and route exchange',
    date: '2026-06-21',
    read: '7 min',
    tags: ['networking', 'bgp', 'routing'],
    blurb: 'How two BGP routers establish a session, exchange routes, and install them — then how those routes propagate through the AS via iBGP. Three interactive walkthroughs covering session states, the RIB/FIB pipeline, and convergence.',
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
    title: 'IPSec: IKEv2 협상과 ESP 터널',
    date: '2026-06-21',
    read: '8분',
    tags: ['networking', 'ipsec', 'security', 'vpn'],
    blurb: '두 게이트웨이가 IKEv2로 보안 터널을 협상하는 방법 — DH 키 교환, 인증, SA 생성 — 그리고 모든 패킷이 ESP로 캡슐화되는 과정. IKE_SA_INIT, IKE_AUTH, SPD/SAD 설정, 단계별 아웃바운드/인바운드 패킷 변환을 다룹니다.',
  },
  {
    id: 'bgp',
    title: 'BGP 피어링과 경로 교환',
    date: '2026-06-21',
    read: '7분',
    tags: ['networking', 'bgp', 'routing'],
    blurb: '두 BGP 라우터가 세션을 수립하고 경로를 교환하고 설치하는 방법 — 이후 iBGP를 통해 AS 전체로 전파되는 과정. 세션 상태, RIB/FIB 파이프라인, 수렴을 다루는 세 가지 인터랙티브 데모.',
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
