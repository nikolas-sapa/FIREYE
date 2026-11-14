import { useSyncExternalStore } from 'react';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let prompt: InstallPrompt | null = null;
let installed = typeof window !== 'undefined' && (
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true
);
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    prompt = e as InstallPrompt;
    notify();
  });
  window.addEventListener('appinstalled', () => { installed = true; prompt = null; notify(); });
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function useInstallState() {
  return useSyncExternalStore(subscribe, () => installed ? 'installed' : prompt ? 'ready' : 'manual', () => 'manual');
}
export async function installApp() {
  const event = prompt;
  if (!event) return;
  prompt = null;
  notify();
  try {
    await event.prompt();
    await event.userChoice;
  } catch { /* The browser owns cancellation and eligibility. A future event can retry. */ }
}
