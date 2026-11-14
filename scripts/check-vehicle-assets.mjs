import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const catalogPath = path.join(projectRoot, 'src/lib/vehicles/catalog.ts');
const catalog = fs.readFileSync(catalogPath, 'utf8');
const modelUrls = [...catalog.matchAll(/modelUrl:\s*['"]([^'"]+\.glb)['"]/g)]
  .map((match) => match[1])
  .filter((url, index, urls) => urls.indexOf(url) === index);

if (modelUrls.length === 0) {
  console.error('No local GLB model URLs were found in the vehicle catalog.');
  process.exit(1);
}

let available = 0;
const missing = [];
for (const modelUrl of modelUrls) {
  const relativePath = modelUrl.replace(/^\/+/, '');
  const absolutePath = path.resolve(projectRoot, 'public', relativePath);
  const publicRoot = path.resolve(projectRoot, 'public');
  const exists = absolutePath.startsWith(`${publicRoot}${path.sep}`) && fs.existsSync(absolutePath);
  if (exists) {
    available += 1;
    const sizeMb = (fs.statSync(absolutePath).size / (1024 * 1024)).toFixed(2);
    console.log(`OK      ${modelUrl} (${sizeMb} MB)`);
  } else {
    missing.push(modelUrl);
    console.warn(`MISSING ${modelUrl}`);
  }
}

console.log(`\n${available}/${modelUrls.length} catalog GLBs are bundled.`);
if (missing.length > 0) {
  console.warn('The app hides missing models rather than loading a substitute.');
}
if (available === 0) process.exit(1);
