# CRM — Briefing Completo para Implementação

## Contexto e Objetivo

Construir um CRM SaaS profissional, separado do SenderWhats, com foco inicial em equipes de vendas de consórcio. O produto deve ser escalável o suficiente para ser vendido para outras empresas no futuro.

Referência visual: Agendor CRM / Datacrazy.

---

## Decisões Arquiteturais (já definidas — não questionar)

### Multi-tenancy
- **`organizationId` em todas as tabelas** + Row Level Security no PostgreSQL
- Cada empresa (organização) vê apenas seus próprios dados
- É o modelo usado por Pipedrive, HubSpot, Salesforce

### Autenticação
- **Auth.js v5 (NextAuth)** — gratuito, open source, sem limite de usuários
- Suporte a email/senha e OAuth (Google)
- Sessão baseada em JWT

### Stack
- **Next.js 15+ App Router** (force-dynamic nas rotas de API)
- **TypeScript** — strict mode
- **Prisma 7 + PostgreSQL**
- **Tailwind CSS v4** — dark mode por padrão
- **Projeto separado** — diretório próprio, não dentro do SenderWhats

### Regras de migração
- NUNCA usar `prisma migrate dev` contra banco remoto
- Sempre usar `prisma migrate deploy` para aplicar no banco de produção

---

## Entidades e Schema Prisma

```prisma
// ─── Multi-tenancy root ───────────────────────────────────────────────────────

model Organization {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique  // usado na URL: crm.app/[slug]
  createdAt DateTime @default(now())

  users      OrganizationUser[]
  pipelines  Pipeline[]
  contacts   Contact[]
  companies  Company[]
  deals      Deal[]
  tasks      Task[]
  activities Activity[]
}

// ─── Usuários ─────────────────────────────────────────────────────────────────

model User {
  id        String   @id @default(cuid())
  name      String
  email     String   @unique
  image     String?
  createdAt DateTime @default(now())

  orgs        OrganizationUser[]
  dealsOwned  Deal[]
  tasksOwned  Task[]
  activities  Activity[]
}

model OrganizationUser {
  id             String       @id @default(cuid())
  organizationId String
  userId         String
  role           OrgRole      @default(MEMBER)  // OWNER | ADMIN | MEMBER
  createdAt      DateTime     @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([organizationId, userId])
}

enum OrgRole { OWNER ADMIN MEMBER }

// ─── Pipeline (Funil) ─────────────────────────────────────────────────────────

model Pipeline {
  id             String   @id @default(cuid())
  organizationId String
  name           String   // "Funil de Vendas", "Funil de Ads", "Funil de Viagens"
  isDefault      Boolean  @default(false)
  order          Int      @default(0)
  createdAt      DateTime @default(now())

  organization Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  stages       PipelineStage[]
  deals        Deal[]

  @@index([organizationId])
}

model PipelineStage {
  id         String   @id @default(cuid())
  pipelineId String
  name       String   // "Prospecção", "Mensagem/Ligação", "No-show", etc.
  order      Int
  color      String?  // hex color para UI
  createdAt  DateTime @default(now())

  pipeline Pipeline @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  deals    Deal[]

  @@index([pipelineId, order])
}

// ─── Contatos e Empresas ──────────────────────────────────────────────────────

model Company {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  cnpj           String?
  website        String?
  phone          String?
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  contacts     Contact[]

  @@index([organizationId])
}

model Contact {
  id             String   @id @default(cuid())
  organizationId String
  companyId      String?
  name           String
  email          String?
  phone          String?   // celular principal
  whatsapp       String?   // pode ser diferente do celular
  source         String?   // "FACEBOOK", "INSTAGRAM", "INDICAÇÃO", etc.
  createdAt      DateTime  @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  company      Company?     @relation(fields: [companyId], references: [id])
  deals        Deal[]

  @@index([organizationId])
  @@index([organizationId, phone])
}

// ─── Negócio (Deal) ───────────────────────────────────────────────────────────

model Deal {
  id             String     @id @default(cuid())
  organizationId String
  pipelineId     String
  stageId        String
  contactId      String
  ownerId        String     // User responsável

  // Identificação
  name           String     // auto: "06/26 - Lucia Moura FACEBOOK"
  status         DealStatus @default(OPEN)  // OPEN | WON | LOST

  // Financeiro
  value          Decimal?   @db.Decimal(12, 2)  // Valor da carta de crédito

  // Campos específicos de consórcio
  creditType     String?    // "IMÓVEL" | "VEÍCULO" | "OUTROS"

  // Datas
  startedAt      DateTime   @default(now())
  expectedCloseAt DateTime?
  closedAt       DateTime?
  stageEnteredAt DateTime   @default(now())  // para calcular tempo na etapa

  // Meta
  description    String?
  lostReason     String?
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  pipeline     Pipeline      @relation(fields: [pipelineId], references: [id])
  stage        PipelineStage @relation(fields: [stageId], references: [id])
  contact      Contact       @relation(fields: [contactId], references: [id])
  owner        User          @relation(fields: [ownerId], references: [id])
  tasks        Task[]
  activities   Activity[]

  @@index([organizationId, pipelineId, stageId])
  @@index([organizationId, status])
  @@index([organizationId, ownerId])
}

enum DealStatus { OPEN WON LOST }

// ─── Tarefas ──────────────────────────────────────────────────────────────────

model Task {
  id             String     @id @default(cuid())
  organizationId String
  dealId         String?
  contactId      String?
  ownerId        String
  type           TaskType   // CALL | WHATSAPP | EMAIL | MEETING | VISIT | OTHER
  title          String
  description    String?
  dueAt          DateTime?
  completedAt    DateTime?
  createdAt      DateTime   @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  deal         Deal?        @relation(fields: [dealId], references: [id], onDelete: SetNull)
  contact      Contact?     @relation(fields: [contactId], references: [id])
  owner        User         @relation(fields: [ownerId], references: [id])

  @@index([organizationId, ownerId, dueAt])
  @@index([organizationId, dealId])
}

enum TaskType { CALL WHATSAPP EMAIL MEETING VISIT PROPOSAL NOTE OTHER }

// ─── Histórico de Atividades ──────────────────────────────────────────────────

model Activity {
  id             String       @id @default(cuid())
  organizationId String
  dealId         String?
  contactId      String?
  userId         String
  type           ActivityType // mesmo enum do Task
  body           String?      // texto da nota/mensagem
  createdAt      DateTime     @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  deal         Deal?        @relation(fields: [dealId], references: [id], onDelete: SetNull)
  contact      Contact?     @relation(fields: [contactId], references: [id])
  user         User         @relation(fields: [userId], references: [id])

  @@index([organizationId, dealId, createdAt])
}

enum ActivityType { NOTE EMAIL CALL WHATSAPP PROPOSAL MEETING VISIT }
```

---

## Etapas Padrão do Funil de Vendas

Ao criar uma nova organização, seed automático com essas etapas no pipeline "Funil de Vendas":

| Ordem | Nome | Cor |
|-------|------|-----|
| 1 | Prospecção | #6366f1 |
| 2 | Mensagem/Ligação | #8b5cf6 |
| 3 | No-show | #f59e0b |
| 4 | Remarketing | #f97316 |
| 5 | Visita Marcada | #06b6d4 |
| 6 | Em Análise | #3b82f6 |
| 7 | Quente | #10b981 |
| 8 | Extras | #64748b |

---

## Estrutura de Páginas e Rotas

```
app/
├── (auth)/
│   ├── login/page.tsx
│   └── register/page.tsx
│
├── (dashboard)/
│   ├── layout.tsx              ← sidebar + topbar
│   ├── page.tsx                ← Início: KPIs + atividades recentes
│   ├── tarefas/page.tsx        ← lista de tarefas do usuário
│   ├── pessoas/
│   │   ├── page.tsx            ← tabela de contatos com filtros
│   │   └── [id]/page.tsx       ← perfil do contato + deals vinculados
│   ├── empresas/
│   │   ├── page.tsx
│   │   └── [id]/page.tsx
│   ├── negocios/
│   │   ├── page.tsx            ← Kanban principal (pipeline view)
│   │   └── [id]/page.tsx       ← detalhe do negócio (screenshot referência)
│   ├── relatorios/page.tsx     ← funil de conversão, ranking de consultores
│   └── configuracoes/
│       ├── page.tsx            ← org settings
│       ├── pipeline/page.tsx   ← customizar etapas (drag-and-drop)
│       └── usuarios/page.tsx   ← gerenciar time
│
└── api/
    ├── auth/[...nextauth]/route.ts
    ├── deals/
    │   ├── route.ts            ← GET list, POST create
    │   └── [id]/
    │       ├── route.ts        ← GET, PUT, DELETE
    │       ├── move/route.ts   ← PATCH mover de etapa (atualiza stageId + stageEnteredAt)
    │       └── activities/route.ts
    ├── contacts/route.ts
    ├── companies/route.ts
    ├── tasks/route.ts
    ├── pipelines/
    │   └── [id]/stages/route.ts
    └── org/route.ts
```

---

## Página de Detalhe do Negócio (prioridade máxima de UI)

Baseado no screenshot do Agendor, deve ter:

**Topo:**
- Nome do negócio editável inline
- Status: `Perdido` | `Em andamento` | `Ganho` (botões)
- Contato vinculado (com link)
- Rating estrelas (1-5)
- Responsável

**Barra de progresso do pipeline:**
- Etapas clicáveis em sequência
- Etapa atual destacada + tempo nela (ex: "3d")

**Área principal (esquerda):**
- Tabs para registrar atividade: Nota | E-mail | Ligação | WhatsApp | Proposta | Reunião | Visita
- Textarea: "O que foi feito e qual o próximo passo?"
- Timeline de atividades (mais recente no topo)
- Cada item: ícone do tipo, texto, data, autor, checkbox "Finalizar" para tarefas

**Sidebar direita:**
- Ações rápidas: Enviar e-mail, Fazer ligação, Gerar proposta, Enviar WhatsApp
- Valor do negócio (R$)
- Dados do negócio: responsável, data início, data conclusão, descrição, WhatsApp
- Dados do contato: nome, email, celular

---

## Prioridade de Implementação

### Fase 1 — MVP (construir nessa ordem)
1. Setup do projeto (Next.js, Auth.js, Prisma, multi-tenant)
2. Auth: login/register + criação de organização
3. Schema completo + primeira migration
4. Pipeline/Kanban — listagem e drag-and-drop entre etapas
5. Criar/editar negócio
6. Detalhe do negócio com histórico de atividades
7. Cadastro de contatos (Pessoas)

### Fase 2
8. Tarefas com prazo e notificação
9. Empresas
10. Relatórios (funil de conversão, ranking)

### Fase 3
11. Customização de pipeline pelo admin
12. Gerenciamento de usuários/permissões
13. Automações

---

## Convenções de Código

- `export const dynamic = "force-dynamic"` em todas as route handlers
- Sem comentários óbvios — só quando o WHY não é evidente
- Sem `prisma migrate dev` — sempre `prisma migrate deploy`
- Tailwind v4 — dark mode por padrão
- TypeScript strict
- Sem otimismo no frontend a menos que a UX exija — preferir refetch real após mutação
- Rotas de API sempre validam `organizationId` da sessão antes de qualquer query

---

## Variáveis de Ambiente necessárias

```env
DATABASE_URL="postgresql://..."
NEXTAUTH_SECRET="..."
NEXTAUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="..."       # opcional, para OAuth Google
GOOGLE_CLIENT_SECRET="..."   # opcional
```

---

## Nome do Produto

**CRM** — nome definitivo a definir pelo usuário. Por enquanto usar "CRM" como placeholder nos textos da UI.