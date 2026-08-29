'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Buildings, MagnifyingGlass, Plus, Users, BookOpen, Globe } from '@phosphor-icons/react'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import CreateOrganizationModal from '@components/Admin/CreateOrganizationModal'
import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests'

interface Institution {
  id: number
  org_uuid: string
  name: string
  slug: string
  email: string
  description?: string | null
  managed_domain: string
  users_count: number
  courses_count: number
  custom_domains: Array<{ domain: string; status: string; primary: boolean }>
}

export default function OrganizationList() {
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token as string | undefined
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const query = useQuery({
    queryKey: ['platform-organizations', search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: '1', limit: '100' })
      if (search.trim()) params.set('search', search.trim())
      const res = await fetch(
        `${getAPIUrl()}platform/organizations?${params.toString()}`,
        RequestBodyWithAuthHeader('GET', null, { cache: 'no-store' }, token)
      )
      return errorHandling(res) as Promise<{ items: Institution[]; total: number }>
    },
    enabled: session?.status === 'authenticated' && Boolean(token),
    staleTime: 15_000,
  })

  const institutions = useMemo(() => query.data?.items || [], [query.data])

  return (
    <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#C51635]">Acyberschool operator</p>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-[#101418]">Institutions</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-black/45">Create, brand and administer every institutional classroom from one place.</p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#C51635] px-5 text-sm font-black text-white">
          <Plus size={16} weight="bold" /> Create institution
        </button>
      </div>

      <div className="mt-8 flex min-h-12 items-center gap-3 rounded-2xl border border-black/[0.08] bg-white px-4 shadow-sm">
        <MagnifyingGlass size={18} className="text-black/30" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search institutions" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </div>

      {query.isLoading ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((n) => <div key={n} className="h-56 animate-pulse rounded-[24px] bg-black/[0.04]" />)}
        </div>
      ) : query.error ? (
        <div className="mt-6 rounded-[24px] border border-red-100 bg-red-50 p-6 text-sm font-semibold text-red-700">Could not load institutions.</div>
      ) : institutions.length === 0 ? (
        <div className="mt-6 rounded-[24px] border border-dashed border-black/15 bg-white px-6 py-14 text-center">
          <Buildings size={36} className="mx-auto text-black/20" />
          <p className="mt-4 font-black">No institutions found.</p>
          <button onClick={() => setCreateOpen(true)} className="mt-4 text-sm font-black text-[#C51635]">Create the first institution</button>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {institutions.map((org) => (
            <Link key={org.id} href={`/admin/organizations/${org.id}`} className="group rounded-[24px] border border-black/[0.08] bg-white p-5 shadow-[0_12px_40px_rgba(11,38,61,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_50px_rgba(11,38,61,0.1)] sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0B263D] text-white"><Buildings size={22} /></span>
                <span className="rounded-full bg-[#F7F8FA] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-black/45">Institution</span>
              </div>
              <h2 className="mt-5 truncate text-xl font-black tracking-[-0.03em] text-[#101418]">{org.name}</h2>
              <div className="mt-2 flex items-center gap-2 text-xs text-black/40"><Globe size={14} /><span className="truncate">{org.managed_domain}</span></div>
              <div className="mt-5 grid grid-cols-2 gap-2 border-t border-black/[0.06] pt-4">
                <div className="rounded-xl bg-[#F7F8FA] p-3"><Users size={15} className="text-black/35" /><p className="mt-2 text-lg font-black">{org.users_count}</p><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-black/35">Users</p></div>
                <div className="rounded-xl bg-[#F7F8FA] p-3"><BookOpen size={15} className="text-black/35" /><p className="mt-2 text-lg font-black">{org.courses_count}</p><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-black/35">Courses</p></div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <CreateOrganizationModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
