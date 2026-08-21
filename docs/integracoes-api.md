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
- `GET /api/v1/availability`: 60 requisições/minuto por chave.
- `POST /api/v1/appointments`: 30 requisições/minuto por chave.

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

```bash
curl -X GET https://api.seudominio.com/api/v1/members \
  -H "Authorization: Bearer crm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
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
- `active`: `false` quando o usuário foi desativado (desligado do time) — ainda aparece na lista pra manter negócios antigos legíveis, mas **filtre por `active: true` na sua interface** antes de deixar escolher um responsável. Mandar o `id` de um membro inativo em `ownerId` não quebra a chamada, mas o CRM ignora e devolve um aviso em `warnings` — melhor nem oferecer essa opção pra começo de conversa.
- `team`: `null` quando o membro não está em nenhuma equipe.
- `photoUrl`: `null` quando não tem foto cadastrada. Quando vem preenchido, é uma URL assinada que **expira em 1 hora** — não guarde/cacheie por muito tempo, busque de novo se precisar depois.

## `POST /api/v1/contacts`

Cria um contato novo ou **atualiza** um já existente com o mesmo telefone/
WhatsApp (nunca retorna erro de duplicata — pensado pra reenvio repetido do
mesmo lead). Só `name` é obrigatório pra criar; numa atualização, só os
campos enviados são alterados (o que não veio na chamada não é apagado).

`ownerId` (opcional) atribui um responsável ao contato — precisa ser o `id`
de um usuário **ativo** que já faz parte da organização (veja em
Configurações → Usuários). Um `ownerId` que não existe ou pertence a um
usuário **inativo** (desligado do time) **não derruba a chamada** — o
contato é criado/atualizado do mesmo jeito, sem responsável, e a resposta
avisa em `warnings` (veja abaixo). `name` é o **único** campo que de fato
bloqueia a criação se faltar.

**Responsável é "grudento" depois da primeira atribuição.** Isso é
intencional: se o contato já existe e já tem um responsável (seja porque
uma chamada anterior atribuiu, seja porque alguém atribuiu manualmente no
CRM), um reenvio externo com outro `ownerId` (ou com `ownerId: null`) **não
troca quem já está responsável** — a chamada segue criando/atualizando o
resto dos dados normalmente, só ignora essa parte, e avisa em `warnings`.
Isso existe pra um reenvio do mesmo lead (de outra lista, por engano, ou de
um sistema diferente) nunca "roubar" um lead que já está com outro vendedor
sem ninguém perceber. Só dá pra trocar o responsável de um contato que já
tem um pelo próprio CRM (ou pela ação em massa "Trocar responsável" na tela
de Clientes). `ownerId` só "pega" em duas situações: contato novo, ou
contato existente que ainda não tinha responsável nenhum.

`adAttribution` (opcional, objeto) — de qual anúncio/campanha esse lead
veio, pra alimentar o relatório de conversão por campanha (Relatórios →
Meta Ads). Genérico: não é exclusivo do webhook direto da Meta — se você
usa N8N, Make, Zapier ou qualquer automação pra puxar o lead (do Facebook,
Google Ads, TikTok Ads, o que for) e mandar pra cá, é só preencher esses
campos que o relatório funciona igual. Todos os subcampos são opcionais e
livres (string) — mande só o que fizer sentido pra sua automação:

```json
"adAttribution": {
  "campaignId": "1234567890",
  "campaignName": "Campanha Setembro - Consórcio",
  "adId": "9876543210",
  "adSetId": "5555555555",
  "formId": "1111111111"
}
```

**Request**

```bash
curl -X POST https://api.seudominio.com/api/v1/contacts \
  -H "Authorization: Bearer crm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
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
    "adAttribution": {
      "campaignId": "1234567890",
      "campaignName": "Campanha Setembro - Consórcio",
      "adId": "9876543210"
    },
    "customFields": {
      "campanha_id": "abc123",
      "orcamento_estimado": 5000
    }
  }'
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
    "adAttribution": {
      "campaignId": "1234567890",
      "campaignName": "Campanha Setembro - Consórcio",
      "adId": "9876543210",
      "adSetId": null,
      "formId": null
    },
    "createdAt": "2026-07-17T14:32:00.000Z",
    "outcome": "created",
    "warnings": []
  }
}
```

Exemplos de `warnings` — a chamada sempre continua, só o `ownerId` é ignorado:

```json
// ownerId não existe nesta organização
"warnings": ["ownerId \"xyz\" não corresponde a nenhum usuário desta organização — contato salvo sem responsável atribuído."]
```

```json
// ownerId existe, mas é de um usuário desativado
"warnings": ["ownerId \"xyz\" corresponde a um usuário inativo desta organização — contato salvo sem responsável atribuído."]
```

```json
// contato já existia e já tinha responsável — ownerId novo foi ignorado de propósito
"warnings": ["ownerId enviado foi ignorado — este contato já tem um responsável atribuído; reenvio externo não troca quem já está responsável (altere pelo CRM se for intencional)."]
```

## `POST /api/v1/contacts/bulk`

Mesmo formato de contato acima (incluindo `ownerId`) em lote, até 500 por
chamada. Processa e reporta item a item — um contato inválido não derruba
os outros, e cada item traz exatamente o que aconteceu com ele.

**Request**

```bash
curl -X POST https://api.seudominio.com/api/v1/contacts/bulk \
  -H "Authorization: Bearer crm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "contacts": [
      { "name": "Maria Silva", "phone": "67991234567", "source": "Lista fria - Julho" },
      { "name": "João Souza", "phone": "67998887777", "source": "Lista fria - Julho", "ownerId": "id-que-nao-existe" },
      { "phone": "67900000000" }
    ]
  }'
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
(`400`). `ownerId` opcional: sem ele (ou se o `ownerId` enviado não existir,
ou pertencer a um usuário inativo), atribui automaticamente ao vendedor com
menos negócios abertos no momento — nesses casos a resposta vem com um
aviso em `warnings`, mas o negócio é criado do mesmo jeito. Diferente de
contato, negócio é sempre criado do zero (nunca "atualiza" um existente),
então não existe a regra de responsável "grudento" aqui — cada chamada
decide o `ownerId` daquele negócio novo, sem herdar nada de negócios
anteriores.

`value` (valor líquido), `grossValue` (valor bruto — independente de
`value`, nunca calculado a partir dele), `name`, `creditType`, `description`
e `source`, quando enviados, precisam ser do tipo certo (`value`/
`grossValue` número, não-negativo; os demais, texto) — um tipo errado é
rejeitado com `400`, não vira erro genérico.

Mandando `contact` (contato novo), o `adAttribution` descrito em
`POST /api/v1/contacts` funciona igual aqui dentro do objeto `contact` — é
o jeito de já criar o negócio com o Contato marcado de qual anúncio ele
veio, tudo numa chamada só.

**Request** (contato novo, direto na mesma chamada)

```bash
curl -X POST https://api.seudominio.com/api/v1/deals \
  -H "Authorization: Bearer crm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "contact": { "name": "Maria Silva", "phone": "67991234567", "source": "Facebook Ads" },
    "value": 350000,
    "grossValue": 380000,
    "creditType": "Imóvel"
  }'
```

**Request** (contato já existente)

```bash
curl -X POST https://api.seudominio.com/api/v1/deals \
  -H "Authorization: Bearer crm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "contactId": "cm...",
    "pipelineId": "cm...",
    "stageId": "cm...",
    "value": 350000
  }'
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
    "grossValue": 380000,
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

## Agendamento de reunião

Pensado pra landing page externa de captação de leads (Meta Ads): depois de
criar o contato (`POST /api/v1/contacts`) e o negócio (`POST /api/v1/deals`),
a última etapa do formulário deixa o lead escolher um horário de reunião com
o consultor responsável. Dois passos: `GET /api/v1/availability` pra
mostrar a grade, `POST /api/v1/appointments` pra reservar.

**Grade fixa por consultor, por dia útil (segunda a sexta):**

| Horário | 
|---|
| 08:30 |
| 10:00 |
| 11:30 |
| 13:00 |
| 14:30 |

5 horários fixos, de 1h30 em 1h30 a partir das 08:30 (a reunião em si dura
20-30min — o resto do intervalo é folga do consultor pra prospectar outros
leads ou absorver um no-show). Timezone: `America/Campo_Grande` (fuso de
Mato Grosso do Sul, UTC-4 — **não** é o mesmo fuso de São Paulo/UTC-3,
mesmo os dois sendo "horário do Brasil"; todo horário devolvido pela API já
está nesse fuso).

**Como funciona a cascata de dias:** a API nunca oferece o mesmo dia (regra
de negócio pra reduzir no-show — o lead só marca pro **próximo dia útil**).
Ela sempre olha primeiro pro próximo dia útil a partir de agora; se esse dia
já não tem mais nenhum dos 5 horários livres (todos ocupados ou em
conflito), ela passa pro dia útil seguinte, e assim por diante, até achar um
dia com pelo menos 1 horário livre — só esse dia é devolvido. Se seu
formulário mostrar "sem vaga" depois que o lead demorou muito pra preencher,
chame `GET /api/v1/availability` de novo: a grade pode ter mudado.

Um horário é considerado ocupado se já existe uma reunião reservada pra
aquele consultor naquele exato horário (nesta API ou marcada direto no
Google Agenda dele, quando ele tem uma conta conectada).

### `GET /api/v1/availability?consultorId={id}`

`consultorId` é o `id` do consultor (mesmo `id` de `GET /api/v1/members`) —
precisa ser um usuário ativo desta organização.

**Request**

```bash
curl -X GET "https://api.seudominio.com/api/v1/availability?consultorId=cm..." \
  -H "Authorization: Bearer crm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

**Response**

```json
{
  "success": true,
  "data": {
    "consultorId": "cm...",
    "date": "2026-08-17",
    "timezone": "America/Campo_Grande",
    "slots": [
      { "time": "08:30", "available": true },
      { "time": "10:00", "available": false },
      { "time": "11:30", "available": true },
      { "time": "13:00", "available": true },
      { "time": "14:30", "available": true }
    ],
    "googleCalendarConnected": true
  }
}
```

`googleCalendarConnected: false` significa que o consultor ainda não
conectou o Google Agenda dele no CRM — os horários mostrados continuam
válidos (checados só contra as reuniões já marcadas por aqui), só não
levam em conta compromissos que ele tenha marcado direto no Google.

**Erros:** `401` (chave inválida/revogada), `404` (`consultorId` não existe
ou não pertence a esta organização).

### `POST /api/v1/appointments`

Reserva um dos horários devolvidos por `GET /api/v1/availability`. Assim
como `/api/v1/deals`, aceita `contactId` (contato já existente) **ou**
`contact` (mesmo formato de `/api/v1/contacts` — cria/atualiza o contato na
mesma chamada). `dealId` é opcional — se vier, a reunião fica vinculada a
esse negócio.

`date`/`time` são **revalidados no servidor** — a API nunca confia que um
horário que apareceu como `available: true` num `GET` anterior ainda está
livre agora (dois leads podem escolher o mesmo horário ao mesmo tempo). Se
o horário não estiver mais livre no momento da reserva, a resposta é `409`
com `error: "slot_unavailable"` — chame `GET /api/v1/availability` de novo
pra pegar a grade atualizada e deixe o lead escolher outro horário.

**Request**

```bash
curl -X POST https://api.seudominio.com/api/v1/appointments \
  -H "Authorization: Bearer crm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "consultorId": "cm...",
    "date": "2026-08-17",
    "time": "08:30",
    "contact": { "name": "Maria Silva", "phone": "67991234567", "source": "Facebook Ads" }
  }'
```

**Response** (`201`)

```json
{
  "success": true,
  "data": {
    "taskId": "cm...",
    "contactId": "cm...",
    "dealId": null,
    "scheduledAt": "2026-08-17T12:30:00.000Z",
    "googleCalendarSynced": true
  }
}
```

`scheduledAt` vem em UTC (`Z`), igual todo outro timestamp desta API —
`12:30:00.000Z` é exatamente `08:30` em `America/Campo_Grande` (UTC-4).
`googleCalendarSynced: false` significa que a reunião foi reservada
normalmente (`taskId` sempre é retornado), mas não deu pra criar o evento
no Google Agenda do consultor nessa hora (token revogado, API do Google
fora do ar, ou o consultor não tem conexão) — a reserva **não é perdida**
por causa disso, só não aparece automaticamente no Google dele.

**Erros:**
- `400` — corpo inválido, `date`/`time` fora da grade (ou anteriores ao
  próximo dia útil), `consultorId`/`contactId`/`dealId` mal formados.
- `404` — `consultorId` não existe ou não pertence a esta organização.
- `409` com `error: "slot_unavailable"` — o horário escolhido não está mais
  livre; peça a grade de novo.

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

**Exemplo para `deal.lost`:**
```json
{
  "event": "deal.lost",
  "timestamp": "2026-07-17T15:00:00.000Z",
  "data": {
    "id": "cm...",
    "name": "07/26 - Maria Silva FACEBOOK ADS",
    "status": "LOST",
    "value": 350000,
    "closedAt": "2026-07-17T15:00:00.000Z",
    "contact": { "id": "cm...", "name": "Maria Silva", "phone": "67991234567", "email": null },
    "owner": { "id": "cm...", "name": "Vendedor" },
    "stage": { "id": "cm...", "name": "Fechamento" },
    "lossReason": "Sem interesse no momento"
  }
}
```

**Exemplo para `contact.created`:**
O `data` deste webhook é o mesmo formato retornado na resposta de `POST /api/v1/contacts`.
```json
{
  "event": "contact.created",
  "timestamp": "2026-07-17T14:32:00.000Z",
  "data": {
    "id": "cm...",
    "name": "Maria Silva",
    "phone": "67991234567",
    "source": "Facebook Ads",
    "ownerId": "cm...",
    "createdAt": "2026-07-17T14:32:00.000Z"
  }
}
```

### Validando a assinatura

O secret é mostrado uma única vez na criação do webhook — guarde-o. Para garantir que o webhook veio do CRM, você deve validar o header `X-CRM-Signature`. O payload usado deve ser o **corpo cru (raw body) exato recebido**, antes de qualquer parse/serialização JSON da sua linguagem.

**Node.js / JavaScript**
```javascript
const crypto = require("crypto");

function isValid(rawBody, signatureHeader, secret) {
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}
```

**Python**
```python
import hmac
import hashlib

def is_valid(raw_body: bytes, signature_header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode('utf-8'),
        raw_body,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature_header, expected)
```

**PHP**
```php
function isValid($rawBody, $signatureHeader, $secret) {
    $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $secret);
    return hash_equals($expected, $signatureHeader);
}
```

Responda `2xx` pra confirmar o recebimento — qualquer outro status (ou
timeout de 10s) conta como falha e entra na fila de retry.
