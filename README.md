<<<<<<< HEAD
This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
=======
# VL Cristal Piscinas & Cia

Sistema web completo para portal institucional, area administrativa e portal do cliente.

## Recursos

- Frontend responsivo em HTML, CSS e JavaScript.
- Backend Node.js com Express.
- SQLite com inicializacao automatica do schema e migration SQL complementar para Supabase.
- JWT para administradores e clientes.
- Senhas com hash bcrypt.
- APIs REST para clientes, ordens de servico, fotos, indicadores da agua e relatorios.
- Upload de fotos antes/depois por ordem de servico.
- Relatorio PDF tecnico semanal, mensal, por cliente ou por visita.
- Fila preparada para envio automatico do relatorio tecnico por WhatsApp.
- Estoque individual por cliente, com baixa vinculada a visita.
- Portal do cliente habilitado por cadastro e login preparado por SMS OTP.
- Dashboard com indicadores operacionais e alerta de estoque.
- Modo escuro opcional.

## Instalacao

```bash
npm install
cp .env.example .env
npm run dev
```

Abra `http://localhost:3000`.

## Acesso administrativo

- Usuario: `admin`
- Senha: valor de `ADMIN_PASSWORD` no `.env`.

Se `ADMIN_PASSWORD` nao for definido, o sistema usa `admin123` apenas para desenvolvimento.

## Portal do cliente

O cliente acessa com telefone celular e codigo SMS OTP. A integracao com provedor de SMS ainda esta pendente; em desenvolvimento o codigo gerado e retornado pela API para teste. O cadastro do cliente precisa estar com `portal_habilitado` ativo.

## Supabase

Se o painel estiver usando Supabase pelo frontend, aplique a migration `migrations/supabase-client-stock-portal.sql` para criar as colunas e tabelas usadas pelo estoque por cliente, OTP e fila futura de WhatsApp.

## Deploy

### VPS Ubuntu

```bash
npm install --omit=dev
cp .env.example .env
HOST=0.0.0.0 npm start
```

Configure um proxy reverso Nginx apontando para a porta definida em `PORT`.

### Vercel

O arquivo `vercel.json` esta pronto. Na Vercel, o sistema usa `/tmp` para SQLite e uploads, o que serve para demonstracao, mas nao e persistente entre ciclos da funcao. Para producao com historico duravel, prefira VPS ou substitua o banco e os uploads por servicos gerenciados.
>>>>>>> 855552f (Atualizações do projeto VL)
