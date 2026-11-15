import { Module } from '@nestjs/common';
import { VerificationModule } from '../verification/verification.module';
import { AccountService } from './account.service';
import { ConversationService } from './conversation.service';

@Module({
  imports: [VerificationModule],
  providers: [ConversationService, AccountService],
  exports: [ConversationService],
})
export class ConversationModule {}
