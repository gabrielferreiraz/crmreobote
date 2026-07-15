import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "Documentação da API — CRM",
  description: "Autenticação, endpoints de ingestão e webhooks de saída para integrações externas.",
};

const NAV_ITEMS = [
  { id: "autenticacao", label: "Autenticação" },
  { id: "limites", label: "Limites" },
  { id: "resposta", label: "Formato de resposta" },
  { id: "contatos", label: "POST /api/v1/contacts" },
  { id: "contatos-lote", label: "POST /api/v1/contacts/bulk" },
  { id: "negocios", label: "POST /api/v1/deals" },
  { id: "webhooks", label: "Webhooks de saída" },
  { id: "assinatura", label: "Validando a assinatura" },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      <header className="sticky top-0 z-10 border-b border-neutral-200/60 bg-white/80 backdrop-blur-md dark:border-neutral-800/60 dark:bg-neutral-950/80">
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

      <div className="mx-auto flex max-w-6xl gap-8 px-4 py-8 sm:px-6">
        <nav className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20 space-y-1">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="block rounded-md px-2.5 py-1.5 text-sm text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100"
              >
                {item.label}
              </a>
            ))}
          </div>
        </nav>

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

          <Section id="autenticacao" title="Autenticação">
            <P>
              Toda rota <Code>/api/v1/*</Code> exige uma API key da organização no header:
            </P>
            <CodeBlock>{`Authorization: Bearer crm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</CodeBlock>
            <P>
              A chave é mostrada <strong className="font-medium">uma única vez</strong> na criação — se perder,
              revogue e crie outra. Não existe recuperação.
            </P>
          </Section>

          <Section id="limites" title="Limites">
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-neutral-600 dark:text-neutral-300">
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
            <CodeBlock>{`{ "success": true, "data": { ... } }`}</CodeBlock>
            <CodeBlock>{`{ "success": false, "error": "mensagem em português", "details": [ "opcional" ] }`}</CodeBlock>
            <P>
              Status HTTP usados: <Code>200</Code>/<Code>201</Code> sucesso, <Code>400</Code> validação,{" "}
              <Code>401</Code> chave inválida/revogada, <Code>404</Code> recurso referenciado não existe,{" "}
              <Code>429</Code> limite de requisições.
            </P>
          </Section>

          <Section id="contatos" title="POST /api/v1/contacts">
            <P>
              Cria um contato novo ou <strong className="font-medium">atualiza</strong> um já existente com o mesmo
              telefone/WhatsApp (nunca retorna erro de duplicata — pensado pra reenvio repetido do mesmo lead). Só{" "}
              <Code>name</Code> é obrigatório pra criar; numa atualização, só os campos enviados são alterados (o
              que não veio na chamada não é apagado).
            </P>
            <SubHeading>Request</SubHeading>
            <CodeBlock>{`{
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
  "customFields": {
    "campanha_id": "abc123",
    "orcamento_estimado": 5000
  }
}`}</CodeBlock>
            <SubHeading>
              Response (<Code>201</Code> se criou, <Code>200</Code> se atualizou)
            </SubHeading>
            <CodeBlock>{`{
  "success": true,
  "data": {
    "id": "cm...",
    "name": "Maria Silva",
    "email": "maria@exemplo.com",
    "phone": "67991234567",
    "whatsapp": "67991234567",
    "outcome": "created"
  }
}`}</CodeBlock>
          </Section>

          <Section id="contatos-lote" title="POST /api/v1/contacts/bulk">
            <P>
              Mesmo formato de contato acima, em lote (até 500 por chamada). Processa e reporta item a item — um
              contato inválido não derruba os outros.
            </P>
            <SubHeading>Request</SubHeading>
            <CodeBlock>{`{
  "contacts": [
    { "name": "Maria Silva", "phone": "67991234567", "source": "Lista fria - Julho" },
    { "name": "João Souza", "phone": "67998887777", "source": "Lista fria - Julho" },
    { "phone": "67900000000" }
  ]
}`}</CodeBlock>
            <SubHeading>Response</SubHeading>
            <CodeBlock>{`{
  "success": true,
  "data": {
    "summary": { "total": 3, "created": 2, "updated": 0, "errors": 1 },
    "results": [
      { "index": 0, "status": "created", "id": "cm..." },
      { "index": 1, "status": "created", "id": "cm..." },
      { "index": 2, "status": "error", "error": "Campo 'name' é obrigatório para criar um contato novo" }
    ]
  }
}`}</CodeBlock>
          </Section>

          <Section id="negocios" title="POST /api/v1/deals">
            <P>
              Cria um negócio. Aceita <Code>contactId</Code> (contato já existente) <strong className="font-medium">ou</strong>{" "}
              <Code>contact</Code> (mesmo formato de <Code>/api/v1/contacts</Code> — cria/atualiza o contato na mesma
              chamada). <Code>pipelineId</Code>/<Code>stageId</Code> são opcionais: sem eles, usa a pipeline padrão
              da organização e a primeira etapa dela. <Code>ownerId</Code> opcional: sem ele, atribui
              automaticamente ao vendedor com menos negócios abertos no momento.
            </P>
            <SubHeading>Request (contato novo, direto na mesma chamada)</SubHeading>
            <CodeBlock>{`{
  "contact": { "name": "Maria Silva", "phone": "67991234567", "source": "Facebook Ads" },
  "value": 350000,
  "creditType": "Imóvel"
}`}</CodeBlock>
            <SubHeading>Request (contato já existente)</SubHeading>
            <CodeBlock>{`{
  "contactId": "cm...",
  "pipelineId": "cm...",
  "stageId": "cm...",
  "value": 350000
}`}</CodeBlock>
            <SubHeading>
              Response (<Code>201</Code>)
            </SubHeading>
            <CodeBlock>{`{
  "success": true,
  "data": {
    "id": "cm...",
    "name": "07/26 - Maria Silva FACEBOOK ADS",
    "status": "OPEN",
    "value": 350000,
    "contact": { "id": "cm...", "name": "Maria Silva" },
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
            <CodeBlock>{`POST <sua URL>
Content-Type: application/json
X-CRM-Event: deal.won
X-CRM-Delivery: cm...
X-CRM-Signature: sha256=<hmac hex>`}</CodeBlock>
            <CodeBlock>{`{
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
            <CodeBlock>{`const crypto = require("crypto");

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

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      {children}
    </section>
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

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="scrollbar-thin overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3.5 text-[13px] leading-relaxed text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
      <code className="font-mono">{children}</code>
    </pre>
  );
}
