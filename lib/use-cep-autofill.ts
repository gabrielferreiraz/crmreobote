"use client";

import { useEffect, useRef, useState } from "react";
import { onlyCepDigits, formatCep, type CepAddress } from "@/lib/cep";

type CepAutofillFields = {
  setZipCode: (value: string) => void;
  address: string;
  setAddress: (value: string) => void;
  neighborhood: string;
  setNeighborhood: (value: string) => void;
  city: string;
  setCity: (value: string) => void;
  state: string;
  setState: (value: string) => void;
  onAutofilled?: (fields: Array<"zipCode" | "address" | "neighborhood" | "city" | "state">) => void;
};

type CepAutofillOptions = {
  /**
   * true = um CEP novo SEMPRE atualiza rua, bairro, cidade e UF (mesmo já preenchidos).
   * Padrão (false) só preenche o que está vazio — o comportamento das telas de cadastro de cliente.
   */
  overwrite?: boolean;
  /** CEP que já veio salvo do servidor: não busca de novo para não trocar um endereço que a pessoa já conferiu. */
  skipDigits?: string;
};

export function useCepAutofill(zipCode: string, fields: CepAutofillFields, options: CepAutofillOptions = {}) {
  const { overwrite = false, skipDigits } = options;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedCep = useRef<string | null>(null);

  useEffect(() => {
    const digits = onlyCepDigits(zipCode);
    if (digits.length !== 8) {
      // CEP apagado ou incompleto: digitar o mesmo CEP de novo volta a buscar o endereço.
      lastFetchedCep.current = null;
      return;
    }
    if (lastFetchedCep.current === digits) return;
    if (skipDigits && skipDigits === digits && lastFetchedCep.current === null) {
      lastFetchedCep.current = digits;
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      lastFetchedCep.current = digits;
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/cep/${digits}`, { signal: controller.signal });
        const data = (await res.json().catch(() => ({}))) as Partial<CepAddress> & { error?: string };

        if (!res.ok) {
          setError(res.status === 404 ? "CEP não encontrado." : data.error ?? "Não foi possível buscar o CEP.");
          return;
        }

        const filled: Array<"zipCode" | "address" | "neighborhood" | "city" | "state"> = ["zipCode"];
        fields.setZipCode(data.zipCode ?? formatCep(digits));

        if (data.address && (overwrite || !fields.address.trim())) {
          fields.setAddress(data.address);
          filled.push("address");
        }
        if (data.neighborhood && (overwrite || !fields.neighborhood.trim())) {
          fields.setNeighborhood(data.neighborhood);
          filled.push("neighborhood");
        }
        if (data.city && (overwrite || !fields.city.trim())) {
          fields.setCity(data.city);
          filled.push("city");
        }
        if (data.state && (overwrite || !fields.state.trim())) {
          fields.setState(data.state);
          filled.push("state");
        }

        fields.onAutofilled?.(filled);
      } catch (err) {
        if ((err as DOMException).name === "AbortError") {
          // Interrompida por outra digitação antes de terminar: libera para buscar de novo.
          if (lastFetchedCep.current === digits) lastFetchedCep.current = null;
        } else {
          setError("Falha ao consultar o CEP.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [zipCode, fields, overwrite, skipDigits]);

  const hasCompleteCep = onlyCepDigits(zipCode).length === 8;
  return { loading: hasCompleteCep && loading, error: hasCompleteCep ? error : null };
}
