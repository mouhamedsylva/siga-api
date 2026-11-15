import { Module } from '@nestjs/common';
import { ExtractionService } from './extraction.service';
import { OcrService } from './ocr.service';

@Module({
  providers: [ExtractionService, OcrService],
  exports: [ExtractionService],
})
export class ExtractionModule {}
