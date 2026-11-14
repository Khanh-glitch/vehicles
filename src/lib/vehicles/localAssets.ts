import { existsSync } from 'node:fs';
import path from 'node:path';

const MODELS_DIRECTORY = path.resolve(process.cwd(), 'public', 'models');

/** True only when a public, bundled GLB exists in this checkout. */
export function hasLocalVehicleModel(modelUrl: string): boolean {
  if (!modelUrl.startsWith('/models/')) return false;

  const relativePath = modelUrl.slice('/models/'.length);
  const absolutePath = path.resolve(MODELS_DIRECTORY, relativePath);
  return (
    absolutePath.startsWith(`${MODELS_DIRECTORY}${path.sep}`) &&
    existsSync(absolutePath) &&
    absolutePath.toLowerCase().endsWith('.glb')
  );
}
