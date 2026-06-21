import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

type IkeState = 'IDLE' | 'SA_INIT' | 'AUTH' | 'ESTABLISHED'
type Dir = 'a2b' | 'b2a'

interface IkeMsg { dir: Dir; label: string; encrypted: boolean }
interface SpdEntry { dir: 'OUT' | 'IN'; from: string; to: string }
interface SadEntry { spi: string; dir: 'OUT' | 'IN'; cipher: string }
interface PktSeg { id: string; label: string; sub?: string; cls: string; grow?: boolean; hi?: boolean }

const IKE_STATE_CLS: Record<IkeState, string> = {
  IDLE: 'bgp-st-idle', SA_INIT: 'bgp-st-transit', AUTH: 'bgp-st-transit', ESTABLISHED: 'bgp-st-est',
}

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title: 'IPSec: IKEv2 negotiation and ESP tunnel',
    readTime: '8 min',
    intro: 'How two gateways negotiate a secure tunnel via IKEv2 — key exchange, authentication, SA creation — then how every packet is ESP-encapsulated on the wire. Three interactive walkthroughs: IKE_SA_INIT (DH key exchange), IKE_AUTH + SPD/SAD setup, and step-by-step ESP packet transformation.',
    part1: 'Part 1 — IKE_SA_INIT (Key Exchange)',
    part2: 'Part 2 — IKE_AUTH & Child SA (IPSec SA)',
    part3: 'Part 3 — ESP Tunnel Mode Packet Processing',
    spdSub: 'Security Policy Database · what to do with traffic',
    sadSub: 'Security Association Database · how to protect it',
    empty: 'empty',
    unprotected: 'unprotected',
    encrypted: 'encrypted',
    outbound: 'Outbound ↗',
    inbound: 'Inbound ↙',
    seqLabel: (s: string) => `seq · lifetime=3600s`,
    ikeInit: [
      { annotation: 'IKEv2 negotiation starts over UDP:500. Peer A (10.0.1.1) initiates to Peer B (10.0.2.1). All IKE_SA_INIT messages are unprotected — no keys exist yet.' },
      { note: 'Peer A sends IKE_SA_INIT: SAi1 (proposed algorithms — AES-256-GCM, PRF-HMAC-SHA-256, DH group 14), KEi (Diffie-Hellman public value g^a mod p), Ni (random 256-bit nonce). This message is in the clear — an observer can see the proposed ciphers and DH value, but cannot derive the session key from g^a alone.' },
      { note: 'Peer B responds: SAr1 (selected algorithm — AES-256-GCM), KEr (its own DH value g^b mod p), Nr (nonce). Both peers now have everything needed to compute the shared secret: g^ab = (g^b)^a = (g^a)^b mod p. Neither side ever transmits the shared secret.' },
      { annotation: 'Both peers compute g^ab (DH shared secret). SKEYSEED = PRF(Ni | Nr, g^ab). Five key pairs derived: SK_d (for Child SA keying material), SK_ai + SK_ar (IKE integrity keys), SK_ei + SK_er (IKE encryption keys). All subsequent messages are encrypted and integrity-protected.' },
    ],
    ikeAuth: [
      { annotation: 'IKE SA keys active (SK_ei/SK_er for encryption, SK_ai/SK_ar for integrity). IKE_AUTH exchange begins — both messages are encrypted and authenticated.' },
      { note: 'Peer A sends IKE_AUTH (encrypted with SK_ei, integrity with SK_ai): IDi (identity — IP or FQDN), AUTH (proof of key possession — HMAC over nonces + ID using the PSK, or a certificate signature), SAi2 (Child SA proposals: AES-256-GCM), TSi (traffic selector: 10.1.0.0/24), TSr (traffic selector: 10.2.0.0/24). Peer B must verify AUTH before proceeding.' },
      { note: 'Peer B verifies Peer A\'s AUTH, then responds: IDr, AUTH (its own proof), SAr2 (accepted Child SA cipher), TSi + TSr (confirmed selectors), and allocates two SPIs — one for each direction. Both peers derive Child SA keys from SK_d + nonces. IKE SA and Child SA are both now active.' },
      { annotation: 'IPSec tunnel established. SPD maps 10.1.0.0/24 ↔ 10.2.0.0/24 to PROTECT. SAD holds two unidirectional SAs (one per direction), each with a unique SPI, cipher key, and sequence counter.' },
    ],
    espOut: [
      { title: 'Original packet', note: 'Packet originates from 10.1.0.100 destined for 10.2.0.100. Before leaving the host, the IPSec subsystem intercepts it for SPD lookup.' },
      { title: 'SPD + SAD lookup', note: 'SPD lookup: (src=10.1.0.100, dst=10.2.0.100) matches selector 10.1.0.0/24 → 10.2.0.0/24. Action: PROTECT. SAD lookup: outbound SA — SPI=0xABCD1234, cipher=AES-256-GCM, current seq=41.' },
      { title: 'Prepend ESP header', note: 'ESP header (8B) prepended: SPI (4B) — identifies the SA on the receiver\'s SAD. Sequence Number (4B, here: 42) — increments monotonically per packet, never wraps (a new SA is created before rollover). Receiver uses seq for anti-replay detection.' },
      { title: 'Prepend IV', note: '12-byte IV (nonce) for AES-256-GCM prepended. Must be unique per key per packet. Common scheme: 4B fixed (from SA negotiation) || 8B per-packet counter. Uniqueness is critical — reusing a nonce with GCM completely destroys confidentiality and authenticity.' },
      { title: 'Encrypt', note: 'AES-256-GCM encrypts: [Inner IP | Payload | Padding (align to 4B) | PadLen(1B) | NextHdr(1B)]. The inner IP header IS encrypted — src/dst of the original traffic are hidden from any network observer. GCM is AEAD: encryption and authentication happen in one pass.' },
      { title: 'Append GCM tag', note: '16-byte GCM authentication tag appended. Covers: ESP header (SPI+seq, used as AAD — authenticated but not encrypted) + IV + ciphertext. The receiver verifies this tag BEFORE attempting decryption. Any single bit flip in the packet causes silent rejection.' },
      { title: 'Prepend outer IP header', note: 'Outer IP header (20B): src=10.0.1.1, dst=10.0.2.1, Protocol=50 (ESP). This is the tunnel header — what the internet actually routes. Total ESP overhead ≈ 56B. If the inner packet is already 1500B, the outer packet exceeds typical MTU; PMTUD or MSS clamping at the gateway handles this.' },
      { title: 'On the wire', note: 'Transmitted. Any eavesdropper sees: outer IP (10.0.1.1 → 10.0.2.1), Protocol=50. Inner src/dst, port numbers, payload — completely opaque. IKEv2 with PFS (Perfect Forward Secrecy via fresh DH each rekey) ensures that compromising current keys does not expose past sessions.' },
    ],
    espIn: [
      { title: 'Received on wire', note: 'Packet arrives: src=10.0.2.1, dst=10.0.1.1, Protocol=50 (ESP). Kernel identifies protocol 50 and hands the packet to the IPSec subsystem for inbound processing.' },
      { title: 'SPI lookup → anti-replay', note: 'Extract SPI=0xABCD1234 from ESP header. SAD lookup: (SPI=0xABCD1234, dst=10.0.1.1, proto=ESP) → found inbound SA. Check seq=42 against the anti-replay window (64-bit sliding bitmap). Seq 42 not yet seen → OK. Duplicate or out-of-window packets are dropped without notification.' },
      { title: 'Verify GCM tag', note: 'Verify GCM auth tag over (SPI+seq [AAD] + IV + ciphertext). Verification uses the SA\'s inbound auth key. If the tag does not match: packet silently dropped. No ICMP error, no log by default — this prevents an attacker from probing the tunnel or learning anything from the gateway\'s response.' },
      { title: 'Decrypt', note: 'AES-256-GCM decryption with the inbound SA key and the received IV. Inner IP header and payload are restored. The padding, PadLen, and NextHdr bytes at the end of the plaintext are stripped.' },
      { title: 'Deliver inner packet', note: 'Outer IP header, ESP header, and IV stripped. Inner packet delivered to the IP stack: src=10.2.0.100, dst=10.1.0.100. The kernel routes it normally — forwarded to the 10.1.0.0/24 subnet or consumed by a local socket. From the application\'s perspective, this packet looks identical to an unencrypted one.' },
    ],
  },
  ko: {
    title: 'IPSec: IKEv2 협상과 ESP 터널',
    readTime: '8분',
    intro: '두 게이트웨이가 IKEv2로 보안 터널을 협상하는 방법 — 키 교환, 인증, SA 생성 — 그리고 모든 패킷이 ESP로 캡슐화되는 과정. 세 가지 인터랙티브 데모: IKE_SA_INIT(DH 키 교환), IKE_AUTH + SPD/SAD 설정, 단계별 ESP 패킷 변환.',
    part1: 'Part 1 — IKE_SA_INIT (키 교환)',
    part2: 'Part 2 — IKE_AUTH & Child SA (IPSec SA)',
    part3: 'Part 3 — ESP 터널 모드 패킷 처리',
    spdSub: 'Security Policy Database · 트래픽 처리 방법',
    sadSub: 'Security Association Database · 보호 방법',
    empty: '비어 있음',
    unprotected: '비암호화',
    encrypted: '암호화됨',
    outbound: '아웃바운드 ↗',
    inbound: '인바운드 ↙',
    seqLabel: (s: string) => `seq · lifetime=3600s`,
    ikeInit: [
      { annotation: 'IKEv2 협상이 UDP:500에서 시작됩니다. Peer A(10.0.1.1)가 Peer B(10.0.2.1)에게 개시합니다. 모든 IKE_SA_INIT 메시지는 보호되지 않습니다 — 아직 키가 없습니다.' },
      { note: 'Peer A가 IKE_SA_INIT 전송: SAi1(제안 알고리즘 — AES-256-GCM, PRF-HMAC-SHA-256, DH 그룹 14), KEi(디피-헬먼 공개값 g^a mod p), Ni(256비트 랜덤 논스). 이 메시지는 평문입니다 — 관찰자는 제안된 암호와 DH 값을 볼 수 있지만, g^a만으로는 세션 키를 도출할 수 없습니다.' },
      { note: 'Peer B가 응답: SAr1(선택된 알고리즘 — AES-256-GCM), KEr(자체 DH 값 g^b mod p), Nr(논스). 이제 양측은 공유 비밀을 계산할 모든 정보를 갖습니다: g^ab = (g^b)^a = (g^a)^b mod p. 공유 비밀은 어느 쪽도 전송하지 않습니다.' },
      { annotation: '양측이 g^ab(DH 공유 비밀)를 계산합니다. SKEYSEED = PRF(Ni | Nr, g^ab). 다섯 쌍의 키 파생: SK_d(Child SA 키 재료), SK_ai + SK_ar(IKE 무결성 키), SK_ei + SK_er(IKE 암호화 키). 이후 모든 메시지는 암호화 및 무결성 검증이 적용됩니다.' },
    ],
    ikeAuth: [
      { annotation: 'IKE SA 키 활성화(암호화에 SK_ei/SK_er, 무결성에 SK_ai/SK_ar). IKE_AUTH 교환 시작 — 두 메시지 모두 암호화 및 인증됩니다.' },
      { note: 'Peer A가 IKE_AUTH 전송(SK_ei로 암호화, SK_ai로 무결성): IDi(신원 — IP 또는 FQDN), AUTH(키 소유 증명 — PSK를 사용한 논스+ID의 HMAC, 또는 인증서 서명), SAi2(Child SA 제안: AES-256-GCM), TSi(트래픽 셀렉터: 10.1.0.0/24), TSr(트래픽 셀렉터: 10.2.0.0/24). Peer B는 진행 전 AUTH를 검증해야 합니다.' },
      { note: 'Peer B가 Peer A의 AUTH를 검증하고 응답: IDr, AUTH(자체 증명), SAr2(수락된 Child SA 암호), TSi + TSr(확정된 셀렉터), 두 방향 SPI 각각 할당. 양측이 SK_d + 논스로 Child SA 키를 파생합니다. IKE SA와 Child SA가 모두 활성화됩니다.' },
      { annotation: 'IPSec 터널 수립 완료. SPD는 10.1.0.0/24 ↔ 10.2.0.0/24 간 트래픽을 PROTECT로 매핑합니다. SAD는 각 방향별 단방향 SA 2개를 보유하며, 각각 고유한 SPI, 암호화 키, 시퀀스 카운터를 가집니다.' },
    ],
    espOut: [
      { title: '원본 패킷', note: '10.1.0.100에서 10.2.0.100으로 향하는 패킷입니다. 호스트를 떠나기 전, IPSec 서브시스템이 SPD 룩업을 위해 이를 가로챕니다.' },
      { title: 'SPD + SAD 룩업', note: 'SPD 룩업: (src=10.1.0.100, dst=10.2.0.100)이 셀렉터 10.1.0.0/24 → 10.2.0.0/24에 매칭됩니다. 액션: PROTECT. SAD 룩업: 아웃바운드 SA — SPI=0xABCD1234, cipher=AES-256-GCM, 현재 seq=41.' },
      { title: 'ESP 헤더 추가', note: 'ESP 헤더(8B) 추가: SPI(4B) — 수신측 SAD에서 SA를 식별. 시퀀스 번호(4B, 여기서는 42) — 패킷마다 단조 증가, 오버플로 없음(롤오버 전 새 SA 생성). 수신측이 반재생 탐지에 seq를 사용합니다.' },
      { title: 'IV 추가', note: 'AES-256-GCM용 12바이트 IV(논스) 추가. 키당 패킷당 고유해야 합니다. 일반적인 방식: 4B 고정(SA 협상에서) || 8B 패킷별 카운터. 유일성이 매우 중요합니다 — GCM에서 논스 재사용은 기밀성과 인증을 완전히 파괴합니다.' },
      { title: '암호화', note: 'AES-256-GCM이 암호화: [Inner IP | Payload | 패딩(4B 정렬) | PadLen(1B) | NextHdr(1B)]. 내부 IP 헤더 전체가 암호화됩니다 — 원본 트래픽의 송수신 주소는 네트워크 관찰자에게 숨겨집니다. GCM은 AEAD: 암호화와 인증이 한 번에 처리됩니다.' },
      { title: 'GCM 태그 추가', note: '16바이트 GCM 인증 태그 추가. 범위: ESP 헤더(SPI+seq, AAD로 사용 — 인증되지만 암호화 안 됨) + IV + 암호문. 수신측은 복호화 시도 전에 이 태그를 먼저 검증합니다. 패킷 내 단 1비트 변경도 조용히 거부됩니다.' },
      { title: '외부 IP 헤더 추가', note: '외부 IP 헤더(20B): src=10.0.1.1, dst=10.0.2.1, Protocol=50(ESP). 이것이 터널 헤더 — 실제로 인터넷에서 라우팅되는 정보입니다. ESP 오버헤드 약 56B. 내부 패킷이 이미 1500B이면 외부 패킷이 일반 MTU를 초과합니다; 게이트웨이의 PMTUD 또는 MSS 클램핑이 처리합니다.' },
      { title: '전송 중', note: '전송 완료. 도청자가 볼 수 있는 것: 외부 IP(10.0.1.1 → 10.0.2.1), Protocol=50. 내부 송수신 주소, 포트 번호, 페이로드 — 완전히 불투명합니다. PFS(Perfect Forward Secrecy, 재키잉마다 새로운 DH)를 사용하는 IKEv2는 현재 키가 유출되어도 과거 세션이 노출되지 않습니다.' },
    ],
    espIn: [
      { title: '수신', note: '패킷 수신: src=10.0.2.1, dst=10.0.1.1, Protocol=50(ESP). 커널이 프로토콜 50을 인식하고 패킷을 IPSec 서브시스템에 전달합니다.' },
      { title: 'SPI 룩업 → 반재생 검사', note: 'ESP 헤더에서 SPI=0xABCD1234 추출. SAD 룩업: (SPI=0xABCD1234, dst=10.0.1.1, proto=ESP) → 인바운드 SA 발견. 반재생 윈도우(64비트 슬라이딩 비트맵)에서 seq=42 확인. seq 42 미수신 → OK. 중복 또는 윈도우 벗어난 패킷은 알림 없이 드롭됩니다.' },
      { title: 'GCM 태그 검증', note: '(SPI+seq [AAD] + IV + 암호문)에 대한 GCM 인증 태그 검증. SA의 인바운드 인증 키를 사용합니다. 태그 불일치 시: 패킷 조용히 드롭. ICMP 오류 없음, 기본적으로 로그 없음 — 공격자가 터널을 탐지하거나 게이트웨이 응답으로 정보를 얻지 못하도록 합니다.' },
      { title: '복호화', note: '인바운드 SA 키와 수신된 IV로 AES-256-GCM 복호화. 내부 IP 헤더와 페이로드 복원. 평문 끝의 패딩, PadLen, NextHdr 바이트가 제거됩니다.' },
      { title: '내부 패킷 전달', note: '외부 IP 헤더, ESP 헤더, IV 제거. 내부 패킷을 IP 스택으로 전달: src=10.2.0.100, dst=10.1.0.100. 커널이 정상적으로 라우팅 — 10.1.0.0/24 서브넷으로 포워딩하거나 로컬 소켓에서 수신합니다. 애플리케이션 관점에서 이 패킷은 암호화되지 않은 것과 완전히 동일합니다.' },
    ],
  },
}

// ── Shared components ──────────────────────────────────────────────────────────

function GwBox({ label, ip, state }: { label: string; ip: string; state: IkeState }) {
  return (
    <div className="tcp-entity">
      <span className="tcp-entity-name">{label}</span>
      <code className="bgp-asn">{ip}</code>
      <span className={`tcp-state-badge ${IKE_STATE_CLS[state]}`}>{state}</span>
    </div>
  )
}

function SaPanel({ spd, sad, highlight }: {
  spd: SpdEntry[]; sad: SadEntry[]; highlight?: 'spd' | 'sad' | 'both'
}) {
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
          {spd.length === 0 ? <span className="bgp-rib-empty">{t.empty}</span> : spd.map((e, i) => (
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
          {sad.length === 0 ? <span className="bgp-rib-empty">{t.empty}</span> : sad.map((e, i) => (
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

// ── useExplorer + Controls ─────────────────────────────────────────────────────

function useExplorer(length: number) {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [animKey, setAnimKey] = useState(0)
  const seqRef = useRef<HTMLDivElement>(null)
  const isLast = step >= length - 1

  useEffect(() => {
    if (!playing) return
    if (isLast) { setPlaying(false); return }
    const t = setTimeout(() => { setStep(s => s + 1); setAnimKey(k => k + 1) }, 900)
    return () => clearTimeout(t)
  }, [playing, step, isLast])

  useEffect(() => {
    if (seqRef.current) seqRef.current.scrollTop = seqRef.current.scrollHeight
  }, [step])

  const reset = () => { setPlaying(false); setStep(0); setAnimKey(k => k + 1) }
  const stepFwd = () => { if (!isLast) { setStep(s => s + 1); setAnimKey(k => k + 1) } }
  const handlePlay = () => {
    if (isLast) { reset(); setTimeout(() => setPlaying(true), 50); return }
    setPlaying(p => !p)
  }
  return { step, playing, animKey, seqRef, isLast, reset, stepFwd, handlePlay, length }
}

function ExplorerControls({ ex }: { ex: ReturnType<typeof useExplorer> }) {
  const { step, playing, isLast, length, reset, stepFwd, handlePlay } = ex
  const { lang } = useLang()
  const lbl = {
    reset: lang === 'ko' ? '초기화' : 'Reset',
    play: lang === 'ko' ? '재생' : 'Play',
    pause: lang === 'ko' ? '일시정지' : 'Pause',
    resume: lang === 'ko' ? '계속' : 'Resume',
    replay: lang === 'ko' ? '다시 보기' : 'Replay',
    step: lang === 'ko' ? '다음 →' : 'Step →',
  }
  return (
    <>
      <div className="tcp-controls">
        <button className="btn-secondary" onClick={reset}>{lbl.reset}</button>
        <button className="btn-primary" onClick={handlePlay}>
          {playing ? lbl.pause : isLast ? lbl.replay : step === 0 ? lbl.play : lbl.resume}
        </button>
        <button className="btn-secondary" onClick={stepFwd} disabled={playing || isLast}>{lbl.step}</button>
      </div>
      <div className="tcp-progress">
        <div className="tcp-progress-fill" style={{ width: `${(step / (length - 1)) * 100}%` }} />
      </div>
    </>
  )
}

// ── Part 1: IKE_SA_INIT ───────────────────────────────────────────────────────

interface IkeInitFrame { msg?: IkeMsg; stateA: IkeState; stateB: IkeState; hasAnnotation?: boolean }

const IKE_INIT_FRAMES: IkeInitFrame[] = [
  { stateA: 'IDLE', stateB: 'IDLE', hasAnnotation: true },
  { msg: { dir: 'a2b', label: 'IKE_SA_INIT', encrypted: false }, stateA: 'SA_INIT', stateB: 'IDLE' },
  { msg: { dir: 'b2a', label: 'IKE_SA_INIT', encrypted: false }, stateA: 'SA_INIT', stateB: 'SA_INIT' },
  { stateA: 'AUTH', stateB: 'AUTH', hasAnnotation: true },
]

function IkeInitExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const ex = useExplorer(IKE_INIT_FRAMES.length)
  const { step, animKey, seqRef } = ex
  const frame = IKE_INIT_FRAMES[step]
  const text = t.ikeInit[step]

  const shownMsgs: Array<{ msg: IkeMsg; idx: number; isLive: boolean }> = []
  for (let i = 1; i <= step; i++) {
    if (IKE_INIT_FRAMES[i].msg) shownMsgs.push({ msg: IKE_INIT_FRAMES[i].msg!, idx: i, isLive: false })
  }
  if (shownMsgs.length > 0 && frame.msg) shownMsgs[shownMsgs.length - 1].isLive = true

  const annotation = 'annotation' in text ? text.annotation : undefined

  return (
    <div className="bgp-explorer">
      <div className="bgp-section-label">{t.part1}</div>
      <div className="tcp-diagram">
        <div className="tcp-entity-row">
          <GwBox label="Peer A" ip="10.0.1.1" state={frame.stateA} />
          <GwBox label="Peer B" ip="10.0.2.1" state={frame.stateB} />
        </div>
        <div className="tcp-seq-body" ref={seqRef}>
          <div className="tcp-lifeline tcp-lifeline-l" />
          <div className="tcp-lifeline tcp-lifeline-r" />
          {shownMsgs.map(({ msg, idx, isLive }) => (
            <div key={idx} className={`tcp-pkt-row${isLive ? ' live' : ' past'}`}>
              <div
                className={`tcp-arrow ${msg.dir === 'a2b' ? 'c2s' : 's2c'}${isLive ? ' animating' : ''}`}
                style={{ '--travel': '680ms' } as React.CSSProperties}
                key={isLive ? `live-${animKey}` : `past-${idx}`}
              >
                <div className="tcp-arrow-line" />
                <div className="tcp-arrow-head" />
                <div className="tcp-arrow-label">
                  <span className={`tcp-pkt-name bgp-msg-tag ike-tag-init`}>{msg.label}</span>
                </div>
                {isLive && <div className="tcp-arrow-dot" />}
              </div>
            </div>
          ))}
          {annotation && <div className="tcp-annotation">{annotation}</div>}
          <div className="tcp-seq-pad" />
        </div>
      </div>
      <ExplorerControls ex={ex} />
      {'note' in text ? (
        <div className="tcp-detail">
          <div className="tcp-detail-top">
            <span className="bgp-msg-tag ike-tag-init">{frame.msg!.label}</span>
            <span className="bgp-dir-label">{frame.msg!.dir === 'a2b' ? 'Peer A → Peer B' : 'Peer B → Peer A'}</span>
            <span className="ike-cleartext-badge">{t.unprotected}</span>
          </div>
          <p className="tcp-detail-note">{text.note}</p>
          <span className="tcp-step-counter">{step + 1} / {IKE_INIT_FRAMES.length}</span>
        </div>
      ) : (
        <div className="tcp-detail tcp-detail-ann">
          <span>{annotation}</span>
          <span className="tcp-step-counter">{step + 1} / {IKE_INIT_FRAMES.length}</span>
        </div>
      )}
    </div>
  )
}

// ── Part 2: IKE_AUTH + Child SA ───────────────────────────────────────────────

interface IkeAuthFrame {
  msg?: IkeMsg; stateA: IkeState; stateB: IkeState
  spd: SpdEntry[]; sad: SadEntry[]
  hasAnnotation?: boolean; highlight?: 'spd' | 'sad' | 'both'
}

const FULL_SPD: SpdEntry[] = [
  { dir: 'OUT', from: '10.1.0.0/24', to: '10.2.0.0/24' },
  { dir: 'IN',  from: '10.2.0.0/24', to: '10.1.0.0/24' },
]
const FULL_SAD: SadEntry[] = [
  { spi: '0xABCD1234', dir: 'OUT', cipher: 'AES-256-GCM' },
  { spi: '0xDEF01234', dir: 'IN',  cipher: 'AES-256-GCM' },
]

const IKE_AUTH_FRAMES: IkeAuthFrame[] = [
  { stateA: 'AUTH', stateB: 'AUTH', spd: [], sad: [], hasAnnotation: true },
  { msg: { dir: 'a2b', label: 'IKE_AUTH', encrypted: true },
    stateA: 'AUTH', stateB: 'AUTH', spd: [], sad: [] },
  { msg: { dir: 'b2a', label: 'IKE_AUTH', encrypted: true },
    stateA: 'ESTABLISHED', stateB: 'ESTABLISHED', spd: FULL_SPD, sad: FULL_SAD, highlight: 'both' },
  { stateA: 'ESTABLISHED', stateB: 'ESTABLISHED', spd: FULL_SPD, sad: FULL_SAD, hasAnnotation: true },
]

function IkeAuthExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const ex = useExplorer(IKE_AUTH_FRAMES.length)
  const { step, animKey, seqRef } = ex
  const frame = IKE_AUTH_FRAMES[step]
  const text = t.ikeAuth[step]

  const shownMsgs: Array<{ msg: IkeMsg; idx: number; isLive: boolean }> = []
  for (let i = 1; i <= step; i++) {
    if (IKE_AUTH_FRAMES[i].msg) shownMsgs.push({ msg: IKE_AUTH_FRAMES[i].msg!, idx: i, isLive: false })
  }
  if (shownMsgs.length > 0 && frame.msg) shownMsgs[shownMsgs.length - 1].isLive = true

  const annotation = 'annotation' in text ? text.annotation : undefined

  return (
    <div className="bgp-explorer">
      <div className="bgp-section-label">{t.part2}</div>
      <div className="tcp-diagram">
        <div className="tcp-entity-row">
          <GwBox label="Peer A" ip="10.0.1.1" state={frame.stateA} />
          <GwBox label="Peer B" ip="10.0.2.1" state={frame.stateB} />
        </div>
        <div className="tcp-seq-body" ref={seqRef}>
          <div className="tcp-lifeline tcp-lifeline-l" />
          <div className="tcp-lifeline tcp-lifeline-r" />
          {shownMsgs.map(({ msg, idx, isLive }) => (
            <div key={idx} className={`tcp-pkt-row${isLive ? ' live' : ' past'}`}>
              <div
                className={`tcp-arrow ${msg.dir === 'a2b' ? 'c2s' : 's2c'}${isLive ? ' animating' : ''}`}
                style={{ '--travel': '680ms' } as React.CSSProperties}
                key={isLive ? `live-${animKey}` : `past-${idx}`}
              >
                <div className="tcp-arrow-line" />
                <div className="tcp-arrow-head" />
                <div className="tcp-arrow-label">
                  <span className="tcp-pkt-name bgp-msg-tag ike-tag-auth">{msg.label}</span>
                </div>
                {isLive && <div className="tcp-arrow-dot" />}
              </div>
            </div>
          ))}
          {annotation && <div className="tcp-annotation">{annotation}</div>}
          <div className="tcp-seq-pad" />
        </div>
      </div>
      <SaPanel spd={frame.spd} sad={frame.sad} highlight={frame.highlight} />
      <ExplorerControls ex={ex} />
      {'note' in text ? (
        <div className="tcp-detail">
          <div className="tcp-detail-top">
            <span className="bgp-msg-tag ike-tag-auth">{frame.msg!.label}</span>
            <span className="bgp-dir-label">{frame.msg!.dir === 'a2b' ? 'Peer A → Peer B' : 'Peer B → Peer A'}</span>
            <span className="ike-enc-badge">{t.encrypted}</span>
          </div>
          <p className="tcp-detail-note">{text.note}</p>
          <span className="tcp-step-counter">{step + 1} / {IKE_AUTH_FRAMES.length}</span>
        </div>
      ) : (
        <div className="tcp-detail tcp-detail-ann">
          <span>{annotation}</span>
          <span className="tcp-step-counter">{step + 1} / {IKE_AUTH_FRAMES.length}</span>
        </div>
      )}
    </div>
  )
}

// ── Part 3: ESP Packet Processing ─────────────────────────────────────────────

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

function EspExplorer() {
  const { lang } = useLang()
  const t = T[lang]
  const [dir, setDir] = useState<'out' | 'in'>('out')
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const frames = dir === 'out' ? t.espOut : t.espIn
  const segs = dir === 'out' ? ESP_OUT_SEGS : ESP_IN_SEGS
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
    reset: lang === 'ko' ? '초기화' : 'Reset',
    play: lang === 'ko' ? '재생' : 'Play',
    pause: lang === 'ko' ? '일시정지' : 'Pause',
    resume: lang === 'ko' ? '계속' : 'Resume',
    replay: lang === 'ko' ? '다시 보기' : 'Replay',
    step: lang === 'ko' ? '다음 →' : 'Step →',
  }

  const frame = frames[step]
  const total = frames.length

  return (
    <div className="bgp-explorer">
      <div className="bgp-section-label">{t.part3}</div>

      <div className="ipsec-dir-toggle">
        <button className={`ipsec-dir-btn${dir === 'out' ? ' active' : ''}`} onClick={() => switchDir('out')}>
          {t.outbound}
        </button>
        <button className={`ipsec-dir-btn${dir === 'in' ? ' active' : ''}`} onClick={() => switchDir('in')}>
          {t.inbound}
        </button>
      </div>

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
        <IkeInitExplorer />
        <div className="bgp-sep" />
        <IkeAuthExplorer />
        <div className="bgp-sep" />
        <EspExplorer />
      </div>
    </NoteLayout>
  )
}
