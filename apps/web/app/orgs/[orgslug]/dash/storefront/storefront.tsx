'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Eye } from 'lucide-react'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getOrgCourses } from '@services/courses/courses'

export default function StorefrontCoursePages({ orgslug }: { orgslug: string }) {
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token as string | undefined

  const query = useQuery({
    queryKey: ['storefront-course-pages', orgslug],
    queryFn: () => getOrgCourses(orgslug, { cache: 'no-store' }, token, true),
    enabled: Boolean(token && orgslug),
  })

  const courses = Array.isArray(query.data) ? query.data : []

  return (
    <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#C51635]">Course pages</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">Landing pages</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-black/45">Choose a course, build its public page, set enrollment and add custom page code when needed.</p>
      </div>

      {query.isLoading ? (
        <div className="mt-7 grid gap-4 md:grid-cols-2"><div className="h-44 animate-pulse rounded-[24px] bg-black/[0.04]" /><div className="h-44 animate-pulse rounded-[24px] bg-black/[0.04]" /></div>
      ) : courses.length === 0 ? (
        <div className="mt-7 rounded-[24px] border border-dashed border-black/15 bg-white px-6 py-14 text-center"><BookOpen className="mx-auto h-8 w-8 text-black/20" /><p className="mt-3 font-black">Create a course first.</p></div>
      ) : (
        <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((course: any) => {
            const clean = String(course.course_uuid || '').replace('course_', '')
            const storefront = course?.extra_metadata?.storefront || {}
            return (
              <article key={course.course_uuid} className="rounded-[24px] border border-black/[0.08] bg-white p-5 shadow-[0_12px_35px_rgba(11,38,61,0.05)]">
                <div className="flex items-start justify-between gap-4">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B263D] text-white"><BookOpen className="h-5 w-5" /></span>
                  <span className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.1em] ${storefront.enabled ? 'bg-green-50 text-green-700' : 'bg-black/[0.04] text-black/40'}`}>{storefront.enabled ? 'In catalogue' : 'Not listed'}</span>
                </div>
                <h2 className="mt-4 line-clamp-2 text-lg font-black">{course.name}</h2>
                <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-black/45">{storefront.headline || course.description || 'Build the course landing page.'}</p>
                <div className="mt-5 flex gap-2 border-t border-black/[0.06] pt-4">
                  <Link href={`/dash/storefront/${clean}`} className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-[#C51635] px-3 text-xs font-black text-white">Edit page <ArrowRight className="h-3.5 w-3.5" /></Link>
                  {storefront.enabled && <a href={`/catalog/${clean}`} target="_blank" rel="noreferrer" className="flex h-10 w-10 items-center justify-center rounded-xl border border-black/10 text-black/50" aria-label="View public page"><Eye className="h-4 w-4" /></a>}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}
