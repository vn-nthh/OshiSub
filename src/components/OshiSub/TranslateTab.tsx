import { useState, useRef, RefObject, useCallback } from 'react';
import { translateWithGroq } from '@/lib/groq';
import type { AppState, PatchFn, TranslationMode, TranslatedChunk, TargetLanguageConfig } from '@/types';
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
  const isRunning = state.status === 'translating';
  const langConfigs = state.targetLanguages;
  const langNames = langConfigs.map(c => c.lang);
  const activeConfig = langConfigs.find(c => c.lang === state.targetLanguage);

  const hasTranslationFor = (lang: string) =>
    state.translatedChunks.some(t => t.language === lang);

  // Can add the currently selected language as a column?
  const canAdd = !langNames.includes(state.targetLanguage);

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
    const lang = state.targetLanguage;
    const config = langConfigs.find(c => c.lang === lang);
    const instructions = config?.instructions.trim() || '';
    const texts = state.chunks.map((c) => c.text);

    // If language isn't in columns yet, add it
    let currentConfigs = langConfigs;
    if (!langNames.includes(lang)) {
      currentConfigs = [...langConfigs, { lang, instructions: '' }];
      patch({ targetLanguages: currentConfigs });
    }

    const otherTranslations = state.translatedChunks.filter(t => t.language !== lang);
    patch({ status: 'translating', statusMsg: `Translating to ${lang}…`, translatedChunks: otherTranslations });

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
          worker.postMessage({ type: 'translate', payload: { texts, targetLanguage: lang, instructions } });
        });
      } else {
        if (!state.groqTranslateKey.trim()) {
          patch({ error: 'Enter your Groq API key for translation.', status: 'error', statusMsg: 'API key required' });
          return;
        }
        translations = await translateWithGroq(texts, lang, state.groqTranslateKey.trim(), instructions || undefined);
      }

      const newChunks: TranslatedChunk[] = state.chunks.map((c, i) => ({
        id: c.id,
        language: lang,
        originalText: c.text,
        translatedText: translations[i] ?? c.text,
      }));
      patch({
        translatedChunks: [...otherTranslations, ...newChunks],
        status: 'done',
        statusMsg: `Translation to ${lang} complete!`,
      });
      setProgress(null);
    } catch (e) {
      patch({ error: String(e), status: 'error', statusMsg: 'Translation failed' });
      setProgress(null);
    }
  }, [state, patch, hasChunks, langConfigs, langNames, workerReady, loadWebGPUModel, translateWorkerRef]);

  const addColumn = () => {
    if (canAdd) {
      patch({
        targetLanguages: [...langConfigs, { lang: state.targetLanguage, instructions: '' }],
      });
    }
  };

  const removeLanguage = (lang: string) => {
    const updated = langConfigs.filter(c => c.lang !== lang);
    const newChunks = state.translatedChunks.filter(t => t.language !== lang);
    patch({ targetLanguages: updated, translatedChunks: newChunks });
  };

  const updateInstructions = (lang: string, instructions: string) => {
    patch({
      targetLanguages: langConfigs.map(c => c.lang === lang ? { ...c, instructions } : c),
    });
  };

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
        <div style={{ width: leftW ?? 280, flexShrink: 0, padding: 16, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', overflow: 'visible' }}>

          {/* Target language selector */}
          <div>
            <div className="panel-label">Translate to</div>
            <select value={state.targetLanguage} onChange={(e) => patch({ targetLanguage: e.target.value })}>
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          {/* Translate action */}
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={runTranslation}
            disabled={isRunning || !hasChunks || state.translateMode === 'webgpu'}
          >
            {isRunning ? '⏳ Translating…' : hasTranslationFor(state.targetLanguage) ? '↺ Re-translate' : '▶ Translate'}
          </button>

          {/* Custom instructions for active language (if it's been added as a column) */}
          {activeConfig && (
            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: 4 }}>Instructions</label>
              <textarea
                value={activeConfig.instructions}
                onChange={(e) => updateInstructions(activeConfig.lang, e.target.value)}
                placeholder="e.g. Use formal tone, keep honorifics…"
                style={{ width: '100%', minHeight: 52, resize: 'vertical', fontSize: 11, lineHeight: 1.5 }}
              />
              <div className="form-hint">Optional per-language instructions.</div>
            </div>
          )}

          <div style={{ height: 1, background: 'var(--border)' }} />

          <div className="form-row">
            <label className="form-label">Engine</label>
            <select value={state.translateMode} onChange={e => patch({ translateMode: e.target.value as TranslationMode })}>
              <option value="webgpu">Local</option>
              <option value="groq">Cloud — Groq API</option>
            </select>
          </div>

          {state.translateMode === 'webgpu' && (
            <div style={{
              fontSize: 11, lineHeight: 1.6, color: 'var(--text-muted)',
              fontStyle: 'italic', padding: '10px 12px',
              background: 'var(--bg-active)', borderRadius: 6,
              border: '1px solid var(--border)',
            }}>
              "hey, catt here. it's kind of a bummer but for most people with normal GPUs, translating with a local model would not yield good results. whenever there's a model good enough for translating, I'll update the site to let y'all use it."
            </div>
          )}

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
          const cur = prev ?? 280;
          return Math.max(200, Math.min(cur + d, cw - 300));
        })} />

        {/* Right: comparison grid */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {/* Column headers: Original | Lang1 | Lang2 | … | [+] */}
          <div style={{
            display: 'flex', alignItems: 'stretch',
            borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            <div style={{
              flex: 1, minWidth: 120, padding: '8px 16px',
              fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              borderRight: '1px solid var(--border)',
              display: 'flex', alignItems: 'center',
            }}>
              Original
            </div>
            {langConfigs.map((cfg) => (
              <div
                key={cfg.lang}
                style={{
                  flex: 1, minWidth: 120, padding: '8px 12px',
                  fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: 'var(--text-muted)',
                  borderRight: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{cfg.lang}</span>
                  {hasTranslationFor(cfg.lang) && (
                    <span style={{ fontSize: 8, color: 'var(--text-dim)', background: 'var(--bg-hover)', padding: '1px 4px', borderRadius: 2, textTransform: 'none', letterSpacing: 0 }}>✓</span>
                  )}
                </div>
                <button
                  onClick={() => removeLanguage(cfg.lang)}
                  style={{
                    background: 'none', border: 'none', color: 'var(--text-dim)',
                    cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1,
                    opacity: 0.4, transition: 'opacity 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '0.4')}
                  title={`Remove ${cfg.lang}`}
                >×</button>
              </div>
            ))}
            {/* + button */}
            <button
              onClick={addColumn}
              disabled={!canAdd}
              style={{
                flexShrink: 0, background: 'none', border: 'none',
                color: canAdd ? 'var(--text-muted)' : 'var(--text-dim)',
                cursor: canAdd ? 'pointer' : 'not-allowed',
                fontSize: 16, fontWeight: 300, padding: '4px 12px', lineHeight: 1,
                transition: 'color 0.1s',
              }}
              onMouseEnter={e => { if (canAdd) e.currentTarget.style.color = 'var(--text)'; }}
              onMouseLeave={e => (e.currentTarget.style.color = canAdd ? 'var(--text-muted)' : 'var(--text-dim)')}
              title={canAdd ? `Add ${state.targetLanguage} column` : `${state.targetLanguage} already added`}
            >+</button>
          </div>

          {/* Rows */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {state.chunks.map((chunk, i) => (
              <div
                key={chunk.id}
                style={{ display: 'flex', borderBottom: '1px solid var(--border)', minHeight: 48 }}
              >
                {/* Original */}
                <div style={{ flex: 1, minWidth: 120, padding: '8px 16px', borderRight: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', flexShrink: 0, paddingTop: 2 }}>#{i + 1}</span>
                  <span style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{chunk.text}</span>
                </div>

                {/* Translation columns */}
                {langConfigs.map((cfg) => {
                  const translated = state.translatedChunks.find(t => t.id === chunk.id && t.language === cfg.lang);
                  return (
                    <div
                      key={cfg.lang}
                      style={{
                        flex: 1, minWidth: 120, padding: '8px 12px',
                        borderRight: '1px solid var(--border)',
                      }}
                    >
                      {translated ? (
                        <textarea
                          className="inline-edit"
                          value={translated.translatedText}
                          onChange={(e) => {
                            patch({
                              translatedChunks: state.translatedChunks.map((t) =>
                                t.id === chunk.id && t.language === cfg.lang ? { ...t, translatedText: e.target.value } : t
                              ),
                            });
                          }}
                          style={{ fontSize: 12, height: 44, resize: 'none', lineHeight: 1.5 }}
                        />
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>—</span>
                      )}
                    </div>
                  );
                })}
                {/* Spacer for + column */}
                <div style={{ flexShrink: 0, width: 40 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
