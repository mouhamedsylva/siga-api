import {
  ArgumentsHost,
  Catch,
  HttpException,
  type ExceptionFilter,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { redactText } from './redact';

let enabled = false;

/**
 * Sentry (§8.1, §12) : aucune donnée sensible envoyée — pas de corps de requête,
 * pas d'en-têtes, pas d'utilisateur, numéros masqués dans les messages.
 */
export function initSentry(dsn: string | undefined, environment: string): void {
  // DSN absent ou invalide : Sentry désactivé, sans jamais afficher la valeur
  // (la validation de la configuration signalera l'erreur au démarrage)
  if (!dsn || !/^https?:\/\/[^\s]+@[^\s]+\/\d+$/.test(dsn)) return;
  Sentry.init({
    dsn,
    environment,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeBreadcrumb(crumb) {
      if (crumb.message) crumb.message = redactText(crumb.message);
      delete crumb.data;
      return crumb;
    },
  });
  enabled = true;
}

export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
  }
  delete event.user;
  delete event.extra;
  if (event.message) event.message = redactText(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = redactText(ex.value);
  }
  return event;
}

export function captureException(err: unknown): void {
  if (enabled) Sentry.captureException(err);
}

/** Transmet à Sentry les erreurs serveur (5xx), puis applique le traitement Nest. */
@Catch()
export class SentryFilter
  extends BaseExceptionFilter
  implements ExceptionFilter
{
  catch(exception: unknown, host: ArgumentsHost): void {
    if (!(exception instanceof HttpException) || exception.getStatus() >= 500) {
      captureException(exception);
    }
    super.catch(exception, host);
  }
}
