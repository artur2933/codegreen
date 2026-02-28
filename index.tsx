
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './src/app.component';
import { provideZonelessChangeDetection, ErrorHandler } from '@angular/core';
import * as Sentry from '@sentry/angular';

// Initialize Sentry only if a valid DSN is provided
const SENTRY_DSN: string = ""; // Add your DSN here

if (SENTRY_DSN && SENTRY_DSN.startsWith("http")) {
  Sentry.init({
    dsn: SENTRY_DSN,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    ...(SENTRY_DSN && SENTRY_DSN.startsWith("http") ? [{
      provide: ErrorHandler,
      useValue: Sentry.createErrorHandler({
        showDialog: false,
      }),
    }] : [])
  ]
}).catch(err => console.error(err));

// AI Studio always uses an `index.tsx` file for all project types.
