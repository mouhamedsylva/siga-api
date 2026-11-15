import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { INBOUND_QUEUE } from '../queue/queues';
import { InboundProcessor } from './inbound.processor';
import { RateLimiter } from './rate-limiter.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: INBOUND_QUEUE }),
    ConversationModule,
  ],
  providers: [InboundProcessor, RateLimiter],
})
export class InboundModule {}
