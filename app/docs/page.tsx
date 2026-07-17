import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { CodeBlock } from "./code-block";
import { DocsSidebar, DocsMobileNav } from "./docs-nav";

export const metadata: Metadata = {
  title: "Documentação da API — CRM",
  description: "Autenticação, endpoints de ingestão e webhooks de saída para integrações externas.",
};

const NAV_ITEMS = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "autenticacao", label: "Autenticação" },
  { id: "limites", label: "Limites" },
  { id: "resposta", label: "Formato de resposta" },
  { id: "membros", label: "Membros do time" },
  { id: "contatos", label: "Contatos" },
  { id: "contatos-lote", label: "Contatos (lote)" },
  { id: "negocios", label: "Negócios" },
  { id: "webhooks", label: "Webhooks de saída" },
  { id: "assinatura", label: "Validando a assinatura" },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      <header className="sticky top-0 z-20 border-b border-neutral-200/60 bg-white/80 backdrop-blur-md dark:border-neutral-800/60 dark:bg-neutral-950/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-neutral-900 text-xs font-semibold text-white dark:bg-white dark:text-neutral-900">
              C
            </div>
            <span className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">CRM</span>
            <span className="text-sm text-neutral-400 dark:text-neutral-500">/ Documentação da API</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              Ir para o painel
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <DocsMobileNav items={NAV_ITEMS} />

      <div className="mx-auto flex max-w-6xl gap-8 px-4 py-8 sm:px-6">
        <DocsSidebar items={NAV_ITEMS} />

        <main className="min-w-0 flex-1 space-y-10 pb-24">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              Integrações externas
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-neutral-500 dark:text-neutral-400">
              Documentação pra quem for conectar um gerador de leads, lista fria, outro CRM ou uma automação
              (Make/Zapier) a este CRM. As chaves de API e os webhooks são criados em{" "}
              <strong className="font-medium text-neutral-700 dark:text-neutral-300">
                Configurações → Integrações
              </strong>{" "}
              (acesso restrito a Dono/Gerente).
            </p>
          </div>

          <Section id="visao-geral" title="Visão geral">
            <P>Três peças, independentes uma da outra — use só o que precisar:</P>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-neutral-600 dark:text-neutral-300">
              <li>
                <strong className="font-medium text-neutral-800 dark:text-neutral-200">Entrada de dados</strong> —
                sua ferramenta manda contatos/negócios pra cá via <Code>POST /api/v1/*</Code>, autenticado por chave
                de API.
              </li>
              <li>
                <strong className="font-medium text-neutral-800 dark:text-neutral-200">Saída de eventos</strong> —
                o CRM avisa sua URL via webhook quando um negócio é ganho/perdido ou um contato é criado.
              </li>
              <li>
                <strong className="font-medium text-neutral-800 dark:text-neutral-200">Ambos</strong> — ex.: um lead
                cai por <Code>POST /api/v1/deals</Code> e, quando fecha venda, você recebe o webhook{" "}
                <Code>deal.won</Code> de volta.
              </li>
            </ol>
          </Section>

          <Section id="autenticacao" title="Autenticação">
            <P>
              Toda rota <Code>/api/v1/*</Code> exige uma API key da organização no header:
            </P>
            <CodeBlock lang="http">{`Authorization: Bearer crm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</CodeBlock>
            <P>
              A chave é mostrada <strong className="font-medium">uma única vez</strong> na criação — se perder,
              revogue e crie outra. Não existe recuperação.
            </P>
          </Section>

          <Section id="limites" title="Limites">
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-neutral-600 dark:text-neutral-300">
              <li>
                <Code>GET /api/v1/members</Code>: 60 requisições/minuto por chave.
              </li>
              <li>
                <Code>POST /api/v1/contacts</Code>: 60 requisições/minuto por chave.
              </li>
              <li>
                <Code>POST /api/v1/contacts/bulk</Code>: 10 requisições/minuto por chave (até 500 contatos por
                chamada).
              </li>
              <li>
                <Code>POST /api/v1/deals</Code>: 30 requisições/minuto por chave.
              </li>
            </ul>
            <P>
              Ao estourar, a resposta é <Code>429</Code> com header <Code>Retry-After</Code> (segundos).
            </P>
          </Section>

          <Section id="resposta" title="Formato de resposta">
            <P>Toda resposta de /api/v1 segue o mesmo envelope:</P>
            <CodeBlock lang="json">{`{ "success": true, "data": { ... } }`}</CodeBlock>
            <CodeBlock lang="json">{`{ "success": false, "error": "mensagem em português", "details": [ "opcional" ] }`}</CodeBlock>
            <P>
              Status HTTP usados: <Code>200</Code>/<Code>201</Code> sucesso, <Code>400</Code> validação,{" "}
              <Code>401</Code> chave inválida/revogada, <Code>404</Code> recurso referenciado não existe,{" "}
              <Code>429</Code> limite de requisições.
            </P>
          </Section>

          <Section id="membros" title="Membros do time" endpoint={{ method: "GET", path: "/api/v1/members" }}>
            <P>
              Lista os membros do time da organização — pensado pra você montar, no seu próprio sistema, um seletor
              de &quot;responsável&quot; sem precisar abrir o CRM. Só leitura, sem corpo de requisição. Devolve tudo
              que é seguro mostrar fora daqui (nunca senha nem nada de autenticação) — pegue só os campos que
              interessam pro seu caso, ignore o resto.
            </P>
            <P>
              O <Code>id</Code> de cada membro é exatamente o valor que você usa em <Code>ownerId</Code> ao
              criar/atualizar um contato ou um negócio.
            </P>
            <SubHeading>Request</SubHeading>
            <CodeBlock lang="http">{`GET /api/v1/members
Authorization: Bearer crm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</CodeBlock>
            <SubHeading>Response</SubHeading>
            <CodeBlock lang="json">{`{
  "success": true,
  "data": {
    "members": [
      {
        "id": "cm...",
        "name": "Vendedor Escolhido",
        "email": "vendedor@empresa.com",
        "role": "MEMBER",
        "active": true,
        "team": { "id": "cm...", "name": "Equipe Centro" },
        "photoUrl": "https://.../avatars/....jpg?X-Amz-Signature=...",
        "memberSince": "2026-01-10T12:00:00.000Z"
      },
      {
        "id": "cm...",
        "name": "Gerente da Conta",
        "email": "gerente@empresa.com",
        "role": "MANAGER",
        "active": true,
        "team": null,
        "photoUrl": null,
        "memberSince": "2025-11-02T09:00:00.000Z"
      }
    ]
  }
}`}</CodeBlock>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-neutral-600 dark:text-neutral-300">
              <li>
                <Code>role</Code>: <Code>OWNER</Code> (dono), <Code>MANAGER</Code> (gerente), <Code>SUPERVISOR</Code>{" "}
                (supervisor de uma equipe) ou <Code>MEMBER</Code> (consultor/vendedor).
              </li>
              <li>
                <Code>active</Code>: <Code>false</Code> quando o usuário foi desativado (desligado do time) — ainda
                aparece na lista pra manter negócios antigos legíveis, mas{" "}
                <strong className="font-medium">filtre por active: true na sua interface</strong> antes de deixar
                escolher um responsável. Mandar o <Code>id</Code> de um membro inativo em <Code>ownerId</Code> não
                quebra a chamada, mas o CRM ignora e devolve um aviso em <Code>warnings</Code> — melhor nem oferecer
                essa opção pra começo de conversa.
              </li>
              <li>
                <Code>team</Code>: <Code>null</Code> quando o membro não está em nenhuma equipe.
              </li>
              <li>
                <Code>photoUrl</Code>: <Code>null</Code> quando não tem foto cadastrada. Quando vem preenchido, é uma
                URL assinada que <strong className="font-medium">expira em 1 hora</strong> — não guarde/cacheie por
                muito tempo, busque de novo se precisar depois.
              </li>
            </ul>
          </Section>

          <Section id="contatos" title="Contatos" endpoint={{ method: "POST", path: "/api/v1/contacts" }}>
            <P>
              Cria um contato novo ou <strong className="font-medium">atualiza</strong> um já existente com o mesmo
              telefone/WhatsApp (nunca retorna erro de duplicata — pensado pra reenvio repetido do mesmo lead). Só{" "}
              <Code>name</Code> é obrigatório pra criar; numa atualização, só os campos enviados são alterados (o
              que não veio na chamada não é apagado).
            </P>
            <P>
              <Code>ownerId</Code> (opcional) atribui um responsável ao contato — precisa ser o <Code>id</Code> de um
              usuário <strong className="font-medium">ativo</strong> que já faz parte da organização. Um{" "}
              <Code>ownerId</Code> que não existe ou pertence a um usuário{" "}
              <strong className="font-medium">inativo</strong> (desligado do time){" "}
              <strong className="font-medium">não derruba a chamada</strong> — o contato é criado/atualizado do
              mesmo jeito, sem responsável, e a resposta avisa em <Code>warnings</Code>. <Code>name</Code> é o único
              campo que de fato bloqueia a criação se faltar.
            </P>
            <P>
              <strong className="font-medium">Responsável é &quot;grudento&quot; depois da primeira atribuição.</strong>{" "}
              Se o contato já existe e já tem um responsável (seja porque uma chamada anterior atribuiu, seja porque
              alguém atribuiu manualmente no CRM), um reenvio externo com outro <Code>ownerId</Code> (ou com{" "}
              <Code>ownerId: null</Code>) <strong className="font-medium">não troca quem já está responsável</strong>{" "}
              — o resto dos dados é atualizado normalmente, só essa parte é ignorada, com aviso em{" "}
              <Code>warnings</Code>. Isso existe pra um reenvio do mesmo lead (de outra lista, por engano, ou de um
              sistema diferente) nunca &quot;roubar&quot; um lead que já está com outro vendedor sem ninguém
              perceber. Só dá pra trocar o responsável de um contato que já tem um pelo próprio CRM (ou pela ação em
              massa &quot;Trocar responsável&quot; na tela de Clientes). <Code>ownerId</Code> só &quot;pega&quot; em
              duas situações: contato novo, ou contato existente que ainda não tinha responsável nenhum.
            </P>
            <SubHeading>Request</SubHeading>
            <CodeBlock lang="json">{`{
  "name": "Maria Silva",
  "email": "maria@exemplo.com",
  "phone": "67991234567",
  "whatsapp": "67991234567",
  "source": "Facebook Ads",
  "company": "Empresa X",
  "jobTitle": "Gerente",
  "city": "Campo Grande",
  "state": "MS",
  "tags": ["lead-quente", "facebook"],
  "ownerId": "cm...",
  "customFields": {
    "campanha_id": "abc123",
    "orcamento_estimado": 5000
  }
}`}</CodeBlock>
            <SubHeading>
              Response (<Code>201</Code> se criou, <Code>200</Code> se atualizou)
            </SubHeading>
            <P>
              Devolve o registro completo salvo, pra confirmar exatamente o que ficou gravado, mais{" "}
              <Code>warnings</Code> (lista vazia quando está tudo certo).
            </P>
            <CodeBlock lang="json">{`{
  "success": true,
  "data": {
    "id": "cm...",
    "name": "Maria Silva",
    "email": "maria@exemplo.com",
    "phone": "67991234567",
    "whatsapp": "67991234567",
    "source": "Facebook Ads",
    "company": "Empresa X",
    "jobTitle": "Gerente",
    "city": "Campo Grande",
    "state": "MS",
    "tags": ["lead-quente", "facebook"],
    "ownerId": "cm...",
    "customFields": { "campanha_id": "abc123", "orcamento_estimado": 5000 },
    "createdAt": "2026-07-17T14:32:00.000Z",
    "outcome": "created",
    "warnings": []
  }
}`}</CodeBlock>
            <P>
              Exemplos de <Code>warnings</Code> — a chamada sempre continua, só o <Code>ownerId</Code> é ignorado:
            </P>
            <CodeBlock lang="json">{`// ownerId não existe nesta organização
"warnings": ["ownerId \\"xyz\\" não corresponde a nenhum usuário desta organização — contato salvo sem responsável atribuído."]`}</CodeBlock>
            <CodeBlock lang="json">{`// ownerId existe, mas é de um usuário desativado
"warnings": ["ownerId \\"xyz\\" corresponde a um usuário inativo desta organização — contato salvo sem responsável atribuído."]`}</CodeBlock>
            <CodeBlock lang="json">{`// contato já existia e já tinha responsável — ownerId novo foi ignorado de propósito
"warnings": ["ownerId enviado foi ignorado — este contato já tem um responsável atribuído; reenvio externo não troca quem já está responsável (altere pelo CRM se for intencional)."]`}</CodeBlock>
          </Section>

          <Section
            id="contatos-lote"
            title="Contatos (lote)"
            endpoint={{ method: "POST", path: "/api/v1/contacts/bulk" }}
          >
            <P>
              Mesmo formato de contato acima (incluindo <Code>ownerId</Code>) em lote, até 500 por chamada. Processa
              e reporta item a item — um contato inválido não derruba os outros, e cada item traz exatamente o que
              aconteceu com ele.
            </P>
            <SubHeading>Request</SubHeading>
            <CodeBlock lang="json">{`{
  "contacts": [
    { "name": "Maria Silva", "phone": "67991234567", "source": "Lista fria - Julho" },
    { "name": "João Souza", "phone": "67998887777", "source": "Lista fria - Julho", "ownerId": "id-que-nao-existe" },
    { "phone": "67900000000" }
  ]
}`}</CodeBlock>
            <SubHeading>Response</SubHeading>
            <CodeBlock lang="json">{`{
  "success": true,
  "data": {
    "summary": { "total": 3, "created": 2, "updated": 0, "errors": 1, "warnings": 1 },
    "results": [
      { "index": 0, "status": "created", "id": "cm..." },
      {
        "index": 1,
        "status": "created",
        "id": "cm...",
        "warnings": ["ownerId \\"id-que-nao-existe\\" não corresponde a nenhum usuário desta organização — contato salvo sem responsável atribuído."]
      },
      { "index": 2, "status": "error", "error": "Campo 'name' é obrigatório para criar um contato novo" }
    ]
  }
}`}</CodeBlock>
            <P>
              <Code>summary.warnings</Code> conta quantos itens tiveram algum aviso (mesmo tendo sido criados com
              sucesso) — use isso pra saber quantos leads precisam de uma olhada, mesmo sem erro nenhum.
            </P>
          </Section>

          <Section id="negocios" title="Negócios" endpoint={{ method: "POST", path: "/api/v1/deals" }}>
            <P>
              Cria um negócio. Aceita <Code>contactId</Code> (contato já existente) <strong className="font-medium">ou</strong>{" "}
              <Code>contact</Code> (mesmo formato de <Code>/api/v1/contacts</Code> — cria/atualiza o contato na mesma
              chamada). <Code>pipelineId</Code>/<Code>stageId</Code> são opcionais, mas precisam vir{" "}
              <strong className="font-medium">juntos</strong>: sem os dois, usa a pipeline padrão da organização e a
              primeira etapa dela; mandar só um dos dois é ignorado (o outro também) e a resposta avisa em{" "}
              <Code>warnings</Code>. <Code>stageId</Code> também precisa pertencer de fato à{" "}
              <Code>pipelineId</Code> informada, senão a chamada é rejeitada (<Code>400</Code>).{" "}
              <Code>ownerId</Code> opcional: sem ele (ou se o <Code>ownerId</Code> enviado não existir, ou pertencer
              a um usuário inativo), atribui automaticamente ao vendedor com menos negócios abertos no momento —
              nesses casos a resposta vem com um aviso em <Code>warnings</Code>, mas o negócio é criado do mesmo
              jeito. Diferente de contato, negócio é sempre criado do zero (nunca &quot;atualiza&quot; um existente),
              então não existe a regra de responsável &quot;grudento&quot; aqui — cada chamada decide o{" "}
              <Code>ownerId</Code> daquele negócio novo, sem herdar nada de negócios anteriores.
            </P>
            <P>
              <Code>value</Code>, <Code>name</Code>, <Code>creditType</Code>, <Code>description</Code> e{" "}
              <Code>source</Code>, quando enviados, precisam ser do tipo certo (<Code>value</Code> número; os
              demais, texto) — tipo errado é rejeitado com <Code>400</Code>, nunca vira erro genérico.
            </P>
            <SubHeading>Request (contato novo, direto na mesma chamada)</SubHeading>
            <CodeBlock lang="json">{`{
  "contact": { "name": "Maria Silva", "phone": "67991234567", "source": "Facebook Ads" },
  "value": 350000,
  "creditType": "Imóvel"
}`}</CodeBlock>
            <SubHeading>Request (contato já existente)</SubHeading>
            <CodeBlock lang="json">{`{
  "contactId": "cm...",
  "pipelineId": "cm...",
  "stageId": "cm...",
  "value": 350000
}`}</CodeBlock>
            <SubHeading>
              Response (<Code>201</Code>)
            </SubHeading>
            <CodeBlock lang="json">{`{
  "success": true,
  "data": {
    "id": "cm...",
    "name": "07/26 - Maria Silva FACEBOOK ADS",
    "status": "OPEN",
    "value": 350000,
    "creditType": "Imóvel",
    "description": null,
    "pipelineId": "cm...",
    "createdAt": "2026-07-17T14:32:00.000Z",
    "warnings": [],
    "contact": { "id": "cm...", "name": "Maria Silva", "phone": "67991234567", "whatsapp": null },
    "owner": { "id": "cm...", "name": "Vendedor Escolhido" },
    "stage": { "id": "cm...", "name": "Novo lead" }
  }
}`}</CodeBlock>
          </Section>

          <Section id="webhooks" title="Webhooks de saída">
            <P>
              Ao criar uma assinatura de webhook (Configurações → Integrações), você recebe uma URL de destino e
              escolhe os eventos:
            </P>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-neutral-600 dark:text-neutral-300">
              <li>
                <Code>contact.created</Code> — um contato novo foi criado (manual, importação ou via{" "}
                <Code>/api/v1/contacts</Code>).
              </li>
              <li>
                <Code>deal.won</Code> — um negócio foi marcado como ganho.
              </li>
              <li>
                <Code>deal.lost</Code> — um negócio foi marcado como perdido.
              </li>
            </ul>
            <P>
              O CRM não entrega na hora exata do evento — enfileira e entrega no próximo ciclo (até ~1-2 minutos
              depois), com retry automático em caso de falha (backoff: 1min, 5min, 30min, 2h, 6h — desiste após 5
              tentativas).
            </P>
            <SubHeading>Requisição que você recebe</SubHeading>
            <CodeBlock lang="http">{`POST <sua URL>
Content-Type: application/json
X-CRM-Event: deal.won
X-CRM-Delivery: cm...
X-CRM-Signature: sha256=<hmac hex>`}</CodeBlock>
            <CodeBlock lang="json">{`{
  "event": "deal.won",
  "timestamp": "2026-07-17T14:32:00.000Z",
  "data": {
    "id": "cm...",
    "name": "07/26 - Maria Silva FACEBOOK ADS",
    "status": "WON",
    "value": 350000,
    "closedAt": "2026-07-17T14:32:00.000Z",
    "contact": { "id": "cm...", "name": "Maria Silva", "phone": "67991234567", "email": null },
    "owner": { "id": "cm...", "name": "Vendedor" },
    "stage": { "id": "cm...", "name": "Fechamento" },
    "lossReason": null
  }
}`}</CodeBlock>
            <P>
              Pra <Code>contact.created</Code>, <Code>data</Code> é o mesmo formato do <Code>data</Code> de resposta
              de <Code>POST /api/v1/contacts</Code>.
            </P>
          </Section>

          <Section id="assinatura" title="Validando a assinatura (Node.js)">
            <P>O secret é mostrado uma única vez na criação do webhook — guarde-o.</P>
            <CodeBlock lang="js">{`const crypto = require("crypto");

function isValid(rawBody, signatureHeader, secret) {
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}

// rawBody precisa ser a string exata recebida, antes de qualquer JSON.parse.`}</CodeBlock>
            <P>
              Responda <Code>2xx</Code> pra confirmar o recebimento — qualquer outro status (ou timeout de 10s)
              conta como falha e entra na fila de retry.
            </P>
          </Section>
        </main>
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  endpoint,
  children,
}: {
  id: string;
  title: string;
  endpoint?: { method: string; path: string };
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-32 space-y-3 lg:scroll-mt-20">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
        {endpoint && (
          <div className="flex items-center gap-1.5 font-mono text-[13px]">
            <MethodBadge method={endpoint.method} />
            <span className="text-neutral-500 dark:text-neutral-400">{endpoint.path}</span>
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

function MethodBadge({ method }: { method: string }) {
  const isGet = method === "GET";
  return (
    <span
      className={
        isGet
          ? "rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-400"
          : "rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
      }
    >
      {method}
    </span>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-1 text-xs font-medium tracking-wide text-neutral-400 uppercase dark:text-neutral-500">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[13px] text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
      {children}
    </code>
  );
}
