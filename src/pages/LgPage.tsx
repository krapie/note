import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type NodeId     = 'eng' | 'pdb' | 'lg' | 'router'
type NodeStatus = 'idle' | 'active' | 'done'
type LinkId     = 'eng_pdb' | 'eng_lg' | 'lg_router'
type LinkStatus = 'idle' | 'query' | 'internal' | 'done'
type PanelMode  = 'none' | 'pdb-querying' | 'pdb-result' | 'lg-querying' | 'lg-bgp' | 'lg-trace'

interface LgFrame {
  nodes:  Record<NodeId, NodeStatus>
  links:  Record<LinkId, LinkStatus>
  panel:  PanelMode
}

// ── Graph geometry ─────────────────────────────────────────────────────────────

const LGW = 480
const LGH = 200

const NODE_PX: Record<NodeId, [number, number]> = {
  eng:    [80,  100],
  pdb:    [260,  45],
  lg:     [260, 155],
  router: [420, 155],
}

const NODE_IDS: NodeId[] = ['eng', 'pdb', 'lg', 'router']

const LINKS: Array<{ id: LinkId; from: NodeId; to: NodeId }> = [
  { id: 'eng_pdb',   from: 'eng', to: 'pdb'    },
  { id: 'eng_lg',    from: 'eng', to: 'lg'     },
  { id: 'lg_router', from: 'lg',  to: 'router' },
]

const LINK_PATHS: Record<LinkId, string> = {
  eng_pdb:   `M ${NODE_PX.eng[0]} ${NODE_PX.eng[1]} L ${NODE_PX.pdb[0]} ${NODE_PX.pdb[1]}`,
  eng_lg:    `M ${NODE_PX.eng[0]} ${NODE_PX.eng[1]} L ${NODE_PX.lg[0]}  ${NODE_PX.lg[1]}`,
  lg_router: `M ${NODE_PX.lg[0]}  ${NODE_PX.lg[1]}  L ${NODE_PX.router[0]} ${NODE_PX.router[1]}`,
}

// ── Frame data ─────────────────────────────────────────────────────────────────

const N0: Record<NodeId, NodeStatus> = { eng: 'idle', pdb: 'idle', lg: 'idle', router: 'idle' }
const L0: Record<LinkId, LinkStatus> = { eng_pdb: 'idle', eng_lg: 'idle', lg_router: 'idle' }

const FRAMES: LgFrame[] = [
  { nodes: N0,                                                          links: L0,                                              panel: 'none'        },
  { nodes: { ...N0, eng: 'active', pdb: 'active' },                    links: { ...L0, eng_pdb: 'query' },                    panel: 'pdb-querying' },
  { nodes: { ...N0, eng: 'done',   pdb: 'done'   },                    links: { ...L0, eng_pdb: 'done'  },                    panel: 'pdb-result'   },
  { nodes: { ...N0, eng: 'active', pdb: 'done', lg: 'active' },        links: { ...L0, eng_pdb: 'done', eng_lg: 'query' },    panel: 'lg-querying'  },
  { nodes: { ...N0, eng: 'active', pdb: 'done', lg: 'active', router: 'active' }, links: { ...L0, eng_pdb: 'done', eng_lg: 'query', lg_router: 'internal' }, panel: 'lg-querying' },
  { nodes: { ...N0, eng: 'done',   pdb: 'done', lg: 'done',   router: 'done'   }, links: { ...L0, eng_pdb: 'done', eng_lg: 'done', lg_router: 'done'     }, panel: 'lg-bgp'      },
  { nodes: { ...N0, eng: 'done',   pdb: 'done', lg: 'done',   router: 'done'   }, links: { ...L0, eng_pdb: 'done', eng_lg: 'done', lg_router: 'done'     }, panel: 'lg-trace'    },
]

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title:    'Looking Glass & PeeringDB — BGP visibility tools',
    readTime: '5 min',
    intro:    `PeeringDB and Looking Glass are the two tools every network engineer opens when investigating BGP routing. PeeringDB is a publicly available database where networks register their ASN, peering policy, IXP memberships, and contacts — the first stop when evaluating a potential peer. Looking Glass is a read-only interface hosted by ISPs and IXPs that lets you run BGP commands against a real production router from the outside, without needing SSH access. Together they let you find a peer, understand their policy, and then verify the actual routing state — all without a ticket.`,
    nodeLabel: {
      eng:    'Engineer',
      pdb:    'PeeringDB',
      lg:     'Looking Glass',
      router: 'Core Router',
    } as Record<NodeId, string>,
    nodeSub: {
      eng:    'NOC / ops',
      pdb:    'peeringdb.com',
      lg:     'lg.isp.net',
      router: 'BGP daemon',
    } as Record<NodeId, string>,
    linkLabel: {
      eng_pdb:   'HTTPS / API',
      eng_lg:    'HTTP query',
      lg_router: 'internal',
    } as Record<LinkId, string>,
    panelTitle: { pdb: 'PeeringDB', lg: 'Looking Glass' },
    pdbQuerying: 'Querying AS15169…',
    lgQuerying:  'Waiting for router…',
    pdbRows: [
      { label: 'Network',      value: 'Google LLC' },
      { label: 'ASN',          value: 'AS15169' },
      { label: 'Policy',       value: 'Open' },
      { label: 'Prefixes (v4)', value: '12,400+' },
      { label: 'IXP member',   value: 'AMS-IX, DE-CIX, Equinix IX' },
      { label: 'Contact',      value: 'peering@google.com' },
    ],
    lgBgpCmd:    '> show bgp 8.8.8.8',
    lgTraceCmd:  '> traceroute 8.8.8.8',
    lgBgpLines: [
      'BGP routing table entry for 8.8.8.0/24',
      'Paths: (3 available, best #1)',
      '',
      '  15169, (aggregated by 15169 8.8.8.1)',
      '    203.0.113.1 from 203.0.113.1 (203.0.113.1)',
      '    Origin IGP, metric 0, localpref 100',
      '    Community: 15169:25 15169:300',
      '    Best path',
      '',
      '  3356 15169',
      '    198.51.100.5 from 198.51.100.5 (198.51.100.5)',
      '    Origin IGP, localpref 90',
    ],
    lgTraceLines: [
      'traceroute to 8.8.8.8, 30 hops max',
      ' 1  core-gw.isp.net (203.0.113.254)  0.4 ms',
      ' 2  ae1.ams-ix.isp.net (80.249.209.1)  1.1 ms',
      ' 3  google-gw.ams-ix.net (80.249.208.208)  1.3 ms',
      ' 4  8.8.8.8  1.9 ms',
    ],
    frames: [
      {
        title: 'Two tools for BGP visibility',
        note:  'PeeringDB and Looking Glass serve complementary roles. PeeringDB tells you who a network is and what their policy is — before you attempt to peer. Looking Glass tells you what the routing table actually looks like right now, from a specific vantage point on the internet. Neither tool requires login or a support ticket; both are freely accessible to any network operator.',
      },
      {
        title: 'Step 1 — Search PeeringDB for AS15169',
        note:  'The engineer opens peeringdb.com and searches for AS15169 (Google). The PeeringDB record is the canonical place to check peering eligibility: network type, traffic levels, the peering policy (open/selective/restrictive), IXP memberships, and a peering contact. An "Open" policy means they will peer with anyone who meets the technical requirements.',
      },
      {
        title: 'PeeringDB result — open policy, AMS-IX member',
        note:  'AS15169 has an Open peering policy and is a member of AMS-IX, DE-CIX, and Equinix IX. If your network is also a member of any of these IXPs, you can configure a BGP session directly at the exchange — no transit cost, lower latency, higher capacity. The record also lists a peering contact email to notify them of the new session.',
      },
      {
        title: 'Step 2 — Open Looking Glass, query 8.8.8.8',
        note:  'With peering policy confirmed, the engineer opens the upstream ISP\'s Looking Glass to check the current routing state. The query "show bgp 8.8.8.8" runs on the ISP\'s production router and returns all BGP paths the router knows for that destination — before any peering session is configured.',
      },
      {
        title: 'LG queries the BGP daemon on the core router',
        note:  'The Looking Glass server is a thin web frontend that proxies the command to the router via an internal management connection (SSH, NETCONF, or a proprietary API). The router runs the BGP lookup against its Loc-RIB and streams the result back. This is read-only — the LG cannot modify any router state.',
      },
      {
        title: 'BGP result — three paths, best via direct peer',
        note:  'The router returns three paths for 8.8.8.0/24. The best path (marked #1) has AS-PATH "15169" — a single hop, meaning the ISP already peers with Google directly at AMS-IX. The community values (15169:25, 15169:300) tell you the route\'s origin and routing preference inside Google\'s network. Path #2 goes through AS3356 (Lumen) — that would be the transit fallback if direct peering failed.',
      },
      {
        title: 'Traceroute confirms 1-hop path via IXP',
        note:  'A traceroute from the same LG to 8.8.8.8 shows the real forwarding path: ISP core → AMS-IX peering LAN (80.249.209.x) → Google\'s AMS-IX interface → destination. Four hops, under 2 ms RTT to Google\'s DNS. This is the "ground truth" view of how traffic actually flows — BGP tables show control-plane state, traceroute shows the data-plane reality.',
      },
    ],
    cmdTitle:   'Common Looking Glass commands',
    cmdHeaders: ['Command', 'Description'],
    cmds: [
      { cmd: 'show bgp <prefix>',        desc: 'All BGP paths known for a prefix — AS-PATH, next-hop, local-pref, MED, communities, and which path is best.' },
      { cmd: 'show bgp summary',          desc: 'BGP peer table: session state (Established/Active), uptime, and number of prefixes received from each peer.' },
      { cmd: 'show route <prefix>',       desc: 'Best route in the forwarding table (RIB) — the path traffic actually takes, after BGP path selection.' },
      { cmd: 'ping <ip>',                 desc: 'ICMP echo from the ISP\'s router. Useful for checking reachability from their vantage point, not yours.' },
      { cmd: 'traceroute <ip>',           desc: 'Hop-by-hop path from their router to the destination. Shows the real data-plane path, including IXP peering LANs.' },
      { cmd: 'show bgp neighbors <peer>', desc: 'Detailed BGP session info: capabilities negotiated, prefix limits, hold timer, last reset reason.' },
      { cmd: 'show bgp community <val>',  desc: 'Filter routes by BGP community value — useful for finding routes tagged with a specific policy or origin marker.' },
    ],
  },
  ko: {
    title:    'Looking Glass & PeeringDB — BGP 가시성 도구',
    readTime: '5분',
    intro:    `PeeringDB와 Looking Glass는 BGP 라우팅을 조사할 때 모든 네트워크 엔지니어가 여는 두 가지 도구입니다. PeeringDB는 네트워크가 자신의 ASN, 피어링 정책, IXP 멤버십, 연락처를 등록하는 공개 데이터베이스로, 잠재적 피어를 평가할 때 가장 먼저 확인합니다. Looking Glass는 ISP와 IXP가 제공하는 읽기 전용 인터페이스로, SSH 접근 없이도 실제 운영 라우터에서 BGP 커맨드를 실행할 수 있습니다. 두 도구를 함께 사용하면 피어를 찾고, 정책을 파악하고, 실제 라우팅 상태를 검증할 수 있습니다 — 티켓 없이도.`,
    nodeLabel: {
      eng:    '엔지니어',
      pdb:    'PeeringDB',
      lg:     'Looking Glass',
      router: '코어 라우터',
    } as Record<NodeId, string>,
    nodeSub: {
      eng:    'NOC / 운영',
      pdb:    'peeringdb.com',
      lg:     'lg.isp.net',
      router: 'BGP 데몬',
    } as Record<NodeId, string>,
    linkLabel: {
      eng_pdb:   'HTTPS / API',
      eng_lg:    'HTTP 쿼리',
      lg_router: '내부 연결',
    } as Record<LinkId, string>,
    panelTitle: { pdb: 'PeeringDB', lg: 'Looking Glass' },
    pdbQuerying: 'AS15169 조회 중…',
    lgQuerying:  '라우터 응답 대기 중…',
    pdbRows: [
      { label: '네트워크',      value: 'Google LLC' },
      { label: 'ASN',           value: 'AS15169' },
      { label: '피어링 정책',   value: 'Open (오픈)' },
      { label: '프리픽스 (v4)', value: '12,400+' },
      { label: 'IXP 멤버십',   value: 'AMS-IX, DE-CIX, Equinix IX' },
      { label: '피어링 연락처', value: 'peering@google.com' },
    ],
    lgBgpCmd:    '> show bgp 8.8.8.8',
    lgTraceCmd:  '> traceroute 8.8.8.8',
    lgBgpLines: [
      'BGP routing table entry for 8.8.8.0/24',
      'Paths: (3 available, best #1)',
      '',
      '  15169, (aggregated by 15169 8.8.8.1)',
      '    203.0.113.1 from 203.0.113.1 (203.0.113.1)',
      '    Origin IGP, metric 0, localpref 100',
      '    Community: 15169:25 15169:300',
      '    Best path',
      '',
      '  3356 15169',
      '    198.51.100.5 from 198.51.100.5 (198.51.100.5)',
      '    Origin IGP, localpref 90',
    ],
    lgTraceLines: [
      'traceroute to 8.8.8.8, 30 hops max',
      ' 1  core-gw.isp.net (203.0.113.254)  0.4 ms',
      ' 2  ae1.ams-ix.isp.net (80.249.209.1)  1.1 ms',
      ' 3  google-gw.ams-ix.net (80.249.208.208)  1.3 ms',
      ' 4  8.8.8.8  1.9 ms',
    ],
    frames: [
      {
        title: 'BGP 가시성을 위한 두 가지 도구',
        note:  'PeeringDB와 Looking Glass는 상호 보완적인 역할을 합니다. PeeringDB는 특정 네트워크가 누구인지, 피어링 정책이 무엇인지를 알려줍니다 — 피어링 시도 전 사전 조사용입니다. Looking Glass는 현재 라우팅 테이블이 인터넷의 특정 지점에서 실제로 어떻게 보이는지 알려줍니다. 두 도구 모두 로그인이나 지원 티켓 없이 누구나 무료로 사용할 수 있습니다.',
      },
      {
        title: '1단계 — PeeringDB에서 AS15169 검색',
        note:  '엔지니어가 peeringdb.com에서 AS15169(Google)를 검색합니다. PeeringDB 레코드는 피어링 적합성을 확인하는 공식 창구입니다: 네트워크 유형, 트래픽 규모, 피어링 정책(오픈/선택적/제한적), IXP 멤버십, 피어링 연락처. "Open" 정책은 기술 요건을 충족하는 모든 네트워크와 피어링한다는 의미입니다.',
      },
      {
        title: 'PeeringDB 결과 — 오픈 정책, AMS-IX 멤버',
        note:  'AS15169는 오픈 피어링 정책을 가지며 AMS-IX, DE-CIX, Equinix IX의 멤버입니다. 내 네트워크가 이 IXP 중 하나에도 있다면 교환 포인트에서 직접 BGP 세션을 구성할 수 있습니다 — 트랜짓 비용 없이, 더 낮은 레이턴시, 더 높은 용량으로. 레코드에는 새 세션을 알릴 피어링 연락처 이메일도 포함되어 있습니다.',
      },
      {
        title: '2단계 — Looking Glass 열기, 8.8.8.8 쿼리',
        note:  '피어링 정책을 확인한 후 엔지니어가 업스트림 ISP의 Looking Glass를 열어 현재 라우팅 상태를 확인합니다. "show bgp 8.8.8.8" 쿼리가 ISP의 운영 라우터에서 실행되어 해당 목적지에 대해 라우터가 알고 있는 모든 BGP 경로를 반환합니다 — 피어링 세션이 구성되기 전의 현재 상태입니다.',
      },
      {
        title: 'LG가 코어 라우터의 BGP 데몬에 조회',
        note:  'Looking Glass 서버는 내부 관리 연결(SSH, NETCONF, 또는 전용 API)을 통해 커맨드를 라우터에 프록시하는 얇은 웹 프론트엔드입니다. 라우터가 Loc-RIB에서 BGP 조회를 실행하고 결과를 반환합니다. 이는 읽기 전용입니다 — LG는 라우터 상태를 수정할 수 없습니다.',
      },
      {
        title: 'BGP 결과 — 3개 경로, 직접 피어 경유가 최적',
        note:  '라우터가 8.8.8.0/24에 대한 3개 경로를 반환합니다. 최적 경로(#1)의 AS-PATH는 "15169" — 단일 홉으로, ISP가 이미 AMS-IX에서 Google과 직접 피어링하고 있음을 의미합니다. 커뮤니티 값(15169:25, 15169:300)은 Google 네트워크 내 경로의 출처와 라우팅 선호도를 나타냅니다. 경로 #2는 AS3356(Lumen) 경유 — 직접 피어링이 실패할 경우의 트랜짓 대안입니다.',
      },
      {
        title: 'Traceroute로 IXP 경유 1홉 경로 확인',
        note:  '같은 LG에서 8.8.8.8로의 traceroute가 실제 포워딩 경로를 보여줍니다: ISP 코어 → AMS-IX 피어링 LAN(80.249.209.x) → Google AMS-IX 인터페이스 → 목적지. 4홉, RTT 2ms 미만으로 Google DNS에 도달합니다. 이것이 트래픽이 실제로 흐르는 방식의 "ground truth"입니다 — BGP 테이블은 컨트롤 플레인 상태를, traceroute는 데이터 플레인 현실을 보여줍니다.',
      },
    ],
    cmdTitle:   'Looking Glass 주요 커맨드',
    cmdHeaders: ['커맨드', '설명'],
    cmds: [
      { cmd: 'show bgp <prefix>',        desc: '프리픽스에 대한 모든 BGP 경로 — AS-PATH, 넥스트홉, local-pref, MED, 커뮤니티, 최적 경로 표시.' },
      { cmd: 'show bgp summary',          desc: 'BGP 피어 테이블: 세션 상태(Established/Active), 업타임, 각 피어에서 수신한 프리픽스 수.' },
      { cmd: 'show route <prefix>',       desc: '포워딩 테이블(RIB)의 최적 경로 — BGP 경로 선택 후 트래픽이 실제로 취하는 경로.' },
      { cmd: 'ping <ip>',                 desc: 'ISP 라우터에서 ICMP echo 실행. 내 관점이 아닌 ISP 관점에서의 도달 가능성 확인.' },
      { cmd: 'traceroute <ip>',           desc: 'ISP 라우터에서 목적지까지 홉별 경로 추적. IXP 피어링 LAN을 포함한 실제 데이터 플레인 경로 표시.' },
      { cmd: 'show bgp neighbors <peer>', desc: '특정 BGP 세션 상세 정보: 협상된 기능, 프리픽스 한도, 홀드 타이머, 마지막 리셋 원인.' },
      { cmd: 'show bgp community <val>',  desc: 'BGP 커뮤니티 값으로 경로 필터링 — 특정 정책 또는 출처 마커가 붙은 경로 조회에 유용.' },
    ],
  },
}

// ── Result Panel ───────────────────────────────────────────────────────────────

function LgPanel({ panel, t }: { panel: PanelMode; t: typeof T['en'] }) {
  const isPdb   = panel === 'pdb-querying' || panel === 'pdb-result'
  const isLg    = panel === 'lg-querying' || panel === 'lg-bgp' || panel === 'lg-trace'
  const title   = isPdb ? t.panelTitle.pdb : isLg ? t.panelTitle.lg : ''

  if (panel === 'none') {
    return (
      <div className="lg-panel lg-panel-empty">
        <span className="lg-panel-hint">{t.frames[0].title}</span>
      </div>
    )
  }

  return (
    <div className="lg-panel">
      <div className="lg-panel-header">
        <span className="lg-panel-title">{title}</span>
        {isLg && (
          <span className="lg-panel-cmd">
            {panel === 'lg-trace' ? t.lgTraceCmd : t.lgBgpCmd}
          </span>
        )}
      </div>
      <div className="lg-panel-body">
        {/* PeeringDB querying */}
        {panel === 'pdb-querying' && (
          <div className="lg-pdb-querying">{t.pdbQuerying}</div>
        )}

        {/* PeeringDB result */}
        {panel === 'pdb-result' && (
          <table className="lg-pdb-table">
            <tbody>
              {t.pdbRows.map(row => (
                <tr key={row.label} className="lg-pdb-row">
                  <td className="lg-pdb-label">{row.label}</td>
                  <td className="lg-pdb-val">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* LG querying */}
        {panel === 'lg-querying' && (
          <div className="lg-terminal">
            <div className="lg-terminal-line lg-terminal-cmd">{t.lgBgpCmd}</div>
            <div className="lg-terminal-line lg-terminal-waiting">{t.lgQuerying}</div>
          </div>
        )}

        {/* LG BGP result */}
        {panel === 'lg-bgp' && (
          <div className="lg-terminal">
            <div className="lg-terminal-line lg-terminal-cmd">{t.lgBgpCmd}</div>
            {t.lgBgpLines.map((line, i) => (
              <div key={i} className={`lg-terminal-line${line.startsWith('  ') ? ' lg-terminal-indent' : ''}${line.includes('Best path') ? ' lg-terminal-best' : ''}`}>
                {line || ' '}
              </div>
            ))}
          </div>
        )}

        {/* LG Traceroute result */}
        {panel === 'lg-trace' && (
          <div className="lg-terminal">
            <div className="lg-terminal-line lg-terminal-cmd">{t.lgTraceCmd}</div>
            {t.lgTraceLines.map((line, i) => (
              <div key={i} className="lg-terminal-line">{line}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Graph ──────────────────────────────────────────────────────────────────────

function LgGraph({ frame, t }: { frame: LgFrame; t: typeof T['en'] }) {
  return (
    <div className="lg-graph-canvas">
      <svg viewBox={`0 0 ${LGW} ${LGH}`} className="lg-graph-svg" preserveAspectRatio="none">
        <defs>
          {LINKS.map(({ id }) => (
            <path key={id} id={`lgp-${id}`} d={LINK_PATHS[id]} fill="none" />
          ))}
        </defs>

        {/* Link lines */}
        {LINKS.map(({ id, from, to }) => {
          const [x1, y1] = NODE_PX[from]
          const [x2, y2] = NODE_PX[to]
          const st = frame.links[id]
          return (
            <line key={id} x1={x1} y1={y1} x2={x2} y2={y2}
              className={`lg-sline lg-sline-${st}`} strokeWidth="2" />
          )
        })}

        {/* Animated dots */}
        {LINKS.map(({ id }) => {
          const st = frame.links[id]
          if (st !== 'query' && st !== 'internal') return null
          return (
            <circle key={`dot-${id}`} r="5"
              className={st === 'internal' ? 'lg-gdot lg-gdot-int' : 'lg-gdot'}>
              <animateMotion dur="1.1s" repeatCount="indefinite">
                <mpath href={`#lgp-${id}`} />
              </animateMotion>
            </circle>
          )
        })}
      </svg>

      {/* Link labels */}
      {LINKS.map(({ id, from, to }) => {
        const [x1, y1] = NODE_PX[from]
        const [x2, y2] = NODE_PX[to]
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        const st = frame.links[id]
        const dx = x2 - x1, dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const ox = (-dy / len) * 16
        const oy = ( dx / len) * 16
        return (
          <span key={`lbl-${id}`}
            className={`graph-linklabel${st !== 'idle' ? ' graph-linklabel-on' : ''}`}
            style={{ left: `${((mx + ox) / LGW) * 100}%`, top: `${((my + oy) / LGH) * 100}%` }}
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
            className={`lg-gnode lg-gnode-${st}`}
            style={{ left: `${(px / LGW) * 100}%`, top: `${(py / LGH) * 100}%` }}
          >
            <span className="lg-gnode-label">{t.nodeLabel[nid]}</span>
            <span className="lg-gnode-sub">{t.nodeSub[nid]}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Explorer ───────────────────────────────────────────────────────────────────

function LgExplorer() {
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
    timerRef.current = setTimeout(() => { setStep(s => s + 1) }, 1400)
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
      <LgGraph frame={frame} t={t} />
      <LgPanel panel={frame.panel} t={t} />
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

// ── Command table ──────────────────────────────────────────────────────────────

function CmdTable() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <div className="ov-proto-section">
      <div className="bgp2-section-title">{t.cmdTitle}</div>
      <table className="ov-proto-table lg-cmd-table">
        <thead>
          <tr>{t.cmdHeaders.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.cmds.map(r => (
            <tr key={r.cmd}>
              <td><code>{r.cmd}</code></td>
              <td>{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function LgPage() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-07-21"
      readTime={t.readTime}
      tags={['networking', 'bgp', 'peering', 'tools', 'infrastructure']}
      intro={t.intro}
    >
      <LgExplorer />
      <CmdTable />
    </NoteLayout>
  )
}
