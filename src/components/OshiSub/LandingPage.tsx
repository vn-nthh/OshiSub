// LandingPage.tsx — Splash screen shown on first load and when clicking logo

interface LandingPageProps {
  onStart: () => void;
  onGuide: () => void;
}

export function LandingPage({ onStart, onGuide }: LandingPageProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      width: '100%', height: '100vh', background: 'var(--bg-base)',
      gap: 32,
    }}>
      {/* Logo */}
      <img src="/catt_logo_white.png" alt="OshiSub" style={{ width: 64, height: 64, opacity: 0.9 }} />

      {/* Title */}
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', margin: 0, letterSpacing: '-0.02em' }}>
          OshiSub
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
          A{' '}
          <a
            href="https://cattbycatt.netlify.app/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)', textDecoration: 'underline' }}
          >CATT-class</a>
          {' '}subtitling app.
        </p>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          className="btn btn-primary"
          style={{ padding: '10px 32px', fontSize: 13, fontWeight: 600 }}
          onClick={onStart}
        >
          Start
        </button>
        <button
          className="btn btn-ghost"
          style={{ padding: '10px 32px', fontSize: 13, fontWeight: 600, border: '1px solid var(--border)' }}
          onClick={onGuide}
        >
          Guide
        </button>
      </div>

      {/* Footer */}
      <span style={{ fontSize: 10, color: 'var(--text-dim)', position: 'absolute', bottom: 16 }}>
        made by catt
      </span>
    </div>
  );
}
