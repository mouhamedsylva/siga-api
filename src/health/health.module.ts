import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { INBOUND_QUEUE } from '../queue/queues';
import { HealthController } from './health.controller';

@Module({
  imports: [BullModule.registerQueue({ name: INBOUND_QUEUE })],
  controllers: [HealthController],
})
export class HealthModule {}
