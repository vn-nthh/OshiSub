// Whisper Web Worker
// Pattern from webml-community/whisper-large-v3-turbo-webgpu (HuggingFace Space)
// Key: dtype must be an OBJECT with per-model-part keys, not a flat string.
// The reference bundle shows: { encoder_model: "fp16", decoder_model_merged: "q4" }

/* eslint-disable @typescript-eslint/no-explicit-any */
import { pipeline, env } from '@huggingface/transformers';
import type { TranscriptChunk } from '@/types';

env.allowLocalModels = false;
env.allowRemoteModels = true;

const MODEL_ID = 'onnx-community/whisper-large-v3-turbo';

type DtypeKey = 'q4' | 'q8' | 'fp16' | 'fp32';

// Per-model-part dtypes — copied from the reference implementation.
// encoder_model_fp16.onnx + decoder_model_merged_q4.onnx = default (best balance)
const DTYPE_MAP: Record<DtypeKey, Record<string, string>> = {
  q4:   { encoder_model: 'fp16', decoder_model_merged: 'q4'   },
  q8:   { encoder_model: 'fp16', decoder_model_merged: 'q8'   },
  fp16: { encoder_model: 'fp16', decoder_model_merged: 'fp16' },
  fp32: { encoder_model: 'fp32', decoder_model_merged: 'fp32' },
};

let transcriber: any = null;
let currentDevice: 'webgpu' | 'wasm' = 'webgpu';

// ── Mutex: prevent concurrent OrtRun calls on the same WebGPU session ────────
// ORT WebGPU crashes if two runs overlap on the same GPUBuffer.
let isBusy = false;
const pendingQueue: Array<() => void> = [];

function acquireLock(): Promise<void> {
  return new Promise((resolve) => {
    if (!isBusy) {
      isBusy = true;
      resolve();
    } else {
      pendingQueue.push(() => { isBusy = true; resolve(); });
    }
  });
}

function releaseLock() {
  const next = pendingQueue.shift();
  if (next) {
    next();
  } else {
    isBusy = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function createPipeline(dtype: DtypeKey, device: 'webgpu' | 'wasm') {
  self.postMessage({ type: 'status', payload: `Initializing Whisper (${dtype}, ${device})…` });

  transcriber = await pipeline(
    'automatic-speech-recognition',
    MODEL_ID,
    {
      device,
      dtype: DTYPE_MAP[dtype],
      progress_callback: (p: any) => {
        self.postMessage({
          type: 'download-progress',
          payload: {
            status: p.status,
            progress: p.progress ?? 0,
            file: p.file ?? p.name ?? '',
          },
        });
      },
    } as any,
  );

  currentDevice = device;
}

// Is this the ORT WebGPU buffer-unmap error?
function isWebGPUBufferError(err: unknown): boolean {
  const msg = String(err);
  return (
    msg.includes('mapAsync') ||
    msg.includes('unmapped') ||
    msg.includes('BufferManager') ||
    msg.includes('WebGPU') ||
    msg.includes('ERROR_CODE: 1')
  );
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'load') {
    const dtype: DtypeKey = payload?.dtype ?? 'q4';

    try {
      await createPipeline(dtype, 'webgpu');
      self.postMessage({ type: 'ready', payload: { device: 'webgpu', dtype } });
    } catch (err) {
      self.postMessage({ type: 'status', payload: `WebGPU unavailable (${err}), trying CPU…` });
      transcriber = null;
      try {
        await createPipeline(dtype, 'wasm');
        self.postMessage({ type: 'ready', payload: { device: 'wasm', dtype } });
      } catch (err2) {
        self.postMessage({ type: 'error', payload: `Failed to load Whisper: ${err2}` });
      }
    }

  } else if (type === 'run') {
    if (!transcriber) {
      self.postMessage({ type: 'error', payload: 'Model not loaded. Send load first.' });
      return;
    }

    const { audio, segmentStartSec, language } = payload as {
      audio: Float32Array;
      sampleRate: number;
      segmentStartSec: number;
      language?: string;
    };

    // Acquire mutex — queue behind any in-progress run
    await acquireLock();

    try {
      self.postMessage({ type: 'status', payload: 'Transcribing…' });

      let result: any;

      try {
        result = await transcriber(audio, {
          language: language ?? null,
          task: 'transcribe',
          return_timestamps: true,
          chunk_length_s: 30,
          stride_length_s: 5,
        });
      } catch (runErr) {
        // ── WebGPU buffer-unmap error: dispose session, retry on WASM ───────
        if (isWebGPUBufferError(runErr) && currentDevice === 'webgpu') {
          self.postMessage({
            type: 'status',
            payload: `WebGPU buffer error — reloading on CPU (this is a known ORT bug)…`,
          });

          // Dispose the broken WebGPU session
          try { await transcriber.dispose(); } catch { /* ignore */ }
          transcriber = null;

          // Re-create on WASM
          const dtype: DtypeKey = (payload?.dtype as DtypeKey) ?? 'q4';
          await createPipeline(dtype, 'wasm');

          self.postMessage({ type: 'device-fallback', payload: 'wasm' });

          // Retry the run on WASM
          result = await transcriber(audio, {
            language: language ?? null,
            task: 'transcribe',
            return_timestamps: true,
            chunk_length_s: 30,
            stride_length_s: 5,
          });
        } else {
          throw runErr;
        }
      }

      const raw: Array<{ timestamp: [number, number | null]; text: string }> =
        result?.chunks ?? [];

      const chunks: TranscriptChunk[] = raw.length
        ? raw.map((c) => ({
            id:    crypto.randomUUID(),
            start: segmentStartSec + c.timestamp[0],
            end:   segmentStartSec + (c.timestamp[1] ?? c.timestamp[0] + 2),
            text:  c.text,
          }))
        : [{
            id:    crypto.randomUUID(),
            start: segmentStartSec,
            end:   segmentStartSec + audio.length / 16000,
            text:  result?.text ?? '',
          }];

      self.postMessage({ type: 'done', payload: chunks });
    } catch (err) {
      self.postMessage({ type: 'error', payload: String(err) });
    } finally {
      releaseLock();
    }
  }
};
