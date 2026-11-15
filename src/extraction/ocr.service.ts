import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createWorker, type Worker } from 'tesseract.js';
import { AppConfig } from '../config/app-config.service';

export interface OcrResult {
  text: string;
  /** 0-100 */
  confidence: number;
}

/**
 * OCR local avec tesseract.js (aucun binaire système requis, compatible Railway).
 * Le modèle de langue est téléchargé au premier usage puis mis en cache (OCR_CACHE_DIR).
 * Un seul worker, réutilisé ; les appels sont sérialisés.
 */
@Injectable()
export class OcrService implements OnModuleDestroy {
  private readonly logger = new Logger(OcrService.name);
  private worker?: Promise<Worker>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: AppConfig) {}

  private getWorker(): Promise<Worker> {
    if (!this.worker) {
      const cachePath = resolve(this.config.get('OCR_CACHE_DIR'));
      mkdirSync(cachePath, { recursive: true });
      this.worker = createWorker(this.config.get('OCR_LANG'), 1, {
        cachePath,
      }).catch((err: unknown) => {
        this.worker = undefined;
        throw err;
      });
    }
    return this.worker;
  }

  recognize(image: Buffer): Promise<OcrResult> {
    const run = this.queue.then(async () => {
      const started = Date.now();
      const worker = await this.getWorker();
      const { data } = await worker.recognize(image);
      this.logger.debug(
        `OCR ${Date.now() - started} ms, confiance ${Math.round(data.confidence)}`,
      );
      return { text: data.text ?? '', confidence: data.confidence ?? 0 };
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await (await this.worker).terminate();
  }
}
