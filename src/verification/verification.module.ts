import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ExtractionModule } from '../extraction/extraction.module';
import { VERIFICATION_QUEUE } from '../queue/queues';
import { ProofIntakeService } from './proof-intake.service';
import { VerdictSender } from './verdict-sender.service';
import { VerificationPipeline } from './verification-pipeline.service';
import { VerificationProcessor } from './verification.processor';
import { VerificationScheduler } from './verification.scheduler';

@Module({
  imports: [
    BullModule.registerQueue({ name: VERIFICATION_QUEUE }),
    ExtractionModule,
  ],
  providers: [
    ProofIntakeService,
    VerificationScheduler,
    VerificationProcessor,
    VerificationPipeline,
    VerdictSender,
  ],
  exports: [ProofIntakeService, VerdictSender, ExtractionModule],
})
export class VerificationModule {}
