'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen } from 'lucide-react'

import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { getStoreCourses, type StoreCourse } from '@services/storefront/storefront'

const RED = '#C51635'
const NAVY = '#0B263D'

function cleanUuid(value: string) {
  return value.replace('course_', '')
}

function priceLabel(course: StoreCourse) {
  const amount = course.storefront.price_minor || 0
  if (amount === 0) return 'Free'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: course.storefront.currency || 'USD',
    maximumFractionDigits: 2,
  }).format(amount / 100)
}

function CourseCard({ course }: { course: StoreCourse }) {
  const image = course.org_uuid && course.thumbnail_image
    ? getCourseThumbnailMediaDirectory(course.org_uuid, course.course_uuid, course.thumbnail_image)
    : null

  return (
    <article className="group overflow-hidden rounded-[24px] border border-black/[0.08] bg-white shadow-[0_14px_45px_rgba(11,38,61,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_55px_rgba(11,38,61,0.11)]">
      <Link href={`/catalog/${cleanUuid(course.course_uuid)}`} className="block">
        <div className="relative aspect-[16/9] overflow-hidden bg-[#F1F3F5]">
          {image ? (
            <img src={image} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" />
          ) : (
            <div className="flex h-full items-center justify-center" style={{ backgroundColor: NAVY }}>
              <BookOpen className="h-8 w-8 text-white/70" />
            </div>
          )}
          <span className="absolute right-3 top-3 rounded-full bg-white px-3 py-1.5 text-xs font-black text-[#101418] shadow-sm">
            {priceLabel(course)}
          </span>
        </div>
        <div className="p-5 sm:p-6">
          <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: RED }}>
            {course.org_name || 'Acyberschool'}
          </p>
          <h2 className="mt-2 text-xl font-black tracking-[-0.03em] text-[#101418]">
            {course.storefront.headline || course.name}
          </h2>
          <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-black/50">
            {course.storefront.subheadline || course.description || course.about || ''}
          </p>
          <div className="mt-5 flex items-center justify-between border-t border-black/[0.06] pt-4">
            <span className="text-sm font-black text-[#101418]">View course</span>
            <ArrowRight className="h-4 w-4 text-black/45 transition-transform group-hover:translate-x-1" />
          </div>
        </div>
      </Link>
    </article>
  )
}

export default function StorefrontCatalog() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['acyberschool-storefront', 'courses'],
    queryFn: () => getStoreCourses(1, 60),
    staleTime: 60_000,
  })

  const courses = data?.items || []

  return (
    <main className="min-h-screen bg-[#F7F8FA] text-[#101418]">
      <header className="border-b border-black/[0.06] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8 lg:px-10">
          <Link href="/" className="flex items-center gap-3" aria-label="Acyberschool courses">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ backgroundColor: NAVY }}>
              <BookOpen className="h-4 w-4" />
            </span>
            <span className="text-base font-black tracking-[-0.03em]">Acyberschool</span>
          </Link>
          <Link href="/home" className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-extrabold text-[#0B263D]">
            My learning
          </Link>
        </div>
      </header>

      <section className="border-b border-black/[0.06] bg-white">
        <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16 lg:px-10 lg:py-20">
          <div className="flex items-center gap-3">
            <span className="h-[3px] w-10 rounded-full" style={{ backgroundColor: RED }} />
            <span className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: RED }}>Acyberschool</span>
          </div>
          <h1 className="mt-5 max-w-4xl text-[40px] font-black leading-[1.02] tracking-[-0.055em] sm:text-6xl">
            Learn something useful. <span style={{ color: RED }}>Use it.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-black/50 sm:text-lg">
            Choose a course and start learning.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-14 lg:px-10">
        <div className="mb-7 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: RED }}>Courses</p>
            <h2 className="mt-1 text-2xl font-black tracking-[-0.03em] sm:text-3xl">Choose where to begin</h2>
          </div>
          {!isLoading && <p className="text-sm text-black/35">{courses.length} available</p>}
        </div>

        {isLoading ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((n) => <div key={n} className="h-[360px] animate-pulse rounded-[24px] bg-black/[0.04]" />)}
          </div>
        ) : error ? (
          <div className="rounded-[24px] border border-black/[0.08] bg-white px-6 py-12 text-center">
            <p className="font-black">Courses could not be loaded.</p>
            <p className="mt-2 text-sm text-black/45">Please try again.</p>
          </div>
        ) : courses.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-black/15 bg-white px-6 py-14 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-black/20" />
            <p className="mt-3 font-black">New courses are being prepared.</p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => <CourseCard key={course.course_uuid} course={course} />)}
          </div>
        )}
      </section>
    </main>
  )
}
