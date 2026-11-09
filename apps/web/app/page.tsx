import { createApiClient } from '@pt/api-client';
import { defaultLocale, messages } from '@pt/i18n';

export const dynamic = 'force-dynamic';

const t = messages[defaultLocale];

async function getApiStatus() {
  const api = createApiClient({
    baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787',
  });
  try {
    const health = await api.health();
    return { ok: true as const, version: health.version };
  } catch {
    return { ok: false as const };
  }
}

export default async function HomePage() {
  const status = await getApiStatus();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16">
      <h1 className="text-4xl font-bold tracking-tight">{t.app.name}</h1>
      <p className="text-lg text-neutral-600">{t.app.tagline}</p>

      <nav className="flex flex-wrap gap-2">
        {Object.values(t.nav).map((label) => (
          <span key={label} className="rounded-full bg-white px-3 py-1 text-sm shadow-sm">
            {label}
          </span>
        ))}
      </nav>

      <p className="text-sm" data-testid="api-status">
        API:{' '}
        {status.ok ? (
          <span className="font-medium text-brand">online (v{status.version})</span>
        ) : (
          <span className="font-medium text-fat">offline</span>
        )}
      </p>
    </main>
  );
}
