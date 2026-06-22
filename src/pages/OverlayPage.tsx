import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type NodeId     = 'ha' | 'r1' | 'r2' | 'r3' | 'hb'
type NodeStatus = 'idle' | 'active' | 'vtep'
type LinkId     = 'access_a' | 'underlay1' | 'underlay2' | 'access_b' | 'tunnel'
type LinkStatus = 'idle' | 'active' | 'done'

interface OvFrame {
  nodes: Record<NodeId, NodeStatus>
  links: Record<LinkId, LinkStatus>
  encap: 'none' | 'encap' | 'decap'
}

// ── Graph geometry ─────────────────────────────────────────────────────────────

const OGW = 560
const OGH = 220

const NODE_PX: Record<NodeId, [number, number]> = {
  ha:  [80,  55],
  r1:  [80,  165],
  r2:  [280, 165],
  r3:  [480, 165],
  hb:  [480, 55],
}

const NODE_IDS: NodeId[] = ['ha', 'r1', 'r2', 'r3', 'hb']

const SLINKS: Array<{ id: LinkId; from: NodeId; to: NodeId }> = [
  { id: 'access_a',  from: 'ha',  to: 'r1' },
  { id: 'underlay1', from: 'r1',  to: 'r2' },
  { id: 'underlay2', from: 'r2',  to: 'r3' },
  { id: 'access_b',  from: 'r3',  to: 'hb' },
]

// Quadratic bezier: R1=(80,165) control=(280,45) R3=(480,165)
// Midpoint at t=0.5: x=280, y=0.25*165+0.5*45+0.25*165=105
const TUNNEL_D = `M 80 165 Q 280 45 480 165`

// ── Frame data ─────────────────────────────────────────────────────────────────

const N0: Record<NodeId, NodeStatus> = { ha: 'idle', r1: 'idle', r2: 'idle', r3: 'idle', hb: 'idle' }
const L0: Record<LinkId, LinkStatus> = { access_a: 'idle', underlay1: 'idle', underlay2: 'idle', access_b: 'idle', tunnel: 'idle' }

const FRAMES: OvFrame[] = [
  { nodes: N0, links: L0, encap: 'none' },
  { nodes: { ...N0, r1: 'vtep', r3: 'vtep' },
    links: { ...L0, tunnel: 'done' }, encap: 'none' },
  { nodes: { ...N0, ha: 'active', r1: 'vtep', r3: 'vtep' },
    links: { ...L0, access_a: 'active', tunnel: 'done' }, encap: 'none' },
  { nodes: { ...N0, r1: 'vtep', r3: 'vtep' },
    links: { ...L0, tunnel: 'active' }, encap: 'encap' },
  { nodes: { ...N0, r1: 'vtep', r2: 'active', r3: 'vtep' },
    links: { ...L0, underlay1: 'active', underlay2: 'active', tunnel: 'done' }, encap: 'encap' },
  { nodes: { ...N0, r3: 'vtep', hb: 'active' },
    links: { ...L0, access_b: 'active', tunnel: 'done' }, encap: 'decap' },
]

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title: 'Overlay and underlay networks',
    readTime: '5 min',
    intro: `An overlay network is a virtual network built on top of a physical one. The physical network — routers, switches, real IP links — is the underlay. The overlay rides on top using encapsulation: every overlay packet is wrapped inside an underlay packet. Transit nodes only ever see the outer header and remain completely unaware of the overlay's existence. VXLAN, GRE, IPsec, and WireGuard all use this same fundamental trick.`,
    nodeLabel: { ha: 'Host A', r1: 'Router 1', r2: 'Router 2', r3: 'Router 3', hb: 'Host B' } as Record<NodeId, string>,
    nodeSub:   { ha: '192.168.0.1', r1: '10.0.1.1', r2: '10.0.2.1', r3: '10.0.3.1', hb: '192.168.0.2' } as Record<NodeId, string>,
    linkLabel: { access_a: 'access', underlay1: 'underlay', underlay2: 'underlay', access_b: 'access', tunnel: 'overlay tunnel' } as Record<LinkId, string>,
    vtepBadge: 'VTEP',
    encap: {
      outerLabel:  'Outer IP header (underlay)',
      outerSrc:    'Src: 10.0.1.1 (R1)',
      outerDst:    'Dst: 10.0.3.1 (R3)',
      tunLabel:    'VXLAN / GRE / ESP header',
      innerLabel:  'Inner IP header (overlay)',
      innerSrc:    'Src: 192.168.0.1 (HA)',
      innerDst:    'Dst: 192.168.0.2 (HB)',
      payload:     'payload',
      decapTitle:  'Delivered — inner packet (overlay)',
    },
    protocols: [
      { name: 'VXLAN',       enc: 'UDP :4789',    layer: 'L2 over L3', use: 'Cloud VPCs, k8s CNI (Cilium, Flannel)' },
      { name: 'GRE',         enc: 'IP proto 47',  layer: 'L3 over L3', use: 'Point-to-point tunnels, SD-WAN' },
      { name: 'IPsec (ESP)', enc: 'IP proto 50',  layer: 'L3 over L3', use: 'Site-to-site VPN, encryption in transit' },
      { name: 'WireGuard',   enc: 'UDP',          layer: 'L3 over L3', use: 'Modern VPN, simple key management' },
      { name: 'MPLS',        enc: 'Label stack',  layer: 'L2.5',       use: 'Carrier backbone, traffic engineering' },
    ],
    protoTitle:   'Common overlay protocols',
    protoHeaders: ['Protocol', 'Encapsulation', 'Layer', 'Primary use'],
    frames: [
      { title: 'Underlay — the physical network',
        note: 'Three routers (R1, R2, R3) are connected by real IP links. This is the underlay — the actual physical or IP-routed substrate. Packets are forwarded hop-by-hop using normal IP routing. No virtual network or tunnel exists yet.' },
      { title: 'Overlay tunnel established',
        note: 'R1 and R3 are configured as VTEPs (Virtual Tunnel EndPoints). A virtual tunnel is provisioned between them — a logical path that sits above the physical underlay. R2 requires zero reconfiguration. The overlay is completely invisible to it.' },
      { title: 'Host A sends a packet',
        note: 'HA sends a packet: source 192.168.0.1 (overlay IP), destination 192.168.0.2 (HB\'s overlay IP). The packet arrives at R1, the local VTEP. R1 recognizes the destination is reachable via the overlay tunnel — there is no direct underlay route to 192.168.0.2.' },
      { title: 'Encapsulation at R1 — packet enters the tunnel',
        note: 'R1 prepends a new outer IP header: Src = 10.0.1.1 (R1\'s underlay IP), Dst = 10.0.3.1 (R3\'s underlay IP). A VXLAN, GRE, or ESP header is inserted between outer and inner IP. The encapsulated packet looks like ordinary underlay traffic — R2 has no idea what\'s inside.' },
      { title: 'Transit through R2 — underlay-only view',
        note: 'The encapsulated packet flows R1 → R2 → R3 via standard IP forwarding. R2 reads only the outer Dst (10.0.3.1) and routes accordingly. R2 never inspects the inner payload. This is the core property of overlay networks: intermediate nodes need no knowledge of virtual topology.' },
      { title: 'Decapsulation at R3 — delivery to Host B',
        note: 'R3\'s VTEP receives the packet and finds its own IP (10.0.3.1) in the outer Dst. It strips the outer IP and tunnel headers, recovering the inner packet. The inner Dst (192.168.0.2) maps to HB. HB receives the packet exactly as HA sent it — unaware of the entire tunnel path.' },
    ],
  },
  ko: {
    title: '오버레이와 언더레이 네트워크',
    readTime: '5분',
    intro: `오버레이 네트워크는 물리 네트워크 위에 구축된 가상 네트워크입니다. 라우터, 스위치, 실제 IP 링크로 구성된 물리 네트워크가 언더레이입니다. 오버레이는 캡슐화를 통해 언더레이 위에서 동작합니다 — 모든 오버레이 패킷은 언더레이 패킷 안에 포장됩니다. 중간 라우터는 외부 헤더만 보며 오버레이의 존재를 전혀 알지 못합니다. VXLAN, GRE, IPsec, WireGuard 모두 이 동일한 원리를 사용합니다.`,
    nodeLabel: { ha: 'Host A', r1: 'Router 1', r2: 'Router 2', r3: 'Router 3', hb: 'Host B' } as Record<NodeId, string>,
    nodeSub:   { ha: '192.168.0.1', r1: '10.0.1.1', r2: '10.0.2.1', r3: '10.0.3.1', hb: '192.168.0.2' } as Record<NodeId, string>,
    linkLabel: { access_a: 'access', underlay1: '언더레이', underlay2: '언더레이', access_b: 'access', tunnel: '오버레이 터널' } as Record<LinkId, string>,
    vtepBadge: 'VTEP',
    encap: {
      outerLabel:  '외부 IP 헤더 (언더레이)',
      outerSrc:    '출발지: 10.0.1.1 (R1)',
      outerDst:    '목적지: 10.0.3.1 (R3)',
      tunLabel:    'VXLAN / GRE / ESP 헤더',
      innerLabel:  '내부 IP 헤더 (오버레이)',
      innerSrc:    '출발지: 192.168.0.1 (HA)',
      innerDst:    '목적지: 192.168.0.2 (HB)',
      payload:     '페이로드',
      decapTitle:  '전달 — 내부 패킷 (오버레이)',
    },
    protocols: [
      { name: 'VXLAN',       enc: 'UDP :4789',   layer: 'L2 over L3', use: '클라우드 VPC, k8s CNI (Cilium, Flannel)' },
      { name: 'GRE',         enc: 'IP proto 47',  layer: 'L3 over L3', use: '포인트-투-포인트 터널, SD-WAN' },
      { name: 'IPsec (ESP)', enc: 'IP proto 50',  layer: 'L3 over L3', use: 'Site-to-Site VPN, 전송 중 암호화' },
      { name: 'WireGuard',   enc: 'UDP',          layer: 'L3 over L3', use: '현대적 VPN, 간단한 키 관리' },
      { name: 'MPLS',        enc: '레이블 스택',  layer: 'L2.5',       use: '통신사 백본, 트래픽 엔지니어링' },
    ],
    protoTitle:   '주요 오버레이 프로토콜',
    protoHeaders: ['프로토콜', '캡슐화', '레이어', '주요 용도'],
    frames: [
      { title: '언더레이 — 물리 네트워크',
        note: '세 라우터(R1, R2, R3)가 실제 IP 링크로 연결됩니다. 이것이 언더레이 — 실제 물리적 또는 IP 라우팅 인프라입니다. 패킷은 일반 IP 라우팅으로 홉마다 포워딩됩니다. 아직 가상 네트워크나 터널은 없습니다.' },
      { title: '오버레이 터널 설정',
        note: 'R1과 R3가 VTEP(Virtual Tunnel EndPoint)으로 설정됩니다. 두 사이에 가상 터널이 프로비저닝됩니다 — 물리 언더레이 위에 있는 논리적 경로입니다. R2는 설정 변경이 전혀 필요 없으며 오버레이는 R2에게 완전히 보이지 않습니다.' },
      { title: 'Host A가 패킷 전송',
        note: 'HA가 출발지 192.168.0.1(오버레이 IP), 목적지 192.168.0.2(HB의 오버레이 IP)로 패킷을 전송합니다. 패킷이 로컬 VTEP인 R1에 도착합니다. R1은 목적지가 오버레이 터널을 통해 도달 가능함을 인식합니다 — 192.168.0.2로의 직접 언더레이 경로는 없습니다.' },
      { title: 'R1에서 캡슐화 — 패킷이 터널로 진입',
        note: 'R1이 새 외부 IP 헤더를 추가합니다: 출발지 = 10.0.1.1(R1의 언더레이 IP), 목적지 = 10.0.3.1(R3의 언더레이 IP). 외부와 내부 IP 사이에 VXLAN, GRE, 또는 ESP 헤더가 삽입됩니다. 캡슐화된 패킷은 일반 언더레이 트래픽처럼 보입니다 — R2는 내부에 무엇이 있는지 알 수 없습니다.' },
      { title: 'R2를 통한 중간 경유 — 언더레이 관점만',
        note: '캡슐화된 패킷이 표준 IP 포워딩으로 R1 → R2 → R3를 통과합니다. R2는 외부 목적지(10.0.3.1)만 읽고 라우팅합니다. R2는 내부 페이로드를 절대 검사하지 않습니다. 이것이 오버레이 네트워크의 핵심 특성: 중간 노드는 가상 토폴로지에 대한 지식이 필요 없습니다.' },
      { title: 'R3에서 역캡슐화 — Host B로 전달',
        note: 'R3의 VTEP이 패킷을 수신하고 외부 목적지에서 자신의 IP(10.0.3.1)를 확인합니다. 외부 IP와 터널 헤더를 제거하여 내부 패킷을 복원합니다. 내부 목적지(192.168.0.2)가 HB에 매핑됩니다. HB는 HA가 보낸 것과 똑같은 패킷을 수신합니다 — 전체 터널 경로를 전혀 모른 채로.' },
    ],
  },
}

// ── Graph ──────────────────────────────────────────────────────────────────────

function OvGraph({ frame, t }: { frame: OvFrame; t: typeof T['en'] }) {
  const isTunnelVisible = frame.links.tunnel !== 'idle'
  const isTunnelActive  = frame.links.tunnel === 'active'

  return (
    <div className="ov-graph-canvas">
      <svg viewBox={`0 0 ${OGW} ${OGH}`} className="ov-graph-svg" preserveAspectRatio="none">
        <defs>
          {SLINKS.map(({ id, from, to }) => {
            const [x1, y1] = NODE_PX[from]
            const [x2, y2] = NODE_PX[to]
            return <path key={id} id={`ovp-${id}`} d={`M ${x1} ${y1} L ${x2} ${y2}`} fill="none" />
          })}
          <path id="ovp-tunnel" d={TUNNEL_D} fill="none" />
        </defs>

        {/* Straight underlay + access lines */}
        {SLINKS.map(({ id, from, to }) => {
          const [x1, y1] = NODE_PX[from]
          const [x2, y2] = NODE_PX[to]
          const st = frame.links[id]
          return (
            <g key={id}>
              <line x1={x1} y1={y1} x2={x2} y2={y2}
                className={`ov-sline ov-sline-${st}`} strokeWidth="2" />
              {st === 'active' && (
                <circle r="5" className="ov-gdot">
                  <animateMotion dur="1.0s" repeatCount="indefinite">
                    <mpath href={`#ovp-${id}`} />
                  </animateMotion>
                </circle>
              )}
            </g>
          )
        })}

        {/* Tunnel arc */}
        {isTunnelVisible && (
          <g>
            <path d={TUNNEL_D} fill="none" strokeWidth="2"
              className={`ov-tunnel ov-tunnel-${frame.links.tunnel}`} />
            {isTunnelActive && (
              <circle r="5" className="ov-gdot">
                <animateMotion dur="1.6s" repeatCount="indefinite">
                  <mpath href="#ovp-tunnel" />
                </animateMotion>
              </circle>
            )}
          </g>
        )}
      </svg>

      {/* Underlay link labels — HTML to avoid SVG scale distortion */}
      {SLINKS.filter(l => l.id === 'underlay1' || l.id === 'underlay2').map(({ id, from, to }) => {
        const [x1, y1] = NODE_PX[from]
        const [x2, y2] = NODE_PX[to]
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        const st = frame.links[id]
        return (
          <span key={`lbl-${id}`}
            className={`graph-linklabel${st !== 'idle' ? ' graph-linklabel-on' : ''}`}
            style={{ left: `${(mx / OGW) * 100}%`, top: `${((my - 14) / OGH) * 100}%` }}
          >
            {t.linkLabel[id]}
          </span>
        )
      })}

      {/* Tunnel label */}
      {isTunnelVisible && (
        <span
          className={`graph-linklabel${isTunnelActive ? ' graph-linklabel-on' : ''}`}
          style={{ left: '50%', top: '32%' }}
        >
          {t.linkLabel.tunnel}
        </span>
      )}

      {/* Node boxes */}
      {NODE_IDS.map(nid => {
        const [px, py] = NODE_PX[nid]
        const st = frame.nodes[nid]
        return (
          <div key={nid}
            className={`ov-gnode ov-gnode-${st}`}
            style={{ left: `${(px / OGW) * 100}%`, top: `${(py / OGH) * 100}%` }}
          >
            <span className="ov-gnode-label">{t.nodeLabel[nid]}</span>
            <span className="ov-gnode-sub">{t.nodeSub[nid]}</span>
            {st === 'vtep' && <span className="ov-vtep-badge">{t.vtepBadge}</span>}
          </div>
        )
      })}
    </div>
  )
}

// ── Encap Panel ────────────────────────────────────────────────────────────────

function EncapPanel({ state, enc }: { state: 'encap' | 'decap'; enc: typeof T['en']['encap'] }) {
  if (state === 'decap') {
    return (
      <div className="ov-encap">
        <div className="ov-encap-inner ov-encap-solo">
          <span className="ov-encap-label">{enc.decapTitle}</span>
          <div className="ov-encap-fields">
            <span>{enc.innerSrc}</span>
            <span className="ov-encap-arrow">→</span>
            <span>{enc.innerDst}</span>
            <span className="ov-encap-payload">[{enc.payload}]</span>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="ov-encap">
      <div className="ov-encap-outer">
        <span className="ov-encap-label">{enc.outerLabel}</span>
        <div className="ov-encap-fields">
          <span>{enc.outerSrc}</span>
          <span className="ov-encap-arrow">→</span>
          <span>{enc.outerDst}</span>
        </div>
        <div className="ov-encap-tun">
          <span className="ov-encap-label">{enc.tunLabel}</span>
          <div className="ov-encap-inner">
            <span className="ov-encap-label">{enc.innerLabel}</span>
            <div className="ov-encap-fields">
              <span>{enc.innerSrc}</span>
              <span className="ov-encap-arrow">→</span>
              <span>{enc.innerDst}</span>
              <span className="ov-encap-payload">[{enc.payload}]</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Explorer ───────────────────────────────────────────────────────────────────

function OvExplorer() {
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
    timerRef.current = setTimeout(() => { setStep(s => s + 1) }, 1300)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [playing, step, isLast])

  function reset() { setPlaying(false); setStep(0) }
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
      <OvGraph frame={frame} t={t} />
      {frame.encap !== 'none' && <EncapPanel state={frame.encap} enc={t.encap} />}
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

// ── Protocol table ─────────────────────────────────────────────────────────────

function ProtoTable() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <div className="ov-proto-section">
      <div className="bgp2-section-title">{t.protoTitle}</div>
      <table className="ov-proto-table">
        <thead>
          <tr>{t.protoHeaders.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.protocols.map(p => (
            <tr key={p.name}>
              <td><code>{p.name}</code></td>
              <td><code>{p.enc}</code></td>
              <td>{p.layer}</td>
              <td>{p.use}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function OverlayPage() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-06-22"
      readTime={t.readTime}
      tags={['networking', 'overlay', 'vxlan', 'tunneling', 'virtualization']}
      intro={t.intro}
    >
      <OvExplorer />
      <ProtoTable />
    </NoteLayout>
  )
}
