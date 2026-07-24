import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type NodeId =
  | 'srv_a' | 'tor_a' | 'acc_a' | 'agg_a' | 'core'
  | 'agg_b' | 'acc_b' | 'tor_b' | 'srv_b'
  | 'br' | 'internet' | 'peer_org' | 'branch'
type NodeStatus = 'idle' | 'active' | 'done'
type LinkId =
  | 'srv_a_tor_a' | 'tor_a_acc_a' | 'acc_a_agg_a' | 'agg_a_core'
  | 'core_agg_b'  | 'agg_b_acc_b' | 'acc_b_tor_b'  | 'tor_b_srv_b'
  | 'core_br' | 'br_internet' | 'br_peer_org' | 'br_branch'
type LinkStatus = 'idle' | 'active' | 'done'
type Scenario = 'ew' | 'ns' | 'peer'

interface DcFrame {
  nodes: Record<NodeId, NodeStatus>
  links: Record<LinkId, LinkStatus>
}

// ── Graph geometry ─────────────────────────────────────────────────────────────

const W = 600
const H = 300

const NODE_PX: Record<NodeId, [number, number]> = {
  srv_a:    [ 45, 278],
  tor_a:    [ 80, 243],
  acc_a:    [118, 198],
  agg_a:    [162, 148],
  core:     [272,  80],
  agg_b:    [382, 148],
  acc_b:    [426, 198],
  tor_b:    [462, 243],
  srv_b:    [498, 278],
  br:       [492,  80],
  internet: [492,  22],
  peer_org: [558,  58],
  branch:   [558, 110],
}

const NODE_IDS: NodeId[] = [
  'srv_a', 'tor_a', 'acc_a', 'agg_a', 'core',
  'agg_b', 'acc_b', 'tor_b', 'srv_b',
  'br', 'internet', 'peer_org', 'branch',
]

const LINKS: Array<{ id: LinkId; from: NodeId; to: NodeId }> = [
  { id: 'srv_a_tor_a', from: 'srv_a', to: 'tor_a' },
  { id: 'tor_a_acc_a', from: 'tor_a', to: 'acc_a' },
  { id: 'acc_a_agg_a', from: 'acc_a', to: 'agg_a' },
  { id: 'agg_a_core',  from: 'agg_a', to: 'core'  },
  { id: 'core_agg_b',  from: 'core',  to: 'agg_b' },
  { id: 'agg_b_acc_b', from: 'agg_b', to: 'acc_b' },
  { id: 'acc_b_tor_b', from: 'acc_b', to: 'tor_b' },
  { id: 'tor_b_srv_b', from: 'tor_b', to: 'srv_b' },
  { id: 'core_br',     from: 'core',  to: 'br'       },
  { id: 'br_internet', from: 'br',    to: 'internet'  },
  { id: 'br_peer_org', from: 'br',    to: 'peer_org'  },
  { id: 'br_branch',   from: 'br',    to: 'branch'    },
]

const LINK_PATHS: Record<LinkId, string> = {
  srv_a_tor_a: `M ${NODE_PX.srv_a[0]} ${NODE_PX.srv_a[1]} L ${NODE_PX.tor_a[0]} ${NODE_PX.tor_a[1]}`,
  tor_a_acc_a: `M ${NODE_PX.tor_a[0]} ${NODE_PX.tor_a[1]} L ${NODE_PX.acc_a[0]} ${NODE_PX.acc_a[1]}`,
  acc_a_agg_a: `M ${NODE_PX.acc_a[0]} ${NODE_PX.acc_a[1]} L ${NODE_PX.agg_a[0]} ${NODE_PX.agg_a[1]}`,
  agg_a_core:  `M ${NODE_PX.agg_a[0]} ${NODE_PX.agg_a[1]} L ${NODE_PX.core[0]}  ${NODE_PX.core[1]}`,
  core_agg_b:  `M ${NODE_PX.core[0]}  ${NODE_PX.core[1]}  L ${NODE_PX.agg_b[0]} ${NODE_PX.agg_b[1]}`,
  agg_b_acc_b: `M ${NODE_PX.agg_b[0]} ${NODE_PX.agg_b[1]} L ${NODE_PX.acc_b[0]} ${NODE_PX.acc_b[1]}`,
  acc_b_tor_b: `M ${NODE_PX.acc_b[0]} ${NODE_PX.acc_b[1]} L ${NODE_PX.tor_b[0]} ${NODE_PX.tor_b[1]}`,
  tor_b_srv_b: `M ${NODE_PX.tor_b[0]} ${NODE_PX.tor_b[1]} L ${NODE_PX.srv_b[0]} ${NODE_PX.srv_b[1]}`,
  core_br:     `M ${NODE_PX.core[0]}  ${NODE_PX.core[1]}  L ${NODE_PX.br[0]}       ${NODE_PX.br[1]}`,
  br_internet: `M ${NODE_PX.br[0]}    ${NODE_PX.br[1]}    L ${NODE_PX.internet[0]} ${NODE_PX.internet[1]}`,
  br_peer_org: `M ${NODE_PX.br[0]}    ${NODE_PX.br[1]}    L ${NODE_PX.peer_org[0]} ${NODE_PX.peer_org[1]}`,
  br_branch:   `M ${NODE_PX.br[0]}    ${NODE_PX.br[1]}    L ${NODE_PX.branch[0]}   ${NODE_PX.branch[1]}`,
}

// ── Frame data ─────────────────────────────────────────────────────────────────

const N0: Record<NodeId, NodeStatus> = {
  srv_a: 'idle', tor_a: 'idle', acc_a: 'idle', agg_a: 'idle', core: 'idle',
  agg_b: 'idle', acc_b: 'idle', tor_b: 'idle', srv_b: 'idle',
  br: 'idle', internet: 'idle', peer_org: 'idle', branch: 'idle',
}
const L0: Record<LinkId, LinkStatus> = {
  srv_a_tor_a: 'idle', tor_a_acc_a: 'idle', acc_a_agg_a: 'idle', agg_a_core: 'idle',
  core_agg_b: 'idle', agg_b_acc_b: 'idle', acc_b_tor_b: 'idle', tor_b_srv_b: 'idle',
  core_br: 'idle', br_internet: 'idle', br_peer_org: 'idle', br_branch: 'idle',
}

const EW_FRAMES: DcFrame[] = [
  { nodes: { ...N0 }, links: { ...L0 } },
  { nodes: { ...N0, srv_a: 'active', tor_a: 'active' },
    links: { ...L0, srv_a_tor_a: 'active' } },
  { nodes: { ...N0, srv_a: 'done', tor_a: 'active', acc_a: 'active' },
    links: { ...L0, srv_a_tor_a: 'done', tor_a_acc_a: 'active' } },
  { nodes: { ...N0, srv_a: 'done', tor_a: 'done', acc_a: 'active', agg_a: 'active' },
    links: { ...L0, srv_a_tor_a: 'done', tor_a_acc_a: 'done', acc_a_agg_a: 'active' } },
  { nodes: { ...N0, srv_a: 'done', tor_a: 'done', acc_a: 'done', agg_a: 'active', core: 'active' },
    links: { ...L0, srv_a_tor_a: 'done', tor_a_acc_a: 'done', acc_a_agg_a: 'done', agg_a_core: 'active' } },
  { nodes: { ...N0, srv_a: 'done', tor_a: 'done', acc_a: 'done', agg_a: 'done', core: 'active', agg_b: 'active' },
    links: { ...L0, srv_a_tor_a: 'done', tor_a_acc_a: 'done', acc_a_agg_a: 'done', agg_a_core: 'done', core_agg_b: 'active' } },
  { nodes: { ...N0, srv_a: 'done', tor_a: 'done', acc_a: 'done', agg_a: 'done', core: 'done', agg_b: 'active', acc_b: 'active' },
    links: { ...L0, srv_a_tor_a: 'done', tor_a_acc_a: 'done', acc_a_agg_a: 'done', agg_a_core: 'done', core_agg_b: 'done', agg_b_acc_b: 'active' } },
  { nodes: { ...N0, srv_a: 'done', tor_a: 'done', acc_a: 'done', agg_a: 'done', core: 'done', agg_b: 'done', acc_b: 'active', tor_b: 'active' },
    links: { ...L0, srv_a_tor_a: 'done', tor_a_acc_a: 'done', acc_a_agg_a: 'done', agg_a_core: 'done', core_agg_b: 'done', agg_b_acc_b: 'done', acc_b_tor_b: 'active' } },
  { nodes: { ...N0, srv_a: 'done', tor_a: 'done', acc_a: 'done', agg_a: 'done', core: 'done', agg_b: 'done', acc_b: 'done', tor_b: 'active', srv_b: 'active' },
    links: { ...L0, srv_a_tor_a: 'done', tor_a_acc_a: 'done', acc_a_agg_a: 'done', agg_a_core: 'done', core_agg_b: 'done', agg_b_acc_b: 'done', acc_b_tor_b: 'done', tor_b_srv_b: 'active' } },
]

const NS_BASE: DcFrame[] = [
  { nodes: { ...N0 }, links: { ...L0 } },
  { nodes: { ...N0, srv_a: 'active', tor_a: 'active' },
    links: { ...L0, srv_a_tor_a: 'active' } },
  { nodes: { ...N0, srv_a: 'done', tor_a: 'active', acc_a: 'active' },
    links: { ...L0, srv_a_tor_a: 'done', tor_a_acc_a: 'active' } },
  { nodes: { ...N0, srv_a: 'done', tor_a: 'done', acc_a: 'active', agg_a: 'active' },
    links: { ...L0, srv_a_tor_a: 'done', tor_a_acc_a: 'done', acc_a_agg_a: 'active' } },
  { nodes: { ...N0, srv_a: 'done', tor_a: 'done', acc_a: 'done', agg_a: 'active', core: 'active' },
    links: { ...L0, srv_a_tor_a: 'done', tor_a_acc_a: 'done', acc_a_agg_a: 'done', agg_a_core: 'active' } },
  { nodes: { ...N0, srv_a: 'done', tor_a: 'done', acc_a: 'done', agg_a: 'done', core: 'active', br: 'active' },
    links: { ...L0, srv_a_tor_a: 'done', tor_a_acc_a: 'done', acc_a_agg_a: 'done', agg_a_core: 'done', core_br: 'active' } },
]

const NS_FRAMES: DcFrame[] = [
  ...NS_BASE,
  { nodes: { ...N0, srv_a: 'done', tor_a: 'done', acc_a: 'done', agg_a: 'done', core: 'done', br: 'active', internet: 'active' },
    links: { ...L0, srv_a_tor_a: 'done', tor_a_acc_a: 'done', acc_a_agg_a: 'done', agg_a_core: 'done', core_br: 'done', br_internet: 'active' } },
]

const PEER_FRAMES: DcFrame[] = [
  ...NS_BASE,
  { nodes: { ...N0, srv_a: 'done', tor_a: 'done', acc_a: 'done', agg_a: 'done', core: 'done', br: 'active', peer_org: 'active' },
    links: { ...L0, srv_a_tor_a: 'done', tor_a_acc_a: 'done', acc_a_agg_a: 'done', agg_a_core: 'done', core_br: 'done', br_peer_org: 'active' } },
]

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title:    'Datacenter networking — from rack to border',
    readTime: '7 min',
    intro:    `Inside a modern datacenter, every server sits at the bottom of a layered switching fabric: NIC → ToR → Access → Aggregation → Core. Traffic between servers (east-west) stays entirely within this fabric. Traffic leaving for the internet or partner networks (north-south) exits via a border router that runs eBGP with external ASNs — including upstream ISPs, directly connected partner organizations, and branch offices over MPLS or IPsec WAN.`,
    scenarios: { ew: 'East-West', ns: 'Internet Egress', peer: 'Direct Peer' } as Record<Scenario, string>,
    nodeLabel: {
      srv_a: 'Server A', tor_a: 'ToR-A', acc_a: 'Access-A', agg_a: 'Agg-A', core: 'Core',
      agg_b: 'Agg-B', acc_b: 'Access-B', tor_b: 'ToR-B', srv_b: 'Server B',
      br: 'Border Router', internet: 'Internet', peer_org: 'Partner Org', branch: 'Branch Office',
    } as Record<NodeId, string>,
    nodeSub: {
      srv_a: '10 GbE NIC', tor_a: 'rack switch', acc_a: 'leaf switch', agg_a: 'agg switch', core: 'spine',
      agg_b: 'agg switch', acc_b: 'leaf switch', tor_b: 'rack switch', srv_b: '10 GbE NIC',
      br: 'BGP edge', internet: 'upstream ISP', peer_org: 'direct BGP', branch: 'MPLS / WAN',
    } as Record<NodeId, string>,
    linkLabel: {
      srv_a_tor_a: '10 GbE', tor_a_acc_a: '25 GbE', acc_a_agg_a: '100 GbE', agg_a_core: '100 GbE',
      core_agg_b: '100 GbE', agg_b_acc_b: '100 GbE', acc_b_tor_b: '25 GbE', tor_b_srv_b: '10 GbE',
      core_br: '100 GbE', br_internet: 'eBGP', br_peer_org: 'eBGP / leased', br_branch: 'MPLS / IPsec',
    } as Record<LinkId, string>,
    frames: {
      ew: [
        { title: 'DC fabric — layered switching hierarchy',
          note: `A datacenter organizes switching across multiple tiers. Each server NIC uplinks to a Top-of-Rack (ToR) switch that serves one rack. Multiple ToRs feed Access (Leaf) switches, which uplink to Aggregation switches, which connect to the Core (Spine). East-west traffic between servers stays entirely within this fabric — never touching the border router. The border router and its external peers (internet, partner orgs, branch offices) are visible in the graph but uninvolved in east-west flows.` },
        { title: 'Server A — NIC egress',
          note: `Server A's NIC places a frame on the wire addressed to Server B's MAC. Because Server B is in a different rack (and likely a different VLAN), the NIC sends to its default gateway — the ToR switch IP. The frame travels the 10 GbE link to ToR-A.` },
        { title: 'ToR-A — rack-level L2 switching',
          note: `The Top-of-Rack switch serves 16–48 servers in one rack. It performs a MAC table lookup for the destination. If the destination is in the same rack, it switches locally. Otherwise it forwards the frame up the 25 GbE uplink to the Access switch.` },
        { title: 'Access (Leaf) — ToR aggregation',
          note: `The Access switch aggregates multiple ToR switches and handles inter-VLAN routing at L3. If both servers are in the same VLAN, the leaf may forward directly. If they are in different VLANs, it performs the L3 routing lookup. Modern leaf switches run BGP with the spines using the Clos fabric model.` },
        { title: 'Aggregation — L3 routing boundary',
          note: `The Aggregation switch is the traditional L3 boundary in a 3-tier design. In modern spine-leaf deployments this layer is often collapsed, with leaf switches talking directly to spines. In classic hierarchical designs, VLANs are extended to the aggregation layer and inter-VLAN routing happens here.` },
        { title: 'Core — IP routing decision (ECMP)',
          note: `The Core (Spine) switches form a full-mesh fabric. Every aggregation switch connects to every spine. The core performs a pure L3 IP routing lookup and ECMP-hashes the flow across equal-cost paths toward the destination aggregation switch. ECMP is per-flow (5-tuple hash) to prevent reordering.` },
        { title: 'Core → Aggregation-B',
          note: `The core forwards the packet down to Aggregation-B on Server B's side. The ECMP decision is sticky per-flow — all packets in this TCP connection follow the same path, preventing out-of-order delivery. The packet now descends the right side of the fabric, mirroring its ascent on the left.` },
        { title: 'Aggregation-B → Access-B',
          note: `Aggregation-B forwards the packet down to the Access switch serving Server B's rack section. The path is fully determined. Latency inside the datacenter fabric at this point is sub-millisecond — typical DC round-trip between servers in the same building is under 300 µs.` },
        { title: 'Access-B → ToR-B → Server B',
          note: `The Access switch forwards to ToR-B, which performs a final MAC table lookup and delivers the frame to Server B's NIC on the 10 GbE downlink. The packet has traversed 8 switching hops without ever contacting the border router or any external network.` },
      ],
      ns: [
        { title: 'North-south traffic — leaving the DC',
          note: `North-south traffic is any flow that crosses the datacenter boundary — a server responding to a public API request, or a server pulling data from an external CDN. This traffic ascends the internal fabric identically to east-west, but at the Core it is forwarded toward the Border Router rather than back down to another server rack.` },
        { title: 'Server A — NIC egress',
          note: `The packet originates on Server A's NIC with a public destination IP. The default gateway points to ToR-A's IP. The frame travels the 10 GbE link to the rack switch, which performs its MAC lookup and passes it up.` },
        { title: 'ToR-A → Access-A',
          note: `ToR-A determines this is not a local destination and forwards the packet up the 25 GbE uplink. The Access switch similarly checks its routing table — the destination is external — and passes the packet upward toward the Aggregation layer.` },
        { title: 'Access-A → Aggregation-A',
          note: `The Aggregation switch checks its routing table. The destination belongs to an external prefix — the default route (0.0.0.0/0) points toward the Core and ultimately the Border Router. The packet is forwarded upward.` },
        { title: 'Aggregation-A → Core',
          note: `The Core performs an IP routing lookup. The destination is not within the datacenter's internal address space. The core's RIB contains a route learned via iBGP (or OSPF redistribution) from the Border Router for this external prefix. The packet is ECMP-forwarded toward the Border Router.` },
        { title: 'Core → Border Router',
          note: `The Border Router is the gateway between the DC fabric and the outside world. It terminates eBGP sessions with upstream ISPs and all directly connected peers. It applies egress routing policy: BGP communities, AS-path prepending, local-pref, MED. If the server uses an RFC 1918 address, NAT happens here before the packet leaves.` },
        { title: 'Border Router → Internet (upstream ISP)',
          note: `The Border Router selects the best BGP path for the destination prefix and forwards the packet out the appropriate ISP uplink. The ISP routes it across the global internet. For return traffic, the source IP (or NAT-translated IP) determines which ISP uplink the response arrives on — making ISP selection and prefix advertisement policy critical for symmetric routing.` },
      ],
      peer: [
        { title: 'North-south — direct peer traffic',
          note: `Some traffic is destined for directly connected peers: a partner organization with a dedicated leased line or IXP port, or a branch office reachable via MPLS WAN or IPsec site-to-site VPN. These peers connect directly to the Border Router alongside the internet uplinks. Traffic follows the same internal fabric path but exits on a different border interface with different routing policy applied.` },
        { title: 'Server A — NIC egress',
          note: `The packet targets a host in a partner organization's address space — for example, a private prefix like 10.200.0.0/16 advertised via eBGP from the partner, or a public prefix owned by the partner. The server sends to its default gateway, ToR-A, which forwards it up the fabric.` },
        { title: 'ToR-A → Access-A',
          note: `ToR-A has no specific host route for the partner prefix — it forwards the packet up the 25 GbE uplink using its default route. The Access switch similarly passes the packet upward, deferring the routing decision to the higher layers.` },
        { title: 'Access-A → Aggregation-A',
          note: `The Aggregation switch checks its routing table. The partner prefix (e.g. 10.200.0.0/16) appears as a more-specific route learned from the Border Router via iBGP or OSPF redistribution — it is preferred over the default route. The packet is forwarded toward the Core.` },
        { title: 'Aggregation-A → Core',
          note: `The Core performs longest-prefix-match. The partner prefix 10.200.0.0/16 matches the route received from the Border Router — more specific than the default. The Core forwards the packet toward the Border Router over the 100 GbE inter-link.` },
        { title: 'Core → Border Router',
          note: `The Border Router receives the packet and checks its BGP RIB. The partner prefix is reachable via the dedicated peering interface — a leased line, an IXP port, an MPLS VPN label, or an IPsec tunnel. Routing policy is applied: traffic engineering, QoS marking, or traffic shaping per peer agreement.` },
        { title: 'Border Router → Partner Org / Branch Office',
          note: `The packet exits on the peer-facing interface. For a partner organization, this is a direct BGP peering session over a leased line or IXP port — no internet transit, lower latency, and predictable bandwidth guaranteed by the peering agreement. For a branch office, the MPLS label stack or IPsec encapsulation carries the packet over the WAN to the remote site's CPE, where it is decapsulated and delivered locally.` },
      ],
    },
    layerTitle:   'DC networking layers',
    layerHeaders: ['Layer', 'Device', 'Role', 'Typical capacity'],
    layers: [
      { layer: 'Server',  device: 'NIC',                  role: 'Endpoint — generates and terminates traffic',            cap: '1 / 10 / 25 GbE' },
      { layer: 'ToR',     device: 'Top-of-Rack switch',   role: 'Rack-level L2 switching, 16–48 servers per rack',       cap: '48× 1/10/25GbE + 4–8× 100GbE uplinks' },
      { layer: 'Access',  device: 'Leaf switch',           role: 'ToR aggregation, inter-VLAN routing, BGP to spine',    cap: '32–64× 10/25/100GbE' },
      { layer: 'Agg',     device: 'Aggregation switch',    role: 'L3 boundary, VLAN extension (classic 3-tier design)',   cap: '32× 100/400GbE' },
      { layer: 'Core',    device: 'Spine switch',          role: 'Pure L3 IP forwarding, full-mesh ECMP fabric',         cap: '32–128× 100/400GbE' },
      { layer: 'Border',  device: 'Edge / border router',  role: 'eBGP with ISPs, partner orgs, branch offices via WAN', cap: '10/100GbE + MPLS/WAN' },
    ],
  },
  ko: {
    title:    '데이터센터 네트워킹 — 랙에서 경계까지',
    readTime: '7분',
    intro:    `현대 데이터센터에서 모든 서버는 계층형 스위칭 패브릭의 하단에 위치합니다: NIC → ToR → Access → Aggregation → Core. 서버 간 트래픽(East-West)은 이 패브릭 안에만 머뭅니다. 인터넷이나 파트너 네트워크로 나가는 트래픽(North-South)은 외부 ASN과 eBGP를 실행하는 Border Router를 통해 나갑니다 — 업스트림 ISP, 직접 연결된 파트너 조직, MPLS 또는 IPsec WAN을 통한 지사 포함.`,
    scenarios: { ew: 'East-West', ns: '인터넷 이그레스', peer: '직접 피어' } as Record<Scenario, string>,
    nodeLabel: {
      srv_a: '서버 A', tor_a: 'ToR-A', acc_a: 'Access-A', agg_a: 'Agg-A', core: 'Core',
      agg_b: 'Agg-B', acc_b: 'Access-B', tor_b: 'ToR-B', srv_b: '서버 B',
      br: '경계 라우터', internet: '인터넷', peer_org: '파트너 조직', branch: '지사',
    } as Record<NodeId, string>,
    nodeSub: {
      srv_a: '10 GbE NIC', tor_a: '랙 스위치', acc_a: '리프 스위치', agg_a: '집계 스위치', core: '스파인',
      agg_b: '집계 스위치', acc_b: '리프 스위치', tor_b: '랙 스위치', srv_b: '10 GbE NIC',
      br: 'BGP 엣지', internet: '업스트림 ISP', peer_org: '직접 BGP', branch: 'MPLS / WAN',
    } as Record<NodeId, string>,
    linkLabel: {
      srv_a_tor_a: '10 GbE', tor_a_acc_a: '25 GbE', acc_a_agg_a: '100 GbE', agg_a_core: '100 GbE',
      core_agg_b: '100 GbE', agg_b_acc_b: '100 GbE', acc_b_tor_b: '25 GbE', tor_b_srv_b: '10 GbE',
      core_br: '100 GbE', br_internet: 'eBGP', br_peer_org: 'eBGP / 전용선', br_branch: 'MPLS / IPsec',
    } as Record<LinkId, string>,
    frames: {
      ew: [
        { title: 'DC 패브릭 — 계층형 스위칭 구조',
          note: `데이터센터는 스위칭을 여러 계층으로 구성합니다. 각 서버 NIC는 하나의 랙을 담당하는 ToR(Top-of-Rack) 스위치로 연결됩니다. 여러 ToR은 Access(Leaf) 스위치로 집계되고, Access는 Aggregation으로, Aggregation은 Core(Spine)로 연결됩니다. East-West 트래픽은 이 패브릭 안에만 머뭅니다 — Border Router나 외부 피어(인터넷, 파트너 조직, 지사)는 그래프에서 보이지만 관여하지 않습니다.` },
        { title: '서버 A — NIC 이그레스',
          note: `서버 A의 NIC가 서버 B의 MAC으로 주소가 지정된 프레임을 전송합니다. 서버 B가 다른 랙(다른 VLAN)에 있으므로 NIC는 기본 게이트웨이인 ToR-A의 IP로 전송합니다. 프레임은 10 GbE 링크를 통해 ToR-A로 이동합니다.` },
        { title: 'ToR-A — 랙 레벨 L2 스위칭',
          note: `ToR 스위치는 하나의 랙에 있는 16~48대의 서버를 서비스합니다. 목적지 MAC 테이블을 조회합니다. 목적지가 같은 랙이면 로컬 스위칭, 아니면 25 GbE 업링크를 통해 Access 스위치로 전달합니다.` },
        { title: 'Access (Leaf) — ToR 집계',
          note: `Access 스위치는 여러 ToR 스위치를 집계하고 L3에서 VLAN 간 라우팅을 처리합니다. 두 서버가 같은 VLAN이면 리프가 직접 전달하고, 다른 VLAN이면 여기서 L3 라우팅을 수행합니다. 현대 리프 스위치는 Clos 패브릭 모델로 스파인과 BGP를 실행합니다.` },
        { title: 'Aggregation — L3 라우팅 경계',
          note: `3-tier 설계에서 Aggregation 스위치는 전통적인 L3 경계입니다. 현대 스파인-리프 배포에서는 이 계층이 통합되어 리프가 스파인과 직접 통신합니다. 고전적인 계층 설계에서는 VLAN이 Aggregation까지 확장되고 VLAN 간 라우팅이 여기서 발생합니다.` },
        { title: 'Core — IP 라우팅 결정 (ECMP)',
          note: `Core(Spine) 스위치는 풀메시 패브릭을 형성합니다. 모든 Aggregation 스위치가 모든 스파인에 연결됩니다. Core는 순수 L3 IP 라우팅 조회를 수행하고 5-튜플 해시로 ECMP 경로를 선택합니다. ECMP는 플로우별로 고정되어 패킷 재정렬을 방지합니다.` },
        { title: 'Core → Aggregation-B',
          note: `Core가 서버 B 측의 Aggregation-B로 패킷을 전달합니다. ECMP 결정은 플로우별로 고정됩니다 — 이 TCP 연결의 모든 패킷이 같은 경로를 따르므로 순서가 보장됩니다. 패킷이 이제 패브릭 오른쪽을 내려가며 왼쪽 상승을 미러링합니다.` },
        { title: 'Aggregation-B → Access-B',
          note: `Aggregation-B가 서버 B 랙 구역의 Access 스위치로 패킷을 전달합니다. 경로가 완전히 결정되었습니다. 이 시점에서 데이터센터 패브릭 내부 지연은 서브밀리초 — 같은 건물의 서버 간 왕복 시간은 일반적으로 300 µs 미만입니다.` },
        { title: 'Access-B → ToR-B → 서버 B',
          note: `Access 스위치가 ToR-B로 전달하고, ToR-B는 최종 MAC 테이블 조회를 수행해 10 GbE 다운링크로 서버 B의 NIC에 프레임을 전달합니다. 패킷은 8번의 스위칭 홉을 거쳤지만 Border Router나 외부 네트워크에는 전혀 접촉하지 않았습니다.` },
      ],
      ns: [
        { title: 'North-South 트래픽 — DC 외부로',
          note: `North-South 트래픽은 데이터센터 경계를 넘는 모든 플로우입니다 — 공개 API 요청에 응답하는 서버, 외부 CDN에서 데이터를 가져오는 서버. 이 트래픽은 내부 패브릭을 East-West와 동일하게 올라가지만, Core에서 다른 서버 랙이 아닌 Border Router로 전달됩니다.` },
        { title: '서버 A — NIC 이그레스',
          note: `패킷이 서버 A의 NIC에서 공인 목적지 IP로 생성됩니다. 기본 게이트웨이가 ToR-A의 IP를 가리킵니다. 프레임이 10 GbE 링크를 통해 랙 스위치로 이동하고, MAC 조회 후 상위로 전달됩니다.` },
        { title: 'ToR-A → Access-A',
          note: `ToR-A가 목적지가 로컬이 아님을 확인하고 25 GbE 업링크로 전달합니다. Access 스위치도 라우팅 테이블을 확인 — 목적지가 외부 — 하고 Aggregation 계층으로 전달합니다.` },
        { title: 'Access-A → Aggregation-A',
          note: `Aggregation 스위치가 라우팅 테이블을 확인합니다. 목적지가 외부 프리픽스에 속합니다 — 기본 경로(0.0.0.0/0)가 Core와 최종적으로 Border Router를 가리킵니다. 패킷이 위쪽으로 전달됩니다.` },
        { title: 'Aggregation-A → Core',
          note: `Core가 IP 라우팅 조회를 수행합니다. 목적지가 DC 내부 주소 공간에 없습니다. Core의 RIB에 Border Router에서 iBGP로 학습한 외부 프리픽스 경로가 있습니다. 패킷이 Border Router 방향으로 ECMP 전달됩니다.` },
        { title: 'Core → Border Router',
          note: `Border Router는 DC 패브릭과 외부 세계 사이의 게이트웨이입니다. 업스트림 ISP 및 직접 연결된 피어와 eBGP 세션을 종료합니다. 이그레스 정책(BGP 커뮤니티, AS-path 선행, local-pref, MED)을 적용합니다. 서버가 RFC 1918 사설 IP를 사용하면 여기서 NAT가 발생합니다.` },
        { title: 'Border Router → 인터넷 (업스트림 ISP)',
          note: `Border Router가 목적지 프리픽스의 최선 BGP 경로를 선택하고 ISP 업링크로 패킷을 전달합니다. ISP가 전 세계 인터넷을 통해 패킷을 라우팅합니다. 반환 트래픽의 경우 소스 IP(또는 NAT 변환 IP)가 어느 ISP 업링크로 응답이 도착할지를 결정합니다 — ISP 선택과 프리픽스 광고 정책이 대칭 라우팅에 중요합니다.` },
      ],
      peer: [
        { title: 'North-South — 직접 피어 트래픽',
          note: `일부 트래픽은 직접 연결된 피어로 향합니다: 전용 임대 회선이나 IXP 포트를 가진 파트너 조직, 또는 MPLS WAN이나 IPsec 사이트 간 VPN으로 연결된 지사. 이 피어들은 인터넷 업링크와 함께 Border Router에 직접 연결됩니다. 트래픽은 동일한 내부 패브릭 경로를 따르지만 다른 경계 인터페이스로 나가며 다른 라우팅 정책이 적용됩니다.` },
        { title: '서버 A — NIC 이그레스',
          note: `패킷이 파트너 조직의 주소 공간(예: 파트너에서 eBGP로 광고한 10.200.0.0/16)의 호스트를 목적지로 합니다. 서버가 기본 게이트웨이 ToR-A로 전송하고, ToR-A가 패브릭 위로 전달합니다.` },
        { title: 'ToR-A → Access-A',
          note: `ToR-A에는 파트너 프리픽스에 대한 특정 경로가 없어 기본 경로를 사용해 25 GbE 업링크로 전달합니다. Access 스위치도 마찬가지로 패킷을 Aggregation 계층으로 전달합니다.` },
        { title: 'Access-A → Aggregation-A',
          note: `Aggregation 스위치가 라우팅 테이블을 확인합니다. 파트너 프리픽스(예: 10.200.0.0/16)가 Border Router에서 iBGP로 학습한 더 구체적인 경로로 존재합니다 — 기본 경로보다 우선합니다. 패킷이 Core 방향으로 전달됩니다.` },
        { title: 'Aggregation-A → Core',
          note: `Core가 최장 프리픽스 매칭을 수행합니다: 파트너 프리픽스가 Border Router에서 받은 경로와 매칭됩니다. Core가 100 GbE 인터링크를 통해 Border Router로 패킷을 전달합니다.` },
        { title: 'Core → Border Router',
          note: `Border Router가 패킷을 수신하고 BGP RIB를 확인합니다. 파트너 프리픽스는 전용 피어링 인터페이스(임대 회선, IXP 포트, MPLS VPN 레이블, 또는 IPsec 터널)를 통해 도달 가능합니다. 라우팅 정책이 적용됩니다: 트래픽 엔지니어링, QoS 마킹, 피어 계약별 트래픽 셰이핑.` },
        { title: 'Border Router → 파트너 조직 / 지사',
          note: `패킷이 피어 인터페이스로 나갑니다. 파트너 조직의 경우 임대 회선이나 IXP 포트를 통한 직접 BGP 피어링 — 인터넷 트랜짓 없이 낮은 지연과 예측 가능한 대역폭을 보장합니다. 지사의 경우 MPLS 레이블 스택이나 IPsec 캡슐화가 WAN을 통해 원격 사이트의 CPE로 패킷을 전달하고, 거기서 역캡슐화 후 로컬 전달됩니다.` },
      ],
    },
    layerTitle:   'DC 네트워킹 계층',
    layerHeaders: ['계층', '장치', '역할', '일반적인 용량'],
    layers: [
      { layer: '서버',  device: 'NIC',              role: '엔드포인트 — 트래픽 생성 및 종료',                  cap: '1 / 10 / 25 GbE' },
      { layer: 'ToR',   device: 'ToR 스위치',        role: '랙 레벨 L2 스위칭, 랙당 16–48대 서버',             cap: '48× 1/10/25GbE + 4–8× 100GbE 업링크' },
      { layer: 'Access', device: '리프 스위치',      role: 'ToR 집계, VLAN 간 라우팅, 스파인에 BGP',           cap: '32–64× 10/25/100GbE' },
      { layer: 'Agg',   device: '집계 스위치',       role: 'L3 경계, VLAN 확장 (고전적 3-tier 설계)',           cap: '32× 100/400GbE' },
      { layer: 'Core',  device: '스파인 스위치',      role: '순수 L3 IP 포워딩, 풀메시 ECMP 패브릭',            cap: '32–128× 100/400GbE' },
      { layer: '경계',  device: '엣지 / 경계 라우터', role: 'ISP, 파트너 조직, 지사와 eBGP 피어링',             cap: '10/100GbE + MPLS/WAN' },
    ],
  },
}

// ── Graph ──────────────────────────────────────────────────────────────────────

function DcGraph({ frame, t }: { frame: DcFrame; t: typeof T['en'] }) {
  return (
    <div className="dc-graph-canvas">
      <svg viewBox={`0 0 ${W} ${H}`} className="dc-graph-svg" preserveAspectRatio="none">
        <defs>
          {LINKS.map(({ id }) => (
            <path key={id} id={`dcp-${id}`} d={LINK_PATHS[id]} fill="none" />
          ))}
        </defs>

        {LINKS.map(({ id, from, to }) => {
          const [x1, y1] = NODE_PX[from]
          const [x2, y2] = NODE_PX[to]
          const st = frame.links[id]
          return (
            <line key={id} x1={x1} y1={y1} x2={x2} y2={y2}
              className={`dc-sline dc-sline-${st}`} strokeWidth="2" />
          )
        })}

        {LINKS.map(({ id }) => {
          if (frame.links[id] !== 'active') return null
          return (
            <circle key={`dot-${id}`} r="5" className="dc-gdot">
              <animateMotion dur="1.0s" repeatCount="indefinite">
                <mpath href={`#dcp-${id}`} />
              </animateMotion>
            </circle>
          )
        })}
      </svg>

      {LINKS.map(({ id, from, to }) => {
        const [x1, y1] = NODE_PX[from]
        const [x2, y2] = NODE_PX[to]
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        const dx = x2 - x1, dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const ox = (-dy / len) * 13
        const oy = ( dx / len) * 13
        const st = frame.links[id]
        return (
          <span key={`lbl-${id}`}
            className={`graph-linklabel${st !== 'idle' ? ' graph-linklabel-on' : ''}`}
            style={{ left: `${((mx + ox) / W) * 100}%`, top: `${((my + oy) / H) * 100}%` }}
          >
            {t.linkLabel[id]}
          </span>
        )
      })}

      {NODE_IDS.map(nid => {
        const [px, py] = NODE_PX[nid]
        const st = frame.nodes[nid]
        return (
          <div key={nid}
            className={`dc-gnode dc-gnode-${st}`}
            style={{ left: `${(px / W) * 100}%`, top: `${(py / H) * 100}%` }}
          >
            <span className="dc-gnode-label">{t.nodeLabel[nid]}</span>
            <span className="dc-gnode-sub">{t.nodeSub[nid]}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Explorer ───────────────────────────────────────────────────────────────────

const FRAMES_MAP: Record<Scenario, DcFrame[]> = {
  ew:   EW_FRAMES,
  ns:   NS_FRAMES,
  peer: PEER_FRAMES,
}

function DcExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const [scenario, setScenario] = useState<Scenario>('ew')
  const [step, setStep]         = useState(0)
  const [playing, setPlaying]   = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const frames = FRAMES_MAP[scenario]
  const total  = frames.length
  const isLast = step >= total - 1

  useEffect(() => {
    if (!playing) return
    if (isLast) { setPlaying(false); return }
    timerRef.current = setTimeout(() => setStep(s => s + 1), 1300)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [playing, step, isLast])

  function handleScenario(s: Scenario) {
    setPlaying(false)
    setScenario(s)
    setStep(0)
  }
  function reset()    { setPlaying(false); setStep(0) }
  function stepFwd()  { if (!isLast) setStep(s => s + 1) }
  function handlePlay() {
    if (isLast) { reset(); setTimeout(() => setPlaying(true), 50); return }
    setPlaying(p => !p)
  }

  const frame = frames[step]
  const ft    = t.frames[scenario][step]
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
      <div className="dc-scenario-tabs">
        {(['ew', 'ns', 'peer'] as const).map(s => (
          <button
            key={s}
            className={`dc-scenario-tab${scenario === s ? ' dc-scenario-tab-active' : ''}`}
            onClick={() => handleScenario(s)}
          >
            {t.scenarios[s]}
          </button>
        ))}
      </div>
      <DcGraph frame={frame} t={t} />
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

// ── Layer table ────────────────────────────────────────────────────────────────

function LayerTable() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <div className="ov-proto-section">
      <div className="bgp2-section-title">{t.layerTitle}</div>
      <table className="ov-proto-table dc-layer-table">
        <thead>
          <tr>{t.layerHeaders.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.layers.map(r => (
            <tr key={r.layer}>
              <td><code>{r.layer}</code></td>
              <td>{r.device}</td>
              <td>{r.role}</td>
              <td><code className="dc-cap-code">{r.cap}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DcPage() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-07-24"
      readTime={t.readTime}
      tags={['networking', 'datacenter', 'infrastructure', 'switching', 'bgp']}
      intro={t.intro}
    >
      <DcExplorer />
      <LayerTable />
    </NoteLayout>
  )
}
