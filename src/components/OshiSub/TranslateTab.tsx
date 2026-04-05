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

  // Get config for active language
  const activeConfig = langConfigs.find(c => c.lang === state.targetLanguage);

  // Check if a language already has translations
  const hasTranslationFor = (lang: string) =>
    state.translatedChunks.some(t => t.language === lang);

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
    if (!hasChunks || !activeConfig) return;
    const lang = activeConfig.lang;
    const instructions = activeConfig.instructions.trim();
    const texts = state.chunks.map((c) => c.text);

    // Remove old translations for this language, keep others
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
  }, [state, patch, hasChunks, activeConfig, workerReady, loadWebGPUModel, translateWorkerRef]);

  // ── Add / remove language ─────────────────────────────────────────────────
  const addLanguage = () => {
    const available = LANGUAGES.filter(l => !langNames.includes(l));
    if (available.length === 0) return;
    const newConfig: TargetLanguageConfig = { lang: available[0], instructions: '' };
    patch({ targetLanguages: [...langConfigs, newConfig], targetLanguage: available[0] });
  };

  const removeLanguage = (lang: string) => {
    if (langConfigs.length <= 1) return;
    const updated = langConfigs.filter(c => c.lang !== lang);
    const newChunks = state.translatedChunks.filter(t => t.language !== lang);
    patch({
      targetLanguages: updated,
      targetLanguage: updated.some(c => c.lang === state.targetLanguage) ? state.targetLanguage : updated[0].lang,
      translatedChunks: newChunks,
    });
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

  const availableToAdd = LANGUAGES.filter(l => !langNames.includes(l));

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
            {isRunning ? '⏳ Translating…' : hasTranslationFor(state.targetLanguage) ? '↺ Re-translate' : '▶ Translate'}
          </button>

          {/* Active target language selector */}
          <div>
            <div className="panel-label">Translate to</div>
            <select value={state.targetLanguage} onChange={(e) => patch({ targetLanguage: e.target.value })}>
              {langConfigs.map((c) => <option key={c.lang} value={c.lang}>{c.lang}</option>)}
            </select>
          </div>

          {/* Custom instructions for active language */}
          {activeConfig && (
            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: 4 }}>
                Instructions <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({activeConfig.lang})</span>
              </label>
              <textarea
                value={activeConfig.instructions}
                onChange={(e) => updateInstructions(activeConfig.lang, e.target.value)}
                placeholder="e.g. Use formal tone, keep honorifics, preserve names…"
                style={{ width: '100%', minHeight: 56, resize: 'vertical', fontSize: 11, lineHeight: 1.5 }}
              />
              <div className="form-hint">Optional. Custom instructions for this language's translation.</div>
            </div>
          )}

          {/* Language list with + button */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="form-label" style={{ margin: 0 }}>Languages</span>
              {availableToAdd.length > 0 && (
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '2px 8px' }}
                  onClick={addLanguage}
                  title="Add language"
                >+ Add</button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {langConfigs.map(cfg => (
                <div
                  key={cfg.lang}
                  onClick={() => patch({ targetLanguage: cfg.lang })}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '5px 10px', borderRadius: 4, cursor: 'pointer',
                    background: cfg.lang === state.targetLanguage ? 'var(--bg-active)' : 'transparent',
                    border: `1px solid ${cfg.lang === state.targetLanguage ? 'var(--border-soft)' : 'transparent'}`,
                    transition: 'all 0.1s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: cfg.lang === state.targetLanguage ? 'var(--text)' : 'var(--text-muted)' }}>{cfg.lang}</span>
                    {hasTranslationFor(cfg.lang) && (
                      <span style={{ fontSize: 9, color: 'var(--text-dim)', background: 'var(--bg-hover)', padding: '1px 5px', borderRadius: 3 }}>done</span>
                    )}
                    {cfg.instructions.trim() && (
                      <span style={{ fontSize: 9, color: 'var(--text-dim)', background: 'var(--bg-hover)', padding: '1px 5px', borderRadius: 3 }}>✎</span>
                    )}
                  </div>
                  {langConfigs.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeLanguage(cfg.lang); }}
                      style={{
                        background: 'none', border: 'none', color: 'var(--text-dim)',
                        cursor: 'pointer', fontSize: 13, padding: '0 4px', lineHeight: 1,
                      }}
                      title={`Remove ${cfg.lang}`}
                    >×</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Quick-add language dropdown */}
          {availableToAdd.length > 0 && (
            <div>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    const newCfg: TargetLanguageConfig = { lang: e.target.value, instructions: '' };
                    patch({ targetLanguages: [...langConfigs, newCfg], targetLanguage: e.target.value });
                  }
                }}
                style={{ fontSize: 11 }}
              >
                <option value="" disabled>+ Add language…</option>
                {availableToAdd.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          )}

          <div style={{ height: 1, background: 'var(--border)' }} />

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
          {/* Column headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `1fr ${langConfigs.map(() => '1fr').join(' ')}`,
            borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            <div style={{ padding: '8px 16px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderRight: '1px solid var(--border)' }}>
              Original
            </div>
            {langConfigs.map((cfg, i) => (
              <div
                key={cfg.lang}
                style={{
                  padding: '8px 16px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: cfg.lang === state.targetLanguage ? 'var(--text)' : 'var(--text-muted)',
                  borderRight: i < langConfigs.length - 1 ? '1px solid var(--border)' : 'none',
                  cursor: 'pointer',
                }}
                onClick={() => patch({ targetLanguage: cfg.lang })}
              >
                {cfg.lang}
                {!hasTranslationFor(cfg.lang) && <span style={{ fontSize: 9, opacity: 0.5, marginLeft: 6 }}>—</span>}
              </div>
            ))}
          </div>

          {/* Rows */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {state.chunks.map((chunk, i) => (
              <div
                key={chunk.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: `1fr ${langConfigs.map(() => '1fr').join(' ')}`,
                  borderBottom: '1px solid var(--border)', minHeight: 48,
                }}
              >
                {/* Original */}
                <div style={{ padding: '8px 16px', borderRight: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', flexShrink: 0, paddingTop: 2 }}>#{i + 1}</span>
                  <span style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{chunk.text}</span>
                </div>

                {/* Translation columns */}
                {langConfigs.map((cfg, li) => {
                  const translated = state.translatedChunks.find(t => t.id === chunk.id && t.language === cfg.lang);
                  return (
                    <div
                      key={cfg.lang}
                      style={{
                        padding: '8px 16px',
                        borderRight: li < langConfigs.length - 1 ? '1px solid var(--border)' : 'none',
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
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
