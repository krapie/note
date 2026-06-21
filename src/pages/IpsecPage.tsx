import { useState, useEffect } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

interface SpdEntry { dir: 'OUT' | 'IN'; from: string; to: string }
interface SadEntry { spi: string; dir: 'OUT' | 'IN'; cipher: string }
interface PktSeg { id: string; label: string; sub?: string; cls: string; grow?: boolean; hi?: boolean }

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title: 'IPSec: ESP encapsulation and decapsulation',
    readTime: '5 min',
    intro: 'What happens inside the xfrm subsystem when a packet hits an IPSec policy — from original datagram to encrypted wire format and back. IKE SA and Child SA are already negotiated; SPD and SAD are pre-configured.',
    partLabel: 'ESP tunnel mode — xfrm packet transformation',
    spdSub: 'Security Policy Database · what to do with traffic',
    sadSub: 'Security Association Database · how to protect it',
    empty: 'empty',
    outbound: 'Outbound ↗',
    inbound: 'Inbound ↙',
    xfrmOut: 'xfrm outbound on Peer A (10.0.1.1)',
    xfrmIn: 'xfrm inbound on Peer B (10.0.2.1)',
    espOut: [
      { title: 'Original packet', note: 'Packet originates from 10.1.0.100 destined for 10.2.0.100. Before leaving the host, the xfrm subsystem intercepts it for an SPD lookup against the outbound policy database.' },
      { title: 'SPD + SAD lookup', note: 'SPD lookup: (src=10.1.0.100, dst=10.2.0.100) matches selector 10.1.0.0/24 → 10.2.0.0/24. Action: PROTECT. SAD lookup: outbound SA — SPI=0xABCD1234, cipher=AES-256-GCM, seq=41. Both entries are highlighted.' },
      { title: 'Prepend ESP header', note: 'ESP header (8 B) prepended: SPI (4 B) identifies the SA on the receiver\'s SAD. Sequence Number (4 B, here: 42) increments monotonically and never wraps — a new SA is negotiated before rollover. The receiver uses seq for anti-replay detection.' },
      { title: 'Prepend IV', note: '12-byte IV (nonce) prepended for AES-256-GCM. Must be unique per-key per-packet. Common scheme: 4 B fixed (from SA negotiation) || 8 B per-packet counter. Reusing a GCM nonce destroys both confidentiality and authenticity.' },
      { title: 'Encrypt payload', note: 'AES-256-GCM encrypts: [Inner IP header | Payload | Padding (4 B alignment) | PadLen (1 B) | NextHdr (1 B)]. The inner IP header IS encrypted — original src/dst are hidden from any observer on the wire. GCM is AEAD: encryption and authentication happen in a single pass.' },
      { title: 'Append GCM tag', note: '16-byte GCM authentication tag appended. Covers: ESP header (SPI + seq, used as AAD — authenticated but not encrypted) + IV + ciphertext. The receiver verifies this tag BEFORE attempting decryption. Any single bit flip causes silent rejection.' },
      { title: 'Prepend outer IP header', note: 'Outer IP header (20 B) prepended: src=10.0.1.1, dst=10.0.2.1, Protocol=50 (ESP). This is the tunnel header — what the network routes. ESP overhead ≈ 56 B. If the inner packet is 1500 B, the outer exceeds typical MTU; PMTUD or MSS clamping at the gateway handles this.' },
      { title: 'On the wire', note: 'Transmitted. An observer sees: outer IP (10.0.1.1 → 10.0.2.1), Protocol=50. Inner src/dst, ports, payload — completely opaque. PFS (fresh DH on every rekey) ensures compromising current keys does not expose past sessions.' },
    ],
    espIn: [
      { title: 'Received on wire', note: 'Packet arrives: src=10.0.2.1, dst=10.0.1.1, Protocol=50 (ESP). The kernel identifies Protocol 50 and hands it to the xfrm inbound path.' },
      { title: 'SPI lookup + anti-replay', note: 'SPI=0xABCD1234 extracted from ESP header (highlighted). SAD lookup: (SPI=0xABCD1234, dst=10.0.1.1, proto=ESP) → inbound SA found. Check seq=42 against the 64-bit sliding anti-replay window. Seq 42 not yet seen → accepted. Duplicates or out-of-window packets are silently dropped.' },
      { title: 'Verify GCM tag', note: 'GCM authentication tag (highlighted) verified over: SPI+seq (AAD) + IV + ciphertext. Uses the inbound SA\'s authentication key. If the tag does not match: packet silently dropped — no ICMP error, no log. This prevents an attacker from probing the tunnel or learning anything from a response.' },
      { title: 'Decrypt', note: 'AES-256-GCM decryption using the inbound SA key and the received IV. Inner IP header and payload restored. Padding, PadLen, and NextHdr bytes are stripped from the end of the plaintext.' },
      { title: 'Deliver inner packet', note: 'Outer IP header, ESP header, and IV stripped. Inner packet (src=10.2.0.100, dst=10.1.0.100) handed to the IP stack. Kernel routes it normally — forwarded to the 10.1.0.0/24 subnet or consumed by a local socket. Indistinguishable from an unencrypted packet from the application\'s perspective.' },
    ],
  },
  ko: {
    title: 'IPSec: ESP 캡슐화와 역캡슐화',
    readTime: '5분',
    intro: '패킷이 IPSec 정책에 도달했을 때 xfrm 서브시스템 내부에서 일어나는 일 — 원본 데이터그램에서 암호화된 전송 포맷까지, 그리고 다시 되돌아오는 과정. IKE SA와 Child SA는 이미 협상 완료; SPD와 SAD는 사전 설정된 상태입니다.',
    partLabel: 'ESP 터널 모드 — xfrm 패킷 변환',
    spdSub: 'Security Policy Database · 트래픽 처리 방법',
    sadSub: 'Security Association Database · 보호 방법',
    empty: '비어 있음',
    outbound: '아웃바운드 ↗',
    inbound: '인바운드 ↙',
    xfrmOut: 'Peer A (10.0.1.1) — xfrm 아웃바운드',
    xfrmIn: 'Peer B (10.0.2.1) — xfrm 인바운드',
    espOut: [
      { title: '원본 패킷', note: '10.1.0.100에서 10.2.0.100으로 향하는 패킷. 호스트를 떠나기 전 xfrm 서브시스템이 아웃바운드 정책 데이터베이스에서 SPD 룩업을 위해 패킷을 가로챕니다.' },
      { title: 'SPD + SAD 룩업', note: 'SPD 룩업: (src=10.1.0.100, dst=10.2.0.100)이 셀렉터 10.1.0.0/24 → 10.2.0.0/24에 매칭됩니다. 액션: PROTECT. SAD 룩업: 아웃바운드 SA — SPI=0xABCD1234, cipher=AES-256-GCM, seq=41. 두 항목이 모두 강조됩니다.' },
      { title: 'ESP 헤더 추가', note: 'ESP 헤더(8 B) 추가: SPI(4 B)는 수신측 SAD에서 SA를 식별합니다. 시퀀스 번호(4 B, 여기서는 42)는 단조 증가하며 오버플로가 없습니다 — 롤오버 전에 새 SA가 협상됩니다. 수신측이 반재생 탐지에 seq를 사용합니다.' },
      { title: 'IV 추가', note: 'AES-256-GCM용 12바이트 IV(논스) 추가. 키당 패킷당 고유해야 합니다. 일반적인 방식: 4 B 고정(SA 협상에서) || 8 B 패킷별 카운터. GCM 논스 재사용은 기밀성과 인증을 모두 파괴합니다.' },
      { title: '페이로드 암호화', note: 'AES-256-GCM이 암호화: [내부 IP 헤더 | 페이로드 | 패딩(4 B 정렬) | PadLen(1 B) | NextHdr(1 B)]. 내부 IP 헤더 전체가 암호화됩니다 — 원본 송수신 주소가 와이어의 관찰자에게 숨겨집니다. GCM은 AEAD: 암호화와 인증이 단일 패스로 처리됩니다.' },
      { title: 'GCM 태그 추가', note: '16바이트 GCM 인증 태그 추가. 범위: ESP 헤더(SPI+seq, AAD로 사용 — 인증되지만 암호화 안 됨) + IV + 암호문. 수신측은 복호화 시도 전에 이 태그를 먼저 검증합니다. 단 1비트 변경도 조용히 거부됩니다.' },
      { title: '외부 IP 헤더 추가', note: '외부 IP 헤더(20 B) 추가: src=10.0.1.1, dst=10.0.2.1, Protocol=50(ESP). 이것이 터널 헤더 — 네트워크가 라우팅하는 정보입니다. ESP 오버헤드 약 56 B. 내부 패킷이 1500 B이면 외부 패킷이 일반 MTU를 초과합니다; 게이트웨이의 PMTUD 또는 MSS 클램핑이 처리합니다.' },
      { title: '전송 중', note: '전송 완료. 관찰자가 볼 수 있는 것: 외부 IP(10.0.1.1 → 10.0.2.1), Protocol=50. 내부 송수신 주소, 포트, 페이로드 — 완전히 불투명합니다. PFS(재키잉마다 새로운 DH)는 현재 키가 유출되어도 과거 세션을 노출하지 않습니다.' },
    ],
    espIn: [
      { title: '수신', note: '패킷 수신: src=10.0.2.1, dst=10.0.1.1, Protocol=50(ESP). 커널이 Protocol 50을 인식하고 xfrm 인바운드 경로로 전달합니다.' },
      { title: 'SPI 룩업 + 반재생 검사', note: 'ESP 헤더(강조됨)에서 SPI=0xABCD1234 추출. SAD 룩업: (SPI=0xABCD1234, dst=10.0.1.1, proto=ESP) → 인바운드 SA 발견. 64비트 슬라이딩 반재생 윈도우에서 seq=42 확인. seq 42 미수신 → 수락. 중복 또는 윈도우 밖 패킷은 조용히 드롭됩니다.' },
      { title: 'GCM 태그 검증', note: 'GCM 인증 태그(강조됨)를 (SPI+seq [AAD] + IV + 암호문)에 대해 검증합니다. 인바운드 SA의 인증 키를 사용합니다. 태그 불일치 시: 패킷 조용히 드롭 — ICMP 오류 없음, 기본적으로 로그 없음. 공격자가 터널을 탐지하거나 응답으로 정보를 얻지 못하도록 합니다.' },
      { title: '복호화', note: '인바운드 SA 키와 수신된 IV로 AES-256-GCM 복호화. 내부 IP 헤더와 페이로드가 복원됩니다. 평문 끝의 패딩, PadLen, NextHdr 바이트가 제거됩니다.' },
      { title: '내부 패킷 전달', note: '외부 IP 헤더, ESP 헤더, IV 제거. 내부 패킷(src=10.2.0.100, dst=10.1.0.100)을 IP 스택으로 전달합니다. 커널이 정상적으로 라우팅 — 10.1.0.0/24 서브넷으로 포워딩하거나 로컬 소켓에서 수신합니다. 애플리케이션 관점에서 암호화되지 않은 패킷과 동일합니다.' },
    ],
  },
}

// ── Static SA data (tunnel already established) ────────────────────────────────

const FULL_SPD: SpdEntry[] = [
  { dir: 'OUT', from: '10.1.0.0/24', to: '10.2.0.0/24' },
  { dir: 'IN',  from: '10.2.0.0/24', to: '10.1.0.0/24' },
]
const FULL_SAD: SadEntry[] = [
  { spi: '0xABCD1234', dir: 'OUT', cipher: 'AES-256-GCM' },
  { spi: '0xDEF01234', dir: 'IN',  cipher: 'AES-256-GCM' },
]

const OUT_SA_HI: Array<'spd' | 'sad' | 'both' | undefined> = [
  undefined, 'both', undefined, undefined, undefined, undefined, undefined, undefined,
]
const IN_SA_HI: Array<'spd' | 'sad' | 'both' | undefined> = [
  undefined, 'sad', undefined, undefined, undefined,
]

// ── Packet segment definitions ─────────────────────────────────────────────────

const S = {
  outerIp:   { id: 'outer-ip',  label: 'Outer IP',  sub: '20 B',  cls: 'ipsec-seg-outer' },
  espHdr:    { id: 'esp-hdr',   label: 'ESP Hdr',   sub: '8 B',   cls: 'ipsec-seg-esp' },
  espHdrHi:  { id: 'esp-hdr',   label: 'ESP Hdr',   sub: '8 B',   cls: 'ipsec-seg-esp',  hi: true },
  iv:        { id: 'iv',        label: 'IV',         sub: '12 B',  cls: 'ipsec-seg-iv' },
  innerIp:   { id: 'inner-ip',  label: 'Inner IP',  sub: '20 B',  cls: 'ipsec-seg-inner' },
  payload:   { id: 'payload',   label: 'Payload',                 cls: 'ipsec-seg-payload', grow: true },
  encrypted: { id: 'encrypted', label: 'Encrypted', sub: 'Inner IP + Payload + Padding', cls: 'ipsec-seg-enc', grow: true },
  gcmTag:    { id: 'gcm-tag',   label: 'GCM Tag',   sub: '16 B',  cls: 'ipsec-seg-auth' },
  gcmTagHi:  { id: 'gcm-tag',   label: 'GCM Tag',   sub: '16 B',  cls: 'ipsec-seg-auth', hi: true },
} satisfies Record<string, PktSeg>

const ESP_OUT_SEGS = [
  [S.innerIp, S.payload],
  [S.innerIp, S.payload],
  [S.espHdr, S.innerIp, S.payload],
  [S.espHdr, S.iv, S.innerIp, S.payload],
  [S.espHdr, S.iv, S.encrypted],
  [S.espHdr, S.iv, S.encrypted, S.gcmTag],
  [S.outerIp, S.espHdr, S.iv, S.encrypted, S.gcmTag],
  [S.outerIp, S.espHdr, S.iv, S.encrypted, S.gcmTag],
]

const ESP_IN_SEGS = [
  [S.outerIp, S.espHdr, S.iv, S.encrypted, S.gcmTag],
  [S.outerIp, S.espHdrHi, S.iv, S.encrypted, S.gcmTag],
  [S.outerIp, S.espHdr, S.iv, S.encrypted, S.gcmTagHi],
  [S.outerIp, S.espHdr, S.iv, S.innerIp, S.payload],
  [S.innerIp, S.payload],
]

// ── Sub-components ─────────────────────────────────────────────────────────────

function SaPanel({ highlight }: { highlight?: 'spd' | 'sad' | 'both' }) {
  const { lang } = useLang()
  const t = T[lang]
  const spdHi = highlight === 'spd' || highlight === 'both'
  const sadHi = highlight === 'sad' || highlight === 'both'
  return (
    <div className="ike-db-panel">
      <div className={`ike-db-section${spdHi ? ' ike-db-active' : ''}`}>
        <div className="ike-db-head">
          <span className="ike-db-title">SPD</span>
          <span className="ike-db-sub">{t.spdSub}</span>
        </div>
        <div className="ike-db-body">
          {FULL_SPD.map((e, i) => (
            <div key={i} className="ike-db-row">
              <span className={`ike-dir-badge ${e.dir === 'OUT' ? 'ike-dir-out' : 'ike-dir-in'}`}>{e.dir}</span>
              <code className="ike-selector">{e.from} → {e.to}</code>
              <span className="ike-action">PROTECT / ESP</span>
            </div>
          ))}
        </div>
      </div>
      <div className={`ike-db-section${sadHi ? ' ike-db-active' : ''}`}>
        <div className="ike-db-head">
          <span className="ike-db-title">SAD</span>
          <span className="ike-db-sub">{t.sadSub}</span>
        </div>
        <div className="ike-db-body">
          {FULL_SAD.map((e, i) => (
            <div key={i} className="ike-db-row">
              <code className="ike-spi">{e.spi}</code>
              <span className={`ike-dir-badge ${e.dir === 'OUT' ? 'ike-dir-out' : 'ike-dir-in'}`}>{e.dir}</span>
              <span className="ike-cipher">{e.cipher}</span>
              <span className="ike-seq">seq=0 · lifetime=3600s</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PacketFrameView({ segs, title }: { segs: PktSeg[]; title: string }) {
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

// ── ESP Explorer ───────────────────────────────────────────────────────────────

function EspExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const [dir, setDir] = useState<'out' | 'in'>('out')
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)

  const frames = dir === 'out' ? t.espOut : t.espIn
  const segs   = dir === 'out' ? ESP_OUT_SEGS : ESP_IN_SEGS
  const saHi   = dir === 'out' ? OUT_SA_HI[step] : IN_SA_HI[step]
  const isLast = step >= frames.length - 1

  useEffect(() => {
    if (!playing) return
    if (isLast) { setPlaying(false); return }
    const timer = setTimeout(() => setStep(s => s + 1), 950)
    return () => clearTimeout(timer)
  }, [playing, step, isLast])

  function switchDir(d: 'out' | 'in') {
    if (d === dir) return
    setDir(d); setStep(0); setPlaying(false)
  }
  function reset() { setPlaying(false); setStep(0) }
  function stepFwd() { if (!isLast) setStep(s => s + 1) }
  function handlePlay() {
    if (isLast) { reset(); setTimeout(() => setPlaying(true), 50); return }
    setPlaying(p => !p)
  }

  const lbl = {
    reset:  lang === 'ko' ? '초기화'    : 'Reset',
    play:   lang === 'ko' ? '재생'      : 'Play',
    pause:  lang === 'ko' ? '일시정지'  : 'Pause',
    resume: lang === 'ko' ? '계속'      : 'Resume',
    replay: lang === 'ko' ? '다시 보기' : 'Replay',
    step:   lang === 'ko' ? '다음 →'   : 'Step →',
  }

  const frame = frames[step]
  const total = frames.length

  return (
    <div className="bgp-explorer">
      <div className="bgp-section-label">{t.partLabel}</div>

      <div className="ipsec-dir-toggle">
        <button className={`ipsec-dir-btn${dir === 'out' ? ' active' : ''}`} onClick={() => switchDir('out')}>
          {t.outbound}
        </button>
        <button className={`ipsec-dir-btn${dir === 'in' ? ' active' : ''}`} onClick={() => switchDir('in')}>
          {t.inbound}
        </button>
      </div>

      <div className="ipsec-xfrm-label">{dir === 'out' ? t.xfrmOut : t.xfrmIn}</div>

      <SaPanel highlight={saHi} />

      <PacketFrameView segs={segs[step]} title={frame.title} />

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

      <div className="tcp-detail tcp-detail-ann" style={{ alignItems: 'flex-start', minHeight: 'auto' }}>
        <span style={{ lineHeight: 'var(--kp-leading-relaxed)', fontSize: 'var(--kp-text-sm)' }}>
          {frame.note}
        </span>
        <span className="tcp-step-counter" style={{ flexShrink: 0 }}>{step + 1} / {total}</span>
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
        <EspExplorer />
      </div>
    </NoteLayout>
  )
}
