import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type RepStatus = 'idle' | 'active' | 'synced' | 'done'
type SyncDir   = 'fwd' | 'rev' | null

// LWW-Register
interface LwwReg   { val: string; ts: number }
interface LwwFrame { sa: RepStatus; sb: RepStatus; link: 'idle'|'active'|'done'; dir: SyncDir; ra: LwwReg; rb: LwwReg }

// RGA
interface RgaChar  { ch: string; id: string; isNew?: boolean }
interface RgaFrame { sa: RepStatus; sb: RepStatus; link: 'idle'|'active'|'done'; dir: SyncDir; docA: RgaChar[]; docB: RgaChar[] }

// ── Graph geometry ─────────────────────────────────────────────────────────────

const LWWW = 480; const LWWH = 130
const LWW_AX = 80;  const LWW_AY = 65
const LWW_BX = 400; const LWW_BY = 65

const RGAW = 520; const RGAH = 130
const RGA_AX = 100; const RGA_AY = 65
const RGA_BX = 420; const RGA_BY = 65

// ── LWW frame data ─────────────────────────────────────────────────────────────

const LWW_FRAMES: LwwFrame[] = [
  { sa:'idle',   sb:'idle',   link:'idle',   dir:null,  ra:{val:'—',       ts:0}, rb:{val:'—',       ts:0} },
  { sa:'active', sb:'active', link:'idle',   dir:null,  ra:{val:'"Alice"', ts:5}, rb:{val:'"Bob"',   ts:3} },
  { sa:'done',   sb:'synced', link:'active', dir:'fwd', ra:{val:'"Alice"', ts:5}, rb:{val:'"Alice"', ts:5} },
  { sa:'done',   sb:'done',   link:'active', dir:'rev', ra:{val:'"Alice"', ts:5}, rb:{val:'"Alice"', ts:5} },
  { sa:'done',   sb:'done',   link:'done',   dir:null,  ra:{val:'"Alice"', ts:5}, rb:{val:'"Alice"', ts:5} },
]

// ── RGA frame data ─────────────────────────────────────────────────────────────

const RGA_FRAMES: RgaFrame[] = [
  { sa:'idle',   sb:'idle',   link:'idle',   dir:null,
    docA:[{ch:'a',id:'1·A'},{ch:'b',id:'2·A'}],
    docB:[{ch:'a',id:'1·A'},{ch:'b',id:'2·A'}] },
  { sa:'active', sb:'idle',   link:'idle',   dir:null,
    docA:[{ch:'a',id:'1·A'},{ch:'x',id:'3·A',isNew:true},{ch:'b',id:'2·A'}],
    docB:[{ch:'a',id:'1·A'},{ch:'b',id:'2·A'}] },
  { sa:'done',   sb:'active', link:'idle',   dir:null,
    docA:[{ch:'a',id:'1·A'},{ch:'x',id:'3·A'},{ch:'b',id:'2·A'}],
    docB:[{ch:'a',id:'1·A'},{ch:'y',id:'3·B',isNew:true},{ch:'b',id:'2·A'}] },
  { sa:'done',   sb:'synced', link:'active', dir:'fwd',
    docA:[{ch:'a',id:'1·A'},{ch:'x',id:'3·A'},{ch:'b',id:'2·A'}],
    docB:[{ch:'a',id:'1·A'},{ch:'y',id:'3·B'},{ch:'x',id:'3·A',isNew:true},{ch:'b',id:'2·A'}] },
  { sa:'synced', sb:'done',   link:'active', dir:'rev',
    docA:[{ch:'a',id:'1·A'},{ch:'y',id:'3·B',isNew:true},{ch:'x',id:'3·A'},{ch:'b',id:'2·A'}],
    docB:[{ch:'a',id:'1·A'},{ch:'y',id:'3·B'},{ch:'x',id:'3·A'},{ch:'b',id:'2·A'}] },
  { sa:'done',   sb:'done',   link:'done',   dir:null,
    docA:[{ch:'a',id:'1·A'},{ch:'y',id:'3·B'},{ch:'x',id:'3·A'},{ch:'b',id:'2·A'}],
    docB:[{ch:'a',id:'1·A'},{ch:'y',id:'3·B'},{ch:'x',id:'3·A'},{ch:'b',id:'2·A'}] },
]

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title:    'CRDT — conflict-free collaborative editing',
    readTime: '6 min',
    intro:    `When two users edit the same document simultaneously, their changes must be merged without data loss. Operational Transformation (OT) solved this with a central server that reorders and adjusts concurrent operations. CRDTs (Conflict-free Replicated Data Types) take a different approach: every operation is designed so that any merge order produces identical results — no server, no coordination required. Yorkie, Yjs, and Automerge all build on this foundation.`,

    // ── OT vs CRDT ──
    sectionOt:       'OT vs CRDT',
    otTitle:         'OT — Operational Transformation',
    crdtTitle:       'CRDT — Conflict-free Replicated Data Type',
    otTag:           'server-coordinated',
    crdtTag:         'peer-to-peer',
    otPoints: [
      'A central server sequences and transforms all concurrent operations',
      'Server adjusts each op\'s position relative to ops that arrived earlier',
      'Clients cannot apply ops locally until the server acks — latency under network partition',
      'Transformation functions are notoriously hard to implement correctly for complex op types',
    ],
    crdtPoints: [
      'No central server — replicas sync directly, in any order, at any time',
      'Every character carries a unique, globally ordered ID: (Lamport timestamp, actor ID)',
      'Merge is always deterministic: same inputs → same document, regardless of sync order',
      'Used by Yorkie (open-source), Yjs, Automerge for real-time collaborative apps',
    ],
    scenarioTitle:  'Scenario: "Hello" — A deletes \'H\', B inserts \'J\' concurrently',
    otScenario:     'A: delete pos 0 → "ello". B: insert \'J\' at pos 0. Without transformation: apply B then A → "Jello" ✓, apply A then B → "Jello" ✓ only if server reorders. OT server transforms B\'s position (0 → 0) after A\'s delete. Works, but logic breaks for complex nested ops.',
    crdtScenario:   '\'H\' is tombstoned by ID, not by position. \'J\' references its left-neighbor\'s ID (the start-of-document sentinel). Merge order is irrelevant — both replicas produce "Jello" from the same character IDs, every time.',

    // ── LWW ──
    sectionLww:  'LWW-Register — logical timestamp',
    lwwNodeA:    'Replica A',
    lwwNodeB:    'Replica B',
    lwwLink:     'sync',
    lwwFrames: [
      { title: 'Init — register is empty on both replicas',
        note:  'A LWW-Register stores one value paired with a Lamport timestamp. The Lamport clock increments on every local write, and on sync it jumps to max(local, received) + 1 — guaranteeing causal ordering without wall-clock coordination. Both replicas start at ts = 0.' },
      { title: 'Concurrent writes — no coordination needed',
        note:  'Replica A writes "Alice" with ts = 5. Concurrently, Replica B writes "Bob" with ts = 3. Neither knows about the other\'s write yet. Two different values exist simultaneously across the system — this is the conflict the LWW rule will resolve.' },
      { title: 'A → B sync — higher timestamp wins',
        note:  'A sends {val:"Alice", ts:5} to B. B compares: incoming ts = 5 > local ts = 3. B discards "Bob" and adopts "Alice" at ts = 5. The merge rule is simply: keep the value with the higher Lamport timestamp. No server, no lock, no negotiation.' },
      { title: 'B → A sync — idempotent, A unchanged',
        note:  'B sends {val:"Alice", ts:5} to A. A compares: incoming ts = 5 = local ts = 5. Tie → keep current value (or apply a consistent tiebreak, e.g. lexicographic actor ID). A is unchanged. Syncing already-seen data never corrupts state — this is the idempotency guarantee.' },
      { title: 'Converged — both replicas hold "Alice"',
        note:  'Both replicas hold {val:"Alice", ts:5}. Any further sync is a no-op. Tradeoff: "Bob" was silently discarded — LWW is not safe when all writes must survive. For that, use a multi-value register (returns a conflict set) or an OR-Set.' },
    ],

    // ── RGA ──
    sectionRga:  'RGA — collaborative text (Yorkie)',
    rgaNodeA:    'Replica A',
    rgaNodeB:    'Replica B',
    rgaDocA:     'Doc A',
    rgaDocB:     'Doc B',
    rgaLink:     'sync',
    rgaFrames: [
      { title: 'Init — document "ab" with unique character IDs',
        note:  'RGA (Replicated Growable Array) assigns every character a unique ID: (Lamport timestamp, actor ID). Replica A created this document — both characters carry actor A. Insertions reference a left-neighbor\'s ID, not an integer index. This eliminates the position-shift problem that makes OT transformation functions complex.' },
      { title: 'A inserts \'x\' between \'a\' and \'b\'',
        note:  'Replica A inserts \'x\' with ID (3,A) after the character with ID (1,A). The local document becomes "axb". Replica B is unaware of this change. Note that A references the neighbor\'s ID — if other characters are inserted before 'b' concurrently, the relative position of \'x\' stays correct.' },
      { title: 'B inserts \'y\' concurrently — same left neighbor',
        note:  'Replica B also inserts after the character with ID (1,A) — the same left neighbor as A used. B\'s character gets ID (3,B). Locally B has "ayb", A has "axb". Both are valid locally, but the replicas have diverged. RGA must place both characters after (1,A) in a deterministic order.' },
      { title: 'A → B sync — ticket (3,B) > (3,A), y placed first',
        note:  'A sends x·(3,A) to B. B must now place both x and y after (1,A). Tie-break by descending ticket: (3,B) > (3,A) → y wins and goes first. B\'s document: [a·1A, y·3B, x·3A, b·2A] = "ayxb". This is exactly how Yorkie\'s TimeTicket works — descending Lamport timestamp, then descending actor ID as tiebreak.' },
      { title: 'B → A sync — A applies the same ordering',
        note:  'B sends y·(3,B) to A. A applies the identical ticket comparison and places y before x. A\'s document becomes "ayxb" — matching B exactly. Sync order did not matter: A-first or B-first, the result is always the same. That\'s the CRDT convergence guarantee.' },
      { title: 'Converged — "ayxb" on both replicas',
        note:  'Both replicas hold the same character sequence. Neither A\'s intent ("axb") nor B\'s intent ("ayb") fully won — the merge is deterministic but not intent-preserving. In practice Yorkie and Yjs layer undo/redo and operational intent on top so users can correct surprising merges. The CRDT handles convergence; the application handles UX.' },
    ],
  },

  ko: {
    title:    'CRDT — 충돌 없는 분산 협업 편집',
    readTime: '6분',
    intro:    `두 사용자가 같은 문서를 동시에 편집하면 데이터 손실 없이 변경 사항을 병합해야 합니다. OT(Operational Transformation)는 중앙 서버가 동시 연산의 순서를 조정하는 방식으로 이 문제를 해결했습니다. CRDT(Conflict-free Replicated Data Type)는 다르게 접근합니다 — 어떤 순서로 병합해도 동일한 결과가 나오도록 연산 자체를 설계합니다. 서버도 조정도 필요 없습니다. Yorkie, Yjs, Automerge 모두 이 원리 위에 구축됩니다.`,

    sectionOt:       'OT vs CRDT',
    otTitle:         'OT — Operational Transformation',
    crdtTitle:       'CRDT — Conflict-free Replicated Data Type',
    otTag:           '서버 조정 필요',
    crdtTag:         '피어-투-피어',
    otPoints: [
      '중앙 서버가 모든 동시 연산을 순서대로 처리하고 변환',
      '서버가 먼저 도착한 연산 기준으로 이후 연산의 위치를 보정(transform)',
      '서버 응답 전까지 로컬 적용 불가 — 네트워크 단절 시 지연 및 복잡성',
      '변환 함수(transformation function)는 복잡한 연산 조합에서 구현이 매우 어려움',
    ],
    crdtPoints: [
      '중앙 서버 불필요 — 어떤 순서, 어떤 시점에 동기화해도 동일 결과',
      '모든 문자에 전역 고유 ID 부여: (Lamport 타임스탬프, 액터 ID)',
      '병합은 항상 결정적: 같은 입력 → 같은 문서, 항상 보장',
      'Yorkie(오픈소스), Yjs, Automerge가 실시간 협업에 사용',
    ],
    scenarioTitle:  '시나리오: "Hello" — A가 \'H\' 삭제, B가 \'J\' 삽입 동시 발생',
    otScenario:     'A: pos 0 삭제 → "ello". B: pos 0에 \'J\' 삽입. 서버 없이 적용 순서가 다르면 결과가 달라집니다. OT 서버는 A의 삭제 후 B의 위치를 보정(0→0)하여 "Jello"를 보장합니다. 단, 복잡한 중첩 연산에서 변환 로직이 깨지기 쉽습니다.',
    crdtScenario:   '\'H\'는 위치가 아닌 ID로 tombstone 표시. \'J\'는 왼쪽 이웃의 ID를 참조 — 절대 위치 없음. 병합 순서에 무관하게 두 레플리카 모두 "Jello"를 동일하게 생성합니다.',

    sectionLww:  'LWW-Register — 논리적 타임스탬프',
    lwwNodeA:    '레플리카 A',
    lwwNodeB:    '레플리카 B',
    lwwLink:     '동기화',
    lwwFrames: [
      { title: 'Init — 양쪽 레플리카 레지스터 비어 있음',
        note:  'LWW-Register는 하나의 값과 Lamport 타임스탬프를 함께 저장합니다. Lamport 클록은 쓰기마다 증가하고 동기화 시 max(로컬, 수신)+1로 점프합니다 — 벽시계 없이 인과적 순서를 보장합니다. 양쪽 모두 ts=0에서 시작합니다.' },
      { title: '동시 쓰기 — 조정 없이 독립 실행',
        note:  '레플리카 A가 ts=5로 "Alice"를 씁니다. 동시에 레플리카 B가 ts=3으로 "Bob"을 씁니다. 아직 서로의 쓰기를 모릅니다. 두 개의 다른 값이 시스템 전체에 동시에 존재합니다 — LWW 규칙이 해결할 충돌입니다.' },
      { title: 'A → B 동기화 — 높은 타임스탬프 승리',
        note:  'A가 {val:"Alice", ts:5}를 B에 전송합니다. B가 비교: 수신 ts=5 > 로컬 ts=3. B는 "Bob"을 버리고 ts=5로 "Alice"를 채택합니다. 병합 규칙은 단순합니다: 더 높은 Lamport 타임스탬프를 유지. 서버도 잠금도 협상도 없습니다.' },
      { title: 'B → A 동기화 — 멱등성, A 변경 없음',
        note:  'B가 {val:"Alice", ts:5}를 A에 전송합니다. A가 비교: 수신 ts=5 = 로컬 ts=5. 동점 → 현재 값 유지(또는 액터 ID 기준 일관된 tiebreak). A는 변경되지 않습니다. 이미 본 데이터를 다시 동기화해도 상태가 손상되지 않습니다 — 멱등성 보장입니다.' },
      { title: '수렴 완료 — 두 레플리카 모두 "Alice"',
        note:  '두 레플리카 모두 {val:"Alice", ts:5}를 보유합니다. 이후 동기화는 no-op이 됩니다. 단점: "Bob"이 조용히 손실되었습니다. 모든 쓰기를 보존해야 한다면 multi-value register(충돌 셋 반환) 또는 OR-Set을 사용해야 합니다.' },
    ],

    sectionRga:  'RGA — 협업 텍스트 (Yorkie)',
    rgaNodeA:    '레플리카 A',
    rgaNodeB:    '레플리카 B',
    rgaDocA:     '문서 A',
    rgaDocB:     '문서 B',
    rgaLink:     '동기화',
    rgaFrames: [
      { title: 'Init — 문서 "ab", 고유 ID를 가진 두 문자',
        note:  'RGA(Replicated Growable Array)는 모든 문자에 고유 ID를 부여합니다: (Lamport 타임스탬프, 액터 ID). 레플리카 A가 이 문서를 생성했으므로 두 문자 모두 액터 A를 가집니다. 삽입은 정수 인덱스가 아닌 왼쪽 이웃의 ID를 참조합니다 — OT의 위치 이동 문제를 원천적으로 제거합니다.' },
      { title: 'A가 \'a\'와 \'b\' 사이에 \'x\' 삽입',
        note:  '레플리카 A가 ID (1,A)를 가진 문자 다음에 ID (3,A)로 \'x\'를 삽입합니다. 로컬 문서는 "axb"가 됩니다. 레플리카 B는 이 변경을 아직 모릅니다. A는 이웃 ID를 참조하므로 그 사이에 다른 문자가 동시에 삽입되어도 \'x\'의 상대 위치는 올바르게 유지됩니다.' },
      { title: 'B가 동일한 왼쪽 이웃에 \'y\' 동시 삽입',
        note:  '레플리카 B도 ID (1,A) 다음에 삽입합니다 — A와 동일한 왼쪽 이웃. B의 문자는 ID (3,B)를 받습니다. 로컬로 B는 "ayb", A는 "axb"를 가집니다. 두 레플리카가 분기했습니다. RGA가 두 문자를 (1,A) 다음에 결정적 순서로 배치해야 합니다.' },
      { title: 'A → B 동기화 — ticket (3,B) > (3,A), y가 먼저',
        note:  'A가 x·(3,A)를 B에 전송합니다. B는 x와 y를 모두 (1,A) 다음에 배치해야 합니다. Ticket 내림차순 비교: (3,B) > (3,A) → y가 우선하여 앞에 옵니다. 결과: [a·1A, y·3B, x·3A, b·2A] = "ayxb". 이것이 Yorkie의 TimeTicket 방식 — 타임스탬프 내림차순, 동점이면 액터 ID 내림차순.' },
      { title: 'B → A 동기화 — A도 동일한 순서 적용',
        note:  'B가 y·(3,B)를 A에 전송합니다. A도 동일한 ticket 비교를 수행하여 y를 x 앞에 배치합니다. A의 문서가 "ayxb"가 됩니다 — B와 완전히 동일합니다. 동기화 순서는 중요하지 않습니다: A→B나 B→A나 결과는 같습니다. CRDT 수렴 보장입니다.' },
      { title: '수렴 완료 — 양쪽 모두 "ayxb"',
        note:  '두 레플리카가 동일한 시퀀스를 보유합니다. A의 의도("axb")도 B의 의도("ayb")도 정확히 반영되지 않았습니다 — 병합은 결정적이지만 의도를 완전히 보존하지는 않습니다. Yorkie와 Yjs는 상위 레이어에서 undo/redo를 제공하여 사용자가 예상치 못한 병합을 수정할 수 있도록 합니다. CRDT는 수렴을 담당하고, 애플리케이션이 UX를 담당합니다.' },
    ],
  },
}

// ── OT vs CRDT section ─────────────────────────────────────────────────────────

function OtVsCrdt({ t }: { t: typeof T['en'] }) {
  return (
    <div>
      <div className="crdt-compare-grid">
        <div className="crdt-compare-card">
          <div className="crdt-compare-head">
            <span className="crdt-compare-title">{t.otTitle}</span>
            <span className="crdt-compare-tag crdt-tag-ot">{t.otTag}</span>
          </div>
          <ul className="crdt-compare-list">
            {t.otPoints.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
        <div className="crdt-compare-card">
          <div className="crdt-compare-head">
            <span className="crdt-compare-title">{t.crdtTitle}</span>
            <span className="crdt-compare-tag crdt-tag-crdt">{t.crdtTag}</span>
          </div>
          <ul className="crdt-compare-list">
            {t.crdtPoints.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      </div>
      <div className="crdt-scenario">
        <div className="crdt-scenario-title">{t.scenarioTitle}</div>
        <div className="crdt-scenario-rows">
          <div className="crdt-scenario-row">
            <span className="crdt-scenario-tag">OT</span>
            <span>{t.otScenario}</span>
          </div>
          <div className="crdt-scenario-row">
            <span className="crdt-scenario-tag">CRDT</span>
            <span>{t.crdtScenario}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── LWW graph ──────────────────────────────────────────────────────────────────

function LwwGraph({ frame, t }: { frame: LwwFrame; t: typeof T['en'] }) {
  const isActive = frame.link === 'active'
  const pathId   = frame.dir === 'rev' ? 'lwwp-rev' : 'lwwp-fwd'
  return (
    <div className="crdt-graph-canvas" style={{ height: LWWH }}>
      <svg viewBox={`0 0 ${LWWW} ${LWWH}`} className="crdt-graph-svg" preserveAspectRatio="none">
        <defs>
          <path id="lwwp-fwd" d={`M ${LWW_AX} ${LWW_AY} L ${LWW_BX} ${LWW_BY}`} fill="none" />
          <path id="lwwp-rev" d={`M ${LWW_BX} ${LWW_BY} L ${LWW_AX} ${LWW_AY}`} fill="none" />
        </defs>
        <line x1={LWW_AX} y1={LWW_AY} x2={LWW_BX} y2={LWW_BY}
          className={`crdt-sline crdt-sline-${frame.link}`} strokeWidth="2" />
        {isActive && (
          <circle r="5" className="crdt-gdot">
            <animateMotion dur="1.0s" repeatCount="indefinite">
              <mpath href={`#${pathId}`} />
            </animateMotion>
          </circle>
        )}
      </svg>
      <span
        className={`graph-linklabel${isActive ? ' graph-linklabel-on' : ''}`}
        style={{ left: '50%', top: `${((LWW_AY - 16) / LWWH) * 100}%` }}
      >{t.lwwLink}</span>

      {/* Node A */}
      <div className={`crdt-gnode crdt-gnode-${frame.sa}`}
        style={{ left: `${(LWW_AX / LWWW) * 100}%`, top: `${(LWW_AY / LWWH) * 100}%` }}>
        <span className="crdt-gnode-label">{t.lwwNodeA}</span>
        <span className="crdt-gnode-val">{frame.ra.val}</span>
        <span className="crdt-gnode-ts">ts = {frame.ra.ts}</span>
      </div>

      {/* Node B */}
      <div className={`crdt-gnode crdt-gnode-${frame.sb}`}
        style={{ left: `${(LWW_BX / LWWW) * 100}%`, top: `${(LWW_BY / LWWH) * 100}%` }}>
        <span className="crdt-gnode-label">{t.lwwNodeB}</span>
        <span className="crdt-gnode-val">{frame.rb.val}</span>
        <span className="crdt-gnode-ts">ts = {frame.rb.ts}</span>
      </div>
    </div>
  )
}

// ── LWW explorer ───────────────────────────────────────────────────────────────

function LwwExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const total = LWW_FRAMES.length
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

  const frame = LWW_FRAMES[step]
  const ft    = t.lwwFrames[step]
  const lbl   = controlLabels(lang)

  return (
    <div className="inet-root">
      <LwwGraph frame={frame} t={t} />
      <Controls onReset={reset} onPlay={handlePlay} onStep={stepFwd}
        playing={playing} isLast={isLast} step={step} lbl={lbl} />
      <Progress step={step} total={total} />
      <FrameDetail title={ft.title} note={ft.note} step={step} total={total} />
    </div>
  )
}

// ── RGA graph ──────────────────────────────────────────────────────────────────

function RgaGraph({ frame, t }: { frame: RgaFrame; t: typeof T['en'] }) {
  const isActive = frame.link === 'active'
  const pathId   = frame.dir === 'rev' ? 'rgap-rev' : 'rgap-fwd'
  return (
    <div className="crdt-graph-canvas" style={{ height: RGAH }}>
      <svg viewBox={`0 0 ${RGAW} ${RGAH}`} className="crdt-graph-svg" preserveAspectRatio="none">
        <defs>
          <path id="rgap-fwd" d={`M ${RGA_AX} ${RGA_AY} L ${RGA_BX} ${RGA_BY}`} fill="none" />
          <path id="rgap-rev" d={`M ${RGA_BX} ${RGA_BY} L ${RGA_AX} ${RGA_AY}`} fill="none" />
        </defs>
        <line x1={RGA_AX} y1={RGA_AY} x2={RGA_BX} y2={RGA_BY}
          className={`crdt-sline crdt-sline-${frame.link}`} strokeWidth="2" />
        {isActive && (
          <circle r="5" className="crdt-gdot">
            <animateMotion dur="1.0s" repeatCount="indefinite">
              <mpath href={`#${pathId}`} />
            </animateMotion>
          </circle>
        )}
      </svg>
      <span
        className={`graph-linklabel${isActive ? ' graph-linklabel-on' : ''}`}
        style={{ left: '50%', top: `${((RGA_AY - 16) / RGAH) * 100}%` }}
      >{t.rgaLink}</span>

      <div className={`crdt-gnode crdt-gnode-${frame.sa}`}
        style={{ left: `${(RGA_AX / RGAW) * 100}%`, top: `${(RGA_AY / RGAH) * 100}%` }}>
        <span className="crdt-gnode-label">{t.rgaNodeA}</span>
      </div>
      <div className={`crdt-gnode crdt-gnode-${frame.sb}`}
        style={{ left: `${(RGA_BX / RGAW) * 100}%`, top: `${(RGA_BY / RGAH) * 100}%` }}>
        <span className="crdt-gnode-label">{t.rgaNodeB}</span>
      </div>
    </div>
  )
}

// ── Document panel (RGA) ───────────────────────────────────────────────────────

function DocPanel({ docA, docB, labelA, labelB }: {
  docA: RgaChar[]; docB: RgaChar[]; labelA: string; labelB: string
}) {
  function renderRow(doc: RgaChar[], label: string) {
    return (
      <div className="crdt-doc-row">
        <span className="crdt-doc-row-label">{label}</span>
        <div className="crdt-doc-chars">
          {doc.map((c, i) => (
            <div key={i} className={`crdt-doc-char${c.isNew ? ' crdt-doc-char-new' : ''}`}>
              <span className="crdt-char-glyph">{c.ch}</span>
              <span className="crdt-char-id">{c.id}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="crdt-doc-panel">
      {renderRow(docA, labelA)}
      {renderRow(docB, labelB)}
    </div>
  )
}

// ── RGA explorer ───────────────────────────────────────────────────────────────

function RgaExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const total = RGA_FRAMES.length
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

  const frame = RGA_FRAMES[step]
  const ft    = t.rgaFrames[step]
  const lbl   = controlLabels(lang)

  return (
    <div className="inet-root">
      <RgaGraph frame={frame} t={t} />
      <DocPanel docA={frame.docA} docB={frame.docB} labelA={t.rgaDocA} labelB={t.rgaDocB} />
      <Controls onReset={reset} onPlay={handlePlay} onStep={stepFwd}
        playing={playing} isLast={isLast} step={step} lbl={lbl} />
      <Progress step={step} total={total} />
      <FrameDetail title={ft.title} note={ft.note} step={step} total={total} />
    </div>
  )
}

// ── Shared UI helpers ──────────────────────────────────────────────────────────

function controlLabels(lang: string) {
  return {
    reset:  lang === 'ko' ? '초기화'    : 'Reset',
    play:   lang === 'ko' ? '재생'      : 'Play',
    pause:  lang === 'ko' ? '일시정지'  : 'Pause',
    resume: lang === 'ko' ? '계속'      : 'Resume',
    replay: lang === 'ko' ? '다시 보기' : 'Replay',
    step:   lang === 'ko' ? '다음 →'   : 'Step →',
  }
}

function Controls({ onReset, onPlay, onStep, playing, isLast, step, lbl }: {
  onReset: () => void; onPlay: () => void; onStep: () => void
  playing: boolean; isLast: boolean; step: number
  lbl: ReturnType<typeof controlLabels>
}) {
  return (
    <div className="tcp-controls">
      <button className="btn-secondary" onClick={onReset}>{lbl.reset}</button>
      <button className="btn-primary" onClick={onPlay}>
        {playing ? lbl.pause : isLast ? lbl.replay : step === 0 ? lbl.play : lbl.resume}
      </button>
      <button className="btn-secondary" onClick={onStep} disabled={playing || isLast}>{lbl.step}</button>
    </div>
  )
}

function Progress({ step, total }: { step: number; total: number }) {
  return (
    <div className="tcp-progress">
      <div className="tcp-progress-fill" style={{ width: `${(step / (total - 1)) * 100}%` }} />
    </div>
  )
}

function FrameDetail({ title, note, step, total }: { title: string; note: string; step: number; total: number }) {
  return (
    <div className="bgp2-detail">
      <div className="bgp2-detail-title">{title}</div>
      <p className="bgp2-detail-body">{note}</p>
      <span className="tcp-step-counter">{step + 1} / {total}</span>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function CrdtPage() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-06-22"
      readTime={t.readTime}
      tags={['distributed-systems', 'crdt', 'collaboration', 'yorkie']}
      intro={t.intro}
    >
      <div className="bgp2-section-title">{t.sectionOt}</div>
      <OtVsCrdt t={t} />

      <div className="bgp2-section-title" style={{ marginTop: 28 }}>{t.sectionLww}</div>
      <LwwExplorer />

      <div className="bgp2-section-title" style={{ marginTop: 28 }}>{t.sectionRga}</div>
      <RgaExplorer />
    </NoteLayout>
  )
}
