# Onboarding Academy -> CRM

## Regra do CRM

- Novas contas `MEMBER` e `VENDAS` comecam bloqueadas por padrao. O Dono pode
  desligar a exigencia durante a criacao.
- Usuarios existentes, Donos, Gerentes, Supervisores e Administrativo ficam liberados.
- O CRM e liberado quando o consultor chega ao modulo de CRM na Academy.
- A alteracao posterior de papel ou area nunca cria um bloqueio retroativo.
- O Dono pode incluir um consultor de Vendas ja existente no treinamento em
  `Configuracoes > Usuarios > Editar usuario`. A tela de primeiro acesso passa
  a ser exibida e o CRM e bloqueado no proximo acesso ou atualizacao.
- No mesmo editor, o Dono pode retirar a exigencia. As duas mudancas ficam
  registradas na auditoria da organizacao.

## Chamada que a Academy deve fazer

Quando os pre-requisitos do modulo de CRM forem cumpridos, o backend da
Academy deve chamar:

```http
POST /api/academy/onboarding/unlock-crm
Authorization: Bearer <access_token OAuth opaco>
```

Nao ha corpo. O CRM identifica usuario e organizacao pelo token OAuth.

Resposta idempotente:

```json
{
  "unlocked": true,
  "status": "CRM_UNLOCKED"
}
```

Repetir a chamada e seguro. A Academy nao deve enviar `userId`, `organizationId`
ou confiar em informacao do navegador para liberar o acesso.

## Momento da chamada

A Academy continua sendo a unica dona do catalogo e da ordem dos modulos. Ela
deve chamar o endpoint quando sua propria regra indicar que o modulo de CRM
ficou disponivel, antes de exibir a primeira aula desse modulo.

## Erros

- `401`: token ausente, expirado ou revogado; renovar pelo fluxo OAuth.
- `429`: limite temporario; repetir com espera.
- `5xx`: repetir com backoff. A operacao e idempotente.

O Dono pode retirar a exigencia pelo editor do usuario em caso de contingencia.
