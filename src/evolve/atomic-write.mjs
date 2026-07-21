import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';

/**
 * Write JSON atomically (temp in same directory + rename).
 * Same-dir temp avoids cross-mount rename failures.
 * @param {string} path
 * @param {unknown} value
 */
export async function writeJsonAtomic(path, value) {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
  return path;
}
