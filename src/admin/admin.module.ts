import { Module } from '@nestjs/common';
import { VerificationModule } from '../verification/verification.module';
import { AdminCredentials } from './admin-credentials.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AuthController } from './auth.controller';
import { SessionService } from './session.service';

@Module({
  imports: [VerificationModule],
  controllers: [AuthController, AdminController],
  providers: [AdminService, AdminGuard, AdminCredentials, SessionService],
})
export class AdminModule {}
