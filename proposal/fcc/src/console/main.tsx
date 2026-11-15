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
const OpsApp = lazy(() => import('./ops/OpsApp'));
const search = window.location.search;
const mode = new URLSearchParams(search).get('mode');
const crew = mode === 'crew';
const replay = legacyEntry(search);
const monitoring = !replay && mode === 'monitoring';
const fireye = !replay && mode === 'fireye';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<div className="flex h-dvh items-center justify-center bg-void font-mono text-micro uppercase tracking-[0.32em] text-bone-mute">FIREYE</div>}>
      {crew ? <CrewApp /> : replay ? <ConsoleApp /> : monitoring ? <MonitoringApp /> : fireye ? <FireyeApp /> : <OpsApp />}
    </Suspense>
  </React.StrictMode>,
);
