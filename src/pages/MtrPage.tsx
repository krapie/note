import { useState } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

type HopKind = 'normal' | 'deprio' | 'loss-start' | 'loss-cont'
type Scenario = 'deprio' | 'real-loss'

interface Hop {
  num: number
  host: string
  loss: number
  snt: number
  last: number | null
  avg: number
  best: number
  wrst: number
  stdev: number
  kind: HopKind
}

interface ScenarioDef {
  label: string
  hops: Hop[]
  verdict: string
  verdictKind: 'warn' | 'bad'
}


const SCENARIOS: Record<Scenario, ScenarioDef> = {
  deprio: {
    label: 'Case A — ICMP Deprioritization',
    verdict: 'Not real loss — hop 3 is rate-limiting its own ICMP TTL-exceeded replies',
    verdictKind: 'warn',
    hops: [
      { num: 1, host: '192.168.1.1   (gateway)',         loss: 0,  snt: 50, last: 1.2,  avg: 1.1,  best: 0.8,  wrst: 2.1,  stdev: 0.3, kind: 'normal' },
      { num: 2, host: '10.0.0.1      (isp-edge)',        loss: 0,  snt: 50, last: 8.3,  avg: 8.5,  best: 7.9,  wrst: 11.2, stdev: 0.5, kind: 'normal' },
      { num: 3, host: '72.14.221.4   (isp-backbone)',    loss: 20, snt: 50, last: null,  avg: 15.2, best: 14.1, wrst: 18.3, stdev: 0.8, kind: 'deprio' },
      { num: 4, host: '142.251.45.33 (transit-core)',    loss: 0,  snt: 50, last: 14.8, avg: 14.9, best: 14.1, wrst: 18.0, stdev: 0.6, kind: 'normal' },
      { num: 5, host: '108.170.246.3 (pop-edge)',        loss: 0,  snt: 50, last: 15.1, avg: 15.0, best: 14.5, wrst: 16.2, stdev: 0.4, kind: 'normal' },
      { num: 6, host: '8.8.8.8       (destination)',     loss: 0,  snt: 50, last: 15.3, avg: 15.2, best: 14.8, wrst: 16.5, stdev: 0.3, kind: 'normal' },
    ],
  },
  'real-loss': {
    label: 'Case B — Real Packet Loss',
    verdict: 'Real loss — starts at hop 4 and persists to the destination',
    verdictKind: 'bad',
    hops: [
      { num: 1, host: '192.168.1.1   (gateway)',         loss: 0,  snt: 50, last: 1.2,  avg: 1.1,  best: 0.8,  wrst: 2.1,  stdev: 0.3, kind: 'normal' },
      { num: 2, host: '10.0.0.1      (isp-edge)',        loss: 0,  snt: 50, last: 8.3,  avg: 8.5,  best: 7.9,  wrst: 11.2, stdev: 0.5, kind: 'normal' },
      { num: 3, host: '72.14.221.4   (isp-backbone)',    loss: 0,  snt: 50, last: 13.2, avg: 13.4, best: 12.9, wrst: 15.1, stdev: 0.5, kind: 'normal' },
      { num: 4, host: '142.251.45.33 (congested-link)',  loss: 20, snt: 50, last: 45.1, avg: 44.8, best: 42.3, wrst: 89.2, stdev: 8.1, kind: 'loss-start' },
      { num: 5, host: '108.170.246.3 (downstream)',      loss: 20, snt: 50, last: 46.3, avg: 46.1, best: 43.1, wrst: 90.1, stdev: 8.3, kind: 'loss-cont' },
      { num: 6, host: '8.8.8.8       (destination)',     loss: 20, snt: 50, last: 46.8, avg: 46.5, best: 44.0, wrst: 91.0, stdev: 8.5, kind: 'loss-cont' },
    ],
  },
}

const COL_DESC: Record<string, string> = {
  'Loss%': 'Percentage of probes that received no reply. The primary signal — check this column first.',
  'Snt':   'Total probes sent to this hop. More samples = more reliable statistics.',
  'Last':  'RTT (ms) of the most recent probe. Noisy single sample — prefer Avg for trend analysis.',
  'Avg':   'Mean round-trip time across all received probes. The primary latency signal.',
  'Best':  'Lowest RTT observed. Approximates the theoretical minimum latency for this path segment.',
  'Wrst':  'Highest RTT observed. A large Best↔Wrst gap indicates congestion or route flapping.',
  'StDev': 'Standard deviation of RTT. High StDev = jitter. Combine with Loss% — high StDev alone is jitter, not drops.',
}

const KIND_NOTE: Record<HopKind, (hop: Hop) => string> = {
  normal: (h) =>
    `Hop ${h.num} responded cleanly. Loss% is 0% and latency is stable. No action needed.`,
  deprio: (h) =>
    `Hop ${h.num} shows ${h.loss}% loss, but all downstream hops are at 0%. ` +
    `This router is deprioritizing ICMP TTL-exceeded responses — the probes MTR uses to measure each hop. ` +
    `This is deliberate CPU-protection behavior and is very common on backbone and transit routers. ` +
    `Forwarded traffic passes through unaffected. Treat this as 0% loss.`,
  'loss-start': (h) =>
    `Hop ${h.num} is where loss originates. The ${h.loss}% persists through every downstream hop to the destination — ` +
    `a clear sign of real packet loss. Packets are being dropped at this hop or on the link feeding it. ` +
    `Downstream hops are not independently dropping; they simply never receive those packets.`,
  'loss-cont': (h) =>
    `Hop ${h.num} shows ${h.loss}% loss, but it is inherited from upstream. ` +
    `Packets were already dropped before reaching this hop, so this is not an independent failure. ` +
    `Trace back to the first hop where loss appeared — that is where to investigate.`,
}

const CHEAT: Array<{ pattern: string; verdict: string; cls: string }> = [
  {
    pattern: 'Loss at hop N, all hops N+1… at 0%',
    verdict: 'ICMP deprioritization — not real loss, ignore',
    cls: 'mtr-cv-warn',
  },
  {
    pattern: 'Loss starts at hop N, continues to destination',
    verdict: 'Real loss — investigate hop N or its upstream link',
    cls: 'mtr-cv-bad',
  },
  {
    pattern: 'Only the final destination hop has loss',
    verdict: 'Destination rate-limits ICMP — confirm with TCP probe (curl, nc)',
    cls: 'mtr-cv-warn',
  },
  {
    pattern: 'High Wrst / StDev, Loss% = 0%',
    verdict: 'Jitter or transient congestion, not packet loss',
    cls: 'mtr-cv-ok',
  },
]

const MTR_T = {
  en: {
    title: 'Reading MTR output',
    readTime: '3 min',
    intro: 'MTR combines ping and traceroute into a continuous per-hop view of the path to a destination. The key skill is distinguishing ICMP deprioritization — a router rate-limiting its own probe replies — from real end-to-end packet loss.',
    realLoss: 'Real Loss', falseAlarm: 'False Alarm',
    hint: 'Click any row for an explanation · Click a column header to see what it measures',
    cheatTitle: 'Quick reference',
    scenarioLabels: {
      deprio: 'Case A — ICMP Deprioritization',
      'real-loss': 'Case B — Real Packet Loss',
    } as Record<Scenario, string>,
    scenarioVerdicts: {
      deprio: 'Not real loss — hop 3 is rate-limiting its own ICMP TTL-exceeded replies',
      'real-loss': 'Real loss — starts at hop 4 and persists to the destination',
    } as Record<Scenario, string>,
    colDesc: COL_DESC,
    kindNote: KIND_NOTE,
    cheat: CHEAT,
  },
  ko: {
    title: 'MTR 출력 읽기',
    readTime: '3분',
    intro: 'MTR은 ping과 traceroute를 결합하여 목적지까지의 경로를 홉별로 지속적으로 보여줍니다. 핵심 기술은 ICMP 역우선화 — 라우터가 자체 프로브 응답을 속도 제한하는 것 — 와 실제 종단 간 패킷 손실을 구별하는 것입니다.',
    realLoss: '실제 손실', falseAlarm: '오탐',
    hint: '행을 클릭하면 설명이 표시됩니다 · 열 헤더를 클릭하면 측정값을 확인할 수 있습니다',
    cheatTitle: '빠른 참조',
    scenarioLabels: {
      deprio: '케이스 A — ICMP 역우선화',
      'real-loss': '케이스 B — 실제 패킷 손실',
    } as Record<Scenario, string>,
    scenarioVerdicts: {
      deprio: '실제 손실 아님 — 홉 3이 자체 ICMP TTL 초과 응답을 속도 제한하고 있습니다',
      'real-loss': '실제 손실 — 홉 4에서 시작되어 목적지까지 지속됩니다',
    } as Record<Scenario, string>,
    colDesc: {
      'Loss%': '응답이 없는 프로브 비율. 주요 신호 — 이 열을 먼저 확인하세요.',
      'Snt':   '이 홉에 전송된 총 프로브 수. 샘플이 많을수록 통계가 더 신뢰할 수 있습니다.',
      'Last':  '가장 최근 프로브의 RTT(ms). 노이즈가 많은 단일 샘플 — 추세 분석에는 Avg를 사용하세요.',
      'Avg':   '수신된 모든 프로브의 평균 왕복 시간. 주요 레이턴시 신호.',
      'Best':  '관찰된 가장 낮은 RTT. 이 경로 세그먼트의 이론적 최소 레이턴시를 근사합니다.',
      'Wrst':  '관찰된 가장 높은 RTT. Best↔Wrst 차이가 크면 혼잡이나 경로 변동을 나타냅니다.',
      'StDev': 'RTT의 표준편차. StDev가 높으면 지터를 의미합니다. Loss%와 함께 분석하세요 — 높은 StDev만으로는 드롭이 아닌 지터입니다.',
    } as Record<string, string>,
    kindNote: {
      normal: (h: Hop) =>
        `홉 ${h.num}가 정상적으로 응답했습니다. Loss%는 0%이고 레이턴시가 안정적입니다. 조치 불필요.`,
      deprio: (h: Hop) =>
        `홉 ${h.num}에서 ${h.loss}% 손실이 표시되지만 다운스트림 홉이 모두 0%입니다. ` +
        `이 라우터가 MTR 측정에 사용하는 ICMP TTL 초과 응답을 역우선화하고 있습니다. ` +
        `이는 CPU 보호를 위한 의도적 동작으로 백본 및 트랜짓 라우터에서 매우 일반적입니다. ` +
        `전달 트래픽은 영향 없이 통과합니다. 0% 손실로 처리하세요.`,
      'loss-start': (h: Hop) =>
        `홉 ${h.num}에서 손실이 시작됩니다. ${h.loss}%가 목적지까지 모든 다운스트림 홉에 지속됩니다 — ` +
        `실제 패킷 손실의 명확한 신호입니다. 이 홉이나 이에 연결된 링크에서 패킷이 드롭됩니다. ` +
        `다운스트림 홉이 독립적으로 드롭하는 것이 아니라 단순히 해당 패킷을 수신하지 못합니다.`,
      'loss-cont': (h: Hop) =>
        `홉 ${h.num}에서 ${h.loss}% 손실이 표시되지만 업스트림에서 상속된 것입니다. ` +
        `이 홉에 도달하기 전에 패킷이 이미 드롭되었으므로 독립적인 장애가 아닙니다. ` +
        `손실이 처음 나타난 홉으로 거슬러 올라가세요 — 그곳이 조사할 지점입니다.`,
    } as Record<HopKind, (hop: Hop) => string>,
    cheat: [
      { pattern: '홉 N에서 손실, N+1 이후 홉 모두 0%', verdict: 'ICMP 역우선화 — 실제 손실 아님, 무시', cls: 'mtr-cv-warn' },
      { pattern: '홉 N에서 손실 시작, 목적지까지 지속', verdict: '실제 손실 — 홉 N 또는 업스트림 링크 조사', cls: 'mtr-cv-bad' },
      { pattern: '최종 목적지 홉만 손실', verdict: '목적지가 ICMP 속도 제한 — TCP 프로브로 확인 (curl, nc)', cls: 'mtr-cv-warn' },
      { pattern: '높은 Wrst / StDev, Loss% = 0%', verdict: '지터 또는 일시적 혼잡, 패킷 손실 아님', cls: 'mtr-cv-ok' },
    ],
  },
}

function fmt(n: number | null) {
  return n === null ? '—' : n.toFixed(1)
}

const STAT_COLS = ['Loss%', 'Snt', 'Last', 'Avg', 'Best', 'Wrst', 'StDev']

function MtrExplorer() {
  const [scenario, setScenario] = useState<Scenario>('deprio')
  const [activeHop, setActiveHop] = useState<number | null>(null)
  const [activeCol, setActiveCol] = useState<string | null>(null)
  const { lang } = useLang()
  const t = MTR_T[lang]

  const s = SCENARIOS[scenario]
  const hopDetail = activeHop !== null ? (s.hops.find(h => h.num === activeHop) ?? null) : null

  function switchScenario(sc: Scenario) {
    setScenario(sc)
    setActiveHop(null)
    setActiveCol(null)
  }

  function rowCls(kind: HopKind) {
    if (kind === 'deprio')     return 'mtr-row-deprio'
    if (kind === 'loss-start') return 'mtr-row-loss-start'
    if (kind === 'loss-cont')  return 'mtr-row-loss-cont'
    return ''
  }

  function lossCls(kind: HopKind) {
    if (kind === 'deprio')     return 'mtr-loss-warn'
    if (kind === 'loss-start') return 'mtr-loss-bad'
    if (kind === 'loss-cont')  return 'mtr-loss-dim'
    return 'mtr-loss-ok'
  }

  return (
    <div className="mtr-root">
      <div className="mtr-toggle">
        {(['deprio', 'real-loss'] as Scenario[]).map(sc => (
          <button
            key={sc}
            className={`mtr-toggle-btn${scenario === sc ? ' active' : ''}`}
            onClick={() => switchScenario(sc)}
          >
            {t.scenarioLabels[sc]}
          </button>
        ))}
      </div>

      <div className={`mtr-verdict mtr-verdict-${s.verdictKind}`}>
        <span className="mtr-verdict-label">
          {s.verdictKind === 'bad' ? t.realLoss : t.falseAlarm}
        </span>
        <span className="mtr-verdict-text">{t.scenarioVerdicts[scenario]}</span>
      </div>

      <div className="mtr-table-wrap">
        <div className="mtr-table">
          <div className="mtr-table-header">
            <span>#</span>
            <span>Host</span>
            {STAT_COLS.map(col => (
              <button
                key={col}
                className={`mtr-col-btn${activeCol === col ? ' active' : ''}`}
                onClick={() => {
                  setActiveCol(activeCol === col ? null : col)
                  setActiveHop(null)
                }}
              >
                {col}
              </button>
            ))}
          </div>
          {s.hops.map(hop => (
            <div
              key={hop.num}
              className={`mtr-table-row ${rowCls(hop.kind)}${activeHop === hop.num ? ' selected' : ''}`}
              onClick={() => {
                setActiveHop(activeHop === hop.num ? null : hop.num)
                setActiveCol(null)
              }}
            >
              <span className="mtr-col-num">{hop.num}</span>
              <span className="mtr-col-host">{hop.host}</span>
              <span className={`mtr-col-val ${lossCls(hop.kind)}`}>{hop.loss.toFixed(1)}%</span>
              <span className="mtr-col-val mtr-col-dim">{hop.snt}</span>
              <span className="mtr-col-val">{fmt(hop.last)}</span>
              <span className="mtr-col-val">{fmt(hop.avg)}</span>
              <span className="mtr-col-val mtr-col-dim">{fmt(hop.best)}</span>
              <span className="mtr-col-val mtr-col-dim">{fmt(hop.wrst)}</span>
              <span className="mtr-col-val mtr-col-dim">{fmt(hop.stdev)}</span>
            </div>
          ))}
        </div>
      </div>

      {activeCol ? (
        <div className="mtr-detail">
          <span className="mtr-detail-key">{activeCol}</span>
          <span className="mtr-detail-text">{t.colDesc[activeCol]}</span>
          <button className="mtr-detail-close" onClick={() => setActiveCol(null)}>×</button>
        </div>
      ) : hopDetail ? (
        <div className={`mtr-detail mtr-detail-${hopDetail.kind}`}>
          <span className="mtr-detail-key">hop {hopDetail.num}</span>
          <span className="mtr-detail-text">{t.kindNote[hopDetail.kind](hopDetail)}</span>
          <button className="mtr-detail-close" onClick={() => setActiveHop(null)}>×</button>
        </div>
      ) : (
        <div className="mtr-detail mtr-detail-hint">
          {t.hint}
        </div>
      )}

      <div className="mtr-cheatsheet">
        <div className="mtr-cheat-title">{t.cheatTitle}</div>
        {t.cheat.map((row, i) => (
          <div key={i} className="mtr-cheat-row">
            <div className="mtr-cheat-pattern">{row.pattern}</div>
            <div className={`mtr-cheat-verdict ${row.cls}`}>{row.verdict}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MtrPage() {
  const { lang } = useLang()
  const t = MTR_T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-06-13"
      readTime={t.readTime}
      tags={['networking', 'troubleshooting']}
      intro={t.intro}
    >
      <MtrExplorer />
    </NoteLayout>
  )
}
