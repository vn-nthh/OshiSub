import { useState, useRef, RefObject, useCallback } from 'react';
import { translateWithGroq } from '@/lib/groq';
import type { AppState, PatchFn, TranslationMode, TranslatedChunk } from '@/types';
import { generateId } from '@/lib/utils';
import { ResizeHandle } from './ResizeHandle';

interface TranslateTabProps {
  state: AppState;
  patch: PatchFn;
  translateWorkerRef: RefObject<Worker | null>;
}

const LANGUAGES = [
  'English', 'Japanese', 'Chinese (Simplified)', 'Chinese (Traditional)',
  'Korean', 'Spanish', 'French', 'German', 'Portuguese', 'Vietnamese',
  'Thai', 'Indonesian', 'Arabic', 'Russian', 'Italian',
];

export function TranslateTab({ state, patch, translateWorkerRef }: TranslateTabProps) {
  const [workerReady, setWorkerReady] = useState(false);
  const [workerLoading, setWorkerLoading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ file: string; progress: number } | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const [leftW, setLeftW] = useState<number | null>(null);

  const hasChunks = state.chunks.length > 0;
  const hasTranslation = state.translatedChunks.length > 0;
  const isRunning = state.status === 'translating';

  const loadWebGPUModel = useCallback((): Promise<void> => {
    const worker = translateWorkerRef.current;
    if (!worker) return Promise.reject(new Error('No worker'));
    setWorkerLoading(true);
    patch({ statusMsg: 'Loading TranslateGemma model…' });

    return new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const { type, payload } = e.data;
        if (type === 'ready') {
          setWorkerReady(true);
          setWorkerLoading(false);
          setDownloadProgress(null);
          patch({ statusMsg: 'Translation model ready.' });
          resolve();
        } else if (type === 'download-progress') {
          setDownloadProgress({ file: payload.file, progress: payload.progress });
        } else if (type === 'status') {
          patch({ statusMsg: payload });
        } else if (type === 'error') {
          setWorkerLoading(false);
          reject(new Error(payload));
        }
      };
      worker.postMessage({ type: 'load' });
    });
  }, [translateWorkerRef, patch]);

  const runTranslation = useCallback(async () => {
    if (!hasChunks) return;
    const texts = state.chunks.map((c) => c.text);
    patch({ status: 'translating', statusMsg: 'Translating…', translatedChunks: [] });

    try {
      let translations: string[];

      if (state.translateMode === 'webgpu') {
        if (!workerReady) await loadWebGPUModel();
        const worker = translateWorkerRef.current!;
        setProgress({ current: 0, total: texts.length });

        translations = await new Promise<string[]>((resolve, reject) => {
          worker.onmessage = (e) => {
            const { type, payload } = e.data;
            if (type === 'progress') {
              setProgress({ current: (payload as { current: number; total: number }).current, total: (payload as { current: number; total: number }).total });
            } else if (type === 'done') {
              resolve(payload as string[]);
            } else if (type === 'error') {
              reject(new Error(payload as string));
            }
          };
          worker.postMessage({ type: 'translate', payload: { texts, targetLanguage: state.targetLanguage } });
        });
      } else {
        if (!state.groqTranslateKey.trim()) {
          patch({ error: 'Enter your Groq API key for translation.', status: 'error', statusMsg: 'API key required' });
          return;
        }
        translations = await translateWithGroq(texts, state.targetLanguage, state.groqTranslateKey.trim());
      }

      const translated: TranslatedChunk[] = state.chunks.map((c, i) => ({
        id: c.id,
        originalText: c.text,
        translatedText: translations[i] ?? c.text,
      }));
      patch({ translatedChunks: translated, status: 'done', statusMsg: 'Translation complete!' });
      setProgress(null);
    } catch (e) {
      patch({ error: String(e), status: 'error', statusMsg: 'Translation failed' });
      setProgress(null);
    }
  }, [state, patch, hasChunks, workerReady, loadWebGPUModel, translateWorkerRef]);

  if (!hasChunks) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 12 }}>Run transcription first to generate captions.</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div ref={splitRef} style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left: settings */}
        <div style={{ width: leftW ?? 300, flexShrink: 0, padding: 16, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          {/* Translate action */}
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={runTranslation}
            disabled={isRunning || !hasChunks}
          >
            {isRunning ? '⏳ Translating…' : hasTranslation ? '↺ Re-translate' : '▶ Translate'}
          </button>
          <div>
            <div className="panel-label">Target Language</div>
            <select value={state.targetLanguage} onChange={(e) => patch({ targetLanguage: e.target.value })}>
              {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
            </select>
          </div>

          <div className="form-row">
            <label className="form-label">Engine</label>
            <select value={state.translateMode} onChange={e => patch({ translateMode: e.target.value as TranslationMode })}>
              <option value="webgpu">Local — TranslateGemma 4B</option>
              <option value="groq">Cloud — Groq API</option>
            </select>
          </div>

          {state.translateMode === 'groq' && (
            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: 4 }}>Groq API Key</label>
              <input
                type="password"
                value={state.groqTranslateKey}
                onChange={(e) => patch({ groqTranslateKey: e.target.value })}
                placeholder="gsk_..."
                autoComplete="off"
              />
              <div className="form-hint">Session memory only.</div>
            </div>
          )}

          {state.translateMode === 'webgpu' && !workerReady && (
            <div>
              <button
                className="btn btn-ghost"
                style={{ width: '100%' }}
                onClick={() => loadWebGPUModel()}
                disabled={workerLoading}
              >
                {workerLoading ? '⏳ Loading model…' : 'Pre-load Model'}
              </button>
              {downloadProgress && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
                    {downloadProgress.file} — {Math.round(downloadProgress.progress)}%
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${downloadProgress.progress}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {progress && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                {progress.current} / {progress.total} lines
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
              </div>
            </div>
          )}

          {state.error && (
            <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: 'var(--danger)' }}>
              ⚠ {state.error}
            </div>
          )}
        </div>

        <ResizeHandle onResize={(d) => setLeftW(prev => {
          const cw = splitRef.current?.clientWidth ?? 800;
          const cur = prev ?? 300;
          return Math.max(200, Math.min(cur + d, cw - 300));
        })} />

        {/* Right: side-by-side comparison */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ padding: '8px 16px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderRight: '1px solid var(--border)' }}>
              Original
            </div>
            <div style={{ padding: '8px 16px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {state.targetLanguage}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {state.chunks.map((chunk, i) => {
              const translated = state.translatedChunks.find((t) => t.id === chunk.id);
              return (
                <div
                  key={chunk.id}
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)', minHeight: 48 }}
                >
                  {/* Original */}
                  <div style={{ padding: '8px 16px', borderRight: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', flexShrink: 0, paddingTop: 2 }}>#{i + 1}</span>
                    <span style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{chunk.text}</span>
                  </div>
                  {/* Translated */}
                  <div style={{ padding: '8px 16px' }}>
                    {translated ? (
                      <textarea
                        className="inline-edit"
                        value={translated.translatedText}
                        onChange={(e) => {
                          patch({
                            translatedChunks: state.translatedChunks.map((t) =>
                              t.id === chunk.id ? { ...t, translatedText: e.target.value } : t
                            ),
                          });
                        }}
                        style={{ fontSize: 12, height: 44, resize: 'none', lineHeight: 1.5 }}
                      />
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}


