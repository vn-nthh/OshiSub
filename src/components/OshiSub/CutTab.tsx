// CutTab.tsx — Single zoomable timeline, I→O clip creation workflow

import { useState, useRef, useCallback, useEffect } from 'react';
import type { CutSegment } from '@/types';
import { generateId, formatTimeDisplay, parseTimeInput, clamp } from '@/lib/utils';
import { ResizeHandle } from './ResizeHandle';

interface CutTabProps {
  videoFile: File | null;
  videoObjectUrl: string | null;
  videoDuration: number;
  cutSegments: CutSegment[];
  onSegmentsChange: (segs: CutSegment[]) => void;
  onConfirmCut: () => void;
  showHelp: boolean;
  onToggleHelp: () => void;
}

const SPEEDS = [0.5, 0.75, 1, 1.5];

// Auto-pick a tick interval based on how many seconds are visible
function tickInterval(viewSpan: number): number {
  if (viewSpan <= 10)   return 1;
  if (viewSpan <= 60)   return 5;
  if (viewSpan <= 300)  return 30;
  if (viewSpan <= 1800) return 120;
  if (viewSpan <= 7200) return 600;
  return 1800;
}

// ─── Inline editable time field ───────────────────────────────────────────────
function InlineTime({ value, min, max, onChange, onSeek }: {
  value: number; min: number; max: number;
  onChange: (v: number) => void;
  onSeek?: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');
  const commit = () => {
    const p = parseTimeInput(raw);
    if (p !== null) { const v = clamp(p, min, max); onChange(v); onSeek?.(v); }
    setEditing(false);
  };
  if (editing) return (
    <input
      autoFocus value={raw}
      onChange={e => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      style={{ fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-input)', border: '1px solid var(--accent)', borderRadius: 3, color: 'var(--text)', padding: '1px 4px', width: 68, outline: 'none' }}
    />
  );
  return (
    <span
      title="Click to edit"
      onClick={() => { setRaw(formatTimeDisplay(value)); setEditing(true); }}
      style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text)', cursor: 'text', padding: '1px 4px', borderRadius: 3, border: '1px solid transparent', transition: 'border-color 0.1s' }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-soft)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}
    >
      {formatTimeDisplay(value)}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function CutTab({ videoFile, videoObjectUrl, videoDuration, cutSegments, onSegmentsChange, onConfirmCut, showHelp, onToggleHelp }: CutTabProps) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const previewRef  = useRef<number | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [speed, setSpeed]             = useState(1);
  // Pending in-point: user pressed I but hasn't pressed O yet
  const [pendingIn, setPendingIn]     = useState<number | null>(null);
  // Timeline view window
  const [viewStart, setViewStart]     = useState(0);
  const [viewSpan, setViewSpan]       = useState(0); // 0 = uninitialised
  // Panel sizing
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState<number | null>(null); // null = not yet measured

  // On video load, initialise view to 10s interval (or full duration if shorter)
  useEffect(() => {
    if (videoDuration > 0) {
      setViewStart(0);
      setViewSpan(Math.min(10, videoDuration));
    }
  }, [videoDuration]);

  const effectiveSpan = viewSpan > 0 ? viewSpan : videoDuration || 3600;

  // ── Derived helpers ──────────────────────────────────────────────────────
  const toPct    = (t: number) => clamp((t - viewStart) / effectiveSpan, 0, 1) * 100;
  const seekTo   = (t: number) => { if (videoRef.current) videoRef.current.currentTime = t; };
  const totalDur = cutSegments.reduce((a, s) => a + (s.end - s.start), 0);
  const selectedSeg = cutSegments.find(s => s.id === selectedId) ?? null;

  // ── Zoom (centred on a time point) ──────────────────────────────────────
  const zoomAt = useCallback((centerTime: number, factor: number) => {
    setViewSpan(prevSpan => {
      const newSpan = clamp(prevSpan * factor, 2, videoDuration || 3600);
      setViewStart(prev => {
        const ratio = (centerTime - prev) / prevSpan;
        return clamp(centerTime - ratio * newSpan, 0, Math.max(0, (videoDuration || 3600) - newSpan));
      });
      return newSpan;
    });
  }, [videoDuration]);

  // Auto-scroll to keep playhead in view while playing
  useEffect(() => {
    if (!videoDuration) return;
    const margin = effectiveSpan * 0.1;
    if (currentTime < viewStart + margin || currentTime > viewStart + effectiveSpan - margin) {
      const newStart = clamp(currentTime - effectiveSpan * 0.35, 0, Math.max(0, videoDuration - effectiveSpan));
      setViewStart(newStart);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime]);

  // ── Speed sync ──────────────────────────────────────────────────────────
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = speed; }, [speed]);

  // ── Preview clip ─────────────────────────────────────────────────────────
  const previewSeg = useCallback((seg: CutSegment) => {
    const v = videoRef.current; if (!v) return;
    if (previewRef.current) clearInterval(previewRef.current);
    v.currentTime = seg.start; v.playbackRate = speed; v.play();
    previewRef.current = window.setInterval(() => {
      if (!videoRef.current) return;
      if (videoRef.current.currentTime >= seg.end) { videoRef.current.pause(); clearInterval(previewRef.current!); previewRef.current = null; }
    }, 80);
  }, [speed]);
  useEffect(() => () => { if (previewRef.current) clearInterval(previewRef.current); }, []);

  // ── Segment CRUD ─────────────────────────────────────────────────────────
  const updateSeg = useCallback((id: string, up: Partial<CutSegment>) => {
    onSegmentsChange(cutSegments.map(s => s.id === id ? { ...s, ...up } : s));
  }, [cutSegments, onSegmentsChange]);

  const deleteSeg = useCallback((id: string) => {
    const next = cutSegments.filter(s => s.id !== id);
    onSegmentsChange(next);
    if (selectedId === id) setSelectedId(next[0]?.id ?? null);
  }, [cutSegments, onSegmentsChange, selectedId]);

  const createSeg = useCallback((start: number, end: number) => {
    const seg: CutSegment = { id: generateId(), start, end };
    onSegmentsChange([...cutSegments, seg]);
    setSelectedId(seg.id);
    return seg;
  }, [cutSegments, onSegmentsChange]);

  // ── Scroll-wheel zoom on timeline ────────────────────────────────────────
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const mouseTime = viewStart + ratio * effectiveSpan;
      const factor = e.deltaY > 0 ? 1.35 : 0.74;
      zoomAt(mouseTime, factor);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [viewStart, effectiveSpan, zoomAt]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const t = videoRef.current?.currentTime ?? 0;
      const v = videoRef.current;
      if (!v) return;

      switch (e.key) {
        case ' ': e.preventDefault(); v.paused ? v.play() : v.pause(); break;

        case 'i': case 'I':
          e.preventDefault();
          if (selectedId) {
            // Update selected clip's in point
            const seg = cutSegments.find(s => s.id === selectedId)!;
            updateSeg(selectedId, { start: clamp(t, 0, seg.end - 0.1) });
          } else {
            // Create a new clip at current position (same as N)
            createSeg(t, clamp(t + 30, t + 0.1, videoDuration));
          }
          break;

        case 'o': case 'O':
          e.preventDefault();
          if (selectedId) {
            // Update selected clip's out point, then deselect so user can mark new clips
            const seg = cutSegments.find(s => s.id === selectedId)!;
            updateSeg(selectedId, { end: clamp(t, seg.start + 0.1, videoDuration) });
            setSelectedId(null);
          }
          break;

        case 'n': case 'N':
          e.preventDefault();
          setPendingIn(null);
          createSeg(t, clamp(t + 30, t + 0.1, videoDuration));
          break;

        case 'Escape':
          setSelectedId(null);
          setPendingIn(null);
          break;

        case 'Delete': case 'Backspace':
          if (selectedId) { e.preventDefault(); deleteSeg(selectedId); }
          break;

        case 'Tab':
          if (cutSegments.length > 0) {
            e.preventDefault();
            const idx = cutSegments.findIndex(s => s.id === selectedId);
            const nxt = cutSegments[(idx + 1) % cutSegments.length];
            setSelectedId(nxt.id); seekTo(nxt.start);
          }
          break;

        case 'ArrowLeft':  e.preventDefault(); seekTo(clamp(t - (e.shiftKey ? 5 : 1/30), 0, videoDuration)); break;
        case 'ArrowRight': e.preventDefault(); seekTo(clamp(t + (e.shiftKey ? 5 : 1/30), 0, videoDuration)); break;

        // Zoom in/out with = / -
        case '=': case '+': e.preventDefault(); zoomAt(t, 0.5);  break;
        case '-': case '_': e.preventDefault(); zoomAt(t, 2.0);  break;

        case 'j': case 'J': setSpeed(s => Math.max(0.25, s / 2)); break;
        case 'k': case 'K': v.paused ? v.play() : v.pause(); break;
        case 'l': case 'L': setSpeed(s => Math.min(8, s * 2)); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, cutSegments, videoDuration, pendingIn, updateSeg, createSeg, deleteSeg, zoomAt]);

  // ── Timeline drag ────────────────────────────────────────────────────────
  const [dragging, setDragging] = useState<{
    id: string; handle: 'start' | 'end' | 'body';
    startX: number; origStart: number; origEnd: number;
  } | null>(null);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const el = timelineRef.current; if (!el) return;
      const rect = el.getBoundingClientRect();
      const dx = e.clientX - dragging.startX;
      const dt = (dx / rect.width) * effectiveSpan;
      const seg = cutSegments.find(s => s.id === dragging.id); if (!seg) return;

      if (dragging.handle === 'start') {
        updateSeg(dragging.id, { start: clamp(dragging.origStart + dt, 0, seg.end - 0.1) });
      } else if (dragging.handle === 'end') {
        updateSeg(dragging.id, { end: clamp(dragging.origEnd + dt, seg.start + 0.1, videoDuration) });
      } else {
        const dur = dragging.origEnd - dragging.origStart;
        const newStart = clamp(dragging.origStart + dt, 0, videoDuration - dur);
        updateSeg(dragging.id, { start: newStart, end: newStart + dur });
      }
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, cutSegments, effectiveSpan, videoDuration]);

  // Deferred drag: only starts after mouse moves >4px, so simple clicks fall through to timeline scrub
  const startDrag = (e: React.MouseEvent, id: string, handle: 'start' | 'end' | 'body', seg: CutSegment) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    let activated = false;

    const onMove = (ev: MouseEvent) => {
      if (!activated && Math.abs(ev.clientX - startX) > 4) {
        activated = true;
        // NOW we take over: stop scrubbing, start dragging
        setScrubbing(false);
        const v = videoRef.current;
        if (v && wasPlayingRef.current) v.play(); // restore play state stolen by scrub
        setSelectedId(id);
        setDragging({ id, handle, startX, origStart: seg.start, origEnd: seg.end });
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Immediate drag for edge handles — always captures the event (intent is clearly to resize)
  const startHandleDrag = (e: React.MouseEvent, id: string, handle: 'start' | 'end', seg: CutSegment) => {
    e.preventDefault(); e.stopPropagation();
    setSelectedId(id);
    setDragging({ id, handle, startX: e.clientX, origStart: seg.start, origEnd: seg.end });
  };

  // ── Timeline scrub (mousedown → drag → mouseup) ─────────────────────────
  const [scrubbing, setScrubbing] = useState(false);
  const scrubRaf = useRef<number>(0);
  const scrubTarget = useRef<number>(0);
  const wasPlayingRef = useRef(false);

  const scrubFromEvent = useCallback((clientX: number) => {
    const el = timelineRef.current;
    if (!el || !videoDuration) return;
    const rect = el.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    const t = viewStart + ratio * effectiveSpan;
    scrubTarget.current = t;
    setCurrentTime(t); // update playhead position immediately (cheap state)
    // Throttle actual video seeks to one per animation frame
    if (!scrubRaf.current) {
      scrubRaf.current = requestAnimationFrame(() => {
        scrubRaf.current = 0;
        const v = videoRef.current;
        if (!v) return;
        const target = scrubTarget.current;
        // fastSeek snaps to nearest keyframe — much faster than exact seek
        if ('fastSeek' in v && typeof v.fastSeek === 'function') {
          v.fastSeek(target);
        } else {
          v.currentTime = target;
        }
      });
    }
  }, [viewStart, effectiveSpan, videoDuration]);

  const handleTimelineMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      // Middle mouse: pan the timeline
      e.preventDefault();
      const startX = e.clientX;
      const startViewStart = viewStart;
      const el = timelineRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dt = -(dx / rect.width) * effectiveSpan;
        setViewStart(clamp(startViewStart + dt, 0, Math.max(0, (videoDuration || 3600) - effectiveSpan)));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    setSelectedId(null);
    // Pause during scrub for faster seeking — resume on mouseup
    const v = videoRef.current;
    if (v) { wasPlayingRef.current = !v.paused; v.pause(); }
    setScrubbing(true);
    scrubFromEvent(e.clientX);
  }, [scrubFromEvent, viewStart, effectiveSpan, videoDuration]);

  useEffect(() => {
    if (!scrubbing) return;
    const onMove = (e: MouseEvent) => scrubFromEvent(e.clientX);
    const onUp = () => {
      setScrubbing(false);
      // Do one final exact seek for precision
      const v = videoRef.current;
      if (v) {
        v.currentTime = scrubTarget.current;
        if (wasPlayingRef.current) v.play();
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (scrubRaf.current) cancelAnimationFrame(scrubRaf.current);
    };
  }, [scrubbing, scrubFromEvent]);

  if (!videoFile) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>✂</div>
          <div>Import a video first</div>
        </div>
      </div>
    );
  }

  const interval = tickInterval(effectiveSpan);
  const firstTick = Math.ceil(viewStart / interval) * interval;

  const isFullView = effectiveSpan >= videoDuration * 0.99;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

      {/* Help popover (anchored to top-left of body) */}
      {showHelp && (
        <div style={{
          position: 'absolute', top: 4, right: 12, zIndex: 50,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '14px 16px', width: 260,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <kbd style={{ padding: '1px 6px', borderRadius: 3, border: '1px solid var(--border-soft)', background: 'var(--bg-base)', fontFamily: 'monospace', fontWeight: 700, fontSize: 10 }}>I</kbd>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Mark <strong style={{ color: 'var(--text)' }}>in point</strong></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <kbd style={{ padding: '1px 6px', borderRadius: 3, border: '1px solid var(--border-soft)', background: 'var(--bg-base)', fontFamily: 'monospace', fontWeight: 700, fontSize: 10 }}>O</kbd>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Mark <strong style={{ color: 'var(--text)' }}>out point</strong> — creates clip</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <kbd style={{ padding: '1px 6px', borderRadius: 3, border: '1px solid var(--border-soft)', background: 'var(--bg-base)', fontFamily: 'monospace', fontWeight: 700, fontSize: 10 }}>N</kbd>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Quick <strong style={{ color: 'var(--text)' }}>30s clip</strong></span>
          </div>
          <div style={{ height: 1, background: 'var(--border)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M9 9V4.5A1.5 1.5 0 0 1 10.5 3 1.5 1.5 0 0 1 12 4.5V12"/>
              <path d="M6 15a6 6 0 0 0 12 0V8.5"/>
              <path d="M6 11V8.5A1.5 1.5 0 0 1 7.5 7 1.5 1.5 0 0 1 9 8.5"/>
            </svg>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}><strong style={{ color: 'var(--text)' }}>Double-click</strong> to seek</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/>
              <polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/>
              <line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>
            </svg>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}><strong style={{ color: 'var(--text)' }}>Drag</strong> clips · handles to resize</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <rect x="6" y="2" width="12" height="20" rx="6"/><line x1="12" y1="6" x2="12" y2="10"/>
            </svg>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}><strong style={{ color: 'var(--text)' }}>Scroll</strong> to zoom timeline</span>
          </div>
        </div>
      )}

      {/* ── Body: video (left) + clip list (right) ──────────────────────── */}
      <div ref={containerRef} style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* ── Left: video + timeline ───────────────────────────────────── */}
        <div style={{ width: leftWidth ?? '62%', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Video */}
          <div style={{ flex: 1, minHeight: 0, background: '#000' }}>
            <video
              ref={videoRef}
              src={videoObjectUrl ?? undefined}
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
              onTimeUpdate={e => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
            />
          </div>

          {/* Speed + zoom row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600, marginRight: 2 }}>Speed</span>
            {SPEEDS.map(s => (
              <button key={s} onClick={() => { setSpeed(s); if (videoRef.current) videoRef.current.playbackRate = s; }} style={{
                fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.1s',
                background: speed === s ? 'var(--accent)' : 'transparent',
                border: `1px solid ${speed === s ? 'var(--accent)' : 'var(--border-soft)'}`,
                color: speed === s ? 'var(--text-on-accent)' : 'var(--text)',
              }}>{s}×</button>
            ))}

            <div style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 3px' }} />

            <button
              onClick={() => {
                if (isFullView) {
                  // Switch to 10s centered on playhead
                  const center = videoRef.current?.currentTime ?? 0;
                  const span = Math.min(10, videoDuration);
                  setViewSpan(span);
                  setViewStart(clamp(center - span / 2, 0, Math.max(0, videoDuration - span)));
                } else {
                  // Switch to full
                  setViewStart(0);
                  setViewSpan(videoDuration);
                }
              }}
              style={{
                fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.1s',
                background: 'transparent',
                border: '1px solid var(--border-soft)',
                color: 'var(--text)',
              }}
              title={isFullView ? 'Zoom to 10s around playhead' : 'Show full timeline'}
            >{isFullView ? '10s' : 'Full'}</button>

            <div style={{ flex: 1 }} />
            <InlineTime
              value={currentTime}
              min={0}
              max={videoDuration}
              onChange={(t) => setCurrentTime(t)}
              onSeek={seekTo}
            />
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>/ {formatTimeDisplay(videoDuration)}</span>
          </div>

          {/* ── Timeline ─────────────────────────────────────────────── */}
          <div style={{ flexShrink: 0, padding: '10px 12px 10px', background: 'var(--bg-base)', borderTop: '1px solid var(--border)' }}>

            {/* Time labels row */}
            <div style={{ position: 'relative', height: 14, marginBottom: 4 }}>
              {(() => {
                const labels = [];
                for (let t = firstTick; t <= viewStart + effectiveSpan; t += interval) {
                  const pct = toPct(t);
                  if (pct < 0 || pct > 100) continue;
                  labels.push(
                    <span key={t} style={{
                      position: 'absolute', left: `${pct}%`, transform: 'translateX(-50%)',
                      fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap',
                      fontWeight: 500,
                    }}>
                      {formatTimeDisplay(t)}
                    </span>
                  );
                }
                return labels;
              })()}
            </div>

            {/* The actual timeline track */}
            <div
              ref={timelineRef}
              onMouseDown={handleTimelineMouseDown}
              title="Scroll to zoom · drag to scrub"
              style={{
                position: 'relative', height: 80,
                background: '#1a1d24',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 5, overflow: 'hidden',
                cursor: 'crosshair', userSelect: 'none',
              }}
            >
              {/* Alternating background bands between major ticks */}
              {(() => {
                const bands = [];
                let idx = 0;
                for (let t = firstTick; t <= viewStart + effectiveSpan; t += interval) {
                  const pct1 = toPct(t);
                  const pct2 = toPct(t + interval);
                  if (pct2 < 0 || pct1 > 100) { idx++; continue; }
                  if (idx % 2 === 1) {
                    bands.push(<div key={`band-${t}`} style={{
                      position: 'absolute', left: `${Math.max(pct1, 0)}%`, width: `${Math.min(pct2, 100) - Math.max(pct1, 0)}%`,
                      top: 0, bottom: 0, background: 'rgba(255,255,255,0.03)', pointerEvents: 'none',
                    }} />);
                  }
                  idx++;
                }
                return bands;
              })()}

              {/* Major tick lines */}
              {(() => {
                const lines = [];
                for (let t = firstTick; t <= viewStart + effectiveSpan; t += interval) {
                  const pct = toPct(t);
                  if (pct < 0 || pct > 100) continue;
                  lines.push(<div key={t} style={{ position: 'absolute', left: `${pct}%`, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.12)', pointerEvents: 'none' }} />);
                }
                return lines;
              })()}

              {/* Sub-tick lines (half-interval, shorter height) */}
              {(() => {
                const subInterval = interval / 2;
                if (subInterval < 0.25) return null; // don't render sub-ticks smaller than 250ms
                const ticks = [];
                const firstSub = Math.ceil(viewStart / subInterval) * subInterval;
                for (let t = firstSub; t <= viewStart + effectiveSpan; t += subInterval) {
                  // Skip if this aligns with a major tick
                  if (Math.abs(t % interval) < 0.001 || Math.abs(t % interval - interval) < 0.001) continue;
                  const pct = toPct(t);
                  if (pct < 0 || pct > 100) continue;
                  ticks.push(<div key={`sub-${t}`} style={{
                    position: 'absolute', left: `${pct}%`, top: '65%', bottom: 0, width: 1,
                    background: 'rgba(255,255,255,0.06)', pointerEvents: 'none',
                  }} />);
                }
                return ticks;
              })()}

              {/* Pending-in marker */}
              {pendingIn !== null && pendingIn >= viewStart && pendingIn <= viewStart + effectiveSpan && (
                <div style={{
                  position: 'absolute', left: `${toPct(pendingIn)}%`, top: 0, bottom: 0,
                  width: 2, background: 'var(--accent)', pointerEvents: 'none', zIndex: 10,
                }}>
                  <div style={{
                    position: 'absolute', top: 0, left: 3,
                    fontSize: 8, fontWeight: 700, letterSpacing: '0.06em',
                    color: 'var(--accent)', whiteSpace: 'nowrap',
                    textShadow: '0 0 4px rgba(0,0,0,0.8)',
                  }}>IN</div>
                </div>
              )}

              {/* Segments */}
              {cutSegments.map(seg => {
                const inView = seg.end > viewStart && seg.start < viewStart + effectiveSpan;
                if (!inView) return null;
                // Use unclamped percentages — parent overflow:hidden clips edges naturally
                const lPct = ((seg.start - viewStart) / effectiveSpan) * 100;
                const rPct = ((seg.end - viewStart) / effectiveSpan) * 100;
                const wPct = rPct - lPct;
                const isSel = seg.id === selectedId;
                return (
                  <div key={seg.id}
                    style={{
                      position: 'absolute', top: '35%', bottom: '15%',
                      left: `${lPct}%`, width: `${Math.max(wPct, 0.2)}%`,
                      background: isSel ? 'rgba(120,180,255,0.3)' : 'rgba(120,180,255,0.12)',
                      border: `1px solid ${isSel ? 'rgba(140,200,255,0.9)' : 'rgba(120,180,255,0.4)'}`,
                      borderRadius: 3, cursor: 'grab', boxSizing: 'border-box', zIndex: 2,
                    }}
                    onMouseDown={e => startDrag(e, seg.id, 'body', seg)}
                    onDoubleClick={e => { e.stopPropagation(); setSelectedId(seg.id); }}
                  >
                    {/* Left handle */}
                    <div
                      style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', background: 'rgba(140,200,255,0.6)', borderRadius: '3px 0 0 3px' }}
                      onMouseDown={e => startHandleDrag(e, seg.id, 'start', seg)}
                    />
                    {/* Right handle */}
                    <div
                      style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', background: 'rgba(140,200,255,0.6)', borderRadius: '0 3px 3px 0' }}
                      onMouseDown={e => startHandleDrag(e, seg.id, 'end', seg)}
                    />
                  </div>
                );
              })}

              {/* Playhead */}
              {videoDuration > 0 && (
                <div style={{
                  position: 'absolute', top: 0, bottom: 0, width: 2,
                  left: `${toPct(currentTime)}%`,
                  background: '#fff',
                  pointerEvents: 'none', zIndex: 20,
                  boxShadow: '0 0 6px rgba(255,255,255,0.4)',
                }}>
                  {/* Triangle cap */}
                  <div style={{
                    position: 'absolute', top: 0, left: -4,
                    width: 0, height: 0,
                    borderLeft: '5px solid transparent',
                    borderRight: '5px solid transparent',
                    borderTop: '6px solid #fff',
                  }} />
                </div>
              )}
            </div>

            {/* Minimap — only when zoomed in */}
            {!isFullView && videoDuration > 0 && (
              <div style={{
                position: 'relative', height: 8, marginTop: 6, borderRadius: 4,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                overflow: 'hidden',
              }}>
                {/* Segment markers on minimap */}
                {cutSegments.map(seg => {
                  const l = (seg.start / videoDuration) * 100;
                  const w = ((seg.end - seg.start) / videoDuration) * 100;
                  return <div key={`mm-${seg.id}`} style={{
                    position: 'absolute', top: 1, bottom: 1,
                    left: `${l}%`, width: `${Math.max(w, 0.3)}%`,
                    background: 'rgba(120,180,255,0.25)', borderRadius: 1, pointerEvents: 'none',
                  }} />;
                })}
                {/* Viewport region */}
                <div style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: `${(viewStart / videoDuration) * 100}%`,
                  width: `${(effectiveSpan / videoDuration) * 100}%`,
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: 3, boxSizing: 'border-box',
                }} />
                {/* Playhead on minimap */}
                <div style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: `${(currentTime / videoDuration) * 100}%`,
                  width: 1, background: 'rgba(255,255,255,0.6)', pointerEvents: 'none',
                }} />
              </div>
            )}

            {/* Range info */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 9, color: 'var(--text-muted)' }}>
              <span style={{ fontFamily: 'monospace' }}>{formatTimeDisplay(viewStart)}</span>
              <span style={{ fontFamily: 'monospace' }}>{formatTimeDisplay(Math.min(viewStart + effectiveSpan, videoDuration))}</span>
            </div>
          </div>

        </div>

        <ResizeHandle onResize={(d) => setLeftWidth(prev => {
          const cw = containerRef.current?.clientWidth ?? 800;
          const cur = prev ?? cw * 0.62;
          return clamp(cur + d, 250, cw - 200);
        })} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {/* Column headers */}
          <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'grid', gridTemplateColumns: '22px 1fr 1fr 52px 28px', gap: 4, flexShrink: 0, alignItems: 'center' }}>
            {['#', 'In', 'Out', 'Dur', ''].map((h, i) => (
              <span key={i} style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, textAlign: i === 0 ? 'right' : i >= 3 ? 'right' : 'left' }}>{h}</span>
            ))}
          </div>

          {/* Clip rows */}
          <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
            {cutSegments.length === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 11, lineHeight: 1.8 }}>
                No clips yet — use <kbd style={{ padding: '1px 5px', borderRadius: 3, border: '1px solid var(--border-soft)', background: 'var(--bg-elevated)', fontFamily: 'monospace', fontWeight: 700, fontSize: 10 }}>I</kbd> <kbd style={{ padding: '1px 5px', borderRadius: 3, border: '1px solid var(--border-soft)', background: 'var(--bg-elevated)', fontFamily: 'monospace', fontWeight: 700, fontSize: 10 }}>O</kbd> to mark clips
                <div style={{ marginTop: 8, fontSize: 10 }}>
                  or skip to <strong style={{ color: 'var(--text-muted)' }}>Transcribe Full</strong> for the entire video
                </div>
              </div>
            ) : cutSegments.map((seg, i) => {
              const isSel = seg.id === selectedId;
              return (
                <div key={seg.id}
                  onClick={() => { setSelectedId(seg.id); seekTo(seg.start); }}
                  style={{
                    display: 'grid', gridTemplateColumns: '22px 1fr 1fr 52px 28px',
                    alignItems: 'center', gap: 4,
                    padding: '5px 10px',
                    borderBottom: '1px solid var(--border)',
                    borderLeft: `2px solid ${isSel ? 'var(--accent)' : 'transparent'}`,
                    background: isSel ? 'var(--bg-hover)' : 'transparent',
                    cursor: 'pointer', transition: 'background 0.1s',
                  }}
                >
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                  <div onClick={e => e.stopPropagation()}>
                    <InlineTime value={seg.start} min={0} max={seg.end - 0.1} onChange={v => updateSeg(seg.id, { start: v })} onSeek={seekTo} />
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    <InlineTime value={seg.end} min={seg.start + 0.1} max={videoDuration} onChange={v => updateSeg(seg.id, { end: v })} onSeek={seekTo} />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', textAlign: 'right' }}>
                    {formatTimeDisplay(seg.end - seg.start)}
                  </span>
                  <button className="btn btn-icon" style={{ fontSize: 14, lineHeight: 1, padding: '1px 5px', opacity: 0.4 }}
                    title="Delete" onClick={e => { e.stopPropagation(); deleteSeg(seg.id); }}>×</button>
                </div>
              );
            })}
          </div>

          {/* Summary */}
          {cutSegments.length > 0 && (
            <div style={{ padding: '7px 12px', borderTop: '1px solid var(--border)', flexShrink: 0, fontSize: 11, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
              <span>{cutSegments.length} clip{cutSegments.length !== 1 ? 's' : ''}</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{formatTimeDisplay(totalDur)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
