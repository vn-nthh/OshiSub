// Shared TypeScript types for OshiSub

// ─── App Navigation ──────────────────────────────────────────────────────────
export type AppTab = 'import' | 'cut' | 'transcribe' | 'translate' | 'style' | 'export';

export type AppStatus =
  | 'idle'
  | 'extracting'
  | 'loading-model'
  | 'transcribing'
  | 'translating'
  | 'exporting'
  | 'done'
  | 'error';

// ─── Video & Cut ─────────────────────────────────────────────────────────────
export interface CutSegment {
  id: string;
  start: number; // seconds, relative to source video
  end: number;
}

// ─── Transcription ────────────────────────────────────────────────────────────
export interface TranscriptChunk {
  id: string;
  start: number; // seconds in the virtual (cut) timeline
  end: number;
  text: string;
}

export interface TranscriptResult {
  chunks: TranscriptChunk[];
  fullText: string;
}



export type TranscriptionMode = 'webgpu' | 'groq';

// ─── Translation ──────────────────────────────────────────────────────────────
export type TranslationMode = 'webgpu' | 'groq';

export interface TranslatedChunk {
  id: string;          // matches TranscriptChunk.id
  originalText: string;
  translatedText: string;
}

// ─── Subtitle Style ───────────────────────────────────────────────────────────
export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  color: string;        // hex
  outlineColor: string; // hex
  bold: boolean;
  italic: boolean;
  position: 'bottom' | 'top';
  marginV: number;      // vertical margin px
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: 'Arial',
  fontSize: 52,
  color: '#ffffff',
  outlineColor: '#000000',
  bold: false,
  italic: false,
  position: 'bottom',
  marginV: 50,
};

// ─── FFmpeg ───────────────────────────────────────────────────────────────────
export type FFmpegJobType = 'extractAudio' | 'cutVideo' | 'concatVideo' | 'burnSubtitles' | 'raw';

export interface FFmpegJob {
  type: FFmpegJobType;
  inputFile?: File;
  inputFiles?: File[];
  args: string[];
  outputName: string;
  outputMime: string;
  extraFiles?: { name: string; data: Uint8Array | string }[];
}

export interface FFmpegProgress {
  progress: number; // 0–1
  time: number;     // seconds processed
}

// ─── Subtitle Entry (export) ──────────────────────────────────────────────────
export interface SubtitleEntry {
  index: number;
  start: number;
  end: number;
  text: string;
}

// ─── Worker Messages ──────────────────────────────────────────────────────────
export interface WorkerMessage<T = unknown> {
  type: string;
  payload: T;
}

// ─── Shared App State (used by all tab components) ────────────────────────────
export interface AppState {
  videoFile: File | null;
  videoObjectUrl: string | null;
  videoDuration: number;
  cutSegments: CutSegment[];
  audioSamples: Float32Array | null;
  audioDuration: number;
  whisperModelId: string;
  transcribeMode: TranscriptionMode;
  groqApiKey: string;
  keyterms: string;
  chunks: TranscriptChunk[];
  translatedChunks: TranslatedChunk[];
  translateMode: TranslationMode;
  targetLanguage: string;
  groqTranslateKey: string;
  subtitleStyle: SubtitleStyle;
  status: AppStatus;
  statusMsg: string;
  extractProgress: number;
  ffmpegProgress: FFmpegProgress | null;
  error: string | null;
}

/** Patch function type for updating AppState in child tabs */
export type PatchFn = (updates: Partial<AppState>) => void;
