import { BullModule } from '@nestjs/bullmq';
import { Logger, Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BillingModule } from './billing/billing.module';
import { CommonModule } from './common/common.module';
import { AppConfig } from './config/app-config.service';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { AdminModule } from './admin/admin.module';
import { InboundModule } from './inbound/inbound.module';
import { LegalModule } from './legal/legal.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    CommonModule,
    StorageModule,
    BillingModule,
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        connection: {
          url: config.get('REDIS_URL'),
          maxRetriesPerRequest: null,
        },
      }),
    }),
    WhatsappModule,
    InboundModule,
    HealthModule,
    AdminModule,
    LegalModule,
    MaintenanceModule,
    // Back-office compilé (siga-admin/dist), servi sous /backoffice ; ignoré s'il n'est pas construit
    ServeStaticModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => {
        const rootPath = resolve(config.get('ADMIN_UI_DIR'));
        if (!existsSync(join(rootPath, 'index.html'))) {
          new Logger('Backoffice').warn(
            'Back-office non construit (' +
              rootPath +
              ') : /backoffice indisponible',
          );
          return [];
        }
        return [
          {
            rootPath,
            serveRoot: '/backoffice',
            serveStaticOptions: { index: 'index.html', maxAge: '1h' },
          },
        ];
      },
    }),
  ],
})
export class AppModule {}
