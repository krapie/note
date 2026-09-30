import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type NodeId     = 'client' | 'gw' | 'isp' | 'dns' | 'server'
type NodeStatus = 'idle' | 'active' | 'done' | 'ok' | 'fail' | 'capture'
type LinkId     = 'client_gw' | 'gw_isp' | 'isp_srv' | 'isp_dns'
type LinkStatus = 'idle' | 'active' | 'done'

interface Bi { en: string; ko: string }

interface FlagNote extends Bi { f: string }

interface NtFrame {
  nodes: Record<NodeId, NodeStatus>
  links: Record<LinkId, LinkStatus>
  bidir: LinkId[]     // active links that also animate a reply dot
  layer: string       // layer chip shown in the terminal header
  term:  string       // terminal transcript; lines starting with "$ " are commands
  flags: FlagNote[]   // flag anatomy for the command(s) in this frame
}

interface ToolCmd {
  when: Bi       // troubleshooting scenario
  c:    string   // one command per line; "# ..." comments are stripped on copy
  why:  Bi
}

interface ToolRef {
  id:      string
  name:    string
  layer:   string
  purpose: Bi
  cmds:    ToolCmd[]
  flags:   FlagNote[]
  gotcha:  Bi
}

// ── Graph geometry ─────────────────────────────────────────────────────────────

const W = 600
const H = 260

const NODE_PX: Record<NodeId, [number, number]> = {
  client: [ 60, 165],
  gw:     [190, 165],
  isp:    [340, 165],
  dns:    [340,  55],
  server: [530, 165],
}

const NODE_IDS: NodeId[] = ['client', 'gw', 'isp', 'dns', 'server']

const LINKS: Array<{ id: LinkId; from: NodeId; to: NodeId }> = [
  { id: 'client_gw', from: 'client', to: 'gw'     },
  { id: 'gw_isp',    from: 'gw',     to: 'isp'    },
  { id: 'isp_srv',   from: 'isp',    to: 'server' },
  { id: 'isp_dns',   from: 'isp',    to: 'dns'    },
]

function seg(a: NodeId, b: NodeId) {
  return `M ${NODE_PX[a][0]} ${NODE_PX[a][1]} L ${NODE_PX[b][0]} ${NODE_PX[b][1]}`
}

const LINK_PATHS: Record<LinkId, string> = {
  client_gw: seg('client', 'gw'),
  gw_isp:    seg('gw', 'isp'),
  isp_srv:   seg('isp', 'server'),
  isp_dns:   seg('isp', 'dns'),
}

const LINK_PATHS_REV: Record<LinkId, string> = {
  client_gw: seg('gw', 'client'),
  gw_isp:    seg('isp', 'gw'),
  isp_srv:   seg('server', 'isp'),
  isp_dns:   seg('dns', 'isp'),
}

// ── Frame data ─────────────────────────────────────────────────────────────────

const N0: Record<NodeId, NodeStatus> = { client: 'idle', gw: 'idle', isp: 'idle', dns: 'idle', server: 'idle' }
const L0: Record<LinkId, LinkStatus> = { client_gw: 'idle', gw_isp: 'idle', isp_srv: 'idle', isp_dns: 'idle' }
const PATH_ON: Record<LinkId, LinkStatus> = { ...L0, client_gw: 'active', gw_isp: 'active', isp_srv: 'active', isp_dns: 'done' }

const FRAMES: NtFrame[] = [
  // 0: symptom
  { nodes: N0, links: L0, bidir: [], layer: 'symptom · L7',
    term:
`$ time curl -s -o /dev/null https://api.example.com/orders

real    0m3.214s
user    0m0.021s
sys     0m0.009s`,
    flags: [
      { f: 'time',          en: 'shell builtin — wall-clock duration of the command',   ko: '셸 내장 — 명령의 실제 경과 시간 측정' },
      { f: '-s',            en: 'silent — no progress meter',                          ko: 'silent — 진행 표시 끔' },
      { f: '-o /dev/null',  en: 'discard the response body',                          ko: '응답 본문 버림' },
    ] },
  // 1: local host
  { nodes: { ...N0, client: 'active' }, links: L0, bidir: [], layer: 'L2–L3 · local',
    term:
`$ ip -br addr
lo               UNKNOWN        127.0.0.1/8 ::1/128
eth0             UP             10.0.0.5/24 fe80::a00:27ff:fe4e:66a1/64

$ ip route get 93.184.216.34
93.184.216.34 via 10.0.0.1 dev eth0 src 10.0.0.5 uid 1000
    cache`,
    flags: [
      { f: '-br',                en: 'brief — one line per interface: name, state, addresses',    ko: 'brief — 인터페이스당 한 줄: 이름, 상태, 주소' },
      { f: 'addr',               en: 'show addresses (ip address)',                               ko: '주소 표시 (ip address)' },
      { f: 'route get <dst>',    en: 'ask the kernel which route, next hop, device and source IP it would use', ko: '커널이 실제로 고를 경로, 넥스트홉, 장치, 출발지 IP 조회' },
    ] },
  // 2: ping gateway
  { nodes: { ...N0, client: 'ok', gw: 'active' },
    links: { ...L0, client_gw: 'active' }, bidir: ['client_gw'], layer: 'L3 · ICMP',
    term:
`$ ping -c 4 -i 0.2 10.0.0.1
PING 10.0.0.1 (10.0.0.1) 56(84) bytes of data.
64 bytes from 10.0.0.1: icmp_seq=1 ttl=64 time=0.412 ms
64 bytes from 10.0.0.1: icmp_seq=2 ttl=64 time=0.388 ms
64 bytes from 10.0.0.1: icmp_seq=3 ttl=64 time=0.462 ms
64 bytes from 10.0.0.1: icmp_seq=4 ttl=64 time=0.421 ms

--- 10.0.0.1 ping statistics ---
4 packets transmitted, 4 received, 0% packet loss, time 603ms
rtt min/avg/max/mdev = 0.388/0.421/0.462/0.027 ms`,
    flags: [
      { f: '-c 4',   en: 'count — stop after 4 echo requests (never leave ping unbounded)', ko: 'count — 4번 보내고 종료 (ping을 무한 실행하지 말 것)' },
      { f: '-i 0.2', en: 'interval — 0.2 s between packets (below 0.2 needs root)',        ko: 'interval — 0.2초 간격 (0.2 미만은 root 필요)' },
    ] },
  // 3: dig
  { nodes: { ...N0, client: 'ok', gw: 'ok', isp: 'done', dns: 'active' },
    links: { ...L0, client_gw: 'active', gw_isp: 'active', isp_dns: 'active' }, bidir: ['isp_dns'], layer: 'L7 · DNS',
    term:
`$ dig @1.1.1.1 +noall +answer +stats api.example.com
api.example.com.        300     IN      A       93.184.216.34
;; Query time: 14 msec
;; SERVER: 1.1.1.1#53(1.1.1.1) (UDP)
;; WHEN: Wed Sep 30 10:41:52 KST 2026
;; MSG SIZE  rcvd: 60`,
    flags: [
      { f: '@1.1.1.1', en: 'query this resolver directly instead of /etc/resolv.conf', ko: '/etc/resolv.conf 대신 이 리졸버에 직접 질의' },
      { f: '+noall',   en: 'turn off every output section…',                           ko: '모든 출력 섹션을 끄고…' },
      { f: '+answer',  en: '…then turn the answer section back on',                    ko: '…answer 섹션만 다시 켬' },
      { f: '+stats',   en: 'show query time, server and message size',                 ko: '질의 시간, 응답 서버, 메시지 크기 표시' },
    ] },
  // 4: ping server — no reply
  { nodes: { ...N0, client: 'ok', gw: 'ok', isp: 'done', dns: 'ok', server: 'fail' },
    links: { ...L0, client_gw: 'active', gw_isp: 'active', isp_srv: 'active' }, bidir: [], layer: 'L3 · ICMP',
    term:
`$ ping -c 4 -W 1 api.example.com
PING api.example.com (93.184.216.34) 56(84) bytes of data.

--- api.example.com ping statistics ---
4 packets transmitted, 0 received, 100% packet loss, time 3062ms`,
    flags: [
      { f: '-c 4', en: 'send 4 echo requests',                          ko: 'echo 요청 4개 전송' },
      { f: '-W 1', en: 'wait at most 1 s for each reply',               ko: '응답마다 최대 1초 대기' },
    ] },
  // 5: tcp traceroute
  { nodes: { ...N0, client: 'ok', gw: 'ok', isp: 'active', dns: 'ok', server: 'active' },
    links: PATH_ON, bidir: [], layer: 'L3 · path (TCP)',
    term:
`$ sudo traceroute -n -T -p 443 -q 1 api.example.com
traceroute to api.example.com (93.184.216.34), 30 hops max, 60 byte packets
 1  10.0.0.1  0.521 ms
 2  100.64.0.1  4.812 ms
 3  *
 4  203.0.113.9  9.904 ms
 5  198.51.100.22  10.337 ms
 6  93.184.216.34  11.028 ms`,
    flags: [
      { f: '-n',     en: 'numeric — no reverse DNS per hop',                     ko: 'numeric — 홉마다 역방향 DNS 조회 안 함' },
      { f: '-T',     en: 'TCP SYN probes instead of UDP (needs root)',           ko: 'UDP 대신 TCP SYN 프로브 (root 필요)' },
      { f: '-p 443', en: 'destination port for the probes — same as the app',    ko: '프로브 목적지 포트 — 앱과 동일하게' },
      { f: '-q 1',   en: 'one probe per hop instead of three (faster)',          ko: '홉당 프로브 1개 (기본 3개, 더 빠름)' },
    ] },
  // 6: nc
  { nodes: { ...N0, client: 'ok', gw: 'ok', isp: 'ok', dns: 'ok', server: 'ok' },
    links: PATH_ON, bidir: ['isp_srv'], layer: 'L4 · TCP',
    term:
`$ nc -zv -w 3 api.example.com 443
Connection to api.example.com (93.184.216.34) 443 port [tcp/https] succeeded!`,
    flags: [
      { f: '-z',    en: 'zero-I/O — connect, then close without sending data', ko: 'zero-I/O — 연결만 하고 데이터 없이 종료' },
      { f: '-v',    en: 'verbose — print succeeded / refused / timed out',      ko: 'verbose — succeeded / refused / timed out 출력' },
      { f: '-w 3',  en: 'give up after 3 s (otherwise a DROP hangs ~2 min)',     ko: '3초 후 포기 (없으면 DROP 시 약 2분 대기)' },
    ] },
  // 7: curl timing
  { nodes: { ...N0, client: 'ok', gw: 'ok', isp: 'ok', dns: 'ok', server: 'active' },
    links: PATH_ON, bidir: ['isp_srv'], layer: 'L7 · TLS + HTTP',
    term:
`$ curl -so /dev/null -w "tcp=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer}\\n" https://api.example.com/orders
tcp=0.026 tls=0.071 ttfb=3.118`,
    flags: [
      { f: '-so /dev/null',         en: '-s silent + -o /dev/null discard the body — only the metrics matter', ko: '-s 조용히 + -o /dev/null 본문 버림 — 지표만 필요' },
      { f: '-w "…"',                en: 'write-out: print variables after the transfer',          ko: 'write-out: 전송 후 변수 출력' },
      { f: '%{time_connect}',       en: 'TCP handshake done (seconds since start)',               ko: 'TCP 핸드셰이크 완료 시점 (시작 기준 누적 초)' },
      { f: '%{time_appconnect}',    en: 'TLS handshake done',                                     ko: 'TLS 핸드셰이크 완료 시점' },
      { f: '%{time_starttransfer}', en: 'first response byte (TTFB)',                             ko: '첫 응답 바이트 도착 시점 (TTFB)' },
    ] },
  // 8: tcpdump
  { nodes: { ...N0, client: 'capture', gw: 'ok', isp: 'ok', dns: 'ok', server: 'active' },
    links: { ...L0, client_gw: 'active', gw_isp: 'done', isp_srv: 'done', isp_dns: 'done' }, bidir: ['client_gw'], layer: 'L2–L4 · wire',
    term:
`$ sudo tcpdump -nni eth0 -c 6 host 93.184.216.34 and port 443
10:42:01.100211 IP 10.0.0.5.51522 > 93.184.216.34.443: Flags [S], length 0
10:42:01.111502 IP 93.184.216.34.443 > 10.0.0.5.51522: Flags [S.], length 0
10:42:01.111560 IP 10.0.0.5.51522 > 93.184.216.34.443: Flags [.], length 0
10:42:01.157032 IP 10.0.0.5.51522 > 93.184.216.34.443: Flags [P.], length 98
10:42:01.168114 IP 93.184.216.34.443 > 10.0.0.5.51522: Flags [.], length 0
10:42:04.203387 IP 93.184.216.34.443 > 10.0.0.5.51522: Flags [P.], length 1432`,
    flags: [
      { f: '-nn',       en: 'no host AND no port name resolution',            ko: '호스트명과 포트명 모두 변환 안 함' },
      { f: '-i eth0',   en: 'capture on this interface (any = all)',          ko: '이 인터페이스에서 캡처 (any = 전체)' },
      { f: '-c 6',      en: 'stop after 6 packets',                           ko: '패킷 6개 후 종료' },
      { f: 'host … and port 443', en: 'BPF filter — only this flow, applied in the kernel', ko: 'BPF 필터 — 이 흐름만, 커널에서 적용' },
    ] },
  // 9: iperf3
  { nodes: { ...N0, client: 'ok', gw: 'ok', isp: 'ok', dns: 'ok', server: 'active' },
    links: PATH_ON, bidir: ['client_gw', 'gw_isp', 'isp_srv'], layer: 'L4 · throughput',
    term:
`$ iperf3 -c 93.184.216.34 -R -P 4 -t 30 -O 3
Connecting to host 93.184.216.34, port 5201
Reverse mode, remote host 93.184.216.34 is sending
…
[ ID] Interval           Transfer     Bitrate         Retr
[SUM]   0.00-30.00  sec  3.28 GBytes   940 Mbits/sec    0   sender
[SUM]   0.00-30.00  sec  3.28 GBytes   939 Mbits/sec        receiver`,
    flags: [
      { f: '-c <host>', en: 'client mode — the far end runs iperf3 -s',          ko: '클라이언트 모드 — 상대편은 iperf3 -s 실행' },
      { f: '-R',        en: 'reverse — server sends, measures download',         ko: 'reverse — 서버가 송신, 다운로드 측정' },
      { f: '-P 4',      en: '4 parallel streams',                                ko: '병렬 스트림 4개' },
      { f: '-t 30',     en: 'run for 30 s',                                      ko: '30초 동안 실행' },
      { f: '-O 3',      en: 'omit the first 3 s (TCP slow start) from results',  ko: '처음 3초(TCP 슬로 스타트)는 결과에서 제외' },
    ] },
]

// ── Tool reference ─────────────────────────────────────────────────────────────

const TOOLS: ToolRef[] = [
  {
    id: 'ip', name: 'ip', layer: 'L2–L3 · local',
    purpose: {
      en: 'Local view first: is the interface up, does it have an address, and which route will the kernel pick?',
      ko: '로컬부터: 인터페이스가 UP인지, 주소가 있는지, 커널이 어떤 경로를 고르는지.',
    },
    cmds: [
      { when: { en: 'Interfaces up? IPs assigned?', ko: '인터페이스 UP? IP 할당?' },
        c: 'ip -br a',
        why: { en: 'One line per interface: name, state, addresses.', ko: '인터페이스당 한 줄: 이름, 상태, 주소.' } },
      { when: { en: 'Which route wins for a destination?', ko: '이 목적지엔 어떤 경로가 쓰이나?' },
        c: 'ip r get 1.1.1.1',
        why: { en: 'Next hop, device and source IP the kernel will use.', ko: '커널이 쓸 넥스트홉, 장치, 출발지 IP.' } },
      { when: { en: 'NIC errors or drops', ko: 'NIC 에러, 드롭' },
        c: 'ip -s link show eth0',
        why: { en: 'Rising errors/drops = bad cable, duplex mismatch, full ring buffer.', ko: '에러/드롭 증가 = 불량 케이블, duplex 불일치, 링 버퍼 포화.' } },
      { when: { en: 'Gateway MAC resolved?', ko: '게이트웨이 MAC 해석됐나?' },
        c: 'ip neigh',
        why: { en: 'FAILED or INCOMPLETE means no ARP reply.', ko: 'FAILED, INCOMPLETE는 ARP 응답 없음.' } },
    ],
    flags: [
      { f: '-br',         en: 'brief — one line per interface',                    ko: 'brief — 인터페이스당 한 줄' },
      { f: '-s',          en: 'statistics: bytes, errors, drops',                  ko: '통계: 바이트, 에러, 드롭' },
      { f: 'r get <dst>', en: 'the route the kernel would use for <dst>',          ko: '<dst>에 커널이 사용할 경로' },
      { f: 'neigh',       en: 'ARP / NDP neighbor cache',                          ko: 'ARP / NDP 이웃 캐시' },
    ],
    gotcha: {
      en: 'ifconfig, route and arp (net-tools) are deprecated and hide secondary addresses and policy routes. Use iproute2.',
      ko: 'ifconfig, route, arp(net-tools)는 폐기 예정이며 보조 주소와 정책 라우트를 보여주지 않습니다. iproute2를 쓰세요.',
    },
  },
  {
    id: 'ss', name: 'ss', layer: 'L4 · sockets',
    purpose: {
      en: 'Socket state on this host: what is listening, what is connected, and how healthy each TCP connection is.',
      ko: '이 호스트의 소켓 상태: 무엇이 리슨 중이고, 무엇이 연결됐고, 각 TCP 연결이 얼마나 건강한지.',
    },
    cmds: [
      { when: { en: 'Is my service listening?', ko: '서비스가 리슨 중인가?' },
        c: 'ss -tlnp',
        why: { en: 'Check the address too: 0.0.0.0 vs 127.0.0.1 only.', ko: '주소도 확인: 0.0.0.0인지 127.0.0.1뿐인지.' } },
      { when: { en: 'Is this connection lossy or slow?', ko: '이 연결이 손실/지연 중인가?' },
        c: 'ss -tin dst 10.0.2.10',
        why: { en: 'rtt, cwnd and retrans per connection.', ko: '연결별 rtt, cwnd, retrans.' } },
      { when: { en: 'SYN never answered?', ko: 'SYN 응답이 없나?' },
        c: 'ss -tn state syn-sent',
        why: { en: 'Stuck in SYN-SENT usually means a firewall DROP.', ko: 'SYN-SENT에 멈춤 = 대개 방화벽 DROP.' } },
    ],
    flags: [
      { f: '-t / -u',   en: 'TCP / UDP sockets',                          ko: 'TCP / UDP 소켓' },
      { f: '-l',        en: 'listening sockets only',                     ko: '리슨 소켓만' },
      { f: '-n',        en: 'numeric — no name resolution',               ko: 'numeric — 이름 변환 안 함' },
      { f: '-p',        en: 'owning process',                             ko: '소유 프로세스' },
      { f: '-i',        en: 'TCP internals: rtt, cwnd, retrans',          ko: 'TCP 내부 정보: rtt, cwnd, retrans' },
      { f: 'state <s>', en: 'filter by TCP state',                        ko: 'TCP 상태로 필터' },
    ],
    gotcha: {
      en: 'A service bound to 127.0.0.1 is reachable only from the host itself — the most common reason a port looks closed from outside.',
      ko: '127.0.0.1에 바인드된 서비스는 호스트 자신만 접근할 수 있습니다 — 외부에서 포트가 닫혀 보이는 가장 흔한 원인입니다.',
    },
  },
  {
    id: 'ping', name: 'ping', layer: 'L3 · ICMP',
    purpose: {
      en: 'L3 reachability and round-trip time with ICMP echo. Proves the path works for ICMP — not that TCP/443 works.',
      ko: 'ICMP echo로 L3 도달성과 왕복 시간을 확인합니다. ICMP 경로를 증명할 뿐, TCP/443을 증명하지는 않습니다.',
    },
    cmds: [
      { when: { en: 'Reachability and RTT', ko: '도달성과 RTT' },
        c: 'ping -c 5 example.com',
        why: { en: 'Always bound it with -c.', ko: '항상 -c로 제한.' } },
      { when: { en: 'Fast probing — loss over a short window', ko: '빠른 프로브 — 짧은 시간의 손실률' },
        c: 'ping -c 50 -i 0.2 10.0.0.1',
        why: { en: '50 probes in 10 s instead of 50 s. Below 0.2 s needs root.', ko: '50초 대신 10초에 50개. 0.2초 미만은 root 필요.' } },
      { when: { en: 'Does a 1500-byte packet fit? (MTU)', ko: '1500바이트 패킷이 통과하나? (MTU)' },
        c: 'ping -M do -s 1472 -c 3 example.com',
        why: { en: '1472 + 28 header bytes = 1500 with DF set. "message too long" or silence = path MTU < 1500 — lower -s until it passes.', ko: 'DF 설정, 1472 + 헤더 28 = 1500. "message too long"이나 무응답 = 경로 MTU < 1500 — 통과할 때까지 -s를 낮추세요.' } },
      { when: { en: 'Intermittent drops — keep a log', ko: '간헐적 드롭 — 로그 남기기' },
        c: 'ping -D -O example.com | tee ping.log',
        why: { en: 'Timestamped lines, missed replies reported immediately.', ko: '타임스탬프 기록, 응답 누락 즉시 표시.' } },
    ],
    flags: [
      { f: '-c N',  en: 'stop after N packets',                           ko: 'N개 후 종료' },
      { f: '-i S',  en: 'interval between packets',                       ko: '패킷 간격' },
      { f: '-s N',  en: 'payload size in bytes (+28 for IP + ICMP headers)', ko: '페이로드 크기 (IP+ICMP 헤더 +28)' },
      { f: '-M do', en: 'set Don\'t Fragment — required for MTU tests',   ko: 'DF 비트 설정 — MTU 테스트에 필수' },
      { f: '-D',    en: 'timestamp each line',                            ko: '각 줄에 타임스탬프' },
      { f: '-O',    en: 'report missing replies',                         ko: '응답 누락 표시' },
    ],
    gotcha: {
      en: 'Many hosts and clouds drop ICMP echo. 100% loss to a server whose TCP port works is normal — confirm with nc or curl.',
      ko: '많은 호스트와 클라우드가 ICMP echo를 드롭합니다. TCP 포트가 동작하는 서버에 100% 손실은 흔합니다 — nc나 curl로 확인하세요.',
    },
  },
  {
    id: 'traceroute', name: 'traceroute', layer: 'L3 · path',
    purpose: {
      en: 'Discover the hop-by-hop path by sending probes with increasing TTL and reading each router\'s ICMP Time Exceeded reply.',
      ko: 'TTL을 1씩 늘린 프로브를 보내고 각 라우터의 ICMP Time Exceeded 응답을 읽어 홉 단위 경로를 찾습니다.',
    },
    cmds: [
      { when: { en: 'Path the app actually uses', ko: '앱이 실제로 쓰는 경로' },
        c: 'sudo traceroute -n -T -p 443 example.com',
        why: { en: 'TCP SYN to 443 passes firewalls that drop UDP/ICMP probes.', ko: '443 TCP SYN은 UDP/ICMP를 막는 방화벽도 통과.' } },
      { when: { en: 'ICMP path', ko: 'ICMP 경로' },
        c: 'sudo traceroute -n -I example.com',
        why: { en: 'When the default UDP probes are filtered.', ko: '기본 UDP 프로브가 막혔을 때.' } },
      { when: { en: 'Which networks (ASes)?', ko: '어떤 네트워크(AS)를 거치나?' },
        c: 'traceroute -n -A example.com',
        why: { en: 'AS number per hop — who to contact.', ko: '홉별 AS 번호 — 누구에게 연락할지.' } },
    ],
    flags: [
      { f: '-n',   en: 'no reverse DNS per hop',              ko: '홉별 역방향 DNS 안 함' },
      { f: '-T',   en: 'TCP SYN probes (root)',               ko: 'TCP SYN 프로브 (root)' },
      { f: '-I',   en: 'ICMP echo probes (root)',             ko: 'ICMP echo 프로브 (root)' },
      { f: '-p N', en: 'destination port',                    ko: '목적지 포트' },
      { f: '-A',   en: 'AS number lookup per hop',            ko: '홉별 AS 번호 조회' },
    ],
    gotcha: {
      en: '"* * *" at a middle hop while later hops answer means that router doesn\'t reply to probes — not packet loss.',
      ko: '중간 홉이 "* * *"인데 이후 홉이 응답하면 그 라우터가 프로브에 응답하지 않을 뿐, 패킷 손실이 아닙니다.',
    },
  },
  {
    id: 'mtr', name: 'mtr', layer: 'L3 · path + loss',
    purpose: {
      en: 'traceroute + ping, continuously: per-hop loss and latency over many cycles. The tool for intermittent loss and ISP tickets.',
      ko: 'traceroute + ping을 계속 실행: 여러 사이클에 걸친 홉별 손실과 지연. 간헐적 손실과 ISP 티켓의 필수 도구.',
    },
    cmds: [
      { when: { en: 'Report for an ISP ticket', ko: 'ISP 티켓용 리포트' },
        c: 'mtr -rwc 100 example.com',
        why: { en: '100 cycles, printed as a table — paste it as-is.', ko: '100 사이클을 표로 — 그대로 붙여넣기.' } },
      { when: { en: 'Which networks (ASNs) are on the path?', ko: '경로상 네트워크(ASN)는?' },
        c: 'mtr --aslookup -rwc 100 example.com',
        why: { en: 'Shows where one AS hands off to the next.', ko: 'AS가 넘어가는 지점을 보여줌.' } },
      { when: { en: 'Bidirectional — run from both ends', ko: '양방향 — 양 끝에서 실행' },
        c: 'mtr -rwc 100 203.0.113.10   # on client → server\nmtr -rwc 100 198.51.100.7   # on server → client',
        why: { en: 'Return paths are often asymmetric. Loss in only one direction points at that path — send both reports.', ko: '돌아오는 경로는 흔히 비대칭입니다. 한 방향에서만 손실이 보이면 그 경로 문제 — 두 리포트를 함께 보내세요.' } },
      { when: { en: 'ICMP filtered — use TCP', ko: 'ICMP 차단 — TCP 사용' },
        c: 'sudo mtr -T -P 443 -rwc 100 example.com',
        why: { en: 'Same protocol and port as the app.', ko: '앱과 같은 프로토콜과 포트.' } },
    ],
    flags: [
      { f: '-r',              en: 'report mode — run, then print a table',     ko: 'report 모드 — 실행 후 표 출력' },
      { f: '-w',              en: 'wide — don\'t truncate hostnames',           ko: 'wide — 호스트명 자르지 않음' },
      { f: '-c N',            en: 'cycles (probes per hop)',                    ko: '사이클 수 (홉당 프로브)' },
      { f: '-z / --aslookup', en: 'AS number per hop',                          ko: '홉별 AS 번호' },
      { f: '-T / -P N',       en: 'TCP SYN probes to port N',                   ko: 'N 포트로 TCP SYN 프로브' },
    ],
    gotcha: {
      en: 'Loss at one middle hop that does not continue to the final hop is ICMP rate-limiting. Real loss persists all the way to the destination. See the MTR note.',
      ko: '중간 한 홉에만 있고 마지막 홉까지 이어지지 않는 손실은 ICMP 속도 제한입니다. 실제 손실은 목적지까지 계속됩니다. MTR 노트 참고.',
    },
  },
  {
    id: 'dig', name: 'dig', layer: 'L7 · DNS',
    purpose: {
      en: 'Query DNS directly — bypassing /etc/hosts and the OS cache — and see which server answered, with what TTL, and how fast.',
      ko: '/etc/hosts와 OS 캐시를 거치지 않고 DNS에 직접 질의해, 어느 서버가 어떤 TTL로 얼마나 빨리 답했는지 봅니다.',
    },
    cmds: [
      { when: { en: 'Quick lookup', ko: '빠른 조회' },
        c: 'dig +short example.com',
        why: { en: 'Just the answer.', ko: '응답만.' } },
      { when: { en: 'Ask a specific resolver', ko: '특정 리졸버에 질의' },
        c: 'dig @1.1.1.1 +short example.com',
        why: { en: 'Different from your resolver = stale cache or split-horizon.', ko: '내 리졸버와 다르면 = 오래된 캐시나 split-horizon.' } },
      { when: { en: 'Trace the delegation', ko: '위임 추적' },
        c: 'dig +trace example.com',
        why: { en: 'Walks root → TLD → authoritative yourself; shows where it breaks.', ko: '루트 → TLD → 권위 서버를 직접 따라가며 끊기는 지점을 보여줌.' } },
      { when: { en: 'Reverse DNS (rDNS)', ko: '역방향 DNS (rDNS)' },
        c: 'dig -x 93.184.216.34 +short',
        why: { en: 'PTR record for an IP.', ko: 'IP의 PTR 레코드.' } },
    ],
    flags: [
      { f: '@server', en: 'query a specific server',                               ko: '특정 서버에 질의' },
      { f: '+short',  en: 'answer data only',                                      ko: '응답 데이터만' },
      { f: '+trace',  en: 'iterate from the root, showing every referral',         ko: '루트부터 반복 질의, 모든 위임 표시' },
      { f: '-x <ip>', en: 'reverse (PTR) lookup',                                  ko: '역방향(PTR) 조회' },
    ],
    gotcha: {
      en: 'dig ignores /etc/hosts and nsswitch; your application does not. When they disagree, check getent ahosts <name>.',
      ko: 'dig는 /etc/hosts와 nsswitch를 무시하지만 애플리케이션은 그렇지 않습니다. 결과가 다르면 getent ahosts <name>을 확인하세요.',
    },
  },
  {
    id: 'nc', name: 'nc', layer: 'L4 · TCP / UDP',
    purpose: {
      en: 'Raw TCP or UDP: can I open a connection to this port? Also a tiny client and server for firewall tests.',
      ko: '순수 TCP 또는 UDP: 이 포트에 연결할 수 있는가? 방화벽 테스트용 작은 클라이언트/서버로도 씁니다.',
    },
    cmds: [
      { when: { en: 'Is the port open?', ko: '포트가 열려 있나?' },
        c: 'nc -zv -w 3 example.com 443',
        why: { en: 'succeeded / refused / timed out — each means something different.', ko: 'succeeded / refused / timed out — 각각 의미가 다름.' } },
      { when: { en: 'Server side — listen on a port', ko: '서버 측 — 포트 리슨' },
        c: 'nc -lk 9000',
        why: { en: 'Run on host B (10.0.0.9). No real service needed; -k keeps it open for repeated tests.', ko: '호스트 B(10.0.0.9)에서 실행. 실제 서비스 불필요; -k로 반복 테스트 동안 유지.' } },
      { when: { en: 'Client side — connect and send', ko: '클라이언트 측 — 연결 후 전송' },
        c: 'nc -v 10.0.0.9 9000',
        why: { en: 'Run on host A. Type a line — it appears on B. Timed out = a firewall in between drops it.', ko: '호스트 A에서 실행. 입력한 줄이 B에 표시됨. timed out = 중간 방화벽이 DROP.' } },
    ],
    flags: [
      { f: '-z',   en: 'connect and close, send nothing',   ko: '연결 후 종료, 데이터 없음' },
      { f: '-v',   en: 'print the result',                  ko: '결과 출력' },
      { f: '-w S', en: 'timeout',                           ko: '타임아웃' },
      { f: '-l',   en: 'listen mode (server side)',         ko: '리슨 모드 (서버 측)' },
      { f: '-k',   en: 'keep listening after a client leaves', ko: '클라이언트 종료 후에도 리슨' },
    ],
    gotcha: {
      en: 'refused = RST (host up, nothing listening, or REJECT). timed out = silent DROP. UDP results (-u) prove little.',
      ko: 'refused = RST (호스트는 살아 있고 리슨 없음 또는 REJECT). timed out = 조용한 DROP. UDP(-u) 결과는 신뢰도가 낮음.',
    },
  },
  {
    id: 'curl', name: 'curl', layer: 'L7 · HTTP',
    purpose: {
      en: 'The app\'s real protocol: DNS, TCP, TLS and HTTP in one request, with timing for each phase.',
      ko: '앱의 실제 프로토콜: DNS, TCP, TLS, HTTP를 한 요청으로, 단계별 타이밍과 함께.',
    },
    cmds: [
      { when: { en: 'Where does the time go?', ko: '시간이 어디서 쓰이나?' },
        c: 'curl -so /dev/null -w "tcp=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer}\\n" https://example.com',
        why: { en: 'Cumulative seconds: TCP done, TLS done, first byte.', ko: '누적 초: TCP 완료, TLS 완료, 첫 바이트.' } },
      { when: { en: 'See the handshake and headers', ko: '핸드셰이크와 헤더 보기' },
        c: 'curl -v -o /dev/null https://example.com',
        why: { en: 'Connection, TLS and request/response headers on stderr; body discarded.', ko: '연결, TLS, 요청/응답 헤더를 stderr로; 본문은 버림.' } },
      { when: { en: 'Send a custom header', ko: '커스텀 헤더 보내기' },
        c: 'curl -s -H "Host: example.com" http://10.0.0.9/',
        why: { en: 'Test a vhost by IP, or add auth / debug headers.', ko: 'IP로 vhost 테스트, 또는 인증/디버그 헤더 추가.' } },
      { when: { en: 'Headers and redirect chain', ko: '헤더와 리다이렉트 체인' },
        c: 'curl -sIL https://example.com',
        why: { en: 'HEAD, following every redirect.', ko: 'HEAD, 모든 리다이렉트 추적.' } },
      { when: { en: 'Hit one backend, bypass DNS', ko: 'DNS 우회, 특정 백엔드로' },
        c: 'curl -v --resolve example.com:443:10.0.0.9 https://example.com',
        why: { en: 'SNI and Host stay correct.', ko: 'SNI와 Host는 그대로 유지.' } },
    ],
    flags: [
      { f: '-v',               en: 'verbose — connection, TLS and headers',   ko: 'verbose — 연결, TLS, 헤더' },
      { f: '-s',               en: 'silent — no progress meter',              ko: 'silent — 진행 표시 끔' },
      { f: '-o /dev/null',     en: 'discard the body',                        ko: '본문 버림' },
      { f: '-w <fmt>',         en: 'print variables after the transfer',      ko: '전송 후 변수 출력' },
      { f: '-H "K: V"',        en: 'add or override a request header',        ko: '요청 헤더 추가 또는 덮어쓰기' },
      { f: '-I / -L',          en: 'HEAD only / follow redirects',            ko: 'HEAD만 / 리다이렉트 따라가기' },
      { f: '--resolve h:p:ip', en: 'pin a hostname to an IP',                 ko: '호스트명을 IP로 고정' },
    ],
    gotcha: {
      en: '-w times are cumulative. TLS = appconnect − connect; server think time ≈ starttransfer − appconnect.',
      ko: '-w 시간은 누적값입니다. TLS = appconnect − connect; 서버 처리 시간 ≈ starttransfer − appconnect.',
    },
  },
  {
    id: 'openssl', name: 'openssl', layer: 'L6 · TLS',
    purpose: {
      en: 'Only the TLS handshake: which certificate, protocol and cipher the server presents — independent of HTTP.',
      ko: 'TLS 핸드셰이크만: 서버가 제시하는 인증서, 프로토콜, 암호 — HTTP와 독립적으로.',
    },
    cmds: [
      { when: { en: 'Handshake summary', ko: '핸드셰이크 요약' },
        c: 'openssl s_client -connect example.com:443 -brief </dev/null',
        why: { en: 'Protocol, cipher, peer cert in a few lines.', ko: '프로토콜, 암호, 상대 인증서를 몇 줄로.' } },
      { when: { en: 'When does the cert expire?', ko: '인증서 만료일은?' },
        c: 'openssl s_client -connect example.com:443 </dev/null 2>/dev/null | openssl x509 -noout -dates',
        why: { en: 'notBefore / notAfter.', ko: 'notBefore / notAfter.' } },
      { when: { en: 'Missing intermediate?', ko: '중간 인증서 누락?' },
        c: 'openssl s_client -connect example.com:443 -showcerts </dev/null',
        why: { en: 'Every cert the server sends.', ko: '서버가 보내는 모든 인증서.' } },
    ],
    flags: [
      { f: '-connect h:p',  en: 'host and port',                                ko: '호스트와 포트' },
      { f: '-servername h', en: 'SNI — needed when connecting by IP',           ko: 'SNI — IP로 연결할 때 필요' },
      { f: '-brief',        en: 'short summary',                                ko: '짧은 요약' },
      { f: '-showcerts',    en: 'print the full chain',                         ko: '전체 체인 출력' },
      { f: '</dev/null',    en: 'exit right after the handshake',               ko: '핸드셰이크 후 바로 종료' },
    ],
    gotcha: {
      en: 'Connecting by IP without -servername returns the default cert — a name mismatch real clients never see.',
      ko: '-servername 없이 IP로 연결하면 기본 인증서가 와서, 실제 클라이언트는 겪지 않는 이름 불일치를 보게 됩니다.',
    },
  },
  {
    id: 'tcpdump', name: 'tcpdump', layer: 'L2–L4 · wire',
    purpose: {
      en: 'Ground truth: packets exactly as they hit the interface. Settles "did we send it?" and "did they answer?".',
      ko: '최종 증거: 인터페이스에 실제로 도달한 패킷. "우리가 보냈나?", "상대가 답했나?"를 확정합니다.',
    },
    cmds: [
      { when: { en: 'One host, one port', ko: '호스트 하나, 포트 하나' },
        c: 'sudo tcpdump -nni any host 10.0.2.10 and port 443',
        why: { en: 'The flow you care about, nothing else.', ko: '관심 있는 흐름만.' } },
      { when: { en: 'All HTTPS traffic', ko: '모든 HTTPS 트래픽' },
        c: 'sudo tcpdump -nni eth0 tcp port 443',
        why: { en: 'Every TCP/443 packet on the interface.', ko: '인터페이스의 모든 TCP/443 패킷.' } },
      { when: { en: 'Save for Wireshark', ko: 'Wireshark용 저장' },
        c: 'sudo tcpdump -nni eth0 -w cap.pcap tcp port 443',
        why: { en: 'Analyze later, share with others.', ko: '나중에 분석, 공유.' } },
      { when: { en: 'Long capture — rotate files', ko: '장시간 캡처 — 파일 로테이션' },
        c: 'sudo tcpdump -nni eth0 -w cap.pcap -C 100 -W 10 tcp port 443',
        why: { en: 'Ring of 10 × 100 MB files; oldest is overwritten. Disk never fills.', ko: '100MB × 10개 링 버퍼; 가장 오래된 파일부터 덮어씀. 디스크가 차지 않음.' } },
      { when: { en: 'Only handshakes and resets', ko: '핸드셰이크와 리셋만' },
        c: "sudo tcpdump -nni eth0 'tcp[tcpflags] & (tcp-syn|tcp-rst) != 0'",
        why: { en: 'Cheap on busy hosts.', ko: '바쁜 호스트에서도 가벼움.' } },
    ],
    flags: [
      { f: '-i <if>',      en: 'interface (any = all)',               ko: '인터페이스 (any = 전체)' },
      { f: '-nn',          en: 'no host or port name resolution',     ko: '호스트명, 포트명 변환 안 함' },
      { f: '-c N',         en: 'stop after N packets',                ko: '패킷 N개 후 종료' },
      { f: '-w / -r file', en: 'write / read a pcap',                 ko: 'pcap 쓰기 / 읽기' },
      { f: '-C MB / -W N', en: 'rotate every MB, keep N files',       ko: 'MB마다 교체, N개 유지' },
      { f: '-A',           en: 'print payload as ASCII',              ko: '페이로드를 ASCII로 출력' },
    ],
    gotcha: {
      en: 'Always filter on busy hosts and prefer -w over printing. pcaps can contain tokens and passwords — treat them as secrets.',
      ko: '바쁜 호스트에서는 반드시 필터를 걸고 출력보다 -w를 쓰세요. pcap에는 토큰과 비밀번호가 있을 수 있으니 비밀로 취급하세요.',
    },
  },
  {
    id: 'iperf3', name: 'iperf3', layer: 'L4 · throughput',
    purpose: {
      en: 'Throughput, loss and jitter between two hosts you control — separates "network capacity" from "application speed".',
      ko: '직접 제어하는 두 호스트 사이의 처리량, 손실, 지터 — "네트워크 용량"과 "앱 속도"를 분리합니다.',
    },
    cmds: [
      { when: { en: 'Server, then client', ko: '서버, 그다음 클라이언트' },
        c: 'iperf3 -s                 # on host B\niperf3 -c 10.0.2.10      # on host A',
        why: { en: 'Upload from A to B for 10 s.', ko: 'A에서 B로 10초 업로드.' } },
      { when: { en: 'Download direction', ko: '다운로드 방향' },
        c: 'iperf3 -c 10.0.2.10 -R',
        why: { en: 'Server sends — the other direction often differs.', ko: '서버가 송신 — 반대 방향은 결과가 다른 경우가 많음.' } },
      { when: { en: 'UDP loss and jitter', ko: 'UDP 손실과 지터' },
        c: 'iperf3 -c 10.0.2.10 -u -b 100M',
        why: { en: 'Set -b — the UDP default is only 1 Mbit/s.', ko: '-b 필수 — UDP 기본은 1 Mbit/s.' } },
    ],
    flags: [
      { f: '-s / -c <host>', en: 'server / client mode',            ko: '서버 / 클라이언트 모드' },
      { f: '-R',             en: 'reverse — server sends',          ko: 'reverse — 서버가 송신' },
      { f: '-P N',           en: 'parallel streams',                ko: '병렬 스트림 수' },
      { f: '-u / -b rate',   en: 'UDP at a target bitrate',         ko: '목표 비트레이트로 UDP' },
    ],
    gotcha: {
      en: 'Don\'t saturate production links during peak hours — iperf3 will happily fill the pipe.',
      ko: '피크 시간에 운영 링크를 포화시키지 마세요 — iperf3는 파이프를 가득 채웁니다.',
    },
  },
]

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title:    'Network troubleshooting CLI — tools, flags, and practice',
    readTime: '12 min',
    intro:    `When "the network is slow", guessing is expensive. A handful of CLI tools — ip, ss, ping, traceroute, mtr, dig, nc, curl, openssl, tcpdump, iperf3 — each prove exactly one thing about one segment of the path. The skill is picking the right one, with the right flags, in the right order: bottom-up from the local host to the application, changing one variable at a time. Step through a real diagnosis below, then use the per-tool reference for the flags and commands worth memorizing.`,
    nodeLabel: { client: 'Your host', gw: 'Gateway', isp: 'ISP / transit', dns: 'Resolver', server: 'Server' } as Record<NodeId, string>,
    nodeSub:   { client: '10.0.0.5', gw: '10.0.0.1', isp: 'hops 2–5', dns: '1.1.1.1', server: 'api.example.com' } as Record<NodeId, string>,
    linkLabel: { client_gw: 'LAN', gw_isp: 'WAN', isp_srv: 'transit', isp_dns: 'UDP/53' } as Record<LinkId, string>,
    badge:     { ok: 'ok', fail: 'no reply', capture: 'capturing' },
    termLabel:    'Terminal',
    copyLabel:    'Copy command',
    anatomyLabel: 'Flag anatomy',
    frames: [
      { title: 'Symptom — the API call takes 3 seconds',
        note:  'A request that normally returns in ~100 ms now takes 3.2 s. Is it the network, DNS, TLS, or the application? Resist jumping to conclusions: work bottom-up from your own host to the application, and let each tool prove one segment healthy before moving on.' },
      { title: 'Local host — interface, address, route',
        note:  'ip -br addr shows eth0 is UP with 10.0.0.5/24. ip route get asks the kernel which route it would actually use: via 10.0.0.1 out of eth0 with source 10.0.0.5. If a VPN or policy route were hijacking this destination, this is where you would see it.' },
      { title: 'ping the gateway — first hop is healthy',
        note:  'Four replies, 0% loss, ~0.4 ms RTT with tiny mdev. The LAN, the NIC and ARP for the gateway all work. Always bound ping with -c; if the gateway did not answer, the next check would be ip neigh to see whether its MAC even resolved.' },
      { title: 'dig — DNS answers fast and correctly',
        note:  'Querying 1.1.1.1 directly returns 93.184.216.34 with TTL 300 in 14 ms. Name resolution is not the 3-second problem. Pinning the resolver with @ removes /etc/resolv.conf from the equation; repeat with the system resolver and compare if they differ.' },
      { title: 'ping the server — 100% loss… a red herring',
        note:  'No echo replies at all. It is tempting to declare the server down — but many servers and cloud edges silently drop ICMP echo. ICMP is a different protocol from the one your app uses. The lesson: test with the application\'s own protocol and port before drawing conclusions.' },
      { title: 'traceroute -T -p 443 — the TCP path works',
        note:  'Using TCP SYN probes to port 443, every hop answers and the final hop is the server itself at 11 ms. Hop 3 shows * because that router doesn\'t reply to probes — later hops respond, so it isn\'t loss. For a continuous per-hop view with loss %, use mtr -rwzbc 100 (see the MTR note).' },
      { title: 'nc -zv — port 443 is open',
        note:  '"succeeded" means the full TCP handshake completed. Learn the other two outcomes: "refused" is an RST — the host is reachable but nothing listens (or a REJECT rule); "timed out" is a silent DROP by a firewall. -w 3 keeps a DROP from hanging for two minutes.' },
      { title: 'curl -w — where the 3 seconds actually go',
        note:  'The write-out timings are cumulative from the start: TCP connect at 26 ms (DNS included), TLS done at 71 ms, first byte at 3.118 s. Subtracting, the network and TLS cost ~70 ms total; the server spends ~3.05 s thinking between receiving the request and sending the first byte. The problem is in the application, not the network.' },
      { title: 'tcpdump — proof on the wire',
        note:  'The capture confirms it: handshake completes in 11 ms, the request (98 bytes) is ACKed 11 ms later, then silence for 3.0 s before the first response segment. No retransmits, no resets. This transcript is the evidence you attach when handing the issue to the application team.' },
      { title: 'iperf3 — rule out bandwidth',
        note:  'If you control both ends (a test host near the server running iperf3 -s), measure raw capacity: 4 reverse streams hit ~940 Mbit/s with 0 retransmits. The pipe is clean and full-speed. Verdict: network healthy end to end; the latency is server think time.' },
    ],
    toolsTitle:   'Tool reference — flags and useful commands',
    flagsLabel:   'Flags',
    flagHeaders:  ['Flag', 'Meaning'],
    cmdsLabel:    'Useful commands',
    gotchaLabel:  'Gotcha',
    bpTitle:   'Best practices',
    bpHeaders: ['Practice', 'Why'],
    bpRows: [
      ['Bottom-up, one variable at a time', 'Each test proves one segment or layer. Change two things at once and you can no longer tell which one mattered.'],
      ['Test with the app\'s protocol and port', 'ICMP is filtered and rate-limited differently from TCP/443. Prefer traceroute -T, nc and curl over ping for app issues.'],
      ['Always pass -n', 'Reverse DNS lookups slow output, time out, and mislead you during a DNS incident.'],
      ['Bound every command', '-c, -w, -m, --max-time, -C/-W. An unbounded ping or tcpdump on a production host is noise and risk.'],
      ['Pin the variables', 'dig @server, curl --resolve, -4 / -6, ping -I choose exactly the resolver, backend, address family and interface.'],
      ['Measure from both ends', 'A client capture plus a server capture turns "somewhere in the middle" into the exact place packets vanish.'],
      ['Save evidence with timestamps', 'ping -D, tcpdump -w, mtr -r, curl -w. Tickets with raw output get resolved much faster.'],
      ['Know your baseline', 'Normal RTT, throughput and hop list make anomalies obvious. Record them when things are healthy.'],
    ],
  },
  ko: {
    title:    '네트워크 트러블슈팅 CLI — 도구, 플래그, 실전',
    readTime: '12분',
    intro:    `"네트워크가 느리다"는 상황에서 추측은 비쌉니다. ip, ss, ping, traceroute, mtr, dig, nc, curl, openssl, tcpdump, iperf3 — 각 도구는 경로의 한 구간에 대해 정확히 한 가지를 증명합니다. 핵심은 올바른 도구를, 올바른 플래그로, 올바른 순서로 쓰는 것입니다: 로컬 호스트에서 애플리케이션까지 아래에서 위로, 한 번에 변수 하나만 바꾸면서. 아래에서 실제 진단 과정을 단계별로 따라가 본 뒤, 도구별 레퍼런스에서 외워 둘 만한 플래그와 명령을 확인하세요.`,
    nodeLabel: { client: '내 호스트', gw: '게이트웨이', isp: 'ISP / 트랜짓', dns: '리졸버', server: '서버' } as Record<NodeId, string>,
    nodeSub:   { client: '10.0.0.5', gw: '10.0.0.1', isp: '홉 2–5', dns: '1.1.1.1', server: 'api.example.com' } as Record<NodeId, string>,
    linkLabel: { client_gw: 'LAN', gw_isp: 'WAN', isp_srv: '트랜짓', isp_dns: 'UDP/53' } as Record<LinkId, string>,
    badge:     { ok: 'ok', fail: '응답 없음', capture: '캡처 중' },
    termLabel:    '터미널',
    copyLabel:    '명령 복사',
    anatomyLabel: '플래그 해부',
    frames: [
      { title: '증상 — API 호출이 3초 걸림',
        note:  '평소 ~100ms에 끝나던 요청이 3.2초 걸립니다. 네트워크일까, DNS일까, TLS일까, 애플리케이션일까? 성급한 결론은 금물입니다: 내 호스트에서 애플리케이션까지 아래에서 위로 올라가며, 각 도구로 한 구간이 정상임을 증명한 뒤 다음으로 넘어갑니다.' },
      { title: '로컬 호스트 — 인터페이스, 주소, 경로',
        note:  'ip -br addr로 eth0이 10.0.0.5/24로 UP임을 확인합니다. ip route get은 커널이 실제로 사용할 경로를 묻습니다: eth0으로 10.0.0.1을 경유, 출발지 10.0.0.5. VPN이나 정책 라우트가 이 목적지를 가로채고 있다면 여기서 드러납니다.' },
      { title: '게이트웨이 ping — 첫 홉 정상',
        note:  '응답 4개, 손실 0%, RTT ~0.4ms, mdev도 작습니다. LAN, NIC, 게이트웨이 ARP 모두 정상입니다. ping은 항상 -c로 제한하세요. 게이트웨이가 응답하지 않았다면 다음 확인은 ip neigh로 MAC이 해석됐는지 보는 것입니다.' },
      { title: 'dig — DNS는 빠르고 정확함',
        note:  '1.1.1.1에 직접 질의하니 14ms 만에 TTL 300으로 93.184.216.34를 반환합니다. 이름 해석은 3초 문제의 원인이 아닙니다. @로 리졸버를 고정하면 /etc/resolv.conf 변수가 제거됩니다. 시스템 리졸버로도 반복해 결과가 다른지 비교하세요.' },
      { title: '서버 ping — 100% 손실… 하지만 함정',
        note:  'echo 응답이 전혀 없습니다. 서버가 죽었다고 단정하고 싶어지지만, 많은 서버와 클라우드 엣지는 ICMP echo를 조용히 버립니다. ICMP는 앱이 쓰는 프로토콜과 다릅니다. 교훈: 결론 내기 전에 애플리케이션과 같은 프로토콜, 같은 포트로 테스트하세요.' },
      { title: 'traceroute -T -p 443 — TCP 경로는 정상',
        note:  '443 포트로 TCP SYN 프로브를 보내니 모든 홉이 응답하고 마지막 홉은 11ms의 서버 자신입니다. 3번 홉의 *는 그 라우터가 프로브에 응답하지 않는 것일 뿐, 이후 홉이 응답하므로 손실이 아닙니다. 손실률이 포함된 지속적인 홉별 뷰는 mtr -rwzbc 100을 쓰세요 (MTR 노트 참고).' },
      { title: 'nc -zv — 443 포트 열림',
        note:  '"succeeded"는 TCP 핸드셰이크가 완료됐다는 뜻입니다. 나머지 두 결과도 알아 두세요: "refused"는 RST — 호스트에는 도달했지만 리슨 중인 프로세스가 없거나 REJECT 규칙; "timed out"은 방화벽의 조용한 DROP. -w 3은 DROP 시 2분씩 멈추는 것을 막습니다.' },
      { title: 'curl -w — 3초가 실제로 어디서 쓰이는가',
        note:  'write-out 타이밍은 시작 기준 누적값입니다: TCP 연결 26ms (DNS 포함), TLS 완료 71ms, 첫 바이트 3.118초. 빼 보면 네트워크와 TLS는 합쳐서 ~70ms이고, 서버는 요청을 받은 뒤 첫 바이트를 보내기까지 ~3.05초를 소비합니다. 문제는 네트워크가 아니라 애플리케이션입니다.' },
      { title: 'tcpdump — 와이어 위의 증거',
        note:  '캡처가 이를 확인합니다: 핸드셰이크는 11ms, 요청(98바이트)은 11ms 뒤 ACK, 그리고 첫 응답 세그먼트까지 3.0초 동안 침묵. 재전송도 리셋도 없습니다. 이 기록이 애플리케이션 팀에 문제를 넘길 때 첨부할 증거입니다.' },
      { title: 'iperf3 — 대역폭 배제',
        note:  '양 끝을 모두 제어할 수 있다면(서버 근처 테스트 호스트에서 iperf3 -s) 순수 용량을 측정합니다: 역방향 스트림 4개로 재전송 0, ~940 Mbit/s. 파이프는 깨끗하고 최고 속도입니다. 결론: 네트워크는 종단 간 정상이고, 지연은 서버 처리 시간입니다.' },
    ],
    toolsTitle:   '도구 레퍼런스 — 플래그와 유용한 명령',
    flagsLabel:   '플래그',
    flagHeaders:  ['플래그', '의미'],
    cmdsLabel:    '유용한 명령',
    gotchaLabel:  '주의점',
    bpTitle:   'Best practices',
    bpHeaders: ['원칙', '이유'],
    bpRows: [
      ['아래에서 위로, 한 번에 변수 하나', '각 테스트는 한 구간 또는 한 레이어만 증명합니다. 두 가지를 동시에 바꾸면 무엇이 원인이었는지 알 수 없습니다.'],
      ['앱과 같은 프로토콜과 포트로 테스트', 'ICMP는 TCP/443과 다르게 필터링되고 속도 제한됩니다. 앱 문제에는 ping보다 traceroute -T, nc, curl을 쓰세요.'],
      ['항상 -n', '역방향 DNS 조회는 출력을 느리게 하고, 타임아웃되며, DNS 장애 중에는 오해를 부릅니다.'],
      ['모든 명령에 한도를', '-c, -w, -m, --max-time, -C/-W. 운영 호스트에서 무제한 ping이나 tcpdump는 소음이자 위험입니다.'],
      ['변수 고정', 'dig @server, curl --resolve, -4 / -6, ping -I로 리졸버, 백엔드, 주소 체계, 인터페이스를 정확히 지정하세요.'],
      ['양 끝에서 측정', '클라이언트 캡처와 서버 캡처를 함께 보면 "중간 어딘가"가 패킷이 사라지는 정확한 지점이 됩니다.'],
      ['타임스탬프와 함께 증거 저장', 'ping -D, tcpdump -w, mtr -r, curl -w. 원본 출력이 담긴 티켓은 훨씬 빨리 해결됩니다.'],
      ['기준값을 알아 두기', '평소 RTT, 처리량, 홉 목록을 알면 이상 징후가 바로 보입니다. 정상일 때 기록해 두세요.'],
    ],
  },
}

// ── Graph ──────────────────────────────────────────────────────────────────────

function NtGraph({ frame, t }: { frame: NtFrame; t: typeof T['en'] }) {
  return (
    <div className="nt-graph-canvas">
      <svg viewBox={`0 0 ${W} ${H}`} className="nt-graph-svg" preserveAspectRatio="none">
        <defs>
          {LINKS.map(({ id }) => (
            <path key={id} id={`ntp-${id}`} d={LINK_PATHS[id]} fill="none" />
          ))}
          {LINKS.map(({ id }) => (
            <path key={`${id}_rev`} id={`ntp-${id}_rev`} d={LINK_PATHS_REV[id]} fill="none" />
          ))}
        </defs>

        {/* Link lines */}
        {LINKS.map(({ id, from, to }) => {
          const [x1, y1] = NODE_PX[from]
          const [x2, y2] = NODE_PX[to]
          return (
            <line key={id} x1={x1} y1={y1} x2={x2} y2={y2}
              className={`nt-sline nt-sline-${frame.links[id]}`} strokeWidth="2" />
          )
        })}

        {/* Animated dots — forward, plus a reply dot on bidirectional links */}
        {LINKS.map(({ id }) => {
          if (frame.links[id] !== 'active') return null
          return (
            <g key={`dot-${id}`}>
              <circle r="5" className="nt-gdot">
                <animateMotion dur="1.0s" repeatCount="indefinite">
                  <mpath href={`#ntp-${id}`} />
                </animateMotion>
              </circle>
              {frame.bidir.includes(id) && (
                <circle r="4" className="nt-gdot nt-gdot-reply">
                  <animateMotion dur="1.0s" begin="0.5s" repeatCount="indefinite">
                    <mpath href={`#ntp-${id}_rev`} />
                  </animateMotion>
                </circle>
              )}
            </g>
          )
        })}
      </svg>

      {/* Link labels — HTML to avoid SVG scale distortion */}
      {LINKS.map(({ id, from, to }) => {
        const [x1, y1] = NODE_PX[from]
        const [x2, y2] = NODE_PX[to]
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        const dx = x2 - x1, dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const ox = (-dy / len) * 16
        const oy = ( dx / len) * 16
        const st = frame.links[id]
        return (
          <span key={`lbl-${id}`}
            className={`graph-linklabel${st !== 'idle' ? ' graph-linklabel-on' : ''}`}
            style={{ left: `${((mx + ox) / W) * 100}%`, top: `${((my - Math.abs(oy)) / H) * 100}%` }}
          >
            {t.linkLabel[id]}
          </span>
        )
      })}

      {/* Node boxes */}
      {NODE_IDS.map(nid => {
        const [px, py] = NODE_PX[nid]
        const st = frame.nodes[nid]
        const badge = st === 'ok' || st === 'fail' || st === 'capture' ? t.badge[st] : null
        return (
          <div key={nid}
            className={`nt-gnode nt-gnode-${st}`}
            style={{ left: `${(px / W) * 100}%`, top: `${(py / H) * 100}%` }}
          >
            <span className="nt-gnode-label">{t.nodeLabel[nid]}</span>
            <span className="nt-gnode-sub">{t.nodeSub[nid]}</span>
            {badge && <span className={`nt-badge nt-badge-${st}`}>{badge}</span>}
          </div>
        )
      })}
    </div>
  )
}

// ── Copy button ────────────────────────────────────────────────────────────────

// Strip trailing "# ..." annotations so the copied line runs as-is.
function stripComment(line: string) {
  return line.replace(/\s+#\s.*$/, '')
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1400)
    } catch { /* clipboard unavailable — ignore */ }
  }

  return (
    <button type="button" className={`nt-copy${copied ? ' nt-copy-done' : ''}`}
      onClick={copy} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        {copied
          ? <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          : <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 8.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v8.25A2.25 2.25 0 0 0 6 16.5h2.25m8.25-8.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-7.5A2.25 2.25 0 0 1 8.25 18v-1.5m8.25-8.25h-6a2.25 2.25 0 0 0-2.25 2.25v6" />}
      </svg>
    </button>
  )
}

// ── Terminal panel ─────────────────────────────────────────────────────────────

function Terminal({ text }: { text: string }) {
  return (
    <pre className="nt-term-pre">
      {text.split('\n').map((line, i) => (
        <span key={i} className={line.startsWith('$ ') ? 'nt-term-cmd' : undefined}>
          {line}{'\n'}
        </span>
      ))}
    </pre>
  )
}

function termCommands(text: string) {
  return text.split('\n').filter(l => l.startsWith('$ ')).map(l => l.slice(2)).join('\n')
}

// ── Explorer ───────────────────────────────────────────────────────────────────

function NtExplorer() {
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
    timerRef.current = setTimeout(() => setStep(s => s + 1), 2200)
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
      <NtGraph frame={frame} t={t} />

      <div className="nt-term">
        <div className="nt-term-head">
          <span>{t.termLabel}</span>
          <span className="nt-term-head-right">
            <span className="nt-layer-chip">{frame.layer}</span>
            <CopyBtn text={termCommands(frame.term)} label={t.copyLabel} />
          </span>
        </div>
        <Terminal text={frame.term} />
        <div className="nt-anatomy">
          <span className="nt-anatomy-label">{t.anatomyLabel}</span>
          {frame.flags.map(fl => (
            <div key={fl.f} className="nt-anatomy-row">
              <code className="nt-anatomy-flag">{fl.f}</code>
              <span className="nt-anatomy-desc">{fl[lang]}</span>
            </div>
          ))}
        </div>
      </div>

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

// ── Tool reference ─────────────────────────────────────────────────────────────

function ToolReference() {
  const { lang } = useLang()
  const t = T[lang]
  const [toolId, setToolId] = useState(TOOLS[0].id)
  const tool = TOOLS.find(x => x.id === toolId) ?? TOOLS[0]

  return (
    <div className="ov-proto-section">
      <div className="bgp2-section-title">{t.toolsTitle}</div>

      <div className="nt-tool-tabs" role="tablist">
        {TOOLS.map(x => (
          <button key={x.id} role="tab" aria-selected={x.id === toolId}
            className={`nt-tool-tab${x.id === toolId ? ' nt-tool-tab-active' : ''}`}
            onClick={() => setToolId(x.id)}
          >
            {x.name}
          </button>
        ))}
      </div>

      <div className="nt-tool-card">
        <div className="nt-tool-head">
          <span className="nt-tool-name">{tool.name}</span>
          <span className="nt-layer-chip">{tool.layer}</span>
        </div>
        <p className="nt-tool-purpose">{tool.purpose[lang]}</p>

        <div className="nt-sub-title">{t.cmdsLabel}</div>
        <div className="nt-cmd-grid">
          {tool.cmds.map(cmd => (
            <div key={cmd.c} className="nt-cmd-card">
              <div className="nt-cmd-when">{cmd.when[lang]}</div>
              <div className="nt-cmd-code">
                {cmd.c.split('\n').map(line => (
                  <div key={line} className="nt-cmd-line">
                    <code className="nt-cmd-text">{line}</code>
                    <CopyBtn text={stripComment(line)} label={t.copyLabel} />
                  </div>
                ))}
              </div>
              <div className="nt-cmd-why">{cmd.why[lang]}</div>
            </div>
          ))}
        </div>

        <div className="nt-sub-title">{t.flagsLabel}</div>
        <table className="ov-proto-table nt-flag-table">
          <thead>
            <tr>{t.flagHeaders.map(h => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {tool.flags.map(fl => (
              <tr key={fl.f}>
                <td><code>{fl.f}</code></td>
                <td>{fl[lang]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="nt-gotcha">
          <span className="nt-gotcha-label">{t.gotchaLabel}</span>
          <span>{tool.gotcha[lang]}</span>
        </div>
      </div>
    </div>
  )
}

// ── Best practices ─────────────────────────────────────────────────────────────

function BestPractices() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <div className="ov-proto-section">
      <div className="bgp2-section-title">{t.bpTitle}</div>
      <table className="ov-proto-table nt-bp-table">
        <thead>
          <tr>{t.bpHeaders.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.bpRows.map(row => (
            <tr key={row[0]}>
              <td><strong>{row[0]}</strong></td>
              <td>{row[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function NetToolsPage() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-09-30"
      readTime={t.readTime}
      tags={['networking', 'troubleshooting', 'tools', 'linux', 'dns', 'tcp']}
      intro={t.intro}
    >
      <NtExplorer />
      <ToolReference />
      <BestPractices />
    </NoteLayout>
  )
}
