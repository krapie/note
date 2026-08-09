import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type NodeId     = 'host_a' | 'host_c' | 'sw_a' | 'router' | 'sw_b' | 'host_b'
type NodeStatus = 'idle' | 'active' | 'done'
type LinkId     = 'ha_swa' | 'hc_swa' | 'swa_rtr' | 'rtr_swb' | 'swb_hb'
type LinkStatus = 'idle' | 'active' | 'done'
type Scenario   = 'l2' | 'l3'

interface FwdFrame {
  nodes:  Record<NodeId, NodeStatus>
  links:  Record<LinkId, LinkStatus>
  header: string   // monospace packet header to show in detail panel
}

// ── Graph geometry ─────────────────────────────────────────────────────────────

const W = 580
const H = 280

const NODE_PX: Record<NodeId, [number, number]> = {
  host_a: [ 55,  78],
  host_c: [ 55, 210],
  sw_a:   [190, 144],
  router: [330,  68],
  sw_b:   [455, 144],
  host_b: [540, 218],
}

const NODE_IDS: NodeId[] = ['host_a', 'host_c', 'sw_a', 'router', 'sw_b', 'host_b']

const LINKS: Array<{ id: LinkId; from: NodeId; to: NodeId }> = [
  { id: 'ha_swa',  from: 'host_a', to: 'sw_a'   },
  { id: 'hc_swa',  from: 'host_c', to: 'sw_a'   },
  { id: 'swa_rtr', from: 'sw_a',   to: 'router'  },
  { id: 'rtr_swb', from: 'router', to: 'sw_b'    },
  { id: 'swb_hb',  from: 'sw_b',   to: 'host_b'  },
]

const LINK_PATHS: Record<LinkId, string> = {
  ha_swa:  `M ${NODE_PX.host_a[0]} ${NODE_PX.host_a[1]} L ${NODE_PX.sw_a[0]}   ${NODE_PX.sw_a[1]}`,
  hc_swa:  `M ${NODE_PX.host_c[0]} ${NODE_PX.host_c[1]} L ${NODE_PX.sw_a[0]}   ${NODE_PX.sw_a[1]}`,
  swa_rtr: `M ${NODE_PX.sw_a[0]}   ${NODE_PX.sw_a[1]}   L ${NODE_PX.router[0]} ${NODE_PX.router[1]}`,
  rtr_swb: `M ${NODE_PX.router[0]} ${NODE_PX.router[1]} L ${NODE_PX.sw_b[0]}   ${NODE_PX.sw_b[1]}`,
  swb_hb:  `M ${NODE_PX.sw_b[0]}   ${NODE_PX.sw_b[1]}   L ${NODE_PX.host_b[0]} ${NODE_PX.host_b[1]}`,
}

// ── Frame data ─────────────────────────────────────────────────────────────────

const N0: Record<NodeId, NodeStatus> = {
  host_a: 'idle', host_c: 'idle', sw_a: 'idle',
  router: 'idle', sw_b: 'idle', host_b: 'idle',
}
const L0: Record<LinkId, LinkStatus> = {
  ha_swa: 'idle', hc_swa: 'idle', swa_rtr: 'idle', rtr_swb: 'idle', swb_hb: 'idle',
}

// L2 scenario: Host A → Host C (same subnet 10.0.1.0/24)
const L2_FRAMES: FwdFrame[] = [
  // 0: overview
  {
    nodes:  N0,
    links:  L0,
    header: '',
  },
  // 1: subnet check
  {
    nodes:  { ...N0, host_a: 'active' },
    links:  L0,
    header: 'src  10.0.1.10 / 24\ndst  10.0.1.20 / 24\n─────────────────────\nSame subnet → no router needed\nForward at Layer 2 directly',
  },
  // 2: ARP broadcast (A floods Switch A)
  {
    nodes:  { ...N0, host_a: 'active', sw_a: 'active' },
    links:  { ...L0, ha_swa: 'active' },
    header: 'ARP Request  (broadcast)\n─────────────────────\nEth  dst: ff:ff:ff:ff:ff:ff\n     src: aa:bb:cc:00:00:01\n\n"Who has 10.0.1.20? Tell 10.0.1.10"',
  },
  // 3: Switch A floods to Host C
  {
    nodes:  { ...N0, host_a: 'active', sw_a: 'active', host_c: 'active' },
    links:  { ...L0, ha_swa: 'active', hc_swa: 'active' },
    header: 'ARP Request  (flooded)\n─────────────────────\nSwitch A: dst MAC unknown\n→ flood to all ports\n\nHost C sees request, prepares reply',
  },
  // 4: ARP reply — Host C → Switch A → Host A
  {
    nodes:  { ...N0, host_c: 'active', sw_a: 'active', host_a: 'active' },
    links:  { ...L0, hc_swa: 'active', ha_swa: 'active' },
    header: 'ARP Reply  (unicast)\n─────────────────────\nEth  dst: aa:bb:cc:00:00:01\n     src: aa:bb:cc:00:00:03\n\n"10.0.1.20 is at aa:bb:cc:00:00:03"\n\nSwitch A learns C\'s MAC ← port 2',
  },
  // 5: unicast Ethernet frame A → C
  {
    nodes:  { ...N0, host_a: 'active', sw_a: 'active', host_c: 'active' },
    links:  { ...L0, ha_swa: 'active', hc_swa: 'active' },
    header: 'Ethernet frame  (unicast)\n─────────────────────\nEth  dst: aa:bb:cc:00:00:03  ← C\n     src: aa:bb:cc:00:00:01  ← A\nIP   dst: 10.0.1.20\n     src: 10.0.1.10\n\nSwitch A: MAC table hit → port 2',
  },
]

// L3 scenario: Host A → Host B (10.0.1.10 → 10.0.2.10)
const L3_FRAMES: FwdFrame[] = [
  // 0: overview
  {
    nodes:  N0,
    links:  L0,
    header: '',
  },
  // 1: subnet check
  {
    nodes:  { ...N0, host_a: 'active' },
    links:  L0,
    header: 'src  10.0.1.10 / 24\ndst  10.0.2.10 / 24\n─────────────────────\nDifferent subnet\n→ send to default gateway\n→ 10.0.1.1 (router)',
  },
  // 2: ARP for gateway
  {
    nodes:  { ...N0, host_a: 'active', sw_a: 'active', router: 'active' },
    links:  { ...L0, ha_swa: 'active', swa_rtr: 'active' },
    header: 'ARP Request  (broadcast)\n─────────────────────\nEth  dst: ff:ff:ff:ff:ff:ff\n     src: aa:bb:cc:00:00:01\n\n"Who has 10.0.1.1? Tell 10.0.1.10"\n\nRouter replies with its MAC',
  },
  // 3: frame built with gateway MAC
  {
    nodes:  { ...N0, host_a: 'active', sw_a: 'active' },
    links:  { ...L0, ha_swa: 'active' },
    header: 'Ethernet frame built\n─────────────────────\nEth  dst: aa:bb:cc:00:00:ff  ← GW\n     src: aa:bb:cc:00:00:01  ← A\nIP   dst: 10.0.2.10          ← B (unchanged)\n     src: 10.0.1.10          ← A (unchanged)\n     TTL: 64',
  },
  // 4: frame reaches router (L2 consumed)
  {
    nodes:  { ...N0, host_a: 'done', sw_a: 'done', router: 'active' },
    links:  { ...L0, ha_swa: 'done', swa_rtr: 'active' },
    header: 'Router receives frame\n─────────────────────\nEth  dst: aa:bb:cc:00:00:ff  ✓ my MAC\n     → L2 header CONSUMED\n\nIP   dst: 10.0.2.10\n     src: 10.0.1.10\n     TTL: 64 → 63  (decremented)\n\nLookup: 10.0.2.0/24 → out eth1',
  },
  // 5: router rewrites L2 header
  {
    nodes:  { ...N0, router: 'active', sw_b: 'active' },
    links:  { ...L0, swa_rtr: 'done', rtr_swb: 'active' },
    header: 'L2 header REWRITTEN\n─────────────────────\nEth  dst: aa:bb:cc:00:00:02  ← B\n     src: aa:bb:cc:00:00:fe  ← Router\nIP   dst: 10.0.2.10          ← unchanged\n     src: 10.0.1.10          ← unchanged\n     TTL: 63\n\nIP header travels end-to-end intact',
  },
  // 6: arrives at Host B
  {
    nodes:  { ...N0, router: 'done', sw_b: 'done', host_b: 'active' },
    links:  { ...L0, swa_rtr: 'done', rtr_swb: 'done', swb_hb: 'active' },
    header: 'Host B receives\n─────────────────────\nEth  dst: aa:bb:cc:00:00:02  ✓ my MAC\nIP   dst: 10.0.2.10          ✓ my IP\n     src: 10.0.1.10\n     TTL: 63\n\nL2 carried it hop-by-hop\nL3 carried it end-to-end',
  },
]

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title:    'L2 vs L3 — how packets actually move',
    readTime: '5 min',
    intro:    `Every packet travels two parallel address spaces simultaneously. The IP header (Layer 3) carries the source and destination that persist from origin to final destination — your laptop's IP and the server's IP, unchanged across every router. The Ethernet header (Layer 2) carries MAC addresses that live only for a single link: every router strips it off and writes a brand-new one for the next hop. Understanding that distinction explains ARP, default gateways, routing tables, and why "routing" and "switching" are fundamentally different operations.`,
    scenarios: {
      l2: 'L2 — same subnet',
      l3: 'L3 — cross subnet',
    },
    nodeLabel: {
      host_a: 'Host A',
      host_c: 'Host C',
      sw_a:   'Switch A',
      router: 'Router',
      sw_b:   'Switch B',
      host_b: 'Host B',
    } as Record<NodeId, string>,
    nodeSub: {
      host_a: '10.0.1.10',
      host_c: '10.0.1.20',
      sw_a:   'L2',
      router: 'GW .1.1/.2.1',
      sw_b:   'L2',
      host_b: '10.0.2.10',
    } as Record<NodeId, string>,
    linkLabel: {
      ha_swa:  'eth0',
      hc_swa:  'eth0',
      swa_rtr: 'uplink',
      rtr_swb: 'eth1',
      swb_hb:  'eth0',
    } as Record<LinkId, string>,
    subnetA: '10.0.1.0/24',
    subnetB: '10.0.2.0/24',
    headerLabel: 'Packet headers',
    emptyHeader: 'Start stepping to see headers',
    frames: {
      l2: [
        { title: 'Two hosts, one switch, one subnet',
          note:  'Host A (10.0.1.10) wants to reach Host C (10.0.1.20). Both are in subnet 10.0.1.0/24. A switch sits between them. The router is not in this picture — Layer 2 forwarding is purely MAC-based and keeps traffic local to the segment.' },
        { title: 'Subnet check — same /24, no router needed',
          note:  'Before sending, Host A ANDs both addresses with the /24 mask. Both map to 10.0.1.0 — same network. Host A knows it can deliver the frame directly to Host C without going through the default gateway. But it needs Host C\'s MAC address first.' },
        { title: 'ARP broadcast — "Who has 10.0.1.20?"',
          note:  'Host A has no ARP cache entry for 10.0.1.20. It sends an ARP Request as a broadcast: Ethernet dst ff:ff:ff:ff:ff:ff, visible to every device on the segment. The payload asks "Who has 10.0.1.20? Tell 10.0.1.10 (aa:bb:cc:00:00:01)".' },
        { title: 'Switch floods — unknown destination MAC',
          note:  'Switch A receives the broadcast frame. Its MAC address table has no entry for ff:ff:ff:ff:ff:ff (by definition — broadcast is always flooded). Switch A sends the frame out every port except the one it arrived on. Host C receives it.' },
        { title: 'ARP reply — Host C replies, switch learns',
          note:  'Host C recognizes its IP in the ARP Request and sends a unicast ARP Reply back to aa:bb:cc:00:00:01 (Host A). Switch A, on receiving the reply from Host C\'s port, learns: "aa:bb:cc:00:00:03 is on port 2" and adds it to the MAC table.' },
        { title: 'Unicast frame — MAC table hit, single port',
          note:  'Host A now has Host C\'s MAC and sends the data frame directly: Ethernet dst aa:bb:cc:00:00:03. Switch A looks up the table, finds "port 2", and forwards only to that port — no flooding. The router is never involved. L2 forwarding is complete.' },
      ],
      l3: [
        { title: 'Two hosts, two subnets, one router',
          note:  'Host A (10.0.1.10) wants to reach Host B (10.0.2.10). They are on different subnets separated by a router. The router has one interface in each subnet: 10.0.1.1 (eth0) and 10.0.2.1 (eth1). Every cross-subnet packet must pass through it.' },
        { title: 'Subnet check — different /24, router required',
          note:  'Host A ANDs both IPs with /24: 10.0.1.0 vs 10.0.2.0 — different networks. Host A cannot deliver directly; it must send the packet to its default gateway (10.0.1.1). But to build the Ethernet frame, it needs the gateway\'s MAC address.' },
        { title: 'ARP for the gateway MAC',
          note:  'Host A broadcasts an ARP Request: "Who has 10.0.1.1?" The router\'s eth0 interface sees its own IP, replies with its MAC (aa:bb:cc:00:00:ff). Host A caches this. Now it can build the Ethernet frame with the correct dst MAC.' },
        { title: 'Frame built — L2 dst = GW MAC, L3 dst = Host B IP',
          note:  'Host A builds the frame: Ethernet dst points to the router\'s MAC, IP dst points to Host B\'s IP. This is the fundamental split — L2 addresses the next hop (the gateway), L3 addresses the ultimate destination. They serve different scopes simultaneously.' },
        { title: 'Frame arrives at router — L2 header consumed',
          note:  'The frame crosses Switch A and arrives at the router\'s eth0. The router checks Ethernet dst — it matches its own MAC, so it strips the L2 header entirely. It reads the IP header: dst 10.0.2.10, TTL 64. It decrements TTL to 63 and looks up 10.0.2.0/24 in its routing table → out eth1.' },
        { title: 'Router rewrites L2 — same IP packet, new Ethernet frame',
          note:  'The router builds a new Ethernet frame for the next link: dst = Host B\'s MAC (learned via ARP on 10.0.2.0/24), src = its own eth1 MAC. The IP packet inside is the same — same src/dst IP, TTL is now 63. The L2 envelope is brand new. This is the core of hop-by-hop routing.' },
        { title: 'Host B receives — L3 identical from start to finish',
          note:  'Switch B forwards the frame to Host B. Host B checks Ethernet dst — its own MAC. Checks IP dst — its own IP. The IP header shows src 10.0.1.10: Host A\'s address, exactly as Host A sent it. L2 changed twice (once per link). L3 never changed at all.' },
      ],
    },
    tableTitle:   'L2 vs L3 at a glance',
    tableHeaders: ['', 'Layer 2 (Ethernet)', 'Layer 3 (IP)'],
    tableRows: [
      ['Address type', 'MAC (48-bit)', 'IP (32/128-bit)'],
      ['Scope',        'Link-local — one hop', 'End-to-end — source to destination'],
      ['Rewritten?',   'Every hop by router', 'Never — persists across all hops'],
      ['Forwarding',   'MAC address table (switch)', 'Routing table (router)'],
      ['Broadcast',    'ff:ff:ff:ff:ff:ff (ARP)', 'Limited (255.255.255.255)'],
      ['Protocol',     'Ethernet / 802.11', 'IPv4 / IPv6'],
    ],
    arpTitle:   'ARP — bridging L3 to L2',
    arpHeaders: ['Step', 'Direction', 'Payload'],
    arpRows: [
      ['Request', 'Broadcast → all hosts on segment', '"Who has 10.0.1.1? Tell 10.0.1.10 (aa:bb:cc:00:00:01)"'],
      ['Reply',   'Unicast → requester only',          '"10.0.1.1 is at aa:bb:cc:00:00:ff" (cached for ARP TTL)'],
      ['Gratuitous', 'Broadcast → update all caches', 'Sent on IP change or NIC up — no request required'],
    ],
  },
  ko: {
    title:    'L2 vs L3 — 패킷이 실제로 이동하는 방법',
    readTime: '5분',
    intro:    `모든 패킷은 두 개의 주소 공간을 동시에 이동합니다. IP 헤더(Layer 3)는 출발지에서 최종 목적지까지 변하지 않는 주소를 담습니다. 내 노트북의 IP와 서버의 IP — 라우터를 몇 개 거치든 그대로입니다. 이더넷 헤더(Layer 2)는 단 하나의 링크에서만 유효한 MAC 주소를 담으며, 라우터마다 헤더 전체를 벗겨내고 다음 홉을 위한 새 헤더를 씁니다. 이 차이를 이해하면 ARP, 기본 게이트웨이, 라우팅 테이블, 그리고 '라우팅'과 '스위칭'이 근본적으로 다른 이유를 자연스럽게 알 수 있습니다.`,
    scenarios: {
      l2: 'L2 — 같은 서브넷',
      l3: 'L3 — 다른 서브넷',
    },
    nodeLabel: {
      host_a: 'Host A',
      host_c: 'Host C',
      sw_a:   'Switch A',
      router: '라우터',
      sw_b:   'Switch B',
      host_b: 'Host B',
    } as Record<NodeId, string>,
    nodeSub: {
      host_a: '10.0.1.10',
      host_c: '10.0.1.20',
      sw_a:   'L2',
      router: 'GW .1.1/.2.1',
      sw_b:   'L2',
      host_b: '10.0.2.10',
    } as Record<NodeId, string>,
    linkLabel: {
      ha_swa:  'eth0',
      hc_swa:  'eth0',
      swa_rtr: 'uplink',
      rtr_swb: 'eth1',
      swb_hb:  'eth0',
    } as Record<LinkId, string>,
    subnetA: '10.0.1.0/24',
    subnetB: '10.0.2.0/24',
    headerLabel: '패킷 헤더',
    emptyHeader: '스텝을 진행하면 헤더가 표시됩니다',
    frames: {
      l2: [
        { title: '두 호스트, 스위치 하나, 서브넷 하나',
          note:  'Host A(10.0.1.10)가 Host C(10.0.1.20)에 도달하려 합니다. 둘 다 10.0.1.0/24 서브넷에 속합니다. 중간에 스위치가 있습니다. 라우터는 이 그림에 등장하지 않습니다 — Layer 2 포워딩은 순수하게 MAC 기반으로 동일 세그먼트 내에서 이루어집니다.' },
        { title: '서브넷 체크 — 같은 /24, 라우터 불필요',
          note:  '전송 전 Host A는 두 IP를 /24 마스크와 AND 연산합니다. 둘 다 10.0.1.0이 됩니다 — 같은 네트워크. Host A는 기본 게이트웨이를 거치지 않고 Host C에 직접 전달할 수 있음을 압니다. 하지만 Host C의 MAC 주소가 필요합니다.' },
        { title: 'ARP 브로드캐스트 — "10.0.1.20이 누구냐?"',
          note:  'Host A의 ARP 캐시에 10.0.1.20에 대한 항목이 없습니다. 브로드캐스트로 ARP 요청을 보냅니다: 이더넷 dst ff:ff:ff:ff:ff:ff, 세그먼트의 모든 장치가 볼 수 있습니다. 페이로드에는 "10.0.1.20이 누구냐? 10.0.1.10(aa:bb:cc:00:00:01)에게 알려라"라고 적혀 있습니다.' },
        { title: 'Switch A 플러드 — 목적지 MAC 불명',
          note:  'Switch A가 브로드캐스트 프레임을 수신합니다. MAC 주소 테이블에 ff:ff:ff:ff:ff:ff에 대한 항목이 없습니다 (브로드캐스트는 항상 플러드됩니다). Switch A는 도착한 포트를 제외한 모든 포트로 프레임을 전송합니다. Host C가 이를 수신합니다.' },
        { title: 'ARP 응답 — Host C가 응답, 스위치가 MAC 학습',
          note:  'Host C는 ARP 요청에서 자신의 IP를 확인하고 Host A(aa:bb:cc:00:00:01)에게 유니캐스트로 ARP 응답을 보냅니다. Switch A는 Host C 포트에서 응답을 수신하며 "aa:bb:cc:00:00:03 → 포트 2"를 MAC 테이블에 추가합니다.' },
        { title: '유니캐스트 프레임 — MAC 테이블 히트, 단일 포트',
          note:  'Host A는 이제 Host C의 MAC을 알고 데이터 프레임을 직접 전송합니다: 이더넷 dst aa:bb:cc:00:00:03. Switch A가 테이블을 조회하여 "포트 2"를 찾고 해당 포트로만 전달합니다 — 플러드 없음. 라우터는 전혀 관여하지 않습니다. L2 포워딩이 완료됐습니다.' },
      ],
      l3: [
        { title: '두 호스트, 두 서브넷, 라우터 하나',
          note:  'Host A(10.0.1.10)가 Host B(10.0.2.10)에 도달하려 합니다. 두 호스트는 라우터로 분리된 서로 다른 서브넷에 있습니다. 라우터는 각 서브넷에 하나씩 인터페이스를 가집니다: 10.0.1.1(eth0)과 10.0.2.1(eth1). 서브넷을 넘는 모든 패킷은 반드시 라우터를 통과해야 합니다.' },
        { title: '서브넷 체크 — 다른 /24, 라우터 필요',
          note:  'Host A가 두 IP를 /24 마스크와 AND 연산합니다: 10.0.1.0 vs 10.0.2.0 — 다른 네트워크. Host A는 직접 전달할 수 없으므로 기본 게이트웨이(10.0.1.1)로 패킷을 전송해야 합니다. 그런데 이더넷 프레임을 만들려면 게이트웨이의 MAC 주소가 필요합니다.' },
        { title: '게이트웨이 MAC을 위한 ARP',
          note:  'Host A가 ARP 요청을 브로드캐스트합니다: "10.0.1.1이 누구냐?" 라우터의 eth0 인터페이스가 자신의 IP를 확인하고 MAC(aa:bb:cc:00:00:ff)으로 응답합니다. Host A가 이를 캐시합니다. 이제 올바른 dst MAC으로 이더넷 프레임을 만들 수 있습니다.' },
        { title: '프레임 생성 — L2 dst = GW MAC, L3 dst = Host B IP',
          note:  'Host A가 프레임을 만듭니다: 이더넷 dst는 라우터의 MAC을 가리키고, IP dst는 Host B의 IP를 가리킵니다. 이것이 핵심 분리입니다 — L2는 다음 홉(게이트웨이)을 주소로 지정하고, L3는 최종 목적지를 주소로 지정합니다. 두 레이어가 서로 다른 범위에서 동시에 역할을 합니다.' },
        { title: '라우터 도착 — L2 헤더 소비됨',
          note:  '프레임이 Switch A를 거쳐 라우터의 eth0에 도착합니다. 라우터가 이더넷 dst를 확인합니다 — 자신의 MAC과 일치하므로 L2 헤더를 완전히 제거합니다. IP 헤더를 읽습니다: dst 10.0.2.10, TTL 64. TTL을 63으로 줄이고 라우팅 테이블에서 10.0.2.0/24를 조회합니다 → eth1로 출력.' },
        { title: 'L2 헤더 재작성 — 동일한 IP 패킷, 새 이더넷 프레임',
          note:  '라우터가 다음 링크를 위한 새 이더넷 프레임을 만듭니다: dst = Host B의 MAC(10.0.2.0/24에서 ARP로 학습), src = 자신의 eth1 MAC. 내부의 IP 패킷은 동일합니다 — 같은 src/dst IP, TTL만 63으로 바뀌었습니다. L2 봉투는 완전히 새것입니다. 이것이 홉 바이 홉 라우팅의 핵심입니다.' },
        { title: 'Host B 수신 — L3는 처음부터 끝까지 동일',
          note:  'Switch B가 프레임을 Host B로 전달합니다. Host B가 이더넷 dst를 확인합니다 — 자신의 MAC. IP dst를 확인합니다 — 자신의 IP. IP 헤더에는 src 10.0.1.10이 적혀 있습니다: Host A가 처음 보낸 그대로입니다. L2는 링크마다 두 번 바뀌었습니다. L3는 단 한 번도 바뀌지 않았습니다.' },
      ],
    },
    tableTitle:   'L2 vs L3 비교',
    tableHeaders: ['', 'Layer 2 (이더넷)', 'Layer 3 (IP)'],
    tableRows: [
      ['주소 유형', 'MAC (48비트)', 'IP (32/128비트)'],
      ['범위',      'Link-local — 단일 홉', '종단간 — 출발지에서 목적지까지'],
      ['재작성?',   '라우터마다 매 홉 재작성', '불변 — 모든 홉을 거쳐도 유지'],
      ['포워딩',    'MAC 주소 테이블 (스위치)', '라우팅 테이블 (라우터)'],
      ['브로드캐스트', 'ff:ff:ff:ff:ff:ff (ARP)', '제한적 (255.255.255.255)'],
      ['프로토콜',  'Ethernet / 802.11', 'IPv4 / IPv6'],
    ],
    arpTitle:   'ARP — L3와 L2를 연결하는 다리',
    arpHeaders: ['단계', '방향', '페이로드'],
    arpRows: [
      ['요청(Request)', '브로드캐스트 → 세그먼트 전체', '"10.0.1.1이 누구냐? 10.0.1.10(aa:bb:cc:00:00:01)에게 알려라"'],
      ['응답(Reply)',   '유니캐스트 → 요청자만',         '"10.0.1.1의 MAC은 aa:bb:cc:00:00:ff" (ARP TTL 동안 캐시됨)'],
      ['Gratuitous',   '브로드캐스트 → 전체 캐시 갱신', 'IP 변경 또는 NIC 활성화 시 전송 — 요청 없이 선제적으로'],
    ],
  },
}

// ── Graph ──────────────────────────────────────────────────────────────────────

function FwdGraph({
  frame,
  t,
  scenario,
}: {
  frame: FwdFrame
  t: typeof T['en']
  scenario: Scenario
}) {
  return (
    <div className="fwd-graph-canvas">
      {/* Subnet background labels */}
      <span className="fwd-subnet-tag fwd-subnet-a">{t.subnetA}</span>
      <span className="fwd-subnet-tag fwd-subnet-b">{t.subnetB}</span>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="fwd-graph-svg"
        preserveAspectRatio="none"
      >
        <defs>
          {LINKS.map(({ id }) => (
            <path key={id} id={`fwdp-${id}`} d={LINK_PATHS[id]} fill="none" />
          ))}
        </defs>

        {/* Subnet divider line */}
        <line
          x1={NODE_PX.sw_a[0] + 60} y1={10}
          x2={NODE_PX.sw_a[0] + 60} y2={H - 10}
          stroke="var(--kp-border-faint)" strokeWidth="1" strokeDasharray="4 4"
        />

        {/* Link lines */}
        {LINKS.map(({ id, from, to }) => {
          const [x1, y1] = NODE_PX[from]
          const [x2, y2] = NODE_PX[to]
          const st = frame.links[id]
          // In L2 scenario, dim the cross-subnet links
          const irrelevant = scenario === 'l2' && (id === 'swa_rtr' || id === 'rtr_swb' || id === 'swb_hb')
          return (
            <line
              key={id}
              x1={x1} y1={y1} x2={x2} y2={y2}
              className={`fwd-sline fwd-sline-${irrelevant ? 'faint' : st}`}
              strokeWidth="2"
            />
          )
        })}

        {/* Animated dots */}
        {LINKS.map(({ id }) => {
          const st = frame.links[id]
          if (st !== 'active') return null
          return (
            <circle key={`dot-${id}`} r="5" className="fwd-gdot">
              <animateMotion dur="1.0s" repeatCount="indefinite">
                <mpath href={`#fwdp-${id}`} />
              </animateMotion>
            </circle>
          )
        })}
      </svg>

      {/* Link labels */}
      {LINKS.map(({ id, from, to }) => {
        if (frame.links[id] !== 'active') return null
        const [x1, y1] = NODE_PX[from]
        const [x2, y2] = NODE_PX[to]
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        const dx = x2 - x1, dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const ox = (-dy / len) * 14
        const oy = ( dx / len) * 14
        return (
          <span
            key={`lbl-${id}`}
            className="graph-linklabel graph-linklabel-on"
            style={{
              left: `${((mx + ox) / W) * 100}%`,
              top:  `${((my + oy) / H) * 100}%`,
            }}
          >
            {t.linkLabel[id]}
          </span>
        )
      })}

      {/* Node boxes */}
      {NODE_IDS.map(nid => {
        const [px, py] = NODE_PX[nid]
        const st = frame.nodes[nid]
        const irrelevant =
          scenario === 'l2' && (nid === 'router' || nid === 'sw_b' || nid === 'host_b')
        return (
          <div
            key={nid}
            className={`fwd-gnode fwd-gnode-${irrelevant ? 'faint' : st}`}
            style={{
              left: `${(px / W) * 100}%`,
              top:  `${(py / H) * 100}%`,
            }}
          >
            <span className="fwd-gnode-label">{t.nodeLabel[nid]}</span>
            <span className="fwd-gnode-sub">{t.nodeSub[nid]}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Explorer ───────────────────────────────────────────────────────────────────

const FRAMES_MAP: Record<Scenario, FwdFrame[]> = { l2: L2_FRAMES, l3: L3_FRAMES }

function FwdExplorer() {
  const { lang } = useLang()
  const t = T[lang]

  const [scenario, setScenario] = useState<Scenario>('l2')
  const [step, setStep]         = useState(0)
  const [playing, setPlaying]   = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const frames  = FRAMES_MAP[scenario]
  const total   = frames.length
  const isLast  = step >= total - 1
  const frame   = frames[step]
  const frameTxt = t.frames[scenario][step]

  useEffect(() => {
    if (!playing) return
    if (isLast) { setPlaying(false); return }
    timerRef.current = setTimeout(() => setStep(s => s + 1), 1400)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [playing, step, isLast])

  function handleScenario(s: Scenario) {
    setPlaying(false); setScenario(s); setStep(0)
  }
  function reset() { setPlaying(false); setStep(0) }
  function stepFwd() { if (!isLast) setStep(s => s + 1) }
  function handlePlay() {
    if (isLast) { reset(); setTimeout(() => setPlaying(true), 50); return }
    setPlaying(p => !p)
  }

  const lbl = {
    reset:  lang === 'ko' ? '초기화'   : 'Reset',
    play:   lang === 'ko' ? '재생'     : 'Play',
    pause:  lang === 'ko' ? '일시정지' : 'Pause',
    resume: lang === 'ko' ? '계속'     : 'Resume',
    replay: lang === 'ko' ? '다시 보기': 'Replay',
    step:   lang === 'ko' ? '다음 →'  : 'Step →',
  }

  return (
    <div className="inet-root">
      {/* Scenario tabs */}
      <div className="dc-scenario-tabs" style={{ marginBottom: 'var(--kp-space-4)' }}>
        {(['l2', 'l3'] as Scenario[]).map(s => (
          <button
            key={s}
            className={`dc-scenario-tab${scenario === s ? ' dc-scenario-tab-active' : ''}`}
            onClick={() => handleScenario(s)}
          >
            {t.scenarios[s]}
          </button>
        ))}
      </div>

      <FwdGraph frame={frame} t={t} scenario={scenario} />

      {/* Packet header panel */}
      {frame.header ? (
        <div className="fwd-header-box">
          <span className="fwd-header-label">{t.headerLabel}</span>
          <pre className="fwd-header-pre">{frame.header}</pre>
        </div>
      ) : (
        <div className="fwd-header-empty">{t.emptyHeader}</div>
      )}

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
        <div className="bgp2-detail-title">{frameTxt.title}</div>
        <p className="bgp2-detail-body">{frameTxt.note}</p>
        <span className="tcp-step-counter">{step + 1} / {total}</span>
      </div>
    </div>
  )
}

// ── Reference tables ───────────────────────────────────────────────────────────

function RefTables() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <>
      <div className="ov-proto-section">
        <div className="bgp2-section-title">{t.tableTitle}</div>
        <table className="ov-proto-table">
          <thead>
            <tr>{t.tableHeaders.map(h => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {t.tableRows.map(row => (
              <tr key={row[0]}>
                {row.map((cell, i) => (
                  i === 0
                    ? <td key={i}><strong>{cell}</strong></td>
                    : <td key={i}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ov-proto-section">
        <div className="bgp2-section-title">{t.arpTitle}</div>
        <table className="ov-proto-table">
          <thead>
            <tr>{t.arpHeaders.map(h => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {t.arpRows.map(row => (
              <tr key={row[0]}>
                <td><code>{row[0]}</code></td>
                <td>{row[1]}</td>
                <td><code className="fwd-arp-payload">{row[2]}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function FwdPage() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-08-09"
      readTime={t.readTime}
      tags={['networking', 'ethernet', 'ip', 'arp', 'switching', 'routing']}
      intro={t.intro}
    >
      <FwdExplorer />
      <RefTables />
    </NoteLayout>
  )
}
