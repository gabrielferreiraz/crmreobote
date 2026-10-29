"use client";

import { useEffect, useMemo, useState } from "react";
import { Link2, Search, X } from "lucide-react";
import { connectorWithCustomFields, type CrmCustomFieldDefinition, type CrmEntity, type CrmField } from "@/lib/sheets/crm-integration";
import { ColumnTypeIcon } from "./column-type-icon";

/**
 * Catálogo de campos do CRM no "Nova coluna"/"Configurar coluna": a pessoa escolhe
 * "Valor líquido" em vez de "Moeda" — o nome, o tipo e as casas já vêm certos, e a
 * coluna fica vinculada ao campo (Integração com CRM casa sozinha ao puxar/enviar).
 */
export function CrmFieldCatalog({
  selected,
  onPick,
  onUnlink,
}: {
  selected: { entity: CrmEntity; field: string } | null;
  onPick: (entity: CrmEntity, field: CrmField) => void;
  onUnlink: () => void;
}) {
  const [entity, setEntity] = useState<CrmEntity>(selected?.entity ?? "deals");
  const [custom, setCustom] = useState<CrmCustomFieldDefinition[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/custom-fields")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: unknown) => alive && Array.isArray(data) && setCustom(data as CrmCustomFieldDefinition[]))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const fields = useMemo(() => {
    const all = connectorWithCustomFields(entity, custom).fields;
    const q = query.trim().toLowerCase();
    return q ? all.filter((f) => f.label.toLowerCase().includes(q)) : all;
  }, [entity, custom, query]);

  const current = selected ? connectorWithCustomFields(selected.entity, custom).fields.find((f) => f.key === selected.field) : null;

  return (
    <div className="space-y-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Campo do CRM</p>
          <p className="text-xs text-neutral-400">Opcional — escolha e a coluna já vem pronta e ligada ao CRM.</p>
        </div>
        <div className="flex rounded-lg bg-neutral-100 p-0.5 text-xs dark:bg-neutral-800">
          {(["deals", "contacts"] as const).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEntity(e)}
              className={`rounded-md px-3 py-1 font-medium ${entity === e ? "bg-white text-neutral-900 shadow-xs dark:bg-neutral-900 dark:text-neutral-100" : "text-neutral-500"}`}
            >
              {e === "deals" ? "Negócio" : "Cliente"}
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-brand/10 px-2.5 py-1.5 text-xs text-brand">
          <span className="flex min-w-0 items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              Ligada a <b>{selected.entity === "deals" ? "Negócio" : "Cliente"} → {current?.label ?? selected.field}</b>
            </span>
          </span>
          <button type="button" onClick={onUnlink} className="inline-flex shrink-0 items-center gap-0.5 hover:text-red-600">
            <X className="h-3 w-3" /> Desligar
          </button>
        </div>
      )}

      <span className="relative block">
        <Search className="absolute top-2 left-2 h-3.5 w-3.5 text-neutral-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Procurar campo (ex.: valor, cidade, etapa)…" className="field-input w-full py-1 pl-7 text-xs" />
      </span>
      <div className="grid max-h-44 grid-cols-1 gap-1 overflow-auto sm:grid-cols-2">
        {fields.map((f) => {
          const on = selected?.entity === entity && selected.field === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => onPick(entity, f)}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                on ? "bg-brand/10 font-semibold text-brand ring-1 ring-brand/40" : "text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              <ColumnTypeIcon type={f.type} className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
              <span className="min-w-0 flex-1 truncate">{f.label}</span>
              {f.customFieldId ? (
                <span className="shrink-0 text-[10px] text-neutral-400">personalizado</span>
              ) : !f.writable ? (
                <span className="shrink-0 text-[10px] text-neutral-400" title="Só dá para puxar do CRM; não é enviado de volta">
                  só leitura
                </span>
              ) : null}
            </button>
          );
        })}
        {!fields.length && <p className="px-2 py-2 text-xs text-neutral-400">Nenhum campo com esse nome.</p>}
      </div>
    </div>
  );
}
