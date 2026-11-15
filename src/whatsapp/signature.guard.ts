import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig } from '../config/app-config.service';
import { isValidSignature } from './signature';

@Injectable()
export class SignatureGuard implements CanActivate {
  private readonly logger = new Logger(SignatureGuard.name);

  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const ok = isValidSignature(
      req.rawBody,
      req.header('x-hub-signature-256'),
      this.config.get('META_APP_SECRET'),
    );
    if (!ok) {
      this.logger.warn('Webhook rejeté : signature invalide');
      throw new UnauthorizedException();
    }
    return true;
  }
}
