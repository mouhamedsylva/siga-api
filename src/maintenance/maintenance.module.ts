import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MAINTENANCE_QUEUE } from '../queue/queues';
import { MaintenanceProcessor } from './maintenance.processor';

@Module({
  imports: [BullModule.registerQueue({ name: MAINTENANCE_QUEUE })],
  providers: [MaintenanceProcessor],
})
export class MaintenanceModule {}
