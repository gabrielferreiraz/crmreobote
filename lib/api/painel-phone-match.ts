import { VALID_BRAZILIAN_DDDS } from "@/lib/phone-normalize";

/** Variantes servem apenas para BUSCAR registros existentes. Nunca reescrevem um telefone. */
export function panelPhoneLookupVariants(raw: string): string[] {
  const text = raw.trim();
  if (!text || /[a-z]/i.test(text) || !/^\+?[\d\s().-]+$/.test(text)) return [];
  const digits = text.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 17 || /^(\d)\1+$/.test(digits)) return [];
  if (text.startsWith("+") && !digits.startsWith("55")) return [digits];

  const variants = new Set([digits]);
  const national = new Set<string>();
  const addNational = (value: string) => {
    if (!VALID_BRAZILIAN_DDDS.has(value.slice(0, 2))) return;
    const localStart = value[2];
    if ((value.length === 9 && /[2-5]/.test(localStart)) ||
        (value.length === 10 && /[2-9]/.test(localStart)) ||
        (value.length === 11 && localStart === "9")) national.add(value);
  };
  addNational(digits);
  if (digits.startsWith("55")) addNational(digits.slice(2));
  if (digits.startsWith("0055")) addNational(digits.slice(4));
  if (digits.startsWith("00") && digits.slice(4, 6) === "55") addNational(digits.slice(6));
  if (digits.startsWith("0") && !digits.startsWith("00")) {
    addNational(digits.slice(1));
    if (digits.length === 13 || digits.length === 14) addNational(digits.slice(3));
  }
  for (const value of [...national]) {
    if (value.length === 10 && /[6-9]/.test(value[2])) national.add(value.slice(0, 2) + "9" + value.slice(2));
    if (value.length === 11 && value[2] === "9" && /[6-9]/.test(value[3])) national.add(value.slice(0, 2) + value.slice(3));
  }
  for (const value of national) {
    variants.add(value);
    variants.add(`55${value}`);
    variants.add(`0${value}`);
  }
  return [...variants];
}
