import fs from 'node:fs';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

const projectRoot = process.cwd();
const bundledSourcesDirectory = path.join(projectRoot, 'assets', 'model-sources');
const extractedSourcesDirectory = path.join(projectRoot, 'assets', 'source');
const retiredGeneratedModel = path.join(projectRoot, 'public', 'models', 'saigon-scooter-125i.glb');
const sources = [
  'honda_super_cub.glb',
  'motorbike_-_honda_cg_125.glb',
  'motorcycle_harley_davidson_fat_boy_inspired.glb',
  'harledson_XYN.glb',
];

await fs.promises.mkdir(extractedSourcesDirectory, { recursive: true });
await fs.promises.rm(retiredGeneratedModel, { force: true });
for (const fileName of sources) {
  const compressedPath = path.join(bundledSourcesDirectory, `${fileName}.gz`);
  if (!fs.existsSync(compressedPath)) {
    throw new Error(`Bundled original model source is missing: ${compressedPath}`);
  }

  const extractedPath = path.join(extractedSourcesDirectory, fileName);
  console.log(`Extracting original source: ${fileName}`);
  await pipeline(
    createReadStream(compressedPath),
    createGunzip(),
    createWriteStream(extractedPath)
  );
}

console.log('Building the bundled local GLB models from their exact source files...');
const result = spawnSync(process.execPath, ['scripts/process-vehicles.mjs'], {
  cwd: projectRoot,
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Vehicle model generation failed with exit code ${result.status ?? 'unknown'}.`);
}

const check = spawnSync(process.execPath, ['scripts/check-vehicle-assets.mjs'], {
  cwd: projectRoot,
  stdio: 'inherit',
});
if (check.error) throw check.error;
if (check.status !== 0) {
  throw new Error(`Local model asset validation failed with exit code ${check.status ?? 'unknown'}.`);
}
