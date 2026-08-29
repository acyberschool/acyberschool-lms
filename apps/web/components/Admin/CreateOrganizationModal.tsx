'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Buildings, X } from '@phosphor-icons/react'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests'

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export default function CreateOrganizationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token as string | undefined
  const queryClient = useQueryClient()
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [email, setEmail] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setName('')
    setSlug('')
    setSlugTouched(false)
    setEmail('')
    setAdminEmail('')
    setDescription('')
    setSubmitting(false)
    setError('')
  }, [open])

  if (!open) return null

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(
        `${getAPIUrl()}platform/organizations`,
        RequestBodyWithAuthHeader('POST', {
          name,
          slug,
          email,
          description: description || null,
          admin_email: adminEmail || null,
        }, null, token)
      )
      const created = await errorHandling(response)
      await queryClient.invalidateQueries({ queryKey: ['platform-organizations'] })
      onClose()
      router.push(`/admin/organizations/${created.id}`)
    } catch (err: any) {
      setError(err?.message || 'Could not create this institution.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/50 sm:items-center sm:p-5">
      <div className="max-h-[94vh] w-full overflow-y-auto rounded-t-[28px] bg-white sm:max-w-xl sm:rounded-[28px]">
        <div className="sticky top-0 flex items-center justify-between border-b border-black/[0.07] bg-white px-5 py-4 sm:px-7">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0B263D] text-white"><Buildings size={20} /></span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#C51635]">Acyberschool operator</p>
              <h2 className="text-xl font-black">Create institution</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-black/40 hover:bg-black/[0.04]" aria-label="Close"><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="space-y-5 p-5 sm:p-7">
          <label className="block text-sm font-bold">Institution name
            <input required minLength={2} value={name} onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)) }} className="mt-2 min-h-12 w-full rounded-xl border border-black/10 px-4 font-normal outline-none" />
          </label>

          <label className="block text-sm font-bold">Classroom address
            <div className="mt-2 flex min-h-12 items-center rounded-xl border border-black/10 bg-[#FAFAFA] px-4">
              <input required value={slug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)) }} className="min-w-0 flex-1 bg-transparent font-normal outline-none" />
              <span className="shrink-0 text-xs text-black/40">.classroom.acyberschool.com</span>
            </div>
          </label>

          <label className="block text-sm font-bold">Institution contact email
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-black/10 px-4 font-normal outline-none" />
          </label>

          <label className="block text-sm font-bold">Institution administrator
            <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@institution.org" className="mt-2 min-h-12 w-full rounded-xl border border-black/10 px-4 font-normal outline-none" />
            <span className="mt-1.5 block text-xs font-normal text-black/40">If this person already has an Acyberschool account they are assigned immediately.</span>
          </label>

          <label className="block text-sm font-bold">Description
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className="mt-2 w-full rounded-xl border border-black/10 p-4 font-normal outline-none" />
          </label>

          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

          <div className="flex justify-end gap-3 border-t border-black/[0.06] pt-5">
            <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-black/10 px-5 text-sm font-bold">Cancel</button>
            <button disabled={submitting} type="submit" className="min-h-11 rounded-xl bg-[#C51635] px-5 text-sm font-black text-white disabled:opacity-60">
              {submitting ? 'Creating' : 'Create institution'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
