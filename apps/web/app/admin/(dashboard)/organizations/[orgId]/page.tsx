'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowSquareOut, BookOpen, Buildings, GearSix, Globe, UserPlus, Users } from '@phosphor-icons/react'
import toast from 'react-hot-toast'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
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
  custom_domains: Array<{ id: number; domain: string; status: string; primary: boolean }>
}

export default function InstitutionOperatorPage() {
  const params = useParams<{ orgId: string }>()
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token as string | undefined
  const [adminEmail, setAdminEmail] = useState('')
  const [assigning, setAssigning] = useState(false)

  const query = useQuery({
    queryKey: ['platform-organization', params.orgId],
    queryFn: async () => {
      const res = await fetch(
        `${getAPIUrl()}platform/organizations/${params.orgId}`,
        RequestBodyWithAuthHeader('GET', null, { cache: 'no-store' }, token)
      )
      return errorHandling(res) as Promise<Institution>
    },
    enabled: session?.status === 'authenticated' && Boolean(token) && Boolean(params.orgId),
  })

  const org = query.data

  const assignAdmin = async () => {
    if (!adminEmail.trim()) return
    setAssigning(true)
    try {
      const res = await fetch(
        `${getAPIUrl()}platform/organizations/${params.orgId}/admins`,
        RequestBodyWithAuthHeader('POST', { email: adminEmail.trim() }, null, token)
      )
      const result = await errorHandling(res)
      if (result.status === 'assigned') {
        toast.success('Institution administrator assigned.')
        setAdminEmail('')
        await query.refetch()
      } else {
        toast(result.message || 'This person needs an Acyberschool account first.')
      }
    } catch (error: any) {
      toast.error(error?.message || 'Could not assign this administrator.')
    } finally {
      setAssigning(false)
    }
  }

  if (query.isLoading) return <div className="mx-auto mt-12 h-96 max-w-6xl animate-pulse rounded-[28px] bg-black/[0.04]" />
  if (!org || query.error) return <div className="mx-auto max-w-4xl px-5 py-16 text-center font-black">Institution could not be loaded.</div>

  const classroom = getUriWithOrg(org.slug, '/')
  const dashboard = getUriWithOrg(org.slug, '/dash')
  const courses = getUriWithOrg(org.slug, '/dash/courses')
  const organisation = getUriWithOrg(org.slug, '/dash/org')

  return (
    <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
      <Link href="/admin/organizations" className="inline-flex items-center gap-2 text-sm font-bold text-black/45 hover:text-black/70"><ArrowLeft size={15} /> Institutions</Link>

      <section className="mt-6 overflow-hidden rounded-[28px] border border-black/[0.08] bg-white shadow-[0_16px_60px_rgba(11,38,61,0.06)]">
        <div className="bg-[#0B263D] px-6 py-8 text-white sm:px-8 sm:py-10">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#FF8A9E]">Institution classroom</p>
              <h1 className="mt-2 text-4xl font-black tracking-[-0.05em]">{org.name}</h1>
              {org.description && <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">{org.description}</p>}
            </div>
            <a href={classroom} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#C51635] px-5 text-sm font-black text-white">Open classroom <ArrowSquareOut size={15} /></a>
          </div>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-7 lg:grid-cols-4">
          <div className="rounded-2xl bg-[#F7F8FA] p-4"><Users size={18} className="text-black/35" /><p className="mt-3 text-2xl font-black">{org.users_count}</p><p className="text-xs font-bold text-black/40">Users</p></div>
          <div className="rounded-2xl bg-[#F7F8FA] p-4"><BookOpen size={18} className="text-black/35" /><p className="mt-3 text-2xl font-black">{org.courses_count}</p><p className="text-xs font-bold text-black/40">Courses</p></div>
          <div className="rounded-2xl bg-[#F7F8FA] p-4 sm:col-span-2"><Globe size={18} className="text-black/35" /><p className="mt-3 truncate text-base font-black">{org.managed_domain}</p><p className="text-xs font-bold text-black/40">Managed classroom</p></div>
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <a href={dashboard} className="rounded-[24px] border border-black/[0.08] bg-white p-5 hover:shadow-md"><GearSix size={22} className="text-[#C51635]" /><h2 className="mt-4 text-lg font-black">Administer classroom</h2><p className="mt-2 text-sm leading-6 text-black/45">Acyberschool can work inside the institution dashboard as an administrator.</p></a>
        <a href={courses} className="rounded-[24px] border border-black/[0.08] bg-white p-5 hover:shadow-md"><BookOpen size={22} className="text-[#C51635]" /><h2 className="mt-4 text-lg font-black">Build courses</h2><p className="mt-2 text-sm leading-6 text-black/45">Create, co develop, edit and publish the institution's courses.</p></a>
        <a href={organisation} className="rounded-[24px] border border-black/[0.08] bg-white p-5 hover:shadow-md"><Buildings size={22} className="text-[#C51635]" /><h2 className="mt-4 text-lg font-black">Brand and configure</h2><p className="mt-2 text-sm leading-6 text-black/45">Logo, identity, organization settings and domain configuration stay with this tenant.</p></a>
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-[24px] border border-black/[0.08] bg-white p-5 sm:p-6">
          <div className="flex items-center gap-3"><UserPlus size={20} className="text-[#C51635]" /><h2 className="text-lg font-black">Institution administrator</h2></div>
          <p className="mt-2 text-sm leading-6 text-black/45">Assign an existing Acyberschool user as an administrator. The institution can then manage its own classroom while Acyberschool retains operator access.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@institution.org" className="min-h-12 min-w-0 flex-1 rounded-xl border border-black/10 px-4 text-sm outline-none" />
            <button onClick={assignAdmin} disabled={assigning || !adminEmail.trim()} className="min-h-12 rounded-xl bg-[#0B263D] px-5 text-sm font-black text-white disabled:opacity-50">{assigning ? 'Assigning' : 'Assign admin'}</button>
          </div>
        </div>

        <div className="rounded-[24px] border border-black/[0.08] bg-white p-5 sm:p-6">
          <div className="flex items-center gap-3"><Globe size={20} className="text-[#C51635]" /><h2 className="text-lg font-black">Domains</h2></div>
          <div className="mt-4 space-y-2">
            <div className="rounded-xl bg-[#F7F8FA] px-4 py-3"><p className="text-xs font-bold text-black/35">Acyberschool managed</p><p className="mt-1 break-all text-sm font-black">{org.managed_domain}</p></div>
            {org.custom_domains.map((domain) => <div key={domain.id} className="rounded-xl border border-black/[0.07] px-4 py-3"><div className="flex items-center justify-between gap-3"><p className="break-all text-sm font-black">{domain.domain}</p><span className="rounded-full bg-[#F7F8FA] px-2.5 py-1 text-[10px] font-black uppercase text-black/45">{domain.status}</span></div></div>)}
            {org.custom_domains.length === 0 && <p className="text-sm text-black/40">No institution owned domain has been connected yet.</p>}
          </div>
        </div>
      </section>
    </main>
  )
}
