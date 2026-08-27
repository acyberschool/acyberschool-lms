'use client'

import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Code2, Eye, Plus, Save, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'

import { useCourse } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  saveStoreLanding,
  type StorefrontConfig,
  type StorefrontSection,
} from '@services/storefront/storefront'

const DEFAULT_CONFIG: StorefrontConfig = {
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

function normalizeConfig(raw: any): StorefrontConfig {
  return {
    ...DEFAULT_CONFIG,
    ...(raw || {}),
    sections: Array.isArray(raw?.sections) ? raw.sections : [],
    currency: String(raw?.currency || 'USD').toUpperCase().slice(0, 3),
    price_minor: Number.isFinite(Number(raw?.price_minor)) ? Number(raw.price_minor) : 0,
  }
}

function cleanUuid(value: string) {
  return value.replace('course_', '')
}

export default function EditCourseStorefront() {
  const course = useCourse()
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token as string | undefined
  const structure = course.courseStructure as any
  const courseUuid = String(structure?.course_uuid || '')

  const [config, setConfig] = useState<StorefrontConfig>(DEFAULT_CONFIG)
  const [price, setPrice] = useState('0')
  const [loadedFor, setLoadedFor] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (course.isLoading || !courseUuid || loadedFor === courseUuid) return
    const next = normalizeConfig(structure?.extra_metadata?.storefront)
    setConfig(next)
    setPrice((next.price_minor / 100).toFixed(next.price_minor % 100 === 0 ? 0 : 2))
    setLoadedFor(courseUuid)
  }, [course.isLoading, courseUuid, loadedFor, structure?.extra_metadata])

  const previewPath = useMemo(
    () => courseUuid ? `/catalog/${cleanUuid(courseUuid)}` : '/catalog',
    [courseUuid]
  )

  const update = <K extends keyof StorefrontConfig>(key: K, value: StorefrontConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }))
  }

  const updateSection = (index: number, changes: Partial<StorefrontSection>) => {
    setConfig((current) => ({
      ...current,
      sections: current.sections.map((section, sectionIndex) =>
        sectionIndex === index ? { ...section, ...changes } : section
      ),
    }))
  }

  const addSection = () => {
    setConfig((current) => ({
      ...current,
      sections: [
        ...current.sections,
        { type: 'text', heading: '', body: '', image_url: '' },
      ],
    }))
  }

  const removeSection = (index: number) => {
    setConfig((current) => ({
      ...current,
      sections: current.sections.filter((_, sectionIndex) => sectionIndex !== index),
    }))
  }

  const save = async () => {
    if (!courseUuid || !token) return
    const numericPrice = Number(price || 0)
    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      toast.error('Enter a valid course price.')
      return
    }
    if (!/^[A-Za-z]{3}$/.test(config.currency || '')) {
      toast.error('Currency must be a three letter code such as USD or KES.')
      return
    }

    setSaving(true)
    try {
      const payload: StorefrontConfig = {
        ...config,
        currency: config.currency.toUpperCase(),
        price_minor: Math.round(numericPrice * 100),
        cta_label: config.cta_label.trim() || 'Enroll',
        headline: config.headline?.trim() || null,
        subheadline: config.subheadline?.trim() || null,
        custom_html: config.custom_html || null,
      }
      const saved = await saveStoreLanding(courseUuid, payload, token)
      const next = normalizeConfig(saved.storefront)
      setConfig(next)
      setPrice((next.price_minor / 100).toFixed(next.price_minor % 100 === 0 ? 0 : 2))
      toast.success('Course landing page saved.')
    } catch (error: any) {
      toast.error(error?.message || 'Could not save the course landing page.')
    } finally {
      setSaving(false)
    }
  }

  if (course.isLoading) {
    return <div className="mx-auto mt-8 h-96 max-w-5xl animate-pulse rounded-3xl bg-black/[0.04]" />
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-7 sm:px-8 sm:py-9">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#C51635]">Course storefront</p>
          <h1 className="mt-1 text-2xl font-black tracking-[-0.03em] text-[#101418]">Landing page</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-black/45">
            Publish a simple course page, or paste a complete page you built in ChatGPT. The classroom button remains controlled by Acyberschool so enrollment, payment and resume continue to work.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={previewPath}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-black text-[#0B263D]"
          >
            <Eye className="h-4 w-4" /> Preview <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button
            type="button"
            onClick={save}
            disabled={saving || !token}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#C51635] px-5 text-sm font-black text-white disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {saving ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>

      <section className="rounded-[24px] border border-black/[0.08] bg-white p-5 sm:p-6">
        <div className="flex items-start justify-between gap-5">
          <div>
            <h2 className="text-base font-black">Show in public courses</h2>
            <p className="mt-1 text-sm leading-6 text-black/45">Only published public courses with this switched on appear at classroom.acyberschool.com.</p>
          </div>
          <button
            type="button"
            onClick={() => update('enabled', !config.enabled)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${config.enabled ? 'bg-[#C51635]' : 'bg-black/15'}`}
            aria-pressed={config.enabled}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${config.enabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
      </section>

      <section className="grid gap-5 rounded-[24px] border border-black/[0.08] bg-white p-5 sm:grid-cols-2 sm:p-6">
        <label className="block text-sm font-black sm:col-span-2">Headline
          <input
            value={config.headline || ''}
            onChange={(event) => update('headline', event.target.value)}
            placeholder={structure?.name || 'Course headline'}
            className="mt-2 min-h-12 w-full rounded-xl border border-black/10 px-4 font-normal outline-none focus:border-black/25"
          />
        </label>
        <label className="block text-sm font-black sm:col-span-2">Short description
          <textarea
            rows={3}
            value={config.subheadline || ''}
            onChange={(event) => update('subheadline', event.target.value)}
            placeholder="What should someone know before they enroll?"
            className="mt-2 w-full rounded-xl border border-black/10 p-4 font-normal outline-none focus:border-black/25"
          />
        </label>
        <label className="block text-sm font-black">Button text
          <input
            value={config.cta_label}
            onChange={(event) => update('cta_label', event.target.value)}
            className="mt-2 min-h-12 w-full rounded-xl border border-black/10 px-4 font-normal outline-none"
          />
        </label>
        <div className="grid grid-cols-[1fr_96px] gap-2">
          <label className="block text-sm font-black">Price
            <input
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className="mt-2 min-h-12 w-full rounded-xl border border-black/10 px-4 font-normal outline-none"
            />
          </label>
          <label className="block text-sm font-black">Currency
            <input
              maxLength={3}
              value={config.currency}
              onChange={(event) => update('currency', event.target.value.toUpperCase())}
              className="mt-2 min-h-12 w-full rounded-xl border border-black/10 px-3 text-center font-normal uppercase outline-none"
            />
          </label>
        </div>
      </section>

      <section className="rounded-[24px] border border-black/[0.08] bg-white p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-base font-black">Page sections</h2>
            <p className="mt-1 text-sm text-black/45">Add extra content below the course summary.</p>
          </div>
          <button type="button" onClick={addSection} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-black/10 px-4 text-sm font-black">
            <Plus className="h-4 w-4" /> Add section
          </button>
        </div>

        {config.sections.length === 0 ? (
          <div className="mt-5 rounded-2xl bg-[#F7F8FA] px-5 py-8 text-center text-sm font-semibold text-black/35">No extra sections yet.</div>
        ) : (
          <div className="mt-5 space-y-4">
            {config.sections.map((section, index) => (
              <div key={index} className="rounded-2xl border border-black/[0.07] p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-black/35">Section {index + 1}</p>
                  <button type="button" onClick={() => removeSection(index)} className="rounded-lg p-2 text-black/35 hover:bg-black/[0.04] hover:text-[#C51635]" aria-label={`Remove section ${index + 1}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 grid gap-3">
                  <input
                    value={section.heading || ''}
                    onChange={(event) => updateSection(index, { heading: event.target.value })}
                    placeholder="Section heading"
                    className="min-h-11 rounded-xl border border-black/10 px-4 text-sm font-semibold outline-none"
                  />
                  <textarea
                    rows={4}
                    value={section.body || ''}
                    onChange={(event) => updateSection(index, { body: event.target.value })}
                    placeholder="Section text"
                    className="rounded-xl border border-black/10 p-4 text-sm leading-6 outline-none"
                  />
                  <input
                    value={section.image_url || ''}
                    onChange={(event) => updateSection(index, { image_url: event.target.value })}
                    placeholder="Optional image URL"
                    className="min-h-11 rounded-xl border border-black/10 px-4 text-sm outline-none"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-[24px] border border-black/[0.08] bg-white">
        <div className="flex items-start justify-between gap-5 border-b border-black/[0.07] p-5 sm:p-6">
          <div className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0B263D] text-white"><Code2 className="h-4 w-4" /></span>
            <div>
              <h2 className="text-base font-black">Custom page code</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-black/45">Paste a complete HTML page here. Scripts run inside an isolated frame. Acyberschool keeps the enrollment and classroom button outside your code.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => update('custom_html_enabled', !config.custom_html_enabled)}
            className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition ${config.custom_html_enabled ? 'bg-[#C51635]' : 'bg-black/15'}`}
            aria-pressed={config.custom_html_enabled}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${config.custom_html_enabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
        <div className="p-5 sm:p-6">
          <textarea
            rows={18}
            spellCheck={false}
            value={config.custom_html || ''}
            onChange={(event) => update('custom_html', event.target.value)}
            placeholder={'<!doctype html>\n<html>\n  <body>\n    Your course page\n  </body>\n</html>'}
            className="w-full rounded-2xl border border-black/10 bg-[#0B1622] p-4 font-mono text-xs leading-6 text-white outline-none disabled:opacity-50 sm:p-5"
          />
          <p className="mt-3 text-xs leading-5 text-black/40">Do not put payment credentials, API keys or private information in this code. It is displayed to public visitors when the storefront is enabled.</p>
        </div>
      </section>
    </div>
  )
}
