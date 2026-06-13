import { Link } from 'react-router-dom'
import Header from '../components/Header'
import Footer from '../components/Footer'

const NOTES = [
  {
    id: 'tcp',
    title: 'All about TCP',
    date: '2026-06-13',
    read: '4 min',
    tags: ['networking', 'tcp'],
    blurb: 'What SYN, SYN-ACK, and ACK actually do — stepped through, packet by packet. Includes teardown, data transfer, state machine, and MTU/MSS.',
  },
  {
    id: 'vpc',
    title: 'VPC packet flow',
    date: '2026-06-01',
    read: '5 min',
    tags: ['aws', 'networking', 'vpc'],
    blurb: 'How packets move inside AWS VPC — Nitro cards, Mapping Service, Hyperplane, and Blackfoot edge. Three scenarios: VM→VM, VM→Internet, VM→NLB.',
  },
  {
    id: 'clos',
    title: 'Clos vs. RNG topology',
    date: '2026-04-10',
    read: '6 min',
    tags: ['networking', 'datacenter'],
    blurb: 'How AWS replaced hierarchical fat-tree (Clos) data center networks with a flat quasi-random topology — fewer routers, more paths, less power.',
  },
]

export default function IndexPage() {
  return (
    <div className="app">
      <Header />
      <main className="kp-main">
        <div className="note-index-intro">
          <h1 className="note-index-title">Note</h1>
          <p className="note-index-sub">
            Interactive technical notes — each one is a working demo you can step through, not just text.
          </p>
        </div>
        <div className="note-list">
          {NOTES.map(note => (
            <Link key={note.id} to={`/${note.id}`} className="note-row">
              <div className="note-row-main">
                <div className="note-row-title">{note.title}</div>
                <div className="note-row-blurb">{note.blurb}</div>
                <div className="note-row-tags">
                  {note.tags.map(t => (
                    <span key={t} className="note-tag">{t}</span>
                  ))}
                </div>
              </div>
              <div className="note-row-meta">
                <span>{note.date}</span>
                <span>{note.read}</span>
              </div>
            </Link>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  )
}
