import type { Metadata } from 'next'
import AdminProviders from './providers'
import React from 'react'
import { getServerAPIUrl } from '@services/config/config'
import EERequiredScreen from '@components/Security/EERequiredScreen'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: {
    template: '%s | Acyberschool Admin',
    default: 'Acyberschool Admin',
  },
}

async function platformAdminAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${getServerAPIUrl()}instance/info`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return true
    const info = await res.json()
    // Native Acyberschool multi tenancy has its own superadmin API and does not
    // require the optional upstream EE package.
    if (info?.tenancy === 'multi') return true
    return info?.mode === 'saas' || info?.mode === 'ee'
  } catch {
    // Fail open here for availability. Every operator API call still performs
    // the authoritative server side is_superadmin check.
    return true
  }
}

export default async function AdminRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (!(await platformAdminAvailable())) {
    return <EERequiredScreen />
  }

  return <AdminProviders>{children}</AdminProviders>
}
