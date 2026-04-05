import { useState, useRef, RefObject, useCallback } from 'react';
import type { AppState, PatchFn, SubtitleEntry } from '@/types';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { generateSRT, generateASS } from '@/lib/export';
import { toSRTTime } from '@/lib/utils';

interface ExportTabProps {
  state: AppState;
  patch: PatchFn;
  ffmpegRef: RefObject<{
    concatSegments: (f: File, segs: { start: number; end: number }[]) => Promise<Uint8Array>;
    burnSubtitles: (f: File, entries: { start: number; end: number; text: string }[], style?: Record<string, unknown>) => Promise<Uint8Array>;
  } | null>;
  webcodesWorkerRef: RefObject<Worker | null>;
}

export function ExportTab({ state, patch, ffmpegRef, webcodesWorkerRef }: ExportTabProps) {
  const [exporting, setExporting] = useState<string | null>(null);
  const [showBurnWarning, setShowBurnWarning] = useState(false);
  const [burnProgress, setBurnProgress] = useState(0);
  const [burnEngine, setBurnEngine] = useState<'webcodecs' | 'canvas' | null>(null);
  const cancelRef = useRef(false);

  const hasVideo = !!state.videoFile;
  const hasCut = state.cutSegments.length > 0;
  const hasChunks = state.chunks.length > 0;
  const [exportLang, setExportLang] = useState<string>('original');

  // Available languages that have translations
  const translatedLangs = [...new Set(state.translatedChunks.map(t => t.language))];

  const activeChunks = exportLang === 'original'
    ? state.chunks
    : state.chunks.map((c) => ({
        ...c,
        text: state.translatedChunks.find((t) => t.id === c.id && t.language === exportLang)?.translatedText ?? c.text,
      }));

  const baseName = state.videoFile?.name.replace(/\.[^.]+$/, '') ?? 'oshisub';
  const langSuffix = exportLang === 'original' ? '' : `_${exportLang.toLowerCase().replace(/[^a-z]/g, '')}`;

  const entries: SubtitleEntry[] = activeChunks.map((c, i) => ({
    index: i + 1, start: c.start, end: c.end, text: c.text,
  }));

  // ── Export cut video ─────────────────────────────────────────────────────
  const exportCutVideo = async () => {
    if (!state.videoFile || !hasCut || !ffmpegRef.current) return;
    setExporting('video');
    try {
      patch({ status: 'exporting', statusMsg: 'Cutting video…' });
      const bytes = await ffmpegRef.current.concatSegments(state.videoFile, state.cutSegments);
      downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), `${baseName}_cut.mp4`);
      patch({ status: 'done', statusMsg: 'Cut video exported!' });
    } catch (e) {
      patch({ error: String(e), status: 'error', statusMsg: 'Cut export failed' });
    } finally { setExporting(null); }
  };

  const exportSRT = () => {
    downloadBlob(new Blob([generateSRT(entries)], { type: 'text/srt;charset=utf-8' }), `${baseName}${langSuffix}.srt`);
  };

  const exportASS = () => {
    downloadBlob(new Blob([generateASS(entries, baseName, state.subtitleStyle)], { type: 'text/ass;charset=utf-8' }), `${baseName}${langSuffix}.ass`);
  };

  // ── Burn-in: WebCodecs primary, Canvas+MediaRecorder fallback ────────────
  const exportBurnIn = useCallback(async () => {
    if (!state.videoFile || !hasChunks) return;
    setShowBurnWarning(false);
    setExporting('burnin');
    setBurnProgress(0);
    setBurnEngine(null);
    cancelRef.current = false;

    const subtitleLines = entries.map(e => ({ start: e.start, end: e.end, text: e.text }));

    try {
      // Step 1: Cut+concat if needed
      let videoData: ArrayBuffer;
      if (hasCut && ffmpegRef.current) {
        patch({ status: 'exporting', statusMsg: 'Step 1: Cutting video…' });
        const cutBytes = await ffmpegRef.current.concatSegments(state.videoFile, state.cutSegments);
        videoData = cutBytes.buffer as ArrayBuffer;
      } else {
        videoData = await state.videoFile.arrayBuffer();
      }

      // Step 2: Try WebCodecs burn-in
      const worker = webcodesWorkerRef.current;
      if (worker) {
        setBurnEngine('webcodecs');
        patch({ status: 'exporting', statusMsg: 'Step 2: Burning subtitles (WebCodecs GPU)…' });

        const result = await new Promise<ArrayBuffer | 'unsupported'>((resolve, reject) => {
          const handler = (e: MessageEvent) => {
            const { type, payload } = e.data;
            if (type === 'done') { worker.removeEventListener('message', handler); resolve(payload); }
            else if (type === 'unsupported') { worker.removeEventListener('message', handler); resolve('unsupported'); }
            else if (type === 'error') { worker.removeEventListener('message', handler); reject(new Error(payload)); }
            else if (type === 'progress') {
              const p = payload as { percent: number };
              setBurnProgress(p.percent);
              patch({ statusMsg: `Encoding… ${Math.round(p.percent * 100)}%` });
            } else if (type === 'status') {
              patch({ statusMsg: payload });
            }
          };
          worker.addEventListener('message', handler);
          const copy = videoData.slice(0);
          worker.postMessage(
            { type: 'burn', payload: { videoData: copy, subtitles: subtitleLines, style: state.subtitleStyle } },
            [copy]
          );
        });

        if (result !== 'unsupported') {
          downloadBlob(new Blob([result], { type: 'video/mp4' }), `${baseName}${langSuffix}_subtitled.mp4`);
          patch({ status: 'done', statusMsg: 'Burned-in video exported (WebCodecs GPU)!' });
          setExporting(null);
          return;
        }
        patch({ statusMsg: 'WebCodecs not supported, falling back to Canvas…' });
      }

      // Step 3: Canvas + VideoEncoder fallback
      setBurnEngine('canvas');
      patch({ statusMsg: 'Step 2: Burning subtitles (Canvas encoder)…' });

      const videoBlob = new Blob([videoData], { type: 'video/mp4' });
      const videoUrl = URL.createObjectURL(videoBlob);
      try {
        const resultBuf = await canvasBurnIn(videoUrl, subtitleLines, state.subtitleStyle, videoBlob.size, (p) => {
          setBurnProgress(p);
          patch({ statusMsg: `Burning subtitles… ${Math.round(p * 100)}%` });
        }, cancelRef);

        if (!cancelRef.current) {
          downloadBlob(new Blob([resultBuf], { type: 'video/mp4' }), `${baseName}${langSuffix}_subtitled.mp4`);
          patch({ status: 'done', statusMsg: 'Burned-in video exported (Canvas → MP4)!' });
        }
      } finally {
        URL.revokeObjectURL(videoUrl);
      }
    } catch (e) {
      if (!cancelRef.current) {
        patch({ error: String(e), status: 'error', statusMsg: 'Burn-in failed' });
      }
    } finally {
      setExporting(null);
    }
  }, [state.videoFile, hasChunks, hasCut, entries, state.subtitleStyle, baseName, langSuffix, ffmpegRef, webcodesWorkerRef, patch]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>

        {/* Language selector */}
        {hasChunks && (
          <div className="panel">
            <div className="panel-label">Export Language</div>
            <select value={exportLang} onChange={(e) => setExportLang(e.target.value)}>
              <option value="original">Original (transcribed)</option>
              {translatedLangs.map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            {exportLang !== 'original' && (
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                Exports will use {exportLang} translations.
              </div>
            )}
          </div>
        )}

        {/* Cut Video */}
        <div className="panel">
          <div className="panel-label">Cut Video</div>
          <p style={{ marginBottom: 12, fontSize: 12 }}>
            Export with cut segments applied. Uses stream copy (fast, no quality loss).
          </p>
          <button className="btn btn-primary" onClick={exportCutVideo} disabled={!hasVideo || !hasCut || !!exporting}>
            {exporting === 'video' ? '⏳ Exporting…' : '↓ Export Cut Video (.mp4)'}
          </button>
          {exporting === 'video' && <ProgressBar msg={state.statusMsg} />}
        </div>

        {/* Subtitle Files */}
        <div className="panel">
          <div className="panel-label">Subtitle Files</div>
          <p style={{ marginBottom: 12, fontSize: 12 }}>
            Download subtitles as a sidecar file. Style settings reflected in .ass only.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={exportSRT} disabled={!hasChunks}>↓ Export .srt</button>
            <button className="btn btn-ghost" onClick={exportASS} disabled={!hasChunks}>↓ Export .ass</button>
          </div>
          {hasChunks && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-dim)' }}>{entries.length} line{entries.length !== 1 ? 's' : ''}{exportLang !== 'original' ? ` · ${exportLang}` : ''}</div>}
        </div>

        {/* Burn-in */}
        <div className="panel">
          <div className="panel-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Hardcoded Subtitles (Burn-in)
            {burnEngine === 'webcodecs' && <span className="badge badge-accent">WebCodecs GPU</span>}
            {burnEngine === 'canvas' && <span className="badge badge-warning">Canvas Fallback</span>}
            {!burnEngine && <span className="badge badge-accent">WebCodecs → Canvas</span>}
          </div>
          <p style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.6, color: 'var(--text-muted)' }}>
            Burns subtitles into the video pixels. Tries <strong style={{ color: 'var(--accent)' }}>WebCodecs GPU</strong> first (MP4 output),
            falls back to <strong>Canvas + MediaRecorder</strong> (WebM output). 
          </p>

          {!showBurnWarning ? (
            <button className="btn btn-ghost" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
              onClick={() => setShowBurnWarning(true)} disabled={!hasVideo || !hasChunks || !!exporting}>
              Burn Subtitles into Video
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>This re-encodes the video. May take a few minutes.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-danger" onClick={exportBurnIn} disabled={!!exporting}>
                  {exporting === 'burnin' ? '⏳ Encoding…' : '🔥 Yes, Burn It In'}
                </button>
                {exporting === 'burnin'
                  ? <button className="btn btn-ghost" onClick={() => { cancelRef.current = true; webcodesWorkerRef.current?.postMessage({ type: 'abort' }); }}>✕ Cancel</button>
                  : <button className="btn btn-ghost" onClick={() => setShowBurnWarning(false)}>Cancel</button>}
              </div>
            </div>
          )}
          {exporting === 'burnin' && (
            <div style={{ marginTop: 10 }}>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${burnProgress * 100}%`, transition: 'width 0.3s' }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{state.statusMsg}</div>
            </div>
          )}
        </div>

        {state.error && (
          <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: 'var(--danger)' }}>
            ⚠ {state.error}
          </div>
        )}

        {hasChunks && (
          <div className="panel">
            <div className="panel-label">Preview</div>
            <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {entries.slice(0, 20).map((e) => (
                <div key={e.index} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 8, fontSize: 11, lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--text-dim)', fontFamily: 'monospace' }}>{toSRTTime(e.start)} → {toSRTTime(e.end)}</span>
                  <span style={{ color: 'var(--text)' }}>{e.text}</span>
                </div>
              ))}
              {entries.length > 20 && <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', marginTop: 4 }}>… and {entries.length - 20} more</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ msg, indeterminate }: { msg?: string; indeterminate?: boolean }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div className="progress-track">
        <div className={`progress-fill${indeterminate ? ' indeterminate' : ''}`} />
      </div>
      {msg && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{msg}</div>}
    </div>
  );
}

// Pick AVC codec string with appropriate level for the resolution
function avcCodec(w: number, h: number): string {
  const px = w * h;
  if (px <= 414720) return 'avc1.64001E';  // Level 3.0
  if (px <= 921600) return 'avc1.64001F';  // Level 3.1
  if (px <= 2088960) return 'avc1.640028'; // Level 4.0
  if (px <= 8355840) return 'avc1.640033'; // Level 5.1
  return 'avc1.64003D';                    // Level 6.1
}

// ─── Canvas + VideoEncoder Fallback ──────────────────────────────────────────
// Uses <video> for decoding (browser-native), canvas for subtitle overlay,
// VideoEncoder + mp4-muxer for MP4 output at source bitrate.
async function canvasBurnIn(
  videoUrl: string,
  subtitles: { start: number; end: number; text: string }[],
  style: Record<string, any>,
  fileSize: number,
  onProgress: (p: number) => void,
  cancelRef: { current: boolean },
): Promise<ArrayBuffer> {
  // Check VideoEncoder availability
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('VideoEncoder not available — cannot produce MP4 output');
  }

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;
    video.style.display = 'none';
    document.body.appendChild(video);

    const cleanup = () => { try { video.pause(); video.remove(); } catch { /* */ } };
    video.addEventListener('error', () => { cleanup(); reject(new Error('Failed to load video')); });

    video.addEventListener('loadedmetadata', async () => {
      const w = video.videoWidth, h = video.videoHeight, dur = video.duration;
      if (!w || !h || !isFinite(dur)) { cleanup(); reject(new Error('Invalid video')); return; }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;

      // Estimate source bitrate from file size
      const sourceBitrate = Math.round((fileSize * 8) / dur);
      const fps = 30; // assume 30fps for frame duration

      // Set up mp4-muxer
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: { codec: 'avc', width: w, height: h },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      });

      // Set up VideoEncoder
      let encoderConfig: VideoEncoderConfig = {
        codec: avcCodec(w, h),
        width: w,
        height: h,
        bitrate: sourceBitrate,
        framerate: fps,
        latencyMode: 'quality',
        avc: { format: 'annexb' },
      };

      // Try acceleration modes
      for (const mode of ['prefer-hardware', 'prefer-software', 'no-preference', undefined] as const) {
        const c: any = { ...encoderConfig };
        if (mode) c.hardwareAcceleration = mode;
        try {
          const r = await VideoEncoder.isConfigSupported(c);
          if (r.supported) { encoderConfig = c; break; }
        } catch { /* next */ }
      }

      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta as any),
        error: (e) => { cleanup(); reject(e); },
      });
      encoder.configure(encoderConfig);

      // Subtitle style
      const fontSize = style.fontSize ?? 48;
      const fontColor = style.color ?? '#FFFFFF';
      const outlineColor = style.outlineColor ?? '#000000';
      const bold = style.bold ?? true;
      const position = style.position ?? 'bottom';
      const marginV = style.marginV ?? 60;

      let frameCount = 0;
      let stopped = false;

      const drawFrame = async () => {
        if (cancelRef.current || stopped) {
          if (!stopped) {
            stopped = true;
            video.pause();
            await encoder.flush();
            encoder.close();
            muxer.finalize();
            cleanup();
            resolve(target.buffer);
          }
          return;
        }

        const t = video.currentTime;
        onProgress(t / dur);

        // Draw video frame
        ctx.drawImage(video, 0, 0, w, h);

        // Draw subtitles
        const active = subtitles.filter(s => t >= s.start && t <= s.end);
        if (active.length > 0) {
          const sf = Math.round(fontSize * (h / 1080));
          ctx.font = `${bold ? 'bold ' : ''}${sf}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.lineJoin = 'round';
          const lh = sf * 1.3;

          active.forEach((sub, idx) => {
            const y = position === 'bottom'
              ? h - marginV - (active.length - idx) * lh
              : marginV + idx * lh;
            ctx.strokeStyle = outlineColor;
            ctx.lineWidth = Math.max(3, sf / 12);
            ctx.strokeText(sub.text, w / 2, y);
            ctx.fillStyle = fontColor;
            ctx.fillText(sub.text, w / 2, y);
          });
        }

        // Encode frame as VideoFrame → VideoEncoder → mp4-muxer
        const vf = new VideoFrame(canvas, {
          timestamp: Math.round(t * 1_000_000),
          duration: Math.round(1_000_000 / fps),
        });
        const keyFrame = frameCount % 120 === 0;
        encoder.encode(vf, { keyFrame });
        vf.close();
        frameCount++;

        // Backpressure
        while (encoder.encodeQueueSize > 5) {
          await new Promise(r => setTimeout(r, 5));
        }

        // Next frame
        if ('requestVideoFrameCallback' in video) {
          video.requestVideoFrameCallback(drawFrame);
        } else {
          requestAnimationFrame(drawFrame);
        }
      };

      video.addEventListener('ended', async () => {
        if (!stopped) {
          stopped = true;
          onProgress(1);
          await encoder.flush();
          encoder.close();
          muxer.finalize();
          cleanup();
          resolve(target.buffer);
        }
      });

      // Play at 1x for correct timestamps
      video.playbackRate = 1;
      video.play().then(() => {
        if ('requestVideoFrameCallback' in video) {
          video.requestVideoFrameCallback(drawFrame);
        } else {
          requestAnimationFrame(drawFrame);
        }
      }).catch(reject);
    });
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
