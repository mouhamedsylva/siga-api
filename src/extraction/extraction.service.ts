import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { resolve } from 'node:path';
import { AppConfig } from '../config/app-config.service';
import { StorageService } from '../storage/storage.service';
import { loadFormats, type ProofFormat } from './formats';
import { OcrService } from './ocr.service';
import { compactText, parsePiece, type ParsedPiece } from './parser';

export interface ItemInput {
  kind: 'image' | 'text';
  storageKey: string | null;
  text: string | null;
}

export interface ExtractedProof {
  capture: ParsedPiece | null;
  sms: ParsedPiece | null;
  /** Images ou textes en trop, non rattachés (ex. deux captures) */
  extra: ParsedPiece[];
}

/** Lecture des pièces d'une vérification : OCR des images, analyse des textes. */
@Injectable()
export class ExtractionService implements OnModuleInit {
  private readonly logger = new Logger(ExtractionService.name);
  private formats: ProofFormat[] = [];

  constructor(
    private readonly config: AppConfig,
    private readonly ocr: OcrService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    this.reloadFormats();
  }

  /** Recharge les formats YAML (au démarrage, ou après mise à jour). */
  reloadFormats(): number {
    this.formats = loadFormats(resolve(this.config.get('FORMATS_DIR')));
    this.logger.log(`${this.formats.length} formats chargés`);
    return this.formats.length;
  }

  async extract(items: ItemInput[]): Promise<ExtractedProof> {
    const pieces: ParsedPiece[] = [];
    for (const item of items) {
      if (item.kind === 'text' && item.text) {
        pieces.push(
          parsePiece(item.text, this.formats, {
            source: 'text',
            preferKind: 'sms',
          }),
        );
      } else if (item.kind === 'image' && item.storageKey) {
        // Une panne de stockage ou d'OCR remonte : la vérification passera en relecture
        const image = await this.storage.get(item.storageKey);
        const { text, confidence } = await this.ocr.recognize(image);
        pieces.push(this.parseOcr(text, confidence));
      }
    }
    return assignPieces(pieces);
  }

  parseOcr(text: string, confidence: number): ParsedPiece {
    const piece = parsePiece(text, this.formats, { source: 'ocr', confidence });
    piece.unreadable =
      compactText(text).length < 15 ||
      confidence < this.config.get('OCR_UNREADABLE_CONFIDENCE');
    return piece;
  }
}

/**
 * Répartit les pièces entre capture et SMS.
 * - un texte collé est le SMS ;
 * - une image reconnue « sms » est une capture du SMS ;
 * - une image reconnue « capture », sinon une image inconnue, est la capture ;
 * - une seconde image inconnue, s'il manque le SMS, est traitée comme le SMS.
 */
export function assignPieces(pieces: ParsedPiece[]): ExtractedProof {
  const rest = [...pieces];
  const take = (pred: (p: ParsedPiece) => boolean): ParsedPiece | null => {
    const i = rest.findIndex(pred);
    return i === -1 ? null : rest.splice(i, 1)[0];
  };

  let sms =
    take((p) => p.source === 'text') ??
    take((p) => p.source === 'ocr' && p.kind === 'sms');
  const capture =
    take((p) => p.source === 'ocr' && p.kind === 'capture') ??
    take((p) => p.source === 'ocr');
  if (!sms) sms = take((p) => p.source === 'ocr');

  return { capture, sms, extra: rest };
}
