import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type RbNodeId = 'ca' | 'cb' | 'cc' | 'srv'
type RbNodeSt = 'idle' | 'sending' | 'waiting' | 'done' | 'busy' | 'ok'
type RbLinkId = 'ca_srv' | 'cb_srv' | 'cc_srv'
type RbLinkSt = 'idle' | 'active' | 'failed' | 'success'

interface RbFrame {
  nodes:    Record<RbNodeId, RbNodeSt>
  links:    Record<RbLinkId, RbLinkSt>
  strategy: 'none' | 'plain' | 'backoff' | 'jitter'
  wait:     Record<'ca' | 'cb' | 'cc', string>
}

// ── Graph geometry ─────────────────────────────────────────────────────────────

const RGW = 500
const RGH = 210

const NODE_PX: Record<RbNodeId, [number, number]> = {
  ca:  [80,  45],
  cb:  [80, 105],
  cc:  [80, 165],
  srv: [420, 105],
}

const NODE_IDS: RbNodeId[] = ['ca', 'cb', 'cc', 'srv']

const LINKS: Array<{ id: RbLinkId; from: RbNodeId; to: RbNodeId }> = [
  { id: 'ca_srv', from: 'ca', to: 'srv' },
  { id: 'cb_srv', from: 'cb', to: 'srv' },
  { id: 'cc_srv', from: 'cc', to: 'srv' },
]

const LINK_PATHS: Record<RbLinkId, string> = {
  ca_srv: `M ${NODE_PX.ca[0]} ${NODE_PX.ca[1]} L ${NODE_PX.srv[0]} ${NODE_PX.srv[1]}`,
  cb_srv: `M ${NODE_PX.cb[0]} ${NODE_PX.cb[1]} L ${NODE_PX.srv[0]} ${NODE_PX.srv[1]}`,
  cc_srv: `M ${NODE_PX.cc[0]} ${NODE_PX.cc[1]} L ${NODE_PX.srv[0]} ${NODE_PX.srv[1]}`,
}

const LINK_PATHS_REV: Record<RbLinkId, string> = {
  ca_srv: `M ${NODE_PX.srv[0]} ${NODE_PX.srv[1]} L ${NODE_PX.ca[0]} ${NODE_PX.ca[1]}`,
  cb_srv: `M ${NODE_PX.srv[0]} ${NODE_PX.srv[1]} L ${NODE_PX.cb[0]} ${NODE_PX.cb[1]}`,
  cc_srv: `M ${NODE_PX.srv[0]} ${NODE_PX.srv[1]} L ${NODE_PX.cc[0]} ${NODE_PX.cc[1]}`,
}

// ── Frame data ─────────────────────────────────────────────────────────────────

const N0: Record<RbNodeId, RbNodeSt> = { ca: 'idle', cb: 'idle', cc: 'idle', srv: 'idle' }
const L0: Record<RbLinkId, RbLinkSt> = { ca_srv: 'idle', cb_srv: 'idle', cc_srv: 'idle' }
const W0 = { ca: '', cb: '', cc: '' }

const FRAMES: RbFrame[] = [
  // 0: overview
  { nodes: N0, links: L0, strategy: 'none', wait: W0 },
  // 1: all send simultaneously
  {
    nodes: { ca: 'sending', cb: 'sending', cc: 'sending', srv: 'busy' },
    links: { ca_srv: 'active', cb_srv: 'active', cc_srv: 'active' },
    strategy: 'none', wait: W0,
  },
  // 2: server rejects — error responses travel back
  {
    nodes: { ca: 'sending', cb: 'sending', cc: 'sending', srv: 'busy' },
    links: { ca_srv: 'failed', cb_srv: 'failed', cc_srv: 'failed' },
    strategy: 'plain', wait: W0,
  },
  // 3: naive retry — thundering herd
  {
    nodes: { ca: 'sending', cb: 'sending', cc: 'sending', srv: 'busy' },
    links: { ca_srv: 'active', cb_srv: 'active', cc_srv: 'active' },
    strategy: 'plain', wait: W0,
  },
  // 4: exponential backoff — same wait for all
  {
    nodes: { ca: 'waiting', cb: 'waiting', cc: 'waiting', srv: 'idle' },
    links: L0,
    strategy: 'backoff',
    wait: { ca: 'wait: 8s', cb: 'wait: 8s', cc: 'wait: 8s' },
  },
  // 5: backoff expires — all retry simultaneously (still synchronized)
  {
    nodes: { ca: 'sending', cb: 'sending', cc: 'sending', srv: 'busy' },
    links: { ca_srv: 'active', cb_srv: 'active', cc_srv: 'active' },
    strategy: 'backoff',
    wait: W0,
  },
  // 6: full jitter — clients staggered
  {
    nodes: { ca: 'done', cb: 'waiting', cc: 'sending', srv: 'ok' },
    links: { ca_srv: 'success', cb_srv: 'idle', cc_srv: 'active' },
    strategy: 'jitter',
    wait: { ca: '', cb: 'wait: 3s', cc: '' },
  },
]

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title:    'Retry and exponential backoff',
    readTime: '5 min',
    intro:    `When a downstream service is unavailable, the simplest recovery strategy — immediate retry — reliably makes things worse. Three clients retrying in lockstep hammer a recovering server with the same request spike that overloaded it. Exponential backoff adds increasing delays between attempts; jitter randomizes those delays so clients no longer synchronize. This note walks through the problem and compares six retry strategies.`,
    nodeLabel: { ca: 'Client A', cb: 'Client B', cc: 'Client C', srv: 'Server' } as Record<RbNodeId, string>,
    nodeSub:   { ca: 'retry client', cb: 'retry client', cc: 'retry client', srv: 'api server' } as Record<RbNodeId, string>,
    strategyBadge: { none: '', plain: 'no backoff', backoff: 'exponential backoff', jitter: 'full jitter' } as Record<string, string>,
    busyBadge: '503',
    okBadge:   '200',
    strategies: [
      { name: 'No retry',     formula: '—',                              ex: '—',             load: 'Single failure = outage' },
      { name: 'Immediate',    formula: '0',                              ex: '0s',            load: 'Thundering herd' },
      { name: 'Fixed delay',  formula: 'base',                           ex: '1s',            load: 'Synchronized spike' },
      { name: 'Exponential',  formula: 'min(cap, base × 2ⁿ)',           ex: '8s (all same)', load: 'Synchronized medium spike' },
      { name: 'Full Jitter',  formula: 'rand(0, min(cap, base × 2ⁿ))', ex: 'rand(0, 8s)',   load: 'Spread — recommended' },
      { name: 'Decorrelated', formula: 'rand(base, prev × 3)',           ex: '~varies',       load: 'Spread — best avg wait' },
    ],
    strategyTitle:   'Retry strategy comparison',
    strategyHeaders: ['Strategy', 'Wait formula', 'Example (n=3, base=1s)', 'Server load'],
    frames: [
      {
        title: 'Retry and exponential backoff',
        note:  `A client retrying after a transient failure is correct behavior. The problem emerges at scale: when many clients fail at the same moment and then retry at the same moment, the retry wave looks identical to the original overload. The server never has a quiet window to recover. The fix is in how you schedule retries, not whether to retry.`,
      },
      {
        title: 't=0: all three clients request simultaneously',
        note:  `Three clients send requests to the same server at the same time. The server is under heavy load and responds with 503 Service Unavailable to all three. The clients now face a decision: when to retry. Whatever they choose, all three will choose the same thing — they received their errors at the same moment.`,
      },
      {
        title: 'Server busy — 503 error returned to all clients',
        note:  `The 503 responses travel back to each client. Each must decide: retry immediately, wait a fixed time, or back off. Without coordination, their next move will be synchronized — they all received the error at the same instant, so any fixed timer they choose will expire at the same instant.`,
      },
      {
        title: 'Naive retry: all three retry simultaneously (thundering herd)',
        note:  `With no backoff, all three clients retry immediately after receiving the error. The server, which was struggling to recover, receives another burst of three simultaneous requests — the same spike that caused the failure. This is the thundering herd problem: each retry wave prevents the server from recovering.`,
      },
      {
        title: `Exponential backoff — each client waits min(cap, base × 2ⁿ)`,
        note:  `Exponential backoff: wait = min(cap, base × 2ⁿ). After 3 failures with base=1s and cap=30s, each client computes min(30, 1×2³) = 8 seconds and starts a timer. The server gets a quiet window to recover. But notice: all three clients computed the exact same value. Their timers will all expire at the exact same moment.`,
      },
      {
        title: `Backoff expires — all three retry at t+8s simultaneously`,
        note:  `Eight seconds later, every timer fires at once. All three clients send their retry requests simultaneously — and the server sees the exact same spike it saw at t=0. Exponential backoff reduces the frequency of retry waves and gives the server breathing room between them, but it does not stagger the wave itself. The synchronized burst is the problem that remains.`,
      },
      {
        title: 'Full jitter — spread across the retry window',
        note:  `Full jitter: wait = rand(0, min(cap, base × 2ⁿ)). Each client independently picks a random value in [0, 8s]. Client A drew a short wait and already succeeded. Client C just started retrying. Client B is still waiting 3 more seconds. The load is now spread across an 8-second window instead of arriving all at once. The AWS Builders Library recommends full jitter for distributed systems retry logic.`,
      },
    ],
  },
  ko: {
    title:    '재시도와 지수 백오프',
    readTime: '5분',
    intro:    `다운스트림 서비스가 일시적으로 불가용 상태일 때, 가장 단순한 복구 전략인 즉시 재시도는 오히려 상황을 악화시킵니다. 여러 클라이언트가 동시에 재시도하면 서버를 처음 과부하시킨 것과 동일한 스파이크가 다시 발생합니다. 지수 백오프는 재시도 사이에 점점 늘어나는 대기 시간을 추가하고, 지터(jitter)는 그 대기 시간을 무작위화해 클라이언트들의 재시도가 동기화되지 않도록 합니다.`,
    nodeLabel: { ca: '클라이언트 A', cb: '클라이언트 B', cc: '클라이언트 C', srv: '서버' } as Record<RbNodeId, string>,
    nodeSub:   { ca: '재시도 클라이언트', cb: '재시도 클라이언트', cc: '재시도 클라이언트', srv: 'API 서버' } as Record<RbNodeId, string>,
    strategyBadge: { none: '', plain: '백오프 없음', backoff: '지수 백오프', jitter: '풀 지터' } as Record<string, string>,
    busyBadge: '503',
    okBadge:   '200',
    strategies: [
      { name: '재시도 없음',  formula: '—',                              ex: '—',              load: '단일 장애 = 전체 중단' },
      { name: '즉시 재시도',  formula: '0',                              ex: '0s',             load: '천둥 무리 (Thundering Herd)' },
      { name: '고정 지연',    formula: 'base',                           ex: '1s',             load: '동기화된 스파이크' },
      { name: '지수 백오프',  formula: 'min(cap, base × 2ⁿ)',           ex: '8s (모두 동일)', load: '동기화된 중간 스파이크' },
      { name: '풀 지터',      formula: 'rand(0, min(cap, base × 2ⁿ))', ex: 'rand(0, 8s)',    load: '분산 — 권장' },
      { name: '비상관 지터',  formula: 'rand(base, prev × 3)',           ex: '~가변',          load: '분산 — 평균 대기 최적' },
    ],
    strategyTitle:   '재시도 전략 비교',
    strategyHeaders: ['전략', '대기 공식', '예시 (n=3, base=1s)', '서버 부하'],
    frames: [
      {
        title: '재시도와 지수 백오프',
        note:  `일시적인 장애 후 클라이언트가 재시도하는 것은 올바른 동작입니다. 문제는 규모에서 발생합니다: 많은 클라이언트가 같은 순간에 실패하고 같은 순간에 재시도하면, 재시도 파동이 원래의 과부하와 동일하게 보입니다. 서버는 복구할 조용한 시간이 없습니다. 핵심은 재시도 여부가 아니라 재시도 시점을 어떻게 스케줄링하느냐입니다.`,
      },
      {
        title: 't=0: 세 클라이언트가 동시에 요청',
        note:  `세 클라이언트가 같은 서버에 동시에 요청을 보냅니다. 서버는 과부하 상태로 세 요청 모두에 503 Service Unavailable을 응답합니다. 클라이언트들은 언제 재시도할지 결정해야 합니다. 문제는 무엇을 선택하든 세 클라이언트가 같은 순간에 오류를 받았기 때문에 선택이 자연히 동기화된다는 것입니다.`,
      },
      {
        title: '서버 과부하 — 503 에러가 모든 클라이언트에 반환됨',
        note:  `503 응답이 각 클라이언트로 돌아옵니다. 각 클라이언트는 즉시 재시도, 고정 시간 대기, 또는 백오프 중 하나를 선택해야 합니다. 조율 없이는 다음 행동이 동기화됩니다 — 같은 순간에 오류를 받았기 때문에 어떤 고정 타이머를 선택하든 같은 순간에 0이 됩니다.`,
      },
      {
        title: 'Naive 재시도: 세 클라이언트가 동시에 재시도 (천둥 무리)',
        note:  `백오프 없이 세 클라이언트 모두 오류를 받은 직후 즉시 재시도합니다. 복구를 시도하던 서버는 또다시 세 개의 동시 요청을 받습니다 — 장애를 일으킨 것과 동일한 스파이크입니다. 이것이 천둥 무리(thundering herd) 문제입니다. 각 재시도 파동이 서버의 복구를 방해합니다.`,
      },
      {
        title: `지수 백오프 — 각 클라이언트가 min(cap, base × 2ⁿ) 대기`,
        note:  `지수 백오프: wait = min(cap, base × 2ⁿ). 3회 실패 후 base=1s, cap=30s로 계산하면 min(30, 1×2³) = 8초입니다. 각 클라이언트가 타이머를 시작하고, 서버는 복구할 조용한 시간을 얻습니다. 그런데 세 클라이언트 모두 정확히 같은 값 8초를 계산했습니다. 타이머는 정확히 같은 순간에 만료됩니다.`,
      },
      {
        title: `백오프 만료 — t+8s에 세 클라이언트가 동시에 재시도`,
        note:  `8초 후 모든 타이머가 동시에 만료됩니다. 세 클라이언트가 동시에 재시도 요청을 보내고, 서버는 t=0에 보았던 것과 동일한 스파이크를 받습니다. 지수 백오프는 재시도 파동의 빈도를 줄이고 파동 사이에 서버 복구 시간을 주지만, 파동 자체를 분산시키지는 못합니다. 동기화된 버스트가 아직 해결되지 않은 문제입니다.`,
      },
      {
        title: '풀 지터 — 재시도 윈도우 전체에 분산',
        note:  `풀 지터: wait = rand(0, min(cap, base × 2ⁿ)). 각 클라이언트가 [0, 8s] 범위에서 독립적으로 무작위 값을 선택합니다. 클라이언트 A는 짧은 대기 후 이미 성공했습니다. 클라이언트 C는 방금 재시도를 시작했습니다. 클라이언트 B는 아직 3초를 더 기다립니다. 재시도 부하가 한꺼번에 몰리지 않고 8초 윈도우 전체에 분산됩니다. AWS Builders Library는 분산 시스템 재시도에 풀 지터를 권장합니다.`,
      },
    ],
  },
}

// ── Graph ──────────────────────────────────────────────────────────────────────

function RbGraph({ frame, t }: { frame: RbFrame; t: typeof T['en'] }) {
  return (
    <div className="rb-graph-canvas">
      <svg viewBox={`0 0 ${RGW} ${RGH}`} className="rb-graph-svg" preserveAspectRatio="none">
        <defs>
          {LINKS.map(({ id }) => (
            <path key={id} id={`rbp-${id}`} d={LINK_PATHS[id]} fill="none" />
          ))}
          {LINKS.map(({ id }) => (
            <path key={`${id}_rev`} id={`rbp-${id}_rev`} d={LINK_PATHS_REV[id]} fill="none" />
          ))}
        </defs>

        {/* Link lines */}
        {LINKS.map(({ id, from, to }) => {
          const [x1, y1] = NODE_PX[from]
          const [x2, y2] = NODE_PX[to]
          const st = frame.links[id]
          return (
            <line key={id} x1={x1} y1={y1} x2={x2} y2={y2}
              className={`rb-sline rb-sline-${st}`} strokeWidth="2" />
          )
        })}

        {/* Forward dots — active and success */}
        {LINKS.map(({ id }) => {
          const st = frame.links[id]
          if (st !== 'active' && st !== 'success') return null
          return (
            <circle key={`dot-${id}`} r="5" className="rb-gdot">
              <animateMotion dur="1.0s" repeatCount="indefinite">
                <mpath href={`#rbp-${id}`} />
              </animateMotion>
            </circle>
          )
        })}

        {/* Reverse dots — failed: error response travels back to client */}
        {LINKS.map(({ id }) => {
          if (frame.links[id] !== 'failed') return null
          return (
            <circle key={`dot-rev-${id}`} r="5" className="rb-gdot rb-gdot-fail">
              <animateMotion dur="1.0s" repeatCount="indefinite">
                <mpath href={`#rbp-${id}_rev`} />
              </animateMotion>
            </circle>
          )
        })}
      </svg>

      {/* Strategy badge */}
      {frame.strategy !== 'none' && (
        <span className={`rb-strategy-badge rb-strategy-${frame.strategy}`}>
          {t.strategyBadge[frame.strategy]}
        </span>
      )}

      {/* Node boxes */}
      {NODE_IDS.map(nid => {
        const [px, py] = NODE_PX[nid]
        const st = frame.nodes[nid]
        return (
          <div key={nid}
            className={`rb-gnode rb-gnode-${st}`}
            style={{ left: `${(px / RGW) * 100}%`, top: `${(py / RGH) * 100}%` }}
          >
            <span className="rb-gnode-label">{t.nodeLabel[nid]}</span>
            <span className="rb-gnode-sub">{t.nodeSub[nid]}</span>
            {nid === 'srv' && st === 'busy' && (
              <span className="rb-busy-badge">{t.busyBadge}</span>
            )}
            {nid === 'srv' && st === 'ok' && (
              <span className="rb-ok-badge">{t.okBadge}</span>
            )}
            {(nid === 'ca' || nid === 'cb' || nid === 'cc') && frame.wait[nid] && (
              <span className="rb-wait-badge">{frame.wait[nid]}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Explorer ───────────────────────────────────────────────────────────────────

function RbExplorer() {
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
      <RbGraph frame={frame} t={t} />
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

// ── Strategy table ─────────────────────────────────────────────────────────────

function StrategyTable() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <div className="ov-proto-section">
      <div className="bgp2-section-title">{t.strategyTitle}</div>
      <table className="ov-proto-table">
        <thead>
          <tr>{t.strategyHeaders.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.strategies.map(s => (
            <tr key={s.name}>
              <td>{s.name}</td>
              <td><code className="rb-formula-code">{s.formula}</code></td>
              <td><code className="rb-formula-code">{s.ex}</code></td>
              <td>{s.load}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function RetryPage() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-07-19"
      readTime={t.readTime}
      tags={['distributed-systems', 'reliability', 'backoff', 'resilience']}
      intro={t.intro}
    >
      <RbExplorer />
      <StrategyTable />
    </NoteLayout>
  )
}
