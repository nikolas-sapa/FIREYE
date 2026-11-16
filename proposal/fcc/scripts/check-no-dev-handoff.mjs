import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function verifyNoDevHandoff(root, capabilities = []) {
  const needles = ['/__dev/ops-handoff', 'fcc-dev-ops-handoff', 'dev-autoconnect', ...capabilities].map(s => Buffer.from(s));
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const data = await readFile(path);
        if (needles.some(needle => data.includes(needle))) throw new Error('Production output contains dev handoff code or capability material');
      }
    }
  }
  await visit(root instanceof URL ? fileURLToPath(root) : root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = new URL('../../../backend/.scratch/', import.meta.url);
  const capabilities = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !entry.name.startsWith('local-demo-')) continue;
    try {
      const handoff = JSON.parse(await readFile(new URL(`${entry.name}/capabilities.json`, directory), 'utf8'));
      for (const role of Object.values(handoff.roles)) {
        if (typeof role.capability === 'string' && role.capability.length >= 32) capabilities.push(role.capability);
      }
    } catch { /* Missing or incomplete private handoffs are not build inputs. */ }
  }
  await verifyNoDevHandoff(new URL('../dist/', import.meta.url), capabilities);
  console.log('Production handoff isolation: no dev endpoint, auto-connect module, or current private capability strings PASS');
}
