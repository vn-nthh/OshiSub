/**
 * webcodecs-burner.worker.ts
 *
 * Hardware-accelerated subtitle burn-in using WebCodecs + streaming demux:
 *  1. Demux video with mp4box.js in small batches (50 samples at a time)
 *  2. Decode → draw frame + subtitle on OffscreenCanvas → re-encode
 *  3. Mux result with mp4-muxer
 *  4. Audio is passed through without re-encoding
 *
 * Falls back gracefully: posts { type: 'unsupported' } if WebCodecs unavailable.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import * as MP4Box from 'mp4box';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export interface SubtitleLine { start: number; end: number; text: string; }
export interface StyleOpts {
  fontFamily: string; fontSize: number; color: string; outlineColor: string;
  bold: boolean; italic: boolean; position: 'bottom' | 'top'; marginV: number;
}

const DEFAULT_STYLE: StyleOpts = {
  fontFamily: 'Arial', fontSize: 52, color: '#ffffff', outlineColor: '#000000',
  bold: false, italic: false, position: 'bottom', marginV: 50,
};

let abortRequested = false;

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;
  if (type === 'burn') {
    abortRequested = false;
    try { await burnSubtitles(payload); }
    catch (err) { self.postMessage({ type: 'error', payload: String(err) }); }
  } else if (type === 'abort') { abortRequested = true; }
};

async function checkSupport(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') return false;
  const cfg = { codec: avcCodec(1920, 1080), width: 1920, height: 1080, bitrate: 5_000_000, framerate: 30 };
  for (const mode of ['prefer-hardware', 'prefer-software', 'no-preference', undefined] as const) {
    try {
      const c: any = { ...cfg };
      if (mode) c.hardwareAcceleration = mode;
      if ((await VideoEncoder.isConfigSupported(c)).supported) return true;
    } catch { /* next */ }
  }
  return true;
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// Pick AVC codec string with appropriate level for the resolution
// avc1.PPCCLL — PP=profile(42=Baseline,64=High) CC=constraints LL=level
function avcCodec(w: number, h: number): string {
  const pixels = w * h;
  // High profile for better compression
  if (pixels <= 414720)  return 'avc1.64001E'; // ≤720×576  → Level 3.0
  if (pixels <= 921600)  return 'avc1.64001F'; // ≤1280×720 → Level 3.1
  if (pixels <= 2088960) return 'avc1.640028'; // ≤1920×1088→ Level 4.0
  if (pixels <= 8355840) return 'avc1.640033'; // ≤3840×2176→ Level 5.1
  return 'avc1.64003D'; // Level 6.1 — 8K
}

function getCodecDescription(mp4File: any, trackId: number): Uint8Array | undefined {
  try {
    const trak = mp4File.getTrackById(trackId);
    const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    const box = entry?.avcC || entry?.hvcC || entry?.vpcC || entry?.av1C;
    if (!box) return undefined;
    const DS = (MP4Box as any).DataStream;
    const stream = new DS(undefined, 0, DS.BIG_ENDIAN ?? false);
    box.write(stream);
    return new Uint8Array(stream.buffer, 8, stream.position - 8);
  } catch { return undefined; }
}

// ─── Main burn-in ─────────────────────────────────────────────────────────────
async function burnSubtitles(payload: {
  videoData: ArrayBuffer; subtitles: SubtitleLine[]; style?: StyleOpts;
}) {
  const { videoData, subtitles, style = DEFAULT_STYLE } = payload;

  if (!(await checkSupport())) {
    self.postMessage({ type: 'unsupported' });
    return;
  }

  // ── Step 1: Find a working encoder hw mode (async — done BEFORE MP4Box) ───
  self.postMessage({ type: 'status', payload: 'Checking encoder…' });
  let chosenHwMode: string | undefined;
  for (const mode of ['prefer-hardware', 'prefer-software', 'no-preference', undefined] as const) {
    const c: any = { codec: avcCodec(1920, 1080), width: 1920, height: 1080, bitrate: 5_000_000, framerate: 30 };
    if (mode) c.hardwareAcceleration = mode;
    try {
      if ((await VideoEncoder.isConfigSupported(c)).supported) { chosenHwMode = mode ?? undefined; break; }
    } catch { /* next */ }
  }

  // ── Step 2: MP4Box with SYNCHRONOUS onReady (no await before start) ────────
  self.postMessage({ type: 'status', payload: 'Parsing video…' });
  const mp4 = (MP4Box as any).createFile();
  const buf = videoData as any;
  buf.fileStart = 0;

  await new Promise<void>((resolveAll, rejectAll) => {
    let vTrack: any, aTrack: any;
    let width = 0, height = 0, fps = 30, totalVideoSamples = 0;
    let decoder: VideoDecoder, encoder: VideoEncoder;
    let muxer: InstanceType<typeof Muxer>, target: ArrayBufferTarget;
    let canvas: OffscreenCanvas, ctx: OffscreenCanvasRenderingContext2D;
    let frameCount = 0, processedVideo = 0, processedAudio = 0, totalAudioSamples = 0;
    let errored = false;
    let firstTimestamp: number | null = null; // track first frame TS to normalize subtitle lookups
    const BATCH = 50;

    // SYNCHRONOUS — no await anywhere in this callback
    mp4.onReady = (info: any) => {
      try {
        vTrack = info.videoTracks?.[0];
        if (!vTrack) { rejectAll(new Error('No video track found')); return; }
        aTrack = info.audioTracks?.[0];

        width = vTrack.video.width;
        height = vTrack.video.height;
        const duration = vTrack.duration / vTrack.timescale;
        fps = vTrack.nb_samples / duration || 30;
        totalVideoSamples = vTrack.nb_samples;
        totalAudioSamples = aTrack?.nb_samples ?? 0;
        const description = getCodecDescription(mp4, vTrack.id);

        self.postMessage({ type: 'status', payload: `${width}×${height} @ ${fps.toFixed(1)}fps, ${totalVideoSamples} frames` });

        canvas = new OffscreenCanvas(width, height);
        ctx = canvas.getContext('2d')!;

        target = new ArrayBufferTarget();
        const muxOpts: any = { target, video: { codec: 'avc', width, height }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' };
        if (aTrack) {
          muxOpts.audio = { codec: 'aac', numberOfChannels: aTrack.audio.channel_count, sampleRate: aTrack.audio.sample_rate };
        }
        muxer = new Muxer(muxOpts);

        const encCfg: VideoEncoderConfig = {
          codec: avcCodec(width, height), width, height,
          bitrate: vTrack.bitrate ?? Math.round(width * height * fps * 0.07),
          framerate: fps, latencyMode: 'quality', avc: { format: 'annexb' },
        };
        if (chosenHwMode) (encCfg as any).hardwareAcceleration = chosenHwMode;

        encoder = new VideoEncoder({
          output: (chunk, meta) => muxer.addVideoChunk(chunk, meta as any),
          error: (e) => { errored = true; console.error('[Encoder]', e); rejectAll(e); },
        });
        encoder.configure(encCfg);

        decoder = new VideoDecoder({
          output: (frame) => {
            if (abortRequested || errored) { frame.close(); return; }
            const ts = frame.timestamp;
            const timeSec = ts / 1_000_000;

            ctx.drawImage(frame, 0, 0, width, height);
            frame.close();

            const active = subtitles.find(s => timeSec >= s.start && timeSec < s.end);
            if (active) drawSubtitle(ctx, active.text, style, width, height);

            const nf = new VideoFrame(canvas, { timestamp: ts, duration: Math.round(1_000_000 / fps) });
            encoder.encode(nf, { keyFrame: frameCount % Math.ceil(fps * 2) === 0 });
            nf.close();
            frameCount++;

            if (frameCount % 30 === 0) {
              self.postMessage({ type: 'progress', payload: { current: frameCount, total: totalVideoSamples, percent: frameCount / totalVideoSamples } });
            }
          },
          error: (e) => console.error('[Decoder]', e),
        });
        decoder.configure({
          codec: vTrack.codec.startsWith('avc') ? avcCodec(width, height) : vTrack.codec,
          codedWidth: width, codedHeight: height, description,
        });

        // onSamples — streaming extraction
        mp4.onSamples = (trackId: number, _user: any, samples: any[]) => {
          if (abortRequested) { resolveAll(); return; }

          if (trackId === vTrack.id) {
            mp4.stop();
            const batch = samples.map((s: any) => ({
              data: new Uint8Array(s.data), is_sync: s.is_sync,
              cts: s.cts, duration: s.duration, timescale: s.timescale,
            }));
            processedVideo += batch.length;

            (async () => {
              try {
                for (const s of batch) {
                  if (abortRequested) break;
                  while (decoder.decodeQueueSize > 10) await wait(5);
                  while (encoder.encodeQueueSize > 10) await wait(5);
                  decoder.decode(new EncodedVideoChunk({
                    type: s.is_sync ? 'key' : 'delta',
                    timestamp: Math.round(s.cts * 1_000_000 / s.timescale),
                    duration: Math.round(s.duration * 1_000_000 / s.timescale),
                    data: s.data,
                  }));
                }
                if (processedVideo >= totalVideoSamples) {
                  await decoder.flush(); await encoder.flush();
                  decoder.close(); encoder.close();

                  // Wait for remaining audio to be extracted
                  if (aTrack && processedAudio < totalAudioSamples) {
                    mp4.start(); // resume extraction for remaining audio
                    while (processedAudio < totalAudioSamples) await wait(10);
                  }

                  muxer.finalize();
                  self.postMessage({ type: 'done', payload: target.buffer }, { transfer: [target.buffer] });
                  resolveAll();
                } else {
                  mp4.start();
                }
              } catch (e) { rejectAll(e as Error); }
            })();
          } else if (aTrack && trackId === aTrack.id) {
            for (const s of samples) {
              muxer.addAudioChunkRaw(
                new Uint8Array(s.data), s.is_sync ? 'key' : 'delta',
                Math.round(s.cts * 1_000_000 / s.timescale),
                Math.round(s.duration * 1_000_000 / s.timescale),
              );
            }
            processedAudio += samples.length;
          }
        };

        // Extraction starts HERE — synchronous, runs before flush()
        mp4.setExtractionOptions(vTrack.id, 'video', { nbSamples: BATCH });
        if (aTrack) mp4.setExtractionOptions(aTrack.id, 'audio', { nbSamples: 200 });
        mp4.start();
      } catch (e) { rejectAll(e as Error); }
    };

    mp4.onError = rejectAll;
    mp4.appendBuffer(buf);
    mp4.flush();
  });
}

// ─── Subtitle renderer ───────────────────────────────────────────────────────
function drawSubtitle(ctx: OffscreenCanvasRenderingContext2D, text: string, style: StyleOpts, canvasW: number, canvasH: number): void {
  const sf = Math.round((style.fontSize / 1080) * canvasH);
  const font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${sf}px ${style.fontFamily}`;
  ctx.save();
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = style.position === 'bottom' ? 'bottom' : 'top';
  ctx.lineWidth = Math.max(2, sf * 0.08);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = style.outlineColor;
  ctx.fillStyle = style.color;
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = sf * 0.1;
  const lines = text.split('\n');
  const lh = sf * 1.2;
  const mv = Math.round((style.marginV / 1080) * canvasH);
  const x = canvasW / 2;
  lines.forEach((line, i) => {
    const y = style.position === 'bottom'
      ? canvasH - mv - (lines.length - 1 - i) * lh
      : mv + i * lh;
    ctx.strokeText(line, x, y);
    ctx.fillText(line, x, y);
  });
  ctx.restore();
}
