// translate.worker.ts — TranslateGemma via @huggingface/transformers WebGPU

import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

const MODEL_ID = 'onnx-community/translategemma-text-4b-it-ONNX';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let translator: any = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'load') {
    try {
      self.postMessage({ type: 'status', payload: 'Loading translation model…' });
      translator = await pipeline('translation', MODEL_ID, {
        device: 'webgpu',
        dtype: 'q4',
        progress_callback: (info: { status: string; file?: string; progress?: number }) => {
          if (info.status === 'downloading') {
            self.postMessage({
              type: 'download-progress',
              payload: { file: info.file ?? '', progress: info.progress ?? 0 },
            });
          } else if (info.status === 'loading') {
            self.postMessage({ type: 'status', payload: 'Loading weights…' });
          }
        },
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', payload: String(err) });
    }

  } else if (type === 'translate') {
    if (!translator) {
      self.postMessage({ type: 'error', payload: 'Model not loaded' });
      return;
    }
    try {
      const { texts, targetLanguage } = payload as { texts: string[]; targetLanguage: string };
      const results: string[] = [];

      for (let i = 0; i < texts.length; i++) {
        self.postMessage({ type: 'progress', payload: { current: i, total: texts.length } });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const out = await translator(texts[i], { tgt_lang: targetLanguage }) as any;
        const translated = Array.isArray(out)
          ? (out[0]?.translation_text ?? out[0]?.generated_text ?? '')
          : (out?.translation_text ?? out?.generated_text ?? '');
        results.push(translated);
      }

      self.postMessage({ type: 'done', payload: results });
    } catch (err) {
      self.postMessage({ type: 'error', payload: String(err) });
    }
  }
};
