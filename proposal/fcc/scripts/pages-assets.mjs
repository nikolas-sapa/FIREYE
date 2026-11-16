import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function archiveUrls(source, base) {
  if (base === '/') return source;
  return source.replace(/(["'`(])\/(rev-[^/]+\/|data\/|console\.html)/g, `$1${base}$2`);
}

export async function prepareArchives(dist, base) {
  if (base === '/') return;
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(html|css|js)$/.test(entry.name)) {
        const source = await readFile(path, 'utf8');
        const rewritten = archiveUrls(source, base);
        if (rewritten !== source) await writeFile(path, rewritten);
      }
    }
  }
  for (const entry of await readdir(dist, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('rev-')) await walk(join(dist, entry.name));
  }
}
