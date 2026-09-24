# Note

Interactive technical notes — each entry is a working demo you can step through packet by packet, not just prose. Covers networking and distributed-systems topics: TCP handshake, MTU/PMTUD, conntrack, IPSec, VXLAN overlays, DNS resolution, BGP propagation, Clos vs. RNG fabrics, AWS VPC packet flow, ECMP, CRDTs, retry backoff, and more. **Live:** [note.kevinprk.com](https://note.kevinprk.com)

## Getting Started

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc -b && vite build → dist/
npm run preview   # serve the production build locally
```

Static SPA — no backend. React 19 + React Router + Vite.

## Features

- **Step-through demos** — 21 notes, each an animated visualization you advance frame by frame (ARP resolution, TCP state machine, PMTUD ICMP feedback loop, ESP encap/decap, VXLAN VTEP path, BGP RIB pipeline, etc.)
- **Paths view** — three curated reading collections (Networking layer by layer, From host to internet, Datacenter networking) that order notes into a progression
- **All notes view** — full list with title/content search
- **Bilingual** — English / Korean toggle; every note title, blurb, and demo caption is translated
- **Dark mode** — manual toggle, defaults to `prefers-color-scheme`, persisted to localStorage
- **Embeddable** — `?embed=1` strips the chrome; `?theme=` / `?lang=` query params and `postMessage` (`kp-theme` / `kp-lang`) let a host page drive theme and language when a note is iframed
- **PWA** — manifest, apple-touch-icon, theme-color, standalone display
- **Deploy** — multi-stage Docker build produces a files-only artifact image (`/site`); CI pushes `krapi0314/note:<sha>` and bumps its tag in `k8s/web/deployment.yaml`, where the shared nginx serves it with SPA fallback
