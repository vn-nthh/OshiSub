import { useState, useRef, useCallback, useEffect, RefObject } from 'react';
import { transcribeWithGroq } from '@/lib/groq';
import { generateId, formatTimeDisplay, virtualToSource, sourceToVirtual } from '@/lib/utils';
import type { AppState, PatchFn, AppTab, TranscriptChunk, CutSegment } from '@/types';
import { ResizeHandle } from './ResizeHandle';
import { GuidePopover } from './GuidePopover';
import { transcribeGuide } from './guides';

interface TranscribeTabProps {
  state: AppState;
  patch: PatchFn;
  setActiveTab: (t: AppTab) => void;
  extractCutAudio: (segs: CutSegment[]) => Promise<Float32Array>;
  whisperWorkerRef: RefObject<Worker | null>;
  virtualDuration: number;
  showHelp: boolean;
  onToggleHelp: () => void;
}



export function TranscribeTab({
  state,
  patch,
  setActiveTab,
  extractCutAudio,
  whisperWorkerRef,
  virtualDuration,
  showHelp,
  onToggleHelp,
}: TranscribeTabProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const transcribeSplitRef = useRef<HTMLDivElement>(null);
  const [transcribeLeftW, setTranscribeLeftW] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ file: string; progress: number } | null>(null);
  const [activeDevice, setActiveDevice] = useState<'webgpu' | 'wasm' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [videoZoom, setVideoZoom] = useState(1);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [videoAspect, setVideoAspect] = useState(16 / 9); // w/h

  const isRunning = state.status === 'transcribing' || state.status === 'loading-model' || state.status === 'extracting';
  const hasChunks = state.chunks.length > 0;
  const hasCut = state.cutSegments.length > 0;

  // Sort segments by start time for consistent mapping
  const sortedSegments = [...state.cutSegments].sort((a, b) => a.start - b.start);

  // ── Active caption (based on current *virtual* playback time) ──────────────
  const activeChunk = state.chunks.find(
    (c) => currentTime >= c.start && currentTime < c.end
  ) ?? null;

  // ── Segment-aware seek: takes virtual time, converts to real time ──────────
  const seekVideo = useCallback((vt: number) => {
    if (videoRef.current) {
      if (sortedSegments.length > 0) {
        videoRef.current.currentTime = virtualToSource(vt, sortedSegments);
      } else {
        videoRef.current.currentTime = vt;
      }
    }
    setCurrentTime(vt);

    // Scroll timeline to keep playhead visible
    const el = timelineScrollRef.current;
    const track = timelineRef.current;
    if (el && track && virtualDuration > 0) {
      const trackW = track.clientWidth;
      const playheadPx = (vt / virtualDuration) * trackW;
      const viewLeft = el.scrollLeft;
      const viewRight = viewLeft + el.clientWidth;
      if (playheadPx < viewLeft + 20 || playheadPx > viewRight - 20) {
        el.scrollLeft = playheadPx - el.clientWidth / 2;
      }
    }
  }, [sortedSegments, virtualDuration]);

  // ── Segment-aware timeupdate: converts real→virtual, skips gaps ────────────
  const handleTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.target as HTMLVideoElement;
    const realTime = video.currentTime;
    if (sortedSegments.length === 0) {
      setCurrentTime(realTime);
      return;
    }

    const { virtualTime, inSegment, segmentIndex } = sourceToVirtual(realTime, sortedSegments);

    if (inSegment) {
      // We're inside a cut segment — normal playback
      setCurrentTime(virtualTime);
    } else if (segmentIndex >= 0 && segmentIndex < sortedSegments.length) {
      // We're in a gap — skip to the next segment start
      video.currentTime = sortedSegments[segmentIndex].start;
    } else {
      // Past all segments — pause at the end
      video.pause();
      setCurrentTime(virtualDuration);
    }
  }, [sortedSegments, virtualDuration]);

  // ── Seek to first segment on mount / when segments change ─────────────────
  useEffect(() => {
    if (videoRef.current && sortedSegments.length > 0) {
      videoRef.current.currentTime = sortedSegments[0].start;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.cutSegments.length]);

  // ── Default timeline zoom to 10s intervals ────────────────────────────────
  const zoomInitialized = useRef(false);
  useEffect(() => {
    if (virtualDuration > 10 && !zoomInitialized.current) {
      zoomInitialized.current = true;
      setTimelineZoom(virtualDuration / 10);
    }
  }, [virtualDuration]);

  // ── Auto-fit left panel width to video aspect ratio ────────────────────────
  const videoContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const vc = videoContainerRef.current;
    const split = transcribeSplitRef.current;
    if (!vc || !split || transcribeLeftW !== null) return;
    const compute = () => {
      const videoH = vc.clientHeight;
      if (videoH <= 0) return;
      const idealW = Math.round(videoH * videoAspect);
      const cw = split.clientWidth;
      setTranscribeLeftW(Math.max(250, Math.min(idealW, cw * 0.7)));
    };
    requestAnimationFrame(compute);
  }, [videoAspect, transcribeLeftW]);

  // ── Custom transport controls ─────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // If at the end, restart from the beginning of the first segment
      if (currentTime >= virtualDuration && sortedSegments.length > 0) {
        v.currentTime = sortedSegments[0].start;
        setCurrentTime(0);
      }
      v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }, [currentTime, virtualDuration, sortedSegments]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  }, []);

  // Sync isPlaying state when video pauses/plays externally
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => { v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause); };
  }, []);

  // ── Load Whisper ──────────────────────────────────────────────────────────
  const loadWhisper = useCallback((): Promise<void> => {
    const worker = whisperWorkerRef.current;
    if (!worker) return Promise.reject(new Error('No worker'));
    patch({ status: 'loading-model', statusMsg: 'Loading Whisper model…' });

    return new Promise<void>((resolve, reject) => {
      worker.onerror = (e) => {
        console.error('[TranscribeTab] worker error:', e);
        reject(new Error(`Worker error: ${e.message ?? 'unknown'}`));
      };
      const cleanup = () => { worker.onmessage = null; };
      worker.onmessage = (e) => {
        const { type, payload } = e.data;
        console.log('[TranscribeTab] worker message:', type, payload);
        if (type === 'ready') {
          cleanup();
          setModelLoaded(true);
          setDownloadProgress(null);
          setActiveDevice(payload.device ?? 'webgpu');
          patch({ status: 'idle', statusMsg: 'Model ready.' });
          resolve();
        } else if (type === 'download-progress') {
          const { status: pStatus, file, progress: pProgress, loaded, total } = payload;
          setDownloadProgress({ file, progress: pProgress ?? 0 });
          if (pStatus === 'initiate') {
            patch({ statusMsg: `Starting download: ${file}` });
          } else if (pStatus === 'progress' && file !== 'total') {
            const pct = Math.round(pProgress ?? 0);
            const mb = total ? ` (${(loaded / 1e6).toFixed(1)}/${(total / 1e6).toFixed(0)} MB)` : '';
            patch({ statusMsg: `Downloading: ${file} — ${pct}%${mb}` });
          } else if (pStatus === 'progress' && file === 'total') {
            patch({ statusMsg: `Overall progress: ${Math.round(pProgress ?? 0)}%` });
          } else if (pStatus === 'done') {
            patch({ statusMsg: `Downloaded: ${file} ✓` });
          }
        } else if (type === 'status') {
          patch({ statusMsg: payload });
        } else if (type === 'error') {
          cleanup();
          console.error('[TranscribeTab] worker error message:', payload);
          reject(new Error(payload));
        }
      };
      console.log('[TranscribeTab] Sending load message to worker, modelId:', state.whisperModelId);
      worker.postMessage({
        type: 'load',
        payload: {
          modelId: state.whisperModelId,
        },
      });
      console.log('[TranscribeTab] load message sent');
    });
  }, [whisperWorkerRef, patch, state.whisperModelId]);

  // ── Run Transcription ─────────────────────────────────────────────────────
  const runTranscription = useCallback(async () => {
    if (!state.videoFile) return;
    patch({ chunks: [], error: null, status: 'extracting', statusMsg: 'Extracting cut audio…' });

    try {
      const stitched = await extractCutAudio(state.cutSegments);
      console.log(`[TranscribeTab] Stitched audio: ${stitched.length} samples (${(stitched.length / 16000).toFixed(1)}s)`);
      if (stitched.length === 0) {
        patch({ error: 'Audio extraction produced empty result. Check cut segments.', status: 'error', statusMsg: 'No audio extracted' });
        return;
      }
      patch({ audioSamples: stitched, audioDuration: stitched.length / 16000, status: 'transcribing', statusMsg: 'Starting transcription…' });

      if (state.transcribeMode === 'webgpu') {
        if (!modelLoaded) await loadWhisper();
        await transcribeWebGPU(stitched);
      } else {
        if (!state.groqApiKey.trim()) {
          patch({ error: 'Enter your Groq API key first.', status: 'error', statusMsg: 'API key required' });
          return;
        }
        await transcribeGroq(stitched);
      }
      patch({ status: 'done', statusMsg: 'Transcription complete!' });
    } catch (e) {
      patch({ error: String(e), status: 'error', statusMsg: 'Transcription failed' });
    }
  }, [state, patch, extractCutAudio, modelLoaded, loadWhisper]);

  const transcribeWebGPU = async (samples: Float32Array) => {
    const worker = whisperWorkerRef.current!;
    const allChunks: TranscriptChunk[] = [];

    const SAMPLE_RATE = 16000;
    const CHUNK_SECS = 30;
    const OVERLAP_SECS = 1;
    const MIN_SEGMENT_SECS = 3;
    const chunkSamples = CHUNK_SECS * SAMPLE_RATE;
    const stepSamples = (CHUNK_SECS - OVERLAP_SECS) * SAMPLE_RATE;
    const totalDuration = samples.length / SAMPLE_RATE;

    const segments: { audio: Float32Array; startSec: number }[] = [];
    for (let offset = 0; offset < samples.length; offset += stepSamples) {
      const end = Math.min(offset + chunkSamples, samples.length);
      const remainingSamples = samples.length - offset;

      if (segments.length > 0 && remainingSamples < MIN_SEGMENT_SECS * SAMPLE_RATE) {
        const lastSeg = segments[segments.length - 1];
        const extendedEnd = samples.length;
        segments[segments.length - 1] = {
          audio: samples.slice(Math.round(lastSeg.startSec * SAMPLE_RATE), extendedEnd),
          startSec: lastSeg.startSec,
        };
        break;
      }

      segments.push({
        audio: samples.slice(offset, end),
        startSec: offset / SAMPLE_RATE,
      });
      if (end >= samples.length) break;
    }

    console.log(`[TranscribeTab] Splitting ${totalDuration.toFixed(1)}s audio into ${segments.length} chunks`);

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segEnd = seg.startSec + seg.audio.length / SAMPLE_RATE;
      patch({ statusMsg: `Transcribing segment ${i + 1}/${segments.length} (${seg.startSec.toFixed(0)}s–${segEnd.toFixed(0)}s)…` });

      try {
        await new Promise<void>((resolve, reject) => {
          const handler = (e: MessageEvent) => {
            const { type, payload } = e.data;
            if (type === 'done') {
              worker.removeEventListener('message', handler);
              const rawChunks = payload as Array<{ start: number; end: number; text: string }>;
              console.log(`[TranscribeTab] Worker returned ${rawChunks.length} chunks for segment ${i + 1}`, rawChunks);
              allChunks.push(...rawChunks.map((c) => ({ ...c, id: generateId() })));
              resolve();
            } else if (type === 'status') {
              patch({ statusMsg: `[${i + 1}/${segments.length}] ${payload as string}` });
            } else if (type === 'partial') {
              patch({ statusMsg: `[${i + 1}/${segments.length}] ${(payload as string).slice(-60)}` });
            } else if (type === 'error') {
              worker.removeEventListener('message', handler);
              reject(new Error(payload as string));
            }
          };
          worker.addEventListener('message', handler);
          const samplesCopy = seg.audio.slice(0);
          worker.postMessage(
            { type: 'run', payload: { audio: samplesCopy, sampleRate: SAMPLE_RATE, segmentStartSec: seg.startSec, audioDurationSec: seg.audio.length / SAMPLE_RATE, language: state.transcribeLanguage.trim() || undefined, prompt: state.keyterms.trim() || undefined } },
            [samplesCopy.buffer]
          );
        });
      } catch (err) {
        console.warn(`[TranscribeTab] Segment ${i + 1} failed:`, err);
        patch({ statusMsg: `Segment ${i + 1} failed, continuing…` });
      }

      patch({ chunks: [...allChunks] });
    }

    patch({ chunks: allChunks });
  };

  const transcribeGroq = async (samples: Float32Array) => {
    const SAMPLE_RATE = 16000;
    // Groq Whisper rejects files >25 MB.
    // At 16 kHz mono PCM16: 1 s = 32 000 bytes → 500 s ≈ 16 MB (safe margin).
    const CHUNK_SECS = 500;
    const chunkSamples = CHUNK_SECS * SAMPLE_RATE;
    const totalChunks = Math.ceil(samples.length / chunkSamples);

    const lang = state.transcribeLanguage.trim() || undefined;
    const key  = state.groqApiKey.trim();
    const prompt = state.keyterms.trim() || undefined;
    const allChunks: TranscriptChunk[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const startSample = i * chunkSamples;
      const endSample   = Math.min(startSample + chunkSamples, samples.length);
      const chunk       = samples.slice(startSample, endSample);
      const startSec    = startSample / SAMPLE_RATE;
      const endSec      = endSample   / SAMPLE_RATE;

      patch({ statusMsg: `Groq: sending chunk ${i + 1}/${totalChunks} (${startSec.toFixed(0)}s–${endSec.toFixed(0)}s)…` });

      try {
        const result = await transcribeWithGroq(chunk, SAMPLE_RATE, startSec, key, lang, prompt);
        allChunks.push(...result);
        patch({ chunks: [...allChunks] }); // stream results progressively
      } catch (err) {
        console.warn(`[Groq] Chunk ${i + 1}/${totalChunks} failed:`, err);
        patch({ statusMsg: `Chunk ${i + 1} failed, continuing…` });
      }
    }

    patch({ chunks: allChunks });
  };

  // ── Caption editing ───────────────────────────────────────────────────────
  const updateChunk = (id: string, updates: Partial<TranscriptChunk>) => {
    patch({ chunks: state.chunks.map((c) => c.id === id ? { ...c, ...updates } : c) });
  };

  const deleteChunk = (id: string) => {
    patch({ chunks: state.chunks.filter((c) => c.id !== id) });
  };

  const addChunk = () => {
    const last = state.chunks[state.chunks.length - 1];
    const start = last ? last.end + 0.1 : 0;
    const newChunk: TranscriptChunk = {
      id: generateId(),
      start,
      end: start + 3,
      text: '',
      manual: true,
    };
    patch({ chunks: [...state.chunks, newChunk] });
  };

  // Insert a new chunk between two existing ones (after index)
  const insertChunkAfter = (index: number) => {
    const prev = state.chunks[index];
    const next = state.chunks[index + 1];
    const start = prev ? prev.end : 0;
    const end = next ? Math.min(prev.end + 3, next.start) : start + 3;
    const newChunk: TranscriptChunk = {
      id: generateId(),
      start,
      end: Math.max(end, start + 0.5),
      text: '',
      manual: prev?.manual ? false : true,
    };
    const updated = [...state.chunks];
    updated.splice(index + 1, 0, newChunk);
    patch({ chunks: updated });
  };

  // Insert a new chunk before a given index
  const insertChunkBefore = (index: number) => {
    const current = state.chunks[index];
    const prev = state.chunks[index - 1];
    const end = current ? current.start : 3;
    const start = prev ? Math.max(prev.end, end - 3) : Math.max(0, end - 3);
    const newChunk: TranscriptChunk = {
      id: generateId(),
      start,
      end: Math.max(end, start + 0.5),
      text: '',
      manual: current?.manual ? false : true,
    };
    const updated = [...state.chunks];
    updated.splice(index, 0, newChunk);
    patch({ chunks: updated });
  };

  // Split a chunk at the cursor position (Shift+Enter)
  const splitChunkAtCursor = (chunkId: string, cursorPos: number) => {
    const idx = state.chunks.findIndex(c => c.id === chunkId);
    if (idx < 0) return;
    const chunk = state.chunks[idx];
    const text = chunk.text;
    if (cursorPos <= 0 || cursorPos >= text.length) return;

    const beforeText = text.slice(0, cursorPos).trim();
    const afterText = text.slice(cursorPos).trim();
    if (!beforeText && !afterText) return;

    // Proportional split based on character position
    const ratio = cursorPos / text.length;
    const duration = chunk.end - chunk.start;
    const splitTime = chunk.start + duration * ratio;

    const updatedChunks = [...state.chunks];
    updatedChunks[idx] = { ...chunk, text: beforeText, end: splitTime };
    updatedChunks.splice(idx + 1, 0, {
      id: generateId(),
      start: splitTime,
      end: chunk.end,
      text: afterText,
      manual: chunk.manual ? false : true,
    });
    patch({ chunks: updatedChunks });
  };

  // Click on caption timeline → seek
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || virtualDuration === 0) return;
    // Don't seek if we just finished a drag
    if (dragRef.current.justDragged) {
      dragRef.current.justDragged = false;
      return;
    }
    const rect = timelineRef.current.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * virtualDuration;
    seekVideo(t);
  };

  // ── Timeline drag-to-trim ───────────────────────────────────────────────
  const dragRef = useRef<{ active: boolean; chunkId: string; edge: 'start' | 'end'; justDragged: boolean }>({
    active: false, chunkId: '', edge: 'start', justDragged: false,
  });

  const startDrag = (chunkId: string, edge: 'start' | 'end', e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { active: true, chunkId, edge, justDragged: false };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current.active || !timelineRef.current || virtualDuration === 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const t = Math.max(0, Math.min(virtualDuration, ((ev.clientX - rect.left) / rect.width) * virtualDuration));
      const chunkIdx = state.chunks.findIndex(c => c.id === dragRef.current.chunkId);
      if (chunkIdx < 0) return;
      const chunk = state.chunks[chunkIdx];
      dragRef.current.justDragged = true;

      if (dragRef.current.edge === 'start') {
        const prevChunk = state.chunks[chunkIdx - 1];
        const minStart = prevChunk ? prevChunk.end : 0;
        const newStart = Math.max(minStart, Math.min(t, chunk.end - 0.1));
        updateChunk(chunk.id, { start: newStart });
      } else {
        const nextChunk = state.chunks[chunkIdx + 1];
        const maxEnd = nextChunk ? nextChunk.start : virtualDuration;
        const newEnd = Math.min(maxEnd, Math.max(t, chunk.start + 0.1));
        updateChunk(chunk.id, { end: newEnd });
      }
    };

    const onUp = () => {
      dragRef.current.active = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // justDragged stays true until the next click is handled
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Nudge timestamp by ±step seconds, clamped
  const nudgeChunkStart = (id: string, step: number) => {
    const chunk = state.chunks.find(c => c.id === id);
    if (!chunk) return;
    const newStart = Math.max(0, Math.min(chunk.start + step, chunk.end - 0.1));
    updateChunk(id, { start: newStart });
  };

  const nudgeChunkEnd = (id: string, step: number) => {
    const chunk = state.chunks.find(c => c.id === id);
    if (!chunk) return;
    const newEnd = Math.max(chunk.start + 0.1, Math.min(chunk.end + step, virtualDuration || Infinity));
    updateChunk(id, { end: newEnd });
  };

  // Auto-scroll caption list to active chunk
  const captionListRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeRowRef.current && captionListRef.current) {
      const list = captionListRef.current;
      const row = activeRowRef.current;
      const rowTop = row.offsetTop;
      const rowBottom = rowTop + row.offsetHeight;
      const listTop = list.scrollTop;
      const listBottom = listTop + list.clientHeight;
      if (rowTop < listTop || rowBottom > listBottom) {
        list.scrollTo({ top: rowTop - list.clientHeight / 2 + row.offsetHeight / 2, behavior: 'smooth' });
      }
    }
  }, [activeChunk?.id]);

  if (!state.videoFile) {
    return (
      <EmptyState message="Import a video first" />
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

      {/* Guide popover */}
      {showHelp && <GuidePopover guide={transcribeGuide} />}

      <div ref={transcribeSplitRef} style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* ── Left panel: video with subtitle overlay + controls ── */}
        <div style={{ width: transcribeLeftW ?? '50%', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Video with subtitle overlay — zoomable */}
          <div
            ref={videoContainerRef}
            style={{
              position: 'relative', background: '#000', flex: 1, minHeight: 0,
              overflow: videoZoom > 1 ? 'auto' : 'hidden',
              cursor: videoZoom > 1 ? 'grab' : 'default',
            }}
            onWheel={(e) => {
              e.preventDefault();
              setVideoZoom(z => Math.max(1, Math.min(5, z + (e.deltaY < 0 ? 0.25 : -0.25))));
            }}
          >
            <video
              ref={videoRef}
              src={state.videoObjectUrl ?? undefined}
              style={{
                width: `${videoZoom * 100}%`, height: `${videoZoom * 100}%`,
                display: 'block', objectFit: 'contain', cursor: 'pointer',
                transformOrigin: 'center center',
              }}
              onTimeUpdate={handleTimeUpdate}
              onClick={togglePlay}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth && v.videoHeight) setVideoAspect(v.videoWidth / v.videoHeight);
              }}
            />

            {/* Subtitle overlay */}
            {showCaptions && activeChunk && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 14,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  maxWidth: '90%',
                  textAlign: 'center',
                  pointerEvents: 'none',
                  zIndex: 10,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    background: 'rgba(0,0,0,0.82)',
                    color: '#fff',
                    fontSize: 15,
                    fontWeight: 500,
                    lineHeight: 1.45,
                    padding: '5px 12px',
                    borderRadius: 6,
                    backdropFilter: 'blur(4px)',
                    WebkitBackdropFilter: 'blur(4px)',
                    letterSpacing: '0.01em',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {activeChunk.text}
                </span>
              </div>
            )}

            {/* Play indicator overlay (shows briefly on click) */}
            {!isPlaying && (
              <div
                style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(0,0,0,0.3)',
                  pointerEvents: 'none', zIndex: 5,
                }}
              >
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
                  <svg viewBox="0 0 24 24" fill="white" width="24" height="24"><polygon points="6,3 20,12 6,21" /></svg>
                </div>
              </div>
            )}
          </div>

          {/* Custom transport bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
            background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            {/* Play/Pause */}
            <button onClick={togglePlay} className="btn btn-icon" style={{ fontSize: 14, padding: 4 }} title={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? '⏸' : '▶'}
            </button>

            {/* Virtual time display */}
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', minWidth: 50, textAlign: 'center' }}>
              {formatTimeDisplay(currentTime)}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>/</span>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-dim)', minWidth: 50 }}>
              {formatTimeDisplay(virtualDuration)}
            </span>

            {/* Speed buttons */}
            <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
              {([0.5, 0.75, 1] as const).map(rate => (
                <button
                  key={rate}
                  className="btn btn-icon"
                  style={{
                    fontSize: 9, padding: '2px 5px', fontFamily: 'monospace',
                    opacity: playbackRate === rate ? 1 : 0.4,
                    background: playbackRate === rate ? 'var(--accent-subtle)' : 'transparent',
                  }}
                  onClick={() => {
                    setPlaybackRate(rate);
                    if (videoRef.current) videoRef.current.playbackRate = rate;
                  }}
                  title={`${rate}× speed`}
                >
                  {rate}×
                </button>
              ))}
            </div>

            <div style={{ flex: 1 }} />

            {/* Zoom indicator */}
            {videoZoom > 1 && (
              <button
                onClick={() => setVideoZoom(1)}
                className="btn btn-icon"
                style={{ fontSize: 10, padding: '2px 6px', fontFamily: 'monospace' }}
                title="Reset zoom"
              >
                {Math.round(videoZoom * 100)}%
              </button>
            )}

            {/* Caption toggle */}
            <button
              onClick={() => setShowCaptions(v => !v)}
              className="btn btn-icon"
              style={{ fontSize: 12, padding: 4, opacity: showCaptions ? 1 : 0.4 }}
              title={showCaptions ? 'Hide captions' : 'Show captions'}
            >
              CC
            </button>

            {/* Mute */}
            <button onClick={toggleMute} className="btn btn-icon" style={{ fontSize: 13, padding: 4 }} title={isMuted ? 'Unmute' : 'Mute'}>
              {isMuted ? '🔇' : '🔊'}
            </button>
          </div>

          {/* Caption mini-timeline (zoomable) */}
          <div style={{ padding: '4px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {/* Zoom controls row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px 4px', fontSize: 9, color: 'var(--text-dim)' }}>
              <span style={{ fontFamily: 'monospace' }}>{formatTimeDisplay(currentTime)} / {formatTimeDisplay(virtualDuration)}</span>
              {timelineZoom > 1 && (
                <button
                  onClick={() => setTimelineZoom(1)}
                  className="btn btn-icon"
                  style={{ fontSize: 9, padding: '1px 5px', fontFamily: 'monospace' }}
                  title="Reset timeline zoom"
                >
                  {Math.round(timelineZoom * 100)}% ×
                </button>
              )}
            </div>
            <div
              ref={timelineScrollRef}
              style={{ overflowX: 'auto', overflowY: 'hidden', padding: '0 12px', cursor: timelineZoom > 1 ? 'grab' : 'default' }}
              onWheel={(e) => {
                e.preventDefault();
                const el = timelineScrollRef.current;
                if (!el || virtualDuration === 0) return;
                const maxZoom = virtualDuration > 5 ? virtualDuration / 5 : 1;
                const oldZoom = timelineZoom;
                const newZoom = Math.max(1, Math.min(maxZoom, oldZoom + (e.deltaY < 0 ? 0.5 : -0.5)));
                if (newZoom === oldZoom) return;

                // Anchor on playhead position
                const containerW = el.clientWidth;
                const playheadRatio = currentTime / virtualDuration;
                const oldTrackW = containerW * oldZoom;
                const newTrackW = containerW * newZoom;
                const playheadOldPx = playheadRatio * oldTrackW;
                const playheadNewPx = playheadRatio * newTrackW;
                const playheadViewOffset = playheadOldPx - el.scrollLeft;

                setTimelineZoom(newZoom);
                requestAnimationFrame(() => {
                  el.scrollLeft = playheadNewPx - playheadViewOffset;
                });
              }}
              onMouseDown={(e) => {
                if (e.button !== 1 || !timelineScrollRef.current) return;
                e.preventDefault();
                const el = timelineScrollRef.current;
                const startX = e.clientX;
                const startScroll = el.scrollLeft;
                el.style.cursor = 'grabbing';
                const onMove = (ev: MouseEvent) => {
                  el.scrollLeft = startScroll - (ev.clientX - startX);
                };
                const onUp = () => {
                  el.style.cursor = timelineZoom > 1 ? 'grab' : 'default';
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
            >
              <div
                ref={timelineRef}
                className="timeline-track"
                style={{ height: 84, cursor: 'crosshair', width: `${timelineZoom * 100}%`, minWidth: '100%' }}
                onClick={handleTimelineClick}
              >
                <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-elevated)' }} />
                {/* Divider between nav zone and chunk zone */}
                <div style={{ position: 'absolute', left: 0, right: 0, top: 27, height: 1, background: 'var(--border)', opacity: 0.4, zIndex: 0 }} />

                {virtualDuration > 0 && (() => {
                  // Lane assignment:
                  // manual chunks (split/add) → top zone (y=2, height=24)
                  // transcribed chunks → lower two lanes, alternating when adjacent
                  const LANE_H = 26;
                  const LANE_TOP = 30;
                  const GAP = 0.5;
                  const assignments: number[] = []; // -1 = top zone, 0/1 = lower lanes
                  let prevLane = 1; // so first non-manual goes to lane 0
                  for (let i = 0; i < state.chunks.length; i++) {
                    const c = state.chunks[i];
                    if (c.manual) {
                      assignments.push(-1);
                      // don't update prevLane — manual chunks don't affect alternation
                    } else {
                      const prev = state.chunks.slice(0, i).reverse().find(p => !p.manual);
                      const isAdjacent = prev && (c.start - prev.end) < GAP;
                      if (isAdjacent) {
                        const lane = prevLane === 0 ? 1 : 0;
                        assignments.push(lane);
                        prevLane = lane;
                      } else {
                        assignments.push(0);
                        prevLane = 0;
                      }
                    }
                  }

                  return state.chunks.map((c, ci) => (
                  <div
                    key={c.id}
                    style={{
                      position: 'absolute',
                      left: `${(c.start / virtualDuration) * 100}%`,
                      width: `${((c.end - c.start) / virtualDuration) * 100}%`,
                      minWidth: 2,
                      top: assignments[ci] === -1 ? 2 : LANE_TOP + assignments[ci] * (LANE_H + 2),
                      height: assignments[ci] === -1 ? 24 : LANE_H,
                      background: c.id === activeChunk?.id ? 'var(--accent)' : 'rgba(255,255,255,0.25)',
                      borderRadius: 2,
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                      overflow: 'hidden',
                      zIndex: ci + 1,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (dragRef.current.justDragged) {
                        dragRef.current.justDragged = false;
                        return;
                      }
                      seekVideo(c.start);
                    }}
                  >
                    {/* Left drag handle (start) */}
                    <div
                      style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0, width: 8,
                        cursor: 'ew-resize', zIndex: 3,
                      }}
                      onMouseDown={(e) => startDrag(c.id, 'start', e)}
                    >
                      <div style={{
                        position: 'absolute', left: 1, top: 2, bottom: 2, width: 2,
                        borderRadius: 1, background: 'rgba(255,255,255,0.6)',
                      }} />
                    </div>
                    {/* Right drag handle (end) */}
                    <div
                      style={{
                        position: 'absolute', right: 0, top: 0, bottom: 0, width: 8,
                        cursor: 'ew-resize', zIndex: 5,
                      }}
                      onMouseDown={(e) => startDrag(c.id, 'end', e)}
                    >
                      <div style={{
                        position: 'absolute', right: 1, top: 2, bottom: 2, width: 2,
                        borderRadius: 1, background: 'rgba(255,255,255,0.6)',
                      }} />
                    </div>
                  </div>
                  ));
                })()}
                {virtualDuration > 0 && (
                  <div
                    className="timeline-playhead"
                    style={{ left: `${(currentTime / virtualDuration) * 100}%` }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Settings */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Actions row */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    onClick={runTranscription}
                    disabled={isRunning}
                  >
                    {isRunning ? '⏳ Working…' : hasChunks ? '↺ Re-transcribe' : '▶ Transcribe'}
                  </button>
                  {hasChunks && (
                    <button className="btn btn-ghost" onClick={() => setActiveTab('translate')}>
                      Translate →
                    </button>
                  )}
                </div>

                {/* Engine */}
                <div className="form-row">
                  <label className="form-label">Engine</label>
                  <select value={state.transcribeMode} onChange={e => patch({ transcribeMode: e.target.value as 'webgpu' | 'groq' })}>
                    <option value="webgpu">Local — Whisper WebGPU</option>
                    <option value="groq">Cloud — Groq API</option>
                  </select>
                  {activeDevice && state.transcribeMode === 'webgpu' && (
                    <span className={`badge ${activeDevice === 'webgpu' ? 'badge-accent' : 'badge-warning'}`}>
                      {activeDevice === 'webgpu' ? 'GPU' : 'CPU'}
                    </span>
                  )}
                </div>

                {/* Source Language */}
                <div className="form-row">
                  <label className="form-label">Language</label>
                  <select
                    value={state.transcribeLanguage}
                    onChange={e => patch({ transcribeLanguage: e.target.value })}
                  >
                    <option value="">Auto-detect</option>
                    <option value="af">Afrikaans</option>
                    <option value="ar">Arabic</option>
                    <option value="hy">Armenian</option>
                    <option value="az">Azerbaijani</option>
                    <option value="be">Belarusian</option>
                    <option value="bs">Bosnian</option>
                    <option value="bg">Bulgarian</option>
                    <option value="ca">Catalan</option>
                    <option value="zh">Chinese</option>
                    <option value="hr">Croatian</option>
                    <option value="cs">Czech</option>
                    <option value="da">Danish</option>
                    <option value="nl">Dutch</option>
                    <option value="en">English</option>
                    <option value="et">Estonian</option>
                    <option value="fi">Finnish</option>
                    <option value="fr">French</option>
                    <option value="gl">Galician</option>
                    <option value="de">German</option>
                    <option value="el">Greek</option>
                    <option value="he">Hebrew</option>
                    <option value="hi">Hindi</option>
                    <option value="hu">Hungarian</option>
                    <option value="id">Indonesian</option>
                    <option value="it">Italian</option>
                    <option value="ja">Japanese</option>
                    <option value="kn">Kannada</option>
                    <option value="kk">Kazakh</option>
                    <option value="ko">Korean</option>
                    <option value="lv">Latvian</option>
                    <option value="lt">Lithuanian</option>
                    <option value="mk">Macedonian</option>
                    <option value="ms">Malay</option>
                    <option value="mr">Marathi</option>
                    <option value="mi">Maori</option>
                    <option value="ne">Nepali</option>
                    <option value="no">Norwegian</option>
                    <option value="fa">Persian</option>
                    <option value="pl">Polish</option>
                    <option value="pt">Portuguese</option>
                    <option value="ro">Romanian</option>
                    <option value="ru">Russian</option>
                    <option value="sr">Serbian</option>
                    <option value="sk">Slovak</option>
                    <option value="sl">Slovenian</option>
                    <option value="es">Spanish</option>
                    <option value="sw">Swahili</option>
                    <option value="sv">Swedish</option>
                    <option value="tl">Tagalog</option>
                    <option value="ta">Tamil</option>
                    <option value="th">Thai</option>
                    <option value="tr">Turkish</option>
                    <option value="uk">Ukrainian</option>
                    <option value="ur">Urdu</option>
                    <option value="vi">Vietnamese</option>
                    <option value="cy">Welsh</option>
                  </select>
                </div>

                {/* Groq key */}
                {state.transcribeMode === 'groq' && (
                  <div>
                    <label className="form-label" style={{ display: 'block', marginBottom: 4 }}>Groq API Key</label>
                    <input
                      type="password"
                      value={state.groqApiKey}
                      onChange={(e) => patch({ groqApiKey: e.target.value })}
                      placeholder="gsk_..."
                      autoComplete="off"
                    />
                    <div className="form-hint">Session memory only — never written to disk.</div>
                  </div>
                )}

                {/* Download progress (WebGPU only) */}
                {state.transcribeMode === 'webgpu' && downloadProgress && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>
                      {downloadProgress.file} — {Math.round(downloadProgress.progress)}%
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${downloadProgress.progress}%` }} />
                    </div>
                  </div>
                )}

                {/* Keyterms — Groq only (local model doesn't support prompt conditioning) */}
                {state.transcribeMode === 'groq' && (
                  <div>
                    <label className="form-label" style={{ display: 'block', marginBottom: 4 }}>Key Terms</label>
                    <textarea
                      value={state.keyterms}
                      onChange={(e) => patch({ keyterms: e.target.value })}
                      placeholder="Names, brands, technical terms… (comma-separated)"
                      style={{ height: 56, resize: 'none' }}
                    />
                    <div className="form-hint">Helps the model spell names and terms correctly.</div>
                  </div>
                )}

                {/* Error */}
                {state.error && (
                  <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: 'var(--danger)' }}>
                    ⚠ {state.error}
                  </div>
                )}

                {/* Progress */}
                {isRunning && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{state.statusMsg}</div>
                    <div className="progress-track">
                      <div className="progress-fill indeterminate" />
                    </div>
                  </div>
                )}
          </div>
        </div>

        <ResizeHandle onResize={(d) => setTranscribeLeftW(prev => {
          const cw = transcribeSplitRef.current?.clientWidth ?? 800;
          const cur = prev ?? cw * 0.5;
          return Math.max(300, Math.min(cur + d, cw - 300));
        })} />

        {/* ── Right panel: caption list ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Captions {hasChunks && `(${state.chunks.length})`}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {activeChunk ? (<>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => {
                  const idx = state.chunks.findIndex(c => c.id === activeChunk.id);
                  if (idx >= 0) insertChunkBefore(idx);
                }}>+ Before</button>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => {
                  const idx = state.chunks.findIndex(c => c.id === activeChunk.id);
                  if (idx >= 0) insertChunkAfter(idx);
                }}>+ After</button>
              </>) : (<>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => {
                  const newChunk: TranscriptChunk = { id: generateId(), start: 0, end: Math.min(3, state.chunks[0]?.start ?? 3), text: '', manual: true };
                  patch({ chunks: [newChunk, ...state.chunks] });
                }}>+ First</button>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={addChunk}>+ Last</button>
              </>)}
            </div>
          </div>

          {/* Caption rows */}
          <div ref={captionListRef} style={{ flex: 1, overflowY: 'auto' }}>
            {!hasChunks && !isRunning && (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                {hasCut
                  ? 'Run transcription to generate captions.'
                  : 'Run transcription to generate captions from full video.'}
              </div>
            )}
            {state.chunks.map((chunk, i) => {
              const isActive = chunk.id === activeChunk?.id;
              return (
                <div key={chunk.id}>
                  <div
                    ref={isActive ? activeRowRef : undefined}
                    className={`caption-row${isActive ? ' playing' : ''}`}
                    style={{
                      borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    }}
                    onClick={() => {
                      // Only seek if playhead isn't already in this caption's range
                      if (currentTime < chunk.start || currentTime >= chunk.end) {
                        seekVideo(chunk.start);
                      }
                    }}
                  >
                    {/* Index */}
                    <div className="caption-index" style={{ paddingTop: 4 }}>#{i + 1}</div>

                    {/* Start time */}
                    <TimeCell
                      value={chunk.start}
                      max={chunk.end - 0.1}
                      onChange={(v) => updateChunk(chunk.id, { start: v })}
                    />

                    {/* End time */}
                    <TimeCell
                      value={chunk.end}
                      max={virtualDuration}
                      onChange={(v) => updateChunk(chunk.id, { end: v })}
                    />

                    {/* Text */}
                    <textarea
                      className="inline-edit"
                      value={chunk.text}
                      onChange={(e) => updateChunk(chunk.id, { text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.shiftKey) {
                          e.preventDefault();
                          const target = e.target as HTMLTextAreaElement;
                          splitChunkAtCursor(chunk.id, target.selectionStart);
                        }
                      }}
                      style={{ resize: 'none', height: 44, fontSize: 12, lineHeight: 1.5 }}
                      onClick={(e) => e.stopPropagation()}
                    />

                    {/* Delete */}
                    <button
                      className="btn btn-icon"
                      style={{ fontSize: 16, lineHeight: 1, marginTop: 6 }}
                      onClick={(e) => { e.stopPropagation(); deleteChunk(chunk.id); }}
                      title="Delete caption"
                    >
                      ×
                    </button>
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

// ── NudgeCell: timestamp display + ±0.1s / ±0.5s nudge buttons ───────────────
function NudgeCell({
  value,
  onNudge,
  onChange,
}: {
  value: number;
  onNudge: (step: number) => void;
  onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');

  const commit = () => {
    const match = raw.match(/^(\d+):(\d{2})(?:\.(\d+))?$/);
    if (match) {
      const m = parseInt(match[1], 10);
      const s = parseInt(match[2], 10);
      const frac = match[3] ? parseFloat(`0.${match[3]}`) : 0;
      const parsed = m * 60 + s + frac;
      if (!isNaN(parsed)) onChange(parsed);
    } else {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed)) onChange(parsed);
    }
    setEditing(false);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {/* −0.5 */}
      <button
        title="−0.5s"
        onClick={() => onNudge(-0.5)}
        style={{
          fontSize: 10, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid var(--border-soft)',
          background: 'var(--bg-input)', color: 'var(--text-muted)', borderRadius: 3, padding: '1px 5px',
          lineHeight: 1.4, transition: 'all 0.1s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-focus)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-soft)'; }}
      >−.5</button>

      {/* −0.1 */}
      <button
        title="−0.1s"
        onClick={() => onNudge(-0.1)}
        style={{
          fontSize: 10, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid var(--border-soft)',
          background: 'var(--bg-input)', color: 'var(--text-muted)', borderRadius: 3, padding: '1px 5px',
          lineHeight: 1.4, transition: 'all 0.1s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-focus)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-soft)'; }}
      >−.1</button>

      {/* Time display / inline edit */}
      {editing ? (
        <input
          autoFocus
          value={raw}
          onChange={e => setRaw(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          style={{
            fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-input)',
            border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text)',
            padding: '1px 6px', width: 72, outline: 'none', textAlign: 'center',
          }}
        />
      ) : (
        <div
          title="Click to edit"
          onClick={() => { setRaw(formatTimeDisplay(value)); setEditing(true); }}
          style={{
            fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', cursor: 'text',
            padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border-soft)',
            background: 'var(--bg-input)', width: 72, textAlign: 'center', userSelect: 'none',
          }}
        >
          {formatTimeDisplay(value)}
        </div>
      )}

      {/* +0.1 */}
      <button
        title="+0.1s"
        onClick={() => onNudge(0.1)}
        style={{
          fontSize: 10, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid var(--border-soft)',
          background: 'var(--bg-input)', color: 'var(--text-muted)', borderRadius: 3, padding: '1px 5px',
          lineHeight: 1.4, transition: 'all 0.1s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-focus)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-soft)'; }}
      >+.1</button>

      {/* +0.5 */}
      <button
        title="+0.5s"
        onClick={() => onNudge(0.5)}
        style={{
          fontSize: 10, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid var(--border-soft)',
          background: 'var(--bg-input)', color: 'var(--text-muted)', borderRadius: 3, padding: '1px 5px',
          lineHeight: 1.4, transition: 'all 0.1s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-focus)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-soft)'; }}
      >+.5</button>
    </div>
  );
}

// ── TimeCell: inline editable timestamp ──────────────────────────────────────
function TimeCell({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');

  const commit = () => {
    const match = raw.match(/^(\d+):(\d{2})(?:\.(\d+))?$/);
    if (match) {
      const m = parseInt(match[1], 10);
      const s = parseInt(match[2], 10);
      const frac = match[3] ? parseFloat(`0.${match[3]}`) : 0;
      const parsed = m * 60 + s + frac;
      if (!isNaN(parsed)) onChange(Math.min(parsed, max));
    } else {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed)) onChange(Math.min(parsed, max));
    }
    setEditing(false);
  };

  return editing ? (
    <input
      className="time-input"
      value={raw}
      autoFocus
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
    />
  ) : (
    <div
      className="time-input"
      style={{ cursor: 'text', userSelect: 'none' }}
      onClick={(e) => { e.stopPropagation(); setRaw(formatTimeDisplay(value)); setEditing(true); }}
    >
      {formatTimeDisplay(value)}
    </div>
  );
}



// ── CaptionGap: thin gap between rows, shows "Add caption" on prolonged hover ──
function CaptionGap({ onClick }: { onClick: () => void }) {
  return (
    <div
      className="caption-gap"
      style={{
        height: 6,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <button
        className="caption-gap-btn"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        + Add caption
      </button>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      {message}
    </div>
  );
}
