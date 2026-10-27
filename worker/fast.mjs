// Diagnostico local: executa o mesmo coletor do worker e salva a fotografia em disco.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { collectServopaSnapshot } from "./lib/collector.mjs";
import { loadWorkerEnv, WORKER_DIR } from "./lib/env.mjs";

loadWorkerEnv();
const outputDir = path.resolve(WORKER_DIR, process.env.OUT ?? ".probe/fast");
const concurrency = Number(process.env.CONC ?? process.env.SERVOPA_CONCURRENCY ?? 2);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) {
  throw new Error("CONC deve ser 1 ou 2.");
}
mkdirSync(outputDir, { recursive: true });

const startedAt = Date.now();
const snapshot = await collectServopaSnapshot({ concurrency }, {
  onProgress(progress) {
    if (progress.phase === "FETCHING_GROUPS" && (progress.completed % 20 === 0 || progress.completed === progress.total)) {
      console.log(`${progress.completed}/${progress.total} grupos`);
    }
  },
});

const lists = Object.fromEntries(snapshot.lists.map((list) => [list.segment === "REAL_ESTATE" ? "IS" : "MS", list.rows]));
writeFileSync(path.join(outputDir, "_listas.json"), JSON.stringify(lists, null, 1));
for (const page of snapshot.pages) {
  writeFileSync(path.join(outputDir, `${page.number}-S.json`), JSON.stringify(page.group, null, 1));
}
console.log(`fim: ${snapshot.pages.length} grupos em ${((Date.now() - startedAt) / 1_000).toFixed(0)}s`);
