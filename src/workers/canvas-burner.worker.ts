// Canvas-based subtitle burn-in worker
// Uses OffscreenCanvas + VideoDecoder/Encoder pattern
// Fallback: processes video frames via canvas, draws text, and re-encodes

export interface BurnRequest {
  videoData: ArrayBuffer;
  subtitles: { start: number; end: number; text: string }[];
  style: {
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    outlineColor?: string;
    bold?: boolean;
    position?: 'bottom' | 'top';
    marginV?: number;
  };
}

// This worker is intentionally left minimal — the actual burn-in
// is handled on the main thread using <video> + <canvas> + MediaRecorder
// because OffscreenCanvas doesn't support video element playback.
// See ExportTab.tsx for the main-thread implementation.
