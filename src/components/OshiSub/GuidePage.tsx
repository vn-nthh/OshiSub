// GuidePage.tsx — Full guide explaining OshiSub's workflow

interface GuidePageProps {
  onBack: () => void;
  onStart: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {title}
      </h2>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {keys.map((k, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {i > 0 && <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>+</span>}
          <kbd style={{
            padding: '1px 6px', borderRadius: 3,
            border: '1px solid var(--border-soft)', background: 'var(--bg-base)',
            fontFamily: 'monospace', fontWeight: 700, fontSize: 10,
          }}>{k}</kbd>
        </span>
      ))}
    </span>
  );
}

export function GuidePage({ onBack, onStart }: GuidePageProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      width: '100%', height: '100vh', background: 'var(--bg-base)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 11, padding: '4px 12px' }}
          onClick={onBack}
        >← Back</button>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>OshiSub Guide</span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Overview */}
        <Section title="What is OshiSub?">
          <p style={{ margin: 0 }}>
            OshiSub is a browser-based subtitling tool. It takes a video, generates captions using AI
            (either locally on your GPU or through a free cloud API), and lets you translate, edit, and
            export subtitles — all without installing anything.
          </p>
        </Section>

        <div style={{ height: 1, background: 'var(--border)' }} />

        {/* Workflow */}
        <Section title="Workflow">
          <p style={{ margin: 0 }}>The tabs across the top follow a left-to-right workflow:</p>
          <p style={{ margin: 0 }}><strong style={{ color: 'var(--text)' }}>Import</strong> → <strong style={{ color: 'var(--text)' }}>Cut</strong> → <strong style={{ color: 'var(--text)' }}>Transcribe</strong> → <strong style={{ color: 'var(--text)' }}>Translate</strong> → <strong style={{ color: 'var(--text)' }}>Style</strong> → <strong style={{ color: 'var(--text)' }}>Export</strong></p>
          <p style={{ margin: 0 }}>You can skip any step — for example, if you don't need cuts, go straight to Transcribe.</p>
        </Section>

        <div style={{ height: 1, background: 'var(--border)' }} />

        {/* Import */}
        <Section title="Import">
          <p style={{ margin: 0 }}>
            Drop or select a video file. Everything runs in your browser — the file never leaves your machine.
            Audio is extracted using FFmpeg WebAssembly for processing.
          </p>
        </Section>

        <div style={{ height: 1, background: 'var(--border)' }} />

        {/* Cut */}
        <Section title="Cut">
          <p style={{ margin: 0 }}>
            Trim long recordings (like streams) into shorter clips. Only the clipped regions will be transcribed.
            If you skip this step, the entire video is used.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            <div><Keys keys={['I']} /> — set in point</div>
            <div><Keys keys={['O']} /> — set out point</div>
            <div>Click the timeline to move the playhead</div>
            <div>Double-click a clip to select it for editing</div>
            <div>Middle-click drag to pan the timeline</div>
            <div>Scroll to zoom</div>
            <div>Edit a clip's timestamps directly for precise control</div>
          </div>
        </Section>

        <div style={{ height: 1, background: 'var(--border)' }} />

        {/* Transcribe */}
        <Section title="Transcribe">
          <p style={{ margin: 0 }}>Generates captions from audio. Two engine options:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, paddingLeft: 8 }}>
            <div><strong style={{ color: 'var(--text)' }}>WebGPU</strong> — runs entirely on your machine using your GPU. No data sent anywhere.</div>
            <div><strong style={{ color: 'var(--text)' }}>Groq</strong> — free cloud API with rate limits. Go to{' '}
              <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'underline' }}>console.groq.com</a>
              , create an account, and copy your API key. No credit card needed.</div>
          </div>
          <p style={{ margin: 0, marginTop: 8 }}>After transcription, captions appear in the right panel. You can:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            <div>Click a caption to seek the video to that point</div>
            <div>Edit text and timestamps inline</div>
            <div><Keys keys={['Shift', 'Enter']} /> — split a caption at the cursor position (timing is calculated proportionally)</div>
            <div>Use the <strong style={{ color: 'var(--text)' }}>+ Before</strong> / <strong style={{ color: 'var(--text)' }}>+ After</strong> buttons to add new captions around the selected one</div>
          </div>
          <p style={{ margin: 0, marginTop: 8 }}>
            The timeline shows captions in two lanes — adjacent captions automatically alternate so they don't visually overlap.
            Manually created captions (splits, inserts) appear in the top lane.
          </p>
        </Section>

        <div style={{ height: 1, background: 'var(--border)' }} />

        {/* Translate */}
        <Section title="Translate">
          <p style={{ margin: 0 }}>
            Translate your captions into other languages. Add language columns with the dropdown, then click Translate.
            Click a column header to select it — the left panel's settings apply to the selected column.
          </p>
          <p style={{ margin: 0 }}>
            Each language can have custom instructions (e.g. "use formal tone" or "keep honorifics").
            The translator understands these are conversational subtitles and preserves what was actually said.
          </p>
          <p style={{ margin: 0 }}>
            Currently only the <strong style={{ color: 'var(--text)' }}>Groq API</strong> engine is available for translation. The local engine is temporarily disabled.
          </p>
        </Section>

        <div style={{ height: 1, background: 'var(--border)' }} />

        {/* Style */}
        <Section title="Style">
          <p style={{ margin: 0 }}>
            Customize how your subtitles look — font, size, color, outline, alignment, and margins.
            A live preview shows how captions will appear. The generated ASS style line is shown below the preview.
          </p>
          <p style={{ margin: 0, fontStyle: 'italic', color: 'var(--text-dim)' }}>
            This tab is still under construction and may not function properly.
          </p>
        </Section>

        <div style={{ height: 1, background: 'var(--border)' }} />

        {/* Export */}
        <Section title="Export">
          <p style={{ margin: 0 }}>
            Export your subtitles as <strong style={{ color: 'var(--text)' }}>.SRT</strong> or{' '}
            <strong style={{ color: 'var(--text)' }}>.ASS</strong> files.
            If you have multiple translated languages, each one gets its own file.
          </p>
        </Section>

        <div style={{ height: 1, background: 'var(--border)' }} />

        {/* Tips */}
        <Section title="Tips">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div>• For streams, use the Cut tab to isolate interesting segments before transcribing — it's much faster.</div>
            <div>• Groq's free tier has rate limits. If transcription fails, wait a minute and retry.</div>
            <div>• WebGPU transcription requires a GPU with WebGPU support (Chrome/Edge on most modern hardware).</div>
            <div>• You can paste a stream timestamp into the timeline's time field to jump directly to that point.</div>
          </div>
        </Section>

        {/* Start button */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0 32px' }}>
          <button
            className="btn btn-primary"
            style={{ padding: '10px 40px', fontSize: 13, fontWeight: 600 }}
            onClick={onStart}
          >
            Start using OshiSub →
          </button>
        </div>
      </div>
    </div>
  );
}
