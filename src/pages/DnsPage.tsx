import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type NodeId     = 'client' | 'rr' | 'root' | 'tld' | 'auth'
type NodeStatus = 'idle' | 'active' | 'done' | 'cached'
type LinkId     = 'client_rr' | 'rr_root' | 'rr_tld' | 'rr_auth'
type LinkStatus = 'idle' | 'active' | 'done'

interface DnsFrame {
  nodes:          Record<NodeId, NodeStatus>
  links:          Record<LinkId, LinkStatus>
  answerToClient: boolean
  cacheHit:       boolean
}

// ── Graph geometry ─────────────────────────────────────────────────────────────

const DGW = 560
const DGH = 260

const NODE_PX: Record<NodeId, [number, number]> = {
  client: [80,  130],
  rr:     [220, 130],
  root:   [440, 50],
  tld:    [440, 130],
  auth:   [440, 215],
}

const NODE_IDS: NodeId[] = ['client', 'rr', 'root', 'tld', 'auth']

// Paths for animateMotion (forward)
const LINK_PATHS: Record<LinkId, string> = {
  client_rr: `M ${NODE_PX.client[0]} ${NODE_PX.client[1]} L ${NODE_PX.rr[0]} ${NODE_PX.rr[1]}`,
  rr_root:   `M ${NODE_PX.rr[0]} ${NODE_PX.rr[1]} L ${NODE_PX.root[0]} ${NODE_PX.root[1]}`,
  rr_tld:    `M ${NODE_PX.rr[0]} ${NODE_PX.rr[1]} L ${NODE_PX.tld[0]} ${NODE_PX.tld[1]}`,
  rr_auth:   `M ${NODE_PX.rr[0]} ${NODE_PX.rr[1]} L ${NODE_PX.auth[0]} ${NODE_PX.auth[1]}`,
}
// Reverse path for response back to client
const CLIENT_RR_REV = `M ${NODE_PX.rr[0]} ${NODE_PX.rr[1]} L ${NODE_PX.client[0]} ${NODE_PX.client[1]}`

const LINKS: Array<{ id: LinkId; from: NodeId; to: NodeId }> = [
  { id: 'client_rr', from: 'client', to: 'rr'   },
  { id: 'rr_root',   from: 'rr',     to: 'root'  },
  { id: 'rr_tld',    from: 'rr',     to: 'tld'   },
  { id: 'rr_auth',   from: 'rr',     to: 'auth'  },
]

// ── Frame data ─────────────────────────────────────────────────────────────────

const N0: Record<NodeId, NodeStatus> = { client: 'idle', rr: 'idle', root: 'idle', tld: 'idle', auth: 'idle' }
const L0: Record<LinkId, LinkStatus> = { client_rr: 'idle', rr_root: 'idle', rr_tld: 'idle', rr_auth: 'idle' }

const FRAMES: DnsFrame[] = [
  // 0: overview
  { nodes: N0, links: L0, answerToClient: false, cacheHit: false },
  // 1: client → recursive resolver
  { nodes: { ...N0, client: 'active', rr: 'active' },
    links: { ...L0, client_rr: 'active' }, answerToClient: false, cacheHit: false },
  // 2: recursive → root NS
  { nodes: { ...N0, client: 'done', rr: 'active', root: 'active' },
    links: { ...L0, client_rr: 'done', rr_root: 'active' }, answerToClient: false, cacheHit: false },
  // 3: recursive → .com TLD NS
  { nodes: { ...N0, client: 'done', rr: 'active', root: 'done', tld: 'active' },
    links: { ...L0, client_rr: 'done', rr_root: 'done', rr_tld: 'active' }, answerToClient: false, cacheHit: false },
  // 4: recursive → authoritative NS
  { nodes: { ...N0, client: 'done', rr: 'active', root: 'done', tld: 'done', auth: 'active' },
    links: { ...L0, client_rr: 'done', rr_root: 'done', rr_tld: 'done', rr_auth: 'active' }, answerToClient: false, cacheHit: false },
  // 5: answer cached, returned to client
  { nodes: { ...N0, client: 'active', rr: 'cached', root: 'done', tld: 'done', auth: 'done' },
    links: { ...L0, client_rr: 'active', rr_root: 'done', rr_tld: 'done', rr_auth: 'done' }, answerToClient: true, cacheHit: false },
  // 6: cache hit — second query answered immediately
  { nodes: { ...N0, client: 'active', rr: 'cached' },
    links: { ...L0, client_rr: 'active' }, answerToClient: true, cacheHit: true },
]

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title:    'DNS — how a query is resolved',
    readTime: '5 min',
    intro:    `DNS (Domain Name System) is a globally distributed, hierarchical database that maps human-readable names to IP addresses. When you type "example.com", your OS sends a query to a recursive resolver — a server that walks the DNS hierarchy on your behalf, asking root nameservers, TLD nameservers, and finally the authoritative nameserver, then caches the answer for the duration of its TTL.`,
    nodeLabel:  { client: 'Client', rr: 'Recursive', root: 'Root NS', tld: '.com TLD NS', auth: 'Auth NS' } as Record<NodeId, string>,
    nodeSub:    { client: 'stub resolver', rr: '8.8.8.8', root: '. (root zone)', tld: 'a.gtld-servers.net', auth: 'ns1.example.com' } as Record<NodeId, string>,
    cachedBadge: 'cached',
    linkLabel: {
      client_rr: 'query / answer',
      rr_root:   'root referral',
      rr_tld:    'TLD referral',
      rr_auth:   'authoritative',
    } as Record<LinkId, string>,
    records: [
      { type: 'A',     desc: 'Maps a hostname to an IPv4 address.',               ex: 'example.com. → 93.184.216.34' },
      { type: 'AAAA',  desc: 'Maps a hostname to an IPv6 address.',               ex: 'example.com. → 2606:2800:220::1' },
      { type: 'CNAME', desc: 'Alias — points one name to another canonical name.', ex: 'www → example.com.' },
      { type: 'NS',    desc: 'Delegates a zone to authoritative nameservers.',     ex: 'example.com. NS ns1.example.com.' },
      { type: 'MX',    desc: 'Specifies mail servers for a domain.',              ex: '10 mail.example.com.' },
      { type: 'TXT',   desc: 'Arbitrary text — used for SPF, DKIM, verification.',ex: 'v=spf1 include:_spf.google.com ~all' },
      { type: 'PTR',   desc: 'Reverse DNS — IP address to hostname.',             ex: '34.216.184.93.in-addr.arpa. → example.com.' },
      { type: 'SOA',   desc: 'Start of Authority — zone metadata and serial.',    ex: 'ns1.example.com. admin.example.com. 2024010100 ...' },
    ],
    recordTitle:   'DNS record types',
    recordHeaders: ['Type', 'Description', 'Example'],
    frames: [
      { title: 'DNS — distributed, hierarchical database',
        note:  'DNS is not a single server — it is a globally distributed hierarchy. At the top are 13 root server clusters. Below them are TLD nameservers (.com, .net, .kr). Below those are authoritative nameservers that own specific zones (example.com). A recursive resolver walks this tree on your behalf and caches results.' },
      { title: 'Client → Recursive resolver',
        note:  'The OS stub resolver sends a query to the configured recursive resolver (e.g. 8.8.8.8): "What is the A record for www.example.com?" The stub resolver does not walk the DNS hierarchy itself — it delegates entirely to the recursive resolver and waits for a final answer.' },
      { title: 'Recursive → Root NS (cache miss)',
        note:  'The recursive resolver checks its cache — no entry for www.example.com. It queries one of the 13 root server clusters. The root does not know the answer but returns a referral: "For .com names, ask one of these TLD nameservers: a.gtld-servers.net, b.gtld-servers.net, …"' },
      { title: 'Recursive → .com TLD NS',
        note:  'The recursive resolver queries the .com TLD nameserver: "Who is authoritative for example.com?" The TLD nameserver does not have the A record either, but it knows the delegation: "example.com is served by ns1.example.com and ns2.example.com." Another referral — not yet an answer.' },
      { title: 'Recursive → Authoritative NS',
        note:  'The recursive resolver now queries ns1.example.com directly: "www.example.com A?" The authoritative nameserver owns this zone and has the definitive answer: "www.example.com. 3600 IN A 93.184.216.34". TTL 3600 means this answer is valid for 1 hour.' },
      { title: 'Answer cached — returned to client',
        note:  'The recursive resolver stores "www.example.com → 93.184.216.34" in its cache with a 3600-second TTL. It returns the answer to the client. Any subsequent query for www.example.com within the next hour — from this client or any other using the same resolver — will be answered instantly from cache.' },
      { title: 'Second query — cache hit, zero upstream hops',
        note:  'The client queries again (within the TTL window). The recursive resolver finds the cached record immediately and returns 93.184.216.34 without contacting root, TLD, or auth nameservers. The three iterative hops are completely skipped. This is why high-traffic domains use short TTLs carefully — every TTL drop multiplies upstream query load.' },
    ],
  },
  ko: {
    title:    'DNS — 쿼리가 해석되는 방법',
    readTime: '5분',
    intro:    `DNS(Domain Name System)는 사람이 읽을 수 있는 이름을 IP 주소로 매핑하는 전 세계 분산 계층 데이터베이스입니다. "example.com"을 입력하면 OS는 재귀 리졸버에 쿼리를 보냅니다. 재귀 리졸버는 사용자를 대신해 DNS 계층을 탐색하며 루트 네임서버, TLD 네임서버, 최종적으로 권위 네임서버에 순서대로 질의한 후 TTL 동안 응답을 캐시합니다.`,
    nodeLabel:  { client: '클라이언트', rr: '재귀 리졸버', root: '루트 NS', tld: '.com TLD NS', auth: '권위 NS' } as Record<NodeId, string>,
    nodeSub:    { client: '스텁 리졸버', rr: '8.8.8.8', root: '. (루트 존)', tld: 'a.gtld-servers.net', auth: 'ns1.example.com' } as Record<NodeId, string>,
    cachedBadge: '캐시됨',
    linkLabel: {
      client_rr: '쿼리 / 응답',
      rr_root:   '루트 위임',
      rr_tld:    'TLD 위임',
      rr_auth:   '권위 응답',
    } as Record<LinkId, string>,
    records: [
      { type: 'A',     desc: '호스트명을 IPv4 주소로 매핑합니다.',              ex: 'example.com. → 93.184.216.34' },
      { type: 'AAAA',  desc: '호스트명을 IPv6 주소로 매핑합니다.',              ex: 'example.com. → 2606:2800:220::1' },
      { type: 'CNAME', desc: '별칭 — 한 이름을 정식 이름으로 가리킵니다.',     ex: 'www → example.com.' },
      { type: 'NS',    desc: '존을 권위 네임서버에 위임합니다.',                ex: 'example.com. NS ns1.example.com.' },
      { type: 'MX',    desc: '도메인의 메일 서버를 지정합니다.',               ex: '10 mail.example.com.' },
      { type: 'TXT',   desc: '임의 텍스트 — SPF, DKIM, 도메인 인증에 사용.', ex: 'v=spf1 include:_spf.google.com ~all' },
      { type: 'PTR',   desc: '역방향 DNS — IP 주소를 호스트명으로 매핑.',      ex: '34.216.184.93.in-addr.arpa. → example.com.' },
      { type: 'SOA',   desc: '존 메타데이터 및 시리얼 번호를 저장합니다.',     ex: 'ns1.example.com. admin.example.com. 2024010100 ...' },
    ],
    recordTitle:   'DNS 레코드 타입',
    recordHeaders: ['타입', '설명', '예시'],
    frames: [
      { title: 'DNS — 분산 계층 데이터베이스',
        note:  'DNS는 단일 서버가 아닙니다 — 전 세계에 분산된 계층 구조입니다. 최상위에 13개의 루트 서버 클러스터가 있고 그 아래에 TLD 네임서버(.com, .net, .kr), 그 아래에 특정 존(example.com)을 소유한 권위 네임서버가 있습니다. 재귀 리졸버가 사용자를 대신해 이 트리를 탐색하고 결과를 캐시합니다.' },
      { title: '클라이언트 → 재귀 리졸버',
        note:  'OS 스텁 리졸버가 설정된 재귀 리졸버(예: 8.8.8.8)에 쿼리를 보냅니다: "www.example.com의 A 레코드는 무엇인가?" 스텁 리졸버는 DNS 계층을 직접 탐색하지 않습니다 — 재귀 리졸버에 완전히 위임하고 최종 답변을 기다립니다.' },
      { title: '재귀 리졸버 → 루트 NS (캐시 미스)',
        note:  '재귀 리졸버가 캐시를 확인합니다 — www.example.com에 대한 항목 없음. 13개 루트 서버 클러스터 중 하나에 쿼리합니다. 루트는 답을 모르지만 위임을 반환합니다: ".com 이름에 대해서는 a.gtld-servers.net, b.gtld-servers.net 등의 TLD 네임서버에 물어보세요."' },
      { title: '재귀 리졸버 → .com TLD NS',
        note:  '재귀 리졸버가 .com TLD 네임서버에 질의합니다: "example.com의 권위 서버는 누구인가?" TLD도 A 레코드를 가지고 있지 않지만 위임을 알고 있습니다: "example.com은 ns1.example.com과 ns2.example.com이 담당합니다." 또 다른 위임 — 아직 최종 답변이 아닙니다.' },
      { title: '재귀 리졸버 → 권위 NS',
        note:  '재귀 리졸버가 ns1.example.com에 직접 질의합니다: "www.example.com A?" 권위 네임서버는 이 존을 소유하며 확정적인 답변을 가집니다: "www.example.com. 3600 IN A 93.184.216.34". TTL 3600은 이 답변이 1시간 동안 유효함을 의미합니다.' },
      { title: '응답 캐시 저장 — 클라이언트에 반환',
        note:  '재귀 리졸버가 "www.example.com → 93.184.216.34"를 TTL 3600초로 캐시에 저장합니다. 클라이언트에 답변을 반환합니다. 다음 1시간 내에 같은 리졸버를 사용하는 이 클라이언트 또는 다른 모든 클라이언트의 www.example.com 쿼리는 캐시에서 즉시 응답됩니다.' },
      { title: '두 번째 쿼리 — 캐시 히트, 업스트림 홉 없음',
        note:  '클라이언트가 다시 쿼리합니다(TTL 내). 재귀 리졸버가 캐시된 레코드를 즉시 찾아 루트, TLD, 권위 네임서버에 접촉하지 않고 93.184.216.34를 반환합니다. 세 번의 반복 홉이 완전히 생략됩니다. 이 때문에 트래픽이 많은 도메인은 TTL을 신중하게 낮춥니다 — TTL이 낮아질수록 업스트림 쿼리 부하가 증가합니다.' },
    ],
  },
}

// ── Graph ──────────────────────────────────────────────────────────────────────

function DnsGraph({ frame, t }: { frame: DnsFrame; t: typeof T['en'] }) {
  return (
    <div className="dns-graph-canvas">
      <svg viewBox={`0 0 ${DGW} ${DGH}`} className="dns-graph-svg" preserveAspectRatio="none">
        <defs>
          {LINKS.map(({ id }) => (
            <path key={id} id={`dnsp-${id}`} d={LINK_PATHS[id]} fill="none" />
          ))}
          <path id="dnsp-client_rr_rev" d={CLIENT_RR_REV} fill="none" />
        </defs>

        {/* Link lines */}
        {LINKS.map(({ id, from, to }) => {
          const [x1, y1] = NODE_PX[from]
          const [x2, y2] = NODE_PX[to]
          const st = frame.links[id]
          return (
            <g key={id}>
              <line x1={x1} y1={y1} x2={x2} y2={y2}
                className={`dns-sline dns-sline-${st}`} strokeWidth="2" />
            </g>
          )
        })}

        {/* Animated dots */}
        {LINKS.map(({ id }) => {
          const st = frame.links[id]
          if (st !== 'active') return null
          if (id === 'client_rr' && frame.answerToClient) return null
          return (
            <circle key={`dot-${id}`} r="5" className="dns-gdot">
              <animateMotion dur="1.0s" repeatCount="indefinite">
                <mpath href={`#dnsp-${id}`} />
              </animateMotion>
            </circle>
          )
        })}

        {/* Answer dot — travels from RR back to client */}
        {frame.answerToClient && frame.links.client_rr === 'active' && (
          <circle r="5" className="dns-gdot dns-gdot-answer">
            <animateMotion dur="1.0s" repeatCount="indefinite">
              <mpath href="#dnsp-client_rr_rev" />
            </animateMotion>
          </circle>
        )}
      </svg>

      {/* Link labels — HTML to avoid SVG scale distortion */}
      {LINKS.map(({ id, from, to }) => {
        const [x1, y1] = NODE_PX[from]
        const [x2, y2] = NODE_PX[to]
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        const st = frame.links[id]
        // perpendicular offset — push labels away from lines
        const dx = x2 - x1, dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const ox = (-dy / len) * 16
        const oy = ( dx / len) * 16
        return (
          <span key={`lbl-${id}`}
            className={`graph-linklabel${st !== 'idle' ? ' graph-linklabel-on' : ''}`}
            style={{ left: `${((mx + ox) / DGW) * 100}%`, top: `${((my + oy) / DGH) * 100}%` }}
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
            className={`dns-gnode dns-gnode-${st}`}
            style={{ left: `${(px / DGW) * 100}%`, top: `${(py / DGH) * 100}%` }}
          >
            <span className="dns-gnode-label">{t.nodeLabel[nid]}</span>
            <span className="dns-gnode-sub">{t.nodeSub[nid]}</span>
            {nid === 'rr' && st === 'cached' && (
              <span className="dns-cached-badge">{t.cachedBadge}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Explorer ───────────────────────────────────────────────────────────────────

function DnsExplorer() {
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
      <DnsGraph frame={frame} t={t} />
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

// ── Record types table ─────────────────────────────────────────────────────────

function RecordTable() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <div className="ov-proto-section">
      <div className="bgp2-section-title">{t.recordTitle}</div>
      <table className="ov-proto-table dns-record-table">
        <thead>
          <tr>{t.recordHeaders.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.records.map(r => (
            <tr key={r.type}>
              <td><code>{r.type}</code></td>
              <td>{r.desc}</td>
              <td><code className="dns-ex">{r.ex}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DnsPage() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-06-22"
      readTime={t.readTime}
      tags={['networking', 'dns', 'resolvers', 'infrastructure']}
      intro={t.intro}
    >
      <DnsExplorer />
      <RecordTable />
    </NoteLayout>
  )
}
