import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useTheme, useLang } from '../App'

interface TopoNode {
  id: string
  type: string
  label: string
  x: number
  y: number
}

interface TopoLayer { y: number; label: string }

interface Topology {
  nodes: TopoNode[]
  edges: [string, string][]
  failableTypes: Set<string>
  layers: TopoLayer[]
}

const CLOS: Topology = {
  nodes: [
    { id: 'sp0', type: 'spine',  label: 'Sp0', x: 150, y: 42 },
    { id: 'sp1', type: 'spine',  label: 'Sp1', x: 290, y: 42 },
    { id: 'tr0', type: 'tor',    label: 'L0',  x: 65,  y: 155 },
    { id: 'tr1', type: 'tor',    label: 'L1',  x: 175, y: 155 },
    { id: 'tr2', type: 'tor',    label: 'L2',  x: 265, y: 155 },
    { id: 'tr3', type: 'tor',    label: 'L3',  x: 375, y: 155 },
    { id: 'sv0', type: 'server', label: 'S0',  x: 35,  y: 265 },
    { id: 'sv1', type: 'server', label: 'S1',  x: 95,  y: 265 },
    { id: 'sv2', type: 'server', label: 'S2',  x: 145, y: 265 },
    { id: 'sv3', type: 'server', label: 'S3',  x: 205, y: 265 },
    { id: 'sv4', type: 'server', label: 'S4',  x: 235, y: 265 },
    { id: 'sv5', type: 'server', label: 'S5',  x: 295, y: 265 },
    { id: 'sv6', type: 'server', label: 'S6',  x: 345, y: 265 },
    { id: 'sv7', type: 'server', label: 'S7',  x: 405, y: 265 },
  ],
  edges: [
    ['sp0','tr0'],['sp0','tr1'],['sp0','tr2'],['sp0','tr3'],
    ['sp1','tr0'],['sp1','tr1'],['sp1','tr2'],['sp1','tr3'],
    ['tr0','sv0'],['tr0','sv1'],
    ['tr1','sv2'],['tr1','sv3'],
    ['tr2','sv4'],['tr2','sv5'],
    ['tr3','sv6'],['tr3','sv7'],
  ],
  failableTypes: new Set(['spine', 'tor']),
  layers: [
    { y: 42,  label: 'spine' },
    { y: 155, label: 'leaf / ToR' },
    { y: 265, label: 'server' },
  ],
}

const RNG: Topology = {
  nodes: [
    { id: 'rr0', type: 'router', label: 'R0', x: 110, y: 130 },
    { id: 'rr1', type: 'router', label: 'R1', x: 220, y: 75  },
    { id: 'rr2', type: 'router', label: 'R2', x: 330, y: 130 },
    { id: 'rr3', type: 'router', label: 'R3', x: 220, y: 195 },
    { id: 'sv0', type: 'server', label: 'S0', x: 35,  y: 265 },
    { id: 'sv1', type: 'server', label: 'S1', x: 95,  y: 265 },
    { id: 'sv2', type: 'server', label: 'S2', x: 145, y: 265 },
    { id: 'sv3', type: 'server', label: 'S3', x: 205, y: 265 },
    { id: 'sv4', type: 'server', label: 'S4', x: 235, y: 265 },
    { id: 'sv5', type: 'server', label: 'S5', x: 295, y: 265 },
    { id: 'sv6', type: 'server', label: 'S6', x: 345, y: 265 },
    { id: 'sv7', type: 'server', label: 'S7', x: 405, y: 265 },
  ],
  edges: [
    ['rr0','rr1'],['rr1','rr2'],['rr2','rr3'],['rr3','rr0'],
    ['rr0','rr2'],['rr1','rr3'],
    ['sv0','rr0'],['sv0','rr3'],
    ['sv1','rr0'],['sv1','rr1'],
    ['sv2','rr0'],['sv2','rr1'],
    ['sv3','rr1'],['sv3','rr3'],
    ['sv4','rr1'],['sv4','rr2'],
    ['sv5','rr2'],['sv5','rr3'],
    ['sv6','rr2'],['sv6','rr3'],
    ['sv7','rr2'],['sv7','rr0'],
  ],
  failableTypes: new Set(['router']),
  layers: [
    { y: 130, label: 'router' },
    { y: 265, label: 'server' },
  ],
}

type Adj = Record<string, string[]>

function buildAdj(topo: Topology, failedIds: Set<string>): Adj {
  const adj: Adj = {}
  topo.nodes.forEach(n => { if (!failedIds.has(n.id)) adj[n.id] = [] })
  topo.edges.forEach(([a, b]) => {
    if (adj[a] && adj[b]) { adj[a].push(b); adj[b].push(a) }
  })
  return adj
}

function bfs(adj: Adj, src: string, dst: string): string[] | null {
  if (src === dst) return [src]
  const visited = new Set([src])
  const queue: string[][] = [[src]]
  while (queue.length) {
    const path = queue.shift()!
    for (const next of (adj[path[path.length - 1]] || [])) {
      if (next === dst) return [...path, next]
      if (!visited.has(next)) { visited.add(next); queue.push([...path, next]) }
    }
  }
  return null
}

function countPaths(adj: Adj, src: string, dst: string, maxCount = 30, maxDepth = 8): number | string {
  if (!adj[src] || !adj[dst]) return 0
  let count = 0
  function dfs(node: string, visited: Set<string>, depth: number) {
    if (count >= maxCount || depth > maxDepth) return
    for (const next of (adj[node] || [])) {
      if (next === dst) { count++; continue }
      if (!visited.has(next)) { visited.add(next); dfs(next, visited, depth + 1); visited.delete(next) }
    }
  }
  dfs(src, new Set([src]), 0)
  return count >= maxCount ? `${maxCount}+` : count
}

const NS = 'http://www.w3.org/2000/svg'
function svgEl(tag: string, attrs: Record<string, string | number>) {
  const el = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function renderTopo(
  svgElement: SVGSVGElement,
  topo: Topology,
  failedIds: Set<string>,
  activePath: string[] | null,
  packetPos: { x: number; y: number } | null,
  failMode: boolean,
) {
  svgElement.innerHTML = ''
  const pathSet = new Set<string>()
  if (activePath) {
    for (let i = 0; i < activePath.length - 1; i++) {
      pathSet.add(activePath[i] + '|' + activePath[i + 1])
      pathSet.add(activePath[i + 1] + '|' + activePath[i])
    }
  }
  const onPath = new Set(activePath || [])
  const nodeMap = Object.fromEntries(topo.nodes.map(n => [n.id, n]))

  topo.layers.forEach(layer => {
    const lbl = svgEl('text', { x: 4, y: layer.y + 1, fill: cssVar('--kp-fg-3'),
      'font-family': 'var(--kp-font-mono)', 'font-size': 8, 'dominant-baseline': 'central' })
    lbl.textContent = layer.label
    svgElement.appendChild(lbl)
  })

  topo.edges.forEach(([a, b]) => {
    const na = nodeMap[a], nb = nodeMap[b]
    const isPath = pathSet.has(a + '|' + b)
    const isFaded = failedIds.has(a) || failedIds.has(b)
    svgElement.appendChild(svgEl('line', {
      x1: na.x, y1: na.y, x2: nb.x, y2: nb.y,
      stroke: isPath ? cssVar('--kp-fg') : cssVar('--kp-border'),
      'stroke-width': isPath ? 2.5 : 1.5,
      opacity: isFaded ? 0.12 : 1,
    }))
  })

  topo.nodes.forEach(n => {
    const failed = failedIds.has(n.id)
    const active = onPath.has(n.id)
    const failable = topo.failableTypes.has(n.type)
    const g = svgEl('g', { 'data-id': n.id })
    g.setAttribute('class', ['node', n.type, failed ? 'failed' : '', active ? 'active' : ''].filter(Boolean).join(' '))

    const fillColor = failed ? cssVar('--kp-bg-subtle') : active ? cssVar('--kp-fg') : cssVar('--kp-bg')
    const strokeColor = failed ? cssVar('--kp-border') : active ? cssVar('--kp-fg') :
      n.type === 'server' ? cssVar('--kp-border-strong') : cssVar('--kp-fg-2')
    const strokeW = active ? 2.5 : 1.5
    const opacity = failed ? 0.4 : 1

    if (n.type === 'server') {
      g.appendChild(svgEl('rect', { x: n.x - 13, y: n.y - 8, width: 26, height: 16, rx: 3,
        fill: fillColor, stroke: strokeColor, 'stroke-width': strokeW, opacity }))
    } else {
      if (failable && failMode) (g as SVGGElement).style.cursor = 'pointer'
      g.appendChild(svgEl('circle', { cx: n.x, cy: n.y, r: 17,
        fill: fillColor, stroke: strokeColor, 'stroke-width': strokeW, opacity }))
    }

    const lbl = svgEl('text', { x: n.x, y: n.y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      fill: active && !failed ? cssVar('--kp-bg') : cssVar('--kp-fg'),
      'font-family': 'var(--kp-font-mono)', 'font-size': 9, 'pointer-events': 'none',
      opacity: failed ? 0.4 : 1, 'font-weight': active ? 600 : 400 })
    lbl.textContent = n.label
    g.appendChild(lbl)

    if (failed) {
      g.appendChild(svgEl('line', { x1: n.x - 7, y1: n.y - 7, x2: n.x + 7, y2: n.y + 7, stroke: '#b91c1c', 'stroke-width': 1.5 }))
      g.appendChild(svgEl('line', { x1: n.x + 7, y1: n.y - 7, x2: n.x - 7, y2: n.y + 7, stroke: '#b91c1c', 'stroke-width': 1.5 }))
    }
    svgElement.appendChild(g)
  })

  if (packetPos) {
    svgElement.appendChild(svgEl('circle', { cx: packetPos.x, cy: packetPos.y, r: 7, fill: cssVar('--kp-fg') }))
    svgElement.appendChild(svgEl('circle', { cx: packetPos.x, cy: packetPos.y, r: 5, fill: cssVar('--kp-bg') }))
  }
}

type InfoData =
  | { type: 'init' }
  | { type: 'none' }
  | { type: 'closDisconn'; rh: number }
  | { type: 'rngDisconn'; ch: number }
  | { type: 'rngFaster'; sl: string; dl: string; rh: number; ch: number; ra: number | string; ca: number | string }
  | { type: 'closFaster'; sl: string; dl: string; ch: number; rh: number }
  | { type: 'sameHops'; sl: string; dl: string; ch: number; ra: number | string; ca: number | string }

type StatusData =
  | { type: 'init' | 'sameSrc' | 'failOn' | 'failOff' | 'cleared' }
  | { type: 'result'; c: number | string; r: number | string }

const CLOS_T = {
  en: {
    title: 'Clos vs. RNG topology',
    readTime: '6 min',
    intro: 'How AWS replaced hierarchical fat-tree (Clos) data center networks with a flat quasi-random topology — fewer routers, more paths, less power. Route packets through both topologies and use Fail Mode to see how each handles failures.',
    from: 'from', to: 'to',
    route: 'Route', random: 'Random', failMode: 'Fail Mode', clearFailures: 'Clear Failures',
    statusInit: 'select servers and press route',
    statusSameSrc: 'source and destination must differ',
    statusFailOn: 'click a spine/leaf switch or router to fail it',
    statusFailOff: 'fail mode off',
    statusCleared: 'failures cleared',
    statusResult: (c: number | string, r: number | string) => `clos: ${c} hops · rng: ${r} hops`,
    infoInit: 'Select a source and destination, then press <strong>Route</strong> to animate a packet through both topologies simultaneously.',
    infoNone: 'No path exists in either topology — too many failures. Clear some to restore connectivity.',
    infoClosDisconn: (rh: number) => `<strong>Clos is disconnected</strong> — the spine failure isolated these servers. RNG routes in <strong>${rh} hops</strong> via an alternate router. This is the key RNG resilience advantage.`,
    infoRngDisconn: (ch: number) => `RNG has no path (a dual-router failure). Clos routes in <strong>${ch} hops</strong>.`,
    infoRngFaster: (sl: string, dl: string, rh: number, ch: number, ra: number | string, ca: number | string) =>
      `<strong>${sl} → ${dl}:</strong> RNG routes in <strong>${rh} hops</strong> vs Clos <strong>${ch} hops</strong> — flat topology skips the hierarchy climb. RNG also has <strong>${ra}</strong> vs <strong>${ca}</strong> alternate paths.`,
    infoClosFaster: (sl: string, dl: string, ch: number, rh: number) =>
      `<strong>${sl} → ${dl}:</strong> Clos routes in <strong>${ch} hops</strong> vs RNG <strong>${rh} hops</strong>. For same-leaf traffic Clos can be competitive. Try cross-leaf pairs to see RNG's advantage.`,
    infoSameHops: (sl: string, dl: string, ch: number, ra: number | string, ca: number | string) =>
      `<strong>${sl} → ${dl}:</strong> Both route in <strong>${ch} hops</strong>. RNG has ${Number(ra) > Number(ca) ? `<strong>${ra}</strong> alternate paths vs ${ca}` : `${ra} alt paths`}. Try a cross-leaf pair (e.g. S0 → S7) or enable Fail Mode to see the difference.`,
    closName: 'Clos (Fat-Tree)', closBadge: 'hierarchical · spine-leaf',
    rngName: 'RNG (Flat)', rngBadge: 'quasi-random · single tier',
    hops: 'hops', altPaths: 'alt paths', switches: 'switches', routers: 'routers',
    fact1: 'fewer routers needed in the flat RNG topology vs. traditional Clos',
    fact2: 'more independent paths between any two routers, improving redundancy',
    fact3: 'reduction in network equipment electricity consumption at AWS scale',
  },
  ko: {
    title: 'Clos vs. RNG 토폴로지',
    readTime: '6분',
    intro: 'AWS가 계층적 팻트리(Clos) 데이터센터 네트워크를 플랫한 준무작위 토폴로지로 교체한 방법 — 더 적은 라우터, 더 많은 경로, 더 적은 전력. 두 토폴로지에서 패킷을 라우팅하고 고장 모드를 사용하여 각각이 장애를 처리하는 방법을 확인하세요.',
    from: '출발', to: '도착',
    route: '경로', random: '랜덤', failMode: '고장 모드', clearFailures: '고장 초기화',
    statusInit: '서버를 선택하고 경로 버튼을 누르세요',
    statusSameSrc: '출발지와 목적지가 달라야 합니다',
    statusFailOn: '스파인/리프 스위치 또는 라우터를 클릭하여 장애를 발생시키세요',
    statusFailOff: '고장 모드 해제',
    statusCleared: '장애 초기화 완료',
    statusResult: (c: number | string, r: number | string) => `clos: ${c} 홉 · rng: ${r} 홉`,
    infoInit: '출발지와 목적지를 선택한 후 <strong>경로</strong> 버튼을 눌러 두 토폴로지에서 동시에 패킷을 애니메이션으로 확인하세요.',
    infoNone: '두 토폴로지 모두 경로가 없습니다 — 장애가 너무 많습니다. 일부를 초기화하여 연결을 복원하세요.',
    infoClosDisconn: (rh: number) => `<strong>Clos가 단절되었습니다</strong> — 스파인 장애로 서버가 격리되었습니다. RNG는 대체 라우터를 통해 <strong>${rh} 홉</strong>으로 라우팅합니다. 이것이 RNG의 핵심 회복력 장점입니다.`,
    infoRngDisconn: (ch: number) => `RNG에 경로가 없습니다 (이중 라우터 장애). Clos는 <strong>${ch} 홉</strong>으로 라우팅합니다.`,
    infoRngFaster: (sl: string, dl: string, rh: number, ch: number, ra: number | string, ca: number | string) =>
      `<strong>${sl} → ${dl}:</strong> RNG는 <strong>${rh} 홉</strong> vs Clos <strong>${ch} 홉</strong> — 플랫 토폴로지가 계층 구조를 생략합니다. RNG는 <strong>${ra}</strong>개 vs <strong>${ca}</strong>개의 대체 경로도 있습니다.`,
    infoClosFaster: (sl: string, dl: string, ch: number, rh: number) =>
      `<strong>${sl} → ${dl}:</strong> Clos는 <strong>${ch} 홉</strong> vs RNG <strong>${rh} 홉</strong>. 동일 리프 트래픽에서는 Clos가 경쟁력이 있습니다. 리프 간 쌍을 시도하여 RNG의 장점을 확인하세요.`,
    infoSameHops: (sl: string, dl: string, ch: number, ra: number | string, ca: number | string) =>
      `<strong>${sl} → ${dl}:</strong> 두 토폴로지 모두 <strong>${ch} 홉</strong>으로 라우팅합니다. RNG는 ${Number(ra) > Number(ca) ? `<strong>${ra}</strong>개의 대체 경로 vs ${ca}개` : `${ra}개의 대체 경로`}. 리프 간 쌍(예: S0 → S7) 또는 고장 모드를 활성화하여 차이를 확인하세요.`,
    closName: 'Clos (팻트리)', closBadge: '계층형 · 스파인-리프',
    rngName: 'RNG (플랫)', rngBadge: '준무작위 · 단일 계층',
    hops: '홉', altPaths: '대체 경로', switches: '스위치', routers: '라우터',
    fact1: '기존 Clos 대비 플랫 RNG 토폴로지에 필요한 라우터 감소',
    fact2: '임의의 두 라우터 간 독립 경로 증가로 중복성 향상',
    fact3: 'AWS 규모에서 네트워크 장비 전력 소비 감소',
  },
}

type ClosTShape = typeof CLOS_T['en']

function resolveInfoHtml(data: InfoData, t: ClosTShape): string {
  switch (data.type) {
    case 'init':        return t.infoInit
    case 'none':        return t.infoNone
    case 'closDisconn': return t.infoClosDisconn(data.rh)
    case 'rngDisconn':  return t.infoRngDisconn(data.ch)
    case 'rngFaster':   return t.infoRngFaster(data.sl, data.dl, data.rh, data.ch, data.ra, data.ca)
    case 'closFaster':  return t.infoClosFaster(data.sl, data.dl, data.ch, data.rh)
    case 'sameHops':    return t.infoSameHops(data.sl, data.dl, data.ch, data.ra, data.ca)
  }
}

function resolveStatus(data: StatusData, t: ClosTShape): string {
  switch (data.type) {
    case 'init':    return t.statusInit
    case 'sameSrc': return t.statusSameSrc
    case 'failOn':  return t.statusFailOn
    case 'failOff': return t.statusFailOff
    case 'cleared': return t.statusCleared
    case 'result':  return t.statusResult(data.c, data.r)
  }
}

export default function ClosPage() {
  const { theme } = useTheme()
  const { lang } = useLang()
  const t = CLOS_T[lang]
  const closSvgRef = useRef<SVGSVGElement>(null)
  const rngSvgRef = useRef<SVGSVGElement>(null)
  const animRef = useRef<number | null>(null)

  const [src, setSrc] = useState('sv0')
  const [dst, setDst] = useState('sv7')
  const [failMode, setFailMode] = useState(false)
  const [closFailed, setClosFailed] = useState<Set<string>>(new Set())
  const [rngFailed, setRngFailed] = useState<Set<string>>(new Set())
  const [closPath, setClosPath] = useState<string[] | null>(null)
  const [rngPath, setRngPath] = useState<string[] | null>(null)
  const [closHops, setClosHops] = useState<number | null>(null)
  const [rngHops, setRngHops] = useState<number | null>(null)
  const [closAlt, setClosAlt] = useState<number | string>(0)
  const [rngAlt, setRngAlt] = useState<number | string>(0)
  const [infoData, setInfoData] = useState<InfoData>({ type: 'init' })
  const [statusData, setStatusData] = useState<StatusData>({ type: 'init' })
  const [animating, setAnimating] = useState(false)

  const infoHtml = useMemo(() => resolveInfoHtml(infoData, t), [infoData, lang])
  const status = useMemo(() => resolveStatus(statusData, t), [statusData, lang])

  const render = useCallback((closPkt: { x: number; y: number } | null = null, rngPkt: { x: number; y: number } | null = null, cp = closPath, rp = rngPath, cf = closFailed, rf = rngFailed, fm = failMode) => {
    if (closSvgRef.current) renderTopo(closSvgRef.current, CLOS, cf, cp, closPkt, fm)
    if (rngSvgRef.current) renderTopo(rngSvgRef.current, RNG, rf, rp, rngPkt, fm)
  }, [closPath, rngPath, closFailed, rngFailed, failMode])

  const updateRoute = useCallback((s = src, d = dst, cf = closFailed, rf = rngFailed) => {
    if (s === d) {
      setClosPath(null); setRngPath(null)
      setStatusData({ type: 'sameSrc' })
      if (closSvgRef.current) renderTopo(closSvgRef.current, CLOS, cf, null, null, failMode)
      if (rngSvgRef.current) renderTopo(rngSvgRef.current, RNG, rf, null, null, failMode)
      return
    }
    const cAdj = buildAdj(CLOS, cf)
    const rAdj = buildAdj(RNG, rf)
    const cp = bfs(cAdj, s, d)
    const rp = bfs(rAdj, s, d)
    setClosPath(cp); setRngPath(rp)

    const ch = cp ? cp.length - 1 : null
    const rh = rp ? rp.length - 1 : null
    const ca = cp ? countPaths(cAdj, s, d) : 0
    const ra = rp ? countPaths(rAdj, s, d) : 0
    setClosHops(ch); setRngHops(rh); setClosAlt(ca); setRngAlt(ra)

    const sl = s.replace('sv', 'S'), dl = d.replace('sv', 'S')
    if (!cp && !rp) {
      setInfoData({ type: 'none' })
    } else if (!cp && rp) {
      setInfoData({ type: 'closDisconn', rh: rh! })
    } else if (cp && !rp) {
      setInfoData({ type: 'rngDisconn', ch: ch! })
    } else {
      const diff = (ch ?? 0) - (rh ?? 0)
      if (diff > 0) {
        setInfoData({ type: 'rngFaster', sl, dl, rh: rh!, ch: ch!, ra, ca })
      } else if (diff < 0) {
        setInfoData({ type: 'closFaster', sl, dl, ch: ch!, rh: rh! })
      } else {
        setInfoData({ type: 'sameHops', sl, dl, ch: ch!, ra, ca })
      }
    }

    if (closSvgRef.current) renderTopo(closSvgRef.current, CLOS, cf, cp, null, failMode)
    if (rngSvgRef.current) renderTopo(rngSvgRef.current, RNG, rf, rp, null, failMode)
  }, [src, dst, closFailed, rngFailed, failMode])

  useEffect(() => { updateRoute() }, [])

  useEffect(() => {
    if (closSvgRef.current) renderTopo(closSvgRef.current, CLOS, closFailed, closPath, null, failMode)
    if (rngSvgRef.current) renderTopo(rngSvgRef.current, RNG, rngFailed, rngPath, null, failMode)
  }, [theme])

  function animatePath(
    svgElement: SVGSVGElement,
    topo: Topology,
    failedSet: Set<string>,
    path: string[],
    onDone: () => void,
  ) {
    if (!path || path.length < 2) { onDone(); return }
    const STEP_MS = 320
    const pts = path.map(id => { const n = topo.nodes.find(n => n.id === id)!; return { x: n.x, y: n.y } })
    let seg = 0, t0: number | null = null

    function frame(ts: number) {
      if (!t0) t0 = ts
      const t = Math.min((ts - t0) / STEP_MS, 1)
      const a = pts[seg], b = pts[seg + 1]
      renderTopo(svgElement, topo, failedSet, path, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, failMode)
      if (t >= 1) {
        seg++; t0 = ts
        if (seg >= pts.length - 1) { renderTopo(svgElement, topo, failedSet, path, null, failMode); onDone(); return }
      }
      animRef.current = requestAnimationFrame(frame)
    }
    animRef.current = requestAnimationFrame(frame)
  }

  function animate() {
    if (animating || src === dst) return
    if (animRef.current) cancelAnimationFrame(animRef.current)
    setAnimating(true)

    let cDone = !closPath, rDone = !rngPath
    function checkDone() {
      if (cDone && rDone) {
        setAnimating(false)
        const c = closPath ? closPath.length - 1 : '✕'
        const r = rngPath ? rngPath.length - 1 : '✕'
        setStatusData({ type: 'result', c, r })
      }
    }
    if (!closPath) { if (closSvgRef.current) renderTopo(closSvgRef.current, CLOS, closFailed, null, null, failMode) }
    else if (closSvgRef.current) animatePath(closSvgRef.current, CLOS, closFailed, closPath, () => { cDone = true; checkDone() })
    if (!rngPath) { if (rngSvgRef.current) renderTopo(rngSvgRef.current, RNG, rngFailed, null, null, failMode) }
    else if (rngSvgRef.current) animatePath(rngSvgRef.current, RNG, rngFailed, rngPath, () => { rDone = true; checkDone() })
    checkDone()
  }

  function handleTopoClick(e: React.MouseEvent<SVGSVGElement>, topo: Topology, failedSet: Set<string>, setFailed: React.Dispatch<React.SetStateAction<Set<string>>>) {
    if (!failMode) return
    let el = e.target as Element | null
    while (el && el !== e.currentTarget) {
      const id = (el as SVGGElement).dataset?.id
      if (id) {
        const node = topo.nodes.find(n => n.id === id)
        if (node && topo.failableTypes.has(node.type)) {
          const next = new Set(failedSet)
          if (next.has(id)) next.delete(id); else next.add(id)
          setFailed(next)
          updateRoute(src, dst, topo === CLOS ? next : closFailed, topo === RNG ? next : rngFailed)
          return
        }
      }
      el = el.parentElement
    }
  }

  return (
    <NoteLayout
      title={t.title}
      date="2026-04-10"
      readTime={t.readTime}
      tags={['networking', 'datacenter']}
      intro={t.intro}
    >
      <div className="topo-controls">
        <span className="topo-ctrl-label">{t.from}</span>
        <select className="topo-select" value={src} onChange={e => { setSrc(e.target.value); updateRoute(e.target.value, dst) }}>
          {Array.from({ length: 8 }, (_, i) => (
            <option key={i} value={`sv${i}`}>S{i}</option>
          ))}
        </select>
        <span className="topo-ctrl-label">{t.to}</span>
        <select className="topo-select" value={dst} onChange={e => { setDst(e.target.value); updateRoute(src, e.target.value) }}>
          {Array.from({ length: 8 }, (_, i) => (
            <option key={i} value={`sv${i}`}>S{i}</option>
          ))}
        </select>
        <div className="topo-ctrl-sep" />
        <button className="topo-ctrl-btn" onClick={() => { updateRoute(); animate() }} disabled={animating}>{t.route}</button>
        <button className="topo-ctrl-btn" onClick={() => {
          let a, b
          do { a = Math.floor(Math.random() * 8); b = Math.floor(Math.random() * 8) } while (a === b)
          setSrc(`sv${a}`); setDst(`sv${b}`)
          setTimeout(() => { updateRoute(`sv${a}`, `sv${b}`); animate() }, 0)
        }} disabled={animating}>{t.random}</button>
        <div className="topo-ctrl-sep" />
        <button className={`topo-ctrl-btn${failMode ? ' toggled' : ''}`} onClick={() => {
          const next = !failMode
          setFailMode(next)
          setStatusData({ type: next ? 'failOn' : 'failOff' })
          if (closSvgRef.current) renderTopo(closSvgRef.current, CLOS, closFailed, closPath, null, next)
          if (rngSvgRef.current) renderTopo(rngSvgRef.current, RNG, rngFailed, rngPath, null, next)
        }}>{t.failMode}</button>
        <button className="topo-ctrl-btn" onClick={() => {
          setClosFailed(new Set()); setRngFailed(new Set())
          updateRoute(src, dst, new Set(), new Set())
          setStatusData({ type: 'cleared' })
        }}>{t.clearFailures}</button>
        <span className="topo-ctrl-status">{status}</span>
      </div>

      <div className="topo-grid">
        <div className="topo-panel">
          <div className="topo-head">
            <div className="topo-name">{t.closName}</div>
            <div className="topo-badge">{t.closBadge}</div>
          </div>
          <div className="topo-svg-wrap">
            <svg ref={closSvgRef} className="topo-svg" viewBox="0 0 440 305"
              onClick={e => handleTopoClick(e, CLOS, closFailed, setClosFailed)} />
          </div>
          <div className="topo-stats">
            <div className="topo-stat-cell"><div className="topo-stat-val">{closHops !== null ? closHops : '—'}</div><div className="topo-stat-key">{t.hops}</div></div>
            <div className="topo-stat-cell"><div className="topo-stat-val">{closPath ? closAlt : '—'}</div><div className="topo-stat-key">{t.altPaths}</div></div>
            <div className="topo-stat-cell"><div className="topo-stat-val">6</div><div className="topo-stat-key">{t.switches}</div></div>
          </div>
        </div>

        <div className="topo-panel">
          <div className="topo-head">
            <div className="topo-name">{t.rngName}</div>
            <div className="topo-badge">{t.rngBadge}</div>
          </div>
          <div className="topo-svg-wrap">
            <svg ref={rngSvgRef} className="topo-svg" viewBox="0 0 440 305"
              onClick={e => handleTopoClick(e, RNG, rngFailed, setRngFailed)} />
          </div>
          <div className="topo-stats">
            <div className="topo-stat-cell"><div className="topo-stat-val">{rngHops !== null ? rngHops : '—'}</div><div className="topo-stat-key">{t.hops}</div></div>
            <div className="topo-stat-cell"><div className="topo-stat-val">{rngPath ? rngAlt : '—'}</div><div className="topo-stat-key">{t.altPaths}</div></div>
            <div className="topo-stat-cell"><div className="topo-stat-val">4</div><div className="topo-stat-key">{t.routers}</div></div>
          </div>
        </div>
      </div>

      <div className="topo-info-bar" dangerouslySetInnerHTML={{ __html: infoHtml }} />

      <div className="topo-facts">
        <div className="topo-fact-cell">
          <div className="topo-fact-num">69%</div>
          <div className="topo-fact-desc">{t.fact1}</div>
        </div>
        <div className="topo-fact-cell">
          <div className="topo-fact-num">2×</div>
          <div className="topo-fact-desc">{t.fact2}</div>
        </div>
        <div className="topo-fact-cell">
          <div className="topo-fact-num">40%</div>
          <div className="topo-fact-desc">{t.fact3}</div>
        </div>
      </div>
    </NoteLayout>
  )
}
