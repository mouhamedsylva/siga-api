import { Controller, Get, Header, Redirect } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import {
  deletionPage,
  privacyPage,
  renderPage,
  termsPage,
  type LegalParams,
} from './legal.content';

/**
 * Pages publiques exigées par Meta pour publier l'app (confidentialité, suppression des données)
 * et par le cahier des charges (CGU accessibles depuis le bot). Aucune authentification.
 */
@Controller('legal')
export class LegalController {
  constructor(private readonly config: AppConfig) {}

  private params(): LegalParams {
    const c = this.config;
    return {
      entity: c.get('LEGAL_ENTITY_NAME'),
      contactEmail: c.get('LEGAL_CONTACT_EMAIL'),
      imageRetentionDays: c.get('IMAGE_RETENTION_DAYS'),
      termsVersion: c.get('TERMS_VERSION'),
      freeTrials: c.get('FREE_TRIALS'),
      founderPrice: c.get('FOUNDER_PRICE'),
      standardPrice: c.get('STANDARD_PRICE'),
      monthlyQuota: c.get('MONTHLY_QUOTA'),
      overagePrice: c.get('OVERAGE_PRICE'),
      // Liens relatifs : fonctionnent derrière n'importe quel domaine
      baseUrl: '',
    };
  }

  @Get()
  @Redirect('/legal/confidentialite', 302)
  index(): void {}

  @Get('confidentialite')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  privacy(): string {
    const p = this.params();
    return renderPage(privacyPage(p), p);
  }

  @Get('cgu')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  terms(): string {
    const p = this.params();
    return renderPage(termsPage(p), p);
  }

  @Get('suppression-donnees')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  deletion(): string {
    const p = this.params();
    return renderPage(deletionPage(p), p);
  }
}
