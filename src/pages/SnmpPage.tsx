import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type SnmpNodeId = 'nms' | 'agent' | 'mib'
type SnmpNodeSt = 'idle' | 'polling' | 'done' | 'processing' | 'trapping' | 'active'
type SnmpLinkId = 'nms_agent' | 'agent_mib'
type SnmpLinkSt = 'idle' | 'request' | 'response' | 'trap' | 'inform' | 'lookup'

interface SnmpFrame {
  nodes: Record<SnmpNodeId, SnmpNodeSt>
  links: Record<SnmpLinkId, SnmpLinkSt>
  pdu:   'none' | 'get' | 'response' | 'trap' | 'inform'
}

// ── Graph geometry ─────────────────────────────────────────────────────────────

const SGW = 480
const SGH = 200

const NODE_PX: Record<SnmpNodeId, [number, number]> = {
  nms:   [80,  100],
  agent: [280, 100],
  mib:   [430, 100],
}

const NODE_IDS: SnmpNodeId[] = ['nms', 'agent', 'mib']

const LINK_PATHS: Record<SnmpLinkId, string> = {
  nms_agent: `M ${NODE_PX.nms[0]} ${NODE_PX.nms[1]} L ${NODE_PX.agent[0]} ${NODE_PX.agent[1]}`,
  agent_mib: `M ${NODE_PX.agent[0]} ${NODE_PX.agent[1]} L ${NODE_PX.mib[0]} ${NODE_PX.mib[1]}`,
}

const LINK_PATHS_REV: Record<SnmpLinkId, string> = {
  nms_agent: `M ${NODE_PX.agent[0]} ${NODE_PX.agent[1]} L ${NODE_PX.nms[0]} ${NODE_PX.nms[1]}`,
  agent_mib: `M ${NODE_PX.mib[0]} ${NODE_PX.mib[1]} L ${NODE_PX.agent[0]} ${NODE_PX.agent[1]}`,
}

const LINKS: Array<{ id: SnmpLinkId; from: SnmpNodeId; to: SnmpNodeId }> = [
  { id: 'nms_agent', from: 'nms',   to: 'agent' },
  { id: 'agent_mib', from: 'agent', to: 'mib'   },
]

// ── Frame data ─────────────────────────────────────────────────────────────────

const N0: Record<SnmpNodeId, SnmpNodeSt> = { nms: 'idle', agent: 'idle', mib: 'idle' }
const L0: Record<SnmpLinkId, SnmpLinkSt> = { nms_agent: 'idle', agent_mib: 'idle' }

const FRAMES: SnmpFrame[] = [
  { nodes: N0, links: L0, pdu: 'none' },
  { nodes: { nms: 'polling', agent: 'processing', mib: 'idle'   }, links: { nms_agent: 'request',  agent_mib: 'idle'   }, pdu: 'get'      },
  { nodes: { nms: 'polling', agent: 'processing', mib: 'active' }, links: { nms_agent: 'idle',     agent_mib: 'lookup' }, pdu: 'get'      },
  { nodes: { nms: 'done',    agent: 'idle',       mib: 'idle'   }, links: { nms_agent: 'response', agent_mib: 'idle'   }, pdu: 'response' },
  { nodes: { nms: 'polling', agent: 'trapping',   mib: 'idle'   }, links: { nms_agent: 'trap',     agent_mib: 'idle'   }, pdu: 'trap'     },
  { nodes: { nms: 'done',    agent: 'trapping',   mib: 'idle'   }, links: { nms_agent: 'inform',   agent_mib: 'idle'   }, pdu: 'inform'   },
]

// ── Translations ───────────────────────────────────────────────────────────────

const MIB_TREE = `1 · iso
└── 3 · org
    └── 6 · dod
        └── 1 · internet
            ├── 2 · mgmt
            │   └── 1 · mib-2  (RFC 1213)
            │       ├── 1 · system
            │       │   ├── .1.0  sysDescr       "Cisco IOS 17.3.4a"
            │       │   ├── .3.0  sysUpTime      1234500 TimeTicks
            │       │   └── .5.0  sysName        "core-sw-01"
            │       └── 2 · interfaces
            │           └── .1.2.1  ifDescr[1]   "GigabitEthernet0/0"
            └── 4 · private
                └── 1 · enterprises
                    ├── 9    · Cisco
                    └── 2636 · Juniper`

const T = {
  en: {
    title:    'SNMP — polling, traps, and the MIB',
    readTime: '6 min',
    intro:    `SNMP (Simple Network Management Protocol) is how network operations teams keep visibility into thousands of routers, switches, firewalls, and servers without logging into each one. An SNMP manager (NMS) can poll any metric exposed by a device's agent — CPU load, interface counters, link state — and devices can proactively notify the NMS the moment something changes, without waiting to be asked.`,
    nodeLabel: { nms: 'NMS', agent: 'Agent', mib: 'MIB' } as Record<SnmpNodeId, string>,
    nodeSub:   { nms: 'Manager', agent: 'snmpd · UDP 161', mib: 'OID tree' } as Record<SnmpNodeId, string>,
    linkLabel: {
      nms_agent: 'GET / TRAP / INFORM',
      agent_mib: 'OID lookup',
    } as Record<SnmpLinkId, string>,
    pduBadge: { none: '', get: 'GetRequest', response: 'GetResponse', trap: 'Trap-PDU', inform: 'InformRequest' },
    frames: [
      { title: 'SNMP — three components, two communication patterns',
        note:  `SNMP has three building blocks: the Manager (NMS) that sends queries and receives notifications; the Agent (snmpd) that runs on each device and answers queries; and the MIB — a hierarchical namespace that defines every metric the agent can expose. Communication flows in two directions: the manager polls the agent (request/response on UDP 161), and the agent pushes unsolicited notifications to the manager (TRAP/INFORM on UDP 162).` },
      { title: 'GetRequest — manager polls agent for one OID',
        note:  `The NMS sends a GetRequest UDP datagram to the agent on port 161. The request contains a list of OIDs to retrieve — for example, 1.3.6.1.2.1.1.3.0 (sysUpTime). The agent receives it and must now resolve each OID to a live value by consulting the MIB.` },
      { title: 'Agent resolves OID in the MIB',
        note:  `The agent looks up 1.3.6.1.2.1.1.3.0 in its local MIB. The MIB entry for sysUpTime says: type TimeTicks, read-only, value = time since last reinitialization. The agent reads this from the OS kernel, wraps it in a VarBind (OID + value pair), and prepares the Response PDU.` },
      { title: 'GetResponse — agent returns the value',
        note:  `The agent sends a GetResponse UDP datagram back to the NMS. It contains the same request ID (so the NMS can match it to the original query) plus the OID-value pairs: 1.3.6.1.2.1.1.3.0 = 1234500 TimeTicks (about 3.4 hours). The NMS stores this in its time-series database and schedules the next poll.` },
      { title: 'Trap-PDU — unsolicited notification, no acknowledgment',
        note:  `A Trap is the agent acting without being asked. When something notable happens — a link goes down, a threshold is crossed, the device reboots — the agent sends a Trap-PDU to the NMS on UDP 162. There is no request ID and no acknowledgment: the agent fires and forgets. If the datagram is lost in transit, the NMS never knows.` },
      { title: 'InformRequest — notification with acknowledgment (v2c+)',
        note:  `InformRequest solves the reliability problem of plain Traps. The agent sends the notification to the NMS on UDP 162, but now the NMS must reply with a Response PDU using the same request ID. If the agent does not receive an acknowledgment within a timeout window, it retransmits. InformRequest was introduced in SNMPv2c and is available in v3.` },
    ],
    mibTitle: 'Understanding the MIB',
    mibBody:  `The Management Information Base is a hierarchical namespace — a tree of managed objects, each with a unique numeric address called an OID (Object Identifier). An OID is a dotted sequence of integers tracing a path from the root down to a specific leaf: 1.3.6.1.2.1.1.3.0 means iso(1) → org(3) → dod(6) → internet(1) → mgmt(2) → mib-2(1) → system(1) → sysUpTime(3) → instance 0.`,
    mibNote:  `MIB definition files (written in ASN.1, with a .mib extension) ship with every device and tell the NMS the human-readable name, data type, access level (read-only or read-write), and description of every OID. Without these files loaded, the NMS displays raw OID numbers instead of friendly names. Vendors extend the tree under the enterprises subtree (1.3.6.1.4.1) with proprietary metrics not covered by any RFC — for example, Cisco-specific CPU utilization or fan speed polled via Cisco's private MIB.`,
    pduTitle:   'SNMP PDU types',
    pduHeaders: ['PDU', 'Direction', 'Port', 'Description'],
    pdus: [
      { pdu: 'GetRequest',     dir: 'Manager → Agent', port: 'UDP 161', desc: 'Retrieve the value of one or more OIDs.' },
      { pdu: 'GetNextRequest', dir: 'Manager → Agent', port: 'UDP 161', desc: 'Retrieve the next OID in the MIB tree — used to walk the MIB.' },
      { pdu: 'GetBulkRequest', dir: 'Manager → Agent', port: 'UDP 161', desc: 'Retrieve large blocks of data in one round-trip (v2c+).' },
      { pdu: 'SetRequest',     dir: 'Manager → Agent', port: 'UDP 161', desc: 'Write a value to a writable OID (e.g. set ifAdminStatus to take a port down).' },
      { pdu: 'Response',       dir: 'Agent → Manager', port: 'UDP 161', desc: 'Return OID-value pairs or an error code in reply to any Request.' },
      { pdu: 'Trap-PDU',      dir: 'Agent → Manager', port: 'UDP 162', desc: 'Unsolicited event notification — no acknowledgment, fire and forget.' },
      { pdu: 'InformRequest',  dir: 'Agent → Manager', port: 'UDP 162', desc: 'Reliable notification — agent retransmits until manager responds (v2c+).' },
    ],
    verTitle:   'SNMP versions',
    verHeaders: ['Version', 'Authentication', 'Encryption', 'Notes'],
    versions: [
      { ver: 'v1',  auth: 'Community string',   enc: 'None',     note: 'Original RFC 1157 (1988). Community string sent in plaintext.' },
      { ver: 'v2c', auth: 'Community string',   enc: 'None',     note: 'Adds GetBulk, 64-bit counters, InformRequest. Still plaintext community.' },
      { ver: 'v3',  auth: 'Username + MD5/SHA', enc: 'DES/AES',  note: 'USM (User-based Security Model) — proper auth and encryption. Required for compliance.' },
    ],
  },
  ko: {
    title:    'SNMP — 폴링, 트랩, MIB',
    readTime: '6분',
    intro:    `SNMP(Simple Network Management Protocol)는 네트워크 운영팀이 수천 대의 라우터, 스위치, 방화벽, 서버에 일일이 접속하지 않고도 가시성을 확보하는 프로토콜입니다. SNMP 매니저(NMS)는 기기의 에이전트가 노출하는 CPU 부하, 인터페이스 카운터, 링크 상태 등 모든 메트릭을 폴링할 수 있으며, 기기는 변화가 생겼을 때 폴링을 기다리지 않고 즉시 NMS에 알릴 수 있습니다.`,
    nodeLabel: { nms: 'NMS', agent: '에이전트', mib: 'MIB' } as Record<SnmpNodeId, string>,
    nodeSub:   { nms: '매니저', agent: 'snmpd · UDP 161', mib: 'OID 트리' } as Record<SnmpNodeId, string>,
    linkLabel: {
      nms_agent: 'GET / TRAP / INFORM',
      agent_mib: 'OID 조회',
    } as Record<SnmpLinkId, string>,
    pduBadge: { none: '', get: 'GetRequest', response: 'GetResponse', trap: 'Trap-PDU', inform: 'InformRequest' },
    frames: [
      { title: 'SNMP — 세 가지 구성 요소, 두 가지 통신 패턴',
        note:  `SNMP는 세 가지 구성 요소로 이루어집니다: 쿼리를 보내고 알림을 받는 매니저(NMS), 각 기기에서 실행되며 쿼리에 응답하는 에이전트(snmpd), 그리고 에이전트가 노출할 수 있는 모든 메트릭을 정의하는 계층적 네임스페이스인 MIB. 통신은 두 방향으로 흐릅니다: 매니저가 에이전트에 폴링(UDP 161 요청/응답)하거나, 에이전트가 비요청 알림을 매니저에게 전송(UDP 162 TRAP/INFORM)합니다.` },
      { title: 'GetRequest — 매니저가 에이전트에 OID 폴링',
        note:  `NMS가 포트 161의 에이전트에 GetRequest UDP 데이터그램을 보냅니다. 요청에는 조회할 OID 목록이 포함됩니다 — 예: 1.3.6.1.2.1.1.3.0 (sysUpTime). 에이전트는 이를 수신하고 MIB를 참조해 각 OID를 실제 값으로 변환해야 합니다.` },
      { title: '에이전트가 MIB에서 OID 조회',
        note:  `에이전트가 로컬 MIB에서 1.3.6.1.2.1.1.3.0을 조회합니다. sysUpTime의 MIB 항목은 타입 TimeTicks, 읽기 전용, 값 = 마지막 재초기화 이후 경과 시간임을 명시합니다. 에이전트는 OS 커널에서 이 값을 읽어 VarBind(OID + 값 쌍)로 감싸 Response PDU를 준비합니다.` },
      { title: 'GetResponse — 에이전트가 값 반환',
        note:  `에이전트가 NMS에 GetResponse UDP 데이터그램을 전송합니다. 원본 쿼리와 매칭할 수 있는 동일한 요청 ID와 OID-값 쌍이 포함됩니다: 1.3.6.1.2.1.1.3.0 = 1234500 TimeTicks (약 3.4시간). NMS는 이 값을 시계열 데이터베이스에 저장하고 다음 폴링을 예약합니다.` },
      { title: 'Trap-PDU — 비요청 알림, 응답 없음',
        note:  `Trap은 에이전트가 요청 없이 스스로 행동하는 방식입니다. 링크 다운, 임계값 초과, 기기 재부팅 등 주목할 만한 이벤트가 발생하면 에이전트가 UDP 162로 NMS에 Trap-PDU를 전송합니다. 요청 ID도, 응답도 없습니다 — 에이전트는 전송하고 잊어버립니다. 데이터그램이 전송 중 손실되면 NMS는 알 수 없습니다.` },
      { title: 'InformRequest — 응답이 있는 알림 (v2c 이상)',
        note:  `InformRequest는 일반 Trap의 신뢰성 문제를 해결합니다. 에이전트가 UDP 162로 알림을 보내지만 NMS는 동일한 요청 ID로 Response PDU를 회신해야 합니다. 에이전트가 타임아웃 내에 응답을 받지 못하면 재전송합니다. InformRequest는 SNMPv2c에서 도입되었으며 v3에서도 사용 가능합니다.` },
    ],
    mibTitle: 'MIB 이해하기',
    mibBody:  `MIB(Management Information Base)는 계층적 네임스페이스 — 각 항목이 OID(Object Identifier)라는 고유한 숫자 주소를 가진 관리 객체 트리입니다. OID는 루트에서 특정 리프까지의 경로를 추적하는 점으로 구분된 정수 시퀀스입니다: 1.3.6.1.2.1.1.3.0은 iso(1) → org(3) → dod(6) → internet(1) → mgmt(2) → mib-2(1) → system(1) → sysUpTime(3) → 인스턴스 0을 의미합니다.`,
    mibNote:  `MIB 정의 파일(ASN.1로 작성된 .mib 확장자 파일)은 모든 기기와 함께 제공되며 NMS에 각 OID의 사람이 읽을 수 있는 이름, 데이터 타입, 접근 수준(읽기 전용 또는 읽기-쓰기), 설명을 알려줍니다. 이 파일 없이는 NMS가 친숙한 이름 대신 원시 OID 번호를 표시합니다. 벤더는 RFC에서 다루지 않는 독점 메트릭을 enterprises 서브트리(1.3.6.1.4.1) 아래에 확장합니다 — 예를 들어 Cisco 전용 CPU 사용률이나 팬 속도를 Cisco의 프라이빗 MIB를 통해 폴링합니다.`,
    pduTitle:   'SNMP PDU 타입',
    pduHeaders: ['PDU', '방향', '포트', '설명'],
    pdus: [
      { pdu: 'GetRequest',     dir: '매니저 → 에이전트', port: 'UDP 161', desc: '하나 이상의 OID 값을 조회합니다.' },
      { pdu: 'GetNextRequest', dir: '매니저 → 에이전트', port: 'UDP 161', desc: 'MIB 트리에서 다음 OID를 조회 — MIB 탐색(walking)에 사용됩니다.' },
      { pdu: 'GetBulkRequest', dir: '매니저 → 에이전트', port: 'UDP 161', desc: '한 번의 왕복으로 대용량 데이터를 조회합니다 (v2c 이상).' },
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
  return (
    <div className="snmp-graph-canvas">
      <svg viewBox={`0 0 ${SGW} ${SGH}`} className="snmp-graph-svg" preserveAspectRatio="none">
        <defs>
          {LINKS.map(({ id }) => (
            <path key={id} id={`snmpp-${id}`} d={LINK_PATHS[id]} fill="none" />
          ))}
          {LINKS.map(({ id }) => (
            <path key={`${id}_rev`} id={`snmpp-${id}_rev`} d={LINK_PATHS_REV[id]} fill="none" />
          ))}
        </defs>

        {/* Link lines */}
        {LINKS.map(({ id, from, to }) => {
          const [x1, y1] = NODE_PX[from]
          const [x2, y2] = NODE_PX[to]
          const st = frame.links[id]
          return (
            <line key={id} x1={x1} y1={y1} x2={x2} y2={y2}
              className={`snmp-sline snmp-sline-${st}`} strokeWidth="2" />
          )
        })}

        {/* Forward dots — request, lookup */}
        {LINKS.map(({ id }) => {
          const st = frame.links[id]
          if (st !== 'request' && st !== 'lookup') return null
          return (
            <circle key={`dot-fwd-${id}`} r="5" className="snmp-gdot">
              <animateMotion dur="1.0s" repeatCount="indefinite">
                <mpath href={`#snmpp-${id}`} />
              </animateMotion>
            </circle>
          )
        })}

        {/* Reverse dots — response, trap, inform */}
        {LINKS.map(({ id }) => {
          const st = frame.links[id]
          if (st !== 'response' && st !== 'trap' && st !== 'inform') return null
          const cls = st === 'trap' ? 'snmp-gdot snmp-gdot-trap' : 'snmp-gdot snmp-gdot-rev'
          return (
            <circle key={`dot-rev-${id}`} r="5" className={cls}>
              <animateMotion dur="1.0s" repeatCount="indefinite">
                <mpath href={`#snmpp-${id}_rev`} />
              </animateMotion>
            </circle>
          )
        })}
      </svg>

      {/* PDU badge */}
      {frame.pdu !== 'none' && (
        <span className={`snmp-pdu-badge snmp-pdu-${frame.pdu}`}>
          {t.pduBadge[frame.pdu]}
        </span>
      )}

      {/* Link labels — HTML to avoid SVG scale distortion */}
      {LINKS.map(({ id, from, to }) => {
        const [x1, y1] = NODE_PX[from]
        const [x2, y2] = NODE_PX[to]
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        const dx = x2 - x1, dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const ox = (-dy / len) * 18
        const oy = ( dx / len) * 18
        const st = frame.links[id]
        return (
          <span key={`lbl-${id}`}
            className={`graph-linklabel${st !== 'idle' ? ' graph-linklabel-on' : ''}`}
            style={{ left: `${((mx + ox) / SGW) * 100}%`, top: `${((my + oy) / SGH) * 100}%` }}
          >
            {t.linkLabel[id]}
          </span>
        )
      })}

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

// ── MIB section ────────────────────────────────────────────────────────────────

function MibSection() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <div className="ov-proto-section">
      <div className="bgp2-section-title">{t.mibTitle}</div>
      <p className="bgp2-detail-body">{t.mibBody}</p>
      <pre className="snmp-mib-tree">{MIB_TREE}</pre>
      <p className="bgp2-detail-body">{t.mibNote}</p>
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
      <MibSection />
      <PduTable />
      <VersionTable />
    </NoteLayout>
  )
}
