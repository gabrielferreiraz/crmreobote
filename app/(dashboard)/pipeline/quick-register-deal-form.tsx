"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { CurrencyInput } from "@/components/currency-input";
import { LoadingDots } from "@/components/loading-dots";
import { Select } from "@/components/select";
import { VoiceInputButton } from "@/components/voice-input-button";
import { ESTADOS_BR } from "@/lib/contacts/constants";
import { parseLeadText, normalizeLabel, type ParsedLeadFields } from "@/lib/quick-register/parse-lead-text";
import { appendDictatedLeadText } from "@/lib/quick-register/format-dictated-lead-text";
import { useDictatedText } from "@/lib/use-dictated-text";
import type { Deal } from "./kanban-board";

type MemberOption = { id: string; name: string };
type CreditTypeOption = { id: string; label: string };
type JobTitleOption = { id: string; label: string };

const PLACEHOLDER = `Cole aqui o texto do lead — funciona colado de qualquer jeito, ex.:

Nome: Maria Aparecida
WhatsApp: (67) 99178-3902
E-mail: maria@email.com
Cidade: Campo Grande/MS
Quero um consórcio de carro de uns 80 mil`;

export function QuickRegisterDealForm({
  pipelineId,
  firstStageId,
  members,
  creditTypes,
  onCreated,
  onCancel,
}: {
  pipelineId: string;
  firstStageId?: string;
  members: MemberOption[];
  creditTypes: CreditTypeOption[];
  onCreated: (deal: Deal) => void;
  onCancel: () => void;
}) {
  const rawTextDictation = useDictatedText("", appendDictatedLeadText);
  const [analyzed, setAnalyzed] = useState(false);
  const justPasted = useRef(false);

  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [address, setAddress] = useState("");
  const [addressNumber, setAddressNumber] = useState("");
  const [addressComplement, setAddressComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [value, setValue] = useState("");
  const [grossValue, setGrossValue] = useState("");
  const [creditType, setCreditType] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState("");

  const [jobTitles, setJobTitles] = useState<JobTitleOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Campos que o parser preencheu sozinho e que o consultor ainda não olhou
  // — só pra dar um destaque visual de "revise isso" no formulário. Some do
  // campo assim que ele é editado (deixou de ser "não revisado").
  const [autoFilled, setAutoFilled] = useState<Set<string>>(new Set());

  function reviewed(key: string) {
    setAutoFilled((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function fieldHighlight(key: string): string {
    return autoFilled.has(key)
      ? "ring-1 ring-amber-300 bg-amber-50/60 dark:ring-amber-700/50 dark:bg-amber-950/20"
      : "";
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/job-titles");
        if (!res.ok) return;
        const data: JobTitleOption[] = await res.json();
        if (!cancelled) setJobTitles(data);
      } catch {
        // sem lista carregada, o Select fica vazio — POST /api/contacts ainda
        // barra no servidor se o cargo não vier preenchido.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function applyParsed(parsed: ParsedLeadFields) {
    const filled = new Set<string>();

    if (parsed.name) {
      setName(parsed.name);
      filled.add("name");
    }
    if (parsed.whatsapp) {
      setWhatsapp(parsed.whatsapp);
      filled.add("whatsapp");
    }
    if (parsed.phone) {
      setPhone(parsed.phone);
      filled.add("phone");
    }
    if (parsed.email) {
      setEmail(parsed.email);
      filled.add("email");
    }
    if (parsed.company) {
      setCompany(parsed.company);
      filled.add("company");
    }
    if (parsed.address) {
      setAddress(parsed.address);
      filled.add("address");
    }
    if (parsed.addressNumber) {
      setAddressNumber(parsed.addressNumber);
      filled.add("addressNumber");
    }
    if (parsed.addressComplement) {
      setAddressComplement(parsed.addressComplement);
      filled.add("addressComplement");
    }
    if (parsed.neighborhood) {
      setNeighborhood(parsed.neighborhood);
      filled.add("neighborhood");
    }
    if (parsed.city) {
      setCity(parsed.city);
      filled.add("city");
    }
    if (parsed.state) {
      setState(parsed.state);
      filled.add("state");
    }
    if (parsed.zipCode) {
      setZipCode(parsed.zipCode);
      filled.add("zipCode");
    }
    if (parsed.value) {
      setValue(String(parsed.value));
      filled.add("value");
    }
    if (parsed.grossValue) {
      setGrossValue(String(parsed.grossValue));
      filled.add("grossValue");
    }
    if (parsed.description) {
      setDescription(parsed.description);
      filled.add("description");
    }

    if (parsed.jobTitle) {
      const match = jobTitles.find((j) => normalizeLabel(j.label) === normalizeLabel(parsed.jobTitle!));
      if (match) {
        setJobTitle(match.label);
        filled.add("jobTitle");
      }
    }
    // Sugestão de tipo de crédito é sempre um chute por palavra-chave — só
    // aceita se casar com um tipo que a organização de fato tem cadastrado,
    // nunca grava um valor livre nesse campo.
    const creditGuess = parsed.creditTypeGuess;
    if (creditGuess) {
      const match = creditTypes.find((c) => normalizeLabel(c.label) === normalizeLabel(creditGuess));
      if (match) {
        setCreditType(match.label);
        filled.add("creditType");
      }
    }

    setAutoFilled(filled);
    setAnalyzed(true);
  }

  function handlePaste() {
    justPasted.current = true;
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    rawTextDictation.setValue(text);
    if (justPasted.current) {
      justPasted.current = false;
      applyParsed(parseLeadText(text));
    }
  }

  function handleAnalyzeClick() {
    applyParsed(parseLeadText(rawTextDictation.committed));
  }

  // Ditado por voz aqui não vem quebrado por linha como texto colado — chega
  // como um bloco só ("nome fulano telefone tal cidade tal"), então
  // appendDictatedLeadText primeiro reescreve isso pro formato "Rótulo:
  // valor" por linha (ver lib/quick-register/format-dictated-lead-text.ts)
  // antes de emendar no que já tinha no campo.
  //
  // Analisa a CADA frase confirmada, não só quando o microfone desliga — é
  // sempre uma frase INTEIRA (VoiceInputButton só chama isso com
  // interimResults finalizado, nunca no meio de uma ainda em andamento, ver
  // components/voice-input-button.tsx), então não é a mesma situação que o
  // design antigo evitava (analisar "nome fulano... telefone tal..." com o
  // texto pela metade) — só faz o formulário preencher progressivamente
  // enquanto a pessoa ainda está ditando o resto, em vez de só no final.
  // `autoFilled`/reviewed (ver applyParsed) já garantem que um campo editado
  // à mão não é sobrescrito por uma frase nova.
  //
  // `next` é calculado aqui (não só dentro de rawTextDictation.onResult) pra
  // poder analisar com o texto atualizado NA HORA, sem esperar o próximo
  // render — os dois usam o mesmo `rawTextDictation.committed` capturado no
  // início desta chamada, então concordam sempre que uma fala real (não uma
  // chamada síncrona artificial) separa uma frase da próxima.
  function handleDictated(text: string) {
    const next = appendDictatedLeadText(rawTextDictation.committed, text);
    rawTextDictation.onResult(text);
    applyParsed(parseLeadText(next));
  }

  /** Só uma rede de segurança quando o microfone desliga de vez — cada frase já foi analisada na hora (ver handleDictated), isso só repete com o texto final completo. */
  function handleDictationStopped(listening: boolean) {
    if (listening) return;
    applyParsed(parseLeadText(rawTextDictation.committed));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstStageId || !name.trim() || !jobTitle) return;
    setLoading(true);
    setError(null);

    try {
      const contactRes = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email: email || undefined,
          phone: phone || undefined,
          whatsapp: whatsapp || undefined,
          company: company || undefined,
          jobTitle,
          address: address || undefined,
          addressNumber: addressNumber || undefined,
          addressComplement: addressComplement || undefined,
          neighborhood: neighborhood || undefined,
          city: city || undefined,
          state: state || undefined,
          zipCode: zipCode || undefined,
          source: "Cadastro rápido",
        }),
      });
      const contactData = await contactRes.json().catch(() => ({}));
      if (!contactRes.ok) {
        setError(contactData.error ?? "Erro ao criar contato");
        return;
      }

      const dealRes = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId,
          stageId: firstStageId,
          contactId: contactData.id,
          value: value ? Number(value) : undefined,
          grossValue: grossValue ? Number(grossValue) : undefined,
          creditType: creditType || undefined,
          description: description || undefined,
          ownerId: ownerId || undefined,
        }),
      });
      const dealData = await dealRes.json().catch(() => ({}));
      if (!dealRes.ok) {
        setError(dealData.error ?? "Erro ao criar negócio");
        return;
      }

      onCreated({
        ...dealData,
        value: dealData.value != null ? Number(dealData.value) : null,
        grossValue: dealData.grossValue != null ? Number(dealData.grossValue) : null,
        owner: { id: dealData.owner.id, name: dealData.owner.name, photoUrl: null },
        nextActivity: null,
        taskTypes: [],
      });
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label className="field-label">Colar texto do lead</label>
          <VoiceInputButton
            onResult={handleDictated}
            onInterimResult={rawTextDictation.onInterimResult}
            onListeningChange={handleDictationStopped}
          />
        </div>
        <textarea
          autoFocus
          value={rawTextDictation.value}
          onChange={handleChange}
          onPaste={handlePaste}
          placeholder={PLACEHOLDER}
          rows={6}
          className="field-input resize-y"
        />
        <div className="flex items-center justify-between gap-2 pt-1.5">
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Cole o texto e os campos abaixo preenchem sozinhos — revise antes de criar.
          </p>
          {/* Mesmo tratamento de botão de verdade (borda + fundo) que o
              resto do app usa — texto cinza sem contorno nenhum passava
              batido pro consultor, especialmente quem colou o texto sem o
              preenchimento automático já ter disparado sozinho (ver
              handleChange/handlePaste acima). */}
          <button
            type="button"
            onClick={handleAnalyzeClick}
            disabled={!rawTextDictation.committed.trim()}
            className="btn-secondary btn-sm shrink-0"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            Separar campos
          </button>
        </div>
      </div>

      {analyzed && (
        <div className="space-y-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          {autoFilled.size > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-500">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-200 ring-1 ring-amber-300 dark:bg-amber-950/40 dark:ring-amber-700/50" />
              Campos com esse destaque foram preenchidos automaticamente — confira antes de criar.
            </p>
          )}
          <div className="space-y-1">
            <label className="field-label">Nome</label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                reviewed("name");
              }}
              required
              className={`field-input ${fieldHighlight("name")}`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="field-label">WhatsApp</label>
              <input
                value={whatsapp}
                onChange={(e) => {
                  setWhatsapp(e.target.value);
                  reviewed("whatsapp");
                }}
                className={`field-input ${fieldHighlight("whatsapp")}`}
              />
            </div>
            <div className="space-y-1">
              <label className="field-label">Celular (nº 2)</label>
              <input
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  reviewed("phone");
                }}
                className={`field-input ${fieldHighlight("phone")}`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="field-label">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  reviewed("email");
                }}
                className={`field-input ${fieldHighlight("email")}`}
              />
            </div>
            <div className="space-y-1">
              <label className="field-label">Empresa</label>
              <input
                value={company}
                onChange={(e) => {
                  setCompany(e.target.value);
                  reviewed("company");
                }}
                className={`field-input ${fieldHighlight("company")}`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="field-label">Cargo *</label>
              <Select
                value={jobTitle}
                onChange={(v) => {
                  setJobTitle(v);
                  reviewed("jobTitle");
                }}
                placeholder="Selecione o cargo"
                options={jobTitles.map((j) => ({ value: j.label, label: j.label }))}
                className={fieldHighlight("jobTitle")}
              />
            </div>
            <div className="space-y-1">
              <label className="field-label">Tipo de crédito</label>
              <Select
                value={creditType}
                onChange={(v) => {
                  setCreditType(v);
                  reviewed("creditType");
                }}
                options={[{ value: "", label: "—" }, ...creditTypes.map((c) => ({ value: c.label, label: c.label }))]}
                className={fieldHighlight("creditType")}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="field-label">Valor líquido</label>
              <CurrencyInput
                value={value}
                onChange={(v) => {
                  setValue(v);
                  reviewed("value");
                }}
                className={fieldHighlight("value")}
              />
            </div>
            <div className="space-y-1">
              <label className="field-label">Valor bruto</label>
              <CurrencyInput
                value={grossValue}
                onChange={(v) => {
                  setGrossValue(v);
                  reviewed("grossValue");
                }}
                className={fieldHighlight("grossValue")}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="field-label">Responsável</label>
            <Select
              value={ownerId}
              onChange={setOwnerId}
              options={[
                { value: "", label: "Atribuição automática" },
                ...members.map((m) => ({ value: m.id, label: m.name })),
              ]}
            />
          </div>

          <div className="space-y-1">
            <label className="field-label">Endereço</label>
            <input
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                reviewed("address");
              }}
              className={`field-input ${fieldHighlight("address")}`}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="field-label">Número</label>
              <input
                value={addressNumber}
                onChange={(e) => {
                  setAddressNumber(e.target.value);
                  reviewed("addressNumber");
                }}
                className={`field-input ${fieldHighlight("addressNumber")}`}
              />
            </div>
            <div className="space-y-1">
              <label className="field-label">Complemento</label>
              <input
                value={addressComplement}
                onChange={(e) => {
                  setAddressComplement(e.target.value);
                  reviewed("addressComplement");
                }}
                className={`field-input ${fieldHighlight("addressComplement")}`}
              />
            </div>
            <div className="space-y-1">
              <label className="field-label">Bairro</label>
              <input
                value={neighborhood}
                onChange={(e) => {
                  setNeighborhood(e.target.value);
                  reviewed("neighborhood");
                }}
                className={`field-input ${fieldHighlight("neighborhood")}`}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="field-label">Cidade</label>
              <input
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  reviewed("city");
                }}
                className={`field-input ${fieldHighlight("city")}`}
              />
            </div>
            <div className="space-y-1">
              <label className="field-label">Estado</label>
              <Select
                value={state}
                onChange={(v) => {
                  setState(v);
                  reviewed("state");
                }}
                options={[{ value: "", label: "—" }, ...ESTADOS_BR.map((s) => ({ value: s.value, label: s.value }))]}
                className={fieldHighlight("state")}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="field-label">CEP</label>
            <input
              value={zipCode}
              onChange={(e) => {
                setZipCode(e.target.value);
                reviewed("zipCode");
              }}
              className={`field-input max-w-40 ${fieldHighlight("zipCode")}`}
            />
          </div>

          <div className="space-y-1">
            <label className="field-label">Descrição</label>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                reviewed("description");
              }}
              rows={3}
              className={`field-input resize-y ${fieldHighlight("description")}`}
            />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancelar
        </button>
        <button type="submit" disabled={loading || !analyzed || !name.trim() || !jobTitle} className="btn-primary">
          {loading && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />}
          {loading ? (
            <span className="inline-flex items-center gap-1">
              Criando
              <LoadingDots />
            </span>
          ) : (
            "Criar"
          )}
        </button>
      </div>
    </form>
  );
}
