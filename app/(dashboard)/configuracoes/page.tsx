import { Mail } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { canManageShareGroups } from "@/lib/share-groups";
import { TestEmailButton } from "./test-email-button";
import { ConfigSearch, type ConfigSection } from "./config-search";

export default async function ConfiguracoesPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const isManager = ["OWNER", "MANAGER"].includes(session!.user.role ?? "");

  // As duas não dependem uma da outra (organizationId já vem da sessão) —
  // rodavam em sequência sem motivo técnico, mesmo padrão já corrigido no
  // detalhe de Negócio (ver auditoria de performance).
  const [organization, processAccess] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId } }),
    requireProcessAccess(),
  ]);
  const isOwner = session!.user.role === "OWNER";
  const canManageProcesses = processAccess.ok && processAccess.isAdmin;
  // Supervisor também entra no item "Equipes" (diferente do resto de
  // "Espaço de trabalho", restrito a Dono/Gerente) — precisa alcançar o
  // compartilhamento entre consultores (agora dentro de Equipes, ver
  // configuracoes/equipes/page.tsx) pra própria equipe.
  const canManageSharing = canManageShareGroups(session!.user.role);

  // Dados puros (sem JSX) — o componente de busca (config-search.tsx)
  // precisa de uma lista plana pra filtrar por termo, incluindo `keywords`
  // (sinônimos/termos relacionados que a pessoa pode digitar sem bater
  // exatamente no título/descrição — ver comentário lá sobre a busca
  // "inteligente"). Cada Section só existe se tiver pelo menos 1 item
  // (papel do usuário já filtrou o resto antes de chegar aqui).
  const sections: ConfigSection[] = [
    {
      title: "Conta",
      description: "Seu perfil, notificações e automações pessoais",
      icon: "UserCircle",
      items: [
        {
          href: "/configuracoes/perfil",
          icon: "UserCircle",
          title: "Perfil e preferências",
          description: "Foto, notificações push e conexão do WhatsApp.",
          keywords: ["foto", "avatar", "notificação", "push", "whatsapp", "senha", "perfil"],
        },
        // Sub-item da própria "Perfil e preferências" (mesmo href, com
        // âncora direto pra seção — ver id="whatsapp" em
        // configuracoes/perfil/page.tsx) — só aparece buscando, com
        // "Perfil e preferências" como legenda acima (ver config-search.tsx).
        {
          href: "/configuracoes/perfil#whatsapp",
          icon: "MessageCircle",
          title: "Conectar WhatsApp",
          description: "QR Code ou WhatsApp Oficial (Meta) — o número que envia/recebe mensagem pelo CRM.",
          keywords: ["whatsapp", "instância", "instancia", "conectar", "qr code", "número", "conexão"],
          hiddenUnlessMatched: true,
          parentLabel: "Perfil e preferências",
        },
        {
          href: "/automacoes",
          icon: "Zap",
          title: "Automações",
          description: "Regras que disparam ação sozinhas nos seus negócios (tarefa, e-mail, WhatsApp, push).",
          keywords: ["automação", "regra", "gatilho", "trigger", "ação automática"],
        },
        {
          href: "/configuracoes/desfazer",
          icon: "Undo2",
          title: "Desfazer ações",
          description: "Histórico do Ctrl+Z — exclusões, edições e movimentações recentes, com botão de desfazer.",
          keywords: ["desfazer", "undo", "ctrl+z", "histórico", "restaurar", "excluir"],
        },
      ],
    },
    {
      title: "Espaço de trabalho",
      description: "Times, pipeline e dados do negócio",
      icon: "Building2",
      items: [
        ...(isManager
          ? [
              {
                href: "/configuracoes/usuarios",
                icon: "Users",
                title: "Usuários",
                description: "Gerenciar time e permissões.",
                keywords: ["usuário", "membro", "permissão", "acesso", "desativar", "papel", "cargo de usuário"],
              },
            ]
          : []),
        ...(isManager || canManageSharing
          ? [
              {
                href: "/configuracoes/equipes",
                icon: "UsersRound",
                title: "Equipes",
                description: "Agrupar vendedores sob um supervisor e configurar compartilhamento entre consultores.",
                keywords: [
                  "equipe",
                  "time",
                  "squad",
                  "supervisor",
                  "gerente",
                  "compartilhar",
                  "compartilhamento",
                  "compartilhado",
                  "agenda compartilhada",
                  "negócio compartilhado",
                  "marketing digital",
                  "setor",
                  "grupo",
                ],
              },
            ]
          : []),
        ...(isManager
          ? [
              {
                href: "/configuracoes/pipeline",
                icon: "Kanban",
                title: "Pipeline",
                description: "Etapas, cores e regras do funil.",
                keywords: ["funil", "etapa", "kanban", "estágio", "cor", "fase"],
              },
              {
                href: "/configuracoes/motivos-perda",
                icon: "XCircle",
                title: "Motivos de perda",
                description: "Usados ao marcar um negócio como perdido.",
                keywords: ["perda", "perdido", "motivo", "razão"],
              },
              {
                href: "/configuracoes/origens",
                icon: "Tag",
                title: "Origens",
                description: "De onde vêm os leads (Facebook, Indicação...).",
                keywords: ["origem", "fonte", "canal", "facebook", "instagram", "anúncio", "lead", "tráfego pago"],
              },
              {
                href: "/configuracoes/tipos-de-credito",
                icon: "CreditCard",
                title: "Tipos de crédito",
                description: "Imóvel, veículo e outras categorias do negócio.",
                keywords: ["crédito", "imóvel", "veículo", "consórcio", "categoria"],
              },
              {
                href: "/configuracoes/cargos",
                icon: "Briefcase",
                title: "Cargos",
                description: "Profissão/ocupação usada no cadastro de clientes.",
                keywords: ["cargo", "profissão", "ocupação", "cliente"],
              },
              {
                href: "/configuracoes/campos-personalizados",
                icon: "SlidersHorizontal",
                title: "Campos personalizados",
                description: "Adicione campos a clientes e negócios.",
                keywords: ["campo", "customizado", "personalizado", "extra", "adicional"],
              },
              {
                href: "/configuracoes/horario-atendimento",
                icon: "Clock",
                title: "Horário de atendimento",
                description: "Janela usada pela automação de mensagem recebida (ex.: responder só fora do expediente).",
                keywords: ["horário", "atendimento", "expediente", "feriado", "business hours", "automação", "mensagem recebida"],
              },
              ...(canManageProcesses
                ? [
                    {
                      href: "/configuracoes/processos",
                      icon: "ClipboardList",
                      title: "Processos (pós-venda)",
                      description: "Etapas do Kanban administrativo de pós-venda.",
                      keywords: ["processo", "pós-venda", "kanban administrativo", "contemplação"],
                    },
                  ]
                : []),
              {
                href: "/configuracoes/tv",
                icon: "Monitor",
                title: "TV Dashboard",
                description: "Configure o painel que é exibido nas televisões.",
                keywords: ["tv", "televisão", "painel", "dashboard", "monitor"],
              },
            ]
          : []),
      ],
    },
    {
      title: "Integrações",
      description: "Conecte serviços externos ao CRM",
      icon: "Plug",
      items: [
        {
          href: "/configuracoes/perfil",
          icon: "Mail",
          title: "Google Agenda",
          description: "Conecte sua conta pra ver seus eventos na Agenda do CRM e receber reuniões marcadas pela landing page.",
          keywords: ["agenda", "calendário", "google", "reunião", "evento", "sincronizar"],
        },
        ...(isManager
          ? [
              {
                href: "/configuracoes/integracoes",
                icon: "Plug",
                title: "API e webhooks",
                description: "Chaves de API pra ingestão externa e webhooks de saída (negócio ganho/perdido, contato criado).",
                keywords: ["api", "webhook", "chave", "integração", "token", "zapier", "make", "n8n"],
              },
            ]
          : []),
      ],
    },
    ...(isOwner
      ? [
          {
            title: "Segurança",
            description: "Auditoria e monitoramento do sistema",
            icon: "ShieldAlert",
            items: [
              {
                href: "/configuracoes/auditoria",
                icon: "ShieldAlert",
                title: "Auditoria",
                description: "Login, chaves de API, gestão de membros e conexões externas — quem fez o quê e de onde.",
                keywords: ["log", "histórico", "segurança", "quem fez", "auditoria"],
              },
              {
                href: "/configuracoes/saude-do-sistema",
                icon: "HeartPulse",
                title: "Saúde do sistema",
                description: "Última execução de cada cron (automações, campanhas, backup, webhooks) e falhas recentes.",
                keywords: ["erro", "falha", "cron", "backup", "automação", "webhook", "monitoramento", "status", "quebrou"],
              },
            ],
          },
        ]
      : []),
  ].filter((section) => section.items.length > 0);

  return (
    // max-w-5xl (não mais 3xl) — as duas colunas do mosaico (ver
    // config-search.tsx) precisam de espaço de sobra pra não ficarem
    // apertadas; 3xl (768px) mal cabia uma coluna confortável, virava 2
    // colunas espremidas demais pra ler como o Windows Settings pedido.
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Configurações</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Ajuste o {organization?.name ?? "CRM"} ao jeito do seu time
        </p>
      </div>

      <ConfigSearch sections={sections} />

      {!isManager && !canManageSharing && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Apenas donos e gerentes podem alterar configurações do time.
        </p>
      )}

      {/* Mesmo card auto-contido (ícone + título no topo) que cada seção de
          ConfigSearch usa — antes era um rótulo solto acima de um card
          separado, um estilo diferente do resto da página; agora fala a
          mesma língua visual do mosaico acima, mesmo ficando de fora do
          grid de colunas (não é filtrável pela busca, não faz sentido
          embaralhar posição junto com o resto ao digitar). */}
      {isOwner && (
        <div className="card max-w-md overflow-hidden p-0">
          <div className="flex items-center gap-3 bg-brand-light/40 p-4 dark:bg-white/[0.04]">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand shadow-sm shadow-brand/30">
              <Mail className="h-5 w-5 text-white" strokeWidth={2} />
            </div>
            <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">Alertas por e-mail</h2>
          </div>
          <TestEmailButton />
        </div>
      )}
    </div>
  );
}
