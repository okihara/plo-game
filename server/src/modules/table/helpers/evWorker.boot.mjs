// worker_threads スレッド内で .ts を解決できるよう、本体を import する前に
// tsx ローダーを登録する。本番は `node --import tsx` で起動するが、
// tsx のローダーは worker スレッドへ自動伝播しないため、ここで明示的に register する。
import { register } from 'tsx/esm/api';
register();
await import('./evWorker.ts');
