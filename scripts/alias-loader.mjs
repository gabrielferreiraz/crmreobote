// Resolve "@/..." (alias do tsconfig) para scripts de teste rodados com
// `node --experimental-strip-types --import ./scripts/alias-loader.mjs`.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      import { existsSync } from "node:fs";
      import { fileURLToPath, pathToFileURL } from "node:url";
      const root = ${JSON.stringify(pathToFileURL(process.cwd() + "/").href)};
      export async function resolve(spec, ctx, next) {
        let url = spec.startsWith("@/") ? new URL(spec.slice(2), root).href : null;
        if (!url && (spec.startsWith("./") || spec.startsWith("../")) && ctx.parentURL?.startsWith("file:")) url = new URL(spec, ctx.parentURL).href;
        if (url && !/[.](ts|tsx|mjs|js|json)$/.test(url)) {
          for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(fileURLToPath(url + ext))) return next(url + ext, ctx);
        }
        try {
          return await next(url ?? spec, ctx);
        } catch (err) {
          // Pacote sem "exports" importado por subcaminho (ex.: "next/server" → next/server.js).
          if (!url && err?.code === "ERR_MODULE_NOT_FOUND") return next(spec + ".js", ctx);
          throw err;
        }
      }
    `),
  pathToFileURL("./"),
);
