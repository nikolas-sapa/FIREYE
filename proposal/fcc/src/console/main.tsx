import React from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import '../pwa/register';
import { lazy, Suspense } from 'react';
import { consoleEntry } from './entry';

const ConsoleApp = lazy(() => import('./ConsoleApp'));
const MonitoringApp = lazy(() => import('./monitoring/MonitoringApp'));
const FireyeApp = lazy(() => import('./fireye/FireyeApp'));
const CrewApp = lazy(() => import('./crew/CrewApp'));
const OpsApp = lazy(() => import('./ops/OpsApp'));
const entry = consoleEntry(window.location.search);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<div className="flex h-dvh items-center justify-center bg-void font-mono text-micro uppercase tracking-[0.32em] text-bone-mute">FIREYE</div>}>
      {entry === 'crew' ? <CrewApp /> : entry === 'replay' ? <ConsoleApp /> : entry === 'monitoring' ? <MonitoringApp /> : entry === 'fireye' ? <FireyeApp /> : <OpsApp />}
    </Suspense>
  </React.StrictMode>,
);
