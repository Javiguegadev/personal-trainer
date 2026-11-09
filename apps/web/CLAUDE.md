# apps/web — Next.js 16 App Router + Tailwind 4

- Route groups: `app/(marketing)` public pages (SEO), `app/(app)` authenticated app.
- Data: Server Components call `@pt/api-client` directly; Client Components use the TanStack Query hooks
  from `@pt/api-client`. Never query the DB or call Claude from here.
- Logic that mobile will also need (formatting, derived numbers, form schemas) goes in `@pt/core`,
  `@pt/contracts` or `@pt/api-client`, not in this app.
- Copy: `@pt/i18n` only. Colors: Tailwind theme tokens in `app/globals.css` (mirror `@pt/ui` tokens).
- Every data view handles loading, empty and error states. Mobile-first layouts.
- shadcn/ui components go in `components/ui` (init with `pnpm dlx shadcn@latest init` in Phase 2).
- Verify UI changes with the Playwright MCP (navigate, snapshot, check the console) before saying done.
