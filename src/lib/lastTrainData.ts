// 最終便の表（リポジトリ直下の data/last-trains.json）を読む。サーバー側でだけ使う。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { LastTrainTable } from './lastTrain.ts';

export function loadLastTrainTable(): LastTrainTable {
  return JSON.parse(readFileSync(path.join(process.cwd(), 'data', 'last-trains.json'), 'utf8')) as LastTrainTable;
}
