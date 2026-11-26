// MapLibre（OpenFreeMap の地図を描く部品）の裏の処理（ワーカー）のファイルを、public/maplibre/ に写す。
// Next.js のバンドラーはこのワーカーのファイルを自動では含めないので、静的ファイルとして配り、
// 画面側で setWorkerUrl('/maplibre/maplibre-gl-worker.mjs') と教える（src/app/_components/mapCommon.ts）。
// npm run dev・npm run build の前に自動で動く（package.json の predev・prebuild）。写したファイルは Git に入れない（.gitignore）。

import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkg = require.resolve('maplibre-gl/package.json');
const src = path.join(path.dirname(pkg), 'dist', 'maplibre-gl-worker.mjs');
const outDir = path.join(process.cwd(), 'public', 'maplibre');
mkdirSync(outDir, { recursive: true });
copyFileSync(src, path.join(outDir, 'maplibre-gl-worker.mjs'));
console.log('copied maplibre-gl-worker.mjs → public/maplibre/');
