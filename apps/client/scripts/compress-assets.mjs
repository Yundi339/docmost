import { constants, brotliCompress, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const assetsDir = fileURLToPath(new URL('../dist/assets/', import.meta.url));
const compressibleExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.svg',
  '.wasm',
]);
const minimumSize = 1024;

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const filePath = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(filePath) : [filePath];
    }),
  );
  return files.flat();
}

let compressedCount = 0;
for (const filePath of await listFiles(assetsDir)) {
  if (!compressibleExtensions.has(extname(filePath))) continue;
  if ((await stat(filePath)).size < minimumSize) continue;

  const content = await readFile(filePath);
  const [brotliContent, gzipContent] = await Promise.all([
    brotli(content, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 5,
      },
    }),
    gzipAsync(content, { level: 9 }),
  ]);

  await Promise.all([
    writeFile(`${filePath}.br`, brotliContent),
    writeFile(`${filePath}.gz`, gzipContent),
  ]);
  compressedCount += 1;
}

console.log(`Precompressed ${compressedCount} client assets.`);
