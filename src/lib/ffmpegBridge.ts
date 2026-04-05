// FFmpeg bridge — typed wrapper around the FFmpeg worker
// Supports audio extraction, multi-segment concat, burn-in subtitles

import type { FFmpegJob, FFmpegProgress } from '@/types';

type ProgressCallback = (p: FFmpegProgress) => void;
type LogCallback = (msg: string) => void;

/**
 * Font URL for drawtext burn-in.
 * Noto Sans JP covers Latin + Japanese glyphs — a good default for oshisub.
 * We use a Google Fonts CDN URL for the regular weight.
 */
const DEFAULT_FONT_URL =
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosansjp/NotoSansJP-Bold.ttf';

export class FFmpegBridge {
  private worker: Worker | null = null;
  private resolvers = new Map<string, { resolve: (v: Uint8Array) => void; reject: (e: Error) => void }>();
  private progressCallback: ProgressCallback | null = null;
  private logCallback: LogCallback | null = null;
  private jobCounter = 0;

  constructor() {
    this.init();
  }

  private init() {
    this.worker = new Worker(new URL('../workers/ffmpeg.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const { type, id, payload } = e.data;
      if (type === 'progress') {
        this.progressCallback?.(payload as FFmpegProgress);
      } else if (type === 'log') {
        this.logCallback?.(payload as string);
      } else if (type === 'done') {
        this.resolvers.get(id)?.resolve(payload);
        this.resolvers.delete(id);
      } else if (type === 'error') {
        this.resolvers.get(id)?.reject(new Error(payload));
        this.resolvers.delete(id);
      }
    };
  }

  onProgress(cb: ProgressCallback) { this.progressCallback = cb; }
  onLog(cb: LogCallback) { this.logCallback = cb; }

  private run(job: FFmpegJob): Promise<Uint8Array> {
    const id = String(this.jobCounter++);
    return new Promise((resolve, reject) => {
      this.resolvers.set(id, { resolve, reject });
      this.worker!.postMessage({ id, job });
    });
  }

  /** Extract 16kHz mono WAV from a specific time range of a video file */
  async extractAudio(inputFile: File, startSec?: number, endSec?: number): Promise<Uint8Array> {
    const args: string[] = [];
    if (startSec !== undefined) args.push('-ss', String(startSec));
    if (endSec !== undefined) args.push('-to', String(endSec));
    args.push('-i', 'input', '-vn', '-ar', '16000', '-ac', '1', '-f', 'wav', 'output.wav');
    return this.run({
      type: 'extractAudio',
      inputFile,
      args,
      outputName: 'output.wav',
      outputMime: 'audio/wav',
    });
  }

  /** Cut a single video segment (stream copy) */
  async cutVideo(inputFile: File, startSec: number, endSec: number): Promise<Uint8Array> {
    return this.run({
      type: 'cutVideo',
      inputFile,
      args: [
        '-ss', String(startSec),
        '-to', String(endSec),
        '-i', 'input',
        '-c', 'copy',
        'output.mp4',
      ],
      outputName: 'output.mp4',
      outputMime: 'video/mp4',
    });
  }

  /**
   * Concatenate multiple time segments from a single source file.
   * Uses stream-copy cuts + concat demuxer (no re-encoding).
   * For single segment, uses simple stream copy.
   */
  async concatSegments(
    inputFile: File,
    segments: { start: number; end: number }[]
  ): Promise<Uint8Array> {
    if (segments.length === 0) throw new Error('No segments to concat');

    if (segments.length === 1) {
      return this.cutVideo(inputFile, segments[0].start, segments[0].end);
    }

    // Send a special job type that the worker handles with multiple steps
    return this.run({
      type: 'concatVideo',
      inputFile,
      args: [], // not used — worker reads segments from extraFiles
      outputName: 'output.mp4',
      outputMime: 'video/mp4',
      extraFiles: [{ name: 'segments.json', data: JSON.stringify(segments) }],
    });
  }

  /**
   * Burn subtitles into video using drawtext filter chain.
   * Fetches a font, writes it to VFS, and chains drawtext filters with enable='between(t,s,e)'.
   */
  async burnSubtitles(
    inputFile: File,
    subtitleEntries: { start: number; end: number; text: string }[],
    style?: {
      fontFamily?: string;
      fontSize?: number;
      color?: string;
      outlineColor?: string;
      bold?: boolean;
      position?: 'bottom' | 'top';
      marginV?: number;
    }
  ): Promise<Uint8Array> {
    if (subtitleEntries.length === 0) throw new Error('No subtitle entries');

    const fontSize = style?.fontSize ?? 48;
    const fontColor = style?.color ?? 'white';
    const borderColor = style?.outlineColor ?? 'black';
    const borderW = 3;
    const marginV = style?.marginV ?? 60;
    const pos = style?.position ?? 'bottom';

    // Fetch font file for drawtext
    let fontData: Uint8Array;
    try {
      const resp = await fetch(DEFAULT_FONT_URL);
      if (!resp.ok) throw new Error(`Font fetch failed: ${resp.status}`);
      fontData = new Uint8Array(await resp.arrayBuffer());
    } catch (e) {
      throw new Error(`Failed to download font for subtitle burn-in: ${e}`);
    }

    // Build drawtext filter chain — each subtitle is a separate drawtext filter
    const filters = subtitleEntries.map((entry) => {
      // drawtext escaping: need to escape : ' \ and wrap in single quotes
      // Since we're passing args as array to ffmpeg.exec(), we only need to
      // escape the drawtext-level special chars, NOT shell-level escaping
      const escaped = entry.text
        .replace(/\\/g, '\\\\')       // \ → \\
        .replace(/'/g, "\u2019")       // ' → ' (smart quote, avoids escaping nightmare)
        .replace(/:/g, '\\:')          // : → \:
        .replace(/\n/g, ' ')           // newlines → space
        .replace(/;/g, '\\;');         // ; → \;

      const yExpr = pos === 'bottom'
        ? `h-${marginV}-text_h`
        : `${marginV}`;

      return `drawtext=fontfile=font.ttf:text='${escaped}':fontsize=${fontSize}:fontcolor=${fontColor}:bordercolor=${borderColor}:borderw=${borderW}:x=(w-text_w)/2:y=${yExpr}:enable='between(t,${entry.start.toFixed(3)},${entry.end.toFixed(3)})'`;
    });

    // Join filters — for very long chains, drawtext supports chaining with comma
    const vf = filters.join(',');

    return this.run({
      type: 'burnSubtitles',
      inputFile,
      args: [
        '-i', 'input',
        '-vf', vf,
        '-c:v', 'libx264',
        '-crf', '23',
        '-preset', 'ultrafast',
        '-c:a', 'copy',
        '-movflags', 'faststart',
        'output.mp4',
      ],
      outputName: 'output.mp4',
      outputMime: 'video/mp4',
      extraFiles: [{ name: 'font.ttf', data: fontData }],
    });
  }

  /** Run arbitrary FFmpeg command */
  async runRaw(job: FFmpegJob): Promise<Uint8Array> {
    return this.run(job);
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
  }
}
