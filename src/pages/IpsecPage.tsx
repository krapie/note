import { useState, useEffect } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type MsgDir  = 'a2b' | 'b2a' | 'both'
type MsgKind = 'ike' | 'esp'
type Phase   = 'ike' | 'esp'

interface SpdEntry { dir: 'OUT' | 'IN'; sel: string }
interface SadEntry { spi: string; dir: 'OUT' | 'IN'; cipher: string; seq: number }
interface PktSeg   { id: string; label: string; sub?: string; cls: string; grow?: boolean; hi?: boolean }

interface PeerState {
  spdHi?: boolean
  sad:    SadEntry[]
  sadHi?: 'out' | 'in' | 'both'
}

interface IpsecFrame {
  phase:  Phase
  peerA:  PeerState
  peerB:  PeerState
  msg?:   { label: string; dir: MsgDir; kind: MsgKind }
  segs?:  PktSeg[]
}

// ── Static data ────────────────────────────────────────────────────────────────

const SPD_A: SpdEntry[] = [
  { dir: 'OUT', sel: '10.1.0.0/24 → 10.2.0.0/24' },
  { dir: 'IN',  sel: '10.2.0.0/24 → 10.1.0.0/24' },
]
const SPD_B: SpdEntry[] = [
  { dir: 'OUT', sel: '10.2.0.0/24 → 10.1.0.0/24' },
  { dir: 'IN',  sel: '10.1.0.0/24 → 10.2.0.0/24' },
]

const SAD_A: SadEntry[] = [
  { spi: '0xABCD1234', dir: 'OUT', cipher: 'AES-256-GCM', seq: 0 },
  { spi: '0xDEF01234', dir: 'IN',  cipher: 'AES-256-GCM', seq: 0 },
]
const SAD_B: SadEntry[] = [
  { spi: '0xDEF01234', dir: 'OUT', cipher: 'AES-256-GCM', seq: 0 },
  { spi: '0xABCD1234', dir: 'IN',  cipher: 'AES-256-GCM', seq: 0 },
]
const SAD_A_42: SadEntry[] = [
  { spi: '0xABCD1234', dir: 'OUT', cipher: 'AES-256-GCM', seq: 42 },
  { spi: '0xDEF01234', dir: 'IN',  cipher: 'AES-256-GCM', seq: 0  },
]
const SAD_B_42: SadEntry[] = [
  { spi: '0xDEF01234', dir: 'OUT', cipher: 'AES-256-GCM', seq: 0  },
  { spi: '0xABCD1234', dir: 'IN',  cipher: 'AES-256-GCM', seq: 42 },
]

const EMPTY_PEER: PeerState = { sad: [] }

// ── Packet segment definitions ─────────────────────────────────────────────────

const S = {
  outerIp:   { id: 'outer-ip',  label: 'Outer IP',  sub: '20 B · proto=50',    cls: 'ipsec-seg-outer' },
  espHdr:    { id: 'esp-hdr',   label: 'ESP Hdr',   sub: 'SPI + Seq',          cls: 'ipsec-seg-esp' },
  espHdrHi:  { id: 'esp-hdr',   label: 'ESP Hdr',   sub: 'SPI=0xABCD1234',     cls: 'ipsec-seg-esp',  hi: true },
  iv:        { id: 'iv',        label: 'IV',         sub: '12 B nonce',         cls: 'ipsec-seg-iv' },
  innerIp:   { id: 'inner-ip',  label: 'Inner IP',  sub: '20 B',               cls: 'ipsec-seg-inner' },
  payload:   { id: 'payload',   label: 'Payload',                              cls: 'ipsec-seg-payload', grow: true },
  encrypted: { id: 'encrypted', label: 'Encrypted', sub: 'Inner IP+Payload+Pad', cls: 'ipsec-seg-enc', grow: true },
  gcmTag:    { id: 'gcm-tag',   label: 'GCM Tag',   sub: '16 B',               cls: 'ipsec-seg-auth' },
  gcmTagHi:  { id: 'gcm-tag',   label: 'GCM Tag',   sub: '16 B · verify',      cls: 'ipsec-seg-auth', hi: true },
} satisfies Record<string, PktSeg>

// ── Frames ─────────────────────────────────────────────────────────────────────

const FRAMES: IpsecFrame[] = [
  // 0 — initial: SPD exists, SAD empty
  { phase: 'ike',
    peerA: { sad: [] }, peerB: { sad: [] } },
  // 1 — IKE_SA_INIT: DH exchange
  { phase: 'ike',
    msg: { label: 'IKE_SA_INIT', dir: 'both', kind: 'ike' },
    peerA: { sad: [] }, peerB: { sad: [] } },
  // 2 — IKE_AUTH: authentication + Child SA proposal
  { phase: 'ike',
    msg: { label: 'IKE_AUTH', dir: 'both', kind: 'ike' },
    peerA: { sad: [] }, peerB: { sad: [] } },
  // 3 — SA installed on both peers, SPIs highlighted
  { phase: 'ike',
    peerA: { sad: SAD_A, sadHi: 'both' },
    peerB: { sad: SAD_B, sadHi: 'both' } },
  // 4 — Peer A originates packet: SPD lookup → outbound SA highlighted
  { phase: 'esp',
    peerA: { spdHi: true, sad: SAD_A, sadHi: 'out' },
    peerB: { sad: SAD_B },
    segs: [S.innerIp, S.payload] },
  // 5 — ESP packet on wire
  { phase: 'esp',
    msg: { label: 'ESP  SPI=0xABCD1234  seq=42', dir: 'a2b', kind: 'esp' },
    peerA: { sad: SAD_A_42, sadHi: 'out' },
    peerB: { sad: SAD_B },
    segs: [S.outerIp, S.espHdr, S.iv, S.encrypted, S.gcmTag] },
  // 6 — Peer B: SPI lookup + GCM verify
  { phase: 'esp',
    peerA: { sad: SAD_A_42 },
    peerB: { spdHi: true, sad: SAD_B_42, sadHi: 'in' },
    segs: [S.outerIp, S.espHdrHi, S.iv, S.encrypted, S.gcmTagHi] },
  // 7 — decrypted, inner packet delivered
  { phase: 'esp',
    peerA: { sad: SAD_A_42 },
    peerB: { sad: SAD_B_42, sadHi: 'in' },
    segs: [S.innerIp, S.payload] },
]

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title: 'IPSec: IKEv2 + ESP tunnel',
    readTime: '5 min',
    intro: 'A two-phase walkthrough: IKEv2 negotiates a Child SA and installs SPIs into both peers\' SADs, then ESP uses those negotiated keys to encapsulate and deliver a packet through the xfrm subsystem.',
    spdSub:  'Security Policy Database',
    sadSub:  'Security Association Database',
    sadEmpty: 'no SA — negotiating',
    spd: 'SPD', sad: 'SAD',
    peerA: 'Peer A', peerB: 'Peer B',
    pktTitle: 'packet on wire',
    frames: [
      { title: 'Initial state — SA not yet established',
        note: 'Both peers have an SPD policy: traffic between 10.1.0.0/24 and 10.2.0.0/24 must use ESP/AES-256-GCM (action: PROTECT). SAD is empty on both sides — no keys, no SPI. IKEv2 negotiation must happen first.' },
      { title: 'IKE_SA_INIT — DH exchange',
        note: 'Peer A sends IKE_SA_INIT (SA proposal: AES-256, SHA-384, DH group 20). Peer B responds with its DH public value and nonce. A shared IKE SA key is derived via ECDH — this creates a secure channel for the next exchange. No ESP keys yet.' },
      { title: 'IKE_AUTH — authentication + Child SA',
        note: 'Peer A sends IKE_AUTH: identity, auth payload (cert or PSK), and a CREATE_CHILD_SA proposal embedded in the payload. Peer B authenticates and accepts, replying with its own auth and the negotiated Child SA parameters — including the two SPIs (one per direction) derived from fresh DH.' },
      { title: 'Child SA installed — SAD populated',
        note: 'xfrm installs the Child SA on both peers. Peer A: OUT SPI=0xABCD1234 (what Peer B will use to look up this flow), IN SPI=0xDEF01234. Peer B: OUT SPI=0xDEF01234, IN SPI=0xABCD1234. The SPIs are asymmetric and peer-specific — A\'s OUT SPI is B\'s IN SPI. Tunnel is UP.' },
      { title: 'Packet arrives — SPD + SAD lookup',
        note: 'A packet from 10.1.0.100 → 10.2.0.100 hits xfrm on Peer A. SPD lookup: selector matches → action PROTECT. SAD outbound lookup: finds SPI=0xABCD1234, AES-256-GCM, seq=41. Encapsulation begins. seq will be incremented to 42 for this packet.' },
      { title: 'ESP packet transmitted',
        note: 'Peer A encapsulates and sends: Outer IP (10.0.1.1 → 10.0.2.1, proto=50) | ESP Hdr (SPI=0xABCD1234, seq=42) | IV (12 B nonce) | AES-256-GCM encrypted [Inner IP + Payload + Pad] | GCM tag (16 B, covers SPI+seq as AAD). Outbound SA seq counter incremented to 42.' },
      { title: 'Peer B: SPI lookup + GCM verify',
        note: 'Peer B receives proto=50. Extracts SPI=0xABCD1234 from ESP header — SAD lookup finds the inbound SA. Seq=42 checked against sliding anti-replay window (accepted). GCM tag verified over (SPI+seq as AAD + IV + ciphertext). If the tag fails: silently dropped, no ICMP error.' },
      { title: 'Decrypted — inner packet delivered',
        note: 'AES-256-GCM decryption: inner IP header and payload restored. Outer IP, ESP header, IV, padding stripped. Inner packet (10.1.0.100 → 10.2.0.100) handed to Peer B\'s IP stack. Indistinguishable from unencrypted from the application\'s perspective. Inbound SA seq counter updated.' },
    ],
  },
  ko: {
    title: 'IPSec: IKEv2 + ESP 터널',
    readTime: '5분',
    intro: '두 단계로 구성: IKEv2가 Child SA를 협상하여 양측 피어의 SAD에 SPI를 설치하고, 그런 다음 ESP가 협상된 키로 xfrm 서브시스템을 통해 패킷을 캡슐화하여 전달합니다.',
    spdSub:  'Security Policy Database',
    sadSub:  'Security Association Database',
    sadEmpty: 'SA 없음 — 협상 중',
    spd: 'SPD', sad: 'SAD',
    peerA: 'Peer A', peerB: 'Peer B',
    pktTitle: '전송 중인 패킷',
    frames: [
      { title: '초기 상태 — SA 미수립',
        note: '양측 피어 모두 SPD 정책을 보유: 10.1.0.0/24 ↔ 10.2.0.0/24 트래픽은 ESP/AES-256-GCM을 사용해야 합니다 (액션: PROTECT). 양측 SAD 모두 비어 있음 — 키 없음, SPI 없음. IKEv2 협상이 먼저 필요합니다.' },
      { title: 'IKE_SA_INIT — DH 교환',
        note: 'Peer A가 IKE_SA_INIT 전송 (SA 제안: AES-256, SHA-384, DH 그룹 20). Peer B가 DH 공개값과 논스로 응답. ECDH를 통해 공유 IKE SA 키가 유도됩니다 — 다음 교환을 위한 보안 채널 생성. 아직 ESP 키 없음.' },
      { title: 'IKE_AUTH — 인증 + Child SA',
        note: 'Peer A가 IKE_AUTH 전송: 신원, 인증 페이로드(인증서 또는 PSK), 페이로드에 내장된 CREATE_CHILD_SA 제안. Peer B가 인증하고 수락하여 자체 인증과 협상된 Child SA 파라미터(새 DH에서 유도된 방향별 SPI 두 개 포함)로 응답.' },
      { title: 'Child SA 설치 — SAD 채워짐',
        note: 'xfrm이 양쪽 피어에 Child SA를 설치합니다. Peer A: OUT SPI=0xABCD1234 (Peer B가 이 흐름을 조회할 때 사용), IN SPI=0xDEF01234. Peer B: OUT SPI=0xDEF01234, IN SPI=0xABCD1234. SPI는 비대칭이고 피어별로 다름 — A의 OUT SPI가 B의 IN SPI입니다. 터널 활성화.' },
      { title: '패킷 수신 — SPD + SAD 룩업',
        note: '10.1.0.100 → 10.2.0.100 패킷이 Peer A의 xfrm에 도달. SPD 룩업: 셀렉터 매칭 → 액션 PROTECT. SAD 아웃바운드 룩업: SPI=0xABCD1234, AES-256-GCM, seq=41 확인. 캡슐화 시작. 이 패킷의 seq는 42로 증가됩니다.' },
      { title: 'ESP 패킷 전송',
        note: 'Peer A가 캡슐화 후 전송: 외부 IP (10.0.1.1→10.0.2.1, proto=50) | ESP Hdr (SPI=0xABCD1234, seq=42) | IV (12 B 논스) | AES-256-GCM 암호화 [내부 IP + 페이로드 + 패딩] | GCM 태그 (16 B, SPI+seq를 AAD로 포함). 아웃바운드 SA seq 카운터 42로 증가.' },
      { title: 'Peer B: SPI 룩업 + GCM 검증',
        note: 'Peer B가 proto=50 수신. ESP 헤더에서 SPI=0xABCD1234 추출 — SAD 룩업으로 인바운드 SA 발견. 슬라이딩 반재생 윈도우에서 seq=42 확인(수락). GCM 태그를 (SPI+seq AAD + IV + 암호문)에 대해 검증. 태그 실패 시: 조용히 드롭, ICMP 오류 없음.' },
      { title: '복호화 완료 — 내부 패킷 전달',
        note: 'AES-256-GCM 복호화: 내부 IP 헤더와 페이로드 복원. 외부 IP, ESP 헤더, IV, 패딩 제거. 내부 패킷(10.1.0.100 → 10.2.0.100)을 Peer B의 IP 스택으로 전달. 애플리케이션 관점에서 암호화되지 않은 패킷과 동일. 인바운드 SA seq 카운터 업데이트.' },
    ],
  },
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SpdTable({ entries, hi, label, sub }: { entries: SpdEntry[]; hi?: boolean; label: string; sub: string }) {
  return (
    <div className={`ipsec2-table${hi ? ' ipsec2-table-hi' : ''}`}>
      <div className="ipsec2-table-head">
        <span className="ipsec2-table-name">{label}</span>
        <span className="ipsec2-table-sub">{sub}</span>
      </div>
      <div className="ipsec2-table-body">
        {entries.map((e, i) => (
          <div key={i} className="ipsec2-spd-row">
            <span className={`ike-dir-badge ${e.dir === 'OUT' ? 'ike-dir-out' : 'ike-dir-in'}`}>{e.dir}</span>
            <code className="ike-selector">{e.sel}</code>
            <span className="ike-action">PROTECT / ESP</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SadTable({ entries, sadHi, label, sub, emptyLabel }: {
  entries: SadEntry[]; sadHi?: 'out' | 'in' | 'both'; label: string; sub: string; emptyLabel: string
}) {
  return (
    <div className="ipsec2-table">
      <div className="ipsec2-table-head">
        <span className="ipsec2-table-name">{label}</span>
        <span className="ipsec2-table-sub">{sub}</span>
      </div>
      <div className="ipsec2-table-body ipsec2-sad-body">
        {entries.length === 0
          ? <span className="ipsec2-empty">{emptyLabel}</span>
          : entries.map((e, i) => {
              const isHi = sadHi === 'both' || (sadHi === 'out' && e.dir === 'OUT') || (sadHi === 'in' && e.dir === 'IN')
              return (
                <div key={i} className={`ipsec2-sad-row${isHi ? ' ipsec2-sad-hi' : ''}`}>
                  <span className={`ike-dir-badge ${e.dir === 'OUT' ? 'ike-dir-out' : 'ike-dir-in'}`}>{e.dir}</span>
                  <code className="ike-spi">{e.spi}</code>
                  <span className="ike-cipher">{e.cipher}</span>
                  <span className="ike-seq">seq={e.seq}</span>
                </div>
              )
            })}
      </div>
    </div>
  )
}

function PeerCard({ name, addr, spd, state, t, animKey }: {
  name: string; addr: string; spd: SpdEntry[]; state: PeerState
  t: typeof T['en']; animKey: number
}) {
  return (
    <div className="ipsec2-peer" key={`${name}-${animKey}`}>
      <div className="ipsec2-peer-head">
        <span className="ipsec2-peer-name">{name}</span>
        <code className="ipsec2-peer-addr">{addr}</code>
      </div>
      <SpdTable entries={spd} hi={state.spdHi} label={t.spd} sub={t.spdSub} />
      <SadTable entries={state.sad} sadHi={state.sadHi} label={t.sad} sub={t.sadSub} emptyLabel={t.sadEmpty} />
    </div>
  )
}

function PacketView({ segs, title }: { segs: PktSeg[]; title: string }) {
  return (
    <div className="ipsec-packet-wrap">
      <div className="ipsec-packet-title">{title}</div>
      <div className="ipsec-packet">
        {segs.map(seg => (
          <div key={seg.id} className={`ipsec-seg ${seg.cls}${seg.grow ? ' ipsec-seg-grow' : ''}${seg.hi ? ' ipsec-seg-hi' : ''}`}>
            <span className="ipsec-seg-label">{seg.label}</span>
            {seg.sub && <span className="ipsec-seg-sub">{seg.sub}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Explorer ───────────────────────────────────────────────────────────────────

function IpsecExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [animKey, setAnimKey] = useState(0)

  const total  = FRAMES.length
  const frame  = FRAMES[step]
  const ft     = t.frames[step]
  const isLast = step >= total - 1

  useEffect(() => {
    if (!playing) return
    if (isLast) { setPlaying(false); return }
    const timer = setTimeout(() => { setStep(s => s + 1); setAnimKey(k => k + 1) }, 1100)
    return () => clearTimeout(timer)
  }, [playing, step, isLast])

  function reset()    { setPlaying(false); setStep(0); setAnimKey(k => k + 1) }
  function stepFwd()  { if (!isLast) { setStep(s => s + 1); setAnimKey(k => k + 1) } }
  function handlePlay() {
    if (isLast) { reset(); setTimeout(() => setPlaying(true), 50); return }
    setPlaying(p => !p)
  }

  const lbl = {
    reset:  lang === 'ko' ? '초기화'   : 'Reset',
    play:   lang === 'ko' ? '재생'     : 'Play',
    pause:  lang === 'ko' ? '일시정지' : 'Pause',
    resume: lang === 'ko' ? '계속'     : 'Resume',
    replay: lang === 'ko' ? '다시 보기': 'Replay',
    step:   lang === 'ko' ? '다음 →'  : 'Step →',
  }

  const isIke = frame.phase === 'ike'

  return (
    <div className="bgp-explorer">

      {/* Phase indicator */}
      <div className="bgp2-phases">
        <span className={`bgp2-phase-pill${isIke ? ' active' : ''}`}>IKEv2</span>
        <span className="bgp2-phase-sep">→</span>
        <span className={`bgp2-phase-pill${!isIke ? ' active' : ''}`}>ESP</span>
      </div>

      {/* Two-peer layout */}
      <div className="ipsec2-peers">
        <PeerCard name={t.peerA} addr="10.0.1.1" spd={SPD_A} state={frame.peerA} t={t} animKey={animKey} />

        {/* Message lane */}
        <div className="ipsec2-lane">
          <div className="bgp2-session-line" />
          {frame.msg && (
            <div className="ipsec2-msg" key={`msg-${animKey}`}>
              <span className={`ipsec2-msg-pill ipsec2-msg-${frame.msg.kind}`}>
                {frame.msg.dir === 'a2b' ? '→ ' : frame.msg.dir === 'b2a' ? '← ' : '↔ '}
                {frame.msg.label}
              </span>
            </div>
          )}
          <div className="bgp2-session-line" />
        </div>

        <PeerCard name={t.peerB} addr="10.0.2.1" spd={SPD_B} state={frame.peerB} t={t} animKey={animKey} />
      </div>

      {/* ESP packet diagram */}
      {frame.segs && (
        <PacketView segs={frame.segs} title={t.pktTitle} />
      )}

      {/* Controls */}
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

      {/* Detail */}
      <div className="bgp2-detail">
        <div className="bgp2-detail-title">{ft.title}</div>
        <p className="bgp2-detail-body">{ft.note}</p>
        <span className="tcp-step-counter">{step + 1} / {total}</span>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function IpsecPage() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-06-21"
      readTime={t.readTime}
      tags={['networking', 'ipsec', 'security', 'vpn']}
      intro={t.intro}
    >
      <div className="bgp-root">
        <IpsecExplorer />
      </div>
    </NoteLayout>
  )
}
