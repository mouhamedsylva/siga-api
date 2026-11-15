import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { AppConfig } from '../config/app-config.service';
import { AdminCredentials } from './admin-credentials.service';
import { ZodPipe } from './admin.dto';
import { AdminGuard, type AdminRequest } from './admin.guard';
import { SESSION_COOKIE, SessionService } from './session.service';

const loginInput = z.object({
  login: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(200),
});

/** Connexion du back-office par session (cookie httpOnly, SameSite=Strict). */
@Controller('admin/auth')
export class AuthController {
  constructor(
    private readonly credentials: AdminCredentials,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.get('NODE_ENV') === 'production',
      path: '/',
    };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginInput)) body: z.infer<typeof loginInput>,
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ login: string }> {
    const ip = req.ip ?? 'inconnue';
    if (await this.sessions.isLocked(ip, body.login)) {
      throw new HttpException(
        'Trop de tentatives. Réessaie dans 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!(await this.credentials.verify(body.login, body.password))) {
      await this.sessions.recordFailure(ip, body.login);
      await this.audit.log('anonymous', 'admin.login_failed', 'auth', {
        login: body.login.slice(0, 40),
      });
      throw new UnauthorizedException('Identifiants invalides');
    }
    await this.sessions.clearFailures(ip, body.login);
    const sid = await this.sessions.create(body.login);
    res.cookie(SESSION_COOKIE, sid, {
      ...this.cookieOptions(),
      maxAge: this.sessions.ttlSeconds * 1000,
    });
    await this.audit.log(body.login, 'admin.login', 'auth');
    return { login: body.login };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async logout(
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.sessions.destroy(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
    await this.audit.log(req.adminUser, 'admin.logout', 'auth');
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AdminGuard)
  me(@Req() req: AdminRequest): { login: string } {
    return { login: req.adminUser };
  }
}
