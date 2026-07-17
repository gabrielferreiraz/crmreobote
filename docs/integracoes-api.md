# Integrações externas — API v1 e webhooks

Documentação pra quem for conectar um gerador de leads, lista fria, outro
CRM ou uma automação (Make/Zapier) ao CRM. As chaves de API e os webhooks são
criados em **Configurações → Integrações** (só Dono/Gerente).

## Autenticação

Toda rota `/api/v1/*` exige uma API key da organização no header:

```
Authorization: Bearer crm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

A chave é mostrada **uma única vez** na criação — se perder, revogue e crie
outra. Não existe recuperação.

## Limites

- `GET /api/v1/members`: 60 requisições/minuto por chave.
- `POST /api/v1/contacts`: 60 requisições/minuto por chave.
- `POST /api/v1/contacts/bulk`: 10 requisições/minuto por chave (até 500 contatos por chamada).
- `POST /api/v1/deals`: 30 requisições/minuto por chave.

Ao estourar, a resposta é `429` com header `Retry-After` (segundos).

## Formato de resposta

Toda resposta de `/api/v1` segue o mesmo envelope:

```json
{ "success": true, "data": { ... } }
```

```json
{ "success": false, "error": "mensagem em português", "details": [ "opcional" ] }
```

Status HTTP usados: `200`/`201` sucesso, `400` validação, `401` chave
inválida/revogada, `404` recurso referenciado não existe, `429` limite de
requisições.

---

## `GET /api/v1/members`

Lista os membros do time da organização — pensado pra você montar, no seu
próprio sistema, um seletor de "responsável" sem precisar abrir o CRM.
Só leitura, sem corpo de requisição. Devolve tudo que é seguro mostrar fora
daqui (nunca senha nem nada de autenticação) — pegue só os campos que
interessam pro seu caso, ignore o resto.

O `id` de cada membro é exatamente o valor que você usa em `ownerId` ao
criar/atualizar um contato (`POST /api/v1/contacts`) ou um negócio
(`POST /api/v1/deals`).

**Request**

```
GET /api/v1/members
Authorization: Bearer crm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Response**

```json
{
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
}
```

- `role`: `OWNER` (dono), `MANAGER` (gerente), `SUPERVISOR` (supervisor de uma equipe) ou `MEMBER` (consultor/vendedor).
- `active`: `false` quando o usuário foi desativado (desligado do time) — ainda aparece na lista pra manter negócios antigos legíveis, mas não deve receber novas atribuições.
- `team`: `null` quando o membro não está em nenhuma equipe.
- `photoUrl`: `null` quando não tem foto cadastrada. Quando vem preenchido, é uma URL assinada que **expira em 1 hora** — não guarde/cacheie por muito tempo, busque de novo se precisar depois.

## `POST /api/v1/contacts`

Cria um contato novo ou **atualiza** um já existente com o mesmo telefone/
WhatsApp (nunca retorna erro de duplicata — pensado pra reenvio repetido do
mesmo lead). Só `name` é obrigatório pra criar; numa atualização, só os
campos enviados são alterados (o que não veio na chamada não é apagado).

`ownerId` (opcional) atribui um responsável ao contato — precisa ser o `id`
de um usuário que já faz parte da organização (veja em Configurações →
Usuários). Enviar `ownerId: null` remove o responsável atual. Um `ownerId`
que não existe **não derruba a chamada** — o contato é criado/atualizado do
mesmo jeito, sem responsável, e a resposta avisa em `warnings` (veja abaixo).
`name` é o **único** campo que de fato bloqueia a criação se faltar.

**Request**

```json
{
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
}
```

**Response** (`201` se criou, `200` se atualizou) — devolve o registro completo salvo,
pra você confirmar exatamente o que ficou gravado, mais `warnings` (lista vazia
quando está tudo certo) explicando qualquer coisa que não pôde ser aplicada
sem impedir a criação:

```json
{
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
    "address": null,
    "addressNumber": null,
    "addressComplement": null,
    "neighborhood": null,
    "city": "Campo Grande",
    "state": "MS",
    "zipCode": null,
    "tags": ["lead-quente", "facebook"],
    "ownerId": "cm...",
    "customFields": { "campanha_id": "abc123", "orcamento_estimado": 5000 },
    "createdAt": "2026-07-17T14:32:00.000Z",
    "outcome": "created",
    "warnings": []
  }
}
```

Se o `ownerId` enviado não existir, a mesma chamada continua criando o
contato normalmente (`outcome: "created"`), só que com `ownerId: null` e:

```json
"warnings": ["ownerId \"xyz\" não corresponde a nenhum usuário desta organização — contato salvo sem responsável atribuído."]
```

## `POST /api/v1/contacts/bulk`

Mesmo formato de contato acima (incluindo `ownerId`) em lote, até 500 por
chamada. Processa e reporta item a item — um contato inválido não derruba
os outros, e cada item traz exatamente o que aconteceu com ele.

**Request**

```json
{
  "contacts": [
    { "name": "Maria Silva", "phone": "67991234567", "source": "Lista fria - Julho" },
    { "name": "João Souza", "phone": "67998887777", "source": "Lista fria - Julho", "ownerId": "id-que-nao-existe" },
    { "phone": "67900000000" }
  ]
}
```

**Response**

```json
{
  "success": true,
  "data": {
    "summary": { "total": 3, "created": 2, "updated": 0, "errors": 1, "warnings": 1 },
    "results": [
      { "index": 0, "status": "created", "id": "cm..." },
      {
        "index": 1,
        "status": "created",
        "id": "cm...",
        "warnings": ["ownerId \"id-que-nao-existe\" não corresponde a nenhum usuário desta organização — contato salvo sem responsável atribuído."]
      },
      { "index": 2, "status": "error", "error": "Campo 'name' é obrigatório para criar um contato novo" }
    ]
  }
}
```

`summary.warnings` conta quantos itens tiveram algum aviso (mesmo tendo sido
criados/atualizados com sucesso) — use isso pra saber quantos leads precisam
de uma olhada, mesmo sem erro nenhum.

## `POST /api/v1/deals`

Cria um negócio. Aceita `contactId` (contato já existente) **ou** `contact`
(mesmo formato de `/api/v1/contacts` — cria/atualiza o contato na mesma
chamada). `pipelineId`/`stageId` são opcionais, mas **precisam vir juntos**:
sem os dois, usa a pipeline padrão da organização e a primeira etapa dela;
mandar só um dos dois é tratado como se nenhum tivesse vindo (o outro é
ignorado) e a resposta avisa em `warnings`. `stageId` também precisa
pertencer de fato à `pipelineId` informada, senão a chamada é rejeitada
(`400`). `ownerId` opcional: sem ele (ou se o `ownerId` enviado não existir),
atribui automaticamente ao vendedor com menos negócios abertos no momento —
nesse segundo caso a resposta vem com um aviso em `warnings`, mas o negócio
é criado do mesmo jeito.

`value`, `name`, `creditType`, `description` e `source`, quando enviados,
precisam ser do tipo certo (`value` número; os demais, texto) — um tipo
errado é rejeitado com `400`, não vira erro genérico.

**Request** (contato novo, direto na mesma chamada)

```json
{
  "contact": { "name": "Maria Silva", "phone": "67991234567", "source": "Facebook Ads" },
  "value": 350000,
  "creditType": "Imóvel"
}
```

**Request** (contato já existente)

```json
{
  "contactId": "cm...",
  "pipelineId": "cm...",
  "stageId": "cm...",
  "value": 350000
}
```

**Response** (`201`) — também completa, com `warnings`:

```json
{
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
}
```

---

## Webhooks de saída

Ao criar uma assinatura de webhook (Configurações → Integrações), você
recebe uma URL de destino e escolhe os eventos:

- `contact.created` — um contato novo foi criado (manual, importação ou via `/api/v1/contacts`).
- `deal.won` — um negócio foi marcado como ganho.
- `deal.lost` — um negócio foi marcado como perdido.

O CRM não entrega na hora exata do evento — enfileira e entrega no próximo
ciclo (até ~1-2 minutos depois), com retry automático em caso de falha
(backoff: 1min, 5min, 30min, 2h, 6h — desiste após 5 tentativas).

### Requisição que você recebe

```
POST <sua URL>
Content-Type: application/json
X-CRM-Event: deal.won
X-CRM-Delivery: cm...
X-CRM-Signature: sha256=<hmac hex>
```

```json
{
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
}
```

Pra `contact.created`, `data` é o mesmo formato do `data` de resposta de
`POST /api/v1/contacts`.

### Validando a assinatura (Node.js)

O secret é mostrado uma única vez na criação do webhook — guarde-o.

```js
const crypto = require("crypto");

function isValid(rawBody, signatureHeader, secret) {
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}

// rawBody precisa ser a string exata recebida, antes de qualquer JSON.parse.
```

Responda `2xx` pra confirmar o recebimento — qualquer outro status (ou
timeout de 10s) conta como falha e entra na fila de retry.
