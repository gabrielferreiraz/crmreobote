/**
 * Dicionário de sinônimos pra sugestão automática de variação de mensagem
 * (ver "pílula de sinônimo" em app/(dashboard)/whatsapp/scripts/script-editor.tsx)
 * — curado à mão pro registro de venda/atendimento por WhatsApp desta
 * organização (consórcio — imóvel, veículo, maquinário — pra produtor rural
 * e cliente urbano), não um dicionário geral de português. Um sinônimo
 * tecnicamente correto mas fora do tom usado aqui soaria estranho, por isso
 * não dá pra usar um dicionário genérico sem curadoria.
 *
 * Cobre DOIS registros de propósito — script real compartilhado pelo
 * usuário é mais formal/institucional ("empresa parceira do Sindicato
 * Rural", "plano diferenciado", "aquisição") que o rascunho inicial deste
 * arquivo previa (mais informal, tipo "bora"/"rapidinho"). Cada entrada só
 * ativa quando a PALAVRA EXATA aparece no que a pessoa escreveu, então ter
 * os dois registros aqui dentro é inofensivo — um script casual nunca vai
 * disparar sugestão formal-institucional e vice-versa, cada um só reage ao
 * que já está de fato no texto.
 *
 * Pedido explícito do usuário: "no braço mesmo" — sem IA nenhuma por trás
 * ainda (custo/infra pra depois, ver decisão registrada na conversa). Achar
 * "os arquivos de Voice" com sinônimos prontos foi checado e não existe —
 * lib/voice/ é só qualidade de reconhecimento de fala (pontuação, números,
 * esta/está), nunca trocou palavra por sinônimo em português de propósito.
 *
 * Chave = forma exata (minúscula) procurada no texto digitado. Valor =
 * alternativas oferecidas quando a pessoa clica na sugestão — a forma
 * ORIGINAL digitada sempre vira a 1ª opção da variação por conta própria
 * (ver o clique em "[data-synonym-key]" dentro de handleEditorClick, em
 * script-editor.tsx), nunca precisa repetir ela aqui.
 */
export const MESSAGE_SYNONYMS: Record<string, string[]> = {
  // Saudação/abertura de conversa
  "tudo bem": ["tudo certo", "tudo joia", "como vai"],
  oi: ["olá", "e aí"],
  // "Estou entrando em contato pois..." — abertura institucional clássica
  // (ver script real do Sindicato Rural), tão comum quanto "oi"/"tudo bem"
  // nos scripts mais formais.
  "entrando em contato": ["passando aqui", "escrevendo por aqui"],
  pois: ["já que", "porque"],

  // Abertura personalizada ("Vi que você atua como {cargo}...") — mesmo
  // padrão sugerido no placeholder do campo de mensagem (ver JSX abaixo em
  // script-editor.tsx), então vale ter sinônimo pronto pra ela também.
  "vi que": ["percebi que", "notei que"],
  "percebi que": ["vi que", "notei que"],
  "notei que": ["vi que", "percebi que"],

  // Pedido/intenção
  queria: ["gostaria de", "estou querendo"],
  gostaria: ["queria", "estou querendo"],
  quero: ["desejo", "pretendo"],
  saber: ["entender", "conferir"],
  entender: ["saber", "conferir"],
  consigo: ["posso", "tenho como"],
  posso: ["consigo", "tenho como"],
  "tenho como": ["consigo", "posso"],

  // Apresentação da proposta/produto
  apresentar: ["mostrar", "explicar"],
  mostrar: ["apresentar", "explicar"],
  explicar: ["apresentar", "mostrar"],
  diferenciado: ["especial", "exclusivo"],
  diferenciada: ["especial", "exclusiva"],
  aquisição: ["compra", "conquista"],
  compra: ["aquisição", "conquista"],
  parceira: ["parceira oficial", "credenciada"],
  atendendo: ["auxiliando", "apoiando"],
  auxiliando: ["atendendo", "apoiando"],
  apoiando: ["atendendo", "auxiliando"],
  muitos: ["diversos", "vários"],
  muitas: ["diversas", "várias"],
  diversos: ["muitos", "vários"],
  vários: ["muitos", "diversos"],
  // "Estamos com um plano diferenciado..." — outra abertura institucional do
  // script real (ver comentário do topo do arquivo).
  "estamos com": ["temos", "disponibilizamos"],
  // "a menos de 4,5% ao ano" — só a expressão de comparação muda, nunca o
  // número/percentual em si (isso fica fora do dicionário de propósito).
  "menos de": ["abaixo de", "até"],

  // Ritmo/tempo
  rapidinho: ["rápido", "rapidamente"],
  rápido: ["rapidinho", "rapidamente"],
  rapidamente: ["rápido", "rapidinho"],
  agora: ["nesse momento", "agora mesmo"],
  hoje: ["ainda hoje", "hoje mesmo"],
  atualmente: ["hoje em dia", "nos dias de hoje"],
  depois: ["mais tarde", "em seguida"],
  já: ["agora mesmo", "de cara"],
  sempre: ["constantemente", "a todo momento"],

  // Interesse/oportunidade
  interessante: ["bacana", "vantajoso"],
  interessado: ["a fim", "curioso"],
  interessada: ["a fim", "curiosa"],
  oportunidade: ["chance", "possibilidade"],
  chance: ["oportunidade", "possibilidade"],
  possibilidade: ["oportunidade", "chance"],
  vantagem: ["benefício", "ponto positivo"],
  benefício: ["vantagem", "ponto positivo"],
  novidade: ["novo", "lançamento"],

  // Convite pra conversa
  conversar: ["bater um papo", "trocar uma ideia", "falar"],
  vamos: ["bora", "que tal"],

  // Avaliação/qualidade
  ótimo: ["excelente", "show", "top"],
  legal: ["bacana", "interessante"],
  bacana: ["legal", "interessante"],
  importante: ["essencial", "fundamental"],
  essencial: ["importante", "fundamental"],
  fundamental: ["importante", "essencial"],
  fácil: ["simples", "tranquilo"],
  simples: ["fácil", "tranquilo"],
  tranquilo: ["fácil", "simples"],
  melhor: ["mais indicado", "mais em conta"],

  // Ajuda/dúvida
  ajudar: ["auxiliar", "dar uma força"],
  auxiliar: ["ajudar", "dar uma força"],
  dúvida: ["pergunta", "questão"],
  pergunta: ["dúvida", "questão"],
  questão: ["dúvida", "pergunta"],

  // Fechamento/confirmação
  confirmar: ["garantir", "bater o martelo"],
  garantir: ["confirmar", "bater o martelo"],
  combinado: ["fechado", "acertado"],
  pode: ["consegue", "tem como"],

  // Agradecimento
  obrigado: ["valeu", "agradeço"],
  obrigada: ["valeu", "agradeço"],

  // Condição comercial
  gratuito: ["sem custo", "de graça"],
  condição: ["condição especial", "proposta"],

  // Conectivos/discurso — palavras de ligação genéricas, aparecem em
  // praticamente qualquer script independente do nicho, por isso valem a
  // entrada mesmo sem ligação direta com venda/consórcio.
  para: ["pra", "a fim de"],
  sobre: ["a respeito de", "quanto a"],
  assim: ["dessa forma", "desse jeito"],
  então: ["portanto", "por isso"],
  bastante: ["bem", "muito"],
  também: ["igualmente", "da mesma forma"],
  "com certeza": ["certamente", "sem dúvida"],
  certamente: ["com certeza", "sem dúvida"],
  "sem dúvida": ["com certeza", "certamente"],
  talvez: ["quem sabe", "possivelmente"],
  principalmente: ["sobretudo", "especialmente"],
  especialmente: ["principalmente", "sobretudo"],
  geralmente: ["normalmente", "na maioria das vezes"],
  normalmente: ["geralmente", "na maioria das vezes"],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Mesma técnica de lib/voice/vocabulary.ts: uma alternância regex SÓ (não N
// regex separadas, uma por termo), formas mais longas primeiro (senão "tudo"
// dentro de "tudo bem" casaria antes da frase inteira, numa alternância `|`
// o regex para na primeira opção que bate da esquerda pra direita).
const ALL_FORMS = Object.keys(MESSAGE_SYNONYMS).sort((a, b) => b.length - a.length);

/** Alternância case-insensitive, com fronteira de palavra — usada pra achar candidatos no texto (ver script-editor.tsx). */
export const SYNONYM_REGEX = new RegExp(`\\b(?:${ALL_FORMS.map(escapeRegExp).join("|")})\\b`, "gi");

/** Alternativas pra uma forma encontrada no texto (busca sempre em minúsculo — o texto casado pode vir com maiúscula por estar no início da frase). */
export function synonymsFor(matchedText: string): string[] {
  return MESSAGE_SYNONYMS[matchedText.toLowerCase()] ?? [];
}
