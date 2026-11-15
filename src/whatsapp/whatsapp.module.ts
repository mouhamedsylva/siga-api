import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { INBOUND_QUEUE } from '../queue/queues';
import { SignatureGuard } from './signature.guard';
import { WebhookController } from './webhook.controller';
import { WhatsappClient } from './whatsapp.client';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: INBOUND_QUEUE })],
  controllers: [WebhookController],
  providers: [WhatsappClient, SignatureGuard],
  exports: [WhatsappClient],
})
export class WhatsappModule {}
