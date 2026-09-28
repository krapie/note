import { useState } from 'react'
import { Link } from 'react-router-dom'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

type Scenario = 'tcp' | 'udp' | 'related' | 'keepalive'

interface CtEntry {
  proto: string
  src: string
  dst: string
  state: string
  ttl: string
  isNew?: boolean
  highlight?: boolean
}

interface CtFrame {
  entries: CtEntry[]
  event: string
  eventKo: string
  detail: string
  detailKo: string
}

const TCP_FRAMES: CtFrame[] = [
  {
    entries: [],
    event: 'Before connection', eventKo: '연결 전',
    detail: 'No conntrack entry yet. The kernel has not seen any packet for this flow.',
    detailKo: '아직 conntrack 항목 없음. 커널이 이 흐름에 대한 패킷을 아직 수신하지 않았습니다.',
  },
  {
    entries: [{ proto: 'TCP', src: '10.0.0.5:49200', dst: '93.184.216.34:443', state: 'NEW', ttl: '120s', isNew: true }],
    event: 'SYN sent → NEW', eventKo: 'SYN 전송 → NEW',
    detail: 'First SYN arrives. Conntrack creates a NEW entry with a 120 s timeout (nf_conntrack_tcp_timeout_syn_sent). No reply seen yet — a stateful firewall can still drop this before state is established.',
    detailKo: '첫 번째 SYN 도달. Conntrack이 120초 타임아웃 (nf_conntrack_tcp_timeout_syn_sent)으로 NEW 항목을 생성합니다. 아직 응답 없음 — 상태 수립 전에 방화벽이 여전히 차단할 수 있습니다.',
  },
  {
    entries: [{ proto: 'TCP', src: '10.0.0.5:49200', dst: '93.184.216.34:443', state: 'SYN_RECV', ttl: '60s', highlight: true }],
    event: 'SYN-ACK received → SYN_RECV', eventKo: 'SYN-ACK 수신 → SYN_RECV',
    detail: 'Server replies with SYN-ACK. Conntrack transitions to SYN_RECV and extends the timeout to 60 s. Both directions are now seen.',
    detailKo: '서버가 SYN-ACK로 응답. Conntrack이 SYN_RECV로 전환하고 타임아웃을 60초로 연장합니다. 이제 양방향이 확인됩니다.',
  },
  {
    entries: [{ proto: 'TCP', src: '10.0.0.5:49200', dst: '93.184.216.34:443', state: 'ESTABLISHED', ttl: '432000s', highlight: true }],
    event: 'ACK sent → ESTABLISHED', eventKo: 'ACK 전송 → ESTABLISHED',
    detail: 'Three-way handshake complete. Conntrack marks the flow ESTABLISHED and sets the timeout to 432000 s (5 days). Most firewall rules allow ESTABLISHED traffic implicitly.',
    detailKo: '3-Way 핸드셰이크 완료. Conntrack이 흐름을 ESTABLISHED로 표시하고 타임아웃을 432000초 (5일)로 설정합니다. 대부분의 방화벽 규칙이 ESTABLISHED 트래픽을 암묵적으로 허용합니다.',
  },
  {
    entries: [{ proto: 'TCP', src: '10.0.0.5:49200', dst: '93.184.216.34:443', state: 'TIME_WAIT', ttl: '120s', highlight: true }],
    event: 'FIN exchanged → TIME_WAIT', eventKo: 'FIN 교환 → TIME_WAIT',
    detail: 'Both sides have exchanged FINs. Conntrack enters TIME_WAIT with a 120 s timeout — the entry lingers to absorb delayed or duplicate packets still in flight.',
    detailKo: '양측이 FIN을 교환했습니다. Conntrack이 120초 타임아웃으로 TIME_WAIT에 진입 — 아직 전송 중인 지연 또는 중복 패킷을 흡수하기 위해 항목이 유지됩니다.',
  },
  {
    entries: [],
    event: 'Timeout → entry removed', eventKo: '타임아웃 → 항목 삭제',
    detail: 'After 120 s, the TIME_WAIT entry expires and is garbage-collected. A new SYN on the same 5-tuple would create a fresh NEW entry.',
    detailKo: '120초 후 TIME_WAIT 항목이 만료되어 가비지 수집됩니다. 동일한 5-튜플의 새 SYN은 새 NEW 항목을 생성합니다.',
  },
]

const UDP_FRAMES: CtFrame[] = [
  {
    entries: [],
    event: 'Before query', eventKo: '쿼리 전',
    detail: 'No conntrack entry for this UDP flow yet.',
    detailKo: '이 UDP 흐름에 대한 conntrack 항목이 아직 없습니다.',
  },
  {
    entries: [{ proto: 'UDP', src: '10.0.0.5:52341', dst: '8.8.8.8:53', state: 'UNREPLIED', ttl: '30s', isNew: true }],
    event: 'DNS query → UNREPLIED', eventKo: 'DNS 쿼리 → UNREPLIED',
    detail: 'First UDP packet creates an UNREPLIED entry (30 s timeout). UDP has no handshake — conntrack waits for a reply in the opposite direction to confirm the flow.',
    detailKo: '첫 번째 UDP 패킷이 UNREPLIED 항목을 생성합니다 (30초 타임아웃). UDP는 핸드셰이크가 없음 — conntrack이 흐름 확인을 위해 반대 방향의 응답을 기다립니다.',
  },
  {
    entries: [{ proto: 'UDP', src: '10.0.0.5:52341', dst: '8.8.8.8:53', state: 'ASSURED', ttl: '120s', highlight: true }],
    event: 'DNS reply → ASSURED', eventKo: 'DNS 응답 → ASSURED',
    detail: 'DNS reply received. Conntrack transitions to ASSURED (120 s timeout, nf_conntrack_udp_timeout_stream). ASSURED means both directions have been seen — the entry won\'t be evicted under memory pressure.',
    detailKo: 'DNS 응답 수신. Conntrack이 ASSURED로 전환합니다 (120초 타임아웃, nf_conntrack_udp_timeout_stream). ASSURED는 양방향이 확인됨을 의미 — 메모리 부족 시에도 항목이 제거되지 않습니다.',
  },
  {
    entries: [],
    event: 'Idle timeout → removed', eventKo: '유휴 타임아웃 → 삭제',
    detail: 'No traffic for 120 s. The entry expires. Unlike TCP, there is no FIN/RST — UDP flows simply time out.',
    detailKo: '120초 동안 트래픽 없음. 항목 만료. TCP와 달리 FIN/RST가 없음 — UDP 흐름은 단순히 타임아웃됩니다.',
  },
]

const RELATED_FRAMES: CtFrame[] = [
  {
    entries: [
      { proto: 'TCP', src: '10.0.0.5:35200', dst: '93.184.216.34:21', state: 'ESTABLISHED', ttl: '432000s' },
    ],
    event: 'FTP control session active', eventKo: 'FTP 제어 세션 활성',
    detail: 'FTP control connection (port 21) is ESTABLISHED. The nf_conntrack_ftp helper is actively inspecting the payload for PORT/PASV commands.',
    detailKo: 'FTP 제어 연결 (포트 21)이 ESTABLISHED 상태입니다. nf_conntrack_ftp 헬퍼가 PORT/PASV 명령을 위해 페이로드를 검사하고 있습니다.',
  },
  {
    entries: [
      { proto: 'TCP', src: '10.0.0.5:35200', dst: '93.184.216.34:21',  state: 'ESTABLISHED', ttl: '432000s' },
      { proto: 'TCP', src: '93.184.216.34:20', dst: '10.0.0.5:49876', state: 'RELATED',      ttl: '60s',    isNew: true },
    ],
    event: 'PORT command → RELATED entry', eventKo: 'PORT 명령 → RELATED 항목',
    detail: 'Client sends a PORT command in the FTP control stream. The conntrack FTP helper parses it and pre-creates a RELATED entry for the incoming data connection (port 20 → 49876) before any data packet arrives.',
    detailKo: '클라이언트가 FTP 제어 스트림에 PORT 명령을 전송합니다. Conntrack FTP 헬퍼가 이를 파싱하고 패킷 도착 전에 포트 20 → 49876의 수신 데이터 연결을 위한 RELATED 항목을 미리 생성합니다.',
  },
  {
    entries: [
      { proto: 'TCP', src: '10.0.0.5:35200', dst: '93.184.216.34:21',  state: 'ESTABLISHED', ttl: '432000s' },
      { proto: 'TCP', src: '93.184.216.34:20', dst: '10.0.0.5:49876', state: 'ESTABLISHED', ttl: '432000s', highlight: true },
    ],
    event: 'Data connection arrives → ESTABLISHED', eventKo: '데이터 연결 도달 → ESTABLISHED',
    detail: 'FTP server opens the data channel. The SYN matches the RELATED entry — conntrack promotes it to ESTABLISHED. A firewall with a RELATED rule passes this connection without any explicit port 20 rule.',
    detailKo: 'FTP 서버가 데이터 채널을 엽니다. SYN이 RELATED 항목과 일치 — conntrack이 ESTABLISHED로 승격합니다. RELATED 트래픽을 허용하는 방화벽은 포트 20에 대한 명시적 규칙 없이 이 연결을 허용합니다.',
  },
]

const KEEPALIVE_FRAMES: CtFrame[] = [
  {
    entries: [{ proto: 'TCP', src: '10.0.0.5:51022', dst: '203.0.113.10:5432', state: 'ESTABLISHED', ttl: '300s' }],
    event: 'Idle pooled connection', eventKo: '유휴 상태의 풀 연결',
    detail: 'A pooled DB connection goes quiet behind a NAT host whose established timeout is tuned down to 300 s (cloud NAT gateways behave the same way — AWS NAT Gateway drops idle flows after 350 s). The ttl column is an idle timer: every packet in either direction resets it.',
    detailKo: 'Established 타임아웃을 300초로 낮춘 NAT 호스트 뒤에서 풀링된 DB 연결이 조용해집니다 (클라우드 NAT 게이트웨이도 동일 — AWS NAT Gateway는 350초 유휴 후 흐름을 삭제). ttl 컬럼은 유휴 타이머입니다: 어느 방향이든 패킷이 지나가면 초기화됩니다.',
  },
  {
    entries: [{ proto: 'TCP', src: '10.0.0.5:51022', dst: '203.0.113.10:5432', state: 'ESTABLISHED', ttl: '12s', highlight: true }],
    event: '288 s without a packet', eventKo: '288초 동안 패킷 없음',
    detail: 'Nothing has crossed the flow for 288 s, so only 12 s remain. The endpoints don\'t know this timer exists — their sockets are ESTABLISHED indefinitely.',
    detailKo: '288초 동안 흐름에 패킷이 없어 12초만 남았습니다. 양 끝단은 이 타이머의 존재를 모릅니다 — 소켓은 무기한 ESTABLISHED 상태입니다.',
  },
  {
    entries: [],
    event: 'Idle timeout → entry silently removed', eventKo: '유휴 타임아웃 → 항목 조용히 삭제',
    detail: 'The entry expires and the NAT mapping goes with it. No FIN or RST is sent to anyone — both hosts still believe the connection is open.',
    detailKo: '항목이 만료되며 NAT 매핑도 함께 사라집니다. 누구에게도 FIN이나 RST가 전송되지 않음 — 두 호스트 모두 연결이 열려 있다고 믿습니다.',
  },
  {
    entries: [],
    event: 'Next query → hang or RST', eventKo: '다음 쿼리 → 멈춤 또는 RST',
    detail: 'The app reuses the connection. A mid-stream segment is not a valid NEW packet: it is dropped as INVALID (nf_conntrack_tcp_loose=0), or picked up again and SNATed to a fresh source port the server has never seen, so the server answers with RST. The app sees a multi-minute hang or "connection reset by peer".',
    detailKo: '앱이 연결을 재사용합니다. 스트림 중간 세그먼트는 유효한 NEW 패킷이 아니므로 INVALID로 드롭되거나 (nf_conntrack_tcp_loose=0), 다시 추적되어 서버가 본 적 없는 새 출발지 포트로 SNAT됩니다 — 서버는 RST로 응답합니다. 앱은 수 분간의 멈춤 또는 "connection reset by peer"를 겪습니다.',
  },
  {
    entries: [{ proto: 'TCP', src: '10.0.0.5:51022', dst: '203.0.113.10:5432', state: 'ESTABLISHED', ttl: '180s' }],
    event: 'Fix: TCP keepalive at 120 s idle', eventKo: '해결: 유휴 120초에 TCP keepalive',
    detail: 'Same connection, now with SO_KEEPALIVE and TCP_KEEPIDLE=120. After 120 s of silence the kernel will send a probe. The ttl has counted down to 180 s — still well above zero.',
    detailKo: '같은 연결에 SO_KEEPALIVE와 TCP_KEEPIDLE=120을 설정했습니다. 120초 동안 조용하면 커널이 프로브를 보냅니다. ttl은 180초까지 줄었지만 아직 여유가 있습니다.',
  },
  {
    entries: [{ proto: 'TCP', src: '10.0.0.5:51022', dst: '203.0.113.10:5432', state: 'ESTABLISHED', ttl: '300s', highlight: true }],
    event: 'Keepalive probe + ACK → timer reset', eventKo: 'Keepalive 프로브 + ACK → 타이머 초기화',
    detail: 'The probe is an empty segment with seq = snd_nxt − 1, which forces the peer to ACK. Both packets cross the NAT host and reset the timer to 300 s. As long as keepidle < the smallest idle timeout on the path, the entry never expires.',
    detailKo: '프로브는 seq = snd_nxt − 1인 빈 세그먼트로, 상대방이 반드시 ACK하게 만듭니다. 두 패킷이 NAT 호스트를 지나며 타이머를 300초로 초기화합니다. keepidle이 경로상 가장 짧은 유휴 타임아웃보다 작은 한 항목은 만료되지 않습니다.',
  },
]

const CT_T = {
  en: {
    title: 'Linux connection tracking (conntrack)',
    readTime: '6 min',
    intro: 'How the Linux kernel tracks every active network flow — and how conntrack states feed into stateful firewall rules. Four scenarios: TCP lifecycle, UDP timeout, RELATED entry for FTP, and idle timeout vs. keepalive.',
    interactive: 'Conntrack Explorer',
    tabs: { tcp: 'TCP', udp: 'UDP', related: 'RELATED', keepalive: 'Keepalive' } as Record<Scenario, string>,
    headers: { proto: 'proto', src: 'source', dst: 'destination', state: 'state', ttl: 'ttl' },
    empty: 'No entries',
    seeAlso: 'See also: ',
    tcpLink: 'TCP handshake →',
    eduTitle: 'Conntrack states',
    facts: {
      new:         'First packet of a flow — reply not yet seen. Firewalls can accept or drop before state is established.',
      established: 'Bidirectional traffic confirmed. TCP: 5-day timeout. UDP: 2-min timeout. Most iptables/nftables policies allow ESTABLISHED by default.',
      related:     'New flow spawned by an existing tracked connection — e.g. FTP data channel, ICMP error for a tracked TCP flow. Requires a conntrack helper to inspect L7.',
      invalid:     'Packet does not match any known flow and fails sanity checks (bad flags, out-of-window sequence). Usually dropped.',
      timeWait:    'TCP connection closed; entry kept for 120 s to absorb delayed or duplicate packets still in flight.',
    },
    idleTitle: 'Idle timeout & keepalive',
    idle: {
      timer:      'Every conntrack timeout is an idle timer, not a lifetime. Any packet in either direction resets it; the entry is deleted only after a full timeout of silence — and nobody is notified.',
      defaults:   'Kernel defaults (net.netfilter.*): nf_conntrack_tcp_timeout_established = 432000 s, nf_conntrack_udp_timeout = 30 s, nf_conntrack_udp_timeout_stream = 120 s (180 s on older kernels). kube-proxy lowers established to 86400 s.',
      middlebox:  'Other stateful hops are far less patient: AWS NAT Gateway and NLB drop idle TCP flows after 350 s, ALB after 60 s, many home routers after a few minutes. The shortest idle timeout on the path is the one that matters.',
      tcpKa:      'TCP keepalive is off unless the app sets SO_KEEPALIVE. System defaults are tcp_keepalive_time = 7200 s, tcp_keepalive_intvl = 75 s, tcp_keepalive_probes = 9 — two hours is longer than almost any middlebox, so tune per socket with TCP_KEEPIDLE / TCP_KEEPINTVL / TCP_KEEPCNT.',
      appKa:      'Application-level keepalives do the same job and also prove the peer app is alive: HTTP/2 PING, gRPC keepalive, WebSocket ping, DB pool validation queries. UDP has no transport keepalive — WireGuard PersistentKeepalive = 25 s and IPsec NAT-T keepalives (20 s) exist for exactly this reason.',
      rule:       'Rule of thumb: keepalive interval < smallest idle timeout on the path. The alternative is making idle-connection reuse safe — cap pool idle time below that timeout, or retry on reset.',
    },
  },
  ko: {
    title: 'Linux 연결 추적 (conntrack)',
    readTime: '6분',
    intro: 'Linux 커널이 모든 활성 네트워크 흐름을 추적하는 방법 — 그리고 conntrack 상태가 상태 기반 방화벽 규칙에 어떻게 연결되는지. 네 가지 시나리오: TCP 생명주기, UDP 타임아웃, FTP용 RELATED 항목, 유휴 타임아웃과 keepalive.',
    interactive: 'Conntrack 탐색기',
    tabs: { tcp: 'TCP', udp: 'UDP', related: 'RELATED', keepalive: 'Keepalive' } as Record<Scenario, string>,
    headers: { proto: '프로토콜', src: '출발지', dst: '목적지', state: '상태', ttl: 'ttl' },
    empty: '항목 없음',
    seeAlso: '참고: ',
    tcpLink: 'TCP 핸드셰이크 →',
    eduTitle: 'Conntrack 상태',
    facts: {
      new:         '흐름의 첫 번째 패킷 — 아직 응답 미확인. 방화벽이 상태 수립 전에 허용 또는 차단할 수 있습니다.',
      established: '양방향 트래픽 확인됨. TCP: 5일 타임아웃. UDP: 2분 타임아웃. 대부분의 iptables/nftables 정책이 ESTABLISHED를 기본적으로 허용합니다.',
      related:     '기존 추적 연결에서 파생된 새 흐름 — 예: FTP 데이터 채널, 추적된 TCP 흐름에 대한 ICMP 오류. L7 검사를 위해 conntrack 헬퍼가 필요합니다.',
      invalid:     '패킷이 알려진 흐름과 일치하지 않고 온전성 검사 실패 (잘못된 플래그, 윈도우 외 시퀀스). 일반적으로 드롭됩니다.',
      timeWait:    'TCP 연결 종료됨; 아직 전송 중인 지연된 중복을 흡수하기 위해 항목이 120초 동안 유지됩니다.',
    },
    idleTitle: '유휴 타임아웃과 keepalive',
    idle: {
      timer:      '모든 conntrack 타임아웃은 수명이 아니라 유휴 타이머입니다. 어느 방향이든 패킷이 지나가면 초기화되며, 타임아웃 전체 기간 동안 조용해야 항목이 삭제됩니다 — 그리고 아무에게도 알리지 않습니다.',
      defaults:   '커널 기본값 (net.netfilter.*): nf_conntrack_tcp_timeout_established = 432000초, nf_conntrack_udp_timeout = 30초, nf_conntrack_udp_timeout_stream = 120초 (구버전 커널은 180초). kube-proxy는 established를 86400초로 낮춥니다.',
      middlebox:  '다른 상태 기반 홉은 훨씬 짧습니다: AWS NAT Gateway와 NLB는 유휴 TCP 흐름을 350초 후, ALB는 60초 후, 많은 가정용 라우터는 몇 분 후 삭제합니다. 경로상 가장 짧은 유휴 타임아웃이 기준입니다.',
      tcpKa:      'TCP keepalive는 앱이 SO_KEEPALIVE를 설정해야만 동작합니다. 시스템 기본값은 tcp_keepalive_time = 7200초, tcp_keepalive_intvl = 75초, tcp_keepalive_probes = 9 — 2시간은 거의 모든 중간 장비보다 길기 때문에 TCP_KEEPIDLE / TCP_KEEPINTVL / TCP_KEEPCNT로 소켓별로 조정해야 합니다.',
      appKa:      '애플리케이션 레벨 keepalive도 같은 역할을 하며 상대 앱이 살아 있는지까지 확인합니다: HTTP/2 PING, gRPC keepalive, WebSocket ping, DB 풀 검증 쿼리. UDP는 전송 계층 keepalive가 없어서 WireGuard PersistentKeepalive = 25초, IPsec NAT-T keepalive (20초)가 존재합니다.',
      rule:       '경험 법칙: keepalive 주기 < 경로상 가장 짧은 유휴 타임아웃. 또는 유휴 연결 재사용을 안전하게 만드세요 — 풀의 유휴 시간 상한을 그 타임아웃보다 낮추거나, reset 시 재시도합니다.',
    },
  },
}

const STATE_CLS: Record<string, string> = {
  NEW:         'ctb-new',
  SYN_RECV:    'ctb-syn',
  ESTABLISHED: 'ctb-est',
  TIME_WAIT:   'ctb-closing',
  FIN_WAIT:    'ctb-closing',
  UNREPLIED:   'ctb-unreplied',
  ASSURED:     'ctb-assured',
  RELATED:     'ctb-related',
}

function CtStateBadge({ state }: { state: string }) {
  return <span className={`ct-state-badge ${STATE_CLS[state] ?? ''}`}>{state}</span>
}

function EduFact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="tcp-edu-fact">
      <span className="tcp-edu-fact-k">{k}</span>
      <span className="tcp-edu-fact-v">{v}</span>
    </div>
  )
}

function ConntrackExplorer() {
  const { lang } = useLang()
  const t = CT_T[lang]
  const [scenario, setScenario] = useState<Scenario>('tcp')
  const [step, setStep] = useState(0)

  const allFrames = { tcp: TCP_FRAMES, udp: UDP_FRAMES, related: RELATED_FRAMES, keepalive: KEEPALIVE_FRAMES }[scenario]
  const frame = allFrames[step]
  const isLast = step >= allFrames.length - 1

  function switchScenario(s: Scenario) {
    setScenario(s)
    setStep(0)
  }

  const eventText  = lang === 'ko' ? frame.eventKo  : frame.event
  const detailText = lang === 'ko' ? frame.detailKo : frame.detail

  return (
    <div className="ct-root">
      <div className="ct-tabs">
        {(['tcp', 'udp', 'related', 'keepalive'] as Scenario[]).map(s => (
          <button key={s} className={`ct-tab${scenario === s ? ' active' : ''}`} onClick={() => switchScenario(s)}>
            {t.tabs[s]}
          </button>
        ))}
      </div>

      <div className="ct-table-wrap">
        <div className="ct-table-header">
          <span>{t.headers.proto}</span>
          <span>{t.headers.src}</span>
          <span>{t.headers.dst}</span>
          <span>{t.headers.state}</span>
          <span>{t.headers.ttl}</span>
        </div>
        {frame.entries.length === 0 ? (
          <div className="ct-empty">{t.empty}</div>
        ) : (
          frame.entries.map((e, i) => (
            <div key={i} className={`ct-row${e.isNew ? ' ct-row-new' : ''}${e.highlight ? ' ct-row-highlight' : ''}`}>
              <span className="ct-proto">{e.proto}</span>
              <span className="ct-addr">{e.src}</span>
              <span className="ct-addr">{e.dst}</span>
              <CtStateBadge state={e.state} />
              <span className="ct-ttl">{e.ttl}</span>
            </div>
          ))
        )}
      </div>

      <div className="ct-detail">
        <div className="ct-detail-event">{eventText}</div>
        <p className="ct-detail-body">{detailText}</p>
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
        <div className="tcp-progress-fill" style={{ width: `${(step / (allFrames.length - 1)) * 100}%` }} />
      </div>
    </div>
  )
}

export default function ConntrackPage() {
  const { lang } = useLang()
  const t = CT_T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-06-21"
      readTime={t.readTime}
      tags={['networking', 'linux', 'conntrack', 'firewall']}
      intro={t.intro}
    >
      <div className="tcp-edu-section">
        <div className="tcp-edu-title">{t.interactive}</div>
        <ConntrackExplorer />
      </div>

      <div className="tcp-edu-section">
        <div className="tcp-edu-title">{t.eduTitle}</div>
        <div className="tcp-edu-facts">
          <EduFact k="NEW"         v={t.facts.new} />
          <EduFact k="ESTABLISHED" v={t.facts.established} />
          <EduFact k="RELATED"     v={t.facts.related} />
          <EduFact k="INVALID"     v={t.facts.invalid} />
          <EduFact k="TIME_WAIT"   v={t.facts.timeWait} />
        </div>
      </div>

      <div className="tcp-edu-section">
        <div className="tcp-edu-title">{t.idleTitle}</div>
        <div className="tcp-edu-facts">
          <EduFact k="idle timer"    v={t.idle.timer} />
          <EduFact k="defaults"      v={t.idle.defaults} />
          <EduFact k="middleboxes"   v={t.idle.middlebox} />
          <EduFact k="TCP keepalive" v={t.idle.tcpKa} />
          <EduFact k="app keepalive" v={t.idle.appKa} />
          <EduFact k="rule"          v={t.idle.rule} />
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
