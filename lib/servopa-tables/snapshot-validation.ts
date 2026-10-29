import type { NormalizedGroup } from "@/lib/servopa-tables/types";

type Segment = NormalizedGroup["segment"];

export type ServopaSnapshotEvidence = {
  lists: Array<{
    segment: Segment;
    httpStatus: number;
    cloudflareBlocked: boolean;
    groups: Array<{ number: string; vacancies: number }>;
  }>;
  pages: Array<{
    number: string;
    httpStatus: number;
    cloudflareBlocked: boolean;
  }>;
};

export type ExistingSnapshotGroup = {
  number: string;
  vacancies: number | null;
  active: boolean;
  tables: Array<{ active: boolean }>;
};

export class ServopaSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServopaSnapshotValidationError";
  }
}

function repeatedValues(values: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function assertGroupContent(groups: NormalizedGroup[]) {
  const duplicates = repeatedValues(groups.map((group) => group.number));
  if (duplicates.length) {
    throw new ServopaSnapshotValidationError(`Coleta rejeitada: grupo repetido (${duplicates.slice(0, 5).join(", ")}).`);
  }

  for (const group of groups) {
    if (!/^\d+$/.test(group.number)) {
      throw new ServopaSnapshotValidationError(`Coleta rejeitada: número de grupo inválido (${group.number}).`);
    }
    if (!Number.isInteger(group.vacancies) || group.vacancies === null || group.vacancies < 0) {
      throw new ServopaSnapshotValidationError(`Coleta rejeitada: o grupo ${group.number} está sem uma quantidade de vagas válida.`);
    }
    if (!group.tables.length) {
      throw new ServopaSnapshotValidationError(`Coleta rejeitada: o grupo ${group.number} não possui nenhuma tabela.`);
    }

    const rates = group.tables.map((table) => table.admRatePercent);
    if (repeatedValues(rates).length) {
      throw new ServopaSnapshotValidationError(`Coleta rejeitada: o grupo ${group.number} possui taxa de administração repetida.`);
    }
    for (const table of group.tables) {
      if (!Number.isInteger(table.termMonths) || table.termMonths <= 0 || !table.rows.length) {
        throw new ServopaSnapshotValidationError(
          `Coleta rejeitada: o grupo ${group.number}, taxa ${table.admRatePercent}%, possui uma tabela vazia ou prazo inválido.`,
        );
      }
    }
  }
}

function assertCompleteEvidence(groups: NormalizedGroup[], evidence?: ServopaSnapshotEvidence) {
  if (!evidence) {
    throw new ServopaSnapshotValidationError("Coleta completa rejeitada: faltam as evidências da varredura da Servopa.");
  }

  const requiredSegments: Segment[] = ["REAL_ESTATE", "MOVABLE"];
  const listSegments = evidence.lists.map((list) => list.segment);
  const repeatedSegments = repeatedValues(listSegments);
  if (repeatedSegments.length || evidence.lists.length !== requiredSegments.length || requiredSegments.some((segment) => !listSegments.includes(segment))) {
    throw new ServopaSnapshotValidationError("Coleta completa rejeitada: as listas de imóveis e móveis não foram carregadas uma única vez.");
  }

  for (const list of evidence.lists) {
    if (list.httpStatus !== 200 || list.cloudflareBlocked) {
      throw new ServopaSnapshotValidationError(`Coleta completa rejeitada: a lista de ${list.segment === "REAL_ESTATE" ? "imóveis" : "móveis"} não foi carregada corretamente.`);
    }
    if (!list.groups.length) {
      throw new ServopaSnapshotValidationError(`Coleta completa rejeitada: a lista de ${list.segment === "REAL_ESTATE" ? "imóveis" : "móveis"} veio vazia.`);
    }
  }

  const listed = evidence.lists.flatMap((list) => list.groups.map((group) => ({ ...group, segment: list.segment })));
  const duplicateListed = repeatedValues(listed.map((group) => group.number));
  if (duplicateListed.length) {
    throw new ServopaSnapshotValidationError(`Coleta completa rejeitada: grupo repetido nas listas (${duplicateListed.slice(0, 5).join(", ")}).`);
  }
  for (const group of listed) {
    if (!/^\d+$/.test(group.number) || !Number.isInteger(group.vacancies) || group.vacancies < 0) {
      throw new ServopaSnapshotValidationError(`Coleta completa rejeitada: dados inválidos na lista do grupo ${group.number || "sem número"}.`);
    }
  }

  const duplicatePages = repeatedValues(evidence.pages.map((page) => page.number));
  if (duplicatePages.length) {
    throw new ServopaSnapshotValidationError(`Coleta completa rejeitada: página repetida (${duplicatePages.slice(0, 5).join(", ")}).`);
  }
  const pageByNumber = new Map(evidence.pages.map((page) => [page.number, page]));
  const listedByNumber = new Map(listed.map((group) => [group.number, group]));
  const eligible = listed.filter((group) => group.vacancies > 0);
  if (!eligible.length) {
    throw new ServopaSnapshotValidationError("Coleta completa rejeitada: nenhuma das listas retornou grupo com vagas.");
  }

  for (const listedGroup of eligible) {
    const page = pageByNumber.get(listedGroup.number);
    if (!page || page.httpStatus !== 200 || page.cloudflareBlocked) {
      throw new ServopaSnapshotValidationError(`Coleta completa rejeitada: a página do grupo ${listedGroup.number} não foi carregada corretamente.`);
    }
  }

  const normalizedByNumber = new Map(groups.map((group) => [group.number, group]));
  for (const listedGroup of eligible) {
    const normalized = normalizedByNumber.get(listedGroup.number);
    if (!normalized) {
      throw new ServopaSnapshotValidationError(`Coleta completa rejeitada: faltam os dados do grupo ${listedGroup.number}.`);
    }
    if (normalized.segment !== listedGroup.segment || normalized.vacancies !== listedGroup.vacancies) {
      throw new ServopaSnapshotValidationError(`Coleta completa rejeitada: os dados do grupo ${listedGroup.number} não conferem com a lista.`);
    }
  }

  for (const group of groups) {
    const listedGroup = listedByNumber.get(group.number);
    const page = pageByNumber.get(group.number);
    if (!listedGroup || !page || page.httpStatus !== 200 || page.cloudflareBlocked) {
      throw new ServopaSnapshotValidationError(`Coleta completa rejeitada: o grupo ${group.number} não possui origem válida na varredura.`);
    }
  }
}

export function validateServopaSnapshot(opts: {
  groups: NormalizedGroup[];
  complete: boolean;
  evidence?: ServopaSnapshotEvidence;
}): NormalizedGroup[] {
  if (!opts.groups.length) {
    throw new ServopaSnapshotValidationError("Coleta rejeitada: nenhum grupo foi recebido.");
  }
  assertGroupContent(opts.groups);
  if (opts.complete) assertCompleteEvidence(opts.groups, opts.evidence);

  const availableGroups = opts.groups.filter((group) => (group.vacancies ?? 0) > 0);
  if (opts.complete && !availableGroups.length) {
    throw new ServopaSnapshotValidationError("Coleta completa rejeitada: nenhum grupo com vagas foi recebido.");
  }
  return availableGroups;
}

function percent(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

export function assertServopaReductionIsSafe(existing: ExistingSnapshotGroup[], incoming: NormalizedGroup[]) {
  const current = existing.filter((group) => group.active && (group.vacancies ?? 0) > 0);
  if (current.length < 20) return;

  const incomingNumbers = new Set(incoming.map((group) => group.number));
  const missingGroups = current.filter((group) => !incomingNumbers.has(group.number));
  const missingRatio = missingGroups.length / current.length;
  if (missingRatio > 0.2) {
    throw new ServopaSnapshotValidationError(
      `Coleta rejeitada por segurança: ${missingGroups.length} de ${current.length} grupos disponíveis desapareceram (${percent(missingRatio)}). Os dados atuais foram preservados.`,
    );
  }

  const currentTables = current.reduce((total, group) => total + group.tables.filter((table) => table.active).length, 0);
  const incomingTables = incoming.reduce((total, group) => total + group.tables.length, 0);
  if (currentTables < 50 || incomingTables >= currentTables) return;

  const removedTables = currentTables - incomingTables;
  const removedRatio = removedTables / currentTables;
  if (removedRatio > 0.2) {
    throw new ServopaSnapshotValidationError(
      `Coleta rejeitada por segurança: a quantidade de tabelas cairia de ${currentTables} para ${incomingTables} (${percent(removedRatio)} a menos). Os dados atuais foram preservados.`,
    );
  }
}
