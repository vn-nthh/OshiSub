// OshiSub/index.tsx — Root layout and shared app state

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FFmpegBridge } from '@/lib/ffmpegBridge';
import { decodeAudioBuffer } from '@/lib/audioUtils';
import { generateId, totalVirtualDuration } from '@/lib/utils';
import type {
  AppTab,
  AppState,
  PatchFn,
  CutSegment,
} from '@/types';
import { DEFAULT_SUBTITLE_STYLE } from '@/types';

import { ImportTab } from './ImportTab';
import { CutTab } from './CutTab';
import { TranscribeTab } from './TranscribeTab';
import { TranslateTab } from './TranslateTab';
import { StyleTab } from './StyleTab';
import { ExportTab } from './ExportTab';

// ─── Icons ────────────────────────────────────────────────────────────────────
function IconImport(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  );
}
function IconCut(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
      <line x1="20" y1="4" x2="8.12" y2="15.88"/>
      <line x1="14.47" y1="14.48" x2="20" y2="20"/>
      <line x1="8.12" y1="8.12" x2="12" y2="12"/>
    </svg>
  );
}
function IconTranscribe(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  );
}
function IconTranslate(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 8 6 6"/>
      <path d="m4 14 6-6 2-3"/>
      <path d="M2 5h12"/>
      <path d="M7 2h1"/>
      <path d="m22 22-5-10-5 10"/>
      <path d="M14 18h6"/>
    </svg>
  );
}
function IconStyle(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
    </svg>
  );
}
function IconExport(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  );
}

const TABS: { id: AppTab; label: string; Icon: () => React.JSX.Element }[] = [
  { id: 'import',     label: 'Import',     Icon: IconImport },
  { id: 'cut',        label: 'Cut',        Icon: IconCut },
  { id: 'transcribe', label: 'Transcribe', Icon: IconTranscribe },
  { id: 'translate',  label: 'Translate',  Icon: IconTranslate },
  { id: 'style',      label: 'Style',      Icon: IconStyle },
  { id: 'export',     label: 'Export',     Icon: IconExport },
];

// ─── Shared AppState and PatchFn are now in @/types ─────────────────────────

// ─── Main Component ───────────────────────────────────────────────────────────
export function OshiSub() {
  const [activeTab, setActiveTab] = useState<AppTab>('import');
  const [showCutHelp, setShowCutHelp] = useState(false);
  const [showTranscribeHelp, setShowTranscribeHelp] = useState(false);

  const [state, setState] = useState<AppState>({
    videoFile: null,
    videoObjectUrl: null,
    videoDuration: 0,
    cutSegments: [],
    audioSamples: null,
    audioDuration: 0,
    whisperModelId: 'onnx-community/whisper-large-v3-turbo',
    transcribeMode: 'webgpu',
    groqApiKey: '',
    keyterms: '',
    chunks: [],
    translatedChunks: [],
    translateMode: 'groq',
    targetLanguage: 'English',
    targetLanguages: [{ lang: 'English', instructions: '' }],
    groqTranslateKey: '',
    subtitleStyle: DEFAULT_SUBTITLE_STYLE,
    status: 'idle',
    statusMsg: 'Ready',
    extractProgress: 0,
    ffmpegProgress: null,
    error: null,
  });

  const patch: PatchFn = useCallback((updates: Partial<AppState>) => {
    setState((s) => ({ ...s, ...updates }));
  }, []);

  // Workers & bridge
  const ffmpegRef = useRef<FFmpegBridge | null>(null);
  const whisperWorkerRef = useRef<Worker | null>(null);
  const translateWorkerRef = useRef<Worker | null>(null);
  const webcodesWorkerRef = useRef<Worker | null>(null);

  useEffect(() => {
    ffmpegRef.current = new FFmpegBridge();
    ffmpegRef.current.onProgress((p) =>
      setState((s) => ({ ...s, extractProgress: p.progress, ffmpegProgress: p }))
    );
    return () => ffmpegRef.current?.destroy();
  }, []);

  // Workers are created once and held for the app lifetime.
  // We use a ref-guard pattern to avoid React StrictMode double-mount
  // killing a worker mid WebGPU-init (which causes the ORT buffer-unmap crash).
  const workersInitialized = useRef(false);

  useEffect(() => {
    // StrictMode fires this twice in dev: on second mount we need fresh workers.
    if (workersInitialized.current) return;
    workersInitialized.current = true;

    whisperWorkerRef.current = new Worker(
      new URL('../../workers/whisper.worker.js', import.meta.url),
      { type: 'module' }
    );
    translateWorkerRef.current = new Worker(
      new URL('../../workers/translate.worker.ts', import.meta.url),
      { type: 'module' }
    );
    webcodesWorkerRef.current = new Worker(
      new URL('../../workers/webcodecs-burner.worker.ts', import.meta.url),
      { type: 'module' }
    );

    return () => {
      // Reset the guard so the next mount recreates workers
      workersInitialized.current = false;
      // Deferred terminate: give in-flight WebGPU ops 2s to drain before killing.
      const w = whisperWorkerRef.current;
      const t = translateWorkerRef.current;
      const b = webcodesWorkerRef.current;
      whisperWorkerRef.current = null;
      translateWorkerRef.current = null;
      webcodesWorkerRef.current = null;
      setTimeout(() => { w?.terminate(); t?.terminate(); b?.terminate(); }, 2000);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handle video import ──────────────────────────────────────────────────
  const handleVideoFile = useCallback(async (file: File, duration: number) => {
    if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
    const url = URL.createObjectURL(file);
    patch({
      videoFile: file,
      videoObjectUrl: url,
      videoDuration: duration,
      cutSegments: [],
      audioSamples: null,
      audioDuration: 0,
      chunks: [],
      translatedChunks: [],
      error: null,
      status: 'idle',
      statusMsg: 'Video imported. Set cut points in Cut tab, or skip to Transcribe for full video.',
    });
    setActiveTab('cut');
  }, [state.videoObjectUrl, patch]);

  // ── Extract audio from virtual cut (all segments, stitched) ─────────────
  const extractCutAudio = useCallback(async (segments: CutSegment[]): Promise<Float32Array> => {
    const ffmpeg = ffmpegRef.current!;
    const file = state.videoFile!;
    const buffers: Float32Array[] = [];

    // If no cuts, use the full video
    const effectiveSegs = segments.length > 0 ? segments : [{ id: '_full', start: 0, end: state.videoDuration }];

    for (let i = 0; i < effectiveSegs.length; i++) {
      const seg = effectiveSegs[i];
      patch({ statusMsg: `Extracting audio segment ${i + 1}/${effectiveSegs.length}…` });
      const wavBytes = await ffmpeg.extractAudio(file, seg.start, seg.end);
      const samples = await decodeAudioBuffer(wavBytes.buffer.slice(0) as ArrayBuffer, 16000);
      buffers.push(samples);
    }

    // Stitch all segment buffers together
    const total = buffers.reduce((acc, b) => acc + b.length, 0);
    const stitched = new Float32Array(total);
    let offset = 0;
    for (const buf of buffers) {
      stitched.set(buf, offset);
      offset += buf.length;
    }
    return stitched;
  }, [state.videoFile, state.videoDuration, patch]);

  // ── Status bar dot color ─────────────────────────────────────────────────
  const dotClass = useMemo(() => {
    if (state.status === 'error') return 'statusbar-dot danger';
    if (state.status === 'done') return 'statusbar-dot success';
    if (state.status === 'idle') return 'statusbar-dot';
    return 'statusbar-dot active';
  }, [state.status]);

  const virtualDuration = useMemo(
    () => state.cutSegments.length > 0 ? totalVirtualDuration(state.cutSegments) : state.videoDuration,
    [state.cutSegments, state.videoDuration]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100vh', overflow: 'hidden', background: 'var(--bg-base)' }}>
      {/* ── Horizontal Tab Bar ───────────────────────────────────────── */}
      <nav className="tab-sidebar">
        <div style={{ display: 'flex', alignItems: 'center', paddingRight: 12, marginRight: 8, borderRight: '1px solid var(--border)', height: '100%' }}>
          <img src="/catt_logo_white.png" alt="" style={{ width: 22, height: 22 }} />
        </div>
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`tab-item${activeTab === id ? ' active' : ''}`}
            onClick={() => setActiveTab(id)}
            data-tooltip={label}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}

        {/* Right-aligned actions for Cut tab */}
        {activeTab === 'cut' && state.videoFile && (
          <>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '4px 10px', alignSelf: 'center' }}
              onClick={() => setShowCutHelp(h => !h)}
            >Guide
            </button>
            <button
              className="btn btn-primary"
              style={{ fontSize: 11, padding: '4px 14px', alignSelf: 'center' }}
              onClick={() => setActiveTab('transcribe')}
            >
              Transcribe
            </button>
            </div>
          </>
        )}

        {/* Right-aligned actions for Transcribe tab */}
        {activeTab === 'transcribe' && state.videoFile && (
          <>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '4px 10px', alignSelf: 'center' }}
              onClick={() => setShowTranscribeHelp(h => !h)}
            >Guide
            </button>
            </div>
          </>
        )}
      </nav>

      {/* ── Content Area ─────────────────────────────────────────────── */}
      <div className="content-area">
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'import' && (
            <ImportTab onVideoImported={handleVideoFile} videoFile={state.videoFile} videoObjectUrl={state.videoObjectUrl} />
          )}
          {activeTab === 'cut' && (
            <CutTab
              videoFile={state.videoFile}
              videoObjectUrl={state.videoObjectUrl}
              videoDuration={state.videoDuration}
              cutSegments={state.cutSegments}
              onSegmentsChange={(segs: CutSegment[]) => patch({ cutSegments: segs })}
              onConfirmCut={() => setActiveTab('transcribe')}
              showHelp={showCutHelp}
              onToggleHelp={() => setShowCutHelp(h => !h)}
            />
          )}
          {activeTab === 'transcribe' && (
            <TranscribeTab
              state={state}
              patch={patch}
              setActiveTab={setActiveTab}
              extractCutAudio={extractCutAudio}
              whisperWorkerRef={whisperWorkerRef}
              virtualDuration={virtualDuration}
              showHelp={showTranscribeHelp}
              onToggleHelp={() => setShowTranscribeHelp(h => !h)}
            />
          )}
          {activeTab === 'translate' && (
            <TranslateTab
              state={state}
              patch={patch}
              translateWorkerRef={translateWorkerRef}
            />
          )}
          {activeTab === 'style' && (
            <StyleTab
              state={state}
              patch={patch}
            />
          )}
          {activeTab === 'export' && (
            <ExportTab
              state={state}
              patch={patch}
              ffmpegRef={ffmpegRef}
              webcodesWorkerRef={webcodesWorkerRef}
            />
          )}
        </div>

        {/* ── Status Bar ────────────────────────────────────────────── */}
        <div className="statusbar">
          <div className={dotClass} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {state.statusMsg}
          </span>
          {state.status === 'extracting' && state.extractProgress > 0 && (
            <div className="progress-track" style={{ width: 120 }}>
              <div className="progress-fill" style={{ width: `${state.extractProgress * 100}%` }} />
            </div>
          )}
          {state.videoFile && (
            <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{state.videoFile.name}</span>
          )}
          {state.videoDuration > 0 && (
            <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
              {Math.floor(state.videoDuration / 60)}:{String(Math.floor(state.videoDuration % 60)).padStart(2, '0')}
            </span>
          )}
          {state.cutSegments.length > 0 && virtualDuration > 0 && (
            <span style={{ color: 'var(--accent)', flexShrink: 0 }}>
              ✂ {Math.floor(virtualDuration / 60)}:{String(Math.floor(virtualDuration % 60)).padStart(2, '0')} cut
            </span>
          )}
          {state.chunks.length > 0 && (
            <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
              {state.chunks.length} captions
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
