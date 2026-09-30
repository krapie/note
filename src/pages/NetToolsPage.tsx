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

interface ToolRef {
  id:      string
  name:    string
  layer:   string
  purpose: Bi
  flags:   FlagNote[]
  cmds:    Array<Bi & { c: string }>
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
`$ time curl -s -o /dev/null https://api.example.com/v1/orders

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
`$ dig @1.1.1.1 api.example.com +noall +answer +stats
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
`$ ping -c 4 -W 1 93.184.216.34
PING 93.184.216.34 (93.184.216.34) 56(84) bytes of data.

--- 93.184.216.34 ping statistics ---
4 packets transmitted, 0 received, 100% packet loss, time 3062ms`,
    flags: [
      { f: '-c 4', en: 'send 4 echo requests',                          ko: 'echo 요청 4개 전송' },
      { f: '-W 1', en: 'wait at most 1 s for each reply',               ko: '응답마다 최대 1초 대기' },
    ] },
  // 5: tcp traceroute
  { nodes: { ...N0, client: 'ok', gw: 'ok', isp: 'active', dns: 'ok', server: 'active' },
    links: PATH_ON, bidir: [], layer: 'L3 · path (TCP)',
    term:
`$ sudo traceroute -n -T -p 443 -q 1 93.184.216.34
traceroute to 93.184.216.34, 30 hops max, 60 byte packets
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
`$ curl -sS -o /dev/null \\
    -w "dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} code=%{http_code}\\n" \\
    https://api.example.com/v1/orders
dns=0.014 tcp=0.026 tls=0.071 ttfb=3.118 total=3.121 code=200`,
    flags: [
      { f: '-sS',                   en: 'silent, but still show errors',                          ko: '조용히, 단 에러는 표시' },
      { f: '-o /dev/null',          en: 'discard the body — only the metrics matter',             ko: '본문 버림 — 지표만 필요' },
      { f: '-w "…"',                en: 'write-out: print variables after the transfer',          ko: 'write-out: 전송 후 변수 출력' },
      { f: '%{time_connect}',       en: 'TCP handshake done (seconds since start)',               ko: 'TCP 핸드셰이크 완료 시점 (시작 기준 누적 초)' },
      { f: '%{time_appconnect}',    en: 'TLS handshake done',                                     ko: 'TLS 핸드셰이크 완료 시점' },
      { f: '%{time_starttransfer}', en: 'first response byte (TTFB)',                             ko: '첫 응답 바이트 도착 시점 (TTFB)' },
    ] },
  // 8: tcpdump
  { nodes: { ...N0, client: 'capture', gw: 'ok', isp: 'ok', dns: 'ok', server: 'active' },
    links: { ...L0, client_gw: 'active', gw_isp: 'done', isp_srv: 'done', isp_dns: 'done' }, bidir: ['client_gw'], layer: 'L2–L4 · wire',
    term:
`$ sudo tcpdump -nni eth0 -c 6 "host 93.184.216.34 and tcp port 443"
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
      { f: '"host … and tcp port 443"', en: 'BPF filter — only this flow, applied in the kernel', ko: 'BPF 필터 — 이 흐름만, 커널에서 적용' },
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
      en: 'The local view first: is the interface up, does it have an address, and which route and source IP will the kernel actually pick for a destination?',
      ko: '로컬부터 확인합니다: 인터페이스가 UP인지, 주소가 있는지, 커널이 특정 목적지에 대해 실제로 어떤 경로와 출발지 IP를 고르는지.',
    },
    flags: [
      { f: '-br',             en: 'brief — one line per interface',                                           ko: 'brief — 인터페이스당 한 줄' },
      { f: '-c',              en: 'colorize state and addresses',                                             ko: '상태와 주소를 색으로 구분' },
      { f: '-s  (-s -s)',     en: 'statistics: RX/TX bytes, errors, drops, overruns (twice = more detail)',   ko: '통계: RX/TX 바이트, 에러, 드롭, 오버런 (두 번 = 상세)' },
      { f: '-4 / -6',         en: 'limit output to one address family',                                       ko: '한 주소 체계만 출력' },
      { f: 'route get <dst>', en: 'which route, next hop, device and source IP the kernel would use',         ko: '커널이 사용할 경로, 넥스트홉, 장치, 출발지 IP' },
      { f: 'neigh',           en: 'ARP / NDP neighbor cache — FAILED or INCOMPLETE means no L2 reply',        ko: 'ARP / NDP 이웃 캐시 — FAILED, INCOMPLETE는 L2 응답 없음' },
    ],
    cmds: [
      { c: 'ip -br -c addr',                en: 'At-a-glance interface state and IPs.',                                   ko: '인터페이스 상태와 IP를 한눈에.' },
      { c: 'ip route get 93.184.216.34',    en: 'Which gateway and interface win for this destination — catches VPN and policy-routing surprises.', ko: '이 목적지에 어떤 게이트웨이와 인터페이스가 쓰이는지 — VPN, 정책 라우팅 함정 확인.' },
      { c: 'ip -s -s link show eth0',       en: 'Errors, drops, overruns — bad cable, duplex mismatch, or full ring buffer.', ko: '에러, 드롭, 오버런 — 불량 케이블, duplex 불일치, 링 버퍼 포화.' },
      { c: 'ip neigh show dev eth0',        en: 'Is the gateway MAC resolved? REACHABLE / STALE vs FAILED.',             ko: '게이트웨이 MAC이 해석됐는지? REACHABLE / STALE vs FAILED.' },
    ],
    gotcha: {
      en: 'ifconfig, route and arp (net-tools) are deprecated and hide secondary addresses and policy routes. Use iproute2.',
      ko: 'ifconfig, route, arp(net-tools)는 폐기 예정이며 보조 주소와 정책 라우트를 보여주지 않습니다. iproute2를 쓰세요.',
    },
  },
  {
    id: 'ss', name: 'ss', layer: 'L4 · sockets',
    purpose: {
      en: 'Socket state on this host: what is listening, what is connected, and how healthy each TCP connection is (RTT, cwnd, retransmits).',
      ko: '이 호스트의 소켓 상태: 무엇이 리슨 중인지, 무엇이 연결됐는지, 각 TCP 연결이 얼마나 건강한지 (RTT, cwnd, 재전송).',
    },
    flags: [
      { f: '-t / -u',                en: 'TCP / UDP sockets',                                       ko: 'TCP / UDP 소켓' },
      { f: '-l',                     en: 'listening sockets only',                                  ko: '리슨 소켓만' },
      { f: '-a',                     en: 'all sockets — listening and connected',                   ko: '전체 소켓 — 리슨 + 연결' },
      { f: '-n',                     en: 'numeric — no service or host names',                      ko: 'numeric — 서비스명, 호스트명 변환 안 함' },
      { f: '-p',                     en: 'owning process (root to see other users)',                ko: '소유 프로세스 (다른 사용자 것은 root 필요)' },
      { f: '-i',                     en: 'internal TCP info: rtt, cwnd, retrans, send rate',        ko: 'TCP 내부 정보: rtt, cwnd, retrans, 송신 속도' },
      { f: '-o',                     en: 'timers: retransmit, keepalive, time-wait',                ko: '타이머: 재전송, keepalive, time-wait' },
      { f: '-s',                     en: 'summary counts per state',                                ko: '상태별 요약 카운트' },
      { f: 'state <s>',              en: 'filter by TCP state (established, syn-sent, time-wait …)', ko: 'TCP 상태로 필터 (established, syn-sent, time-wait …)' },
      { f: 'dport = :443 / dst <ip>', en: 'filter by remote port or address',                       ko: '원격 포트 또는 주소로 필터' },
    ],
    cmds: [
      { c: 'ss -tlnp',                                           en: 'Is the service listening — and on 0.0.0.0 or only 127.0.0.1?',          ko: '서비스가 리슨 중인지 — 0.0.0.0인지 127.0.0.1뿐인지?' },
      { c: `ss -tan state established '( dport = :443 )'`,       en: 'All established outbound HTTPS connections.',                           ko: '연결된 모든 아웃바운드 HTTPS 연결.' },
      { c: 'ss -tin dst 93.184.216.34',                           en: 'Per-connection rtt, cwnd and retrans — spot a lossy path.',              ko: '연결별 rtt, cwnd, retrans — 손실 경로 발견.' },
      { c: 'ss -tan state syn-sent',                              en: 'Stuck in SYN-SENT = SYN never answered, usually a firewall DROP.',       ko: 'SYN-SENT에 멈춤 = SYN 응답 없음, 대개 방화벽 DROP.' },
      { c: 'ss -s',                                               en: 'Totals — piles of TIME-WAIT or orphaned sockets.',                       ko: '합계 — TIME-WAIT나 orphan 소켓이 쌓였는지.' },
    ],
    gotcha: {
      en: 'A service bound to 127.0.0.1 is reachable only from the host itself — the most common reason a port looks closed from outside.',
      ko: '127.0.0.1에 바인드된 서비스는 호스트 자신만 접근할 수 있습니다 — 외부에서 포트가 닫혀 보이는 가장 흔한 원인입니다.',
    },
  },
  {
    id: 'ping', name: 'ping', layer: 'L3 · ICMP',
    purpose: {
      en: 'L3 reachability and round-trip time using ICMP echo. It proves the IP path works for ICMP — not that TCP/443 works.',
      ko: 'ICMP echo로 L3 도달성과 왕복 시간을 확인합니다. IP 경로가 ICMP에 대해 동작함을 증명할 뿐, TCP/443이 동작함을 증명하지는 않습니다.',
    },
    flags: [
      { f: '-c N',          en: 'stop after N packets',                                          ko: 'N개 후 종료' },
      { f: '-i S',          en: 'interval between packets (below 0.2 s needs root)',             ko: '패킷 간격 (0.2초 미만은 root 필요)' },
      { f: '-W S',          en: 'per-reply timeout',                                             ko: '응답당 타임아웃' },
      { f: '-w S',          en: 'deadline — total run time cap',                                 ko: '데드라인 — 전체 실행 시간 상한' },
      { f: '-s N',          en: 'payload bytes (+28 for IP and ICMP headers)',                   ko: '페이로드 바이트 (IP+ICMP 헤더 28바이트 추가)' },
      { f: '-M do',         en: 'set Don\'t Fragment — path MTU probing',                        ko: 'DF 비트 설정 — 경로 MTU 탐지' },
      { f: '-I <if|addr>',  en: 'source interface or address',                                   ko: '출발 인터페이스 또는 주소' },
      { f: '-4 / -6',       en: 'force IPv4 or IPv6',                                            ko: 'IPv4 또는 IPv6 강제' },
      { f: '-q',            en: 'quiet — summary only',                                          ko: 'quiet — 요약만' },
      { f: '-D',            en: 'prefix each line with a unix timestamp',                        ko: '각 줄에 유닉스 타임스탬프' },
      { f: '-O',            en: 'report a missing reply before sending the next probe',          ko: '다음 전송 전에 응답 누락을 출력' },
    ],
    cmds: [
      { c: 'ping -c 5 -i 0.2 10.0.0.1',                 en: 'Quick gateway check.',                                                           ko: '빠른 게이트웨이 확인.' },
      { c: 'ping -M do -s 1472 -c 3 93.184.216.34',     en: '1472 + 28 = 1500. "message too long" or silence means the path MTU is below 1500.', ko: '1472 + 28 = 1500. "message too long"이나 무응답은 경로 MTU가 1500 미만이라는 뜻.' },
      { c: 'ping -D -O 8.8.8.8 | tee ping.log',         en: 'Long-running timestamped log to correlate intermittent drops.',                   ko: '간헐적 드롭을 시간과 대조하기 위한 장시간 타임스탬프 로그.' },
      { c: 'ping -I eth1 -c 3 1.1.1.1',                 en: 'Test one specific uplink on a multi-homed host.',                                 ko: '멀티홈 호스트에서 특정 업링크만 테스트.' },
      { c: 'ping -c 100 -i 0.2 -q 93.184.216.34',       en: 'Loss % and mdev (jitter) summary only.',                                          ko: '손실률과 mdev(지터) 요약만.' },
    ],
    gotcha: {
      en: 'Many hosts and clouds drop ICMP echo. 100% loss to a server whose TCP port works is normal — confirm with nc or curl.',
      ko: '많은 호스트와 클라우드가 ICMP echo를 드롭합니다. TCP 포트가 동작하는 서버에 100% 손실은 흔한 일입니다 — nc나 curl로 확인하세요.',
    },
  },
  {
    id: 'traceroute', name: 'traceroute', layer: 'L3 · path',
    purpose: {
      en: 'Discover the hop-by-hop L3 path by sending probes with increasing TTL and reading each router\'s ICMP Time Exceeded reply.',
      ko: 'TTL을 1씩 늘린 프로브를 보내고 각 라우터의 ICMP Time Exceeded 응답을 읽어 홉 단위 L3 경로를 찾습니다.',
    },
    flags: [
      { f: '-n',     en: 'no reverse DNS per hop',                                            ko: '홉별 역방향 DNS 조회 안 함' },
      { f: '-I',     en: 'ICMP echo probes',                                                  ko: 'ICMP echo 프로브' },
      { f: '-T',     en: 'TCP SYN probes (root) — pass firewalls that allow the app port',    ko: 'TCP SYN 프로브 (root) — 앱 포트를 허용하는 방화벽 통과' },
      { f: '-U',     en: 'UDP probes to ports 33434+ (Linux default)',                        ko: '33434+ 포트로 UDP 프로브 (Linux 기본)' },
      { f: '-p N',   en: 'destination port (with -T, use the app port)',                      ko: '목적지 포트 (-T와 함께 앱 포트 사용)' },
      { f: '-q N',   en: 'probes per hop (default 3)',                                        ko: '홉당 프로브 수 (기본 3)' },
      { f: '-w S',   en: 'wait time per probe',                                               ko: '프로브당 대기 시간' },
      { f: '-m N',   en: 'max TTL (default 30)',                                              ko: '최대 TTL (기본 30)' },
      { f: '-f N',   en: 'start at TTL N — skip known local hops',                            ko: 'TTL N부터 시작 — 알려진 로컬 홉 건너뜀' },
      { f: '-A',     en: 'look up the AS number of each hop',                                 ko: '홉마다 AS 번호 조회' },
    ],
    cmds: [
      { c: 'sudo traceroute -n -T -p 443 api.example.com', en: 'Follow the same protocol and port as the app.',           ko: '앱과 같은 프로토콜과 포트로 추적.' },
      { c: 'traceroute -n -I 1.1.1.1',                     en: 'ICMP path when UDP probes are filtered.',                 ko: 'UDP 프로브가 막혔을 때 ICMP 경로.' },
      { c: 'traceroute -n -q 1 -w 1 -m 20 8.8.8.8',        en: 'Fast single-probe pass.',                                 ko: '빠른 단일 프로브 패스.' },
      { c: 'traceroute -n -A 93.184.216.34',               en: 'Which networks (ASes) the path crosses.',                 ko: '경로가 어떤 네트워크(AS)를 거치는지.' },
    ],
    gotcha: {
      en: '"* * *" at a middle hop while later hops answer means that router doesn\'t reply to probes — not packet loss.',
      ko: '중간 홉이 "* * *"인데 이후 홉이 응답한다면 그 라우터가 프로브에 응답하지 않을 뿐, 패킷 손실이 아닙니다.',
    },
  },
  {
    id: 'mtr', name: 'mtr', layer: 'L3 · path + loss',
    purpose: {
      en: 'traceroute and ping combined, run continuously: per-hop loss and latency over many cycles. The best tool for intermittent loss and for ISP tickets.',
      ko: 'traceroute와 ping을 결합해 계속 실행합니다: 여러 사이클에 걸친 홉별 손실과 지연. 간헐적 손실 분석과 ISP 티켓에 가장 좋은 도구입니다.',
    },
    flags: [
      { f: '-r',       en: 'report mode — run, then print a table (no TUI)',   ko: 'report 모드 — 실행 후 표 출력 (TUI 없음)' },
      { f: '-w',       en: 'wide — don\'t truncate hostnames',                  ko: 'wide — 호스트명 자르지 않음' },
      { f: '-z',       en: 'show AS number per hop',                            ko: '홉별 AS 번호 표시' },
      { f: '-b',       en: 'show both hostname and IP',                         ko: '호스트명과 IP 모두 표시' },
      { f: '-n',       en: 'no DNS',                                            ko: 'DNS 조회 안 함' },
      { f: '-c N',     en: 'cycles (probes per hop)',                           ko: '사이클 수 (홉당 프로브 수)' },
      { f: '-T / -u',  en: 'TCP SYN / UDP probes',                              ko: 'TCP SYN / UDP 프로브' },
      { f: '-P N',     en: 'destination port (with -T or -u)',                  ko: '목적지 포트 (-T 또는 -u와 함께)' },
      { f: '-i S',     en: 'interval between cycles',                           ko: '사이클 간격' },
      { f: '-4 / -6',  en: 'force address family',                              ko: '주소 체계 강제' },
    ],
    cmds: [
      { c: 'mtr -rwzbc 100 api.example.com',              en: 'The standard report to paste into a ticket.',                       ko: '티켓에 붙이는 표준 리포트.' },
      { c: 'sudo mtr -T -P 443 -rwc 100 api.example.com', en: 'TCP path when ICMP is deprioritized or filtered.',                  ko: 'ICMP가 후순위 처리되거나 막혔을 때 TCP 경로.' },
      { c: 'mtr -n -i 0.5 api.example.com',               en: 'Live interactive view while reproducing an issue.',                 ko: '문제 재현 중 실시간 인터랙티브 뷰.' },
      { c: 'mtr -4 -rwc 200 host  ;  mtr -6 -rwc 200 host', en: 'Compare IPv4 and IPv6 paths — they are often different.',        ko: 'IPv4와 IPv6 경로 비교 — 다른 경우가 많습니다.' },
    ],
    gotcha: {
      en: 'Loss at one middle hop that does not continue to the final hop is ICMP rate-limiting. Real loss persists all the way to the destination. See the MTR note.',
      ko: '중간 한 홉에만 있고 마지막 홉까지 이어지지 않는 손실은 ICMP 속도 제한입니다. 실제 손실은 목적지까지 계속됩니다. MTR 노트 참고.',
    },
  },
  {
    id: 'dig', name: 'dig', layer: 'L7 · DNS',
    purpose: {
      en: 'Query DNS directly — bypassing /etc/hosts and the OS cache — and see exactly which server answered, with what TTL, and how fast.',
      ko: '/etc/hosts와 OS 캐시를 거치지 않고 DNS에 직접 질의해, 어느 서버가 어떤 TTL로 얼마나 빨리 답했는지 정확히 봅니다.',
    },
    flags: [
      { f: '@server',            en: 'query a specific resolver or authoritative server',      ko: '특정 리졸버 또는 권위 서버에 질의' },
      { f: 'A / AAAA / MX / NS / TXT / SOA', en: 'record type (positional, or -t TYPE)',        ko: '레코드 타입 (위치 인자 또는 -t TYPE)' },
      { f: '+short',             en: 'answer data only',                                       ko: '응답 데이터만' },
      { f: '+noall +answer',     en: 'hide everything, then show the answer section (keeps TTL)', ko: '전부 숨기고 answer 섹션만 (TTL 유지)' },
      { f: '+trace',             en: 'iterate from the root yourself, showing every referral',  ko: '루트부터 직접 반복 질의, 모든 위임 표시' },
      { f: '-x <ip>',            en: 'reverse (PTR) lookup',                                   ko: '역방향(PTR) 조회' },
      { f: '+norecurse',         en: 'RD=0 — ask a server only what it knows itself',           ko: 'RD=0 — 서버가 스스로 아는 것만 질의' },
      { f: '+tcp',               en: 'use TCP instead of UDP',                                 ko: 'UDP 대신 TCP 사용' },
      { f: '+dnssec',            en: 'request DNSSEC records (RRSIG)',                         ko: 'DNSSEC 레코드(RRSIG) 요청' },
      { f: '+time=N +tries=N',   en: 'timeout per try and number of tries',                    ko: '시도당 타임아웃과 시도 횟수' },
    ],
    cmds: [
      { c: 'dig +short api.example.com',                       en: 'Quick answer from the system resolver.',                         ko: '시스템 리졸버의 빠른 응답.' },
      { c: 'dig @1.1.1.1 api.example.com +noall +answer',      en: 'Compare resolvers side by side, with TTL.',                      ko: 'TTL과 함께 리졸버끼리 비교.' },
      { c: 'dig +trace api.example.com',                        en: 'Find a broken delegation between root, TLD and authoritative.', ko: '루트, TLD, 권위 서버 사이의 깨진 위임 찾기.' },
      { c: 'dig @ns1.example.com example.com SOA +norecurse',   en: 'Check the authoritative serial after a zone change.',          ko: '존 변경 후 권위 서버의 시리얼 확인.' },
      { c: 'dig -x 93.184.216.34 +short',                       en: 'Reverse PTR for an IP.',                                        ko: 'IP의 역방향 PTR.' },
      { c: 'dig api.example.com AAAA +short',                   en: 'Is there an IPv6 record? Explains "IPv6 first, then fall back" delays.', ko: 'IPv6 레코드가 있는지? "IPv6 먼저 시도 후 폴백" 지연의 원인.' },
    ],
    gotcha: {
      en: 'dig ignores /etc/hosts and nsswitch; your application does not. Use "getent ahosts <name>" to see what the app\'s resolver actually returns.',
      ko: 'dig는 /etc/hosts와 nsswitch를 무시하지만 애플리케이션은 그렇지 않습니다. 앱 리졸버가 실제로 반환하는 값은 "getent ahosts <name>"으로 확인하세요.',
    },
  },
  {
    id: 'nc', name: 'nc', layer: 'L4 · TCP / UDP',
    purpose: {
      en: 'Raw TCP or UDP: can I open a connection to this port? Also a tiny client and server for testing firewalls between two hosts.',
      ko: '순수 TCP 또는 UDP: 이 포트에 연결할 수 있는가? 두 호스트 사이 방화벽을 테스트하는 작은 클라이언트/서버로도 씁니다.',
    },
    flags: [
      { f: '-z',     en: 'zero-I/O scan — connect and close, send nothing',       ko: 'zero-I/O 스캔 — 연결 후 종료, 데이터 없음' },
      { f: '-v',     en: 'verbose — print the result',                            ko: 'verbose — 결과 출력' },
      { f: '-w S',   en: 'connect / idle timeout',                                ko: '연결 / 유휴 타임아웃' },
      { f: '-u',     en: 'UDP instead of TCP',                                    ko: 'TCP 대신 UDP' },
      { f: '-l',     en: 'listen mode',                                           ko: '리슨 모드' },
      { f: '-k',     en: 'keep listening after a client disconnects',             ko: '클라이언트 종료 후에도 계속 리슨' },
      { f: '-n',     en: 'no DNS — IPs only',                                     ko: 'DNS 안 씀 — IP만' },
    ],
    cmds: [
      { c: 'nc -zv -w 3 api.example.com 443',                         en: 'Is the port open end to end?',                          ko: '포트가 종단 간 열려 있는지?' },
      { c: 'nc -zv -w 1 10.0.0.9 20-25',                              en: 'Scan a small port range.',                              ko: '작은 포트 범위 스캔.' },
      { c: 'nc -l 9000   # host B\nnc -v 10.0.0.9 9000   # host A',  en: 'End-to-end firewall test on any port, no service needed.', ko: '서비스 없이 아무 포트로 종단 간 방화벽 테스트.' },
      { c: 'printf "GET / HTTP/1.1\\r\\nHost: example.com\\r\\nConnection: close\\r\\n\\r\\n" | nc example.com 80', en: 'Hand-craft a raw HTTP request.', ko: 'HTTP 요청을 직접 작성해 전송.' },
      { c: 'nc -zvu -w 2 1.1.1.1 53',                                 en: 'UDP check — weak signal, see gotcha.',                  ko: 'UDP 확인 — 신뢰도 낮음, 주의점 참고.' },
    ],
    gotcha: {
      en: 'Three TCP outcomes: succeeded; refused (RST — host is up, nothing listening or REJECT); timed out (silent DROP). UDP "succeeded" proves nothing. Flags differ between openbsd-netcat, ncat and traditional nc.',
      ko: 'TCP 결과는 세 가지: succeeded; refused (RST — 호스트는 살아 있고 리슨 없음 또는 REJECT); timed out (조용한 DROP). UDP "succeeded"는 아무것도 증명하지 않습니다. openbsd-netcat, ncat, traditional nc마다 플래그가 다릅니다.',
    },
  },
  {
    id: 'curl', name: 'curl', layer: 'L7 · HTTP',
    purpose: {
      en: 'The application\'s real protocol: DNS, TCP, TLS and HTTP in one request, with timing for each phase.',
      ko: '애플리케이션의 실제 프로토콜: DNS, TCP, TLS, HTTP를 한 요청으로, 단계별 타이밍과 함께.',
    },
    flags: [
      { f: '-v',                  en: 'verbose — connection, TLS and headers',                  ko: 'verbose — 연결, TLS, 헤더' },
      { f: '-sS',                 en: 'silent but show errors',                                 ko: '조용히, 단 에러는 표시' },
      { f: '-o <file>',           en: 'write body to file (/dev/null to discard)',              ko: '본문을 파일로 (/dev/null이면 버림)' },
      { f: '-w <fmt>',            en: 'write-out variables after the transfer',                 ko: '전송 후 write-out 변수 출력' },
      { f: '-I',                  en: 'HEAD request — headers only',                            ko: 'HEAD 요청 — 헤더만' },
      { f: '-L',                  en: 'follow redirects',                                       ko: '리다이렉트 따라가기' },
      { f: '--resolve h:p:ip',    en: 'pin a hostname to an IP — keeps SNI and Host correct',   ko: '호스트명을 IP로 고정 — SNI와 Host는 그대로' },
      { f: '--connect-to h:p:h2:p2', en: 'send traffic for h:p to another host:port',           ko: 'h:p 트래픽을 다른 host:port로 전송' },
      { f: '--connect-timeout S', en: 'limit the TCP/TLS connect phase',                        ko: 'TCP/TLS 연결 단계 제한' },
      { f: '-m S',                en: 'max total time for the whole request',                  ko: '요청 전체 최대 시간' },
      { f: '-4 / -6',             en: 'force address family',                                   ko: '주소 체계 강제' },
      { f: '--http1.1 / --http2', en: 'force HTTP version',                                     ko: 'HTTP 버전 강제' },
      { f: '-x <proxy>',          en: 'go through a proxy',                                     ko: '프록시 경유' },
      { f: '-k',                  en: 'skip TLS verification — never in scripts or production', ko: 'TLS 검증 생략 — 스크립트나 운영에서는 금지' },
    ],
    cmds: [
      { c: 'curl -sS -o /dev/null -w "dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} code=%{http_code}\\n" https://api.example.com', en: 'Timing breakdown per phase.', ko: '단계별 타이밍 분해.' },
      { c: 'curl -v --resolve api.example.com:443:10.0.0.9 https://api.example.com/health', en: 'Hit one specific backend without touching DNS.', ko: 'DNS를 건드리지 않고 특정 백엔드 하나에 요청.' },
      { c: 'curl -sSIL http://example.com',                          en: 'Show the redirect chain, headers only.',                         ko: '리다이렉트 체인을 헤더만으로 확인.' },
      { c: 'curl -v --connect-timeout 3 -m 10 https://api.example.com', en: 'Bounded request — fails fast instead of hanging.',           ko: '시간 제한 요청 — 멈추지 않고 빨리 실패.' },
      { c: 'curl -6 -sS -o /dev/null -w "%{remote_ip} %{time_connect}\\n" https://api.example.com', en: 'Compare IPv6 against -4.',          ko: '-4와 IPv6 비교.' },
    ],
    gotcha: {
      en: '-w times are cumulative from the start. Subtract: TLS = appconnect − connect; server think time ≈ starttransfer − appconnect.',
      ko: '-w 시간은 시작 기준 누적값입니다. 빼서 계산하세요: TLS = appconnect − connect; 서버 처리 시간 ≈ starttransfer − appconnect.',
    },
  },
  {
    id: 'openssl', name: 'openssl s_client', layer: 'L6 · TLS',
    purpose: {
      en: 'Only the TLS handshake: which certificate chain, protocol version and cipher the server presents — independent of HTTP.',
      ko: 'TLS 핸드셰이크만: 서버가 제시하는 인증서 체인, 프로토콜 버전, 암호 스위트 — HTTP와 독립적으로.',
    },
    flags: [
      { f: '-connect h:p',           en: 'host and port to connect to',                                 ko: '연결할 호스트와 포트' },
      { f: '-servername h',          en: 'SNI — required on shared hosts / CDNs',                        ko: 'SNI — 공유 호스트, CDN에서 필수' },
      { f: '-brief',                 en: 'short summary: protocol, cipher, peer cert',                   ko: '짧은 요약: 프로토콜, 암호, 상대 인증서' },
      { f: '-showcerts',             en: 'print the full chain sent by the server',                      ko: '서버가 보낸 전체 체인 출력' },
      { f: '-alpn h2',               en: 'offer ALPN protocols — check HTTP/2 support',                  ko: 'ALPN 제안 — HTTP/2 지원 확인' },
      { f: '-tls1_2 / -tls1_3',      en: 'force one protocol version',                                   ko: '특정 프로토콜 버전 강제' },
      { f: '</dev/null',             en: 'close stdin so the command exits after the handshake',         ko: 'stdin을 닫아 핸드셰이크 후 종료' },
      { f: 'x509 -noout -dates -subject -issuer', en: 'decode the cert: validity, subject, issuer',       ko: '인증서 디코드: 유효기간, subject, issuer' },
      { f: 'x509 -ext subjectAltName', en: 'print the SAN list',                                         ko: 'SAN 목록 출력' },
    ],
    cmds: [
      { c: 'openssl s_client -connect api.example.com:443 -servername api.example.com -brief </dev/null', en: 'Protocol, cipher and peer cert in a few lines.', ko: '프로토콜, 암호, 상대 인증서를 몇 줄로.' },
      { c: 'openssl s_client -connect api.example.com:443 -servername api.example.com </dev/null 2>/dev/null | openssl x509 -noout -dates -subject -issuer', en: 'Certificate expiry and issuer.', ko: '인증서 만료일과 발급자.' },
      { c: 'openssl s_client -connect api.example.com:443 -servername api.example.com </dev/null 2>/dev/null | openssl x509 -noout -ext subjectAltName', en: 'Does the SAN include the name you requested?', ko: 'SAN에 요청한 이름이 포함되는지?' },
      { c: 'openssl s_client -connect api.example.com:443 -servername api.example.com -showcerts </dev/null', en: 'Missing intermediate certificate?', ko: '중간 인증서 누락 여부?' },
      { c: 'openssl s_client -connect api.example.com:443 -servername api.example.com -tls1_2 </dev/null', en: 'Will old clients still connect?', ko: '구형 클라이언트도 연결되는지?' },
    ],
    gotcha: {
      en: 'Without -servername, many servers return their default certificate and you chase a name mismatch that real clients never see.',
      ko: '-servername이 없으면 많은 서버가 기본 인증서를 반환해, 실제 클라이언트는 겪지 않는 이름 불일치를 쫓게 됩니다.',
    },
  },
  {
    id: 'tcpdump', name: 'tcpdump', layer: 'L2–L4 · wire',
    purpose: {
      en: 'Ground truth: packets exactly as they hit the interface. Settles "did we send it?" and "did they answer?" for good.',
      ko: '최종 증거: 인터페이스에 실제로 도달한 패킷 그대로. "우리가 보냈나?", "상대가 답했나?"를 확정합니다.',
    },
    flags: [
      { f: '-i <if>',     en: 'interface (any = all interfaces)',                    ko: '인터페이스 (any = 전체)' },
      { f: '-n / -nn',    en: 'no host names / no host or port names',               ko: '호스트명 변환 안 함 / 호스트명, 포트명 모두 안 함' },
      { f: '-c N',        en: 'stop after N packets',                                 ko: '패킷 N개 후 종료' },
      { f: '-w <file>',   en: 'write raw pcap — open later in Wireshark',             ko: 'pcap 원본 저장 — 나중에 Wireshark로 분석' },
      { f: '-r <file>',   en: 'read a pcap instead of a live interface',              ko: '라이브 대신 pcap 읽기' },
      { f: '-s N',        en: 'snaplen — bytes per packet (0 = full, default 262144)', ko: 'snaplen — 패킷당 캡처 바이트 (0 = 전체, 기본 262144)' },
      { f: '-v / -vv',    en: 'more protocol detail (TTL, IP ID, options)',           ko: '프로토콜 상세 (TTL, IP ID, 옵션)' },
      { f: '-A / -X',     en: 'payload as ASCII / hex + ASCII',                       ko: '페이로드를 ASCII / hex + ASCII로' },
      { f: '-e',          en: 'print link-layer header (MAC addresses)',              ko: '링크 계층 헤더(MAC 주소) 출력' },
      { f: '-tttt',       en: 'full date and time on each line',                      ko: '각 줄에 전체 날짜와 시간' },
      { f: '-C MB / -W N', en: 'rotate files every MB, keep N files (ring buffer)',   ko: 'MB마다 파일 교체, N개 유지 (링 버퍼)' },
      { f: 'BPF filter',  en: 'host, net, port, src/dst, tcp[tcpflags] — applied in the kernel', ko: 'host, net, port, src/dst, tcp[tcpflags] — 커널에서 적용' },
    ],
    cmds: [
      { c: `sudo tcpdump -nni eth0 -c 50 'host 93.184.216.34 and tcp port 443'`,  en: 'One flow, bounded.',                                          ko: '한 흐름만, 개수 제한.' },
      { c: `sudo tcpdump -nni any -w /tmp/cap.pcap -C 100 -W 5 'port 443'`,        en: 'Long capture as a 5 × 100 MB ring buffer for Wireshark.',     ko: 'Wireshark용 5 × 100MB 링 버퍼 장기 캡처.' },
      { c: `sudo tcpdump -nni eth0 'tcp[tcpflags] & (tcp-syn|tcp-rst) != 0'`,      en: 'Only handshakes and resets — cheap on busy hosts.',           ko: '핸드셰이크와 리셋만 — 바쁜 호스트에서도 가벼움.' },
      { c: 'sudo tcpdump -nni eth0 icmp',                                           en: 'ICMP unreachable and "fragmentation needed" messages.',      ko: 'ICMP unreachable과 "fragmentation needed" 메시지.' },
      { c: 'sudo tcpdump -nni eth0 -e arp',                                         en: 'ARP requests and replies with MACs.',                         ko: 'MAC과 함께 ARP 요청/응답.' },
      { c: `sudo tcpdump -nni eth0 -A -s 0 'tcp port 80'`,                          en: 'Read plaintext HTTP payloads.',                               ko: '평문 HTTP 페이로드 읽기.' },
    ],
    gotcha: {
      en: 'Always filter on busy hosts and prefer -w over printing. pcaps can contain tokens and passwords — treat them as secrets.',
      ko: '바쁜 호스트에서는 반드시 필터를 걸고 출력보다 -w를 쓰세요. pcap에는 토큰과 비밀번호가 들어 있을 수 있으니 비밀로 취급하세요.',
    },
  },
  {
    id: 'iperf3', name: 'iperf3', layer: 'L4 · throughput',
    purpose: {
      en: 'Measure achievable throughput, loss and jitter between two hosts you control — separating "network capacity" from "application speed".',
      ko: '직접 제어하는 두 호스트 사이의 처리량, 손실, 지터를 측정해 "네트워크 용량"과 "애플리케이션 속도"를 분리합니다.',
    },
    flags: [
      { f: '-s',        en: 'server mode (listens on 5201)',                              ko: '서버 모드 (5201 리슨)' },
      { f: '-c <host>', en: 'client mode — connect to the server',                        ko: '클라이언트 모드 — 서버에 연결' },
      { f: '-p N',      en: 'port (default 5201)',                                        ko: '포트 (기본 5201)' },
      { f: '-t S',      en: 'test duration (default 10 s)',                               ko: '테스트 시간 (기본 10초)' },
      { f: '-P N',      en: 'parallel streams',                                           ko: '병렬 스트림 수' },
      { f: '-R',        en: 'reverse — server sends, client receives',                    ko: 'reverse — 서버가 송신, 클라이언트가 수신' },
      { f: '--bidir',   en: 'both directions at once',                                    ko: '양방향 동시' },
      { f: '-u',        en: 'UDP — reports loss and jitter',                              ko: 'UDP — 손실과 지터 보고' },
      { f: '-b rate',   en: 'target bitrate (UDP default is only 1 Mbit/s)',              ko: '목표 비트레이트 (UDP 기본은 1 Mbit/s뿐)' },
      { f: '-O N',      en: 'omit the first N seconds (TCP slow start)',                  ko: '처음 N초 제외 (TCP 슬로 스타트)' },
      { f: '-i S',      en: 'report interval',                                            ko: '리포트 간격' },
      { f: '-J',        en: 'JSON output for scripts',                                    ko: '스크립트용 JSON 출력' },
      { f: '-C algo',   en: 'congestion control (cubic, bbr) — Linux',                    ko: '혼잡 제어 알고리즘 (cubic, bbr) — Linux' },
    ],
    cmds: [
      { c: 'iperf3 -s',                              en: 'Run on the far host.',                                         ko: '반대편 호스트에서 실행.' },
      { c: 'iperf3 -c 10.0.2.10 -t 30 -O 3',         en: 'Upload baseline, slow start excluded.',                        ko: '업로드 기준값, 슬로 스타트 제외.' },
      { c: 'iperf3 -c 10.0.2.10 -R -P 4 -t 30',      en: 'Download with 4 streams — beats single-flow window limits.',    ko: '4개 스트림 다운로드 — 단일 흐름 윈도 한계 극복.' },
      { c: 'iperf3 -c 10.0.2.10 -u -b 200M -t 10',   en: 'UDP at a fixed rate — loss % and jitter.',                     ko: '고정 속도 UDP — 손실률과 지터.' },
      { c: 'iperf3 -c 10.0.2.10 -J > result.json',   en: 'Machine-readable result for trending.',                        ko: '추세 분석용 기계 판독 결과.' },
    ],
    gotcha: {
      en: 'A single TCP stream is capped by window ÷ RTT; compare -P 1 with -P 4 before blaming the link. Don\'t saturate production links during peak hours.',
      ko: '단일 TCP 스트림은 윈도 ÷ RTT로 제한됩니다; 링크를 탓하기 전에 -P 1과 -P 4를 비교하세요. 피크 시간에 운영 링크를 포화시키지 마세요.',
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
        note:  'The write-out timings are cumulative: DNS 14 ms, TCP connect at 26 ms, TLS done at 71 ms, first byte at 3.118 s. Subtracting, the network and TLS cost ~70 ms total; the server spends ~3.05 s thinking between receiving the request and sending the first byte. The problem is in the application, not the network.' },
      { title: 'tcpdump — proof on the wire',
        note:  'The capture confirms it: handshake completes in 11 ms, the request (98 bytes) is ACKed 11 ms later, then silence for 3.0 s before the first response segment. No retransmits, no resets. This transcript is the evidence you attach when handing the issue to the application team.' },
      { title: 'iperf3 — rule out bandwidth',
        note:  'If you control both ends (a test host near the server running iperf3 -s), measure raw capacity: 4 reverse streams hit ~940 Mbit/s with 0 retransmits. The pipe is clean and full-speed. Verdict: network healthy end to end; the latency is server think time.' },
    ],
    toolsTitle:   'Tool reference — flags and useful commands',
    purposeLabel: 'Purpose',
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
        note:  'write-out 타이밍은 누적값입니다: DNS 14ms, TCP 연결 26ms, TLS 완료 71ms, 첫 바이트 3.118초. 빼 보면 네트워크와 TLS는 합쳐서 ~70ms이고, 서버는 요청을 받은 뒤 첫 바이트를 보내기까지 ~3.05초를 소비합니다. 문제는 네트워크가 아니라 애플리케이션입니다.' },
      { title: 'tcpdump — 와이어 위의 증거',
        note:  '캡처가 이를 확인합니다: 핸드셰이크는 11ms, 요청(98바이트)은 11ms 뒤 ACK, 그리고 첫 응답 세그먼트까지 3.0초 동안 침묵. 재전송도 리셋도 없습니다. 이 기록이 애플리케이션 팀에 문제를 넘길 때 첨부할 증거입니다.' },
      { title: 'iperf3 — 대역폭 배제',
        note:  '양 끝을 모두 제어할 수 있다면(서버 근처 테스트 호스트에서 iperf3 -s) 순수 용량을 측정합니다: 역방향 스트림 4개로 재전송 0, ~940 Mbit/s. 파이프는 깨끗하고 최고 속도입니다. 결론: 네트워크는 종단 간 정상이고, 지연은 서버 처리 시간입니다.' },
    ],
    toolsTitle:   '도구 레퍼런스 — 플래그와 유용한 명령',
    purposeLabel: '용도',
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
          <span className="nt-layer-chip">{frame.layer}</span>
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

        <div className="nt-sub-title">{t.cmdsLabel}</div>
        <ul className="nt-cmd-list">
          {tool.cmds.map(cmd => (
            <li key={cmd.c} className="nt-cmd-item">
              <pre className="nt-cmd-code">{cmd.c}</pre>
              <span className="nt-cmd-desc">{cmd[lang]}</span>
            </li>
          ))}
        </ul>

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
      <table className="ov-proto-table">
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
