// Before every other import, so a throw during App's own module evaluation
// is still captured. Sentry.init is itself a no-op-safe call when this
// build carries no DSN — see app/sentry.ts.
import { initSentry } from './src/app/sentry';
initSentry();

import { registerRootComponent } from 'expo';
import * as Sentry from '@sentry/react-native';
import App from './App';

registerRootComponent(Sentry.wrap(App));
