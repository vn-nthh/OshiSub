// Shared utility: format seconds to SRT/ASS time strings and helpers

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

export function formatTimeSRT(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function formatTimeDisplay(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`;
}

export function parseTimeInput(value: string): number | null {
  // Accept mm:ss.d or mm:ss or raw seconds
  const match = value.match(/^(\d+):(\d{2})(?:\.(\d+))?$/);
  if (match) {
    const m = parseInt(match[1], 10);
    const s = parseInt(match[2], 10);
    const frac = match[3] ? parseFloat(`0.${match[3]}`) : 0;
    return m * 60 + s + frac;
  }
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

export function toSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function toASSTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

export function generateId(): string {
  return crypto.randomUUID();
}

/** Map a virtual-timeline time to absolute source time using cut segments */
export function virtualToSource(
  virtualTime: number,
  segments: { start: number; end: number }[]
): number {
  let accumulated = 0;
  for (const seg of segments) {
    const dur = seg.end - seg.start;
    if (virtualTime <= accumulated + dur) {
      return seg.start + (virtualTime - accumulated);
    }
    accumulated += dur;
  }
  return segments[segments.length - 1]?.end ?? virtualTime;
}

/** Map an absolute source time to virtual-timeline time using cut segments.
 *  Returns { virtualTime, inSegment } — inSegment is false if the time falls in a gap. */
export function sourceToVirtual(
  sourceTime: number,
  segments: { start: number; end: number }[]
): { virtualTime: number; inSegment: boolean; segmentIndex: number } {
  let accumulated = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    // Before this segment → time is in a gap (or before all segments)
    if (sourceTime < seg.start) {
      return { virtualTime: accumulated, inSegment: false, segmentIndex: i };
    }
    // Inside this segment
    if (sourceTime <= seg.end) {
      return { virtualTime: accumulated + (sourceTime - seg.start), inSegment: true, segmentIndex: i };
    }
    // Past this segment — accumulate its duration and check next
    accumulated += seg.end - seg.start;
  }
  // Past all segments
  return { virtualTime: accumulated, inSegment: false, segmentIndex: -1 };
}

/** Total duration of virtual timeline from cut segments */
export function totalVirtualDuration(segments: { start: number; end: number }[]): number {
  return segments.reduce((acc, s) => acc + (s.end - s.start), 0);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
