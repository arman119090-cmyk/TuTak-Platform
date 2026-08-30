import * as Sentry from '@sentry/nextjs';
import { buildSentryOptions } from './src/lib/observability/sentryOptions';

Sentry.init(buildSentryOptions());
