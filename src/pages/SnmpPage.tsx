import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type SnmpNodeId = 'nms' | 'agent'
type SnmpNodeSt = 'idle' | 'polling' | 'done' | 'processing' | 'trapping'
type SnmpLinkSt = 'idle' | 'request' | 'bulk' | 'response' | 'trap' | 'inform'
type RowState   = 'hidden' | 'querying' | 'ok'
type AlertState = 'none' | 'trap' | 'inform'

interface SnmpFrame {
  nodes:     Record<SnmpNodeId, SnmpNodeSt>
  link:      SnmpLinkSt
  pdu:       'none' | 'get' | 'bulk' | 'response' | 'trap' | 'inform'
  rowStates: [RowState, RowState, RowState, RowState, RowState]
  alert:     AlertState
}

// ── Graph geometry ─────────────────────────────────────────────────────────────

const SGW = 500
const SGH = 160

const NODE_PX: Record<SnmpNodeId, [number, number]> = {
  nms:   [130, 80],
  agent: [370, 80],
}

const NODE_IDS: SnmpNodeId[] = ['nms', 'agent']

const FWD_PATH = `M ${NODE_PX.nms[0]} ${NODE_PX.nms[1]} L ${NODE_PX.agent[0]} ${NODE_PX.agent[1]}`
const REV_PATH = `M ${NODE_PX.agent[0]} ${NODE_PX.agent[1]} L ${NODE_PX.nms[0]} ${NODE_PX.nms[1]}`

// ── Dashboard data ─────────────────────────────────────────────────────────────

const DASH_ROWS = [
  { label: 'sysUpTime',          oid: '1.3.6.1.2.1.1.3.0',     value: '3d 12h 15m' },
  { label: 'sysName',            oid: '1.3.6.1.2.1.1.5.0',     value: 'core-sw-01' },
  { label: 'Gi0/0 ifOperStatus', oid: '1.3.6.1.2.1.2.2.1.8.1', value: 'up' },
  { label: 'Gi0/0 ifInOctets',   oid: '1.3.6.1.2.1.2.2.1.10.1', value: '2.1 GB' },
  { label: 'Gi0/0 ifOutOctets',  oid: '1.3.6.1.2.1.2.2.1.16.1', value: '847 MB' },
] as const

// ── Frame data ─────────────────────────────────────────────────────────────────

const FRAMES: SnmpFrame[] = [
  // 0: overview
  { nodes: { nms: 'idle',    agent: 'idle'       }, link: 'idle',     pdu: 'none',
    rowStates: ['hidden',   'hidden',   'hidden',   'hidden',   'hidden'],   alert: 'none' },
  // 1: GetRequest — system group OIDs
  { nodes: { nms: 'polling', agent: 'processing' }, link: 'request',  pdu: 'get',
    rowStates: ['querying', 'querying', 'querying', 'hidden',   'hidden'],   alert: 'none' },
  // 2: GetResponse — system values arrive
  { nodes: { nms: 'done',   agent: 'idle'        }, link: 'response', pdu: 'response',
    rowStates: ['ok',       'ok',       'ok',       'hidden',   'hidden'],   alert: 'none' },
  // 3: GetBulkRequest — interface counters
  { nodes: { nms: 'polling', agent: 'processing' }, link: 'bulk',     pdu: 'bulk',
    rowStates: ['ok',       'ok',       'ok',       'querying', 'querying'], alert: 'none' },
  // 4: GetBulkResponse — counters arrive, dashboard full
  { nodes: { nms: 'done',   agent: 'idle'        }, link: 'response', pdu: 'response',
    rowStates: ['ok',       'ok',       'ok',       'ok',       'ok'],       alert: 'none' },
  // 5: Trap — linkDown, no ack
  { nodes: { nms: 'polling', agent: 'trapping'   }, link: 'trap',     pdu: 'trap',
    rowStates: ['ok',       'ok',       'ok',       'ok',       'ok'],       alert: 'trap' },
  // 6: InformRequest — reliable notification + ack
  { nodes: { nms: 'done',   agent: 'trapping'    }, link: 'inform',   pdu: 'inform',
    rowStates: ['ok',       'ok',       'ok',       'ok',       'ok'],       alert: 'inform' },
]

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title:    'SNMP — polling, traps, and the NMS dashboard',
    readTime: '6 min',
    intro:    `SNMP (Simple Network Management Protocol) is how network operations teams keep visibility into thousands of routers, switches, and servers without logging into each one. A Manager (NMS) polls device Agents on a schedule and stores the results — and when something breaks, the Agent pushes a Trap immediately rather than waiting for the next poll.`,
    nodeLabel: { nms: 'NMS', agent: 'Agent' } as Record<SnmpNodeId, string>,
    nodeSub:   { nms: 'Manager', agent: 'snmpd · UDP 161' } as Record<SnmpNodeId, string>,
    pduBadge:  { none: '', get: 'GetRequest', bulk: 'GetBulkRequest', response: 'GetResponse', trap: 'Trap-PDU', inform: 'InformRequest' },
    dashTitle:   'NMS Dashboard',
    metricsTitle: 'METRICS',
    eventsTitle:  'EVENTS',
    querying:    'querying...',
    noEvents:    'No events',
    trapBadge:   'TRAP',
    informBadge: 'INFORM',
    ackBadge:    'ACK',
    alertMsg:    'linkDown on Gi0/1',
    frames: [
      { title: 'SNMP — Manager polls Agent, Agent pushes Traps',
        note:  `SNMP gives network operators a single protocol for monitoring any metric from any device. The Manager (NMS) polls device Agents on a regular schedule — every 60 seconds is typical — and stores results in a time-series database. The dashboard starts empty: no data until polling begins.` },
      { title: 'GetRequest — querying the system group (UDP 161)',
        note:  `The NMS sends a GetRequest UDP datagram to the agent on port 161. The datagram contains three OIDs in one packet: sysUpTime (1.3.6.1.2.1.1.3.0), sysName (1.3.6.1.2.1.1.5.0), and Gi0/0 ifOperStatus (1.3.6.1.2.1.2.2.1.8.1). While the agent resolves them, the dashboard shows querying for each row.` },
      { title: 'GetResponse — system values arrive',
        note:  `The agent reads each OID value from the kernel and returns them in a single GetResponse PDU. The NMS matches the response to the original request via request ID, extracts the variable bindings, and writes the values to its database. Three rows populate: uptime, hostname, and interface status.` },
      { title: 'GetBulkRequest — pulling interface counters (v2c+, UDP 161)',
        note:  `GetBulkRequest lets the NMS retrieve a large block of MIB data in one round-trip — up to max-repetitions rows per OID column. Here the NMS asks for Gi0/0 ifInOctets and ifOutOctets, the byte counters needed to compute bandwidth utilization over the polling interval.` },
      { title: 'GetBulkResponse — dashboard fully populated',
        note:  `The agent returns both byte counters: 2.1 GB received and 847 MB transmitted on Gi0/0. The NMS computes utilization by dividing the counter delta by the polling interval. The dashboard is now fully populated with five live OID values — all collected in just two polling round-trips.` },
      { title: 'Trap-PDU — agent pushes a linkDown event (UDP 162)',
        note:  `Five minutes later, Gi0/1 goes down. The agent does not wait for the next poll cycle — it fires a Trap-PDU immediately to the NMS on UDP 162. The Trap contains the OID for linkDown plus the ifIndex of the affected interface. There is no acknowledgment: if the datagram is lost in transit, the NMS never finds out.` },
      { title: 'InformRequest — reliable push notification (v2c+, UDP 162)',
        note:  `InformRequest solves the fire-and-forget problem of plain Traps. The NMS must reply with a Response PDU using the same request ID — if the agent times out without receiving an ack, it retransmits. The dashboard shows the event with an ACK badge, confirming the NMS received it.` },
    ],
    pduTitle:   'SNMP PDU types',
    pduHeaders: ['PDU', 'Direction', 'Port', 'Description'],
    pdus: [
      { pdu: 'GetRequest',     dir: 'Manager → Agent', port: 'UDP 161', desc: 'Retrieve the value of one or more OIDs.' },
      { pdu: 'GetNextRequest', dir: 'Manager → Agent', port: 'UDP 161', desc: 'Retrieve the next OID in the MIB tree — used to walk the MIB.' },
      { pdu: 'GetBulkRequest', dir: 'Manager → Agent', port: 'UDP 161', desc: 'Retrieve large blocks of OID data in one round-trip (v2c+).' },
      { pdu: 'SetRequest',     dir: 'Manager → Agent', port: 'UDP 161', desc: 'Write a value to a writable OID (e.g. set ifAdminStatus to take a port down).' },
      { pdu: 'Response',       dir: 'Agent → Manager', port: 'UDP 161', desc: 'Return OID-value pairs or an error code in reply to any Request.' },
      { pdu: 'Trap-PDU',      dir: 'Agent → Manager', port: 'UDP 162', desc: 'Unsolicited event notification — no acknowledgment, fire and forget.' },
      { pdu: 'InformRequest',  dir: 'Agent → Manager', port: 'UDP 162', desc: 'Reliable notification — agent retransmits until manager responds (v2c+).' },
    ],
    verTitle:   'SNMP versions',
    verHeaders: ['Version', 'Authentication', 'Encryption', 'Notes'],
    versions: [
      { ver: 'v1',  auth: 'Community string',   enc: 'None',    note: 'Original RFC 1157 (1988). Community string sent in plaintext.' },
      { ver: 'v2c', auth: 'Community string',   enc: 'None',    note: 'Adds GetBulk, 64-bit counters, InformRequest. Still plaintext community.' },
      { ver: 'v3',  auth: 'Username + MD5/SHA', enc: 'DES/AES', note: 'USM (User-based Security Model) — proper auth and encryption. Required for compliance.' },
    ],
  },
  ko: {
    title:    'SNMP — 폴링, 트랩, NMS 대시보드',
    readTime: '6분',
    intro:    `SNMP(Simple Network Management Protocol)는 네트워크 운영팀이 수천 대의 라우터, 스위치, 서버에 일일이 접속하지 않고도 가시성을 유지하는 프로토콜입니다. 매니저(NMS)는 기기 에이전트를 주기적으로 폴링해 결과를 저장하고, 장애가 발생하면 에이전트가 다음 폴링을 기다리지 않고 즉시 Trap을 전송합니다.`,
    nodeLabel: { nms: 'NMS', agent: '에이전트' } as Record<SnmpNodeId, string>,
    nodeSub:   { nms: '매니저', agent: 'snmpd · UDP 161' } as Record<SnmpNodeId, string>,
    pduBadge:  { none: '', get: 'GetRequest', bulk: 'GetBulkRequest', response: 'GetResponse', trap: 'Trap-PDU', inform: 'InformRequest' },
    dashTitle:   'NMS 대시보드',
    metricsTitle: 'METRICS',
    eventsTitle:  'EVENTS',
    querying:    '조회 중...',
    noEvents:    '이벤트 없음',
    trapBadge:   'TRAP',
    informBadge: 'INFORM',
    ackBadge:    'ACK',
    alertMsg:    'Gi0/1 linkDown',
    frames: [
      { title: 'SNMP — 매니저가 폴링, 에이전트가 Trap 전송',
        note:  `SNMP는 어떤 기기에서든 모든 메트릭을 모니터링할 수 있는 단일 프로토콜입니다. 매니저(NMS)는 기기 에이전트를 정기적으로 폴링(보통 60초마다)하고 결과를 시계열 데이터베이스에 저장합니다. 폴링을 시작하기 전까지 대시보드는 비어 있습니다.` },
      { title: 'GetRequest — 시스템 그룹 OID 조회 (UDP 161)',
        note:  `NMS가 포트 161의 에이전트에 GetRequest UDP 데이터그램을 전송합니다. 단일 패킷에 세 개의 OID가 포함됩니다: sysUpTime(1.3.6.1.2.1.1.3.0), sysName(1.3.6.1.2.1.1.5.0), Gi0/0 ifOperStatus(1.3.6.1.2.1.2.2.1.8.1). 에이전트가 조회하는 동안 대시보드는 해당 행에 "조회 중"을 표시합니다.` },
      { title: 'GetResponse — 시스템 값 도착',
        note:  `에이전트가 커널에서 각 OID 값을 읽어 단일 GetResponse PDU로 반환합니다. NMS는 요청 ID로 응답을 매칭하고 variable binding을 추출해 데이터베이스에 씁니다. 가동 시간, 호스트명, 인터페이스 상태 세 행이 채워집니다.` },
      { title: 'GetBulkRequest — 인터페이스 카운터 조회 (v2c 이상, UDP 161)',
        note:  `GetBulkRequest를 사용하면 한 번의 왕복으로 대용량 MIB 데이터를 조회할 수 있습니다. NMS가 Gi0/0 ifInOctets와 ifOutOctets — 대역폭 사용률 계산에 필요한 바이트 카운터 — 를 요청합니다.` },
      { title: 'GetBulkResponse — 대시보드 완성',
        note:  `에이전트가 두 바이트 카운터를 반환합니다: Gi0/0에서 수신 2.1 GB, 송신 847 MB. NMS는 카운터 델타를 폴링 간격으로 나눠 사용률을 계산합니다. 대시보드가 이제 다섯 개의 OID 값으로 완전히 채워졌습니다 — 단 두 번의 폴링으로.` },
      { title: 'Trap-PDU — 에이전트가 linkDown 이벤트 전송 (UDP 162)',
        note:  `5분 후 Gi0/1이 다운됩니다. 에이전트는 다음 폴링을 기다리지 않고 즉시 UDP 162로 NMS에 Trap-PDU를 전송합니다. Trap에는 linkDown OID와 영향받은 인터페이스의 ifIndex가 포함됩니다. 응답이 없습니다 — 데이터그램이 손실되면 NMS는 알 수 없습니다.` },
      { title: 'InformRequest — 신뢰성 있는 알림 (v2c 이상, UDP 162)',
        note:  `InformRequest는 일반 Trap의 전송 후 망각 문제를 해결합니다. NMS가 동일한 요청 ID로 Response PDU를 회신해야 합니다 — 에이전트가 타임아웃 내에 응답을 받지 못하면 재전송합니다. 대시보드에 ACK 배지가 표시되어 NMS가 수신을 확인했음을 알립니다.` },
    ],
    pduTitle:   'SNMP PDU 타입',
    pduHeaders: ['PDU', '방향', '포트', '설명'],
    pdus: [
      { pdu: 'GetRequest',     dir: '매니저 → 에이전트', port: 'UDP 161', desc: '하나 이상의 OID 값을 조회합니다.' },
      { pdu: 'GetNextRequest', dir: '매니저 → 에이전트', port: 'UDP 161', desc: 'MIB 트리에서 다음 OID를 조회 — MIB 탐색에 사용됩니다.' },
      { pdu: 'GetBulkRequest', dir: '매니저 → 에이전트', port: 'UDP 161', desc: '한 번의 왕복으로 대용량 OID 데이터를 조회합니다 (v2c 이상).' },
      { pdu: 'SetRequest',     dir: '매니저 → 에이전트', port: 'UDP 161', desc: '쓰기 가능한 OID에 값을 씁니다 (예: 포트 다운을 위한 ifAdminStatus 설정).' },
      { pdu: 'Response',       dir: '에이전트 → 매니저', port: 'UDP 161', desc: '모든 Request에 대한 응답으로 OID-값 쌍 또는 오류 코드를 반환합니다.' },
      { pdu: 'Trap-PDU',      dir: '에이전트 → 매니저', port: 'UDP 162', desc: '비요청 이벤트 알림 — 응답 없음, 전송 후 잊어버림.' },
      { pdu: 'InformRequest',  dir: '에이전트 → 매니저', port: 'UDP 162', desc: '신뢰성 있는 알림 — 매니저가 응답할 때까지 에이전트가 재전송합니다 (v2c 이상).' },
    ],
    verTitle:   'SNMP 버전',
    verHeaders: ['버전', '인증', '암호화', '비고'],
    versions: [
      { ver: 'v1',  auth: '커뮤니티 문자열',    enc: '없음',    note: '원본 RFC 1157 (1988). 커뮤니티 문자열이 평문으로 전송됩니다.' },
      { ver: 'v2c', auth: '커뮤니티 문자열',    enc: '없음',    note: 'GetBulk, 64비트 카운터, InformRequest 추가. 여전히 평문 커뮤니티.' },
      { ver: 'v3',  auth: '사용자명 + MD5/SHA', enc: 'DES/AES', note: 'USM(User-based Security Model) — 적절한 인증과 암호화. 컴플라이언스 필수.' },
    ],
  },
}

// ── Graph ──────────────────────────────────────────────────────────────────────

function SnmpGraph({ frame, t }: { frame: SnmpFrame; t: typeof T['en'] }) {
  const isForward = frame.link === 'request' || frame.link === 'bulk'
  const isReverse = frame.link === 'response' || frame.link === 'trap' || frame.link === 'inform'
  const dotCls    = frame.link === 'trap' ? 'snmp-gdot snmp-gdot-trap'
                  : isReverse ? 'snmp-gdot snmp-gdot-rev' : 'snmp-gdot'

  return (
    <div className="snmp-graph-canvas">
      <svg viewBox={`0 0 ${SGW} ${SGH}`} className="snmp-graph-svg" preserveAspectRatio="none">
        <defs>
          <path id="snmpp-fwd" d={FWD_PATH} fill="none" />
          <path id="snmpp-rev" d={REV_PATH} fill="none" />
        </defs>
        <line
          x1={NODE_PX.nms[0]}   y1={NODE_PX.nms[1]}
          x2={NODE_PX.agent[0]} y2={NODE_PX.agent[1]}
          className={`snmp-sline snmp-sline-${frame.link}`} strokeWidth="2"
        />
        {isForward && (
          <circle r="5" className="snmp-gdot">
            <animateMotion dur="1.0s" repeatCount="indefinite">
              <mpath href="#snmpp-fwd" />
            </animateMotion>
          </circle>
        )}
        {isReverse && (
          <circle r="5" className={dotCls}>
            <animateMotion dur="1.0s" repeatCount="indefinite">
              <mpath href="#snmpp-rev" />
            </animateMotion>
          </circle>
        )}
      </svg>

      {/* PDU badge */}
      {frame.pdu !== 'none' && (
        <span className={`snmp-pdu-badge snmp-pdu-${frame.pdu}`}>
          {t.pduBadge[frame.pdu]}
        </span>
      )}

      {/* Port label — mid-link, below the line */}
      {frame.link !== 'idle' && (
        <span className="graph-linklabel graph-linklabel-on snmp-port-label">
          {(frame.link === 'trap' || frame.link === 'inform') ? 'UDP 162' : 'UDP 161'}
        </span>
      )}

      {/* Node boxes */}
      {NODE_IDS.map(nid => {
        const [px, py] = NODE_PX[nid]
        const st = frame.nodes[nid]
        return (
          <div key={nid}
            className={`snmp-gnode snmp-gnode-${st}`}
            style={{ left: `${(px / SGW) * 100}%`, top: `${(py / SGH) * 100}%` }}
          >
            <span className="snmp-gnode-label">{t.nodeLabel[nid]}</span>
            <span className="snmp-gnode-sub">{t.nodeSub[nid]}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

function SnmpDashboard({ frame, t }: { frame: SnmpFrame; t: typeof T['en'] }) {
  const hasAlert = frame.alert !== 'none'
  return (
    <div className="snmp-dash-panel">
      <div className="snmp-dash-header">
        <span>{t.dashTitle}</span>
        <span className="snmp-dash-device">core-sw-01</span>
      </div>
      <div className="snmp-dash-body">
        <div className="snmp-dash-section-title">{t.metricsTitle}</div>
        <table className="snmp-dash-table">
          <tbody>
            {DASH_ROWS.map((row, i) => {
              const st = frame.rowStates[i]
              return (
                <tr key={row.label} className={`snmp-dash-row snmp-dash-row-${st}`}>
                  <td className="snmp-dash-label">{row.label}</td>
                  <td className="snmp-dash-oid">{row.oid}</td>
                  <td className={`snmp-dash-val${st === 'querying' ? ' snmp-dash-val-querying' : ''}`}>
                    {st === 'hidden' ? '—' : st === 'querying' ? t.querying : row.value}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="snmp-dash-divider" />
        <div className="snmp-dash-section-title">{t.eventsTitle}</div>
        {!hasAlert && <div className="snmp-dash-no-events">{t.noEvents}</div>}
        {hasAlert && (
          <div className="snmp-dash-event">
            <span className={`snmp-dash-event-badge snmp-dash-event-${frame.alert}`}>
              {frame.alert === 'trap' ? t.trapBadge : t.informBadge}
            </span>
            {frame.alert === 'inform' && (
              <span className="snmp-dash-event-badge snmp-dash-event-ack">{t.ackBadge}</span>
            )}
            <span className="snmp-dash-event-time">14:23:01</span>
            <span className="snmp-dash-event-msg">{t.alertMsg}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Explorer ───────────────────────────────────────────────────────────────────

function SnmpExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const total = FRAMES.length
  const [step, setStep]       = useState(0)
  const [playing, setPlaying] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLast = step >= total - 1

  useEffect(() => {
    if (!playing) return
    if (isLast) { setPlaying(false); return }
    timerRef.current = setTimeout(() => { setStep(s => s + 1) }, 1500)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [playing, step, isLast])

  function reset()   { setPlaying(false); setStep(0) }
  function stepFwd() { if (!isLast) setStep(s => s + 1) }
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

  return (
    <div className="inet-root">
      <SnmpGraph frame={frame} t={t} />
      <SnmpDashboard frame={frame} t={t} />
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

// ── PDU table ──────────────────────────────────────────────────────────────────

function PduTable() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <div className="ov-proto-section">
      <div className="bgp2-section-title">{t.pduTitle}</div>
      <table className="ov-proto-table">
        <thead>
          <tr>{t.pduHeaders.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.pdus.map(r => (
            <tr key={r.pdu}>
              <td><code>{r.pdu}</code></td>
              <td>{r.dir}</td>
              <td><code>{r.port}</code></td>
              <td>{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Version table ──────────────────────────────────────────────────────────────

function VersionTable() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <div className="ov-proto-section">
      <div className="bgp2-section-title">{t.verTitle}</div>
      <table className="ov-proto-table">
        <thead>
          <tr>{t.verHeaders.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.versions.map(r => (
            <tr key={r.ver}>
              <td><code className="snmp-ver-code">{r.ver}</code></td>
              <td>{r.auth}</td>
              <td>{r.enc}</td>
              <td>{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SnmpPage() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-07-20"
      readTime={t.readTime}
      tags={['networking', 'monitoring', 'snmp', 'infrastructure']}
      intro={t.intro}
    >
      <SnmpExplorer />
      <PduTable />
      <VersionTable />
    </NoteLayout>
  )
}
