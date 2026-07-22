import { useState } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type LgTabId = 'bgp' | 'trace' | 'summary'

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title:    'Looking Glass & PeeringDB — BGP visibility tools',
    readTime: '5 min',
    intro:    `PeeringDB and Looking Glass are the two tools every network engineer opens when investigating BGP routing. PeeringDB is a publicly available database where networks register their ASN, peering policy, IXP memberships, and contacts — the first stop when evaluating a potential peer. Looking Glass is a read-only interface hosted by ISPs and IXPs that lets you run BGP commands against a real production router from the outside, without needing SSH access.`,

    pdbSectionTitle: 'PeeringDB — AS15169',
    pdbNote: 'PeeringDB is the canonical directory for network peering information. Before configuring any BGP session, operators check here for the target AS\'s peering policy (Open / Selective / Restrictive), which Internet Exchange Points they\'re present at, and a direct peering contact. An Open policy means the network will peer with any technically qualified operator — just configure the session and notify the contact.',
    pdbRows: [
      { label: 'Network',         value: 'Google LLC' },
      { label: 'ASN',             value: 'AS15169' },
      { label: 'Type',            value: 'Content' },
      { label: 'Peering policy',  value: 'Open' },
      { label: 'Prefixes (v4)',   value: '12,400+' },
      { label: 'Prefixes (v6)',   value: '3,200+' },
      { label: 'IXP memberships', value: 'AMS-IX · DE-CIX · Equinix IX · LINX · ...50+ IXPs' },
      { label: 'Peering contact', value: 'peering@google.com' },
      { label: 'NOC email',       value: 'noc@google.com' },
    ],

    lgSectionTitle: 'Looking Glass — lg.upstream-isp.net',
    lgNote: 'A Looking Glass is a read-only web interface that proxies commands to a production router. The BGP output shows every path the router knows for 8.8.8.0/24 — the best path has AS-PATH "15169" (one hop, direct peering at AMS-IX). The traceroute confirms the data-plane reality: 4 hops, 1.9 ms end-to-end. Communities like 15169:25 encode Google\'s internal routing policy and are documented in their IRR records.',
    lgTabs: [
      { id: 'bgp'     as LgTabId, label: 'show bgp 8.8.8.8',   cmd: '> show bgp 8.8.8.8'   },
      { id: 'trace'   as LgTabId, label: 'traceroute 8.8.8.8', cmd: '> traceroute 8.8.8.8' },
      { id: 'summary' as LgTabId, label: 'show bgp summary',   cmd: '> show bgp summary'   },
    ],
    lgOutputs: {
      bgp: [
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
        '    Community: 3356:3 3356:86 3356:575 3356:666',
        '',
        '  1200 15169',
        '    80.249.209.252 from 80.249.209.252 (80.249.209.252)',
        '    Origin IGP, localpref 80',
        '    Community: 1200:3 1200:10',
      ] as string[],
      trace: [
        'traceroute to 8.8.8.8, 30 hops max, 60 byte packets',
        '',
        ' 1  core-gw.upstream-isp.net (203.0.113.254)   0.4 ms',
        ' 2  ae1.ams-ix.upstream-isp.net (80.249.209.1)  1.1 ms',
        ' 3  google-gw.ams-ix.net (80.249.208.208)        1.3 ms',
        ' 4  dns.google (8.8.8.8)                         1.9 ms',
      ] as string[],
      summary: [
        'BGP router identifier 203.0.113.1, local AS 64512',
        'BGP table version is 4821, main routing table version 4821',
        '',
        'Neighbor         V   AS      Up/Down    State / PfxRcd   Description',
        '203.0.113.254    4   15169   3d21h      Established 11843   Google LLC (AMS-IX)',
        '80.249.209.252   4   1200    5d02h      Established 9821    AMS-IX Route Server',
        '198.51.100.5     4   3356    12d08h     Established 947212  Lumen Transit',
        '192.0.2.1        4   20940   2d17h      Established 3401    Akamai Technologies',
      ] as string[],
    } as Record<LgTabId, string[]>,

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
    intro:    `PeeringDB와 Looking Glass는 BGP 라우팅을 조사할 때 모든 네트워크 엔지니어가 여는 두 가지 도구입니다. PeeringDB는 네트워크가 자신의 ASN, 피어링 정책, IXP 멤버십, 연락처를 등록하는 공개 데이터베이스로, 잠재적 피어를 평가할 때 가장 먼저 확인합니다. Looking Glass는 ISP와 IXP가 제공하는 읽기 전용 인터페이스로, SSH 접근 없이도 실제 운영 라우터에서 BGP 커맨드를 실행할 수 있습니다.`,

    pdbSectionTitle: 'PeeringDB — AS15169',
    pdbNote: 'PeeringDB는 네트워크 피어링 정보의 공식 디렉터리입니다. BGP 세션을 구성하기 전에 운영자는 대상 AS의 피어링 정책(오픈/선택적/제한적), IXP 멤버십, 직접 피어링 연락처를 여기서 확인합니다. "Open" 정책은 기술적 요건을 갖춘 모든 네트워크와 피어링한다는 의미입니다 — 세션을 설정하고 연락처에 통보하기만 하면 됩니다.',
    pdbRows: [
      { label: '네트워크',       value: 'Google LLC' },
      { label: 'ASN',            value: 'AS15169' },
      { label: '타입',           value: 'Content' },
      { label: '피어링 정책',    value: 'Open (오픈)' },
      { label: '프리픽스 (v4)',  value: '12,400+' },
      { label: '프리픽스 (v6)',  value: '3,200+' },
      { label: 'IXP 멤버십',    value: 'AMS-IX · DE-CIX · Equinix IX · LINX · ...50+ IXP' },
      { label: '피어링 연락처',  value: 'peering@google.com' },
      { label: 'NOC 이메일',    value: 'noc@google.com' },
    ],

    lgSectionTitle: 'Looking Glass — lg.upstream-isp.net',
    lgNote: 'Looking Glass는 운영 라우터에 커맨드를 프록시하는 읽기 전용 웹 인터페이스입니다. BGP 출력은 라우터가 8.8.8.0/24에 대해 알고 있는 모든 경로를 보여줍니다 — 최적 경로의 AS-PATH는 "15169"(단일 홉, AMS-IX 직접 피어링). Traceroute는 데이터 플레인 현실을 확인해줍니다: 4홉, 왕복 1.9ms. 15169:25 같은 커뮤니티 값은 Google 내부 라우팅 정책을 인코딩하며 IRR 레코드에 문서화되어 있습니다.',
    lgTabs: [
      { id: 'bgp'     as LgTabId, label: 'show bgp 8.8.8.8',   cmd: '> show bgp 8.8.8.8'   },
      { id: 'trace'   as LgTabId, label: 'traceroute 8.8.8.8', cmd: '> traceroute 8.8.8.8' },
      { id: 'summary' as LgTabId, label: 'show bgp summary',   cmd: '> show bgp summary'   },
    ],
    lgOutputs: {
      bgp: [
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
        '    Community: 3356:3 3356:86 3356:575 3356:666',
        '',
        '  1200 15169',
        '    80.249.209.252 from 80.249.209.252 (80.249.209.252)',
        '    Origin IGP, localpref 80',
        '    Community: 1200:3 1200:10',
      ] as string[],
      trace: [
        'traceroute to 8.8.8.8, 30 hops max, 60 byte packets',
        '',
        ' 1  core-gw.upstream-isp.net (203.0.113.254)   0.4 ms',
        ' 2  ae1.ams-ix.upstream-isp.net (80.249.209.1)  1.1 ms',
        ' 3  google-gw.ams-ix.net (80.249.208.208)        1.3 ms',
        ' 4  dns.google (8.8.8.8)                         1.9 ms',
      ] as string[],
      summary: [
        'BGP router identifier 203.0.113.1, local AS 64512',
        'BGP table version is 4821, main routing table version 4821',
        '',
        'Neighbor         V   AS      Up/Down    State / PfxRcd   Description',
        '203.0.113.254    4   15169   3d21h      Established 11843   Google LLC (AMS-IX)',
        '80.249.209.252   4   1200    5d02h      Established 9821    AMS-IX Route Server',
        '198.51.100.5     4   3356    12d08h     Established 947212  Lumen Transit',
        '192.0.2.1        4   20940   2d17h      Established 3401    Akamai Technologies',
      ] as string[],
    } as Record<LgTabId, string[]>,

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

// ── Demo ───────────────────────────────────────────────────────────────────────

function LgDemo() {
  const { lang } = useLang()
  const t = T[lang]
  const [activeTab, setActiveTab] = useState<LgTabId>('bgp')

  const currentTab = t.lgTabs.find(tab => tab.id === activeTab)!
  const lines = t.lgOutputs[activeTab]

  function lineClass(line: string): string {
    if (line.includes('Best path')) return 'lg-terminal-line lg-terminal-best'
    if (line.startsWith('    '))    return 'lg-terminal-line lg-terminal-indent2'
    if (line.startsWith('  '))     return 'lg-terminal-line lg-terminal-indent'
    if (line === '')                return 'lg-terminal-line lg-terminal-blank'
    return 'lg-terminal-line'
  }

  return (
    <div className="lg-demo-root">
      {/* PeeringDB panel */}
      <div className="lg-section">
        <div className="bgp2-section-title">{t.pdbSectionTitle}</div>
        <div className="lg-panel">
          <div className="lg-panel-header">
            <span className="lg-panel-title">peeringdb.com</span>
            <span className="lg-badge-open">Open</span>
          </div>
          <div className="lg-panel-body">
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
          </div>
        </div>
        <p className="lg-section-note">{t.pdbNote}</p>
      </div>

      {/* Looking Glass panel */}
      <div className="lg-section">
        <div className="bgp2-section-title">{t.lgSectionTitle}</div>
        <div className="lg-tabs">
          {t.lgTabs.map(tab => (
            <button
              key={tab.id}
              className={`lg-tab${tab.id === activeTab ? ' lg-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="lg-panel">
          <div className="lg-panel-header">
            <span className="lg-panel-title">lg.upstream-isp.net</span>
            <span className="lg-panel-cmd">{currentTab.cmd}</span>
          </div>
          <div className="lg-panel-body">
            <div className="lg-terminal">
              <div className="lg-terminal-line lg-terminal-cmd">{currentTab.cmd}</div>
              {lines.map((line, i) => (
                <div key={i} className={lineClass(line)}>{line || ' '}</div>
              ))}
            </div>
          </div>
        </div>
        <p className="lg-section-note">{t.lgNote}</p>
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
      <LgDemo />
      <CmdTable />
    </NoteLayout>
  )
}
