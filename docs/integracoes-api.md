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

## `POST /api/v1/contacts`

Cria um contato novo ou **atualiza** um já existente com o mesmo telefone/
WhatsApp (nunca retorna erro de duplicata — pensado pra reenvio repetido do
mesmo lead). Só `name` é obrigatório pra criar; numa atualização, só os
campos enviados são alterados (o que não veio na chamada não é apagado).

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
  "customFields": {
    "campanha_id": "abc123",
    "orcamento_estimado": 5000
  }
}
```

**Response** (`201` se criou, `200` se atualizou)

```json
{
  "success": true,
  "data": {
    "id": "cm...",
    "name": "Maria Silva",
    "email": "maria@exemplo.com",
    "phone": "67991234567",
    "whatsapp": "67991234567",
    "outcome": "created"
  }
}
```

## `POST /api/v1/contacts/bulk`

Mesmo formato de contato acima, em lote (até 500 por chamada). Processa e
reporta item a item — um contato inválido não derruba os outros.

**Request**

```json
{
  "contacts": [
    { "name": "Maria Silva", "phone": "67991234567", "source": "Lista fria - Julho" },
    { "name": "João Souza", "phone": "67998887777", "source": "Lista fria - Julho" },
    { "phone": "67900000000" }
  ]
}
```

**Response**

```json
{
  "success": true,
  "data": {
    "summary": { "total": 3, "created": 2, "updated": 0, "errors": 1 },
    "results": [
      { "index": 0, "status": "created", "id": "cm..." },
      { "index": 1, "status": "created", "id": "cm..." },
      { "index": 2, "status": "error", "error": "Campo 'name' é obrigatório para criar um contato novo" }
    ]
  }
}
```

## `POST /api/v1/deals`

Cria um negócio. Aceita `contactId` (contato já existente) **ou** `contact`
(mesmo formato de `/api/v1/contacts` — cria/atualiza o contato na mesma
chamada). `pipelineId`/`stageId` são opcionais: sem eles, usa a pipeline
padrão da organização e a primeira etapa dela. `ownerId` opcional: sem ele,
atribui automaticamente ao vendedor com menos negócios abertos no momento.

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

**Response** (`201`)

```json
{
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
