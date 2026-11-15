import { Global, Module } from '@nestjs/common';
import { AdminNotifier } from './admin-notifier.service';
import { AuditService } from './audit.service';
import { SettingsService } from './settings.service';

@Global()
@Module({
  providers: [AuditService, AdminNotifier, SettingsService],
  exports: [AuditService, AdminNotifier, SettingsService],
})
export class CommonModule {}
