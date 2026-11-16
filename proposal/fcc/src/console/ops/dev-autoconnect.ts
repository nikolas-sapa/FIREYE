import { opsBackend } from './OpsBackend';

let attempted = false;
export async function autoConnectOps() {
  if (attempted || opsBackend.get().configured || opsBackend.get().busy) return;
  attempted = true;
  try {
    const response = await fetch('/__dev/ops-handoff', { method: 'POST', credentials: 'omit', cache: 'no-store',
      redirect: 'error', headers: { 'X-FCC-Local-Exercise': '1' }, signal: AbortSignal.timeout(3000) });
    if (!response.ok || opsBackend.get().configured || opsBackend.get().busy) return;
    const text = await response.text();
    if (!opsBackend.get().configured && !opsBackend.get().busy) await opsBackend.connect(text);
  } catch { /* Manual connection and local simulation remain available. */ }
}
