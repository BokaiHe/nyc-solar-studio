import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cesiumBuild = join(projectRoot, 'node_modules', 'cesium', 'Build', 'Cesium');
const destination = join(projectRoot, 'public', 'cesium');

await mkdir(destination, { recursive: true });
for (const directory of ['Assets', 'ThirdParty', 'Widgets', 'Workers']) {
  await cp(join(cesiumBuild, directory), join(destination, directory), {
    recursive: true,
    force: true,
  });
}
