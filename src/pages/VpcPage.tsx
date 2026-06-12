import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useTheme } from '../App'

interface Step {
  title: string
  detail: string
  packet: string
  highlight: string[]
  pos?: [number, number]
  waypoints?: [number, number][]
}

interface Scenario {
  desc: string
  steps: Step[]
}

const SCENARIOS: Record<string, Scenario> = {
  'vm-vm': {
    desc: 'A packet sent from EC2-A to EC2-B in the same VPC. The Nitro card intercepts every outbound frame, consults the Mapping Service to resolve the destination\'s physical host address, wraps the original packet in an outer IP header, and forwards it across the AWS physical network — all transparent to the guest OS.',
    steps: [
      { title: 'EC2-A sends a packet', detail: 'The guest OS on EC2-A issues a normal send. The app sees only private VPC IPs — it has no awareness of the physical substrate.', packet: 'inner:  src=10.0.0.10  dst=10.0.0.20  proto=TCP  dport=80', highlight: ['ec2a'], pos: [110, 55] },
      { title: 'Nitro Card intercepts', detail: 'Every frame leaving the VM is captured by the Nitro Card before it reaches the wire. The guest OS cannot bypass this — encapsulation happens in hardware.', packet: 'inner:  src=10.0.0.10  dst=10.0.0.20  proto=TCP  dport=80\n[intercepted by Nitro Card A]', highlight: ['ec2a', 'nitroA'], pos: [110, 195] },
      { title: 'Mapping Service lookup', detail: 'Nitro queries the Mapping Service: "which physical host owns 10.0.0.20?" The answer is cached locally at microsecond scale. On cache miss, the request reaches the distributed control plane.', packet: 'lookup:  vpc_ip=10.0.0.20\nreply:   host=172.16.2.20  encap=vxlan-like', highlight: ['nitroA', 'mapping'], pos: [450, 108] },
      { title: 'Response: build encapsulated packet', detail: 'Nitro wraps the original frame with an outer IP header whose destination is the physical host (172.16.2.20). The physical routers only see this outer header — they have no knowledge of VPC addresses.', packet: 'outer:  src=172.16.1.10  dst=172.16.2.20\ninner:  src=10.0.0.10   dst=10.0.0.20  proto=TCP  dport=80', highlight: ['nitroA'], pos: [110, 195] },
      { title: 'Transit over AWS physical network', detail: 'The encapsulated packet is forwarded hop-by-hop using the outer IP address. VPC isolation is preserved — physical routers never inspect the inner packet.', packet: 'outer:  src=172.16.1.10  dst=172.16.2.20\n[transit · inner payload opaque to routers]', highlight: ['awsNet'], waypoints: [[110, 195], [260, 344], [640, 344]] },
      { title: 'Nitro Card B decapsulates', detail: 'On arrival, Nitro Card B strips the outer header and validates the inner VPC destination. The original packet is reconstructed exactly as the sender produced it.', packet: 'outer stripped\ninner:  src=10.0.0.10  dst=10.0.0.20  proto=TCP  dport=80', highlight: ['nitroB'], pos: [790, 195] },
      { title: 'Delivered to EC2-B', detail: 'EC2-B receives a normal TCP segment from 10.0.0.10. The entire encapsulation round-trip was invisible to both endpoints.', packet: 'delivered:  src=10.0.0.10  dst=10.0.0.20  proto=TCP  dport=80', highlight: ['ec2b'], pos: [790, 55] },
    ],
  },
  'vm-inet': {
    desc: 'A packet from EC2-A destined for the public internet. After Nitro intercepts and the Mapping Service resolves the route to an Internet Gateway, the packet is forwarded to a Blackfoot edge device — the component that bridges the VPC overlay network to the external internet.',
    steps: [
      { title: 'EC2-A sends to the internet', detail: 'The guest OS sends to a public IP. The routing table for the VPC subnet points to an Internet Gateway (IGW) as the default route.', packet: 'inner:  src=10.0.0.10  dst=203.0.113.50  proto=TCP  dport=443', highlight: ['ec2a'], pos: [110, 55] },
      { title: 'Nitro Card intercepts', detail: 'Same as VPC-internal traffic — every frame is captured by the Nitro Card before leaving the host.', packet: 'inner:  src=10.0.0.10  dst=203.0.113.50\n[intercepted by Nitro Card A]', highlight: ['ec2a', 'nitroA'], pos: [110, 195] },
      { title: 'Mapping Service lookup: IGW → Blackfoot', detail: 'The Mapping Service resolves the IGW target to a Blackfoot edge device. Blackfoot is the AWS component that connects the VPC overlay to external networks.', packet: 'lookup:  dst=203.0.113.50  via IGW\nreply:   forward to Blackfoot @ 172.16.99.1', highlight: ['nitroA', 'mapping'], pos: [450, 108] },
      { title: 'Encapsulate toward Blackfoot', detail: 'Nitro encapsulates the packet with Blackfoot\'s physical address as the outer destination. The inner packet still carries the private source IP — NAT happens at the edge.', packet: 'outer:  src=172.16.1.10  dst=172.16.99.1  [→ Blackfoot]\ninner:  src=10.0.0.10   dst=203.0.113.50', highlight: ['nitroA'], pos: [110, 195] },
      { title: 'Transit to Blackfoot', detail: 'The encapsulated packet travels the AWS physical network to the Blackfoot edge device at the boundary of the AZ.', packet: 'outer:  src=172.16.1.10  dst=172.16.99.1\n[in transit → Blackfoot edge]', highlight: ['awsNet'], waypoints: [[110, 195], [260, 344], [560, 344], [620, 450]] },
      { title: 'Blackfoot: decapsulate and NAT', detail: 'Blackfoot strips the outer header, performs Source NAT replacing the private IP with the Elastic IP / public IP assigned to the instance, and prepares to forward the packet to the public internet.', packet: 'decapped · SNAT applied\nouter: src=54.x.x.x (EIP)  dst=203.0.113.50', highlight: ['blackfoot'], pos: [620, 450] },
      { title: 'Forwarded to internet', detail: 'The now-public packet exits AWS through the Blackfoot edge device onto the public internet. Return traffic follows the reverse path, with Blackfoot performing DNAT to restore the private IP.', packet: 'egress:  src=54.x.x.x  dst=203.0.113.50  proto=TCP  dport=443', highlight: ['internet'], pos: [790, 452] },
    ],
  },
  'vm-nlb': {
    desc: 'A packet from EC2-A hitting a Network Load Balancer (NLB). Hyperplane — AWS\'s internal distributed packet-forwarding system — powers the NLB. It uses consistent hashing on the 5-tuple to pin each flow to a single Hyperplane node, then selects and re-encapsulates toward a healthy target.',
    steps: [
      { title: 'EC2-A connects to NLB', detail: 'The app opens a TCP connection to the NLB\'s VIP (10.0.1.100). From the guest perspective, this looks like any other VPC destination.', packet: 'inner:  src=10.0.0.10  dst=10.0.1.100  proto=TCP  dport=443', highlight: ['ec2a'], pos: [110, 55] },
      { title: 'Nitro Card intercepts', detail: 'The Nitro Card captures the packet. Because the destination is an NLB VIP, the Mapping Service will resolve it to a Hyperplane fleet endpoint rather than a single host.', packet: 'inner:  src=10.0.0.10  dst=10.0.1.100  [NLB VIP]\n[intercepted by Nitro Card A]', highlight: ['ec2a', 'nitroA'], pos: [110, 195] },
      { title: 'Mapping Service: resolve VIP → Hyperplane', detail: 'The Mapping Service identifies 10.0.1.100 as an NLB VIP and returns a Hyperplane fleet endpoint. Hyperplane is presented as a single ENI but is backed by a redundant fleet.', packet: 'lookup:  vpc_ip=10.0.1.100\nreply:   NLB VIP → Hyperplane fleet endpoint', highlight: ['nitroA', 'mapping'], pos: [450, 108] },
      { title: 'Encapsulate to Hyperplane', detail: 'Nitro wraps the packet with Hyperplane as the outer destination. The inner packet is untouched — Hyperplane will later decide the real target.', packet: 'outer:  src=172.16.1.10  dst=172.16.50.x  [→ Hyperplane]\ninner:  src=10.0.0.10   dst=10.0.1.100', highlight: ['nitroA'], pos: [110, 195] },
      { title: 'Hyperplane: flow hash and target selection', detail: 'Hyperplane hashes the 5-tuple (src IP, src port, dst IP, dst port, proto) for consistent flow affinity — every packet in this connection hits the same Hyperplane node. It selects a healthy target (EC2-B) from the registered target group.', packet: '5-tuple hash → node-7 (flow affinity)\ntarget selected: 10.0.0.20 (EC2-B)', highlight: ['hyperplane'], waypoints: [[110, 195], [260, 344], [450, 344], [450, 245]] },
      { title: 'Re-encapsulate and forward to target', detail: 'Hyperplane re-encapsulates the packet with EC2-B\'s physical host (Nitro B) as the outer destination. The NLB VIP is preserved in the inner header — the target sees the original dst IP and performs its own routing.', packet: 'outer:  src=172.16.50.x  dst=172.16.2.20  [→ Nitro B]\ninner:  src=10.0.0.10   dst=10.0.1.100', highlight: ['awsNet', 'nitroB'], waypoints: [[450, 245], [450, 344], [640, 344], [790, 195]] },
      { title: 'Delivered to EC2-B', detail: 'Nitro Card B decapsulates and delivers the packet to EC2-B. The NLB\'s target group listener handles the connection. The full flow took microseconds.', packet: 'delivered:  src=10.0.0.10  dst=10.0.1.100  proto=TCP  dport=443', highlight: ['ec2b'], pos: [790, 55] },
    ],
  },
}

const TABS = [
  { id: 'vm-vm',   label: 'VM → VM' },
  { id: 'vm-inet', label: 'VM → Internet' },
  { id: 'vm-nlb',  label: 'VM → NLB' },
]

const NODE_COLOR = {
  box: 'var(--kp-bg)',
  stroke: 'var(--kp-border-strong)',
  label: 'var(--kp-fg)',
  sub: 'var(--kp-fg-3)',
  hl_box: 'var(--kp-bg-muted)',
  hl_stroke: 'var(--kp-fg)',
  edge: 'var(--kp-border)',
  edge_active: 'var(--kp-fg)',
  packet: 'var(--kp-fg)',
}

export default function VpcPage() {
  const { theme } = useTheme()
  const [scenario, setScenario] = useState('vm-vm')
  const [step, setStep] = useState(0)
  const [auto, setAuto] = useState(false)
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const animating = useRef(false)
  const packetRef = useRef<SVGGElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const currentScenario = SCENARIOS[scenario]
  const currentStep = currentScenario.steps[step]
  const totalSteps = currentScenario.steps.length

  useEffect(() => {
    if (svgRef.current && packetRef.current) {
      updateHighlights(currentStep.highlight)
    }
  }, [step, scenario, theme])

  function getNodeBox(id: string) {
    return svgRef.current?.querySelector(`#node-${id} .vpc-node-box`) as SVGRectElement | null
  }

  function updateHighlights(nodeIds: string[]) {
    svgRef.current?.querySelectorAll('.vpc-node-box').forEach(el => el.classList.remove('highlighted'))
    nodeIds.forEach(id => getNodeBox(id)?.classList.add('highlighted'))
  }

  function setPacketPos(x: number, y: number, animate: boolean) {
    if (!packetRef.current) return
    packetRef.current.style.transition = animate ? 'transform 0.55s cubic-bezier(0.2, 0, 0, 1)' : 'none'
    packetRef.current.style.transform = `translate(${x}px, ${y}px)`
  }

  async function animateWaypoints(waypoints: [number, number][]) {
    for (let i = 0; i < waypoints.length; i++) {
      const [x, y] = waypoints[i]
      await new Promise<void>(resolve => {
        setTimeout(() => {
          setPacketPos(x, y, true)
          setTimeout(resolve, 580)
        }, i === 0 ? 0 : 20)
      })
    }
  }

  async function goToStep(idx: number, animated: boolean) {
    const s = currentScenario.steps[idx]
    updateHighlights(s.highlight)
    if (s.waypoints && animated) {
      animating.current = true
      await animateWaypoints(s.waypoints)
      animating.current = false
    } else if (s.pos) {
      setPacketPos(s.pos[0], s.pos[1], animated)
    } else if (s.waypoints) {
      const last = s.waypoints[s.waypoints.length - 1]
      setPacketPos(last[0], last[1], false)
    }
    setStep(idx)
  }

  function loadScenario(id: string) {
    stopAuto()
    setScenario(id)
    setStep(0)
    setPacketPos(0, 0, false)
    updateHighlights(SCENARIOS[id].steps[0].highlight)
  }

  function stopAuto() {
    if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null }
    setAuto(false)
  }

  function startAuto() {
    setAuto(true)
    autoRef.current = setInterval(() => {
      setStep(s => {
        const next = s + 1
        if (next >= currentScenario.steps.length) { stopAuto(); return s }
        const st = currentScenario.steps[next]
        updateHighlights(st.highlight)
        if (st.pos) setPacketPos(st.pos[0], st.pos[1], true)
        else if (st.waypoints) {
          const last = st.waypoints[st.waypoints.length - 1]
          setPacketPos(last[0], last[1], true)
        }
        return next
      })
    }, 2000)
  }

  function handleAuto() {
    if (auto) { stopAuto(); return }
    if (step >= totalSteps - 1) {
      loadScenario(scenario)
      setTimeout(startAuto, 300)
    } else {
      startAuto()
    }
  }

  useEffect(() => () => { if (autoRef.current) clearInterval(autoRef.current) }, [])

  return (
    <NoteLayout
      title="VPC packet flow"
      date="2026-06-01"
      readTime="5 min"
      tags={['aws', 'networking', 'vpc']}
      intro="How packets move inside AWS VPC — Nitro cards, Mapping Service, Hyperplane, and Blackfoot. Step through three scenarios: VM-to-VM, VM-to-Internet, and VM-to-NLB, and see what actually happens at each hop."
    >
      <div className="vpc-tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.id} className={`vpc-tab-btn${scenario === t.id ? ' active' : ''}`}
            role="tab" onClick={() => loadScenario(t.id)}>{t.label}</button>
        ))}
      </div>

      <p className="vpc-scenario-desc">{currentScenario.desc}</p>

      <div className="vpc-diagram-wrap">
        <svg ref={svgRef} viewBox="0 0 900 510" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <style>{`
              .vpc-node-box { fill: ${NODE_COLOR.box}; stroke: ${NODE_COLOR.stroke}; stroke-width: 1; }
              .vpc-node-box.highlighted { stroke: ${NODE_COLOR.hl_stroke}; fill: ${NODE_COLOR.hl_box}; }
              .vpc-node-label { font-family: var(--kp-font-sans); font-size: 11px; font-weight: 600; fill: ${NODE_COLOR.label}; text-anchor: middle; dominant-baseline: middle; pointer-events: none; }
              .vpc-node-sub { font-family: var(--kp-font-mono); font-size: 9px; fill: ${NODE_COLOR.sub}; text-anchor: middle; dominant-baseline: middle; pointer-events: none; }
              .vpc-edge { stroke: ${NODE_COLOR.edge}; stroke-width: 1.5; fill: none; stroke-dasharray: 4 3; }
              .vpc-packet-dot { fill: ${NODE_COLOR.packet}; }
              .vpc-packet-ring { fill: none; stroke: ${NODE_COLOR.packet}; stroke-width: 1; opacity: 0.3; }
            `}</style>
          </defs>
          <g id="edges">
            <line id="edge-ec2a-nitroA"      className="vpc-edge" x1="110" y1="80"  x2="110" y2="168"/>
            <line id="edge-nitroA-mapping"   className="vpc-edge" x1="175" y1="195" x2="363" y2="108"/>
            <line id="edge-nitroA-awsNet"    className="vpc-edge" x1="110" y1="222" x2="260" y2="344"/>
            <line id="edge-awsNet-nitroB"    className="vpc-edge" x1="640" y1="344" x2="725" y2="195"/>
            <line id="edge-nitroB-ec2b"      className="vpc-edge" x1="790" y1="168" x2="790" y2="80"/>
            <line id="edge-awsNet-blackfoot" className="vpc-edge" x1="560" y1="392" x2="620" y2="427"/>
            <line id="edge-blackfoot-internet" className="vpc-edge" x1="693" y1="450" x2="735" y2="452"/>
            <line id="edge-hyperplane-awsNet" className="vpc-edge" x1="450" y1="272" x2="450" y2="344"/>
          </g>
          <g id="nodes">
            <g id="node-ec2a" className="node">
              <rect className="vpc-node-box" x="45" y="30" width="130" height="50" rx="6"/>
              <text className="vpc-node-label" x="110" y="50">EC2-A</text>
              <text className="vpc-node-sub" x="110" y="65">10.0.0.10</text>
            </g>
            <g id="node-nitroA" className="node">
              <rect className="vpc-node-box" x="45" y="168" width="130" height="54" rx="6"/>
              <text className="vpc-node-label" x="110" y="188">Nitro Card A</text>
              <text className="vpc-node-sub" x="110" y="203">host: 172.16.1.10</text>
            </g>
            <g id="node-mapping" className="node">
              <rect className="vpc-node-box" x="363" y="83" width="175" height="50" rx="6"/>
              <text className="vpc-node-label" x="450" y="102">Mapping Service</text>
              <text className="vpc-node-sub" x="450" y="118">control plane · distributed</text>
            </g>
            <g id="node-hyperplane" className="node">
              <rect className="vpc-node-box" x="363" y="218" width="175" height="54" rx="6"/>
              <text className="vpc-node-label" x="450" y="238">Hyperplane</text>
              <text className="vpc-node-sub" x="450" y="253">NLB · NAT GW · PrivateLink</text>
            </g>
            <g id="node-awsNet" className="node">
              <rect className="vpc-node-box" x="155" y="344" width="590" height="48" rx="6"/>
              <text className="vpc-node-label" x="450" y="360">AWS Physical Network</text>
              <text className="vpc-node-sub" x="450" y="375">outer IP routing · encapsulated packets only</text>
            </g>
            <g id="node-nitroB" className="node">
              <rect className="vpc-node-box" x="725" y="168" width="130" height="54" rx="6"/>
              <text className="vpc-node-label" x="790" y="188">Nitro Card B</text>
              <text className="vpc-node-sub" x="790" y="203">host: 172.16.2.20</text>
            </g>
            <g id="node-ec2b" className="node">
              <rect className="vpc-node-box" x="725" y="30" width="130" height="50" rx="6"/>
              <text className="vpc-node-label" x="790" y="50">EC2-B</text>
              <text className="vpc-node-sub" x="790" y="65">10.0.0.20</text>
            </g>
            <g id="node-blackfoot" className="node">
              <rect className="vpc-node-box" x="548" y="427" width="145" height="46" rx="6"/>
              <text className="vpc-node-label" x="620" y="446">Blackfoot</text>
              <text className="vpc-node-sub" x="620" y="462">edge · decap + NAT</text>
            </g>
            <g id="node-internet" className="node">
              <rect className="vpc-node-box" x="735" y="433" width="110" height="38" rx="6"/>
              <text className="vpc-node-label" x="790" y="452">Internet</text>
            </g>
          </g>
          <g ref={packetRef} style={{ transform: 'translate(0px, 0px)' }}>
            <circle className="vpc-packet-ring" cx="0" cy="0" r="11"/>
            <circle className="vpc-packet-dot" cx="0" cy="0" r="6"/>
          </g>
        </svg>
      </div>

      <div className="vpc-step-panel">
        <div className="vpc-step-header">
          <span className="vpc-step-badge">step {step + 1} / {totalSteps}</span>
          <span className="vpc-step-title">{currentStep.title}</span>
        </div>
        <div className="vpc-step-detail">{currentStep.detail}</div>
        <div className="vpc-step-packet">{currentStep.packet}</div>
      </div>

      <div className="vpc-controls">
        <button className="vpc-ctrl-btn" onClick={() => { stopAuto(); if (step > 0) goToStep(step - 1, true) }} disabled={step === 0}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
          </svg>
          Prev
        </button>
        <button className="vpc-ctrl-btn primary" onClick={handleAuto}>
          {auto ? (
            <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 14, height: 14 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5"/>
            </svg> Pause</>
          ) : (
            <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 14, height: 14 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z"/>
            </svg> Auto</>
          )}
        </button>
        <button className="vpc-ctrl-btn" onClick={() => { stopAuto(); if (step < totalSteps - 1) goToStep(step + 1, true) }} disabled={step === totalSteps - 1}>
          Next
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/>
          </svg>
        </button>
        <span className="vpc-step-counter">{step + 1} of {totalSteps}</span>
      </div>

      <div className="vpc-disclaimer">
        <div className="vpc-disclaimer-header">Disclaimer</div>
        <p>This demonstration is based entirely on publicly available information from AWS re:Invent conference sessions and official AWS blog posts. It does not represent, contain, or disclose any AWS confidential, proprietary, or internal information.</p>
        <p className="sources">Sources: CPN401 (re:Invent 2013) · NET403 (2015) · NET401 (2016) · NET405 (2017) · NET334 (2025) · AWS Networking blog</p>
      </div>
    </NoteLayout>
  )
}
