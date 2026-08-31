import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { getServerAPIUrl } from '@services/config/config'

// Never statically cache the gate result: an ISR-cached 404 from a flaky
// instance/info fetch during revalidation would poison the whole hub route
// group with random 404s for the revalidate window.
export const dynamic = 'force-dynamic'

interface InstanceSurface {
  mode: string | null
  tenancy: 'multi' | 'single' | null
}

// Acyberschool deliberately supports native multi tenancy without requiring
// the optional upstream EE package. The hub therefore exists whenever the
// backend reports tenancy=multi, regardless of whether mode is saas/ee/oss.
async function getInstanceSurface(): Promise<InstanceSurface> {
  try {
    const res = await fetch(`${getServerAPIUrl()}instance/info`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return { mode: null, tenancy: null }
    const info = await res.json()
    return {
      mode: typeof info?.mode === 'string' ? info.mode : null,
      tenancy: info?.tenancy === 'multi' || info?.tenancy === 'single' ? info.tenancy : null,
    }
  } catch {
    return { mode: null, tenancy: null }
  }
}

export default async function HubLayout({ children }: { children: ReactNode }) {
  const surface = await getInstanceSurface()
  if (surface.tenancy === 'single' && (surface.mode === 'oss' || surface.mode === 'ee')) notFound()
  return <>{children}</>
}
