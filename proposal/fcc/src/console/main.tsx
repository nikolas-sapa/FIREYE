import React from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import '../pwa/register';
import { lazy, Suspense } from 'react';
import { legacyEntry } from './monitoring/model';

const ConsoleApp = lazy(() => import('./ConsoleApp'));
const MonitoringApp = lazy(() => import('./monitoring/MonitoringApp'));
const replay = legacyEntry(window.location.search);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<div className="flex h-dvh items-center justify-center bg-ink-950 font-mono text-bone">Loading FCC console</div>}>
      {replay ? <ConsoleApp /> : <MonitoringApp />}
    </Suspense>
  </React.StrictMode>,
);
