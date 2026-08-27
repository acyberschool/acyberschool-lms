'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Code, Eye, Save } from 'lucide-react'
import toast from 'react-hot-toast'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getCourseMetadata } from '@services/courses/courses'
import { saveStoreLanding, type StorefrontConfig } from '@services/storefront/storefront'

const emptyConfig: StorefrontConfig = {
  enabled: false,
  headline: '',
  subheadline: '',
  cta_label: 'Enroll',
  price_minor: 0,
  currency: 'USD',
  sections: [],
  custom_html: '',
  custom_html_enabled: false,
}

export default function CourseLandingEditor({ orgslug, courseuuid }: { orgslug: string; courseuuid: string }) {
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token as string | undefined
  const [config, setConfig] = useState<StorefrontConfig>(emptyConfig)
  const [price, setPrice] = useState('0')
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'page' | 'code' | 'preview'>('page')

  const courseQuery = useQuery({
    queryKey: ['course-landing-editor', courseuuid],
    queryFn: () => getCourseMetadata(courseuuid, {}, token, { slim: true }),
    enabled: Boolean(token && courseuuid),
  })

  useEffect(() => {
    const course = courseQuery.data as any
    if (!course) return
    const existing = course?.extra_metadata?.storefront || {}
    const next = { ...emptyConfig, ...existing }
    setConfig(next)
    setPrice(String((next.price_minor || 0) / 100))
  }, [courseQuery.data])

  const course = courseQuery.data as any
  const publicUrl = useMemo(() => `/catalog/${courseuuid.replace('course_', '')}`, [courseuuid])

  const save = async () => {
    setSaving(true)
    try {
      const parsedPrice = Number.parseFloat(price || '0')
      const payload: StorefrontConfig = {
        ...config,
        price_minor: Number.isFinite(parsedPrice) ? Math.max(0, Math.round(parsedPrice * 100)) : 0,
        currency: (config.currency || 'USD').toUpperCase(),
      }
      await saveStoreLanding(courseuuid, payload, token)
      setConfig(payload)
      toast.success('Course landing page saved.')
    } catch (error: any) {
      toast.error(error?.message || 'Could not save the landing page.')
    } finally {
      setSaving(false)
    }
  }

  if (courseQuery.isLoading) return <div className="h-96 animate-pulse rounded-[24px] bg-black/[0.04]" />
  if (!course) return <div className="p-8 font-black">Course could not be loaded.</div>

  return (
    <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Link href={`/dash/storefront`} className="inline-flex items-center gap-2 text-sm font-bold text-black/40"><ArrowLeft className="h-4 w-4" /> Course pages</Link>
          <p className="mt-5 text-[10px] font-black uppercase tracking-[0.18em] text-[#C51635]">Course landing page</p>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">{course.name}</h1>
          <p className="mt-2 text-sm text-black/45">Build a simple page here or paste a complete page created in ChatGPT.</p>
        </div>
        <div className="flex gap-2">
          <a href={publicUrl} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-black"><Eye className="h-4 w-4" /> View</a>
          <button onClick={save} disabled={saving} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#C51635] px-5 text-sm font-black text-white disabled:opacity-60"><Save className="h-4 w-4" /> {saving ? 'Saving' : 'Save'}</button>
        </div>
      </div>

      <div className="mt-7 inline-flex rounded-xl bg-black/[0.04] p-1">
        <button onClick={() => setTab('page')} className={`rounded-lg px-4 py-2 text-sm font-black ${tab === 'page' ? 'bg-white shadow-sm' : 'text-black/45'}`}>Page</button>
        <button onClick={() => setTab('code')} className={`rounded-lg px-4 py-2 text-sm font-black ${tab === 'code' ? 'bg-white shadow-sm' : 'text-black/45'}`}>Custom code</button>
        <button onClick={() => setTab('preview')} className={`rounded-lg px-4 py-2 text-sm font-black ${tab === 'preview' ? 'bg-white shadow-sm' : 'text-black/45'}`}>Preview</button>
      </div>

      {tab === 'page' && (
        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_0.72fr]">
          <section className="space-y-5 rounded-[24px] border border-black/[0.08] bg-white p-5 sm:p-7">
            <label className="flex items-center justify-between gap-4 rounded-2xl bg-[#F7F8FA] p-4">
              <div><p className="text-sm font-black">Show in public catalogue</p><p className="mt-1 text-xs text-black/40">The course must also be published and public.</p></div>
              <input type="checkbox" checked={config.enabled} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} className="h-5 w-5" />
            </label>
            <label className="block text-sm font-bold">Headline<input value={config.headline || ''} onChange={(e) => setConfig({ ...config, headline: e.target.value })} className="mt-2 min-h-12 w-full rounded-xl border border-black/10 px-4 font-normal outline-none" /></label>
            <label className="block text-sm font-bold">Short introduction<textarea rows={3} value={config.subheadline || ''} onChange={(e) => setConfig({ ...config, subheadline: e.target.value })} className="mt-2 w-full rounded-xl border border-black/10 p-4 font-normal outline-none" /></label>
            <label className="block text-sm font-bold">Button text<input value={config.cta_label} onChange={(e) => setConfig({ ...config, cta_label: e.target.value })} className="mt-2 min-h-12 w-full rounded-xl border border-black/10 px-4 font-normal outline-none" /></label>
          </section>

          <section className="space-y-5 rounded-[24px] border border-black/[0.08] bg-white p-5 sm:p-7">
            <div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#C51635]">Enrollment</p><h2 className="mt-1 text-xl font-black">Price</h2></div>
            <div className="grid grid-cols-[1fr_110px] gap-2">
              <label className="block text-sm font-bold">Amount<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-black/10 px-4 font-normal outline-none" /></label>
              <label className="block text-sm font-bold">Currency<input maxLength={3} value={config.currency} onChange={(e) => setConfig({ ...config, currency: e.target.value.toUpperCase() })} className="mt-2 min-h-12 w-full rounded-xl border border-black/10 px-4 font-normal uppercase outline-none" /></label>
            </div>
            <p className="text-xs leading-5 text-black/40">Use 0 for a free course. Paid courses open secure card checkout before enrollment.</p>
          </section>
        </div>
      )}

      {tab === 'code' && (
        <section className="mt-5 rounded-[24px] border border-black/[0.08] bg-white p-5 sm:p-7">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div><div className="flex items-center gap-2"><Code className="h-5 w-5 text-[#C51635]" /><h2 className="text-xl font-black">Paste a complete page</h2></div><p className="mt-2 max-w-2xl text-sm leading-6 text-black/45">HTML, CSS and JavaScript created in ChatGPT can be pasted here. It runs inside an isolated page and cannot read learner login cookies or LMS data.</p></div>
            <label className="flex items-center gap-2 text-sm font-black"><input type="checkbox" checked={config.custom_html_enabled} onChange={(e) => setConfig({ ...config, custom_html_enabled: e.target.checked })} className="h-5 w-5" /> Use custom page</label>
          </div>
          <textarea value={config.custom_html || ''} onChange={(e) => setConfig({ ...config, custom_html: e.target.value })} spellCheck={false} placeholder="<!doctype html>..." className="mt-5 min-h-[520px] w-full rounded-2xl border border-black/10 bg-[#101418] p-5 font-mono text-xs leading-6 text-white outline-none" />
        </section>
      )}

      {tab === 'preview' && (
        <section className="mt-5 overflow-hidden rounded-[24px] border border-black/[0.08] bg-white">
          {config.custom_html_enabled && config.custom_html ? (
            <iframe title="Course landing preview" srcDoc={config.custom_html} sandbox="allow-scripts allow-forms allow-popups" className="min-h-[680px] w-full border-0" />
          ) : (
            <div className="p-8 sm:p-12">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#C51635]">Preview</p>
              <h2 className="mt-3 max-w-3xl text-4xl font-black tracking-[-0.05em]">{config.headline || course.name}</h2>
              <p className="mt-4 max-w-2xl text-base leading-7 text-black/50">{config.subheadline || course.description || course.about}</p>
              <button className="mt-6 rounded-xl bg-[#C51635] px-6 py-3 text-sm font-black text-white">{config.cta_label || 'Enroll'}</button>
            </div>
          )}
        </section>
      )}
    </main>
  )
}
