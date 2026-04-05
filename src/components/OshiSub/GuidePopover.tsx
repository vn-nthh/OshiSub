import type { Guide } from './guides';

/** Render **bold** and [text](url) in guide text */
function renderRichText(text: string) {
  // Split on **bold** and [link](url) patterns
  const parts = text.split(/(\*\*.*?\*\*|\[.*?\]\(.*?\))/g);
  return parts.map((part, i) => {
    const boldMatch = part.match(/^\*\*(.*?)\*\*$/);
    if (boldMatch) return <strong key={i} style={{ color: 'var(--text)' }}>{boldMatch[1]}</strong>;
    const linkMatch = part.match(/^\[(.*?)\]\((.*?)\)$/);
    if (linkMatch) return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{linkMatch[1]}</a>;
    return <span key={i}>{part}</span>;
  });
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
              {item.key && (() => {
                const keys = Array.isArray(item.key) ? item.key : [item.key];
                const kbdStyle = {
                  padding: '1px 6px', borderRadius: 3,
                  border: '1px solid var(--border-soft)', background: 'var(--bg-base)',
                  fontFamily: 'monospace', fontWeight: 700, fontSize: 10,
                  minWidth: 18, textAlign: 'center' as const, flexShrink: 0,
                };
                return (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                    {keys.map((k, ki) => (
                      <span key={ki} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        {ki > 0 && <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>+</span>}
                        <kbd style={kbdStyle}>{k}</kbd>
                      </span>
                    ))}
                  </span>
                );
              })()}
              <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {renderRichText(item.text)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
