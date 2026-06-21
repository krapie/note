import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'

type IkeState = 'IDLE' | 'SA_INIT' | 'AUTH' | 'ESTABLISHED'
type Dir = 'a2b' | 'b2a'

interface IkeMsg { dir: Dir; label: string; encrypted: boolean; note: string }
interface SpdEntry { dir: 'OUT' | 'IN'; from: string; to: string }
interface SadEntry { spi: string; dir: 'OUT' | 'IN'; cipher: string }
interface PktSeg { id: string; label: string; sub?: string; cls: string; grow?: boolean; hi?: boolean }

const IKE_STATE_CLS: Record<IkeState, string> = {
  IDLE: 'bgp-st-idle', SA_INIT: 'bgp-st-transit', AUTH: 'bgp-st-transit', ESTABLISHED: 'bgp-st-est',
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
  const spdHi = highlight === 'spd' || highlight === 'both'
  const sadHi = highlight === 'sad' || highlight === 'both'
  return (
    <div className="ike-db-panel">
      <div className={`ike-db-section${spdHi ? ' ike-db-active' : ''}`}>
        <div className="ike-db-head">
          <span className="ike-db-title">SPD</span>
          <span className="ike-db-sub">Security Policy Database · what to do with traffic</span>
        </div>
        <div className="ike-db-body">
          {spd.length === 0 ? <span className="bgp-rib-empty">empty</span> : spd.map((e, i) => (
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
          <span className="ike-db-sub">Security Association Database · how to protect it</span>
        </div>
        <div className="ike-db-body">
          {sad.length === 0 ? <span className="bgp-rib-empty">empty</span> : sad.map((e, i) => (
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
  return (
    <>
      <div className="tcp-controls">
        <button className="btn-secondary" onClick={reset}>Reset</button>
        <button className="btn-primary" onClick={handlePlay}>
          {playing ? 'Pause' : isLast ? 'Replay' : step === 0 ? 'Play' : 'Resume'}
        </button>
        <button className="btn-secondary" onClick={stepFwd} disabled={playing || isLast}>Step →</button>
      </div>
      <div className="tcp-progress">
        <div className="tcp-progress-fill" style={{ width: `${(step / (length - 1)) * 100}%` }} />
      </div>
    </>
  )
}

// ── Part 1: IKE_SA_INIT ───────────────────────────────────────────────────────

interface IkeInitFrame { msg?: IkeMsg; stateA: IkeState; stateB: IkeState; annotation?: string }

const IKE_INIT_FRAMES: IkeInitFrame[] = [
  { stateA: 'IDLE', stateB: 'IDLE',
    annotation: 'IKEv2 negotiation starts over UDP:500. Peer A (10.0.1.1) initiates to Peer B (10.0.2.1). All IKE_SA_INIT messages are unprotected — no keys exist yet.' },
  { msg: { dir: 'a2b', label: 'IKE_SA_INIT', encrypted: false,
      note: 'Peer A sends IKE_SA_INIT: SAi1 (proposed algorithms — AES-256-GCM, PRF-HMAC-SHA-256, DH group 14), KEi (Diffie-Hellman public value g^a mod p), Ni (random 256-bit nonce). This message is in the clear — an observer can see the proposed ciphers and DH value, but cannot derive the session key from g^a alone.' },
    stateA: 'SA_INIT', stateB: 'IDLE' },
  { msg: { dir: 'b2a', label: 'IKE_SA_INIT', encrypted: false,
      note: 'Peer B responds: SAr1 (selected algorithm — AES-256-GCM), KEr (its own DH value g^b mod p), Nr (nonce). Both peers now have everything needed to compute the shared secret: g^ab = (g^b)^a = (g^a)^b mod p. Neither side ever transmits the shared secret.' },
    stateA: 'SA_INIT', stateB: 'SA_INIT' },
  { stateA: 'AUTH', stateB: 'AUTH',
    annotation: 'Both peers compute g^ab (DH shared secret). SKEYSEED = PRF(Ni | Nr, g^ab). Five key pairs derived: SK_d (for Child SA keying material), SK_ai + SK_ar (IKE integrity keys), SK_ei + SK_er (IKE encryption keys). All subsequent messages are encrypted and integrity-protected.' },
]

function IkeInitExplorer() {
  const ex = useExplorer(IKE_INIT_FRAMES.length)
  const { step, animKey, seqRef } = ex
  const frame = IKE_INIT_FRAMES[step]

  const shownMsgs: Array<{ msg: IkeMsg; idx: number; isLive: boolean }> = []
  for (let i = 1; i <= step; i++) {
    if (IKE_INIT_FRAMES[i].msg) shownMsgs.push({ msg: IKE_INIT_FRAMES[i].msg!, idx: i, isLive: false })
  }
  if (shownMsgs.length > 0 && frame.msg) shownMsgs[shownMsgs.length - 1].isLive = true

  return (
    <div className="bgp-explorer">
      <div className="bgp-section-label">Part 1 — IKE_SA_INIT (Key Exchange)</div>
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
          {frame.annotation && <div className="tcp-annotation">{frame.annotation}</div>}
          <div className="tcp-seq-pad" />
        </div>
      </div>
      <ExplorerControls ex={ex} />
      {frame.msg ? (
        <div className="tcp-detail">
          <div className="tcp-detail-top">
            <span className="bgp-msg-tag ike-tag-init">{frame.msg.label}</span>
            <span className="bgp-dir-label">{frame.msg.dir === 'a2b' ? 'Peer A → Peer B' : 'Peer B → Peer A'}</span>
            <span className="ike-cleartext-badge">unprotected</span>
          </div>
          <p className="tcp-detail-note">{frame.msg.note}</p>
          <span className="tcp-step-counter">{step + 1} / {IKE_INIT_FRAMES.length}</span>
        </div>
      ) : (
        <div className="tcp-detail tcp-detail-ann">
          <span>{frame.annotation}</span>
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
  annotation?: string; highlight?: 'spd' | 'sad' | 'both'
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
  { stateA: 'AUTH', stateB: 'AUTH', spd: [], sad: [],
    annotation: 'IKE SA keys active (SK_ei/SK_er for encryption, SK_ai/SK_ar for integrity). IKE_AUTH exchange begins — both messages are encrypted and authenticated.' },
  { msg: { dir: 'a2b', label: 'IKE_AUTH', encrypted: true,
      note: 'Peer A sends IKE_AUTH (encrypted with SK_ei, integrity with SK_ai): IDi (identity — IP or FQDN), AUTH (proof of key possession — HMAC over nonces + ID using the PSK, or a certificate signature), SAi2 (Child SA proposals: AES-256-GCM), TSi (traffic selector: 10.1.0.0/24), TSr (traffic selector: 10.2.0.0/24). Peer B must verify AUTH before proceeding.' },
    stateA: 'AUTH', stateB: 'AUTH', spd: [], sad: [] },
  { msg: { dir: 'b2a', label: 'IKE_AUTH', encrypted: true,
      note: 'Peer B verifies Peer A\'s AUTH, then responds: IDr, AUTH (its own proof), SAr2 (accepted Child SA cipher), TSi + TSr (confirmed selectors), and allocates two SPIs — one for each direction. Both peers derive Child SA keys from SK_d + nonces. IKE SA and Child SA are both now active.' },
    stateA: 'ESTABLISHED', stateB: 'ESTABLISHED', spd: FULL_SPD, sad: FULL_SAD, highlight: 'both' },
  { stateA: 'ESTABLISHED', stateB: 'ESTABLISHED', spd: FULL_SPD, sad: FULL_SAD,
    annotation: 'IPSec tunnel established. SPD maps 10.1.0.0/24 ↔ 10.2.0.0/24 to PROTECT. SAD holds two unidirectional SAs (one per direction), each with a unique SPI, cipher key, and sequence counter.' },
]

function IkeAuthExplorer() {
  const ex = useExplorer(IKE_AUTH_FRAMES.length)
  const { step, animKey, seqRef } = ex
  const frame = IKE_AUTH_FRAMES[step]

  const shownMsgs: Array<{ msg: IkeMsg; idx: number; isLive: boolean }> = []
  for (let i = 1; i <= step; i++) {
    if (IKE_AUTH_FRAMES[i].msg) shownMsgs.push({ msg: IKE_AUTH_FRAMES[i].msg!, idx: i, isLive: false })
  }
  if (shownMsgs.length > 0 && frame.msg) shownMsgs[shownMsgs.length - 1].isLive = true

  return (
    <div className="bgp-explorer">
      <div className="bgp-section-label">Part 2 — IKE_AUTH & Child SA (IPSec SA)</div>
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
          {frame.annotation && <div className="tcp-annotation">{frame.annotation}</div>}
          <div className="tcp-seq-pad" />
        </div>
      </div>
      <SaPanel spd={frame.spd} sad={frame.sad} highlight={frame.highlight} />
      <ExplorerControls ex={ex} />
      {frame.msg ? (
        <div className="tcp-detail">
          <div className="tcp-detail-top">
            <span className="bgp-msg-tag ike-tag-auth">{frame.msg.label}</span>
            <span className="bgp-dir-label">{frame.msg.dir === 'a2b' ? 'Peer A → Peer B' : 'Peer B → Peer A'}</span>
            <span className="ike-enc-badge">encrypted</span>
          </div>
          <p className="tcp-detail-note">{frame.msg.note}</p>
          <span className="tcp-step-counter">{step + 1} / {IKE_AUTH_FRAMES.length}</span>
        </div>
      ) : (
        <div className="tcp-detail tcp-detail-ann">
          <span>{frame.annotation}</span>
          <span className="tcp-step-counter">{step + 1} / {IKE_AUTH_FRAMES.length}</span>
        </div>
      )}
    </div>
  )
}

// ── Part 3: ESP Packet Processing ─────────────────────────────────────────────

interface EspFrame { title: string; segs: PktSeg[]; note: string }

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

const ESP_OUT_FRAMES: EspFrame[] = [
  { title: 'Original packet',
    segs: [S.innerIp, S.payload],
    note: 'Packet originates from 10.1.0.100 destined for 10.2.0.100. Before leaving the host, the IPSec subsystem intercepts it for SPD lookup.' },
  { title: 'SPD + SAD lookup',
    segs: [S.innerIp, S.payload],
    note: 'SPD lookup: (src=10.1.0.100, dst=10.2.0.100) matches selector 10.1.0.0/24 → 10.2.0.0/24. Action: PROTECT. SAD lookup: outbound SA — SPI=0xABCD1234, cipher=AES-256-GCM, current seq=41.' },
  { title: 'Prepend ESP header',
    segs: [S.espHdr, S.innerIp, S.payload],
    note: 'ESP header (8B) prepended: SPI (4B) — identifies the SA on the receiver\'s SAD. Sequence Number (4B, here: 42) — increments monotonically per packet, never wraps (a new SA is created before rollover). Receiver uses seq for anti-replay detection.' },
  { title: 'Prepend IV',
    segs: [S.espHdr, S.iv, S.innerIp, S.payload],
    note: '12-byte IV (nonce) for AES-256-GCM prepended. Must be unique per key per packet. Common scheme: 4B fixed (from SA negotiation) || 8B per-packet counter. Uniqueness is critical — reusing a nonce with GCM completely destroys confidentiality and authenticity.' },
  { title: 'Encrypt',
    segs: [S.espHdr, S.iv, S.encrypted],
    note: 'AES-256-GCM encrypts: [Inner IP | Payload | Padding (align to 4B) | PadLen(1B) | NextHdr(1B)]. The inner IP header IS encrypted — src/dst of the original traffic are hidden from any network observer. GCM is AEAD: encryption and authentication happen in one pass.' },
  { title: 'Append GCM tag',
    segs: [S.espHdr, S.iv, S.encrypted, S.gcmTag],
    note: '16-byte GCM authentication tag appended. Covers: ESP header (SPI+seq, used as AAD — authenticated but not encrypted) + IV + ciphertext. The receiver verifies this tag BEFORE attempting decryption. Any single bit flip in the packet causes silent rejection.' },
  { title: 'Prepend outer IP header',
    segs: [S.outerIp, S.espHdr, S.iv, S.encrypted, S.gcmTag],
    note: 'Outer IP header (20B): src=10.0.1.1, dst=10.0.2.1, Protocol=50 (ESP). This is the tunnel header — what the internet actually routes. Total ESP overhead ≈ 56B. If the inner packet is already 1500B, the outer packet exceeds typical MTU; PMTUD or MSS clamping at the gateway handles this.' },
  { title: 'On the wire',
    segs: [S.outerIp, S.espHdr, S.iv, S.encrypted, S.gcmTag],
    note: 'Transmitted. Any eavesdropper sees: outer IP (10.0.1.1 → 10.0.2.1), Protocol=50. Inner src/dst, port numbers, payload — completely opaque. IKEv2 with PFS (Perfect Forward Secrecy via fresh DH each rekey) ensures that compromising current keys does not expose past sessions.' },
]

const ESP_IN_FRAMES: EspFrame[] = [
  { title: 'Received on wire',
    segs: [S.outerIp, S.espHdr, S.iv, S.encrypted, S.gcmTag],
    note: 'Packet arrives: src=10.0.2.1, dst=10.0.1.1, Protocol=50 (ESP). Kernel identifies protocol 50 and hands the packet to the IPSec subsystem for inbound processing.' },
  { title: 'SPI lookup → anti-replay',
    segs: [S.outerIp, S.espHdrHi, S.iv, S.encrypted, S.gcmTag],
    note: 'Extract SPI=0xABCD1234 from ESP header. SAD lookup: (SPI=0xABCD1234, dst=10.0.1.1, proto=ESP) → found inbound SA. Check seq=42 against the anti-replay window (64-bit sliding bitmap). Seq 42 not yet seen → OK. Duplicate or out-of-window packets are dropped without notification.' },
  { title: 'Verify GCM tag',
    segs: [S.outerIp, S.espHdr, S.iv, S.encrypted, S.gcmTagHi],
    note: 'Verify GCM auth tag over (SPI+seq [AAD] + IV + ciphertext). Verification uses the SA\'s inbound auth key. If the tag does not match: packet silently dropped. No ICMP error, no log by default — this prevents an attacker from probing the tunnel or learning anything from the gateway\'s response.' },
  { title: 'Decrypt',
    segs: [S.outerIp, S.espHdr, S.iv, S.innerIp, S.payload],
    note: 'AES-256-GCM decryption with the inbound SA key and the received IV. Inner IP header and payload are restored. The padding, PadLen, and NextHdr bytes at the end of the plaintext are stripped.' },
  { title: 'Deliver inner packet',
    segs: [S.innerIp, S.payload],
    note: 'Outer IP header, ESP header, and IV stripped. Inner packet delivered to the IP stack: src=10.2.0.100, dst=10.1.0.100. The kernel routes it normally — forwarded to the 10.1.0.0/24 subnet or consumed by a local socket. From the application\'s perspective, this packet looks identical to an unencrypted one.' },
]

function EspExplorer() {
  const [dir, setDir] = useState<'out' | 'in'>('out')
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const isLast = step >= (dir === 'out' ? ESP_OUT_FRAMES : ESP_IN_FRAMES).length - 1

  useEffect(() => {
    if (!playing) return
    if (isLast) { setPlaying(false); return }
    const t = setTimeout(() => setStep(s => s + 1), 950)
    return () => clearTimeout(t)
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

  const frames = dir === 'out' ? ESP_OUT_FRAMES : ESP_IN_FRAMES
  const frame = frames[step]
  const total = frames.length

  return (
    <div className="bgp-explorer">
      <div className="bgp-section-label">Part 3 — ESP Tunnel Mode Packet Processing</div>

      <div className="ipsec-dir-toggle">
        <button className={`ipsec-dir-btn${dir === 'out' ? ' active' : ''}`} onClick={() => switchDir('out')}>
          Outbound ↗
        </button>
        <button className={`ipsec-dir-btn${dir === 'in' ? ' active' : ''}`} onClick={() => switchDir('in')}>
          Inbound ↙
        </button>
      </div>

      <PacketFrameView segs={frame.segs} title={frame.title} />

      <div className="tcp-controls">
        <button className="btn-secondary" onClick={reset}>Reset</button>
        <button className="btn-primary" onClick={handlePlay}>
          {playing ? 'Pause' : isLast ? 'Replay' : step === 0 ? 'Play' : 'Resume'}
        </button>
        <button className="btn-secondary" onClick={stepFwd} disabled={playing || isLast}>Step →</button>
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
  return (
    <NoteLayout
      title="IPSec: IKEv2 negotiation and ESP tunnel"
      date="2026-06-21"
      readTime="8 min"
      tags={['networking', 'ipsec', 'security', 'vpn']}
      intro="How two gateways negotiate a secure tunnel via IKEv2 — key exchange, authentication, SA creation — then how every packet is ESP-encapsulated on the wire. Three interactive walkthroughs: IKE_SA_INIT (DH key exchange), IKE_AUTH + SPD/SAD setup, and step-by-step ESP packet transformation."
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
