import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useTheme, useLang } from '../App'

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

const SCENARIOS_KO: Record<string, Scenario> = {
  'vm-vm': {
    desc: 'EC2-A에서 동일 VPC 내 EC2-B로 전송되는 패킷입니다. Nitro 카드가 모든 아웃바운드 프레임을 가로채고, Mapping Service에 조회하여 목적지의 물리적 호스트 주소를 확인한 후, 원본 패킷에 외부 IP 헤더를 감싸 AWS 물리 네트워크를 통해 전달합니다 — 게스트 OS에는 완전히 투명합니다.',
    steps: [
      { title: 'EC2-A가 패킷을 전송합니다', detail: 'EC2-A의 게스트 OS가 일반적인 전송을 실행합니다. 앱은 VPC 사설 IP만 볼 수 있으며 물리 기반 레이어에 대한 인식이 없습니다.', packet: SCENARIOS['vm-vm'].steps[0].packet, highlight: SCENARIOS['vm-vm'].steps[0].highlight, pos: SCENARIOS['vm-vm'].steps[0].pos },
      { title: 'Nitro Card가 가로챕니다', detail: 'VM에서 나가는 모든 프레임은 와이어에 도달하기 전에 Nitro Card에 캡처됩니다. 게스트 OS는 이를 우회할 수 없습니다 — 캡슐화는 하드웨어에서 발생합니다.', packet: SCENARIOS['vm-vm'].steps[1].packet, highlight: SCENARIOS['vm-vm'].steps[1].highlight, pos: SCENARIOS['vm-vm'].steps[1].pos },
      { title: 'Mapping Service 조회', detail: 'Nitro가 Mapping Service에 조회합니다: "10.0.0.20을 소유하는 물리 호스트는?" 응답이 마이크로초 단위로 로컬에 캐시됩니다. 캐시 미스 시 분산 컨트롤 플레인에 도달합니다.', packet: SCENARIOS['vm-vm'].steps[2].packet, highlight: SCENARIOS['vm-vm'].steps[2].highlight, pos: SCENARIOS['vm-vm'].steps[2].pos },
      { title: '응답: 캡슐화된 패킷 구성', detail: 'Nitro가 외부 IP 헤더를 추가하며 목적지는 물리 호스트(172.16.2.20)입니다. 물리 라우터는 이 외부 헤더만 봅니다 — VPC 주소에 대한 지식이 없습니다.', packet: SCENARIOS['vm-vm'].steps[3].packet, highlight: SCENARIOS['vm-vm'].steps[3].highlight, pos: SCENARIOS['vm-vm'].steps[3].pos },
      { title: 'AWS 물리 네트워크 경유', detail: '캡슐화된 패킷이 외부 IP 주소를 사용해 홉별로 포워딩됩니다. VPC 격리가 유지됩니다 — 물리 라우터가 내부 패킷을 검사하지 않습니다.', packet: SCENARIOS['vm-vm'].steps[4].packet, highlight: SCENARIOS['vm-vm'].steps[4].highlight, waypoints: SCENARIOS['vm-vm'].steps[4].waypoints },
      { title: 'Nitro Card B가 역캡슐화합니다', detail: '도착 시 Nitro Card B가 외부 헤더를 제거하고 내부 VPC 목적지를 검증합니다. 원본 패킷이 발신자가 생성한 그대로 재구성됩니다.', packet: SCENARIOS['vm-vm'].steps[5].packet, highlight: SCENARIOS['vm-vm'].steps[5].highlight, pos: SCENARIOS['vm-vm'].steps[5].pos },
      { title: 'EC2-B로 전달됩니다', detail: 'EC2-B가 10.0.0.10으로부터 일반 TCP 세그먼트를 수신합니다. 캡슐화 왕복 전체가 양쪽 엔드포인트에 보이지 않습니다.', packet: SCENARIOS['vm-vm'].steps[6].packet, highlight: SCENARIOS['vm-vm'].steps[6].highlight, pos: SCENARIOS['vm-vm'].steps[6].pos },
    ],
  },
  'vm-inet': {
    desc: '인터넷으로 향하는 EC2-A 패킷입니다. Nitro가 가로채고 Mapping Service가 Internet Gateway 경로를 Blackfoot 엣지 장치로 해석한 후, VPC 오버레이 네트워크와 외부 인터넷을 연결하는 Blackfoot으로 패킷을 전달합니다.',
    steps: [
      { title: 'EC2-A가 인터넷으로 전송합니다', detail: '게스트 OS가 공인 IP로 전송합니다. VPC 서브넷 라우팅 테이블이 Internet Gateway(IGW)를 기본 경로로 지정합니다.', packet: SCENARIOS['vm-inet'].steps[0].packet, highlight: SCENARIOS['vm-inet'].steps[0].highlight, pos: SCENARIOS['vm-inet'].steps[0].pos },
      { title: 'Nitro Card가 가로챕니다', detail: 'VPC 내부 트래픽과 동일 — 모든 프레임이 호스트를 떠나기 전에 Nitro Card에 캡처됩니다.', packet: SCENARIOS['vm-inet'].steps[1].packet, highlight: SCENARIOS['vm-inet'].steps[1].highlight, pos: SCENARIOS['vm-inet'].steps[1].pos },
      { title: 'Mapping Service 조회: IGW → Blackfoot', detail: 'Mapping Service가 IGW 대상을 Blackfoot 엣지 장치로 해석합니다. Blackfoot은 VPC 오버레이를 외부 네트워크에 연결하는 AWS 컴포넌트입니다.', packet: SCENARIOS['vm-inet'].steps[2].packet, highlight: SCENARIOS['vm-inet'].steps[2].highlight, pos: SCENARIOS['vm-inet'].steps[2].pos },
      { title: 'Blackfoot 방향으로 캡슐화', detail: 'Nitro가 Blackfoot의 물리 주소를 외부 목적지로 사용해 패킷을 캡슐화합니다. 내부 패킷은 사설 소스 IP를 그대로 유지합니다 — NAT는 엣지에서 발생합니다.', packet: SCENARIOS['vm-inet'].steps[3].packet, highlight: SCENARIOS['vm-inet'].steps[3].highlight, pos: SCENARIOS['vm-inet'].steps[3].pos },
      { title: 'Blackfoot으로 경유', detail: '캡슐화된 패킷이 AWS 물리 네트워크를 통해 AZ 경계의 Blackfoot 엣지 장치로 이동합니다.', packet: SCENARIOS['vm-inet'].steps[4].packet, highlight: SCENARIOS['vm-inet'].steps[4].highlight, waypoints: SCENARIOS['vm-inet'].steps[4].waypoints },
      { title: 'Blackfoot: 역캡슐화 및 NAT', detail: 'Blackfoot이 외부 헤더를 제거하고, 사설 IP를 인스턴스에 할당된 Elastic IP/공인 IP로 소스 NAT를 적용한 후 공인 인터넷으로 패킷을 전달할 준비를 합니다.', packet: SCENARIOS['vm-inet'].steps[5].packet, highlight: SCENARIOS['vm-inet'].steps[5].highlight, pos: SCENARIOS['vm-inet'].steps[5].pos },
      { title: '인터넷으로 포워딩', detail: '이제 공인 패킷이 Blackfoot 엣지 장치를 통해 AWS에서 공인 인터넷으로 나갑니다. 반환 트래픽은 역방향 경로를 따르며, Blackfoot이 DNAT를 수행하여 사설 IP를 복원합니다.', packet: SCENARIOS['vm-inet'].steps[6].packet, highlight: SCENARIOS['vm-inet'].steps[6].highlight, pos: SCENARIOS['vm-inet'].steps[6].pos },
    ],
  },
  'vm-nlb': {
    desc: 'NLB(Network Load Balancer)에 도달하는 EC2-A 패킷입니다. Hyperplane — AWS 내부 분산 패킷 포워딩 시스템 — 이 NLB를 구동합니다. 5-tuple의 일관된 해싱을 통해 각 흐름을 단일 Hyperplane 노드에 고정시킨 후, 정상 대상을 선택하여 재캡슐화합니다.',
    steps: [
      { title: 'EC2-A가 NLB에 연결합니다', detail: '앱이 NLB의 VIP(10.0.1.100)로 TCP 연결을 엽니다. 게스트 관점에서는 다른 VPC 목적지와 동일하게 보입니다.', packet: SCENARIOS['vm-nlb'].steps[0].packet, highlight: SCENARIOS['vm-nlb'].steps[0].highlight, pos: SCENARIOS['vm-nlb'].steps[0].pos },
      { title: 'Nitro Card가 가로챕니다', detail: 'Nitro Card가 패킷을 캡처합니다. 목적지가 NLB VIP이므로 Mapping Service는 단일 호스트가 아닌 Hyperplane 플릿 엔드포인트로 해석합니다.', packet: SCENARIOS['vm-nlb'].steps[1].packet, highlight: SCENARIOS['vm-nlb'].steps[1].highlight, pos: SCENARIOS['vm-nlb'].steps[1].pos },
      { title: 'Mapping Service: VIP → Hyperplane 해석', detail: 'Mapping Service가 10.0.1.100을 NLB VIP로 식별하고 Hyperplane 플릿 엔드포인트를 반환합니다. Hyperplane은 단일 ENI처럼 보이지만 내부적으로 이중화된 플릿으로 구성됩니다.', packet: SCENARIOS['vm-nlb'].steps[2].packet, highlight: SCENARIOS['vm-nlb'].steps[2].highlight, pos: SCENARIOS['vm-nlb'].steps[2].pos },
      { title: 'Hyperplane으로 캡슐화', detail: 'Nitro가 Hyperplane을 외부 목적지로 하여 패킷을 감쌉니다. 내부 패킷은 그대로 유지됩니다 — Hyperplane이 나중에 실제 대상을 결정합니다.', packet: SCENARIOS['vm-nlb'].steps[3].packet, highlight: SCENARIOS['vm-nlb'].steps[3].highlight, pos: SCENARIOS['vm-nlb'].steps[3].pos },
      { title: 'Hyperplane: 흐름 해시 및 대상 선택', detail: 'Hyperplane이 5-tuple(src IP, src port, dst IP, dst port, proto)을 해시하여 흐름 친화성을 일관되게 유지합니다 — 이 연결의 모든 패킷이 동일한 Hyperplane 노드에 도달합니다. 등록된 대상 그룹에서 정상 대상(EC2-B)을 선택합니다.', packet: SCENARIOS['vm-nlb'].steps[4].packet, highlight: SCENARIOS['vm-nlb'].steps[4].highlight, waypoints: SCENARIOS['vm-nlb'].steps[4].waypoints },
      { title: '대상으로 재캡슐화 및 포워딩', detail: 'Hyperplane이 EC2-B의 물리 호스트(Nitro B)를 외부 목적지로 하여 패킷을 재캡슐화합니다. NLB VIP는 내부 헤더에 유지됩니다 — 대상이 원본 dst IP를 보고 자체 라우팅을 수행합니다.', packet: SCENARIOS['vm-nlb'].steps[5].packet, highlight: SCENARIOS['vm-nlb'].steps[5].highlight, waypoints: SCENARIOS['vm-nlb'].steps[5].waypoints },
      { title: 'EC2-B로 전달됩니다', detail: 'Nitro Card B가 역캡슐화하고 EC2-B로 전달합니다. NLB 대상 그룹 리스너가 연결을 처리합니다. 전체 흐름이 마이크로초 내에 완료됩니다.', packet: SCENARIOS['vm-nlb'].steps[6].packet, highlight: SCENARIOS['vm-nlb'].steps[6].highlight, pos: SCENARIOS['vm-nlb'].steps[6].pos },
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
  const { lang } = useLang()
  const scenariosMap = lang === 'ko' ? SCENARIOS_KO : SCENARIOS
  const [scenario, setScenario] = useState('vm-vm')
  const [step, setStep] = useState(0)
  const [auto, setAuto] = useState(false)
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const animating = useRef(false)
  const packetRef = useRef<SVGGElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const currentScenario = scenariosMap[scenario]
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
    updateHighlights(scenariosMap[id].steps[0].highlight)
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
        const scen = scenariosMap[scenario]
        if (next >= scen.steps.length) { stopAuto(); return s }
        const st = scen.steps[next]
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
      title={lang === 'ko' ? 'VPC 패킷 흐름' : 'VPC packet flow'}
      date="2026-06-01"
      readTime={lang === 'ko' ? '5분' : '5 min'}
      tags={['aws', 'networking', 'vpc']}
      intro={lang === 'ko'
        ? 'AWS VPC 내에서 패킷이 이동하는 방법 — Nitro 카드, Mapping Service, Hyperplane, Blackfoot. VM-to-VM, VM-to-Internet, VM-to-NLB 세 가지 시나리오를 단계별로 살펴보며 각 홉에서 실제로 일어나는 일을 확인합니다.'
        : 'How packets move inside AWS VPC — Nitro cards, Mapping Service, Hyperplane, and Blackfoot. Step through three scenarios: VM-to-VM, VM-to-Internet, and VM-to-NLB, and see what actually happens at each hop.'}
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
          <span className="vpc-step-badge">{lang === 'ko' ? '단계' : 'step'} {step + 1} / {totalSteps}</span>
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
          {lang === 'ko' ? '이전' : 'Prev'}
        </button>
        <button className="vpc-ctrl-btn primary" onClick={handleAuto}>
          {auto ? (
            <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 14, height: 14 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5"/>
            </svg> {lang === 'ko' ? '일시정지' : 'Pause'}</>
          ) : (
            <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 14, height: 14 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z"/>
            </svg> {lang === 'ko' ? '자동' : 'Auto'}</>
          )}
        </button>
        <button className="vpc-ctrl-btn" onClick={() => { stopAuto(); if (step < totalSteps - 1) goToStep(step + 1, true) }} disabled={step === totalSteps - 1}>
          {lang === 'ko' ? '다음' : 'Next'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/>
          </svg>
        </button>
        <span className="vpc-step-counter">{step + 1} of {totalSteps}</span>
      </div>

      <div className="vpc-disclaimer">
        <div className="vpc-disclaimer-header">{lang === 'ko' ? '고지사항' : 'Disclaimer'}</div>
        <p>{lang === 'ko'
          ? '이 데모는 AWS re:Invent 컨퍼런스 세션 및 공식 AWS 블로그 포스트의 공개 정보만을 기반으로 합니다. AWS의 기밀, 독점 또는 내부 정보를 포함하거나 공개하지 않습니다.'
          : 'This demonstration is based entirely on publicly available information from AWS re:Invent conference sessions and official AWS blog posts. It does not represent, contain, or disclose any AWS confidential, proprietary, or internal information.'}</p>
        <p className="sources">Sources: CPN401 (re:Invent 2013) · NET403 (2015) · NET401 (2016) · NET405 (2017) · NET334 (2025) · AWS Networking blog</p>
      </div>
    </NoteLayout>
  )
}
