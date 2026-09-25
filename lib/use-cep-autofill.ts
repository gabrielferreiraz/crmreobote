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

export function useCepAutofill(zipCode: string, fields: CepAutofillFields) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedCep = useRef<string | null>(null);

  useEffect(() => {
    const digits = onlyCepDigits(zipCode);
    if (digits.length !== 8) {
      return;
    }
    if (lastFetchedCep.current === digits) return;

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

        if (data.address && !fields.address.trim()) {
          fields.setAddress(data.address);
          filled.push("address");
        }
        if (data.neighborhood && !fields.neighborhood.trim()) {
          fields.setNeighborhood(data.neighborhood);
          filled.push("neighborhood");
        }
        if (data.city && !fields.city.trim()) {
          fields.setCity(data.city);
          filled.push("city");
        }
        if (data.state && !fields.state.trim()) {
          fields.setState(data.state);
          filled.push("state");
        }

        fields.onAutofilled?.(filled);
      } catch (err) {
        if ((err as DOMException).name !== "AbortError") setError("Falha ao consultar o CEP.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [zipCode, fields]);

  const hasCompleteCep = onlyCepDigits(zipCode).length === 8;
  return { loading: hasCompleteCep && loading, error: hasCompleteCep ? error : null };
}
