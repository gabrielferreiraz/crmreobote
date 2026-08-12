import Link from "next/link";
import type { ComponentType } from "react";
import { Kanban, Users, ChevronRight, XCircle, UsersRound, UserCircle, SlidersHorizontal, Mail, Zap, Plug, Tag, CreditCard, Briefcase, ClipboardList, ShieldAlert, Monitor } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireProcessAccess } from "@/lib/processes/access";
import { TestEmailButton } from "./test-email-button";

type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;

export default async function ConfiguracoesPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const isManager = ["OWNER", "MANAGER"].includes(session!.user.role ?? "");

  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  const isOwner = session!.user.role === "OWNER";
  const processAccess = await requireProcessAccess();
  const canManageProcesses = processAccess.ok && processAccess.isAdmin;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Configurações</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Ajuste o {organization?.name ?? "CRM"} ao jeito do seu time
        </p>
      </div>

      <Section title="Conta">
        <Row
          href="/configuracoes/perfil"
          icon={UserCircle}
          title="Perfil e preferências"
          description="Foto, notificações push e conexão do WhatsApp."
        />
        <Row
          href="/automacoes"
          icon={Zap}
          title="Automações"
          description="Regras que disparam ação sozinhas nos seus negócios (tarefa, e-mail, WhatsApp, push)."
        />
      </Section>

      {isManager ? (
        <Section title="Espaço de trabalho">
          <Row href="/configuracoes/usuarios" icon={Users} title="Usuários" description="Gerenciar time e permissões." />
          <Row href="/configuracoes/equipes" icon={UsersRound} title="Equipes" description="Agrupar vendedores sob um supervisor." />
          <Row href="/configuracoes/pipeline" icon={Kanban} title="Pipeline" description="Etapas, cores e regras do funil." />
          <Row href="/configuracoes/motivos-perda" icon={XCircle} title="Motivos de perda" description="Usados ao marcar um negócio como perdido." />
          <Row href="/configuracoes/origens" icon={Tag} title="Origens" description="De onde vêm os leads (Facebook, Indicação...)." />
          <Row href="/configuracoes/tipos-de-credito" icon={CreditCard} title="Tipos de crédito" description="Imóvel, veículo e outras categorias do negócio." />
          <Row href="/configuracoes/cargos" icon={Briefcase} title="Cargos" description="Profissão/ocupação usada no cadastro de clientes." />
          <Row href="/configuracoes/campos-personalizados" icon={SlidersHorizontal} title="Campos personalizados" description="Adicione campos a clientes e negócios." />
          {canManageProcesses && (
            <Row href="/configuracoes/processos" icon={ClipboardList} title="Processos (pós-venda)" description="Etapas do Kanban administrativo de pós-venda." />
          )}
          <Row href="/configuracoes/tv" icon={Monitor} title="TV Dashboard" description="Configure o painel que é exibido nas televisões." />
        </Section>
      ) : (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Apenas donos e gerentes podem alterar configurações do time.
        </p>
      )}

      <Section title="Integrações">
        <Row
          href="/configuracoes/perfil"
          icon={Mail}
          title="Google Agenda"
          description="Conecte sua conta pra ver seus eventos na Agenda do CRM."
        />
        {isManager && (
          <Row
            href="/configuracoes/integracoes"
            icon={Plug}
            title="API e webhooks"
            description="Chaves de API pra ingestão externa e webhooks de saída (negócio ganho/perdido, contato criado)."
          />
        )}
      </Section>

      {isOwner && (
        <Section title="Segurança">
          <Row
            href="/configuracoes/auditoria"
            icon={ShieldAlert}
            title="Auditoria"
            description="Login, chaves de API, gestão de membros e conexões externas — quem fez o quê e de onde."
          />
        </Section>
      )}

      {isOwner && (
        <Section title="Alertas por e-mail">
          <TestEmailButton />
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">{title}</h2>
      <div className="card divide-y divide-neutral-100 dark:divide-neutral-800">{children}</div>
    </div>
  );
}

function Row({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: IconComponent;
  title: string;
  description: string;
  href?: string;
}) {
  const content = (
    <>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-light dark:bg-brand-light">
        <Icon className="h-4 w-4 text-brand dark:text-brand" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`font-medium ${href ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-500 dark:text-neutral-400"}`}>
          {title}
        </p>
        <p className="mt-0.5 text-sm text-neutral-400 dark:text-neutral-500">{description}</p>
      </div>
    </>
  );

  if (!href) {
    return (
      <div className="flex items-center gap-3 p-4 text-sm">
        {content}
        <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500">
          Em breve
        </span>
      </div>
    );
  }

  return (
    <Link href={href} className="group flex items-center gap-3 p-4 text-sm transition-colors hover:bg-brand-light/50 dark:hover:bg-brand-light/30">
      {content}
      <ChevronRight className="h-4 w-4 shrink-0 text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand dark:text-neutral-600 dark:group-hover:text-brand" strokeWidth={2} />
    </Link>
  );
}
