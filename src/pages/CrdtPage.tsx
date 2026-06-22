import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type RepStatus = 'idle' | 'active' | 'synced' | 'done'
type LinkSt    = 'idle' | 'active' | 'done'
type SyncDir   = 'fwd' | 'rev' | null

// OT vs CRDT comparison
interface OtState {
  ca: RepStatus; srv: RepStatus; cb: RepStatus
  docA: string; docSrv: string; docB: string
  as: LinkSt; asDir: 'fwd'|'rev'|null
  sb: LinkSt; sbDir: 'fwd'|'rev'|null
}
interface CrdtCompState {
  ra: RepStatus; rb: RepStatus
  docA: string; docB: string
  link: LinkSt; dir: SyncDir
}
interface OtVsCrdtFrame { ot: OtState; crdt: CrdtCompState }

// LWW-Register
interface LwwReg   { val: string; ts: number }
interface LwwFrame { sa: RepStatus; sb: RepStatus; link: LinkSt; dir: SyncDir; ra: LwwReg; rb: LwwReg }

// RGA — word-level tokens
interface RgaToken { word: string; id: string; isNew?: boolean }
interface RgaFrame { sa: RepStatus; sb: RepStatus; link: LinkSt; dir: SyncDir; docA: RgaToken[]; docB: RgaToken[] }

// ── Graph geometry ─────────────────────────────────────────────────────────────

// OT vs CRDT comparison canvases
const COMW = 360; const COMH = 130
const OT_CAX = 50;  const OT_CAY = 65
const OT_SRX = 180; const OT_SRY = 65
const OT_CBX = 310; const OT_CBY = 65
const CC_RAX = 56;  const CC_RAY = 65
const CC_RBX = 304; const CC_RBY = 65

// LWW graph
const LWWW = 480; const LWWH = 140
const LWW_AX = 90;  const LWW_AY = 70
const LWW_BX = 390; const LWW_BY = 70

// RGA graph
const RGAW = 520; const RGAH = 130
const RGA_AX = 100; const RGA_AY = 65
const RGA_BX = 420; const RGA_BY = 65

// ── OT vs CRDT frame data ──────────────────────────────────────────────────────

const OT_CRDT_FRAMES: OtVsCrdtFrame[] = [
  // 0: Init
  { ot:   { ca:'idle', srv:'idle', cb:'idle', docA:'"abc"', docSrv:'"abc"', docB:'"abc"', as:'idle', asDir:null, sb:'idle', sbDir:null },
    crdt: { ra:'idle', rb:'idle', docA:'"abc"', docB:'"abc"', link:'idle', dir:null } },
  // 1: Concurrent edits
  { ot:   { ca:'active', srv:'idle', cb:'active', docA:'"ac"', docSrv:'"abc"', docB:'"aXbc"', as:'idle', asDir:null, sb:'idle', sbDir:null },
    crdt: { ra:'active', rb:'active', docA:'"ac"', docB:'"aXbc"', link:'idle', dir:null } },
  // 2: Ops in transit / CRDT A→B
  { ot:   { ca:'done', srv:'active', cb:'done', docA:'"ac"', docSrv:'"abc"', docB:'"aXbc"', as:'active', asDir:'fwd', sb:'active', sbDir:'rev' },
    crdt: { ra:'done', rb:'synced', docA:'"ac"', docB:'"aXc"', link:'active', dir:'fwd' } },
  // 3: Server dispatches / CRDT B→A
  { ot:   { ca:'synced', srv:'done', cb:'synced', docA:'"aXc"', docSrv:'"aXc"', docB:'"aXc"', as:'active', asDir:'rev', sb:'active', sbDir:'fwd' },
    crdt: { ra:'synced', rb:'done', docA:'"aXc"', docB:'"aXc"', link:'active', dir:'rev' } },
  // 4: All converged
  { ot:   { ca:'done', srv:'done', cb:'done', docA:'"aXc"', docSrv:'"aXc"', docB:'"aXc"', as:'done', asDir:null, sb:'done', sbDir:null },
    crdt: { ra:'done', rb:'done', docA:'"aXc"', docB:'"aXc"', link:'done', dir:null } },
]

// ── LWW frame data ─────────────────────────────────────────────────────────────

const LWW_FRAMES: LwwFrame[] = [
  { sa:'idle',   sb:'idle',   link:'idle',   dir:null,  ra:{val:'—',              ts:0}, rb:{val:'—',             ts:0} },
  { sa:'active', sb:'active', link:'idle',   dir:null,  ra:{val:'"I am online"',  ts:5}, rb:{val:'"I am away"',   ts:3} },
  { sa:'done',   sb:'synced', link:'active', dir:'fwd', ra:{val:'"I am online"',  ts:5}, rb:{val:'"I am online"', ts:5} },
  { sa:'done',   sb:'done',   link:'active', dir:'rev', ra:{val:'"I am online"',  ts:5}, rb:{val:'"I am online"', ts:5} },
  { sa:'done',   sb:'done',   link:'done',   dir:null,  ra:{val:'"I am online"',  ts:5}, rb:{val:'"I am online"', ts:5} },
]

// ── RGA frame data ─────────────────────────────────────────────────────────────

const RGA_FRAMES: RgaFrame[] = [
  // 0: Init "The cat sat"
  { sa:'idle',   sb:'idle',   link:'idle',   dir:null,
    docA:[{word:'The',id:'1·A'},{word:'cat',id:'2·A'},{word:'sat',id:'3·A'}],
    docB:[{word:'The',id:'1·A'},{word:'cat',id:'2·A'},{word:'sat',id:'3·A'}] },
  // 1: A inserts "big" → "The big cat sat"
  { sa:'active', sb:'idle',   link:'idle',   dir:null,
    docA:[{word:'The',id:'1·A'},{word:'big',id:'4·A',isNew:true},{word:'cat',id:'2·A'},{word:'sat',id:'3·A'}],
    docB:[{word:'The',id:'1·A'},{word:'cat',id:'2·A'},{word:'sat',id:'3·A'}] },
  // 2: B inserts "fat" concurrently → "The fat cat sat"
  { sa:'done',   sb:'active', link:'idle',   dir:null,
    docA:[{word:'The',id:'1·A'},{word:'big',id:'4·A'},{word:'cat',id:'2·A'},{word:'sat',id:'3·A'}],
    docB:[{word:'The',id:'1·A'},{word:'fat',id:'4·B',isNew:true},{word:'cat',id:'2·A'},{word:'sat',id:'3·A'}] },
  // 3: A→B sync: ticket(4,B)>(4,A) → fat before big
  { sa:'done',   sb:'synced', link:'active', dir:'fwd',
    docA:[{word:'The',id:'1·A'},{word:'big',id:'4·A'},{word:'cat',id:'2·A'},{word:'sat',id:'3·A'}],
    docB:[{word:'The',id:'1·A'},{word:'fat',id:'4·B'},{word:'big',id:'4·A',isNew:true},{word:'cat',id:'2·A'},{word:'sat',id:'3·A'}] },
  // 4: B→A sync
  { sa:'synced', sb:'done',   link:'active', dir:'rev',
    docA:[{word:'The',id:'1·A'},{word:'fat',id:'4·B',isNew:true},{word:'big',id:'4·A'},{word:'cat',id:'2·A'},{word:'sat',id:'3·A'}],
    docB:[{word:'The',id:'1·A'},{word:'fat',id:'4·B'},{word:'big',id:'4·A'},{word:'cat',id:'2·A'},{word:'sat',id:'3·A'}] },
  // 5: Converged "The fat big cat sat"
  { sa:'done',   sb:'done',   link:'done',   dir:null,
    docA:[{word:'The',id:'1·A'},{word:'fat',id:'4·B'},{word:'big',id:'4·A'},{word:'cat',id:'2·A'},{word:'sat',id:'3·A'}],
    docB:[{word:'The',id:'1·A'},{word:'fat',id:'4·B'},{word:'big',id:'4·A'},{word:'cat',id:'2·A'},{word:'sat',id:'3·A'}] },
]

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title:    'CRDT — conflict-free collaborative editing',
    readTime: '6 min',
    intro:    `When two users edit the same document simultaneously, changes must be merged without loss. Operational Transformation (OT) routes every change through a central server that sequences and adjusts concurrent operations. CRDTs (Conflict-free Replicated Data Types) take a different approach: every operation is designed so that any merge order produces the same result — no server, no coordination required. Yorkie, Yjs, and Automerge build on this foundation.`,

    // OT vs CRDT comparison
    sectionOtCrdt:  'OT vs CRDT — same problem, different paths',
    otPanelLabel:   'OT (server-coordinated)',
    crdtPanelLabel: 'CRDT (peer-to-peer)',
    otNodeA:   'Client A',
    otNodeSrv: 'Server',
    otNodeB:   'Client B',
    ccNodeA:   'Replica A',
    ccNodeB:   'Replica B',
    otLink:    'op',
    ccLink:    'sync',
    otCrdtFrames: [
      { title: `Init — both start with "abc"`,
        note:  `Both approaches start with the same document. In OT, a central server holds the source of truth and all clients connect to it. In CRDT, replicas are peers — no single authority.` },
      { title: `Concurrent edits — A deletes 'b', B inserts 'X' after 'a'`,
        note:  `A's local document becomes "ac", B's becomes "aXbc". Neither knows about the other. In OT, both clients must route their ops through the server before any merge can happen. In CRDT, replicas work offline freely — stable character IDs mean positions never shift.` },
      { title: `Ops travel to the coordinator`,
        note:  `OT: both ops arrive at the server simultaneously. The server must sequence them, decide which came first, and transform the other accordingly. CRDT: Replica A sends its tombstone (b's ID marked deleted) directly to B. B merges immediately — no intermediary.` },
      { title: `OT: server transforms and dispatches; CRDT: B syncs back to A`,
        note:  `OT server applied A's delete first, adjusted B's insert position (still pos 1 after delete), and broadcast "aXc" to all clients. CRDT: B already has "aXc" and now sends fat·(4,B) back to A. Same merge rule applied — same result.` },
      { title: `Both converge to "aXc" — the difference is the path`,
        note:  `The end state is identical, but OT required a central server to transform and serialize every op, while CRDT achieved it by embedding ordering directly in each character's unique ID. CRDT wins for offline-first and P2P; OT remains in use where a server is already required (e.g. Google Docs internal protocol).` },
    ],

    // LWW
    sectionLww:  'LWW-Register — logical timestamp',
    lwwNodeA:    'Replica A',
    lwwNodeB:    'Replica B',
    lwwLink:     'sync',
    lwwFrames: [
      { title: `Init — register empty on both replicas`,
        note:  `A LWW-Register stores one value paired with a Lamport timestamp. The clock increments on every local write and jumps to max(local, received)+1 on sync — guaranteeing causal ordering without a wall clock. Both replicas start at ts=0.` },
      { title: `Concurrent writes — each replica sets a user status`,
        note:  `Replica A writes "I am online" with ts=5. Concurrently, Replica B writes "I am away" with ts=3. Neither knows about the other's write. Two different status strings exist simultaneously across the system — the LWW rule will resolve it.` },
      { title: `A → B sync — higher timestamp wins`,
        note:  `A sends {"I am online", ts:5} to B. B compares: incoming ts=5 > local ts=3. B discards "I am away" and adopts "I am online" at ts=5. Merge rule: keep the value with the higher Lamport timestamp. No server, no negotiation.` },
      { title: `B → A sync — idempotent, A unchanged`,
        note:  `B sends {"I am online", ts:5} back to A. A compares: incoming ts=5 = local ts=5. Tie — A keeps its value (or applies a consistent actor-ID tiebreak). A is unchanged. Syncing already-seen data never corrupts state.` },
      { title: `Converged — both replicas show "I am online"`,
        note:  `Both replicas hold {"I am online", ts:5}. Further syncs are no-ops. Tradeoff: "I am away" was permanently discarded — LWW is not safe when all writes must survive. For that, use a multi-value register (which returns the conflict set) or an OR-Set.` },
    ],

    // RGA
    sectionRga:  'RGA — collaborative text (Yorkie)',
    rgaNodeA:    'Replica A',
    rgaNodeB:    'Replica B',
    rgaDocA:     'Doc A',
    rgaDocB:     'Doc B',
    rgaLink:     'sync',
    rgaFrames: [
      { title: `Init — document "The cat sat" with unique word IDs`,
        note:  `RGA (Replicated Growable Array) gives every element a unique ID: (Lamport timestamp, actor ID). Here each word is one element — real RGA operates per-character, but the merge logic is identical. Replica A created the document, so all IDs carry actor A. Insertions reference a left-neighbor's ID, not an index.` },
      { title: `A inserts "big" between "The" and "cat"`,
        note:  `Replica A inserts "big" with ID (4,A) after the element with ID (1,A) — referencing the neighbor, not a position number. A's document: "The big cat sat". Replica B is still on "The cat sat" and unaware of this change.` },
      { title: `B inserts "fat" concurrently — same left neighbor`,
        note:  `Replica B also inserts after ID (1,A) — the same left neighbor. B's word gets ID (4,B). B has "The fat cat sat", A has "The big cat sat". Both valid locally, but diverged. RGA must place both words after (1,A) in a deterministic order.` },
      { title: `A → B sync — ticket (4,B) > (4,A), "fat" goes first`,
        note:  `A sends big·(4,A) to B. B must place both "big" and "fat" after (1,A). Tie-break by descending ticket: (4,B) > (4,A) → "fat" wins and goes first. Result: "The fat big cat sat". This is exactly how Yorkie's TimeTicket works — descending Lamport timestamp, then descending actor ID.` },
      { title: `B → A sync — A applies the same ordering`,
        note:  `B sends fat·(4,B) to A. A applies the same ticket comparison and places "fat" before "big". A's document: "The fat big cat sat" — matching B exactly. Sync order did not matter. That is the CRDT convergence guarantee.` },
      { title: `Converged — "The fat big cat sat" on both replicas`,
        note:  `Both replicas hold the same sequence. Neither A's intent ("The big cat sat") nor B's ("The fat cat sat") fully won — the merge is deterministic but not intent-preserving. Yorkie and Yjs layer undo/redo on top so users can correct surprising merges. The CRDT handles convergence; the application handles UX.` },
    ],
  },

  ko: {
    title:    'CRDT — 충돌 없는 분산 협업 편집',
    readTime: '6분',
    intro:    `두 사용자가 같은 문서를 동시에 편집하면 데이터 손실 없이 변경 사항을 병합해야 합니다. OT(Operational Transformation)는 중앙 서버를 통해 동시 연산의 순서를 조정합니다. CRDT(Conflict-free Replicated Data Type)는 다르게 접근합니다 — 어떤 순서로 병합해도 동일한 결과가 나오도록 연산 자체를 설계합니다. 서버도 조정도 필요 없습니다. Yorkie, Yjs, Automerge 모두 이 원리 위에 구축됩니다.`,

    sectionOtCrdt:  'OT vs CRDT — 같은 문제, 다른 경로',
    otPanelLabel:   'OT (서버 조정)',
    crdtPanelLabel: 'CRDT (피어-투-피어)',
    otNodeA:   '클라이언트 A',
    otNodeSrv: '서버',
    otNodeB:   '클라이언트 B',
    ccNodeA:   '레플리카 A',
    ccNodeB:   '레플리카 B',
    otLink:    'op',
    ccLink:    '동기화',
    otCrdtFrames: [
      { title: `Init — 양쪽 모두 "abc"로 시작`,
        note:  `두 방식 모두 같은 문서로 시작합니다. OT에서는 중앙 서버가 소스 오브 트루스를 보유하고 모든 클라이언트가 서버에 연결됩니다. CRDT에서는 레플리카가 피어(peer) 관계 — 단일 권위자 없이 동등합니다.` },
      { title: `동시 편집 — A가 'b' 삭제, B가 'a' 다음에 'X' 삽입`,
        note:  `A의 로컬 문서는 "ac", B의 로컬 문서는 "aXbc"가 됩니다. 서로를 모릅니다. OT에서는 병합을 위해 두 클라이언트 모두 서버에 연산을 전달해야 합니다. CRDT에서는 안정적인 문자 ID 덕분에 레플리카가 오프라인 상태로 자유롭게 작업합니다.` },
      { title: `연산이 조정자에게 전달됨`,
        note:  `OT: 두 연산이 서버에 도착합니다. 서버는 어느 연산이 먼저인지 결정하고 다른 연산을 변환해야 합니다. CRDT: 레플리카 A가 tombstone(b의 ID를 삭제 표시)을 B에 직접 전송합니다. B는 중개자 없이 즉시 병합합니다.` },
      { title: `OT: 서버가 변환 후 배포. CRDT: B→A 동기화.`,
        note:  `OT 서버가 A의 삭제를 먼저 적용한 후 B의 삽입 위치를 조정(여전히 pos 1) → "aXc"를 모든 클라이언트에 배포합니다. CRDT: B는 이미 "aXc" 상태. 이제 fat·(4,B)를 A에 전송합니다. 동일한 병합 규칙, 동일한 결과.` },
      { title: `양쪽 모두 "aXc"로 수렴 — 경로의 차이`,
        note:  `최종 상태는 동일하지만, OT는 모든 연산을 변환하고 직렬화하기 위해 중앙 서버가 필요했고, CRDT는 각 문자의 고유 ID에 순서를 직접 내장함으로써 같은 결과를 달성했습니다. CRDT는 오프라인 우선과 P2P에 유리하며, OT는 서버가 이미 필요한 환경(예: Google Docs 내부 프로토콜)에서 사용됩니다.` },
    ],

    sectionLww:  'LWW-Register — 논리적 타임스탬프',
    lwwNodeA:    '레플리카 A',
    lwwNodeB:    '레플리카 B',
    lwwLink:     '동기화',
    lwwFrames: [
      { title: `Init — 양쪽 레지스터 비어 있음`,
        note:  `LWW-Register는 하나의 값과 Lamport 타임스탬프를 함께 저장합니다. 클록은 쓰기마다 증가하고 동기화 시 max(로컬, 수신)+1로 점프합니다 — 벽시계 없이 인과적 순서를 보장합니다. 양쪽 모두 ts=0에서 시작합니다.` },
      { title: `동시 쓰기 — 각 레플리카가 사용자 상태를 설정`,
        note:  `레플리카 A가 ts=5로 "I am online"을 씁니다. 동시에 레플리카 B가 ts=3으로 "I am away"를 씁니다. 아직 서로를 모릅니다. 두 개의 다른 상태 문자열이 시스템 전체에 동시에 존재합니다 — LWW 규칙이 해결합니다.` },
      { title: `A → B 동기화 — 높은 타임스탬프 승리`,
        note:  `A가 {"I am online", ts:5}를 B에 전송합니다. B 비교: 수신 ts=5 > 로컬 ts=3. B는 "I am away"를 버리고 ts=5로 "I am online"을 채택합니다. 병합 규칙: 높은 Lamport 타임스탬프를 유지. 서버도 협상도 없습니다.` },
      { title: `B → A 동기화 — 멱등성, A 변경 없음`,
        note:  `B가 {"I am online", ts:5}를 A에 다시 보냅니다. A 비교: ts=5 = ts=5. 동점 → 현재 값 유지(또는 액터 ID 기반 일관된 tiebreak). A는 변경되지 않습니다. 이미 본 데이터를 동기화해도 상태가 손상되지 않습니다.` },
      { title: `수렴 완료 — 두 레플리카 모두 "I am online"`,
        note:  `두 레플리카 모두 {"I am online", ts:5}를 보유합니다. 이후 동기화는 no-op이 됩니다. 단점: "I am away"가 영구적으로 손실되었습니다. 모든 쓰기를 보존해야 한다면 multi-value register나 OR-Set을 사용해야 합니다.` },
    ],

    sectionRga:  'RGA — 협업 텍스트 (Yorkie)',
    rgaNodeA:    '레플리카 A',
    rgaNodeB:    '레플리카 B',
    rgaDocA:     '문서 A',
    rgaDocB:     '문서 B',
    rgaLink:     '동기화',
    rgaFrames: [
      { title: `Init — 문서 "The cat sat", 고유 ID를 가진 세 단어`,
        note:  `RGA(Replicated Growable Array)는 모든 요소에 고유 ID를 부여합니다: (Lamport 타임스탬프, 액터 ID). 여기서는 각 단어를 요소로 처리합니다 — 실제 RGA는 문자 단위로 동작하지만 병합 로직은 동일합니다. 레플리카 A가 문서를 생성했으므로 모든 ID가 액터 A를 가집니다. 삽입은 왼쪽 이웃의 ID를 참조합니다.` },
      { title: `A가 "The"와 "cat" 사이에 "big" 삽입`,
        note:  `레플리카 A가 ID (4,A)로 "big"을 ID (1,A) 다음에 삽입합니다. A의 문서: "The big cat sat". 레플리카 B는 아직 "The cat sat" 상태이며 이 변경을 모릅니다.` },
      { title: `B가 동일한 왼쪽 이웃에 "fat" 동시 삽입`,
        note:  `레플리카 B도 ID (1,A) 다음에 삽입합니다 — A와 동일한 이웃. B의 단어는 ID (4,B)를 받습니다. B는 "The fat cat sat", A는 "The big cat sat". 두 레플리카가 분기되었습니다. RGA가 두 단어를 (1,A) 다음에 결정적 순서로 배치해야 합니다.` },
      { title: `A → B 동기화 — ticket (4,B) > (4,A), "fat" 먼저`,
        note:  `A가 big·(4,A)를 B에 전송합니다. B는 "big"과 "fat" 모두 (1,A) 다음에 배치해야 합니다. Ticket 내림차순 비교: (4,B) > (4,A) → B의 단어가 우선하여 앞에 옵니다. 결과: "The fat big cat sat". Yorkie의 TimeTicket이 정확히 이 방식 — 타임스탬프 내림차순, 동점이면 액터 ID 내림차순.` },
      { title: `B → A 동기화 — A도 동일한 순서 적용`,
        note:  `B가 fat·(4,B)를 A에 전송합니다. A도 동일한 ticket 비교를 수행하여 "fat"을 "big" 앞에 배치합니다. A의 문서: "The fat big cat sat" — B와 완전히 동일합니다. 동기화 순서는 중요하지 않습니다. CRDT 수렴 보장입니다.` },
      { title: `수렴 완료 — 양쪽 모두 "The fat big cat sat"`,
        note:  `두 레플리카가 동일한 시퀀스를 보유합니다. A의 의도("The big cat sat")도 B의 의도("The fat cat sat")도 정확히 반영되지 않았습니다 — 병합은 결정적이지만 의도를 완전히 보존하지는 않습니다. Yorkie와 Yjs는 상위 레이어에서 undo/redo를 제공하여 사용자가 예상치 못한 병합을 수정할 수 있도록 합니다.` },
    ],
  },
}

// ── OT vs CRDT graphs ──────────────────────────────────────────────────────────

function OtGraph({ frame, t }: { frame: OtVsCrdtFrame; t: typeof T['en'] }) {
  const { ot } = frame
  return (
    <div className="crdt-comp-panel">
      <div className="crdt-comp-label">{t.otPanelLabel}</div>
      <div className="crdt-graph-canvas" style={{ height: COMH }}>
        <svg viewBox={`0 0 ${COMW} ${COMH}`} className="crdt-graph-svg" preserveAspectRatio="none">
          <defs>
            <path id="ot-as-fwd" d={`M ${OT_CAX} ${OT_CAY} L ${OT_SRX} ${OT_SRY}`} fill="none" />
            <path id="ot-as-rev" d={`M ${OT_SRX} ${OT_SRY} L ${OT_CAX} ${OT_CAY}`} fill="none" />
            <path id="ot-sb-fwd" d={`M ${OT_SRX} ${OT_SRY} L ${OT_CBX} ${OT_CBY}`} fill="none" />
            <path id="ot-sb-rev" d={`M ${OT_CBX} ${OT_CBY} L ${OT_SRX} ${OT_SRY}`} fill="none" />
          </defs>
          <line x1={OT_CAX} y1={OT_CAY} x2={OT_SRX} y2={OT_SRY}
            className={`crdt-sline crdt-sline-${ot.as}`} strokeWidth="2" />
          <line x1={OT_SRX} y1={OT_SRY} x2={OT_CBX} y2={OT_CBY}
            className={`crdt-sline crdt-sline-${ot.sb}`} strokeWidth="2" />
          {ot.as === 'active' && ot.asDir && (
            <circle r="4" className="crdt-gdot">
              <animateMotion dur="1.0s" repeatCount="indefinite">
                <mpath href={`#ot-as-${ot.asDir}`} />
              </animateMotion>
            </circle>
          )}
          {ot.sb === 'active' && ot.sbDir && (
            <circle r="4" className="crdt-gdot">
              <animateMotion dur="1.0s" repeatCount="indefinite">
                <mpath href={`#ot-sb-${ot.sbDir}`} />
              </animateMotion>
            </circle>
          )}
        </svg>
        {/* Link labels */}
        {ot.as === 'active' && (
          <span className="graph-linklabel graph-linklabel-on"
            style={{ left:`${((OT_CAX+OT_SRX)/2/COMW)*100}%`, top:`${((OT_CAY-14)/COMH)*100}%` }}>
            {t.otLink}
          </span>
        )}
        {ot.sb === 'active' && (
          <span className="graph-linklabel graph-linklabel-on"
            style={{ left:`${((OT_SRX+OT_CBX)/2/COMW)*100}%`, top:`${((OT_CBY-14)/COMH)*100}%` }}>
            {t.otLink}
          </span>
        )}
        {/* Node A */}
        <div className={`crdt-gnode crdt-gnode-${ot.ca}`}
          style={{ left:`${(OT_CAX/COMW)*100}%`, top:`${(OT_CAY/COMH)*100}%` }}>
          <span className="crdt-gnode-label">{t.otNodeA}</span>
          <span className="crdt-gnode-doc">{ot.docA}</span>
        </div>
        {/* Server */}
        <div className={`crdt-gnode crdt-gnode-${ot.srv} crdt-gnode-server`}
          style={{ left:`${(OT_SRX/COMW)*100}%`, top:`${(OT_SRY/COMH)*100}%` }}>
          <span className="crdt-gnode-label">{t.otNodeSrv}</span>
          <span className="crdt-gnode-doc">{ot.docSrv}</span>
        </div>
        {/* Node B */}
        <div className={`crdt-gnode crdt-gnode-${ot.cb}`}
          style={{ left:`${(OT_CBX/COMW)*100}%`, top:`${(OT_CBY/COMH)*100}%` }}>
          <span className="crdt-gnode-label">{t.otNodeB}</span>
          <span className="crdt-gnode-doc">{ot.docB}</span>
        </div>
      </div>
    </div>
  )
}

function CrdtCompGraph({ frame, t }: { frame: OtVsCrdtFrame; t: typeof T['en'] }) {
  const { crdt } = frame
  const isActive = crdt.link === 'active'
  const pathId   = crdt.dir === 'rev' ? 'cc-rev' : 'cc-fwd'
  return (
    <div className="crdt-comp-panel">
      <div className="crdt-comp-label">{t.crdtPanelLabel}</div>
      <div className="crdt-graph-canvas" style={{ height: COMH }}>
        <svg viewBox={`0 0 ${COMW} ${COMH}`} className="crdt-graph-svg" preserveAspectRatio="none">
          <defs>
            <path id="cc-fwd" d={`M ${CC_RAX} ${CC_RAY} L ${CC_RBX} ${CC_RBY}`} fill="none" />
            <path id="cc-rev" d={`M ${CC_RBX} ${CC_RBY} L ${CC_RAX} ${CC_RAY}`} fill="none" />
          </defs>
          <line x1={CC_RAX} y1={CC_RAY} x2={CC_RBX} y2={CC_RBY}
            className={`crdt-sline crdt-sline-${crdt.link}`} strokeWidth="2" />
          {isActive && (
            <circle r="4" className="crdt-gdot">
              <animateMotion dur="1.0s" repeatCount="indefinite">
                <mpath href={`#${pathId}`} />
              </animateMotion>
            </circle>
          )}
        </svg>
        {isActive && (
          <span className="graph-linklabel graph-linklabel-on"
            style={{ left:'50%', top:`${((CC_RAY-14)/COMH)*100}%` }}>
            {t.ccLink}
          </span>
        )}
        <div className={`crdt-gnode crdt-gnode-${crdt.ra}`}
          style={{ left:`${(CC_RAX/COMW)*100}%`, top:`${(CC_RAY/COMH)*100}%` }}>
          <span className="crdt-gnode-label">{t.ccNodeA}</span>
          <span className="crdt-gnode-doc">{crdt.docA}</span>
        </div>
        <div className={`crdt-gnode crdt-gnode-${crdt.rb}`}
          style={{ left:`${(CC_RBX/COMW)*100}%`, top:`${(CC_RBY/COMH)*100}%` }}>
          <span className="crdt-gnode-label">{t.ccNodeB}</span>
          <span className="crdt-gnode-doc">{crdt.docB}</span>
        </div>
      </div>
    </div>
  )
}

function OtVsCrdtExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const total = OT_CRDT_FRAMES.length
  const [step, setStep]       = useState(0)
  const [playing, setPlaying] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLast = step >= total - 1

  useEffect(() => {
    if (!playing) return
    if (isLast) { setPlaying(false); return }
    timerRef.current = setTimeout(() => setStep(s => s + 1), 1500)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [playing, step, isLast])

  function reset() { setPlaying(false); setStep(0) }
  function stepFwd() { if (!isLast) setStep(s => s + 1) }
  function handlePlay() {
    if (isLast) { reset(); setTimeout(() => setPlaying(true), 50); return }
    setPlaying(p => !p)
  }

  const frame = OT_CRDT_FRAMES[step]
  const ft    = t.otCrdtFrames[step]
  const lbl   = controlLabels(lang)

  return (
    <div className="inet-root">
      <div className="crdt-comp-grid">
        <OtGraph frame={frame} t={t} />
        <CrdtCompGraph frame={frame} t={t} />
      </div>
      <Controls onReset={reset} onPlay={handlePlay} onStep={stepFwd}
        playing={playing} isLast={isLast} step={step} lbl={lbl} />
      <Progress step={step} total={total} />
      <FrameDetail title={ft.title} note={ft.note} step={step} total={total} />
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
      <span className={`graph-linklabel${isActive ? ' graph-linklabel-on' : ''}`}
        style={{ left:'50%', top:`${((LWW_AY-16)/LWWH)*100}%` }}>
        {t.lwwLink}
      </span>
      <div className={`crdt-gnode crdt-gnode-${frame.sa}`}
        style={{ left:`${(LWW_AX/LWWW)*100}%`, top:`${(LWW_AY/LWWH)*100}%` }}>
        <span className="crdt-gnode-label">{t.lwwNodeA}</span>
        <span className="crdt-gnode-val">{frame.ra.val}</span>
        <span className="crdt-gnode-ts">ts = {frame.ra.ts}</span>
      </div>
      <div className={`crdt-gnode crdt-gnode-${frame.sb}`}
        style={{ left:`${(LWW_BX/LWWW)*100}%`, top:`${(LWW_BY/LWWH)*100}%` }}>
        <span className="crdt-gnode-label">{t.lwwNodeB}</span>
        <span className="crdt-gnode-val">{frame.rb.val}</span>
        <span className="crdt-gnode-ts">ts = {frame.rb.ts}</span>
      </div>
    </div>
  )
}

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
    timerRef.current = setTimeout(() => setStep(s => s + 1), 1400)
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

// ── RGA graph + doc panel ──────────────────────────────────────────────────────

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
      <span className={`graph-linklabel${isActive ? ' graph-linklabel-on' : ''}`}
        style={{ left:'50%', top:`${((RGA_AY-16)/RGAH)*100}%` }}>
        {t.rgaLink}
      </span>
      <div className={`crdt-gnode crdt-gnode-${frame.sa}`}
        style={{ left:`${(RGA_AX/RGAW)*100}%`, top:`${(RGA_AY/RGAH)*100}%` }}>
        <span className="crdt-gnode-label">{t.rgaNodeA}</span>
      </div>
      <div className={`crdt-gnode crdt-gnode-${frame.sb}`}
        style={{ left:`${(RGA_BX/RGAW)*100}%`, top:`${(RGA_BY/RGAH)*100}%` }}>
        <span className="crdt-gnode-label">{t.rgaNodeB}</span>
      </div>
    </div>
  )
}

function DocPanel({ docA, docB, labelA, labelB }: {
  docA: RgaToken[]; docB: RgaToken[]; labelA: string; labelB: string
}) {
  function renderRow(doc: RgaToken[], label: string) {
    return (
      <div className="crdt-doc-row">
        <span className="crdt-doc-row-label">{label}</span>
        <div className="crdt-doc-chars">
          {doc.map((tok, i) => (
            <div key={i} className={`crdt-doc-word${tok.isNew ? ' crdt-doc-word-new' : ''}`}>
              <span className="crdt-word-text">{tok.word}</span>
              <span className="crdt-word-id">{tok.id}</span>
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
    timerRef.current = setTimeout(() => setStep(s => s + 1), 1400)
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
      <div className="bgp2-section-title">{t.sectionOtCrdt}</div>
      <OtVsCrdtExplorer />

      <div className="bgp2-section-title" style={{ marginTop: 28 }}>{t.sectionLww}</div>
      <LwwExplorer />

      <div className="bgp2-section-title" style={{ marginTop: 28 }}>{t.sectionRga}</div>
      <RgaExplorer />
    </NoteLayout>
  )
}
