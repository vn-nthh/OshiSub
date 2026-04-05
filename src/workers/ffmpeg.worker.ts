// FFmpeg Web Worker — handles audio extraction, video cutting, concat, burn-in

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import type { FFmpegJob } from '@/types';

const ffmpeg = new FFmpeg();
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  await ffmpeg.load({
    coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
    wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
  });
  loaded = true;
}

ffmpeg.on('progress', ({ progress, time }) => {
  self.postMessage({ type: 'progress', payload: { progress, time } });
});

ffmpeg.on('log', ({ message }) => {
  self.postMessage({ type: 'log', payload: message });
});

self.onmessage = async (e: MessageEvent<{ id: string; job: FFmpegJob }>) => {
  const { id, job } = e.data;
  try {
    await ensureLoaded();

    // ── Special handler: concatVideo (multi-step stream copy) ────────────
    if (job.type === 'concatVideo' && job.extraFiles) {
      const segmentsJson = job.extraFiles.find(f => f.name === 'segments.json');
      if (segmentsJson && job.inputFile) {
        const segments: { start: number; end: number }[] = JSON.parse(
          typeof segmentsJson.data === 'string' ? segmentsJson.data : new TextDecoder().decode(segmentsJson.data)
        );
        const result = await concatStreamCopy(job.inputFile, segments);
        self.postMessage({ type: 'done', id, payload: result }, { transfer: [result.buffer as ArrayBuffer] });
        return;
      }
    }

    // ── Generic job handler ──────────────────────────────────────────────
    // Write extra files (e.g. .ass subtitle file for burn-in)
    if (job.extraFiles) {
      for (const f of job.extraFiles) {
        const data = typeof f.data === 'string'
          ? new TextEncoder().encode(f.data)
          : f.data;
        await ffmpeg.writeFile(f.name, data);
      }
    }

    // Write primary input file
    let inputName = 'input';
    if (job.inputFile) {
      const ext = job.inputFile.name.split('.').pop() ?? 'mp4';
      inputName = `input.${ext}`;
      await ffmpeg.writeFile(inputName, await fetchFile(job.inputFile));
    }

    // Replace 'input' placeholder with actual input name
    const args = job.args.map((a) => (a === 'input' ? inputName : a));
    await ffmpeg.exec(args);

    const data = await ffmpeg.readFile(job.outputName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);

    // Cleanup
    if (job.inputFile) await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(job.outputName).catch(() => {});
    if (job.extraFiles) {
      for (const f of job.extraFiles) await ffmpeg.deleteFile(f.name).catch(() => {});
    }

    self.postMessage({ type: 'done', id, payload: bytes }, { transfer: [bytes.buffer as ArrayBuffer] });
  } catch (err) {
    self.postMessage({ type: 'error', id, payload: String(err) });
  }
};

/**
 * Multi-segment concat using stream copy:
 * 1. Write source file once
 * 2. Cut each segment with -c copy (fast, no re-encoding)
 * 3. Write concat list
 * 4. Concat with concat demuxer (stream copy)
 * 5. Cleanup all temp files
 */
async function concatStreamCopy(
  inputFile: File,
  segments: { start: number; end: number }[]
): Promise<Uint8Array> {
  const ext = inputFile.name.split('.').pop() ?? 'mp4';
  const inputName = `input.${ext}`;

  // Write source once
  await ffmpeg.writeFile(inputName, await fetchFile(inputFile));

  const segFiles: string[] = [];

  // Cut each segment with stream copy
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segName = `seg_${i}.${ext}`;
    segFiles.push(segName);

    self.postMessage({
      type: 'progress',
      payload: { progress: i / (segments.length + 1), time: seg.start },
    });

    await ffmpeg.exec([
      '-ss', String(seg.start),
      '-to', String(seg.end),
      '-i', inputName,
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      segName,
    ]);
  }

  // Write concat list
  const concatList = segFiles.map(f => `file '${f}'`).join('\n');
  await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(concatList));

  // Concat with demuxer (stream copy — fast)
  self.postMessage({
    type: 'progress',
    payload: { progress: segments.length / (segments.length + 1), time: 0 },
  });

  await ffmpeg.exec([
    '-f', 'concat',
    '-safe', '0',
    '-i', 'concat.txt',
    '-c', 'copy',
    '-movflags', 'faststart',
    'output.mp4',
  ]);

  const data = await ffmpeg.readFile('output.mp4');
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);

  // Cleanup
  await ffmpeg.deleteFile(inputName).catch(() => {});
  await ffmpeg.deleteFile('concat.txt').catch(() => {});
  await ffmpeg.deleteFile('output.mp4').catch(() => {});
  for (const f of segFiles) await ffmpeg.deleteFile(f).catch(() => {});

  return bytes;
}
