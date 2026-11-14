import { useState } from 'react';
import { installApp, useInstallState } from '../../pwa/install';
import { Button } from './Button';
import { Modal } from './feedback';

export function InstallAppButton() {
  const state = useInstallState();
  const [help, setHelp] = useState(false);
  if (state === 'installed') return null;
  return (
    <>
      <Button size="sm" title="Install FCC without the browser address bar" onClick={() => state === 'ready' ? void installApp() : setHelp(true)}>
        Install
      </Button>
      <Modal open={help} onClose={() => setHelp(false)} title="Install FCC">
        <div className="space-y-3 text-sm leading-6 text-bone-dim">
          <p>Open the installed FCC app from your Dock, desktop or home screen to use it without the browser address bar.</p>
          <p><strong className="text-bone">Chrome / Edge:</strong> use the install icon in the address bar, or the browser menu’s Install app command.</p>
          <p><strong className="text-bone">Safari on Mac:</strong> File → Add to Dock. <strong className="text-bone">iPhone / iPad:</strong> Share → Add to Home Screen → Open as Web App.</p>
          <p>Offline installation is enabled in the production build over HTTPS or localhost. Allow the first download to finish online. Streamed 3D maps still need a connection. An operating-system title bar may remain.</p>
        </div>
      </Modal>
    </>
  );
}
