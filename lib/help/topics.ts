import type { HelpCategory, HelpTopic } from "./types";

/**
 * Catálogo da Central de Ajuda.
 *
 * Critério do que entra: uma dúvida que um consultor REALMENTE tem, e cuja
 * resposta termina em uma ação — por isso quase todo tópico tem `links`
 * (o botão que leva direto pra tela) e `steps` curtos. O que não cabe nesse
 * critério não entra: manual completo ninguém lê, e texto que só descreve o
 * óbvio ("clique em Salvar para salvar") gasta a confiança da ajuda.
 *
 * Prioridade deliberada pros RECURSOS ESCONDIDOS (Ctrl+Z, Cmd+K, ditado por
 * voz, seleção em massa, variáveis de script): quem não sabe que existem
 * nunca vai procurar por eles — são exatamente os que precisam da ajuda pra
 * serem descobertos. Feature que salta aos olhos na tela não precisa de verbete.
 */

export const HELP_CATEGORIES: HelpCategory[] = [
  { id: "primeiros-passos", title: "Primeiros passos", icon: "Rocket" },
  { id: "produtividade", title: "Ganhar tempo", icon: "Zap" },
  { id: "clientes", title: "Clientes", icon: "Users" },
  { id: "pipeline", title: "Negócios e funil", icon: "Kanban" },
  { id: "whatsapp", title: "WhatsApp", icon: "MessageCircle" },
  { id: "agenda", title: "Agenda", icon: "CalendarDays" },
  { id: "relatorios", title: "Relatórios", icon: "BarChart3" },
  { id: "admin", title: "Administração", icon: "Settings" },
];

export const HELP_TOPICS: HelpTopic[] = [
  // ─── Primeiros passos ─────────────────────────────────────────────

  {
    id: "conhecer-o-crm",
    title: "Tour: conhecer o CRM em 1 minuto",
    summary: "Um passeio guiado pelas partes principais da tela, apontando cada uma ao vivo.",
    category: "primeiros-passos",
    icon: "Compass",
    keywords: ["tour", "começar", "iniciar", "novo", "primeira vez", "onde fica", "passeio", "apresentação"],
    tourId: "conhecer-o-crm",
  },
  {
    id: "conectar-whatsapp",
    title: "Conectar seu WhatsApp",
    summary: "Sem número conectado, o CRM não envia nem recebe mensagem nenhuma por você.",
    category: "primeiros-passos",
    icon: "MessageCircle",
    keywords: ["whatsapp", "conectar", "qr code", "qrcode", "número", "celular", "instância", "meta", "oficial", "desconectado"],
    steps: [
      "Abra Configurações → Perfil e preferências e desça até a seção WhatsApp.",
      "Escolha QR Code (conecta o seu número pessoal, como no WhatsApp Web) ou WhatsApp Oficial da Meta.",
      "No QR Code: abra o WhatsApp do celular em Aparelhos conectados e aponte a câmera pro código da tela.",
      "Confira se o status virou “Conectado” — é isso que libera conversas, campanhas e mensagens agendadas.",
    ],
    note: {
      kind: "warn",
      text: "Se o celular ficar muito tempo sem internet, a conexão por QR Code cai e as campanhas pausam sozinhas. Vale conferir o status de manhã.",
    },
    links: [{ label: "Conectar agora", href: "/configuracoes/perfil#whatsapp" }],
  },
  {
    id: "perfil-foto",
    title: "Sua foto e suas notificações",
    summary: "Foto aparece pro time e no seu cartão digital; as notificações avisam de tarefa e mensagem nova.",
    category: "primeiros-passos",
    icon: "UserCircle",
    keywords: ["foto", "avatar", "perfil", "senha", "notificação", "push", "alerta", "celular"],
    steps: [
      "Abra Configurações → Perfil e preferências.",
      "Envie sua foto — ela aparece nos negócios, na agenda do time e no cartão digital.",
      "Ative as notificações push pra ser avisado de mensagem nova e tarefa do dia, mesmo com o CRM fechado.",
    ],
    links: [{ label: "Abrir meu perfil", href: "/configuracoes/perfil" }],
  },
  {
    id: "cartao-digital",
    title: "Seu cartão de visita digital",
    summary: "Link e QR Code com sua foto, contato e WhatsApp — e o CRM conta quantas pessoas abriram.",
    category: "primeiros-passos",
    icon: "CreditCard",
    keywords: ["cartão", "cartao", "visita", "qr code", "qrcode", "link", "compartilhar", "vcard", "contato", "apresentar"],
    steps: [
      "Abra Configurações → Cartão Digital e preencha cargo, telefone e endereço.",
      "Confira a pré-visualização ao lado — é exatamente o que o cliente vê.",
      "Use “Meu QR Code” num atendimento presencial: o cliente aponta a câmera e salva seu contato na hora.",
      "Acompanhe as estatísticas pra saber quantas pessoas abriram e clicaram no seu WhatsApp.",
    ],
    links: [{ label: "Abrir meu cartão", href: "/configuracoes/meu-cartao" }],
  },
  {
    id: "google-agenda",
    title: "Ligar a Google Agenda",
    summary: "Seus compromissos do Google aparecem junto das tarefas do CRM, numa agenda só.",
    category: "primeiros-passos",
    icon: "CalendarDays",
    keywords: ["google", "agenda", "calendário", "calendar", "sincronizar", "evento", "reunião", "videochamada", "meet"],
    steps: [
      "Abra Configurações → Perfil e preferências e conecte a conta Google.",
      "Volte pra Agenda: os eventos do Google passam a aparecer lado a lado com as tarefas do CRM.",
    ],
    links: [
      { label: "Conectar Google", href: "/configuracoes/perfil" },
      { label: "Ver a Agenda", href: "/agenda" },
    ],
  },

  // ─── Ganhar tempo (os recursos escondidos) ────────────────────────

  {
    id: "busca-rapida",
    title: "Achar qualquer cliente em 2 segundos",
    summary: "Ctrl+K abre a busca de qualquer tela — digite o nome ou o telefone e vá direto.",
    category: "produtividade",
    icon: "Search",
    keywords: ["buscar", "busca", "procurar", "achar", "encontrar", "atalho", "ctrl k", "cmd k", "pesquisa", "telefone"],
    steps: [
      "Aperte Ctrl+K (no Mac, ⌘+K) em qualquer tela do CRM.",
      "Digite parte do nome do cliente, do negócio ou o número do WhatsApp.",
      "Clique no resultado pra abrir direto — sem passar pela lista.",
    ],
    note: {
      kind: "tip",
      text: "Quando dois clientes têm o mesmo nome, a busca mostra o WhatsApp embaixo pra você saber qual é qual antes de abrir.",
    },
  },
  {
    id: "desfazer",
    title: "Desfazer o que você apagou sem querer",
    summary: "Ctrl+Z funciona no CRM inteiro — e existe um histórico das últimas ações pra desfazer depois.",
    category: "produtividade",
    icon: "Undo2",
    keywords: ["desfazer", "undo", "ctrl z", "apaguei", "errei", "excluí", "sem querer", "recuperar", "restaurar", "voltar"],
    steps: [
      "Logo depois de apagar, editar ou mover algo, aparece um aviso no canto com o botão Desfazer.",
      "Se o aviso já sumiu, aperte Ctrl+Z — ele desfaz a última ação mesmo assim.",
      "Passou tempo demais? Abra Configurações → Desfazer ações e desfaça de lá.",
    ],
    note: {
      kind: "tip",
      text: "Dá pra desfazer o desfazer: clicar de novo devolve tudo pro estado anterior.",
    },
    links: [{ label: "Histórico de ações", href: "/configuracoes/desfazer" }],
  },
  {
    id: "ditado-voz",
    title: "Ditar em vez de digitar",
    summary: "O microfone nos campos de texto transcreve sua fala — útil pra registrar visita no carro.",
    category: "produtividade",
    icon: "Mic",
    keywords: ["voz", "ditar", "microfone", "falar", "áudio", "transcrever", "digitar", "anotação", "rápido"],
    steps: [
      "Procure o ícone de microfone ao lado do campo de texto (registro de atividade no negócio, nova tarefa e cadastro rápido).",
      "Toque, fale normalmente e toque de novo pra parar — o texto entra no campo.",
      "Revise antes de salvar: o que você ditar é acrescentado ao que já estava escrito.",
    ],
  },
  {
    id: "acoes-em-massa",
    title: "Fazer de uma vez com 50 negócios",
    summary: "Modo seleção: troque etapa, responsável, origem ou dispare mensagem pra vários de uma vez.",
    category: "produtividade",
    icon: "CheckSquare",
    keywords: ["massa", "vários", "lote", "selecionar", "seleção", "em massa", "mover", "trocar", "todos", "bulk", "de uma vez"],
    salesOnly: true,
    steps: [
      "No Pipeline, ative o modo seleção e marque os negócios (dá pra selecionar a etapa inteira de uma vez).",
      "Escolha a ação na barra que aparece: trocar etapa, funil, responsável ou origem.",
      "“Enviar mensagem” dispara pra todos os selecionados usando um script — a mesma ideia existe na tela de Clientes.",
    ],
    note: {
      kind: "warn",
      text: "Em número conectado por QR Code, disparar muitos de uma vez aumenta o risco de bloqueio pela Meta. Prefira lotes menores.",
    },
    links: [{ label: "Ir pro Pipeline", href: "/pipeline" }],
  },
  {
    id: "atalhos",
    title: "Atalhos de teclado",
    summary: "Os atalhos que existem hoje no CRM, todos conferidos.",
    category: "produtividade",
    icon: "Keyboard",
    keywords: ["atalho", "teclado", "tecla", "shortcut", "ctrl", "comando", "rápido"],
    reference: [
      { code: "Ctrl + K", meaning: "Abrir a busca de clientes e negócios" },
      { code: "Ctrl + Z", meaning: "Desfazer a última ação" },
      { code: "Esc", meaning: "Fechar a janela aberta" },
      { code: "Enter", meaning: "Enviar a mensagem (na conversa do WhatsApp)" },
      { code: "Shift + Enter", meaning: "Quebrar linha sem enviar a mensagem" },
      { code: "Ctrl + B", meaning: "Negrito no texto da mensagem" },
      { code: "Ctrl + I", meaning: "Itálico no texto da mensagem" },
      { code: "Ctrl + Shift + S", meaning: "Tachado no texto da mensagem" },
    ],
    note: {
      kind: "tip",
      text: "Em campos de seleção (etapa, responsável, origem), digitar as primeiras letras já pula pra opção certa.",
    },
  },

  // ─── Clientes ─────────────────────────────────────────────────────

  {
    id: "novo-cliente",
    title: "Cadastrar um cliente",
    summary: "O cadastro mínimo é nome e WhatsApp — o resto dá pra completar depois.",
    category: "clientes",
    icon: "UserPlus",
    keywords: ["cliente", "contato", "cadastrar", "criar contato", "novo", "adicionar", "lead", "carteira"],
    steps: [
      "Abra Clientes e use o botão de novo contato.",
      "Preencha nome e WhatsApp — com o número certo, a conversa já fica ligada ao cadastro.",
      "Se o número já existir na base, o CRM avisa em vez de criar um cliente duplicado.",
    ],
    links: [{ label: "Abrir Clientes", href: "/clientes" }],
  },
  {
    id: "importar-clientes",
    title: "Importar uma lista de uma planilha",
    summary: "Traga centenas de contatos de uma vez, conferindo a prévia antes de gravar.",
    category: "clientes",
    icon: "Upload",
    keywords: ["importar", "planilha", "excel", "csv", "lista", "lote", "subir", "arquivo", "xlsx", "massa"],
    steps: [
      "Em Clientes, use a opção de importar planilha.",
      "Escolha o arquivo e confira a prévia — é onde você corrige a coluna que ficou no lugar errado.",
      "Confirme a importação. Contato repetido é identificado pelo telefone e não entra duas vezes.",
    ],
    note: {
      kind: "tip",
      text: "O mesmo caminho existe no Pipeline pra importar negócios já com etapa e valor.",
    },
    links: [{ label: "Abrir Clientes", href: "/clientes" }],
  },
  {
    id: "exportar",
    title: "Exportar a carteira pra planilha",
    summary: "Baixa o que está na tela, respeitando os filtros que você aplicou.",
    category: "clientes",
    icon: "Download",
    keywords: ["exportar", "baixar", "planilha", "excel", "csv", "relatório", "download", "backup"],
    steps: [
      "Aplique os filtros que quiser na lista (responsável, origem, etapa...).",
      "Use exportar — o arquivo sai com exatamente o que está filtrado, não com a base inteira.",
    ],
    links: [
      { label: "Clientes", href: "/clientes" },
      { label: "Pipeline", href: "/pipeline" },
    ],
  },
  {
    id: "tags-qualificacao",
    title: "Marcar o cliente com etiqueta e qualificação",
    summary: "Etiquetas organizam a carteira; a qualificação registra o quanto o lead está quente.",
    category: "clientes",
    icon: "Tag",
    keywords: ["tag", "etiqueta", "marcar", "qualificar", "qualificação", "lead", "quente", "frio", "classificar", "organizar"],
    steps: [
      "Abra o cliente e use as etiquetas pra agrupar do seu jeito (ex.: “indicação”, “evento”).",
      "Registre a qualificação do lead no card do cliente dentro do negócio.",
      "Depois, filtre a lista por etiqueta pra atacar um grupo de cada vez.",
    ],
    links: [{ label: "Abrir Clientes", href: "/clientes" }],
  },

  // ─── Pipeline e negócios ──────────────────────────────────────────

  {
    id: "criar-negocio",
    title: "Criar um negócio",
    summary: "Negócio é a venda em andamento — é ele que anda pelas etapas do funil.",
    category: "pipeline",
    icon: "Plus",
    salesOnly: true,
    keywords: ["negócio", "negocio", "criar", "novo", "venda", "oportunidade", "funil", "proposta"],
    steps: [
      "No Pipeline, use “Novo negócio”.",
      "Escolha o cliente (ou cadastre na hora, sem sair da tela) e o funil.",
      "Sem escolher responsável, o negócio cai na distribuição automática do time.",
    ],
    links: [{ label: "Criar negócio agora", href: "/pipeline?novo=1" }],
  },
  {
    id: "mover-etapas",
    title: "Mover o negócio de etapa",
    summary: "Arraste o card — e entenda por que às vezes ele pede um campo antes de passar.",
    category: "pipeline",
    icon: "Kanban",
    salesOnly: true,
    keywords: ["mover", "arrastar", "etapa", "estágio", "fase", "funil", "kanban", "avançar", "obrigatório", "travou"],
    steps: [
      "Arraste o card pra etapa seguinte, ou abra o negócio e troque a etapa por lá.",
      "Se aparecer uma janela pedindo valor, cargo ou outro campo, é regra da etapa: o funil exige esse dado pra avançar.",
      "Preencha ali mesmo e o negócio segue — não precisa sair da tela.",
    ],
    note: {
      kind: "tip",
      text: "Quem é Dono ou Gerente escolhe quais campos cada etapa exige em Configurações → Pipeline.",
    },
    links: [{ label: "Ir pro Pipeline", href: "/pipeline" }],
  },
  {
    id: "ganhar-negocio",
    title: "Marcar um negócio como ganho",
    summary: "O jeito certo de fechar — é isso que alimenta ranking, comissão e relatórios.",
    category: "pipeline",
    icon: "Trophy",
    salesOnly: true,
    keywords: ["ganho", "ganhar", "vendeu", "fechou", "venda", "comissão", "ranking", "contemplado", "sucesso", "fechar negócio", "assinou", "vendi", "fechei", "ganhei"],
    steps: [
      "Abra o negócio e marque como ganho.",
      "Informe a data do fechamento — o relatório e o ranking usam essa data, não a de hoje.",
      "Se faltar valor ou cargo do cliente, o CRM pede na hora: esses campos são o que faz o relatório fechar certo.",
    ],
    note: {
      kind: "tip",
      text: "Marcou errado? Ctrl+Z desfaz, e dá pra reabrir o negócio a qualquer momento.",
    },
    links: [{ label: "Ir pro Pipeline", href: "/pipeline" }],
  },
  {
    id: "perder-negocio",
    title: "Marcar como perdido (e por quê)",
    summary: "O motivo da perda é o dado mais valioso do funil — é o que mostra onde o time trava.",
    category: "pipeline",
    icon: "XCircle",
    salesOnly: true,
    keywords: ["perdido", "perder", "perda", "motivo", "não quis", "desistiu", "recusou", "cancelou", "venda", "não fechou", "sumiu", "desistência"],
    steps: [
      "Abra o negócio e marque como perdido.",
      "Escolha o motivo na lista e, se ajudar, escreva uma observação curta.",
      "Informe a data em que a perda aconteceu de verdade.",
    ],
    note: {
      kind: "tip",
      text: "Os motivos da lista são configuráveis pelo Dono/Gerente em Configurações → Motivos de perda.",
    },
  },
  {
    id: "registrar-atividade",
    title: "Registrar ligação, visita e anotação",
    summary: "A linha do tempo do negócio é a memória do atendimento — e já cria a próxima tarefa.",
    category: "pipeline",
    icon: "StickyNote",
    salesOnly: true,
    keywords: ["atividade", "anotação", "nota", "ligação", "visita", "histórico", "linha do tempo", "registro", "follow up"],
    steps: [
      "Abra o negócio e escolha a aba do que aconteceu: nota, ligação, WhatsApp, videochamada ou visita.",
      "Escreva (ou dite pelo microfone) o que foi conversado.",
      "Preenchendo um prazo, o CRM já cria a tarefa do próximo passo na sua agenda — não deixe em branco.",
    ],
    note: {
      kind: "tip",
      text: "Na aba WhatsApp dá pra deixar a mensagem já escrita pra sair sozinha na hora marcada.",
    },
  },
  {
    id: "propostas",
    title: "Montar uma proposta",
    summary: "Proposta com valores, revisões e PDF pronto pra mandar pro cliente.",
    category: "pipeline",
    icon: "FileText",
    salesOnly: true,
    keywords: ["proposta", "pdf", "imprimir", "orçamento", "valor", "condições", "revisão", "documento", "enviar"],
    steps: [
      "Abra o negócio e use o card de Propostas.",
      "Preencha os valores e gere o documento.",
      "Salve em PDF (ou imprima) e marque como enviada — o CRM acompanha se o cliente aceitou ou recusou.",
      "Precisou mudar depois de enviar? Faça uma nova revisão: o histórico das anteriores fica guardado.",
    ],
    note: {
      kind: "tip",
      text: "O texto padrão que já vem preenchido em toda proposta é definido pelo Dono em Configurações → Modelo de proposta.",
    },
  },

  // ─── WhatsApp ─────────────────────────────────────────────────────

  {
    id: "conversas",
    title: "Conversar pelo CRM",
    summary: "Todas as conversas num lugar só, ligadas ao cliente e ao negócio dele.",
    category: "whatsapp",
    icon: "MessageCircle",
    keywords: ["conversa", "chat", "mensagem", "responder", "áudio", "anexo", "imagem", "pix", "atender"],
    steps: [
      "Abra WhatsApp → Conversas.",
      "Enter envia; Shift+Enter quebra linha. Dá pra formatar com Ctrl+B (negrito) e Ctrl+I (itálico).",
      "Use os botões pra mandar áudio, imagem, contato ou uma cobrança Pix.",
      "O painel lateral mostra quem é o cliente e em que negócio ele está, sem você trocar de tela.",
    ],
    links: [{ label: "Abrir Conversas", href: "/whatsapp/conversas" }],
  },
  {
    id: "scripts",
    title: "Scripts: parar de digitar a mesma coisa",
    summary: "Sequência de mensagens pronta, com o nome do cliente preenchido sozinho.",
    category: "whatsapp",
    icon: "ScrollText",
    keywords: ["script", "modelo", "template", "mensagem pronta", "variável", "automático", "abordagem", "padrão", "texto"],
    steps: [
      "Abra WhatsApp → Scripts e crie um novo.",
      "Escreva em várias mensagens curtas, como uma pessoa mandaria — cada uma com o tempo de espera até a próxima.",
      "Use as variáveis da tabela abaixo pra personalizar automaticamente.",
      "Depois é só usar o script numa conversa ou numa campanha.",
    ],
    reference: [
      { code: "{primeiro_nome}", meaning: "Só o primeiro nome do cliente (“Maria Silva” vira “Maria”)" },
      { code: "{nome}", meaning: "Nome completo do cliente" },
      { code: "{saudacao}", meaning: "Bom dia / Boa tarde / Boa noite conforme a hora do envio" },
      { code: "{cargo}", meaning: "Cargo ou profissão cadastrada" },
      { code: "{empresa}", meaning: "Empresa do cliente" },
      { code: "{cidade}", meaning: "Cidade do cliente" },
      { code: "{consultor}", meaning: "Nome do consultor responsável" },
      { code: "{[oi|olá|opa]}", meaning: "Sorteia uma das opções a cada envio" },
    ],
    note: {
      kind: "tip",
      text: "Essa última é a mais importante em disparo grande: variar a frase evita que centenas de mensagens saiam idênticas, o que é fácil da Meta reconhecer como automação.",
    },
    links: [
      { label: "Ver meus scripts", href: "/whatsapp/scripts" },
      { label: "Criar um script", href: "/whatsapp/scripts/novo" },
    ],
  },
  {
    id: "campanhas",
    title: "Disparar uma campanha",
    summary: "Envia um script pra uma lista inteira, no seu ritmo, sem você ficar mandando um a um.",
    category: "whatsapp",
    icon: "Send",
    keywords: ["campanha", "disparo", "massa", "prospecção", "lista", "enviar", "fila", "automático", "marketing", "rmkt", "criar campanha", "disparar"],
    steps: [
      "Abra WhatsApp → Campanhas e crie uma nova.",
      "Monte o público (filtro de clientes) e escolha o script que vai ser enviado.",
      "Inicie a campanha: o CRM envia no ritmo configurado e você acompanha a fila e quem já recebeu.",
      "Dá pra pausar e retomar a qualquer momento, e reordenar quem vai primeiro na fila.",
    ],
    note: {
      kind: "warn",
      text: "Se o WhatsApp desconectar no meio, a campanha pausa sozinha pra não queimar contatos com falha. Reconecte e retome.",
    },
    links: [{ label: "Abrir Campanhas", href: "/whatsapp/campanhas" }],
  },
  {
    id: "mensagem-agendada",
    title: "Deixar uma mensagem pra sair sozinha",
    summary: "Escreve agora, o CRM envia na hora marcada — follow-up que não depende da sua memória.",
    category: "whatsapp",
    icon: "Clock",
    keywords: ["agendar", "agendada", "programar", "depois", "follow up", "lembrete", "automático", "hora", "sair sozinha"],
    steps: [
      "Ao registrar uma atividade de WhatsApp no negócio, marque um prazo e ative a mensagem agendada.",
      "Escreva o texto que deve ser enviado — ele sai sozinho no dia e hora da tarefa.",
      "Na Agenda dá pra fazer isso pra várias tarefas de uma vez.",
    ],
    links: [{ label: "Ver a Agenda", href: "/agenda" }],
  },

  // ─── Agenda ───────────────────────────────────────────────────────

  {
    id: "criar-atividade",
    title: "Criar e organizar tarefas",
    summary: "A agenda é a sua lista do dia — e o calendário aceita arrastar pra remarcar.",
    category: "agenda",
    icon: "CalendarDays",
    keywords: ["tarefa", "atividade", "agenda", "compromisso", "prazo", "lembrete", "calendário", "hoje", "atrasada"],
    steps: [
      "Abra a Agenda e crie a atividade escolhendo o tipo (ligação, WhatsApp, visita, videochamada).",
      "Na visão de calendário, arraste a tarefa pra outro dia pra remarcar.",
      "O que venceu aparece como atrasado — na tela inicial também, pra não passar batido.",
    ],
    links: [{ label: "Abrir Agenda", href: "/agenda" }],
  },
  {
    id: "resultado-reuniao",
    title: "Registrar o resultado de uma reunião",
    summary: "Compareceu, não compareceu ou remarcou — é o que separa “fiz contato” de “falei com o cliente”.",
    category: "agenda",
    icon: "UserCheck",
    keywords: ["reunião", "visita", "resultado", "compareceu", "no show", "faltou", "remarcar", "videochamada", "concluir"],
    steps: [
      "Ao concluir uma visita ou videochamada, o CRM pergunta o que aconteceu.",
      "Escolha compareceu, não compareceu ou remarcar (aí você já escolhe a nova data).",
      "Esse resultado é o que alimenta o relatório de reuniões — sem ele, a reunião não conta.",
    ],
    links: [{ label: "Abrir Agenda", href: "/agenda" }],
  },

  // ─── Relatórios ───────────────────────────────────────────────────

  {
    id: "relatorios",
    title: "Ler os relatórios",
    summary: "Quanto entrou, quanto fechou, quem está produzindo e onde o funil trava.",
    category: "relatorios",
    icon: "BarChart3",
    keywords: ["relatório", "resultado", "número", "meta", "ranking", "produção", "desempenho", "conversão", "gráfico"],
    steps: [
      "Abra Relatórios e escolha o período no topo — todos os números respeitam esse filtro.",
      "Clique num número pra ver a lista por trás dele (ex.: quais negócios foram ganhos).",
      "A aba de anúncios mostra o retorno do que veio de tráfego pago.",
    ],
    note: {
      kind: "tip",
      text: "Número estranho quase sempre é campo não preenchido: negócio ganho sem data ou reunião concluída sem resultado ficam de fora da conta.",
    },
    links: [
      { label: "Abrir Relatórios", href: "/relatorios" },
      { label: "Anúncios (Meta)", href: "/relatorios/meta-ads" },
    ],
  },

  // ─── Administração (Dono / Gerente) ───────────────────────────────

  {
    id: "configurar-funil",
    title: "Montar as etapas do funil",
    summary: "Nomes, cores, ordem — e quais campos cada etapa passa a exigir.",
    category: "admin",
    icon: "Kanban",
    roles: ["OWNER", "MANAGER"],
    keywords: ["funil", "pipeline", "etapa", "estágio", "configurar", "cor", "ordem", "obrigatório", "campo"],
    steps: [
      "Abra Configurações → Pipeline.",
      "Crie ou renomeie as etapas e arraste pra mudar a ordem.",
      "Marque os campos obrigatórios da etapa — o negócio só avança depois de preenchidos.",
    ],
    links: [{ label: "Configurar Pipeline", href: "/configuracoes/pipeline" }],
  },
  {
    id: "usuarios-permissoes",
    title: "Adicionar alguém no time",
    summary: "Cada papel enxerga uma fatia diferente da base — é isso que separa consultor de supervisor.",
    category: "admin",
    icon: "Users",
    roles: ["OWNER", "MANAGER"],
    keywords: ["usuário", "membro", "time", "adicionar", "convidar", "permissão", "papel", "acesso", "desativar", "senha"],
    steps: [
      "Abra Configurações → Usuários e cadastre a pessoa.",
      "Escolha o papel: Consultor vê a própria carteira; Supervisor vê a equipe dele; Gerente e Dono veem tudo.",
      "Quem sai do time deve ser desativado, nunca apagado — o histórico de vendas precisa continuar existindo.",
    ],
    links: [{ label: "Gerenciar usuários", href: "/configuracoes/usuarios" }],
  },
  {
    id: "equipes-compartilhamento",
    title: "Equipes e compartilhamento",
    summary: "Agrupe consultores sob um supervisor e defina quem enxerga a carteira de quem.",
    category: "admin",
    icon: "UsersRound",
    roles: ["OWNER", "MANAGER", "SUPERVISOR"],
    keywords: ["equipe", "time", "supervisor", "compartilhar", "compartilhamento", "grupo", "setor", "ver negócio", "agenda"],
    steps: [
      "Abra Configurações → Equipes.",
      "Crie a equipe e defina o supervisor responsável.",
      "No compartilhamento, escolha se o grupo divide negócios, agenda, ou os dois.",
    ],
    links: [{ label: "Configurar Equipes", href: "/configuracoes/equipes" }],
  },
  {
    id: "automacoes",
    title: "Automações: o CRM trabalhando sozinho",
    summary: "Regras do tipo “quando isso acontecer, faça aquilo” — sem ninguém lembrar de fazer.",
    category: "admin",
    icon: "Zap",
    keywords: ["automação", "automacao", "regra", "gatilho", "trigger", "automático", "sozinho", "quando", "disparar"],
    steps: [
      "Abra Automações e crie uma regra.",
      "Escolha o gatilho (ex.: negócio entrou numa etapa, mensagem recebida fora do expediente).",
      "Escolha a ação: criar tarefa, mandar WhatsApp, e-mail ou notificação.",
      "Ative e acompanhe — dá pra desligar a qualquer momento sem apagar a regra.",
    ],
    links: [{ label: "Abrir Automações", href: "/automacoes" }],
  },
  {
    id: "tv-ranking",
    title: "TV do escritório e ranking",
    summary: "Painel pra TV da sala com pódio do mês, metas e os negócios fechando ao vivo.",
    category: "admin",
    icon: "Monitor",
    roles: ["OWNER", "MANAGER"],
    keywords: ["tv", "televisão", "painel", "ranking", "pódio", "meta", "dashboard", "escritório", "monitor", "sala"],
    steps: [
      "Abra Configurações → TV Dashboard e escolha o que aparece na tela.",
      "Gere o link da TV e abra no navegador da televisão — não precisa de login nela.",
      "A TV que fica à vista de cliente mostra só o pódio; a lista completa do ranking tem um link separado, pra uso interno.",
    ],
    links: [{ label: "Configurar a TV", href: "/configuracoes/tv" }],
  },
  {
    id: "saude-sistema",
    title: "Conferir se está tudo rodando",
    summary: "Última execução de cada rotina automática e as falhas recentes, num lugar só.",
    category: "admin",
    icon: "HeartPulse",
    roles: ["OWNER"],
    keywords: ["saúde", "sistema", "erro", "falha", "parou", "cron", "backup", "monitorar", "status", "quebrou"],
    steps: [
      "Abra Configurações → Saúde do sistema.",
      "Confira se campanhas, automações, webhooks e backup rodaram recentemente.",
      "Algo parado há muito tempo é sinal de rotina travada — vale avisar quem cuida do sistema.",
    ],
    links: [{ label: "Ver saúde do sistema", href: "/configuracoes/saude-do-sistema" }],
  },
  {
    id: "uso-do-crm",
    title: "Saber o que o time realmente usa",
    summary: "Quais recursos a equipe usa, quais ninguém abriu e quem ainda não entrou no CRM.",
    category: "admin",
    icon: "BarChart3",
    roles: ["OWNER"],
    keywords: ["uso", "adoção", "time", "cliques", "recursos", "treinamento", "quem usa", "métricas", "ninguém usa"],
    steps: [
      "Abra Configurações → Uso do CRM.",
      "Veja o que é mais usado e, principalmente, o que ninguém abriu — é onde falta treinar.",
      "A lista por pessoa mostra quem já adotou e quem ainda não começou.",
    ],
    links: [{ label: "Ver uso do CRM", href: "/configuracoes/uso" }],
  },
  {
    id: "api-webhooks",
    title: "Conectar outro sistema ao CRM",
    summary: "Chaves de API pra receber leads de fora e webhooks pra avisar outro sistema.",
    category: "admin",
    icon: "Plug",
    roles: ["OWNER", "MANAGER"],
    keywords: ["api", "webhook", "integração", "integrar", "chave", "token", "zapier", "make", "n8n", "lead", "externo"],
    steps: [
      "Abra Configurações → API e webhooks e gere uma chave.",
      "Copie a chave na hora: ela é mostrada uma única vez.",
      "A documentação técnica tem os endereços e exemplos prontos pra quem for integrar.",
    ],
    links: [
      { label: "Chaves e webhooks", href: "/configuracoes/integracoes" },
      { label: "Documentação da API", href: "/docs", newTab: true },
    ],
  },
];

export const HELP_TOPIC_BY_ID = new Map(HELP_TOPICS.map((t) => [t.id, t]));
