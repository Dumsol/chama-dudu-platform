# Chama Dudu (Nuxt 3)

## Setup

```bash
pnpm install
pnpm exec playwright install chromium
```

## Dev

```bash
pnpm dev
```

## Build + Preview

```bash
pnpm build
pnpm preview
```

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Env vars

```bash
NUXT_PUBLIC_WHATSAPP_URL=
NUXT_PUBLIC_CITY_LABEL=
NUXT_PUBLIC_GOOGLE_MAPS_API_KEY=
NUXT_PUBLIC_DEFAULT_TENANT_ID=
NUXT_PUBLIC_API_BASE_URL=
ADMIN_PASSWORD=
DEPOSIT_TOKEN_SALT=
OPS_ADMIN_API_KEY=
```

## Operating areas (mapa)

- Edite `apps/web/data/operating-areas.json` com `id`, `name`, `lat`, `lng`.
- O mapa em `/onde-funciona` usa apenas esse arquivo.

## Admin e deposito

- Rotas ocultas recomendadas:
  - Admin: `/_ops/admin-login`
  - Deposito: `/_ops/deposito-login`
- Rotas legadas (`/admin/login` e `/deposito/login`) redirecionam para as ocultas.
- O landing publico nao expõe links de login operacional.

## War Room + Mini dashboard

- Admin `/admin` consome:
  - `/api/admin/war-room/overview`
  - `/api/admin/war-room/refresh`
- Deposito `/deposito` consome:
  - `/api/deposito/dashboard`
- As chamadas externas usam proxy server-side (`src/server/utils/opsApi.ts`) para nao expor `OPS_ADMIN_API_KEY` no browser.

## Impressao de pedido

1. Criar pedido: `POST /api/orders`.
2. Abrir `http://localhost:3000/imprimir/{orderId}?w=58` (ou `w=80`).
3. Usar o botao "Imprimir" na pagina.

## Teste visual (Playwright + pixelmatch)

- `pnpm test` executa:
  - screenshot 1440x900 da home em `tests/screenshots/current.png`
  - diff em `tests/screenshots/diff.png`
- Reference: `tests/screenshots/reference.png` (mockup redimensionado para 1440px e recortado no topo).
- Threshold do pixelmatch: `0.05`.
- Limite: renderizacao pode variar por SO/driver; alinhar fontes e viewport antes de comparar.
