# Rifa Master v2 — Frontend + API segura

Implementação das melhorias de segurança, reservas atômicas, webhook PIX, sorteio auditável e recursos operacionais **sem mudança de identidade visual**.

## Estrutura

```
rifa-master/
├── index.html              # UI (mesmo visual) + lógica aprimorada
├── js/api.js               # Cliente HTTP do backend
├── sw.js / manifest.json   # PWA
├── firebase.rules.json     # Regras RTDB (escrita só via Admin SDK)
└── backend/
    ├── server.js
    ├── routes/api.js
    ├── middleware/auth.js
    ├── services/{firebase,reserve,payment,draw}.js
    ├── package.json
    └── .env.example
```

## O que foi implementado

### Segurança
- Access Token Mercado Pago **não sai mais do servidor**
- Login admin via `POST /api/admin/login` → JWT (fallback PIN local se API offline)
- Secrets vazios no “Salvar” **não sobrescrevem** token/PIN existentes
- Regras Firebase de exemplo: leitura pública, escrita bloqueada no client

### Reservas e pagamentos
- `POST /api/reserve` e `/api/reserve-donation` com checagem de disponibilidade
- Limite `maxCotasPorPessoa` (configurável no admin)
- Cron a cada 2 min libera reservas e doações pendentes expiradas
- PIX: criação e check-status sem token no body do browser
- Webhook `POST /api/webhook/mercadopago` marca cotas `paid` pelo `external_reference`
- Cupom/desconto gravados na cota quando reserva via API

### UX / performance (visual preservado)
- Paginação da grelha (200 cotas/página)
- Badge “Quase esgotado” acima de 90%
- Overlay de loading discreto
- Debounce na busca do admin
- WhatsApp do organizador configurável
- Campo descrição da campanha no admin
- Expiração de doação pendente (dias)
- Listeners PWA duplicados removidos
- H1 de teste e meta/title duplicados removidos

### Admin
- Sorteio preferencialmente no servidor (hash SHA-256 auditável)
- Endpoints: confirm, delete, reset, draw, export CSV, stats, save-config

## Deploy backend (Render)

1. Novo Web Service a partir da pasta `backend/`
2. Build: `npm install`
3. Start: `node server.js`
4. Variáveis: copiar de `.env.example`
5. Firebase: gerar service account e colar `FIREBASE_PRIVATE_KEY` com `\n`
6. No painel MP: webhook → `https://SEU-BACKEND.onrender.com/api/webhook/mercadopago`
7. Atualizar `BACKEND_URL` no `index.html` se a URL mudar

## Deploy frontend

- Hospedar `index.html`, `manifest.json`, `sw.js` e pasta `img/` (HTTPS obrigatório para PWA)
- Apontar `const BACKEND_URL = "..."` no script do `index.html`

## Migração gradual

O frontend tenta a API primeiro e **faz fallback** para Firebase direto se o backend falhar (compatível com ambiente atual).  
Quando o backend e as regras Firebase estiverem ativos, o fallback deixa de gravar (`.write: false`).

## Config nova no painel Admin → Ajustes

| Campo | Uso |
|--------|-----|
| Descrição | Texto da campanha |
| WhatsApp organizador | Links flutuante / doação / ajuda |
| Máx. cotas / pessoa | 0 = ilimitado |
| Expiração doação (dias) | Limpa `donated_pending` no cron |

## Testes rápidos

```bash
cd backend && npm install
# configure .env
npm start
curl http://localhost:3000/api/health
```

## Observações

- `js/api.js` é o contrato HTTP documentado; o `index.html` ainda embute a lógica principal (mesmo visual, deploy simples em hospedagem estática).
- Após ativar regras restritivas, **obrigatório** o backend com Admin SDK.
- Altere `JWT_SECRET` e `DRAW_SALT` em produção.
