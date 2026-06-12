import { ReactNode } from 'react'
import Header from './Header'
import Footer from './Footer'

interface NoteLayoutProps {
  title: string
  date: string
  readTime: string
  tags: string[]
  intro: string
  children: ReactNode
}

export default function NoteLayout({ title, date, readTime, tags, intro, children }: NoteLayoutProps) {
  return (
    <div className="app">
      <Header backLabel="notes" backHref="/" title={title} />
      <main className="note-page">
        <div className="note-page-header">
          <h1 className="note-page-title">{title}</h1>
          <div className="note-page-meta">
            <span>{date}</span>
            <span>{readTime} read</span>
            <div className="note-page-tags">
              {tags.map(t => (
                <span key={t} className="note-tag">{t}</span>
              ))}
            </div>
          </div>
          <p className="note-page-intro">{intro}</p>
        </div>
        {children}
      </main>
      <Footer />
    </div>
  )
}
