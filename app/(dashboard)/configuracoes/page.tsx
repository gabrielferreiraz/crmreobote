import Link from "next/link";
import type { ComponentType } from "react";
import {
  Kanban,
  Users,
  ChevronRight,
  XCircle,
  UsersRound,
  UserCircle,
  Bell,
  ShieldCheck,
  SlidersHorizontal,
  Mail,
  Zap,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TestEmailButton } from "./test-email-button";

type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;

export default async function ConfiguracoesPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId!;
  const isAdmin = ["OWNER", "ADMIN"].includes(session!.user.role ?? "");

  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  const isOwner = session!.user.role === "OWNER";

  return (
    <div className="max-w-2xl space-y-8">
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
        <Row icon={Bell} title="Notificações" description="Alertas por e-mail e resumos diários." />
        <Row icon={ShieldCheck} title="Segurança" description="Senha, autenticação em dois fatores." />
      </Section>

      {isAdmin ? (
        <Section title="Espaço de trabalho">
          <Row href="/configuracoes/usuarios" icon={Users} title="Usuários" description="Gerenciar time e permissões." />
          <Row href="/configuracoes/equipes" icon={UsersRound} title="Equipes" description="Agrupar vendedores sob um supervisor." />
          <Row href="/configuracoes/pipeline" icon={Kanban} title="Pipeline" description="Etapas, cores e regras do funil." />
          <Row href="/configuracoes/motivos-perda" icon={XCircle} title="Motivos de perda" description="Usados ao marcar um negócio como perdido." />
          <Row href="/automacoes" icon={Zap} title="Automações" description="Regras que disparam ação sozinhas (tarefa, e-mail, WhatsApp, push)." />
          <Row icon={SlidersHorizontal} title="Campos personalizados" description="Adicione campos a clientes e negócios." />
        </Section>
      ) : (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Apenas donos e administradores podem alterar configurações do time.
        </p>
      )}

      <Section title="Integrações">
        <Row icon={Mail} title="E-mail e calendário" description="Sincronize Google, Outlook e IMAP." />
      </Section>

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
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
        <Icon className="h-4 w-4 text-neutral-500 dark:text-neutral-400" strokeWidth={1.75} />
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
    <Link href={href} className="flex items-center gap-3 p-4 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
      {content}
      <ChevronRight className="h-4 w-4 shrink-0 text-neutral-300 dark:text-neutral-600" strokeWidth={2} />
    </Link>
  );
}
