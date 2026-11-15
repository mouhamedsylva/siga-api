import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Paramètres modifiables à chaud depuis l'administration (table settings),
 * avec repli sur la variable d'environnement.
 */
@Injectable()
export class SettingsService {
  private cache?: { reviewMode: boolean; at: number };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** EF-34 : les cas douteux et inconnus attendent la validation de l'administrateur. */
  async reviewMode(): Promise<boolean> {
    if (this.cache && Date.now() - this.cache.at < 30_000)
      return this.cache.reviewMode;
    const row = await this.prisma.setting.findUnique({
      where: { key: 'review_mode' },
    });
    const reviewMode =
      typeof row?.value === 'boolean'
        ? row.value
        : this.config.get('REVIEW_MODE');
    this.cache = { reviewMode, at: Date.now() };
    return reviewMode;
  }

  async setReviewMode(value: boolean): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key: 'review_mode' },
      create: { key: 'review_mode', value },
      update: { value },
    });
    this.cache = { reviewMode: value, at: Date.now() };
  }
}
