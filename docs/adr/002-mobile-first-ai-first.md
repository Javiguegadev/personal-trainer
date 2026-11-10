# ADR 002: Mobile-first Expo universal app, AI-first features, fewer services

- Status: accepted
- Date: 2026-11-10
- Supersedes: parts of ADR 001 (web app, payments, background jobs)

## Context

Plan v1 launched a Next.js web app first and an Expo app months later. That meant writing screens twice,
for a product whose core actions (logging meals, logging sets, scanning barcodes) happen on a phone. It
also used about 12 external services and put AI features late, although AI is the main reason to pay and
the main way to make logging fast.

## Decision

1. **Single Expo Router universal app** (`apps/app`) for iOS, Android and web. The web build
   (`output: single`) launches first. SEO lives in a separate Astro landing created at launch.
2. **AI-first**: natural language, photos and dictation are the primary input methods. Claude Haiku 5.5
   for high-volume tasks, Claude Opus 5.5 for planning, coaching and adaptation.
3. **Grounded AI**: a curated knowledge base (official food databases, exercise databases, guidelines,
   study summaries) exposed to Claude through tools. No fine-tuning.
4. **Payments**: RevenueCat for in-app purchases and as the single entitlement source; Paddle for web
   checkout as merchant of record, linked through RevenueCat's Paddle integration.
5. **Fewer services**: drop Next.js, Fly.io, Stripe direct, Inngest and Upstash. Background jobs use
   Supabase Cron + Queues, and rate limits live in Postgres.
6. **Stages instead of a calendar**: work advances stage by stage when there is time.

## Consequences

- Screens are written once, and stores can be targeted at any point with EAS.
- The web app feels like an app rather than a website, which is acceptable because the landing handles SEO.
- Some native-only libraries need web fallbacks (`.web.tsx` files).
- Paddle charges more than Stripe (~5% + $0.50 vs ~1.5% + €0.25) but removes VAT filing and invoicing.
- RevenueCat's Paddle integration has limits (Paddle Billing only, one product per checkout) that must be
  checked before stage E6.
- Health data reaches Anthropic for AI features, so prompts minimize personal data and the privacy
  policy must say so.
