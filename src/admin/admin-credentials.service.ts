import { Injectable } from '@nestjs/common';
import { compare, hashSync } from 'bcryptjs';
import { AppConfig } from '../config/app-config.service';

/**
 * Comptes administrateurs (ADMIN_USERS = "login:hashBcrypt,login2:hashBcrypt").
 * Utilisé par le Basic auth (Bruno, scripts) et par la page de connexion du back-office.
 */
@Injectable()
export class AdminCredentials {
  private readonly users: Map<string, string>;
  /** Hash factice : un login inconnu coûte le même temps qu'un vrai */
  private readonly dummyHash = hashSync('siga-dummy', 10);

  constructor(config: AppConfig) {
    this.users = new Map(
      config
        .get('ADMIN_USERS')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const i = entry.indexOf(':');
          return [entry.slice(0, i), entry.slice(i + 1)] as [string, string];
        }),
    );
  }

  /** Vrai si le couple login / mot de passe est valide. */
  async verify(login: string, password: string): Promise<boolean> {
    const hash = this.users.get(login);
    // On compare toujours, même pour un login inconnu
    const ok = await compare(password, hash ?? this.dummyHash);
    return ok && !!hash;
  }

  exists(login: string): boolean {
    return this.users.has(login);
  }
}
