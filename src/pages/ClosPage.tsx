import { useState, useEffect, useRef, useCallback } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useTheme } from '../App'

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

export default function ClosPage() {
  const { theme } = useTheme()
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
  const [infoHtml, setInfoHtml] = useState(
    'Select a source and destination, then press <strong>Route</strong> to animate a packet through both topologies simultaneously.'
  )
  const [status, setStatus] = useState('select servers and press route')
  const [animating, setAnimating] = useState(false)

  const render = useCallback((closPkt: { x: number; y: number } | null = null, rngPkt: { x: number; y: number } | null = null, cp = closPath, rp = rngPath, cf = closFailed, rf = rngFailed, fm = failMode) => {
    if (closSvgRef.current) renderTopo(closSvgRef.current, CLOS, cf, cp, closPkt, fm)
    if (rngSvgRef.current) renderTopo(rngSvgRef.current, RNG, rf, rp, rngPkt, fm)
  }, [closPath, rngPath, closFailed, rngFailed, failMode])

  const updateRoute = useCallback((s = src, d = dst, cf = closFailed, rf = rngFailed) => {
    if (s === d) {
      setClosPath(null); setRngPath(null)
      setStatus('source and destination must differ')
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
      setInfoHtml('No path exists in either topology — too many failures. Clear some to restore connectivity.')
    } else if (!cp && rp) {
      setInfoHtml(`<strong>Clos is disconnected</strong> — the spine failure isolated these servers. RNG routes in <strong>${rh} hops</strong> via an alternate router. This is the key RNG resilience advantage.`)
    } else if (cp && !rp) {
      setInfoHtml(`RNG has no path (a dual-router failure). Clos routes in <strong>${ch} hops</strong>.`)
    } else {
      const diff = (ch ?? 0) - (rh ?? 0)
      if (diff > 0) {
        setInfoHtml(`<strong>${sl} → ${dl}:</strong> RNG routes in <strong>${rh} hops</strong> vs Clos <strong>${ch} hops</strong> — flat topology skips the hierarchy climb. RNG also has <strong>${ra}</strong> vs <strong>${ca}</strong> alternate paths.`)
      } else if (diff < 0) {
        setInfoHtml(`<strong>${sl} → ${dl}:</strong> Clos routes in <strong>${ch} hops</strong> vs RNG <strong>${rh} hops</strong>. For same-leaf traffic Clos can be competitive. Try cross-leaf pairs to see RNG's advantage.`)
      } else {
        setInfoHtml(`<strong>${sl} → ${dl}:</strong> Both route in <strong>${ch} hops</strong>. RNG has ${Number(ra) > Number(ca) ? `<strong>${ra}</strong> alternate paths vs ${ca}` : `${ra} alt paths`}. Try a cross-leaf pair (e.g. S0 → S7) or enable Fail Mode to see the difference.`)
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
        setStatus(`clos: ${c} hops · rng: ${r} hops`)
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
      title="Clos vs. RNG topology"
      date="2026-04-10"
      readTime="6 min"
      tags={['networking', 'datacenter']}
      intro="How AWS replaced hierarchical fat-tree (Clos) data center networks with a flat quasi-random topology — fewer routers, more paths, less power. Route packets through both topologies and use Fail Mode to see how each handles failures."
    >
      <div className="topo-controls">
        <span className="topo-ctrl-label">from</span>
        <select className="topo-select" value={src} onChange={e => { setSrc(e.target.value); updateRoute(e.target.value, dst) }}>
          {Array.from({ length: 8 }, (_, i) => (
            <option key={i} value={`sv${i}`}>S{i}</option>
          ))}
        </select>
        <span className="topo-ctrl-label">to</span>
        <select className="topo-select" value={dst} onChange={e => { setDst(e.target.value); updateRoute(src, e.target.value) }}>
          {Array.from({ length: 8 }, (_, i) => (
            <option key={i} value={`sv${i}`}>S{i}</option>
          ))}
        </select>
        <div className="topo-ctrl-sep" />
        <button className="topo-ctrl-btn" onClick={() => { updateRoute(); animate() }} disabled={animating}>Route</button>
        <button className="topo-ctrl-btn" onClick={() => {
          let a, b
          do { a = Math.floor(Math.random() * 8); b = Math.floor(Math.random() * 8) } while (a === b)
          setSrc(`sv${a}`); setDst(`sv${b}`)
          setTimeout(() => { updateRoute(`sv${a}`, `sv${b}`); animate() }, 0)
        }} disabled={animating}>Random</button>
        <div className="topo-ctrl-sep" />
        <button className={`topo-ctrl-btn${failMode ? ' toggled' : ''}`} onClick={() => {
          const next = !failMode
          setFailMode(next)
          setStatus(next ? 'click a spine/leaf switch or router to fail it' : 'fail mode off')
          if (closSvgRef.current) renderTopo(closSvgRef.current, CLOS, closFailed, closPath, null, next)
          if (rngSvgRef.current) renderTopo(rngSvgRef.current, RNG, rngFailed, rngPath, null, next)
        }}>Fail Mode</button>
        <button className="topo-ctrl-btn" onClick={() => {
          setClosFailed(new Set()); setRngFailed(new Set())
          updateRoute(src, dst, new Set(), new Set())
          setStatus('failures cleared')
        }}>Clear Failures</button>
        <span className="topo-ctrl-status">{status}</span>
      </div>

      <div className="topo-grid">
        <div className="topo-panel">
          <div className="topo-head">
            <div className="topo-name">Clos (Fat-Tree)</div>
            <div className="topo-badge">hierarchical · spine-leaf</div>
          </div>
          <div className="topo-svg-wrap">
            <svg ref={closSvgRef} className="topo-svg" viewBox="0 0 440 305"
              onClick={e => handleTopoClick(e, CLOS, closFailed, setClosFailed)} />
          </div>
          <div className="topo-stats">
            <div className="topo-stat-cell"><div className="topo-stat-val">{closHops !== null ? closHops : '—'}</div><div className="topo-stat-key">hops</div></div>
            <div className="topo-stat-cell"><div className="topo-stat-val">{closPath ? closAlt : '—'}</div><div className="topo-stat-key">alt paths</div></div>
            <div className="topo-stat-cell"><div className="topo-stat-val">6</div><div className="topo-stat-key">switches</div></div>
          </div>
        </div>

        <div className="topo-panel">
          <div className="topo-head">
            <div className="topo-name">RNG (Flat)</div>
            <div className="topo-badge">quasi-random · single tier</div>
          </div>
          <div className="topo-svg-wrap">
            <svg ref={rngSvgRef} className="topo-svg" viewBox="0 0 440 305"
              onClick={e => handleTopoClick(e, RNG, rngFailed, setRngFailed)} />
          </div>
          <div className="topo-stats">
            <div className="topo-stat-cell"><div className="topo-stat-val">{rngHops !== null ? rngHops : '—'}</div><div className="topo-stat-key">hops</div></div>
            <div className="topo-stat-cell"><div className="topo-stat-val">{rngPath ? rngAlt : '—'}</div><div className="topo-stat-key">alt paths</div></div>
            <div className="topo-stat-cell"><div className="topo-stat-val">4</div><div className="topo-stat-key">routers</div></div>
          </div>
        </div>
      </div>

      <div className="topo-info-bar" dangerouslySetInnerHTML={{ __html: infoHtml }} />

      <div className="topo-facts">
        <div className="topo-fact-cell">
          <div className="topo-fact-num">69%</div>
          <div className="topo-fact-desc">fewer routers needed in the flat RNG topology vs. traditional Clos</div>
        </div>
        <div className="topo-fact-cell">
          <div className="topo-fact-num">2×</div>
          <div className="topo-fact-desc">more independent paths between any two routers, improving redundancy</div>
        </div>
        <div className="topo-fact-cell">
          <div className="topo-fact-num">40%</div>
          <div className="topo-fact-desc">reduction in network equipment electricity consumption at AWS scale</div>
        </div>
      </div>
    </NoteLayout>
  )
}
