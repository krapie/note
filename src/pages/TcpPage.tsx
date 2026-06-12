import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'

type Dir = 'c2s' | 's2c'
type Phase = 'handshake' | 'data' | 'teardown'
type FsmItem = { kind: 'state'; name: string } | { kind: 'edge'; trigger: string }

const CLIENT_FSM: FsmItem[] = [
  { kind: 'state', name: 'CLOSED' },
  { kind: 'edge', trigger: 'active open · send SYN' },
  { kind: 'state', name: 'SYN_SENT' },
  { kind: 'edge', trigger: 'recv SYN-ACK · send ACK' },
  { kind: 'state', name: 'ESTABLISHED' },
  { kind: 'edge', trigger: 'close · send FIN' },
  { kind: 'state', name: 'FIN_WAIT_1' },
  { kind: 'edge', trigger: 'recv ACK' },
  { kind: 'state', name: 'FIN_WAIT_2' },
  { kind: 'edge', trigger: 'recv FIN · send ACK' },
  { kind: 'state', name: 'TIME_WAIT' },
  { kind: 'edge', trigger: '2×MSL timeout' },
  { kind: 'state', name: 'CLOSED' },
]

const SERVER_FSM: FsmItem[] = [
  { kind: 'state', name: 'LISTEN' },
  { kind: 'edge', trigger: 'recv SYN · send SYN-ACK' },
  { kind: 'state', name: 'SYN_RCVD' },
  { kind: 'edge', trigger: 'recv ACK' },
  { kind: 'state', name: 'ESTABLISHED' },
  { kind: 'edge', trigger: 'recv FIN · send ACK' },
  { kind: 'state', name: 'CLOSE_WAIT' },
  { kind: 'edge', trigger: 'close · send FIN' },
  { kind: 'state', name: 'LAST_ACK' },
  { kind: 'edge', trigger: 'recv ACK' },
  { kind: 'state', name: 'CLOSED' },
]

const CLIENT_FSM_IDX: Record<string, number> = {
  CLOSED: 0, SYN_SENT: 1, ESTABLISHED: 2, FIN_WAIT_1: 3, FIN_WAIT_2: 4, TIME_WAIT: 5,
}
const SERVER_FSM_IDX: Record<string, number> = {
  LISTEN: 0, SYN_RCVD: 1, ESTABLISHED: 2, CLOSE_WAIT: 3, LAST_ACK: 4, CLOSED: 5,
}

const FSM_STATE_COLOR: Record<string, string> = {
  ESTABLISHED: 'fsm-color-est',
  FIN_WAIT_1: 'fsm-color-closing', FIN_WAIT_2: 'fsm-color-closing',
  TIME_WAIT: 'fsm-color-closing', CLOSE_WAIT: 'fsm-color-closing', LAST_ACK: 'fsm-color-closing',
}

function FsmColumn({ items, curIdx, title }: { items: FsmItem[]; curIdx: number; title: string }) {
  return (
    <div className="tcp-fsm-col">
      <div className="tcp-fsm-col-title">{title}</div>
      {items.map((item, i) => {
        if (item.kind === 'state') {
          const idx = i / 2
          const status: 'past' | 'current' | 'future' =
            idx < curIdx ? 'past' : idx === curIdx ? 'current' : 'future'
          const colorCls = status === 'current' ? (FSM_STATE_COLOR[item.name] ?? '') : ''
          return (
            <div key={i} className={`tcp-fsm-node fsm-${status} ${colorCls}`}>
              <div className="tcp-fsm-node-dot" />
              <span className="tcp-fsm-node-name">{item.name}</span>
            </div>
          )
        } else {
          const prevIdx = (i - 1) / 2
          const done = prevIdx < curIdx
          return (
            <div key={i} className={`tcp-fsm-edge ${done ? 'fsm-past' : 'fsm-future'}`}>
              <div className="tcp-fsm-edge-track" />
              <span className="tcp-fsm-edge-label">{item.trigger}</span>
            </div>
          )
        }
      })}
    </div>
  )
}

interface Packet {
  dir: Dir
  flags: string[]
  seq: number
  ack: number
  label: string
  payload?: string
  note: string
}

interface Frame {
  packet?: Packet
  clientState: string
  serverState: string
  phase: Phase
  annotation?: string
}

const C = 1000
const S = 5000

const FRAMES: Frame[] = [
  { clientState: 'CLOSED', serverState: 'LISTEN', phase: 'handshake', annotation: '3-Way Handshake' },
  {
    packet: { dir: 'c2s', flags: ['SYN'], seq: C, ack: 0, label: 'SYN',
      note: 'Client picks a random ISN and sets SYN. No data yet — just synchronizing sequence numbers.' },
    clientState: 'SYN_SENT', serverState: 'LISTEN', phase: 'handshake',
  },
  {
    packet: { dir: 's2c', flags: ['SYN', 'ACK'], seq: S, ack: C + 1, label: 'SYN-ACK',
      note: 'Server picks its own ISN and acknowledges the client\'s SYN. ack = client_seq + 1 (SYN consumes one sequence number).' },
    clientState: 'SYN_SENT', serverState: 'SYN_RCVD', phase: 'handshake',
  },
  {
    packet: { dir: 'c2s', flags: ['ACK'], seq: C + 1, ack: S + 1, label: 'ACK',
      note: 'Client acknowledges the server\'s SYN. Both sides now agree on ISNs — connection is ESTABLISHED.' },
    clientState: 'ESTABLISHED', serverState: 'ESTABLISHED', phase: 'handshake',
  },
  { clientState: 'ESTABLISHED', serverState: 'ESTABLISHED', phase: 'data', annotation: 'Data Transfer' },
  {
    packet: { dir: 'c2s', flags: ['PSH', 'ACK'], seq: C + 1, ack: S + 1, label: 'PSH+ACK',
      payload: 'GET / HTTP/1.1\r\nHost: example.com',
      note: 'PSH tells the receiver to push this data to the application immediately, without buffering.' },
    clientState: 'ESTABLISHED', serverState: 'ESTABLISHED', phase: 'data',
  },
  {
    packet: { dir: 's2c', flags: ['ACK'], seq: S + 1, ack: C + 39, label: 'ACK',
      note: 'Server acknowledges all bytes up to seq 1040. The ack number is the next byte the server expects.' },
    clientState: 'ESTABLISHED', serverState: 'ESTABLISHED', phase: 'data',
  },
  {
    packet: { dir: 's2c', flags: ['PSH', 'ACK'], seq: S + 1, ack: C + 39, label: 'PSH+ACK',
      payload: 'HTTP/1.1 200 OK\r\nContent-Length: 1234',
      note: 'Server sends the HTTP response. In a real transfer, large responses are segmented into MSS-sized chunks.' },
    clientState: 'ESTABLISHED', serverState: 'ESTABLISHED', phase: 'data',
  },
  {
    packet: { dir: 'c2s', flags: ['ACK'], seq: C + 39, ack: S + 41, label: 'ACK',
      note: 'Client acknowledges the response. Window size in the header controls how much more the server can send.' },
    clientState: 'ESTABLISHED', serverState: 'ESTABLISHED', phase: 'data',
  },
  { clientState: 'ESTABLISHED', serverState: 'ESTABLISHED', phase: 'teardown', annotation: '4-Way Teardown' },
  {
    packet: { dir: 'c2s', flags: ['FIN', 'ACK'], seq: C + 39, ack: S + 41, label: 'FIN',
      note: 'Client initiates a half-close: it won\'t send more data, but can still receive. FIN consumes one seq number.' },
    clientState: 'FIN_WAIT_1', serverState: 'ESTABLISHED', phase: 'teardown',
  },
  {
    packet: { dir: 's2c', flags: ['ACK'], seq: S + 41, ack: C + 40, label: 'ACK',
      note: 'Server acknowledges the FIN. The server may still send remaining data before closing its own side.' },
    clientState: 'FIN_WAIT_2', serverState: 'CLOSE_WAIT', phase: 'teardown',
  },
  {
    packet: { dir: 's2c', flags: ['FIN', 'ACK'], seq: S + 41, ack: C + 40, label: 'FIN',
      note: 'Server finishes and sends its own FIN. TCP teardown is asymmetric — each direction closes independently.' },
    clientState: 'FIN_WAIT_2', serverState: 'LAST_ACK', phase: 'teardown',
  },
  {
    packet: { dir: 'c2s', flags: ['ACK'], seq: C + 40, ack: S + 42, label: 'ACK',
      note: 'Client sends final ACK and enters TIME_WAIT for 2×MSL (~120s) to ensure the server received it.' },
    clientState: 'TIME_WAIT', serverState: 'CLOSED', phase: 'teardown',
  },
  { clientState: 'CLOSED', serverState: 'CLOSED', phase: 'teardown', annotation: 'Connection closed (after 2×MSL)' },
]

const FLAG_CLS: Record<string, string> = {
  SYN: 'tcp-flag-syn', ACK: 'tcp-flag-ack', FIN: 'tcp-flag-fin',
  PSH: 'tcp-flag-psh', RST: 'tcp-flag-rst', URG: 'tcp-flag-urg',
}

const PHASE_LABEL: Record<Phase, string> = {
  handshake: 'Handshake', data: 'Data Transfer', teardown: 'Teardown',
}

const CONNTRACK_ROWS = [
  { proto: 'TCP', src: '10.0.0.5:58234', dst: '93.184.216.34:443', state: 'ESTABLISHED', ttl: '86390s' },
  { proto: 'TCP', src: '10.0.0.5:58235', dst: '93.184.216.34:443', state: 'TIME_WAIT',   ttl: '117s'   },
  { proto: 'TCP', src: '10.0.0.7:49801', dst: '172.16.0.1:22',     state: 'ESTABLISHED', ttl: '431980s'},
  { proto: 'UDP', src: '10.0.0.5:52341', dst: '8.8.8.8:53',        state: 'UNREPLIED',   ttl: '28s'    },
]

function StateBadge({ state }: { state: string }) {
  const cls =
    state === 'ESTABLISHED' ? 'tcp-st-est' :
    state === 'LISTEN' ? 'tcp-st-listen' :
    ['FIN_WAIT_1','FIN_WAIT_2','TIME_WAIT','CLOSE_WAIT','LAST_ACK'].includes(state) ? 'tcp-st-closing' :
    state === 'CLOSED' ? 'tcp-st-closed' : 'tcp-st-neutral'
  return <span className={`tcp-state-badge ${cls}`}>{state}</span>
}

function EduFact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="tcp-edu-fact">
      <span className="tcp-edu-fact-k">{k}</span>
      <span className="tcp-edu-fact-v">{v}</span>
    </div>
  )
}

function clientFsmIdx(step: number): number {
  const s = FRAMES[step]?.clientState
  if (s === 'CLOSED' && step > 0) return 6
  return CLIENT_FSM_IDX[s] ?? 0
}
function serverFsmIdx(step: number): number {
  return SERVER_FSM_IDX[FRAMES[step]?.serverState] ?? 0
}

function TcpExplorer() {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1.0)
  const [animKey, setAnimKey] = useState(0)
  const seqRef = useRef<HTMLDivElement>(null)

  const frame = FRAMES[step]
  const isLast = step >= FRAMES.length - 1

  useEffect(() => {
    if (!playing) return
    if (isLast) { setPlaying(false); return }
    const delay = frame.packet ? Math.round(1000 / speed) : Math.round(500 / speed)
    const t = setTimeout(() => {
      setStep(s => s + 1)
      setAnimKey(k => k + 1)
    }, delay)
    return () => clearTimeout(t)
  }, [playing, step, isLast, speed, frame])

  useEffect(() => {
    if (seqRef.current) seqRef.current.scrollTop = seqRef.current.scrollHeight
  }, [step])

  function reset() { setPlaying(false); setStep(0); setAnimKey(k => k + 1) }
  function stepFwd() { if (!isLast) { setStep(s => s + 1); setAnimKey(k => k + 1) } }
  function handlePlay() {
    if (isLast) { reset(); setTimeout(() => setPlaying(true), 50); return }
    setPlaying(p => !p)
  }

  const travelMs = Math.round(750 / speed)

  const shownPackets: Array<{ frame: Frame; idx: number; isLive: boolean }> = []
  for (let i = 1; i <= step; i++) {
    if (FRAMES[i].packet) shownPackets.push({ frame: FRAMES[i], idx: i, isLive: false })
  }
  if (shownPackets.length > 0 && frame.packet) {
    shownPackets[shownPackets.length - 1].isLive = true
  }

  return (
    <div className="tcp-root">
      <div className="tcp-phases">
        {(['handshake', 'data', 'teardown'] as Phase[]).map(p => (
          <span key={p} className={`tcp-phase-pill${frame.phase === p ? ' active' : ''}`}>
            {PHASE_LABEL[p]}
          </span>
        ))}
      </div>

      <div className="tcp-diagram">
        <div className="tcp-entity-row">
          <div className="tcp-entity">
            <span className="tcp-entity-name">CLIENT</span>
            <StateBadge state={frame.clientState} />
          </div>
          <div className="tcp-entity tcp-entity-r">
            <span className="tcp-entity-name">SERVER</span>
            <StateBadge state={frame.serverState} />
          </div>
        </div>
        <div className="tcp-seq-body" ref={seqRef}>
          <div className="tcp-lifeline tcp-lifeline-l" />
          <div className="tcp-lifeline tcp-lifeline-r" />
          {shownPackets.map(({ frame: f, idx, isLive }) => {
            const pkt = f.packet!
            return (
              <div key={idx} className={`tcp-pkt-row${isLive ? ' live' : ' past'}`}>
                <div
                  className={`tcp-arrow ${pkt.dir}${isLive ? ' animating' : ''}`}
                  style={{ '--travel': `${travelMs}ms` } as React.CSSProperties}
                  key={isLive ? `live-${animKey}` : idx}
                >
                  <div className="tcp-arrow-line" />
                  <div className="tcp-arrow-head" />
                  <div className="tcp-arrow-label">
                    <span className="tcp-pkt-name">{pkt.label}</span>
                    <span className="tcp-pkt-meta">seq={pkt.seq} · ack={pkt.ack}</span>
                  </div>
                  {isLive && <div className="tcp-arrow-dot" />}
                </div>
              </div>
            )
          })}
          {frame.annotation && <div className="tcp-annotation">{frame.annotation}</div>}
          <div className="tcp-seq-pad" />
        </div>
      </div>

      <div className="tcp-fsm">
        <div className="tcp-fsm-header">TCP State Machine</div>
        <div className="tcp-fsm-body">
          <FsmColumn items={CLIENT_FSM} curIdx={clientFsmIdx(step)} title="Client" />
          <div className="tcp-fsm-divider" />
          <FsmColumn items={SERVER_FSM} curIdx={serverFsmIdx(step)} title="Server" />
        </div>
      </div>

      <div className="tcp-controls">
        <button className="btn-secondary" onClick={reset}>Reset</button>
        <button className="btn-primary" onClick={handlePlay}>
          {playing ? 'Pause' : isLast ? 'Replay' : step === 0 ? 'Play' : 'Resume'}
        </button>
        <button className="btn-secondary" onClick={stepFwd} disabled={playing || isLast}>
          Step →
        </button>
        <label className="tcp-speed-wrap">
          <span className="tcp-speed-lbl">Speed</span>
          <input type="range" min="0.4" max="3" step="0.2" value={speed}
            onChange={e => setSpeed(Number(e.target.value))} />
          <span className="tcp-speed-val">{speed.toFixed(1)}×</span>
        </label>
      </div>

      <div className="tcp-progress">
        <div className="tcp-progress-fill" style={{ width: `${(step / (FRAMES.length - 1)) * 100}%` }} />
      </div>

      {frame.packet ? (
        <div className="tcp-detail">
          <div className="tcp-detail-top">
            <div className="tcp-detail-flags">
              {frame.packet.flags.map(f => (
                <span key={f} className={`tcp-flag ${FLAG_CLS[f] ?? ''}`}>{f}</span>
              ))}
            </div>
            <div className="tcp-detail-fields">
              <div className="tcp-df"><span className="k">seq</span><span className="v">{frame.packet.seq}</span></div>
              <div className="tcp-df"><span className="k">ack</span><span className="v">{frame.packet.ack}</span></div>
              <div className="tcp-df">
                <span className="k">dir</span>
                <span className="v">{frame.packet.dir === 'c2s' ? 'Client → Server' : 'Server → Client'}</span>
              </div>
            </div>
          </div>
          {frame.packet.payload && (
            <div className="tcp-detail-payload">
              <span className="tcp-detail-payload-label">data</span>
              <code className="tcp-detail-payload-val">{frame.packet.payload}</code>
            </div>
          )}
          <p className="tcp-detail-note">{frame.packet.note}</p>
        </div>
      ) : (
        <div className="tcp-detail tcp-detail-ann">
          <span>{frame.annotation ?? ''}</span>
          <span className="tcp-step-counter">{step + 1} / {FRAMES.length}</span>
        </div>
      )}

      <div className="tcp-edu-section">
        <div className="tcp-edu-title">MTU / MSS / MRU</div>
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
          <EduFact k="MTU" v="Max L3 packet size per link. Ethernet default: 1500 B. Jumbo frames: up to 9000 B." />
          <EduFact k="MSS" v={<>Max TCP payload per segment. <code>MSS = MTU − IP_hdr − TCP_hdr = 1500 − 20 − 20 = <strong>1460 B</strong></code>. Each side advertises its MSS in the SYN.</>} />
          <EduFact k="MRU" v="Max receive unit — the largest packet the local interface will reassemble. Usually equals MTU on the same link." />
          <EduFact k="PMTUD" v="Path MTU Discovery: sender starts at local MTU; routers with smaller MTUs reply ICMP 'Fragmentation Needed', letting the sender reduce MSS hop-by-hop." />
        </div>
        <div className="tcp-coming-soon">Interactive path MTU discovery demo — coming soon</div>
      </div>

      <div className="tcp-edu-section">
        <div className="tcp-edu-title">Connection Tracking (conntrack)</div>
        <div className="tcp-ct-table">
          <div className="tcp-ct-header">
            <span>proto</span><span>source</span><span>destination</span><span>state</span><span>ttl</span>
          </div>
          {CONNTRACK_ROWS.map((r, i) => {
            const cls = r.state === 'ESTABLISHED' ? 'ct-est' : r.state === 'TIME_WAIT' ? 'ct-closing' : r.state === 'UNREPLIED' ? 'ct-unreplied' : ''
            return (
              <div key={i} className="tcp-ct-row">
                <span className="tcp-ct-proto">{r.proto}</span>
                <span className="tcp-ct-addr">{r.src}</span>
                <span className="tcp-ct-addr">{r.dst}</span>
                <span className={`tcp-ct-state ${cls}`}>{r.state}</span>
                <span className="tcp-ct-ttl">{r.ttl}</span>
              </div>
            )
          })}
        </div>
        <div className="tcp-edu-facts">
          <EduFact k="NEW"         v="First packet seen; no reply yet. Firewall can accept or drop before state is established." />
          <EduFact k="ESTABLISHED" v="Bidirectional traffic confirmed. Timeout: TCP 5 days, UDP 3 min. Most firewall rules allow this by default." />
          <EduFact k="RELATED"     v="New flow spawned by an existing tracked one — e.g., FTP data channel opened by the FTP control connection." />
          <EduFact k="TIME_WAIT"   v="Connection closed; entry lingers 120 s to absorb delayed or duplicate packets still in flight." />
        </div>
        <div className="tcp-coming-soon">Live conntrack table viewer — coming soon</div>
      </div>
    </div>
  )
}

export default function TcpPage() {
  return (
    <NoteLayout
      title="The TCP three-way handshake"
      date="2026-05-20"
      readTime="4 min"
      tags={['networking', 'tcp']}
      intro="What SYN, SYN-ACK, and ACK actually do — stepped through, packet by packet. Covers the full lifecycle: handshake, data transfer, and four-way teardown. Includes state machine visualization, MTU/MSS reference, and conntrack."
    >
      <TcpExplorer />
    </NoteLayout>
  )
}
