/**
 * Validação de FORMATO de e-mail — deliberadamente permissiva (`x@y.z`, sem
 * espaço, até 254 caracteres): pega digitação errada sem recusar endereço real
 * incomum (nada de regex "completa" da RFC, que barra e-mail válido). Existia
 * copiada em app/api/register e app/api/digital-cards/[id]; agora é única.
 * (O ENVIO de e-mail é outro assunto: lib/email.ts.)
 *
 * Achado do relatório de QA (teste pendente "validação no servidor"): o
 * cadastro de contato só tinha a validação NATIVA do navegador (type="email"),
 * que se contorna chamando a API direto — o servidor gravava qualquer texto.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= 254 && EMAIL_REGEX.test(v);
}
