# CRM â€” Briefing Completo para ImplementaÃ§Ã£o

## Contexto e Objetivo

Construir um CRM SaaS profissional, separado do SenderWhats, com foco inicial em equipes de vendas de consÃ³rcio. O produto deve ser escalÃ¡vel o suficiente para ser vendido para outras empresas no futuro.

ReferÃªncia visual: Agendor CRM / Datacrazy.

---

## DecisÃµes Arquiteturais (jÃ¡ definidas â€” nÃ£o questionar)

### Multi-tenancy
- **`organizationId` em todas as tabelas** + Row Level Security no PostgreSQL
- Cada empresa (organizaÃ§Ã£o) vÃª apenas seus prÃ³prios dados
- Ã‰ o modelo usado por Pipedrive, HubSpot, Salesforce

### AutenticaÃ§Ã£o
- **Auth.js v5 (NextAuth)** â€” gratuito, open source, sem limite de usuÃ¡rios
- Suporte a email/senha e OAuth (Google)
- SessÃ£o baseada em JWT

### Stack
- **Next.js 15+ App Router** (force-dynamic nas rotas de API)
- **TypeScript** â€” strict mode
- **Prisma 7 + PostgreSQL**
- **Tailwind CSS v4** â€” dark mode por padrÃ£o
- **Projeto separado** â€” diretÃ³rio prÃ³prio, nÃ£o dentro do SenderWhats

### Regras de migraÃ§Ã£o
- NUNCA usar `prisma migrate dev` contra banco remoto
- Sempre usar `prisma migrate deploy` para aplicar no banco de produÃ§Ã£o

---

## Entidades e Schema Prisma

```prisma
// â”€â”€â”€ Multi-tenancy root â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ UsuÃ¡rios â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Pipeline (Funil) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  name       String   // "ProspecÃ§Ã£o", "Mensagem/LigaÃ§Ã£o", "No-show", etc.
  order      Int
  color      String?  // hex color para UI
  createdAt  DateTime @default(now())

  pipeline Pipeline @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  deals    Deal[]

  @@index([pipelineId, order])
}

// â”€â”€â”€ Contatos e Empresas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  source         String?   // "FACEBOOK", "INSTAGRAM", "INDICAÃ‡ÃƒO", etc.
  createdAt      DateTime  @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  company      Company?     @relation(fields: [companyId], references: [id])
  deals        Deal[]

  @@index([organizationId])
  @@index([organizationId, phone])
}

// â”€â”€â”€ NegÃ³cio (Deal) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

model Deal {
  id             String     @id @default(cuid())
  organizationId String
  pipelineId     String
  stageId        String
  contactId      String
  ownerId        String     // User responsÃ¡vel

  // IdentificaÃ§Ã£o
  name           String     // auto: "06/26 - Lucia Moura FACEBOOK"
  status         DealStatus @default(OPEN)  // OPEN | WON | LOST

  // Financeiro
  value          Decimal?   @db.Decimal(12, 2)  // Valor da carta de crÃ©dito

  // Campos especÃ­ficos de consÃ³rcio
  creditType     String?    // "IMÃ“VEL" | "VEÃCULO" | "OUTROS"

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

// â”€â”€â”€ Tarefas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

model Task {
  id             String     @id @default(cuid())
  organizationId String
  dealId         String?
  contactId      String?
  ownerId        String
  type           TaskType   // CALL | WHATSAPP | EMAIL | VIDEO_CALL | VISIT | OTHER
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

enum TaskType { CALL WHATSAPP EMAIL VIDEO_CALL VISIT PROPOSAL NOTE OTHER }

// â”€â”€â”€ HistÃ³rico de Atividades â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

enum ActivityType { NOTE EMAIL CALL WHATSAPP PROPOSAL VIDEO_CALL VISIT }
```

---

## Etapas PadrÃ£o do Funil de Vendas

Ao criar uma nova organizaÃ§Ã£o, seed automÃ¡tico com essas etapas no pipeline "Funil de Vendas":

| Ordem | Nome | Cor |
|-------|------|-----|
| 1 | ProspecÃ§Ã£o | #6366f1 |
| 2 | Mensagem/LigaÃ§Ã£o | #8b5cf6 |
| 3 | No-show | #f59e0b |
| 4 | Remarketing | #f97316 |
| 5 | Visita Marcada | #06b6d4 |
| 6 | Em AnÃ¡lise | #3b82f6 |
| 7 | Quente | #10b981 |
| 8 | Extras | #64748b |

---

## Estrutura de PÃ¡ginas e Rotas

```
app/
â”œâ”€â”€ (auth)/
â”‚   â”œâ”€â”€ login/page.tsx
â”‚   â””â”€â”€ register/page.tsx
â”‚
â”œâ”€â”€ (dashboard)/
â”‚   â”œâ”€â”€ layout.tsx              â† sidebar + topbar
â”‚   â”œâ”€â”€ page.tsx                â† InÃ­cio: KPIs + atividades recentes
â”‚   â”œâ”€â”€ tarefas/page.tsx        â† lista de tarefas do usuÃ¡rio
â”‚   â”œâ”€â”€ pessoas/
â”‚   â”‚   â”œâ”€â”€ page.tsx            â† tabela de contatos com filtros
â”‚   â”‚   â””â”€â”€ [id]/page.tsx       â† perfil do contato + deals vinculados
â”‚   â”œâ”€â”€ empresas/
â”‚   â”‚   â”œâ”€â”€ page.tsx
â”‚   â”‚   â””â”€â”€ [id]/page.tsx
â”‚   â”œâ”€â”€ negocios/
â”‚   â”‚   â”œâ”€â”€ page.tsx            â† Kanban principal (pipeline view)
â”‚   â”‚   â””â”€â”€ [id]/page.tsx       â† detalhe do negÃ³cio (screenshot referÃªncia)
â”‚   â”œâ”€â”€ relatorios/page.tsx     â† funil de conversÃ£o, ranking de consultores
â”‚   â””â”€â”€ configuracoes/
â”‚       â”œâ”€â”€ page.tsx            â† org settings
â”‚       â”œâ”€â”€ pipeline/page.tsx   â† customizar etapas (drag-and-drop)
â”‚       â””â”€â”€ usuarios/page.tsx   â† gerenciar time
â”‚
â””â”€â”€ api/
    â”œâ”€â”€ auth/[...nextauth]/route.ts
    â”œâ”€â”€ deals/
    â”‚   â”œâ”€â”€ route.ts            â† GET list, POST create
    â”‚   â””â”€â”€ [id]/
    â”‚       â”œâ”€â”€ route.ts        â† GET, PUT, DELETE
    â”‚       â”œâ”€â”€ move/route.ts   â† PATCH mover de etapa (atualiza stageId + stageEnteredAt)
    â”‚       â””â”€â”€ activities/route.ts
    â”œâ”€â”€ contacts/route.ts
    â”œâ”€â”€ companies/route.ts
    â”œâ”€â”€ tasks/route.ts
    â”œâ”€â”€ pipelines/
    â”‚   â””â”€â”€ [id]/stages/route.ts
    â””â”€â”€ org/route.ts
```

---

## PÃ¡gina de Detalhe do NegÃ³cio (prioridade mÃ¡xima de UI)

Baseado no screenshot do Agendor, deve ter:

**Topo:**
- Nome do negÃ³cio editÃ¡vel inline
- Status: `Perdido` | `Em andamento` | `Ganho` (botÃµes)
- Contato vinculado (com link)
- Rating estrelas (1-5)
- ResponsÃ¡vel

**Barra de progresso do pipeline:**
- Etapas clicÃ¡veis em sequÃªncia
- Etapa atual destacada + tempo nela (ex: "3d")

**Ãrea principal (esquerda):**
- Tabs para registrar atividade: Nota | E-mail | LigaÃ§Ã£o | WhatsApp | Proposta | ReuniÃ£o | Visita
- Textarea: "O que foi feito e qual o prÃ³ximo passo?"
- Timeline de atividades (mais recente no topo)
- Cada item: Ã­cone do tipo, texto, data, autor, checkbox "Finalizar" para tarefas

**Sidebar direita:**
- AÃ§Ãµes rÃ¡pidas: Enviar e-mail, Fazer ligaÃ§Ã£o, Gerar proposta, Enviar WhatsApp
- Valor do negÃ³cio (R$)
- Dados do negÃ³cio: responsÃ¡vel, data inÃ­cio, data conclusÃ£o, descriÃ§Ã£o, WhatsApp
- Dados do contato: nome, email, celular

---

## Prioridade de ImplementaÃ§Ã£o

### Fase 1 â€” MVP (construir nessa ordem)
1. Setup do projeto (Next.js, Auth.js, Prisma, multi-tenant)
2. Auth: login/register + criaÃ§Ã£o de organizaÃ§Ã£o
3. Schema completo + primeira migration
4. Pipeline/Kanban â€” listagem e drag-and-drop entre etapas
5. Criar/editar negÃ³cio
6. Detalhe do negÃ³cio com histÃ³rico de atividades
7. Cadastro de contatos (Pessoas)

### Fase 2
8. Tarefas com prazo e notificaÃ§Ã£o
9. Empresas
10. RelatÃ³rios (funil de conversÃ£o, ranking)

### Fase 3
11. CustomizaÃ§Ã£o de pipeline pelo admin
12. Gerenciamento de usuÃ¡rios/permissÃµes
13. AutomaÃ§Ãµes

---

## ConvenÃ§Ãµes de CÃ³digo

- `export const dynamic = "force-dynamic"` em todas as route handlers
- Sem comentÃ¡rios Ã³bvios â€” sÃ³ quando o WHY nÃ£o Ã© evidente
- Sem `prisma migrate dev` â€” sempre `prisma migrate deploy`
- Tailwind v4 â€” dark mode por padrÃ£o
- TypeScript strict
- Sem otimismo no frontend a menos que a UX exija â€” preferir refetch real apÃ³s mutaÃ§Ã£o
- Rotas de API sempre validam `organizationId` da sessÃ£o antes de qualquer query

---

## VariÃ¡veis de Ambiente necessÃ¡rias

```env
DATABASE_URL="postgresql://..."
NEXTAUTH_SECRET="..."
NEXTAUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="..."       # opcional, para OAuth Google
GOOGLE_CLIENT_SECRET="..."   # opcional
```

---

## Nome do Produto

**CRM** â€” nome definitivo a definir pelo usuÃ¡rio. Por enquanto usar "CRM" como placeholder nos textos da UI.