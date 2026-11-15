import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  auditQuery,
  blockInput,
  idParam,
  paymentInput,
  reviewDecision,
  sellerFilter,
  settingsInput,
  statsQuery,
  verificationFilter,
  ZodPipe,
  type PaymentInput,
  type ReviewDecision,
  type SellerFilter,
  type VerificationFilter,
} from './admin.dto';
import { AdminGuard, type AdminRequest } from './admin.guard';
import { AdminService } from './admin.service';

const Id = (name = 'id') => Param(name, new ZodPipe(idParam));

/** Routes d'administration (§10). Toutes protégées par AdminGuard. */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('verifications')
  listVerifications(
    @Query(new ZodPipe(verificationFilter)) f: VerificationFilter,
  ) {
    return this.admin.listVerifications(f);
  }

  @Get('verifications/:id')
  getVerification(@Id() id: bigint) {
    return this.admin.getVerification(id);
  }

  @Get('verifications/:id/items/:itemId/image')
  async image(
    @Id() id: bigint,
    @Id('itemId') itemId: bigint,
    @Res() res: Response,
  ) {
    const { data, mimeType } = await this.admin.getItemImage(id, itemId);
    res
      .setHeader('Content-Type', mimeType)
      .setHeader('Cache-Control', 'private, no-store')
      .setHeader('X-Content-Type-Options', 'nosniff')
      .send(data);
  }

  @Get('review')
  reviewQueue() {
    return this.admin.reviewQueue();
  }

  @Post('review/:id')
  review(
    @Id() id: bigint,
    @Body(new ZodPipe(reviewDecision)) body: ReviewDecision,
    @Req() req: AdminRequest,
  ) {
    return this.admin.review(id, body, req.adminUser);
  }

  @Get('sellers')
  listSellers(@Query(new ZodPipe(sellerFilter)) f: SellerFilter) {
    return this.admin.listSellers(f);
  }

  @Get('sellers/:id')
  getSeller(@Id() id: bigint) {
    return this.admin.getSeller(id);
  }

  @Post('sellers/:id/payments')
  recordPayment(
    @Id() id: bigint,
    @Body(new ZodPipe(paymentInput)) body: PaymentInput,
    @Req() req: AdminRequest,
  ) {
    return this.admin.recordPayment(id, body, req.adminUser);
  }

  @Post('sellers/:id/block')
  block(
    @Id() id: bigint,
    @Body(new ZodPipe(blockInput)) body: { blocked: boolean },
    @Req() req: AdminRequest,
  ) {
    return this.admin.setBlocked(id, body.blocked, req.adminUser);
  }

  @Get('stats')
  stats(@Query(new ZodPipe(statsQuery)) q: { days: number }) {
    return this.admin.stats(q.days);
  }

  @Get('settings')
  settings() {
    return this.admin.getSettings();
  }

  @Post('settings')
  updateSettings(
    @Body(new ZodPipe(settingsInput)) body: { reviewMode: boolean },
    @Req() req: AdminRequest,
  ) {
    return this.admin.setReviewMode(body.reviewMode, req.adminUser);
  }

  @Post('formats/reload')
  reloadFormats(@Req() req: AdminRequest) {
    return this.admin.reloadFormats(req.adminUser);
  }

  @Get('audit')
  audit(@Query(new ZodPipe(auditQuery)) q: { page: number; pageSize: number }) {
    return this.admin.auditLog(q.page, q.pageSize);
  }
}
