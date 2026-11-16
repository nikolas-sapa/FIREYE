import { useEffect, useRef, useState } from 'react';
import { STAGE_LABEL, VERY_CLOSE_TEXT, type AlertStage } from './geo/evac';

export const ANNOUNCE_LABEL = 'Simulated exercise - follow official 112 / civil protection instructions';
const rank = { monitor: 0, prepare: 1, leave: 2, shelter: 3 };
export function announcementFor(stage: AlertStage, placeName: string) {
  const title = STAGE_LABEL[stage];
  const what = stage === 'shelter' ? VERY_CLOSE_TEXT : title;
  return { title: `${title} · ${placeName}`, body: `${placeName}: ${what}. ${ANNOUNCE_LABEL}` };
}

export function shouldAnnounce(previous: { home: string | null; stage: AlertStage } | null, home: string | null, stage: AlertStage) {
  return !!home && previous?.home === home && rank[stage] > rank[previous.stage];
}

export async function deliverAnnouncement(stage: AlertStage, name: string, voice: boolean) {
  const { title, body } = announcementFor(stage, name);
  if (voice && typeof speechSynthesis !== 'undefined') {
    try { speechSynthesis.speak(new SpeechSynthesisUtterance(`${title}. ${body}`)); } catch { /* optional */ }
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* optional device capability */ }
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) await registration.showNotification(title, { body, tag: 'fireye-stage', renotify: true } as NotificationOptions);
    else new Notification(title, { body, tag: 'fireye-stage' });
  } catch { /* denied or unavailable notifications must not interrupt the resident view */ }
}

export function useStageAnnouncements(home: string | null, stage: AlertStage, name: string) {
  const previous = useRef<{ home: string | null; stage: AlertStage } | null>(null);
  const supported = typeof Notification !== 'undefined';
  const [permission, setPermission] = useState(supported ? Notification.permission : 'denied');
  const [voice, setVoice] = useState(() => { try { return localStorage.getItem('ops.narrate') === '1'; } catch { return false; } });
  useEffect(() => {
    // Mounts, home switches and falling stages on rewind are silent.
    if (shouldAnnounce(previous.current, home, stage)) void deliverAnnouncement(stage, name, voice);
    previous.current = { home, stage };
  }, [home, stage, name, voice]);
  return {
    supported, permission, voice,
    enable: async () => { try { setPermission(await Notification.requestPermission()); } catch { /* optional */ } },
    toggleVoice: () => setVoice(old => { try { localStorage.setItem('ops.narrate', old ? '0' : '1'); } catch { /* optional */ } return !old; }),
  };
}
