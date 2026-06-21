import { useState } from 'react'
import { Link } from 'react-router-dom'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

type NodeStatus = 'idle' | 'active' | 'dropping' | 'icmp'
type LinkStatus = 'idle' | 'active' | 'blocked' | 'icmp'

interface PmtudFrame {
  nodes: { client: NodeStatus; r1: NodeStatus; r2: NodeStatus; server: NodeStatus }
  links: { cr1: LinkStatus; r1r2: LinkStatus; r2s: LinkStatus }
  mss: number
  pktSize?: number
}

const PMTUD_FRAMES: PmtudFrame[] = [
  { nodes: { client: 'idle',     r1: 'idle',     r2: 'idle',   server: 'idle'   }, links: { cr1: 'idle',   r1r2: 'idle',    r2s: 'idle' }, mss: 1460 },
  { nodes: { client: 'active',   r1: 'active',   r2: 'idle',   server: 'idle'   }, links: { cr1: 'active', r1r2: 'idle',    r2s: 'idle' }, mss: 1460, pktSize: 1440 },
  { nodes: { client: 'idle',     r1: 'dropping', r2: 'idle',   server: 'idle'   }, links: { cr1: 'icmp',   r1r2: 'blocked', r2s: 'idle' }, mss: 1460, pktSize: 1440 },
  { nodes: { client: 'icmp',     r1: 'icmp',     r2: 'idle',   server: 'idle'   }, links: { cr1: 'icmp',   r1r2: 'idle',    r2s: 'idle' }, mss: 1460 },
  { nodes: { client: 'active',   r1: 'active',   r2: 'idle',   server: 'idle'   }, links: { cr1: 'active', r1r2: 'idle',    r2s: 'idle' }, mss: 1240, pktSize: 1260 },
  { nodes: { client: 'idle',     r1: 'active',   r2: 'active', server: 'idle'   }, links: { cr1: 'idle',   r1r2: 'active',  r2s: 'idle' }, mss: 1240, pktSize: 1260 },
  { nodes: { client: 'idle',     r1: 'idle',     r2: 'active', server: 'active' }, links: { cr1: 'idle',   r1r2: 'idle',    r2s: 'active'}, mss: 1240, pktSize: 1260 },
]

const MTU_T = {
  en: {
    title: 'MTU, MSS, and Path MTU Discovery',
    readTime: '4 min',
    intro: 'Why large packets get silently dropped mid-path — and how TCP discovers the smallest MTU across all hops without fragmenting. Step through a PMTUD sequence to see the ICMP feedback loop in action.',
    interactive: 'PMTUD Simulation',
    mssLabel: 'Client MSS',
    pktLabel: 'Packet',
    seeAlso: 'See also: ',
    tcpLink: 'TCP three-way handshake →',
    eduTitle: 'Key concepts',
    frames: [
      { title: 'Initial state',                    detail: 'Client has negotiated MSS = 1460 B (standard for 1500 B Ethernet). The R1→R2 link has MTU 1280 — neither side knows this yet. DF (Don\'t Fragment) bit is set on all outgoing segments.' },
      { title: 'Large segment sent — passes R1',   detail: 'Client sends a 1440 B IP packet (20 B IP + 20 B TCP + 1400 B payload). The C→R1 link MTU is 1500 B, so the packet passes without issue.' },
      { title: 'R1 drops — ICMP Frag Needed',      detail: 'R1 tries to forward to R2 across the 1280 B MTU link. 1440 > 1280 and DF=1 — can\'t fragment. R1 drops the packet and sends ICMP Type 3 Code 4 (Fragmentation Needed) back to Client, with next-hop MTU = 1280.' },
      { title: 'ICMP reaches Client',              detail: 'The kernel receives ICMP Fragmentation Needed and updates the Path MTU cache for this destination: path MTU = 1280. The MSS will be recalculated before the next send.' },
      { title: 'MSS reduced — resend from Client', detail: 'Client recalculates: MSS = 1280 − 20 − 20 = 1240 B. New IP packet total: 1260 B. Sent again — passes the C→R1 link (1260 < 1500).' },
      { title: 'Passes bottleneck R1→R2',          detail: 'R1 forwards the 1260 B packet through the R1→R2 link: 1260 < 1280 ✓. The previously-blocking hop now passes.' },
      { title: 'Server receives data',             detail: 'Packet arrives at Server intact. PMTUD complete — future segments to this destination use MSS = 1240 B.' },
    ],
    facts: {
      mtu:   'Maximum Transmission Unit — the largest L3 packet a link will carry. Ethernet default: 1500 B. Set per interface; jumbo frames go up to 9000 B.',
      mss:   'Maximum Segment Size — largest TCP payload per segment. MSS = MTU − 40 B (IP + TCP headers). Each peer advertises its MSS in the SYN; the lower value wins.',
      mru:   'Maximum Receive Unit — the largest packet a local interface will accept and reassemble. Usually matches MTU on the same link.',
      pmtud: <>Path MTU Discovery (RFC 1191/8899). Sender sets DF=1 and starts at local MTU. Intermediate routers reply with ICMP Fragmentation Needed when the packet won't fit their outgoing link — sender reduces MSS and retries.</>,
    },
  },
  ko: {
    title: 'MTU, MSS, 경로 MTU 탐색',
    readTime: '4분',
    intro: '대형 패킷이 경로 중간에서 조용히 손실되는 이유 — 그리고 TCP가 단편화 없이 모든 홉에서 가장 작은 MTU를 탐색하는 방법. PMTUD 시퀀스를 단계별로 살펴보며 ICMP 피드백 루프를 확인합니다.',
    interactive: 'PMTUD 시뮬레이션',
    mssLabel: '클라이언트 MSS',
    pktLabel: '패킷',
    seeAlso: '참고: ',
    tcpLink: 'TCP 3-Way 핸드셰이크 →',
    eduTitle: '핵심 개념',
    frames: [
      { title: '초기 상태',                    detail: '클라이언트가 MSS = 1460 B로 협상했습니다 (표준 1500 B 이더넷). R1→R2 링크의 MTU는 1280 — 아직 어느 쪽도 모릅니다. DF(단편화 금지) 비트가 모든 발신 세그먼트에 설정됩니다.' },
      { title: '대형 세그먼트 전송 — R1 통과', detail: '클라이언트가 1440 B IP 패킷 전송 (20 B IP + 20 B TCP + 1400 B 페이로드). C→R1 링크 MTU = 1500 B, 문제없이 통과합니다.' },
      { title: 'R1 드롭 — ICMP 단편화 필요',   detail: 'R1이 1280 B MTU 링크를 통해 R2로 전달 시도. 1440 > 1280이고 DF=1 — 단편화 불가. R1이 패킷을 드롭하고 next-hop MTU = 1280과 함께 ICMP 타입 3 코드 4 (단편화 필요)를 클라이언트로 전송합니다.' },
      { title: 'ICMP 클라이언트 도달',          detail: '커널이 ICMP 단편화 필요를 수신하고 이 목적지의 경로 MTU 캐시를 업데이트합니다: 경로 MTU = 1280. 다음 전송 전에 MSS가 재계산됩니다.' },
      { title: 'MSS 감소 — 재전송',             detail: '클라이언트 재계산: MSS = 1280 − 20 − 20 = 1240 B. 새 IP 패킷 총계: 1260 B. 재전송 — C→R1 링크 통과 (1260 < 1500).' },
      { title: '병목 R1→R2 통과',               detail: 'R1이 1260 B 패킷을 R1→R2 링크로 전달: 1260 < 1280 ✓. 이전에 차단되었던 홉이 이제 통과됩니다.' },
      { title: '서버 데이터 수신',               detail: '패킷이 서버에 온전히 도착. PMTUD 완료 — 이후 이 목적지에 대한 세그먼트는 MSS = 1240 B를 사용합니다.' },
    ],
    facts: {
      mtu:   '최대 전송 단위 — 링크가 전달할 수 있는 가장 큰 L3 패킷. 이더넷 기본값: 1500 B. 인터페이스별로 설정됩니다; 점보 프레임은 최대 9000 B.',
      mss:   '최대 세그먼트 크기 — 세그먼트당 최대 TCP 페이로드. MSS = MTU − 40 B (IP + TCP 헤더). 각 피어가 SYN에서 MSS를 광고하며 낮은 값이 적용됩니다.',
      mru:   '최대 수신 단위 — 로컬 인터페이스가 수락하고 재조립할 가장 큰 패킷. 일반적으로 동일 링크에서 MTU와 일치합니다.',
      pmtud: <>경로 MTU 탐색 (RFC 1191/8899). 발신자가 DF=1을 설정하고 로컬 MTU에서 시작합니다. 중간 라우터가 패킷이 발신 링크에 맞지 않을 때 ICMP 단편화 필요로 응답 — 발신자가 MSS를 줄이고 재시도합니다.</>,
    },
  },
}

function NodeBox({ label, status }: { label: string; status: NodeStatus }) {
  return (
    <div className={`mtu-node mtu-node-${status}`}>
      <div className="mtu-node-name">{label}</div>
      <div className="mtu-node-badge">
        {status === 'dropping' && <span className="mtu-badge-drop">DROP</span>}
        {status === 'icmp'     && <span className="mtu-badge-icmp">ICMP</span>}
        {status === 'active'   && <span className="mtu-badge-active">●</span>}
        {status === 'idle'     && <span>&nbsp;</span>}
      </div>
    </div>
  )
}

function LinkSeg({ mtu, status, pktSize, bottleneck }: { mtu: number; status: LinkStatus; pktSize?: number; bottleneck?: boolean }) {
  return (
    <div className={`mtu-link mtu-link-${status}`}>
      <div className={`mtu-link-mtu-label${bottleneck ? ' bottleneck' : ''}`}>MTU {mtu}</div>
      <div className="mtu-link-track">
        <div className="mtu-link-line" />
        {status === 'active'  && pktSize !== undefined && <div className="mtu-link-pkt">{pktSize} B</div>}
        {status === 'blocked' && <div className="mtu-link-blocked-mark">✕</div>}
        {status === 'icmp'    && <div className="mtu-link-icmp-tag">◄ ICMP</div>}
      </div>
    </div>
  )
}

function EduFact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="tcp-edu-fact">
      <span className="tcp-edu-fact-k">{k}</span>
      <span className="tcp-edu-fact-v">{v}</span>
    </div>
  )
}

function MtuExplorer() {
  const { lang } = useLang()
  const t = MTU_T[lang]
  const [step, setStep] = useState(0)

  const frame = PMTUD_FRAMES[step]
  const ft = t.frames[step]
  const isLast = step >= PMTUD_FRAMES.length - 1

  return (
    <div className="mtu-root">
      <div className="mtu-topo">
        <NodeBox label="CLIENT" status={frame.nodes.client} />
        <LinkSeg mtu={1500} status={frame.links.cr1}  pktSize={frame.pktSize} />
        <NodeBox label="R1"     status={frame.nodes.r1} />
        <LinkSeg mtu={1280} status={frame.links.r1r2} pktSize={frame.pktSize} bottleneck />
        <NodeBox label="R2"     status={frame.nodes.r2} />
        <LinkSeg mtu={1500} status={frame.links.r2s}  pktSize={frame.pktSize} />
        <NodeBox label="SERVER" status={frame.nodes.server} />
      </div>

      <div className="mtu-stats">
        <span className="mtu-stat">
          <span className="mtu-stat-k">{t.mssLabel}</span>
          <span className="mtu-stat-v">{frame.mss} B</span>
        </span>
        {frame.pktSize !== undefined && (
          <span className="mtu-stat">
            <span className="mtu-stat-k">{t.pktLabel}</span>
            <span className="mtu-stat-v">{frame.pktSize} B</span>
          </span>
        )}
      </div>

      <div className="mtu-detail">
        <div className="mtu-detail-title">{ft.title}</div>
        <p className="mtu-detail-body">{ft.detail}</p>
      </div>

      <div className="tcp-controls">
        <button className="btn-secondary" onClick={() => setStep(0)}>
          {lang === 'ko' ? '초기화' : 'Reset'}
        </button>
        <button className="btn-secondary" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>
          {lang === 'ko' ? '← 이전' : '← Prev'}
        </button>
        <button className="btn-primary" onClick={() => { if (isLast) setStep(0); else setStep(s => s + 1) }}>
          {isLast ? (lang === 'ko' ? '다시 보기' : 'Replay') : step === 0 ? (lang === 'ko' ? '시작' : 'Start') : (lang === 'ko' ? '다음 →' : 'Next →')}
        </button>
      </div>

      <div className="tcp-progress">
        <div className="tcp-progress-fill" style={{ width: `${(step / (PMTUD_FRAMES.length - 1)) * 100}%` }} />
      </div>
    </div>
  )
}

export default function MtuPage() {
  const { lang } = useLang()
  const t = MTU_T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-06-21"
      readTime={t.readTime}
      tags={['networking', 'tcp', 'mtu']}
      intro={t.intro}
    >
      <div className="tcp-edu-section">
        <div className="tcp-edu-title">{t.interactive}</div>
        <MtuExplorer />
      </div>

      <div className="tcp-edu-section">
        <div className="tcp-edu-title">{t.eduTitle}</div>
        <div className="tcp-frame-diagram">
          <div className="tcp-frame-bar">
            <div className="tcp-frame-seg tcp-seg-eth"><span>Eth</span><span className="tcp-seg-sz">14 B</span></div>
            <div className="tcp-frame-seg tcp-seg-ip"><span>IP</span><span className="tcp-seg-sz">20 B</span></div>
            <div className="tcp-frame-seg tcp-seg-tcp"><span>TCP</span><span className="tcp-seg-sz">20 B</span></div>
            <div className="tcp-frame-seg tcp-seg-payload"><span>Payload</span><span className="tcp-seg-sz">≤ 1460 B</span></div>
          </div>
          <div className="tcp-frame-spans">
            <div className="tcp-frame-span-mtu">
              <div className="tcp-span-line" /><span>MTU = 1500 B</span><div className="tcp-span-line" />
            </div>
            <div className="tcp-frame-span-mss">
              <div className="tcp-span-line" /><span>MSS = 1460 B</span><div className="tcp-span-line" />
            </div>
          </div>
        </div>
        <div className="tcp-edu-facts">
          <EduFact k="MTU"   v={t.facts.mtu} />
          <EduFact k="MSS"   v={t.facts.mss} />
          <EduFact k="MRU"   v={t.facts.mru} />
          <EduFact k="PMTUD" v={t.facts.pmtud} />
        </div>
      </div>

      <div className="tcp-edu-section">
        <p className="mtu-see-also">
          {t.seeAlso}<Link to="/tcp">{t.tcpLink}</Link>
        </p>
      </div>
    </NoteLayout>
  )
}
