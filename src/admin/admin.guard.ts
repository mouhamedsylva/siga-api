import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminCredentials } from './admin-credentials.service';
import {
  ADMIN_HEADER,
  SESSION_COOKIE,
  SessionService,
} from './session.service';

export interface AdminRequest extends Request {
  adminUser: string;
  cookies: Record<string, string | undefined>;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Accès administrateur (EF-60), deux modes :
 * - cookie de session (back-office) : les requêtes qui modifient doivent porter
 *   l'en-tête X-SIGA-Admin (protection CSRF, en plus de SameSite=Strict) ;
 * - HTTP Basic (Bruno, scripts), à n'utiliser que derrière HTTPS.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(
    private readonly credentials: AdminCredentials,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<AdminRequest>();

    // 1. Session du back-office
    const sid = req.cookies?.[SESSION_COOKIE];
    if (sid) {
      const login = await this.sessions.get(sid);
      if (login && this.credentials.exists(login)) {
        if (!SAFE_METHODS.has(req.method) && req.header(ADMIN_HEADER) !== '1') {
          throw new ForbiddenException('En-tête X-SIGA-Admin manquant');
        }
        req.adminUser = login;
        return true;
      }
    }

    // 2. HTTP Basic
    const [scheme, encoded] = (req.header('authorization') ?? '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      if (
        i > 0 &&
        (await this.credentials.verify(
          decoded.slice(0, i),
          decoded.slice(i + 1),
        ))
      ) {
        req.adminUser = decoded.slice(0, i);
        return true;
      }
      this.logger.warn('Échec d’authentification administrateur (Basic)');
    }

    // Pas de fenêtre de connexion du navigateur pour le back-office (il gère sa propre page)
    if (!req.header(ADMIN_HEADER)) {
      http
        .getResponse<Response>()
        .setHeader(
          'WWW-Authenticate',
          'Basic realm="SIGA admin", charset="UTF-8"',
        );
    }
    throw new UnauthorizedException();
  }
}
