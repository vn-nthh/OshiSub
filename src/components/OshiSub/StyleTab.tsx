import { useState, useRef } from 'react';
import type { AppState, PatchFn, SubtitleStyle } from '@/types';
import { ResizeHandle } from './ResizeHandle';

interface StyleTabProps {
  state: AppState;
  patch: PatchFn;
}

const FONT_FAMILIES = ['Arial', 'Arial Black', 'Impact', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New'];

const POSITIONS: { label: string; value: SubtitleStyle['position'] }[] = [
  { label: 'Bottom', value: 'bottom' },
  { label: 'Top', value: 'top' },
];

export function StyleTab({ state, patch }: StyleTabProps) {
  const style = state.subtitleStyle;
  const [previewText, setPreviewText] = useState('This is a preview subtitle line.');
  const splitRef = useRef<HTMLDivElement>(null);
  const [leftW, setLeftW] = useState<number | null>(null);

  const hasChunks = state.chunks.length > 0;

  const patchStyle = (updates: Partial<SubtitleStyle>) => {
    patch({ subtitleStyle: { ...style, ...updates } });
  };

  // Generate ASS style string for display
  const boldVal = style.bold ? -1 : 0;
  const italicVal = style.italic ? -1 : 0;
  const hexToASS = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `&H00${b.toString(16).padStart(2, '0').toUpperCase()}${g.toString(16).padStart(2, '0').toUpperCase()}${r.toString(16).padStart(2, '0').toUpperCase()}`;
  };

  const alignment = style.position === 'bottom' ? 2 : 8;

  const assStyleLine = `Style: Default,${style.fontFamily},${style.fontSize},${hexToASS(style.color)},&H000000FF,${hexToASS(style.outlineColor)},&H80000000,${boldVal},${italicVal},0,0,100,100,0,0,1,2.5,1.5,${alignment},10,10,${style.marginV},1`;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div ref={splitRef} style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left: controls */}
        <div style={{ width: leftW ?? 280, flexShrink: 0, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

          <div style={{
            fontSize: 11, lineHeight: 1.6, color: 'var(--text-muted)',
            fontStyle: 'italic', padding: '10px 12px',
            background: 'var(--bg-active)', borderRadius: 6,
            border: '1px solid var(--border)',
          }}>
            "Under construction. Might not function properly."
          </div>

          {/* Font */}
          <Section label="Font">
            <label className="form-label" style={{ display: 'block', marginBottom: 4 }}>Family</label>
            <select value={style.fontFamily} onChange={(e) => patchStyle({ fontFamily: e.target.value })}>
              {FONT_FAMILIES.map((f) => <option key={f}>{f}</option>)}
            </select>

            <div style={{ marginTop: 10 }}>
              <label className="form-label" style={{ display: 'block', marginBottom: 4 }}>Size: {style.fontSize}px</label>
              <input
                type="range" min={20} max={100} value={style.fontSize}
                onChange={(e) => patchStyle({ fontSize: parseInt(e.target.value, 10) })}
                style={{ width: '100%', accentColor: 'var(--accent)' }}
              />
            </div>

            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <ToggleBtn active={style.bold} onClick={() => patchStyle({ bold: !style.bold })} label="B" style={{ fontWeight: 700 }} />
              <ToggleBtn active={style.italic} onClick={() => patchStyle({ italic: !style.italic })} label="I" style={{ fontStyle: 'italic' }} />
            </div>
          </Section>

          {/* Color */}
          <Section label="Color">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ColorRow label="Text" value={style.color} onChange={(v) => patchStyle({ color: v })} />
              <ColorRow label="Outline" value={style.outlineColor} onChange={(v) => patchStyle({ outlineColor: v })} />
            </div>
          </Section>

          {/* Position */}
          <Section label="Position">
            <div style={{ display: 'flex', gap: 6 }}>
              {POSITIONS.map((p) => (
                <button
                  key={p.value}
                  className={`btn${style.position === p.value ? ' btn-primary' : ' btn-ghost'}`}
                  style={{ flex: 1 }}
                  onClick={() => patchStyle({ position: p.value })}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <label className="form-label" style={{ display: 'block', marginBottom: 4 }}>Margin: {style.marginV}px</label>
              <input
                type="range" min={0} max={150} value={style.marginV}
                onChange={(e) => patchStyle({ marginV: parseInt(e.target.value, 10) })}
                style={{ width: '100%', accentColor: 'var(--accent)' }}
              />
            </div>
          </Section>
        </div>

        <ResizeHandle onResize={(d) => setLeftW(prev => {
          const cw = splitRef.current?.clientWidth ?? 800;
          const cur = prev ?? 280;
          return Math.max(200, Math.min(cur + d, cw - 300));
        })} />

        {/* Right: preview */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Video-like preview */}
          <div style={{ flex: 1, position: 'relative', background: '#111', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden' }}>
            {/* Faux video frame */}
            <div style={{
              position: 'absolute', inset: 0,
              backgroundImage: 'repeating-linear-gradient(45deg, #1a1a1a 0, #1a1a1a 1px, transparent 0, transparent 50%)',
              backgroundSize: '20px 20px',
              opacity: 0.5,
            }} />

            {/* Preview caption */}
            <div style={{
              position: 'absolute',
              bottom: style.position === 'bottom' ? style.marginV : 'auto',
              top: style.position === 'top' ? style.marginV : 'auto',
              left: '10%', right: '10%',
              textAlign: 'center',
              fontFamily: style.fontFamily,
              fontSize: Math.round(style.fontSize * 0.6), // scale to preview box
              fontWeight: style.bold ? 700 : 400,
              fontStyle: style.italic ? 'italic' : 'normal',
              color: style.color,
              textShadow: `2px 2px 0 ${style.outlineColor}, -2px -2px 0 ${style.outlineColor}, 2px -2px 0 ${style.outlineColor}, -2px 2px 0 ${style.outlineColor}`,
              lineHeight: 1.3,
              pointerEvents: 'none',
            }}>
              {previewText}
            </div>
          </div>

          {/* Preview text input */}
          <div style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="form-label" style={{ flexShrink: 0 }}>Preview text:</span>
            <input
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>

          {/* ASS style string */}
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
            <div className="panel-label" style={{ marginBottom: 6 }}>ASS Style Line</div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, color: 'var(--text-muted)', wordBreak: 'break-all', lineHeight: 1.6, background: 'var(--bg-input)', padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)' }}>
              {assStyleLine}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="panel-label">{label}</div>
      {children}
    </div>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <label className="form-label" style={{ width: 50 }}>{label}</label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 36, height: 28, padding: 2, borderRadius: 4, border: '1px solid var(--border-soft)', background: 'var(--bg-input)', cursor: 'pointer', flex: 'none' }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) onChange(e.target.value); }}
        style={{ width: 80, fontFamily: 'monospace', fontSize: 11 }}
      />
    </div>
  );
}

function ToggleBtn({ active, onClick, label, style: extraStyle }: {
  active: boolean; onClick: () => void; label: string; style?: React.CSSProperties;
}) {
  return (
    <button
      className={`btn${active ? ' btn-primary' : ' btn-ghost'}`}
      style={{ width: 36, height: 32, padding: 0, ...extraStyle }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
