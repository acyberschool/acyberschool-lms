'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Check, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import {
  createStoreCheckout,
  enrollStoreCourse,
  getStoreAccess,
  getStoreCourse,
  getStoreEntry,
} from '@services/storefront/storefront'

const RED = '#C51635'
const NAVY = '#0B263D'

function withCoursePrefix(value: string) {
  return value.startsWith('course_') ? value : `course_${value}`
}

function cleanUuid(value: string) {
  return value.replace('course_', '')
}

function priceLabel(amount: number, currency: string) {
  if (!amount) return 'Free'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 2,
  }).format(amount / 100)
}

function learningItems(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => typeof item === 'string' ? item : item?.text)
        .filter((item): item is string => Boolean(item))
    }
  } catch {
    // Legacy courses use a comma separated list.
  }
  return raw.split(',').map((item) => item.trim()).filter(Boolean)
}

export default function CourseStorefrontLanding({ courseuuid }: { courseuuid: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token as string | undefined
  const [busy, setBusy] = useState(false)
  const [paymentWaiting, setPaymentWaiting] = useState(false)

  const canonicalUuid = withCoursePrefix(courseuuid)
  const courseQuery = useQuery({
    queryKey: ['acyberschool-storefront', 'course', canonicalUuid],
    queryFn: () => getStoreCourse(canonicalUuid),
    staleTime: 60_000,
  })

  const accessQuery = useQuery({
    queryKey: ['acyberschool-storefront', 'access', canonicalUuid, session?.status],
    queryFn: () => getStoreAccess(canonicalUuid, token),
    enabled: session?.status !== 'loading',
    staleTime: 5_000,
  })

  useEffect(() => {
    if (searchParams.get('payment') !== 'success' || accessQuery.data?.enrolled) return
    setPaymentWaiting(true)
    let attempts = 0
    const timer = window.setInterval(async () => {
      attempts += 1
      const result = await accessQuery.refetch()
      if (result.data?.enrolled || attempts >= 12) {
        window.clearInterval(timer)
        setPaymentWaiting(false)
      }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [searchParams, accessQuery.data?.enrolled]) // eslint-disable-line react-hooks/exhaustive-deps

  const course = courseQuery.data
  const sf = course?.storefront
  const learnings = useMemo(() => learningItems(course?.learnings), [course?.learnings])
  const heroImage = course?.org_uuid && course?.thumbnail_image
    ? getCourseThumbnailMediaDirectory(course.org_uuid, course.course_uuid, course.thumbnail_image)
    : null

  const enterClassroom = async () => {
    if (!course || !sf) return
    if (session?.status !== 'authenticated') {
      router.push(`/login?next=${encodeURIComponent(`/catalog/${cleanUuid(course.course_uuid)}`)}`)
      return
    }

    setBusy(true)
    try {
      let access = accessQuery.data || await getStoreAccess(course.course_uuid, token)
      if (!access.enrolled) {
        if (sf.price_minor > 0) {
          const checkout = await createStoreCheckout(course.course_uuid, token)
          window.location.assign(checkout.checkout_url)
          return
        }
        await enrollStoreCourse(course.course_uuid, token)
        access = { ...access, enrolled: true }
        await accessQuery.refetch()
      }

      const entry = await getStoreEntry(course.course_uuid, token)
      router.push(getUriWithOrg(entry.org_slug, entry.path))
    } catch (error: any) {
      toast.error(error?.message || 'Could not open this course.')
    } finally {
      setBusy(false)
    }
  }

  if (courseQuery.isLoading) {
    return <div className="min-h-screen animate-pulse bg-[#F7F8FA]" />
  }

  if (!course || !sf || courseQuery.error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F7F8FA] px-5">
        <div className="max-w-md text-center">
          <BookOpen className="mx-auto h-9 w-9 text-black/20" />
          <h1 className="mt-4 text-2xl font-black">This course is not available.</h1>
          <Link href="/" className="mt-5 inline-block text-sm font-black" style={{ color: RED }}>Browse courses</Link>
        </div>
      </main>
    )
  }

  const enrolled = Boolean(accessQuery.data?.enrolled)
  const cta = enrolled ? 'Continue course' : sf.cta_label || 'Enroll'

  return (
    <main className="min-h-screen bg-white text-[#101418]">
      <header className="border-b border-black/[0.06] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8 lg:px-10">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ backgroundColor: NAVY }}>
              <BookOpen className="h-4 w-4" />
            </span>
            <span className="text-base font-black tracking-[-0.03em]">Acyberschool</span>
          </Link>
          <Link href="/home" className="text-sm font-extrabold text-black/50 hover:text-black/80">My learning</Link>
        </div>
      </header>

      {sf.custom_html_enabled && sf.custom_html ? (
        <>
          <div className="border-b border-black/[0.06] bg-[#F7F8FA] p-3 text-center text-xs text-black/45">
            Custom course page
          </div>
          <iframe
            title={`${course.name} course page`}
            srcDoc={sf.custom_html}
            sandbox="allow-scripts allow-forms allow-popups"
            className="min-h-[72vh] w-full border-0 bg-white"
          />
          <div className="sticky bottom-0 z-30 border-t border-black/[0.08] bg-white/95 px-5 py-4 backdrop-blur sm:px-8">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-black">{course.name}</p>
                <p className="text-xs text-black/40">{enrolled ? 'Your course is ready.' : priceLabel(sf.price_minor, sf.currency)}</p>
              </div>
              <button onClick={enterClassroom} disabled={busy || paymentWaiting} className="flex min-h-12 shrink-0 items-center gap-2 rounded-xl px-5 py-3 text-sm font-black text-white disabled:opacity-60" style={{ backgroundColor: RED }}>
                {(busy || paymentWaiting) && <Loader2 className="h-4 w-4 animate-spin" />}
                {paymentWaiting ? 'Preparing course' : cta}
                {!busy && !paymentWaiting && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <section className="border-b border-black/[0.06] bg-[#F7F8FA]">
            <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:px-8 sm:py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-10 lg:py-20">
              <div>
                <div className="flex items-center gap-3">
                  <span className="h-[3px] w-10 rounded-full" style={{ backgroundColor: RED }} />
                  <span className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: RED }}>{course.org_name || 'Acyberschool'}</span>
                </div>
                <h1 className="mt-5 text-[42px] font-black leading-[1.02] tracking-[-0.055em] sm:text-6xl">
                  {sf.headline || course.name}
                </h1>
                <p className="mt-5 max-w-2xl text-base leading-7 text-black/55 sm:text-lg">
                  {sf.subheadline || course.description || course.about}
                </p>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <button onClick={enterClassroom} disabled={busy || paymentWaiting} className="flex min-h-13 items-center gap-2 rounded-xl px-6 py-3.5 text-sm font-black text-white disabled:opacity-60" style={{ backgroundColor: RED }}>
                    {(busy || paymentWaiting) && <Loader2 className="h-4 w-4 animate-spin" />}
                    {paymentWaiting ? 'Preparing course' : cta}
                    {!busy && !paymentWaiting && <ArrowRight className="h-4 w-4" />}
                  </button>
                  <span className="rounded-xl bg-white px-4 py-3 text-sm font-black shadow-sm">{enrolled ? 'Enrolled' : priceLabel(sf.price_minor, sf.currency)}</span>
                </div>
                {searchParams.get('payment') === 'success' && (
                  <p className="mt-4 text-sm font-bold text-[#0B263D]">Payment received. Your classroom is being prepared.</p>
                )}
              </div>

              <div className="overflow-hidden rounded-[28px] bg-[#0B263D] shadow-[0_24px_70px_rgba(11,38,61,0.18)]">
                {heroImage ? (
                  <img src={heroImage} alt="" className="aspect-[16/10] h-full w-full object-cover" />
                ) : (
                  <div className="flex aspect-[16/10] items-center justify-center">
                    <BookOpen className="h-14 w-14 text-white/50" />
                  </div>
                )}
              </div>
            </div>
          </section>

          {(learnings.length > 0 || course.about) && (
            <section className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-2">
              {course.about && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: RED }}>About</p>
                  <p className="mt-4 whitespace-pre-line text-base leading-8 text-black/60">{course.about}</p>
                </div>
              )}
              {learnings.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: RED }}>You will learn</p>
                  <div className="mt-4 space-y-3">
                    {learnings.map((item) => (
                      <div key={item} className="flex gap-3 rounded-2xl border border-black/[0.07] p-4">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white" style={{ backgroundColor: NAVY }}><Check className="h-3 w-3" /></span>
                        <p className="text-sm font-semibold leading-6 text-black/65">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {sf.sections.length > 0 && (
            <section className="border-t border-black/[0.06] bg-[#F7F8FA]">
              <div className="mx-auto max-w-6xl space-y-6 px-5 py-12 sm:px-8 sm:py-16">
                {sf.sections.map((section, index) => (
                  <article key={`${section.heading || section.type}-${index}`} className="rounded-[24px] bg-white p-6 sm:p-8">
                    {section.heading && <h2 className="text-2xl font-black tracking-[-0.03em]">{section.heading}</h2>}
                    {section.body && <p className="mt-3 whitespace-pre-line text-base leading-7 text-black/55">{section.body}</p>}
                    {section.image_url && <img src={section.image_url} alt="" className="mt-5 max-h-[520px] w-full rounded-2xl object-cover" />}
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="bg-[#0B263D] px-5 py-12 text-white sm:px-8 sm:py-16">
            <div className="mx-auto flex max-w-5xl flex-col justify-between gap-6 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-white/50">Ready</p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">Enter the classroom.</h2>
              </div>
              <button onClick={enterClassroom} disabled={busy || paymentWaiting} className="flex min-h-13 items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-black text-white disabled:opacity-60" style={{ backgroundColor: RED }}>
                {(busy || paymentWaiting) && <Loader2 className="h-4 w-4 animate-spin" />}
                {paymentWaiting ? 'Preparing course' : cta}
                {!busy && !paymentWaiting && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  )
}
