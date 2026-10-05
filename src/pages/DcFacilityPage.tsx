import { useState, useEffect, useRef } from 'react'
import NoteLayout from '../components/NoteLayout'
import { useLang } from '../App'

// ── Types ──────────────────────────────────────────────────────────────────────

type ZoneId =
  | 'roof' | 'hallB' | 'hallA' | 'crah' | 'trays' | 'row' | 'aisle' | 'rack'
  | 'mda' | 'pdu' | 'floor' | 'riser'
  | 'mmr' | 'elec' | 'ups' | 'noc'
  | 'substation' | 'gen' | 'fiber'
type ZoneStatus = 'idle' | 'active' | 'done'
type RackUnitId = 'patchF' | 'patchC' | 'cable' | 'torA' | 'torB' | 'oob' | 'servers' | 'blank' | 'pduA' | 'pduB'

interface Bi { en: string; ko: string }

interface Zone {
  id:      ZoneId
  rects:   Array<[number, number, number, number]>  // x, y, w, h in canvas units
  callout?: boolean                                   // too small for an inside label
}

interface FacFrame {
  active: ZoneId[]
  rack:   RackUnitId[]
  all?:   boolean   // final frame: every zone done
}

// ── Cutaway geometry (canvas units) ─────────────────────────────────────────────

const W = 900
const H = 520
const GROUND_Y = 446

const ZONES: Zone[] = [
  { id: 'roof',       rects: [[150, 40, 568, 50]] },
  { id: 'hallB',      rects: [[140, 95, 578, 115]] },
  { id: 'hallA',      rects: [[140, 215, 578, 135]] },
  { id: 'crah',       rects: [[148, 250, 56, 64], [660, 250, 52, 64]] },
  { id: 'trays',      rects: [[212, 240, 440, 8]], callout: true },
  { id: 'row',        rects: [[212, 252, 278, 62]], callout: true },
  { id: 'aisle',      rects: [[212, 278, 278, 10]], callout: true },
  { id: 'rack',       rects: [[218, 254, 14, 22]], callout: true },
  { id: 'mda',        rects: [[498, 252, 72, 62]] },
  { id: 'pdu',        rects: [[578, 252, 76, 62]] },
  { id: 'floor',      rects: [[140, 320, 578, 26]] },
  { id: 'riser',      rects: [[722, 95, 34, 345]] },
  { id: 'mmr',        rects: [[140, 355, 138, 85]] },
  { id: 'elec',       rects: [[283, 355, 160, 85]] },
  { id: 'ups',        rects: [[448, 355, 150, 85]] },
  { id: 'noc',        rects: [[603, 355, 115, 85]] },
  { id: 'substation', rects: [[14, 362, 112, 78]] },
  { id: 'gen',        rects: [[772, 352, 116, 88]] },
  { id: 'fiber',      rects: [[14, 456, 264, 26], [278, 488, 610, 26]] },
]

// Rack icons drawn inside the halls (decorative); the highlighted rack is its own zone.
const HALL_A_RACKS: Array<[number, number]> = [
  ...Array.from({ length: 15 }, (_, i): [number, number] => [218 + i * 18, 254]),
  ...Array.from({ length: 15 }, (_, i): [number, number] => [218 + i * 18, 290]),
].filter(([x, y]) => !(x === 218 && y === 254))
const HALL_B_RACKS: Array<[number, number]> = [
  ...Array.from({ length: 28 }, (_, i): [number, number] => [158 + i * 19, 128]),
  ...Array.from({ length: 28 }, (_, i): [number, number] => [158 + i * 19, 168]),
]

const RACK_UNITS: Array<{ id: RackUnitId; u: string }> = [
  { id: 'patchF',  u: 'U42' },
  { id: 'patchC',  u: 'U41' },
  { id: 'cable',   u: 'U40' },
  { id: 'torA',    u: 'U39' },
  { id: 'torB',    u: 'U38' },
  { id: 'oob',     u: 'U37' },
  { id: 'servers', u: 'U36–5' },
  { id: 'blank',   u: 'U4–1' },
]

// ── Frames (server outward) ─────────────────────────────────────────────────────

const FRAMES: FacFrame[] = [
  { active: [], rack: [] },
  { active: ['rack'], rack: ['servers'] },
  { active: ['rack'], rack: ['patchF', 'patchC', 'cable', 'torA', 'torB', 'oob', 'servers', 'blank', 'pduA', 'pduB'] },
  { active: ['rack'], rack: ['patchF', 'torA', 'torB'] },
  { active: ['row', 'aisle'], rack: [] },
  { active: ['hallA', 'hallB', 'floor'], rack: [] },
  { active: ['trays', 'riser', 'mda'], rack: ['patchF'] },
  { active: ['mmr', 'fiber'], rack: [] },
  { active: ['pdu', 'riser', 'ups'], rack: ['pduA', 'pduB'] },
  { active: ['elec', 'gen', 'substation'], rack: [] },
  { active: ['crah', 'floor', 'roof'], rack: ['servers', 'blank'] },
  { active: ['substation', 'fiber', 'gen'], rack: [] },
  { active: [], rack: ['patchF', 'patchC', 'cable', 'torA', 'torB', 'oob', 'servers', 'blank', 'pduA', 'pduB'], all: true },
]

// ── Reference data ──────────────────────────────────────────────────────────────

const OPTICS: Array<{ optic: string; media: Bi; reach: string; conn: string; use: Bi }> = [
  { optic: 'DAC (twinax)',         media: { en: 'Copper twinax', ko: '구리 twinax' },            reach: '≤ 3–5 m',     conn: 'Integrated', use: { en: 'Server ↔ ToR, same rack', ko: '서버 ↔ ToR, 같은 랙' } },
  { optic: 'AOC',                  media: { en: 'MMF, integrated', ko: 'MMF 일체형' },            reach: '≤ 30 m',      conn: 'Integrated', use: { en: 'Adjacent racks', ko: '인접 랙' } },
  { optic: '10G-SR (SFP+)',        media: { en: 'OM3 / OM4 MMF', ko: 'OM3 / OM4 MMF' },          reach: '300 / 400 m', conn: 'LC duplex',  use: { en: 'Legacy access', ko: '구형 액세스' } },
  { optic: '25G-SR (SFP28)',       media: { en: 'OM4 MMF', ko: 'OM4 MMF' },                      reach: '100 m',       conn: 'LC duplex',  use: { en: 'Server uplinks', ko: '서버 업링크' } },
  { optic: '100G-SR4 (QSFP28)',    media: { en: 'OM4 MMF, 8 fibers', ko: 'OM4 MMF, 8심' },        reach: '100 m',       conn: 'MPO-12',     use: { en: 'ToR ↔ spine in one hall', ko: '같은 홀 안 ToR ↔ 스파인' } },
  { optic: '100G-DR / FR (QSFP28)', media: { en: 'SMF', ko: 'SMF' },                             reach: '500 m / 2 km', conn: 'LC duplex', use: { en: 'Across halls', ko: '홀 간 연결' } },
  { optic: '100G-LR4 (QSFP28)',    media: { en: 'SMF', ko: 'SMF' },                              reach: '10 km',       conn: 'LC duplex',  use: { en: 'Campus, building to building', ko: '캠퍼스, 건물 간' } },
  { optic: '400G-DR4 (QSFP-DD)',   media: { en: 'SMF, 8 fibers', ko: 'SMF, 8심' },                reach: '500 m',       conn: 'MPO-12',     use: { en: 'Spine ↔ super-spine', ko: '스파인 ↔ 슈퍼스파인' } },
  { optic: '400G-FR4 (QSFP-DD)',   media: { en: 'SMF', ko: 'SMF' },                              reach: '2 km',        conn: 'LC duplex',  use: { en: 'Large campus fabrics', ko: '대형 캠퍼스 패브릭' } },
  { optic: '400G-ZR / ZR+',        media: { en: 'SMF, DWDM', ko: 'SMF, DWDM' },                  reach: '80–120 km+',  conn: 'LC duplex',  use: { en: 'DCI between sites', ko: '사이트 간 DCI' } },
]

const GLOSSARY: Array<{ term: string; what: Bi }> = [
  { term: 'White space (상면)', what: { en: 'Floor area where racks stand. Sold and planned by power (kW per rack, MW per hall), not just square meters.', ko: '랙이 놓이는 바닥 면적. 면적(m²)만이 아니라 전력(랙당 kW, 홀당 MW) 기준으로 계획하고 임대합니다.' } },
  { term: 'Gray space', what: { en: 'Everything that supports white space: electrical rooms, UPS, generators, chillers, MMR, NOC.', ko: '화이트 스페이스를 받치는 공간: 전기실, UPS, 발전기, 칠러, MMR, NOC.' } },
  { term: 'MMR', what: { en: 'Meet-me room: where carriers terminate fiber and customers cross-connect to them. Carrier-neutral sites host many carriers.', ko: 'Meet-me room: 통신사가 광을 종단하고 고객이 크로스커넥트하는 방. carrier-neutral 사이트에는 여러 통신사가 들어옵니다.' } },
  { term: 'MDA / HDA / EDA', what: { en: 'TIA-942 zones: main distribution (core, backbone), horizontal distribution (row), equipment distribution (the rack).', ko: 'TIA-942 구역: 메인 분배(코어, 백본), 수평 분배(열), 장비 분배(랙).' } },
  { term: 'Patch panel', what: { en: 'Fixed termination point for permanent cabling; patch cords connect it to equipment so the permanent run is never touched.', ko: '영구 배선의 고정 종단점. 패치 코드로 장비와 연결해 영구 배선은 건드리지 않습니다.' } },
  { term: 'Cross-connect vs interconnect', what: { en: 'Cross-connect: two patch panels joined by a cord (flexible). Interconnect: equipment cabled straight to one panel (cheaper, fewer loss points).', ko: '크로스커넥트: 두 패치패널을 코드로 연결(유연함). 인터커넥트: 장비를 패널 하나에 직결(저렴, 손실 지점 적음).' } },
  { term: 'Raised floor vs slab', what: { en: 'Raised floor: plenum under tiles for cold air and cabling. Modern halls often use a slab with overhead power, cabling and containment.', ko: '이중마루: 타일 아래 공간으로 찬 공기와 케이블을 보냄. 최근 홀은 슬래브 위에 전력·케이블·격리를 모두 위로 올리는 경우가 많습니다.' } },
  { term: 'Hot / cold aisle containment', what: { en: 'Racks face front-to-front; cold air enters the front, hot air leaves the back into a sealed aisle so the two never mix.', ko: '랙 전면끼리 마주 보게 배치. 찬 공기는 전면으로 들어가고, 뜨거운 공기는 후면의 밀폐된 통로로 빠져 섞이지 않습니다.' } },
  { term: 'CRAC vs CRAH', what: { en: 'CRAC has its own compressor (DX). CRAH is a fan coil fed by chilled water from a central plant — more efficient at scale.', ko: 'CRAC는 자체 압축기(DX) 방식. CRAH는 중앙 칠러의 냉수를 받는 팬 코일로, 대규모에서 더 효율적입니다.' } },
  { term: 'UPS (double conversion)', what: { en: 'AC → DC → AC with batteries or a flywheel on the DC bus; carries the load for minutes until generators take over.', ko: 'AC → DC → AC 변환, DC 버스에 배터리나 플라이휠. 발전기가 넘겨받을 때까지 몇 분간 부하를 버팁니다.' } },
  { term: 'ATS / STS', what: { en: 'Automatic transfer switch moves the load from utility to generator (seconds). Static transfer switch swaps between two sources in milliseconds.', ko: 'ATS는 부하를 수전에서 발전기로 전환(초 단위). STS는 두 전원 사이를 밀리초 단위로 전환합니다.' } },
  { term: 'PDU / RPP / rack PDU', what: { en: 'Floor PDU steps power down and splits it, remote power panels feed rows, rack PDUs (A and B) feed each server PSU.', ko: '플로어 PDU가 전압을 낮추고 분배, RPP가 열에 공급, 랙 PDU(A/B)가 서버 PSU 각각에 공급합니다.' } },
  { term: 'N+1 vs 2N', what: { en: 'N+1: one spare unit beyond what the load needs. 2N: two complete, independent systems (A and B paths).', ko: 'N+1: 필요량보다 예비 1대. 2N: 완전히 독립된 두 시스템(A/B 경로).' } },
  { term: 'PUE', what: { en: 'Total facility power ÷ IT power. 1.0 is perfect; modern hyperscale sites run ~1.1–1.2, older enterprise rooms ~1.6–2.0.', ko: '전체 시설 전력 ÷ IT 전력. 1.0이 이상적이며, 최신 하이퍼스케일은 약 1.1–1.2, 구형 기업 전산실은 1.6–2.0 수준입니다.' } },
]

const TIERS: Array<{ tier: string; avail: string; down: string; what: Bi }> = [
  { tier: 'Tier I',   avail: '99.671%', down: '28.8 h', what: { en: 'Basic capacity, single path, no redundancy', ko: '기본 용량, 단일 경로, 이중화 없음' } },
  { tier: 'Tier II',  avail: '99.741%', down: '22 h',   what: { en: 'Redundant components (N+1), single path', ko: '구성요소 이중화(N+1), 단일 경로' } },
  { tier: 'Tier III', avail: '99.982%', down: '1.6 h',  what: { en: 'Concurrently maintainable: any component can be serviced without downtime', ko: '동시 유지보수 가능: 어떤 구성요소든 중단 없이 정비 가능' } },
  { tier: 'Tier IV',  avail: '99.995%', down: '26 min', what: { en: 'Fault tolerant: 2N paths, compartmentalized, survives any single failure', ko: '무장애: 2N 경로, 구획 분리, 어떤 단일 장애에도 지속' } },
]

// ── Translations ───────────────────────────────────────────────────────────────

const T = {
  en: {
    title:    'Datacenter — from server to site',
    readTime: '10 min',
    intro:    `A datacenter is a building whose only job is to keep thousands of racks powered, cooled and connected. Everything else — the floors, the rooms, the roof, even where the building stands — exists to deliver those three things to every rack, around the clock, through any single failure. Step through a cutaway of a small three-floor facility, starting from one server and zooming out to the site.`,
    zoneLabel: {
      roof: 'Roof plant', hallB: '3F · Data hall B · white space', hallA: '2F · Data hall A · white space', crah: 'CRAH', trays: 'Overhead trays',
      row: 'Row', aisle: 'Contained aisle', rack: 'This rack', mda: 'MDA', pdu: 'PDU / RPP', floor: 'Raised floor plenum',
      riser: 'Riser', mmr: 'MMR', elec: 'Electrical room', ups: 'UPS · batteries', noc: 'NOC · dock',
      substation: 'Substation', gen: 'Generators', fiber: 'Fiber entrance',
    } as Record<ZoneId, string>,
    zoneSub: {
      roof: 'Chillers · cooling towers · dry coolers', hallB: '', hallA: '', crah: '',
      trays: '', row: '', aisle: '', rack: '', mda: '', pdu: '', floor: '',
      riser: '', mmr: 'Cross-connects', elec: 'Switchgear · ATS', ups: 'Double conversion', noc: 'Ops · shipping',
      substation: 'Dual feeds', gen: 'Diesel · fuel', fiber: 'Diverse ducts A / B',
    } as Record<ZoneId, string>,
    rackTitle: 'Rack elevation',
    rackUnit: {
      patchF: 'Fiber patch', patchC: 'Copper patch', cable: 'Cable manager', torA: 'ToR A',
      torB: 'ToR B', oob: 'OOB switch', servers: 'Servers 16 × 2U', blank: 'Blanking',
      pduA: 'PDU A', pduB: 'PDU B',
    } as Record<RackUnitId, string>,
    frames: [
      { title: 'One building, three things, every rack',
        note:  'This cutaway shows a small three-floor facility. The two top floors are white space — the data halls where racks stand. The ground floor and the yard are gray space: the meet-me room, electrical room, UPS, generators and the substation. The roof holds the cooling plant. Every room exists to deliver power, cooling and connectivity to the racks.' },
      { title: 'Server host — where the load is',
        note:  'A typical 1U/2U server draws 0.5–1 kW. It has two power supplies fed from separate A and B circuits, two 25G NIC ports to the top-of-rack switches, and a BMC port (IPMI/Redfish) on a separate out-of-band network so it can be powered on and reinstalled remotely. Fans pull cold air in the front and push hot air out the back — the whole building is laid out around that front-to-back airflow.' },
      { title: 'Rack — the unit of planning',
        note:  'A rack is 42–48U tall (1U = 44.45 mm), usually 600 mm wide and 1,000–1,200 mm deep. Patch panels and ToR switches sit at the top, servers below, blanking panels fill empty slots so hot exhaust cannot loop back to the front. Two rack PDUs (A and B) run vertically on the sides. Classic racks are 5–15 kW; AI racks are 40–130 kW and need liquid cooling. Power per rack, not floor area, decides how many racks a hall can hold.' },
      { title: 'L1 inside the rack — copper, optics, light levels',
        note:  'Servers reach the ToR over DAC (passive twinax, ≤ 3–5 m) or AOC — cheap, no optics. ToR uplinks leave the rack on pluggable optics: QSFP28 100G-SR4 over OM4 multimode with MPO connectors inside a hall, DR/FR/LR over single-mode with LC duplex for longer runs. Most "network problems" here are physical: a dirty connector, a bent fiber, a wrong optic type. Check light levels and errors with ethtool -m (DOM: Tx/Rx dBm) and ethtool -S — always clean connectors before reseating.' },
      { title: 'Row and aisle — containment',
        note:  'Racks stand in rows facing each other: fronts share a cold aisle, backs share a hot aisle. Containment (doors and a roof over one of the aisles) stops hot and cold air from mixing, which is the single biggest cooling efficiency gain. Each row has its own patch panels (end-of-row or middle-of-row) — the horizontal distribution area that fans the backbone out to every rack.' },
      { title: 'Data hall and floor space (상면)',
        note:  'White space is the sellable floor area. Colocation sells it as a single rack, a caged area, a private suite or a whole hall — but the real constraint is power: a hall is rated in MW, a rack in kW. Floors must carry 1,000–1,500 kg per rack, more for AI. Older halls use a raised floor with a cold-air plenum under perforated tiles; modern halls often sit on a concrete slab with power, cabling and cooling all overhead.' },
      { title: 'Cabling pathways — trays, risers, MDA',
        note:  'Structured cabling follows TIA-942: carriers land in the entrance room/MMR, the backbone runs to the main distribution area (core switches and patch fields), then horizontal cabling to each row and rack. Fiber rides in overhead trays (often kept separate from power), and vertical risers carry it between floors. High-count single-mode trunks with MPO connectors make each run pre-terminated and quick to install.' },
      { title: 'MMR and fiber entrance',
        note:  'Carriers bring fiber into the building through at least two physically separate underground ducts that enter on different sides — a backhoe can cut only one. In the meet-me room each carrier terminates on its own panel; a customer gets a cross-connect (a patch between their panel and the carrier\'s) after the carrier issues an LOA/CFA. A carrier-neutral building with dozens of carriers is worth more than one owned by a single telco.' },
      { title: 'Power distribution — UPS to rack PDU',
        note:  'Inside the building, power flows: switchgear → UPS → floor PDU (steps down voltage) → remote power panels per row → rack PDUs A and B. In a 2N design the A and B chains are completely independent all the way back to separate UPS systems, so each server keeps running when either side fails or is under maintenance. The UPS (batteries or flywheel) carries the full load for the 5–10 minutes it takes generators to start and stabilize.' },
      { title: 'Electrical room, generators, substation',
        note:  'The utility delivers medium voltage from a substation — ideally two feeds from different substations. Switchgear and transformers step it down. When the utility drops, the UPS holds the load, generators start in about 10–15 seconds, and the automatic transfer switch (ATS) moves the building onto them. On-site fuel lasts 24–72 hours, with refuel contracts beyond that. Generators are load-tested monthly; a generator that has never run under load is not a backup.' },
      { title: 'Cooling — from the rack to the roof',
        note:  'Almost every watt a server draws becomes heat. CRAH units in the hall blow cold air into the cold aisle (or the raised floor), take hot air back from the contained hot aisle, and pass the heat to a chilled-water loop. Chillers and cooling towers on the roof reject it outside; in cool climates free cooling uses outside air or water most of the year. PUE (facility ÷ IT power) measures the overhead — ~1.1–1.2 for modern sites. AI racks move to direct-to-chip liquid cooling.' },
      { title: 'Location — why the building is here',
        note:  'Site selection comes first, not last: available grid capacity (often the hardest constraint — new MW can take years), at least two fiber routes and carriers, low risk of flood, earthquake and wildfire, a climate that allows free cooling, water for cooling towers, latency to the users it serves, and land, tax and permitting. Hyperscalers cluster several buildings into an availability zone and several zones into a region.' },
      { title: 'Everything serves the rack',
        note:  'Put it together: A and B power from two independent chains, cold air in the front and hot air out the back, a fiber patch at the top of the rack that traces back through trays, MDA and MMR to two carriers on two separate paths. When a server boots and its link comes up, every floor of this building has done its job — and the network notes (dc-networking, Clos, ECMP) take over from the ToR upward.' },
    ],
    opticsTitle:   'Optics and cables',
    opticsHeaders: ['Optic', 'Media', 'Reach', 'Connector', 'Typical use'],
    glossTitle:    'Building blocks',
    glossHeaders:  ['Term', 'What it is'],
    tierTitle:     'Uptime Institute tiers',
    tierHeaders:   ['Tier', 'Availability', 'Downtime / year', 'What it means'],
  },
  ko: {
    title:    '데이터센터 — 서버에서 입지까지',
    readTime: '10분',
    intro:    `데이터센터는 수천 개의 랙에 전력, 냉각, 연결을 끊김 없이 공급하는 것만이 목적인 건물입니다. 층과 방, 지붕, 심지어 건물이 서 있는 위치까지 모두 이 세 가지를 모든 랙에 24시간, 어떤 단일 장애에도 공급하기 위해 존재합니다. 3층짜리 소형 시설의 단면도를 따라 서버 한 대에서 시작해 사이트까지 바깥으로 넓혀 봅니다.`,
    zoneLabel: {
      roof: '옥상 설비', hallB: '3F · 데이터 홀 B · 화이트 스페이스', hallA: '2F · 데이터 홀 A · 화이트 스페이스', crah: 'CRAH', trays: '오버헤드 트레이',
      row: '랙 열', aisle: '격리된 통로', rack: '이 랙', mda: 'MDA', pdu: 'PDU / RPP', floor: '이중마루 플레넘',
      riser: '라이저', mmr: 'MMR', elec: '전기실', ups: 'UPS · 배터리', noc: 'NOC · 도크',
      substation: '변전소', gen: '발전기', fiber: '광 인입로',
    } as Record<ZoneId, string>,
    zoneSub: {
      roof: '칠러 · 냉각탑 · 드라이쿨러', hallB: '', hallA: '', crah: '',
      trays: '', row: '', aisle: '', rack: '', mda: '', pdu: '', floor: '',
      riser: '', mmr: '크로스커넥트', elec: '스위치기어 · ATS', ups: '이중변환', noc: '운영 · 반입',
      substation: '이중 인입', gen: '디젤 · 연료', fiber: '분리된 덕트 A / B',
    } as Record<ZoneId, string>,
    rackTitle: '랙 입면도',
    rackUnit: {
      patchF: '광 패치', patchC: '구리 패치', cable: '케이블 매니저', torA: 'ToR A',
      torB: 'ToR B', oob: 'OOB 스위치', servers: '서버 16 × 2U', blank: '블랭크',
      pduA: 'PDU A', pduB: 'PDU B',
    } as Record<RackUnitId, string>,
    frames: [
      { title: '건물 하나, 세 가지, 모든 랙',
        note:  '이 단면도는 3층짜리 소형 시설입니다. 위의 두 층은 화이트 스페이스 — 랙이 놓이는 데이터 홀입니다. 1층과 마당은 그레이 스페이스: MMR, 전기실, UPS, 발전기, 변전소가 있습니다. 지붕에는 냉각 설비가 올라갑니다. 모든 방은 랙에 전력, 냉각, 연결을 공급하기 위해 존재합니다.' },
      { title: '서버 호스트 — 부하가 있는 곳',
        note:  '일반적인 1U/2U 서버는 0.5–1 kW를 씁니다. 서로 다른 A/B 회로에서 받는 전원 공급장치 2개, ToR 스위치로 가는 25G NIC 포트 2개, 그리고 별도 아웃오브밴드 망의 BMC 포트(IPMI/Redfish)가 있어 원격으로 전원을 켜고 재설치할 수 있습니다. 팬은 전면에서 찬 공기를 빨아들여 후면으로 뜨거운 공기를 내보냅니다 — 건물 전체가 이 전면→후면 기류를 중심으로 배치됩니다.' },
      { title: '랙 — 계획의 단위',
        note:  '랙은 높이 42–48U(1U = 44.45 mm), 보통 폭 600 mm, 깊이 1,000–1,200 mm입니다. 패치패널과 ToR 스위치가 위에, 서버가 아래에 들어가고, 빈 슬롯은 블랭크 패널로 막아 뜨거운 배기가 전면으로 되돌아오지 못하게 합니다. 양옆에는 랙 PDU 2개(A/B)가 세로로 달립니다. 일반 랙은 5–15 kW, AI 랙은 40–130 kW로 수냉이 필요합니다. 홀에 랙이 몇 개 들어가는지는 바닥 면적이 아니라 랙당 전력이 결정합니다.' },
      { title: '랙 안의 L1 — 구리, 광모듈, 광 레벨',
        note:  '서버는 DAC(수동 twinax, 3–5 m 이하)나 AOC로 ToR에 연결됩니다 — 광모듈이 필요 없어 저렴합니다. ToR 업링크는 플러거블 광모듈로 랙을 나갑니다: 홀 안에서는 OM4 멀티모드에 MPO 커넥터를 쓰는 QSFP28 100G-SR4, 더 먼 거리는 싱글모드 LC 듀플렉스의 DR/FR/LR. 이 계층의 "네트워크 문제" 대부분은 물리적입니다: 더러운 커넥터, 꺾인 광, 잘못된 광모듈 종류. ethtool -m(DOM: Tx/Rx dBm)과 ethtool -S로 광 레벨과 에러를 확인하고, 다시 꽂기 전에 항상 커넥터를 청소하세요.' },
      { title: '랙 열과 통로 — 격리',
        note:  '랙은 서로 마주 보는 열로 섭니다: 전면끼리 콜드 아일을, 후면끼리 핫 아일을 공유합니다. 격리(한쪽 통로에 문과 지붕을 씌움)는 뜨거운 공기와 찬 공기가 섞이지 않게 해 주는, 냉각 효율에서 가장 큰 개선입니다. 각 열에는 자체 패치패널(엔드오브로우 또는 미들오브로우)이 있습니다 — 백본을 각 랙으로 펼쳐 주는 수평 분배 구역입니다.' },
      { title: '데이터 홀과 상면',
        note:  '화이트 스페이스(상면)는 판매 가능한 바닥 면적입니다. 코로케이션은 이를 랙 단위, 케이지, 전용 스위트, 홀 전체로 판매하지만 진짜 제약은 전력입니다: 홀은 MW, 랙은 kW로 정격이 매겨집니다. 바닥은 랙당 1,000–1,500 kg을 견뎌야 하고 AI 랙은 그 이상입니다. 구형 홀은 타공 타일 아래 찬 공기 플레넘이 있는 이중마루를, 최신 홀은 흔히 콘크리트 슬래브 위에 전력·케이블·냉각을 모두 위로 올립니다.' },
      { title: '케이블 경로 — 트레이, 라이저, MDA',
        note:  '구조화 배선은 TIA-942를 따릅니다: 통신사는 인입실/MMR에 들어오고, 백본은 메인 분배 구역(코어 스위치와 패치 필드)으로, 그다음 수평 배선이 각 열과 랙으로 갑니다. 광은 오버헤드 트레이를 타고(보통 전력과 분리), 수직 라이저가 층 사이를 잇습니다. 고심수 싱글모드 트렁크에 MPO 커넥터를 쓰면 미리 종단된 상태로 빠르게 설치할 수 있습니다.' },
      { title: 'MMR과 광 인입',
        note:  '통신사는 최소 두 개의, 물리적으로 분리된 지하 덕트로 건물 서로 다른 면에 광을 들여옵니다 — 굴착기는 한쪽만 끊을 수 있습니다. Meet-me room에서 각 통신사는 자기 패널에 종단하고, 고객은 통신사가 LOA/CFA를 발급한 뒤 크로스커넥트(고객 패널과 통신사 패널 사이 패치)를 받습니다. 수십 개 통신사가 들어온 carrier-neutral 건물은 한 통신사 소유 건물보다 가치가 큽니다.' },
      { title: '전력 분배 — UPS에서 랙 PDU까지',
        note:  '건물 안에서 전력은 스위치기어 → UPS → 플로어 PDU(전압 강하) → 열마다 RPP → 랙 PDU A/B로 흐릅니다. 2N 설계에서 A와 B 체인은 서로 다른 UPS 시스템까지 완전히 독립적이라, 어느 한쪽이 고장 나거나 정비 중이어도 서버는 계속 돕니다. UPS(배터리 또는 플라이휠)는 발전기가 기동해 안정되는 5–10분 동안 전체 부하를 버팁니다.' },
      { title: '전기실, 발전기, 변전소',
        note:  '한전(유틸리티)은 변전소에서 고압으로 전력을 보냅니다 — 이상적으로는 서로 다른 변전소에서 두 회선. 스위치기어와 변압기가 전압을 낮춥니다. 수전이 끊기면 UPS가 부하를 버티는 동안 발전기가 약 10–15초 만에 기동하고, ATS가 건물을 발전기로 전환합니다. 현장 연료는 24–72시간분이고, 그 이후는 급유 계약으로 버팁니다. 발전기는 매달 부하 시험을 합니다 — 부하로 돌려 본 적 없는 발전기는 백업이 아닙니다.' },
      { title: '냉각 — 랙에서 지붕까지',
        note:  '서버가 쓰는 전력은 거의 전부 열이 됩니다. 홀의 CRAH가 콜드 아일(또는 이중마루)로 찬 공기를 불어넣고, 격리된 핫 아일에서 뜨거운 공기를 회수해 냉수 루프로 열을 넘깁니다. 지붕의 칠러와 냉각탑이 이 열을 밖으로 버립니다. 서늘한 기후에서는 외기 냉각(free cooling)으로 1년의 대부분을 외부 공기나 물로 냉각합니다. PUE(시설 전력 ÷ IT 전력)가 오버헤드를 나타내며 최신 사이트는 약 1.1–1.2입니다. AI 랙은 칩 직접 수냉(DLC)으로 넘어갑니다.' },
      { title: '입지 — 건물이 여기 있는 이유',
        note:  '입지 선정은 마지막이 아니라 가장 먼저입니다: 계통 전력 여유(가장 어려운 제약인 경우가 많고, 신규 MW 확보에 수년이 걸리기도 함), 최소 두 개의 광 경로와 통신사, 낮은 홍수·지진·산불 위험, 외기 냉각이 가능한 기후, 냉각탑용 용수, 서비스 대상 사용자까지의 지연, 그리고 부지·세금·인허가. 하이퍼스케일러는 여러 건물을 하나의 가용 영역(AZ)으로, 여러 AZ를 하나의 리전으로 묶습니다.' },
      { title: '모든 것은 랙을 위해',
        note:  '정리하면: 독립된 두 체인에서 오는 A/B 전원, 전면으로 들어오는 찬 공기와 후면으로 나가는 뜨거운 공기, 그리고 랙 상단의 광 패치가 트레이와 MDA, MMR을 거쳐 서로 다른 경로의 두 통신사까지 이어집니다. 서버가 부팅되고 링크가 올라오면 이 건물의 모든 층이 제 역할을 한 것이고, ToR부터 위쪽은 네트워크 노트(dc-networking, Clos, ECMP)가 이어받습니다.' },
    ],
    opticsTitle:   '광모듈과 케이블',
    opticsHeaders: ['광모듈', '매체', '도달거리', '커넥터', '주 용도'],
    glossTitle:    '구성요소',
    glossHeaders:  ['용어', '설명'],
    tierTitle:     'Uptime Institute 티어',
    tierHeaders:   ['티어', '가용성', '연간 다운타임', '의미'],
  },
}

// ── Cutaway ─────────────────────────────────────────────────────────────────────

const px = (v: number, total: number) => `${(v / total) * 100}%`
const CONTAINERS: ZoneId[] = ['roof', 'hallB', 'hallA']

function Cutaway({ frame, t }: { frame: FacFrame; t: typeof T['en'] }) {
  const status = (id: ZoneId): ZoneStatus =>
    frame.all ? 'done' : frame.active.includes(id) ? 'active' : 'idle'

  return (
    <div className="fac-scroll">
      <div className="fac-cut">
        <svg viewBox={`0 0 ${W} ${H}`} className="fac-cut-svg" preserveAspectRatio="none">
          {/* Building shell and ground */}
          <rect x="138" y="38" width="620" height={GROUND_Y - 38} className="fac-shell" />
          <line x1="0" y1={GROUND_Y} x2={W} y2={GROUND_Y} className="fac-ground" />
        </svg>

        {/* Containers (roof, halls) first, then rack icons, then the zones inside them */}
        {ZONES.filter(z => CONTAINERS.includes(z.id)).map(renderZone)}
        {[...HALL_A_RACKS, ...HALL_B_RACKS].map(([x, y]) => (
          <span key={`r-${x}-${y}`} className="fac-rackicon"
            style={{ left: px(x, W), top: px(y, H), width: px(14, W), height: px(22, H) }} />
        ))}
        {ZONES.filter(z => !CONTAINERS.includes(z.id)).map(renderZone)}
      </div>
    </div>
  )

  function renderZone(z: Zone) {
    const st = status(z.id)
    return z.rects.map(([x, y, w, h], i) => (
      <div key={`${z.id}-${i}`}
        className={`fac-zone fac-zone-${z.id} fac-zone-${st}${z.callout ? ' fac-zone-thin' : ''}`}
        style={{ left: px(x, W), top: px(y, H), width: px(w, W), height: px(h, H) }}
      >
        {!z.callout && i === 0 && (
          <>
            <span className="fac-zone-label">{t.zoneLabel[z.id]}</span>
            {t.zoneSub[z.id] && z.id !== 'fiber' && <span className="fac-zone-sub">{t.zoneSub[z.id]}</span>}
          </>
        )}
        {!z.callout && i > 0 && z.id === 'crah' && (
          <span className="fac-zone-label">{t.zoneLabel[z.id]}</span>
        )}
        {!z.callout && i > 0 && z.id === 'fiber' && (
          <span className="fac-zone-sub">{t.zoneSub[z.id]}</span>
        )}
        {z.callout && st === 'active' && (
          <span className="fac-callout">{t.zoneLabel[z.id]}</span>
        )}
      </div>
    ))
  }
}

function RackElevation({ frame, t }: { frame: FacFrame; t: typeof T['en'] }) {
  const on = (id: RackUnitId) => frame.rack.includes(id)
  return (
    <div className="fac-rack">
      <div className="fac-rack-title">{t.rackTitle}</div>
      <div className="fac-rack-body">
        <div className={`fac-rack-pdu${on('pduA') ? ' fac-rack-on' : ''}`}><span>{t.rackUnit.pduA}</span></div>
        <div className="fac-rack-units">
          {RACK_UNITS.map(u => (
            <div key={u.id} className={`fac-rack-u fac-rack-u-${u.id}${on(u.id) ? ' fac-rack-on' : ''}`}>
              <span className="fac-rack-unum">{u.u}</span>
              <span className="fac-rack-uname">{t.rackUnit[u.id]}</span>
            </div>
          ))}
        </div>
        <div className={`fac-rack-pdu${on('pduB') ? ' fac-rack-on' : ''}`}><span>{t.rackUnit.pduB}</span></div>
      </div>
    </div>
  )
}

// ── Explorer ───────────────────────────────────────────────────────────────────

function FacExplorer() {
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
    timerRef.current = setTimeout(() => setStep(s => s + 1), 2600)
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
      <div className="fac-stage">
        <Cutaway frame={frame} t={t} />
        <RackElevation frame={frame} t={t} />
      </div>
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

// ── Reference tables ───────────────────────────────────────────────────────────

function RefTables() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <>
      <div className="ov-proto-section">
        <div className="bgp2-section-title">{t.opticsTitle}</div>
        <table className="ov-proto-table fac-table">
          <thead><tr>{t.opticsHeaders.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {OPTICS.map(r => (
              <tr key={r.optic}>
                <td><code>{r.optic}</code></td>
                <td>{r.media[lang]}</td>
                <td><code>{r.reach}</code></td>
                <td>{r.conn}</td>
                <td>{r.use[lang]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ov-proto-section">
        <div className="bgp2-section-title">{t.glossTitle}</div>
        <table className="ov-proto-table fac-table">
          <thead><tr>{t.glossHeaders.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {GLOSSARY.map(r => (
              <tr key={r.term}>
                <td><strong>{r.term}</strong></td>
                <td>{r.what[lang]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ov-proto-section">
        <div className="bgp2-section-title">{t.tierTitle}</div>
        <table className="ov-proto-table fac-table">
          <thead><tr>{t.tierHeaders.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {TIERS.map(r => (
              <tr key={r.tier}>
                <td><strong>{r.tier}</strong></td>
                <td><code>{r.avail}</code></td>
                <td><code>{r.down}</code></td>
                <td>{r.what[lang]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DcFacilityPage() {
  const { lang } = useLang()
  const t = T[lang]
  return (
    <NoteLayout
      title={t.title}
      date="2026-10-05"
      readTime={t.readTime}
      tags={['datacenter', 'infrastructure', 'power', 'cooling', 'cabling', 'optics']}
      intro={t.intro}
    >
      <FacExplorer />
      <RefTables />
    </NoteLayout>
  )
}
