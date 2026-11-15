import React from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import '../pwa/register';
import { lazy, Suspense } from 'react';
import { legacyEntry } from './monitoring/model';

const ConsoleApp = lazy(() => import('./ConsoleApp'));
const MonitoringApp = lazy(() => import('./monitoring/MonitoringApp'));
const FireyeApp = lazy(() => import('./fireye/FireyeApp'));
const CrewApp = lazy(() => import('./crew/CrewApp'));
const search = window.location.search;
const crew = new URLSearchParams(search).get('mode') === 'crew';
const replay = legacyEntry(search);
const monitoring = !replay && new URLSearchParams(search).get('mode') === 'monitoring';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<div className="flex h-dvh items-center justify-center bg-void font-mono text-micro uppercase tracking-[0.32em] text-bone-mute">FIREYE</div>}>
      {crew ? <CrewApp /> : replay ? <ConsoleApp /> : monitoring ? <MonitoringApp /> : <FireyeApp />}
    </Suspense>
  </React.StrictMode>,
);
