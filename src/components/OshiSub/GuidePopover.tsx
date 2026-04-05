import type { Guide } from './guides';

/** Render **bold** markers in guide text */
function renderBold(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1
      ? <strong key={i} style={{ color: 'var(--text)' }}>{part}</strong>
      : <span key={i}>{part}</span>
  );
}

export function GuidePopover({ guide }: { guide: Guide }) {
  return (
    <div style={{
      position: 'absolute', top: 4, right: 12, zIndex: 50,
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '14px 16px', width: 320,
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
        {guide.description}
      </p>

      {guide.sections.map((section, si) => (
        <div key={si} style={{ display: 'contents' }}>
          <div style={{ height: 1, background: 'var(--border)' }} />
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {section.title}
          </div>
          {section.items.map((item, ii) => (
            <div key={ii} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {item.key && (
                <kbd style={{
                  padding: '1px 6px', borderRadius: 3,
                  border: '1px solid var(--border-soft)', background: 'var(--bg-base)',
                  fontFamily: 'monospace', fontWeight: 700, fontSize: 10,
                  minWidth: 18, textAlign: 'center', flexShrink: 0,
                }}>{item.key}</kbd>
              )}
              <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {renderBold(item.text)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
