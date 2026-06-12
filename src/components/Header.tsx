import { useTheme } from '../App'

interface HeaderProps {
  backLabel?: string
  backHref?: string
  title?: string
}

export default function Header({ backLabel, backHref, title }: HeaderProps) {
  const { theme, toggle } = useTheme()

  return (
    <header className="kp-header">
      <div className="kp-header-inner">
        {backLabel && backHref ? (
          <>
            <a href={backHref} className="kp-back-link">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
              </svg>
              {backLabel}
            </a>
            {title && (
              <>
                <div className="kp-header-divider" />
                <span className="kp-header-title">{title}</span>
              </>
            )}
          </>
        ) : (
          <a href="https://kevinprk.com" className="kp-brand">
            <span className="kp-pi-mark">π</span>
            <span className="kp-brand-name">notes · kevinprk</span>
          </a>
        )}
        <div className="kp-header-spacer" />
        <button className="kp-theme-toggle" onClick={toggle} aria-label="toggle theme">
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="4"/>
              <path strokeLinecap="round" d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.06 1.06M17.34 17.34l1.06 1.06M5.6 18.4l1.06-1.06M17.34 6.66l1.06-1.06"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/>
            </svg>
          )}
        </button>
      </div>
    </header>
  )
}
