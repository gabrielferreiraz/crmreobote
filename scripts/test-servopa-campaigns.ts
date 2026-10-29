/**
 * Campanhas do PDF das tabelas (arte na faixa do cabeçalho):
 *
 *   node --experimental-strip-types --test scripts/test-servopa-campaigns.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  dateKeyFromDb,
  dbDateFromKey,
  describeServopaCampaignWindow,
  isServopaDateKey,
  overlappingServopaCampaigns,
  servopaMonthRange,
  pickActiveServopaCampaign,
  servopaCampaignArtKeyFor,
  servopaCampaignStatus,
  type ServopaCampaignWindow,
} from "../lib/servopa-tables/campaign-rules.ts";

function campaign(overrides: Partial<ServopaCampaignWindow> & { id: string }): ServopaCampaignWindow {
  return {
    enabled: true,
    startsOn: null,
    endsOn: null,
    artKey: "servopa-campaigns/org/a.png",
    realEstateArtKey: null,
    movableArtKey: null,
    updatedAt: "2026-10-28T12:00:00.000Z",
    ...overrides,
  };
}

test("período: os dois dias contam e fora dele a campanha não aparece", () => {
  const black = campaign({ id: "black", startsOn: "2026-11-01", endsOn: "2026-11-30" });
  assert.equal(servopaCampaignStatus(black, "2026-10-31"), "SCHEDULED");
  assert.equal(servopaCampaignStatus(black, "2026-11-01"), "ACTIVE");
  assert.equal(servopaCampaignStatus(black, "2026-11-30"), "ACTIVE");
  assert.equal(servopaCampaignStatus(black, "2026-12-01"), "ENDED");
  assert.equal(servopaCampaignStatus({ ...black, enabled: false }, "2026-11-10"), "DISABLED");
  assert.equal(servopaCampaignStatus({ ...black, artKey: null }, "2026-11-10"), "NO_ART");
  assert.equal(servopaCampaignStatus(campaign({ id: "sempre" }), "2030-01-01"), "ACTIVE", "sem datas: vale enquanto ligada");
});

test("campanhas no mesmo período: vale a que começou por último; empate, a editada por último", () => {
  const november = campaign({ id: "black", startsOn: "2026-11-01", endsOn: "2026-11-30" });
  const weekend = campaign({ id: "fds", startsOn: "2026-11-27", endsOn: "2026-11-29" });
  assert.equal(pickActiveServopaCampaign([november, weekend], "2026-11-28")?.id, "fds");
  assert.equal(pickActiveServopaCampaign([november, weekend], "2026-11-30")?.id, "black");
  assert.equal(pickActiveServopaCampaign([november, weekend], "2026-12-01"), null);

  const older = campaign({ id: "antiga", startsOn: "2026-11-01", updatedAt: "2026-10-01T00:00:00.000Z" });
  const newer = campaign({ id: "nova", startsOn: "2026-11-01", updatedAt: "2026-10-20T00:00:00.000Z" });
  assert.equal(pickActiveServopaCampaign([older, newer], "2026-11-05")?.id, "nova");
});

test("arte por segmento substitui a principal; segmento sem arte fica sem faixa", () => {
  const both = campaign({ id: "a", realEstateArtKey: "servopa-campaigns/org/casa.png" });
  assert.equal(servopaCampaignArtKeyFor(both, "REAL_ESTATE"), "servopa-campaigns/org/casa.png");
  assert.equal(servopaCampaignArtKeyFor(both, "MOVABLE"), "servopa-campaigns/org/a.png");

  const onlyCars = campaign({ id: "carros", artKey: null, movableArtKey: "servopa-campaigns/org/carro.png" });
  assert.equal(pickActiveServopaCampaign([onlyCars], "2026-11-05", "REAL_ESTATE"), null);
  assert.equal(pickActiveServopaCampaign([onlyCars], "2026-11-05", "MOVABLE")?.id, "carros");
});

test("datas: chave AAAA-MM-DD válida e ida e volta pela coluna DATE sem mudar o dia", () => {
  assert.equal(isServopaDateKey("2026-11-30"), true);
  assert.equal(isServopaDateKey("2026-11-31"), false);
  assert.equal(isServopaDateKey("30/11/2026"), false);
  assert.equal(dateKeyFromDb(dbDateFromKey("2026-11-01")), "2026-11-01");
  assert.equal(dateKeyFromDb(null), null);
});

test("tela: atalhos de mês inteiro, frase de quando aparece e aviso de campanhas no mesmo período", () => {
  assert.deepEqual(servopaMonthRange("2026-10-28", 1), { startsOn: "2026-11-01", endsOn: "2026-11-30", label: "Novembro" });
  assert.deepEqual(servopaMonthRange("2026-12-15", 1), { startsOn: "2027-01-01", endsOn: "2027-01-31", label: "Janeiro" });
  assert.equal(servopaMonthRange("2028-02-10", 0).endsOn, "2028-02-29");

  assert.equal(describeServopaCampaignWindow("2026-11-01", "2026-11-30", "2026-10-28"), "Aparece nos PDFs a partir de 01/11 (daqui a 4 dias) até 30/11.");
  assert.equal(describeServopaCampaignWindow("2026-10-29", null, "2026-10-28"), "Aparece nos PDFs a partir de 29/10 (amanhã) sem data para acabar.");
  assert.equal(describeServopaCampaignWindow(null, "2026-11-30", "2026-11-10"), "Aparece nos PDFs desde já até 30/11.");
  assert.equal(describeServopaCampaignWindow("2026-11-01", "2026-11-30", "2026-12-02"), "Já terminou em 30/11.");

  const all = [
    { id: "black", enabled: true, startsOn: "2026-11-01", endsOn: "2026-11-30" },
    { id: "natal", enabled: true, startsOn: "2026-12-01", endsOn: "2026-12-25" },
    { id: "off", enabled: false, startsOn: "2026-11-01", endsOn: "2026-11-30" },
    { id: "sempre", enabled: true, startsOn: null, endsOn: null },
  ];
  const ids = (period: { id?: string; startsOn: string | null; endsOn: string | null }) => overlappingServopaCampaigns(all, period).map((c) => c.id);
  assert.deepEqual(ids({ startsOn: "2026-11-27", endsOn: "2026-11-29" }), ["black", "sempre"]);
  assert.deepEqual(ids({ id: "black", startsOn: "2026-11-01", endsOn: "2026-11-30" }), ["sempre"], "não compara com ela mesma");
  assert.deepEqual(ids({ startsOn: "2026-11-30", endsOn: "2026-12-01" }), ["black", "natal", "sempre"], "um dia em comum já conta");
});

test("R2: trocar sobe a nova antes de apagar a antiga; apagar a campanha apaga as artes", () => {
  const art = readFileSync("app/api/servopa-tables/campaigns/[id]/art/route.ts", "utf8");
  const post = art.slice(art.indexOf("export async function POST"), art.indexOf("export async function DELETE"));
  assert.ok(post.indexOf("uploadServopaCampaignArt(key") < post.indexOf("deleteServopaCampaignArt(previousKey)"));
  assert.match(post, /\[column\]: previousKey/, "só troca se ninguém trocou no meio");
  assert.match(post, /if \(swapped === 0\) await deleteServopaCampaignArt\(key\)/, "envio que não entrou no banco não fica no R2");
  assert.match(art.slice(art.indexOf("export async function DELETE")), /deleteServopaCampaignArt\(previousKey\)/);

  const item = readFileSync("app/api/servopa-tables/campaigns/[id]/route.ts", "utf8");
  const del = item.slice(item.indexOf("export async function DELETE"));
  assert.ok(del.indexOf("servopaCampaign.delete") < del.indexOf("deleteServopaCampaignArt(key)"));
  assert.match(del, /removed\.artKey, removed\.realEstateArtKey, removed\.movableArtKey/);

  const r2 = readFileSync("lib/r2.ts", "utf8");
  assert.match(r2, /return `\$\{SERVOPA_CAMPAIGN_ART_PREFIX\}\$\{organizationId\}\/\$\{random\}\.\$\{ext\}`/);
});

test("arte servida na mesma origem, só da própria organização; só dono e administrativo cadastram", () => {
  const serve = readFileSync("app/api/servopa-tables/campaign-art/[...key]/route.ts", "utf8");
  assert.match(serve, /isServopaCampaignArtKey\(key, access\.organizationId\)/);
  const access = readFileSync("lib/servopa-tables/access.ts", "utf8");
  assert.match(access, /canManageCampaigns: m\.role === "OWNER" \|\| m\.area === "ADMINISTRATIVO"/);
  const admin = readFileSync("lib/servopa-tables/campaign-admin.ts", "utf8");
  assert.match(admin, /if \(!access\.canManageCampaigns\)/);
  const page = readFileSync("app/tabela-servopa/[id]/page.tsx", "utf8");
  assert.match(page, /access\.canManageCampaigns \? requested : null/, "prévia fora do período só para quem cadastra");
});

test("folha: faixa de 210 × 52 mm só com campanha, e a migração só adiciona", () => {
  const sheet = readFileSync("components/servopa-tables/print-sheet.tsx", "utf8");
  assert.match(sheet, /\.servopa-campaign-band \{ margin: -7mm -12mm 5mm; \}/);
  assert.match(sheet, /\.servopa-campaign-band \{ margin: -7mm -10mm 5mm !important; \}/, "Ctrl+P: acompanha a margem da folha impressa");
  assert.match(sheet, /\{campaign \? \(\s*<CampaignBand/);
  const band = readFileSync("components/servopa-tables/sheet-header.tsx", "utf8");
  assert.match(band, /servopa-campaign-band relative h-\[52mm\]/);
  // A prévia da tela usa o MESMO componente do PDF.
  assert.match(readFileSync("app/(dashboard)/tabelas/campanhas/campaigns-manager.tsx", "utf8"), /<CampaignBand artUrl=\{artUrl\}/);
  const sql = readFileSync("prisma/migrations/20261028120000_servopa_campaigns/migration.sql", "utf8");
  assert.doesNotMatch(sql, /DROP|ALTER TABLE "(?!ServopaCampaign")/);
  assert.match(sql, /CREATE POLICY tenant_isolation ON "ServopaCampaign"/);
});
