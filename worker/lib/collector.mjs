import { openLoggedIn, passCloudflare, showRobotBanner } from "./browser.mjs";
import { WorkerError } from "./errors.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = () => sleep(250 + Math.random() * 450);

function vacancies(value) {
  const normalized = String(value ?? "").replace(/\D/g, "");
  return normalized ? Number(normalized) : Number.NaN;
}

async function openGroupsPage(page) {
  if (!/\/vendas\/grupos\/?$/.test(new URL(page.url()).pathname)) {
    const target = page.locator('a[href$="/vendas/grupos"]').first();
    if ((await target.count()) !== 1) {
      throw new WorkerError("SERVOPA_LAYOUT_CHANGED", "O menu de grupos nao foi encontrado.");
    }
    await Promise.all([
      page.waitForURL(/\/vendas\/grupos\/?$/, { timeout: 30_000 }),
      target.evaluate((element) => element.click()),
    ]);
  }
  await page.waitForLoadState("load");
  await passCloudflare(page, "ao abrir os grupos");
  await page.waitForSelector("#frm_representante_grupo", { timeout: 30_000 });
  await showRobotBanner(page);
  await sleep(1_000);
}

async function fetchAndParse(page, params) {
  try {
    return await page.evaluate(async (input) => {
      const response = input.groupNumber
        ? await fetch(`${location.origin}/vendas/grupos/${input.groupNumber}/S`, { credentials: "same-origin" })
        : await fetch(`${location.origin}/vendas/grupos`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ segmento: input.segment, tp_lance: "S", grupofrm: "" }).toString(),
          });
      const html = await response.text();
      const cloudflareBlocked = /<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(html);
      const loginPage = /id=["']representante_cpf_cnpj["']/i.test(html);
      if (response.status !== 200 || cloudflareBlocked || loginPage) {
        return { httpStatus: response.status, cloudflareBlocked, loginPage };
      }

      const document = new DOMParser().parseFromString(html, "text/html");
      const text = (value) => (value ?? "").replace(/\s+/g, " ").trim();
      if (!input.groupNumber) {
        const rows = [...document.querySelectorAll("table tr")]
          .map((row) => [...row.querySelectorAll("td")].map((cell) => text(cell.textContent)))
          .filter((cells) => cells.length >= 7 && /^\d+$/.test(cells[0]))
          .map((cells) => ({
            grupo: cells[0],
            segmento: cells[1],
            meses: cells[2],
            assembleia: cells[3],
            lance: cells[4],
            contemplados: cells[5],
            vagas: cells[6],
          }));
        return { httpStatus: response.status, cloudflareBlocked: false, rows };
      }

      const info = document.querySelector(".grupo-info");
      const title = document.querySelector(".grupos > h3");
      if (!info || !title) {
        return {
          httpStatus: response.status,
          cloudflareBlocked: false,
          parseError: text(document.querySelector(".error-view")?.textContent) || "Pagina do grupo sem dados",
        };
      }
      const pre = info.querySelector(".pre-message");
      let preMessage = "";
      if (pre) {
        const clone = pre.cloneNode(true);
        clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
        preMessage = clone.textContent.trim();
      }
      const rawInfo = {};
      info.querySelectorAll(":scope > .table-wrapper table tr").forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) rawInfo[text(cells[0].textContent)] = text(cells[1].textContent);
      });
      const labels = [...info.querySelectorAll(".assets .tabs a")].map((item) => text(item.textContent));
      const tabs = [...info.querySelectorAll(".assets > .tab")].map((tab, index) => ({
        aba: labels[index] ?? null,
        cabecalho: [...tab.querySelectorAll("thead th")].map((cell) => text(cell.textContent)),
        linhas: [...tab.querySelectorAll("tbody tr")].map((row) =>
          [...row.querySelectorAll("td")].slice(0, 9).map((cell) => text(cell.textContent)),
        ),
      }));
      return {
        httpStatus: response.status,
        cloudflareBlocked: false,
        group: {
          grupo: input.groupNumber,
          segmento: input.segment,
          tp: "S",
          titulo: text(title.textContent),
          preMessage,
          info: rawInfo,
          tabs,
        },
      };
    }, params);
  } catch (cause) {
    throw new WorkerError("SERVOPA_BROWSER_ERROR", "O navegador perdeu a conexao com a Servopa.", { cause });
  }
}

function assertResponse(result, label) {
  if (result.loginPage) {
    throw new WorkerError("SERVOPA_SESSION_EXPIRED", "A sessao da Servopa expirou durante a coleta.");
  }
  if (result.cloudflareBlocked) {
    throw new WorkerError("CLOUDFLARE_BLOCKED", `O Cloudflare bloqueou ${label}.`);
  }
  if (result.httpStatus !== 200) {
    throw new WorkerError("SERVOPA_HTTP_ERROR", `A Servopa respondeu ${result.httpStatus} em ${label}.`);
  }
}

export async function collectServopaSnapshot(config, { onProgress = async () => {}, signal, log = () => {} } = {}) {
  const { context, page } = await openLoggedIn(config, { log });
  try {
    await openGroupsPage(page);
    const lists = [];
    for (const [segment, name] of [["I", "REAL_ESTATE"], ["M", "MOVABLE"]]) {
      if (signal?.aborted) throw signal.reason;
      const result = await fetchAndParse(page, { segment });
      assertResponse(result, `a lista ${segment}`);
      if (!Array.isArray(result.rows) || result.rows.length === 0) {
        throw new WorkerError("SERVOPA_LAYOUT_CHANGED", `A lista ${segment} veio vazia ou mudou de formato.`);
      }
      for (const row of result.rows) {
        if (!Number.isFinite(vacancies(row.vagas))) {
          throw new WorkerError("SERVOPA_LAYOUT_CHANGED", `O grupo ${row.grupo} veio sem quantidade de vagas.`);
        }
      }
      lists.push({ segment: name, httpStatus: result.httpStatus, cloudflareBlocked: false, rows: result.rows });
      await onProgress({ phase: "LISTING_GROUPS", completed: lists.length, total: 2 });
      await jitter();
    }

    const available = lists.flatMap((list) => list.rows).filter((row) => vacancies(row.vagas) > 0);
    if (available.length === 0) throw new WorkerError("SERVOPA_LAYOUT_CHANGED", "Nenhum grupo com vagas foi encontrado.");
    const queue = [...available];
    const pages = [];
    let completed = 0;
    let paused = false;

    async function collectNext() {
      while (queue.length > 0 && !paused) {
        if (signal?.aborted) throw signal.reason;
        const row = queue.shift();
        const result = await fetchAndParse(page, { groupNumber: row.grupo, segment: row.segmento });
        if (result.cloudflareBlocked) {
          // Devolve o grupo à fila e para as duas frentes; a recuperação abaixo
          // recarrega a página para o Cloudflare refazer a verificação.
          queue.unshift(row);
          paused = true;
        }
        assertResponse(result, `o grupo ${row.grupo}`);
        if (result.parseError || !result.group) {
          throw new WorkerError("SERVOPA_LAYOUT_CHANGED", `O grupo ${row.grupo} nao pode ser interpretado.`);
        }
        pages.push({
          number: row.grupo,
          httpStatus: result.httpStatus,
          cloudflareBlocked: false,
          group: result.group,
        });
        completed++;
        await onProgress({
          phase: "FETCHING_GROUPS",
          completed,
          total: available.length,
          message: `Grupo ${row.grupo}`,
        });
        await jitter();
      }
    }

    // Um `fetch` não resolve o desafio do Cloudflare; uma navegação de verdade,
    // sim (é assim que o robô passa na entrada). Se ele bloquear no meio, espera,
    // recarrega a página de grupos e continua de onde parou — até 2 vezes.
    for (let recoveries = 0; ; recoveries++) {
      const results = await Promise.allSettled(Array.from({ length: config.concurrency }, () => collectNext()));
      const failure = results.find((result) => result.status === "rejected");
      if (!failure) break;
      const error = failure.reason;
      if (!(error instanceof WorkerError && error.code === "CLOUDFLARE_BLOCKED") || recoveries >= 2 || signal?.aborted) throw error;
      log(`Cloudflare pediu nova verificacao (${error.message}); recarregando a pagina e continuando (${recoveries + 1}/2).`);
      await sleep(15_000 * (recoveries + 1));
      if (signal?.aborted) throw signal.reason;
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
      await passCloudflare(page, "depois do bloqueio");
      await openGroupsPage(page);
      paused = false;
    }
    if (queue.length > 0) throw new WorkerError("SERVOPA_INCOMPLETE", "A coleta terminou sem todos os grupos.");
    pages.sort((a, b) => a.number.localeCompare(b.number, "pt-BR", { numeric: true }));
    return { lists, pages };
  } finally {
    await context.close().catch(() => {});
  }
}
