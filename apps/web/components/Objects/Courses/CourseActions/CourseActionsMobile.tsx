import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg, useOrgMembership } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { getOffersByResource } from '@services/payments/offers'
import { ArrowRight, Lock, ShoppingCart, UserPlus } from 'lucide-react'
import { startCourse } from '@services/courses/activity'
import { revalidateTags, asArray } from '@services/utils/ts/requests'
import UserAvatar from '../../UserAvatar'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import Link from 'next/link'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { useTranslation } from 'react-i18next'
import { formatCurrency } from '@/lib/format'

interface Author {
  user: {
    user_uuid: string
    avatar_image: string
    first_name: string
    last_name: string
    username: string
  }
  authorship: 'CREATOR' | 'CONTRIBUTOR' | 'MAINTAINER' | 'REPORTER'
  authorship_status: 'ACTIVE' | 'INACTIVE' | 'PENDING'
}

interface CourseActivity {
  id?: string | number
  activity_uuid: string
  name: string
  activity_type: string
}

interface CourseRun {
  status: string
  course_id: string
  course?: { course_uuid?: string }
  steps?: Array<{ activity_id: string | number; complete: boolean }>
}

interface Course {
  id: string
  course_uuid: string
  authors: Author[]
  chapters?: Array<{
    name: string
    activities: CourseActivity[]
  }>
}

interface CourseActionsMobileProps {
  courseuuid: string
  orgslug: string
  course: Course & { org_id: number }
  trailData?: any
}

const BRAND_RED = '#C51635'

const MultipleAuthors = ({ authors }: { authors: Author[] }) => {
  if (!authors.length) return null
  const displayed = authors.slice(0, 3)
  const remaining = Math.max(0, authors.length - 3)

  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-3">
        {displayed.map((author, index) => (
          <div key={author.user.user_uuid} className="relative" style={{ zIndex: displayed.length - index }}>
            <UserAvatar
              border="border-2"
              rounded="rounded-full"
              avatar_url={author.user.avatar_image ? getUserAvatarMediaDirectory(author.user.user_uuid, author.user.avatar_image) : ''}
              predefined_avatar={author.user.avatar_image ? undefined : 'empty'}
              width={36}
            />
          </div>
        ))}
        {remaining > 0 && (
          <div className="w-9 h-9 rounded-full border-2 border-white bg-neutral-100 flex items-center justify-center text-xs text-neutral-600">
            +{remaining}
          </div>
        )}
      </div>
      <div>
        <div className="text-xs text-neutral-400 font-medium">{authors.length > 1 ? 'Authors' : 'Author'}</div>
        <div className="text-sm font-semibold text-neutral-800">
          {authors[0].user.first_name && authors[0].user.last_name
            ? `${authors[0].user.first_name} ${authors[0].user.last_name}`
            : `@${authors[0].user.username}`}
          {authors.length > 1 ? ` & ${authors.length - 1} more` : ''}
        </div>
      </div>
    </div>
  )
}

const CourseActionsMobile = ({ courseuuid, orgslug, course, trailData }: CourseActionsMobileProps) => {
  const router = useRouter()
  const session = useLHSession() as any
  const { isUserPartOfTheOrg } = useOrgMembership()
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('learner')
  const [isActionLoading, setIsActionLoading] = useState(false)
  const cleanCourseUuid = course.course_uuid?.replace('course_', '')
  const resourceUuid = cleanCourseUuid ? `course_${cleanCourseUuid}` : null
  const { i18n } = useTranslation()

  const courseRun: CourseRun | undefined = trailData?.runs?.find((run: any) => {
    const runUuid = run.course?.course_uuid?.replace('course_', '')
    return runUuid === cleanCourseUuid
  })
  const isStarted = !!courseRun

  const { data: offersResult, isLoading } = useQuery({
    queryKey: ['offers', 'by-resource', org?.id, resourceUuid],
    queryFn: () => getOffersByResource(org.id, resourceUuid!),
    enabled: !!org && !!resourceUuid,
    staleTime: 60_000,
  })
  const linkedOffers: any[] = asArray(offersResult)
  const allActivities = course.chapters?.flatMap((chapter) => chapter.activities || []) || []

  const getContinueActivity = () => {
    if (!allActivities.length) return null
    if (!courseRun?.steps?.length) return allActivities[0]
    return allActivities.find((activity) => {
      const step = courseRun.steps?.find((item) => {
        const candidates = [activity.id, activity.activity_uuid, activity.activity_uuid.replace('activity_', '')]
        return candidates.some((candidate) => candidate != null && String(candidate) === String(item.activity_id))
      })
      return !step?.complete
    }) || allActivities[0]
  }

  const goToActivity = (activity: CourseActivity | null) => {
    if (!activity) return
    router.push(
      getUriWithOrg(orgslug, '') +
        `/course/${courseuuid}/activity/${activity.activity_uuid.replace('activity_', '')}`
    )
  }

  const handleCourseAction = async () => {
    if (!session.data?.user) {
      router.push(getUriWithOrg(orgslug, '/signup'))
      return
    }
    if (!isUserPartOfTheOrg) {
      router.push(getUriWithOrg(orgslug, '/signup'))
      return
    }

    setIsActionLoading(true)
    try {
      if (!isStarted) {
        await startCourse('course_' + courseuuid, orgslug, session.data?.tokens?.access_token)
        await revalidateTags(['courses'], orgslug)
        if (org?.id) {
          await queryClient.invalidateQueries({ queryKey: queryKeys.trail.org(org.id) })
        }
        track(AnalyticsEvent.CourseStarted, {
          course_uuid: cleanCourseUuid,
          total_activities: allActivities.length,
          has_offers: linkedOffers.length > 0,
        })
        goToActivity(allActivities[0] || null)
      } else {
        goToActivity(getContinueActivity())
      }
    } catch (error) {
      console.error('Failed to open course:', error)
    } finally {
      setIsActionLoading(false)
    }
  }

  if (isLoading) {
    return <div className="animate-pulse h-16 bg-gray-100 rounded-lg mt-4 mb-8" />
  }

  if (session.data?.user && !isUserPartOfTheOrg) {
    return (
      <div className="bg-white rounded-lg border border-neutral-200 p-4 my-6 mx-2">
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-amber-800" />
            <span className="text-amber-800 text-sm font-semibold">An Acyberschool invitation is required for this course.</span>
          </div>
        </div>
      </div>
    )
  }

  const sortedAuthors = [...course.authors]
    .filter((author) => author.authorship_status === 'ACTIVE')
    .sort((a, b) => {
      const priority: Record<string, number> = { CREATOR: 0, MAINTAINER: 1, CONTRIBUTOR: 2, REPORTER: 3 }
      return priority[a.authorship] - priority[b.authorship]
    })

  if (linkedOffers.length > 0 && !isStarted) {
    const offer = linkedOffers[0]
    const formattedPrice = offer?.amount != null
      ? formatCurrency(offer.amount, offer.currency ?? 'USD', i18n.language)
      : null
    const storeHref = org?.slug ? getUriWithOrg(org.slug, `/store/offers/${offer.offer_id}`) : '#'

    return (
      <div className="bg-white rounded-lg border border-neutral-200 p-4 my-6 mx-2 space-y-4">
        <MultipleAuthors authors={sortedAuthors} />
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center gap-2">
          <Lock className="w-4 h-4 text-gray-600" />
          <div>
            <div className="text-sm font-semibold text-gray-900">{offer.offer_name}</div>
            {formattedPrice && <div className="text-xs text-gray-500">{formattedPrice}</div>}
          </div>
        </div>
        <Link href={storeHref}>
          <button className="w-full py-3 px-4 rounded-lg bg-neutral-900 text-white font-semibold text-sm flex items-center justify-center gap-2">
            <ShoppingCart className="w-4 h-4" />
            {formattedPrice ? `Get Access — ${formattedPrice}` : 'Purchase Course'}
          </button>
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-white/95 rounded-lg border border-neutral-200 p-4 my-6 mx-2">
      <div className="flex flex-col space-y-4">
        <MultipleAuthors authors={sortedAuthors} />
        <button
          onClick={handleCourseAction}
          disabled={isActionLoading}
          className="w-full py-3 px-4 rounded-lg text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ backgroundColor: BRAND_RED }}
        >
          {isActionLoading ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <span>{isStarted ? 'Continue Course' : 'Start Course'}</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  )
}

export default CourseActionsMobile
