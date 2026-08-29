import React, { useState } from 'react'
import { startCourse } from '@services/courses/activity'
import { asArray } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { getOffersByResource } from '@services/payments/offers'
import { ArrowRight, BookOpen, ClockIcon, UserPen, UserPlus } from 'lucide-react'
import { OfferCard } from './OfferCard'
import { applyForContributor } from '@services/courses/courses'
import toast from 'react-hot-toast'
import { useContributorStatus } from '../../../../hooks/useContributorStatus'
import CourseProgress from '../CourseProgress/CourseProgress'
import UserAvatar from '@components/Objects/UserAvatar'
import { useOrg, useOrgMembership } from '@components/Contexts/OrgContext'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

interface CourseRun {
  status: string
  course_id: string
  steps?: Array<{
    activity_id: string | number
    complete: boolean
  }>
  course?: { course_uuid?: string }
}

interface CourseActivity {
  id?: string | number
  activity_uuid: string
  name: string
  activity_type: string
}

interface Course {
  id: string
  course_uuid: string
  chapters?: Array<{
    name: string
    activities: CourseActivity[]
  }>
  open_to_contributors?: boolean
}

interface CourseActionsProps {
  courseuuid: string
  orgslug: string
  course: Course & { org_id: number }
  trailData?: any
}

const BRAND_RED = '#C51635'

function CoursesActions({ courseuuid, orgslug, course, trailData }: CourseActionsProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useLHSession() as any
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [isContributeLoading, setIsContributeLoading] = useState(false)
  const { contributorStatus, refetch } = useContributorStatus(courseuuid)
  const [isProgressOpen, setIsProgressOpen] = useState(false)
  const org = useOrg() as any
  const { isUserPartOfTheOrg } = useOrgMembership()
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('learner')

  const cleanCourseUuid = course.course_uuid?.replace('course_', '')
  const resourceUuid = cleanCourseUuid ? `course_${cleanCourseUuid}` : null

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

    const incomplete = allActivities.find((activity) => {
      const step = courseRun.steps?.find((item) => {
        const candidates = [activity.id, activity.activity_uuid, activity.activity_uuid.replace('activity_', '')]
        return candidates.some((candidate) => candidate != null && String(candidate) === String(item.activity_id))
      })
      return !step?.complete
    })

    return incomplete || allActivities[0]
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
      track(AnalyticsEvent.CourseSignupPrompted, {
        reason: 'unauthenticated',
        intended_action: isStarted ? 'continue_course' : 'start_course',
      })
      router.push(getUriWithOrg(orgslug, '/signup'))
      return
    }

    if (!isUserPartOfTheOrg) {
      router.push(getUriWithOrg(orgslug, '/signup'))
      return
    }

    setIsActionLoading(true)
    const loadingToast = toast.loading(isStarted ? 'Opening your course...' : 'Starting your course...')

    try {
      if (!isStarted) {
        await startCourse('course_' + courseuuid, orgslug, session.data?.tokens?.access_token)
        if (org?.id) {
          await queryClient.invalidateQueries({ queryKey: queryKeys.trail.org(org.id) })
        }
        track(AnalyticsEvent.CourseStarted, {
          course_uuid: cleanCourseUuid,
          total_activities: allActivities.length,
          has_offers: linkedOffers.length > 0,
        })
        toast.success('Course started.', { id: loadingToast })
        goToActivity(allActivities[0] || null)
      } else {
        toast.dismiss(loadingToast)
        goToActivity(getContinueActivity())
      }
    } catch (error) {
      console.error('Failed to open course:', error)
      toast.error('Could not open the course. Please try again.', { id: loadingToast })
    } finally {
      setIsActionLoading(false)
    }
  }

  const handleApplyToContribute = async () => {
    if (!session.data?.user) {
      router.push(getUriWithOrg(orgslug, '/signup'))
      return
    }

    setIsContributeLoading(true)
    const loadingToast = toast.loading(t('courses.submitting_contributor_application'))
    try {
      await applyForContributor(
        'course_' + courseuuid,
        { message: 'I would like to contribute to this course.' },
        session.data?.tokens?.access_token
      )
      await refetch()
      track(AnalyticsEvent.ContributorApplicationSubmitted, { course_uuid: cleanCourseUuid })
      toast.success(t('courses.contributor_application_success'), { id: loadingToast })
    } catch (error) {
      console.error('Failed to apply as contributor:', error)
      toast.error(t('courses.contributor_application_error'), { id: loadingToast })
    } finally {
      setIsContributeLoading(false)
    }
  }

  const renderActionContent = () => (
    <>
      {session.data?.user ? (
        <UserAvatar
          width={24}
          use_with_session={true}
          rounded="rounded-full"
          border="border-2"
          borderColor="border-white"
        />
      ) : (
        <UserAvatar
          width={24}
          predefined_avatar="empty"
          rounded="rounded-full"
          border="border-2"
          borderColor="border-white"
        />
      )}
      <span>{isStarted ? 'Continue Course' : 'Start Course'}</span>
      <ArrowRight className="w-5 h-5" />
    </>
  )

  const renderContributorButton = () => {
    if (contributorStatus === 'INACTIVE' || course.open_to_contributors !== true) return null
    if (!session.data?.user) return null

    if (contributorStatus === 'ACTIVE') {
      return (
        <div className="w-full bg-green-50 text-green-700 border border-green-200 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 mt-3">
          <UserPen className="w-5 h-5" />
          {t('courses.you_are_contributor')}
        </div>
      )
    }
    if (contributorStatus === 'PENDING') {
      return (
        <div className="w-full bg-amber-50 text-amber-700 border border-amber-200 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 mt-3">
          <ClockIcon className="w-5 h-5" />
          {t('courses.contributor_application_pending')}
        </div>
      )
    }
    return (
      <button
        onClick={handleApplyToContribute}
        disabled={isContributeLoading}
        className="w-full bg-white text-neutral-700 border border-neutral-200 py-3 rounded-lg font-semibold hover:bg-neutral-50 flex items-center justify-center gap-2 mt-3"
      >
        <UserPen className="w-5 h-5" />
        {t('courses.apply_to_contribute')}
      </button>
    )
  }

  const renderProgressSection = () => {
    const totalActivities = allActivities.length
    const completedActivities = courseRun?.steps?.filter((step) => step.complete)?.length || 0
    const progressPercentage = totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0

    if (!isStarted) {
      return (
        <div className="relative bg-white nice-shadow rounded-lg overflow-hidden p-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-neutral-100 flex items-center justify-center">
              <BookOpen className="w-6 h-6 text-neutral-500" />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900">Ready to begin</div>
              <div className="text-sm text-gray-500">{totalActivities} learning activities</div>
            </div>
          </div>
        </div>
      )
    }

    return (
      <button
        type="button"
        onClick={() => setIsProgressOpen(true)}
        className="w-full text-left relative bg-white nice-shadow rounded-lg overflow-hidden p-4 hover:bg-neutral-50"
      >
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full border-[6px] border-neutral-100 flex items-center justify-center font-bold text-gray-800">
            {progressPercentage}%
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">Course Progress</div>
            <div className="text-sm text-gray-500">{completedActivities} of {totalActivities} completed</div>
          </div>
        </div>
      </button>
    )
  }

  if (isLoading) {
    return <div className="animate-pulse h-20 bg-gray-100 rounded-lg nice-shadow" />
  }

  if (session.data?.user && !isUserPartOfTheOrg) {
    return (
      <div className="bg-white nice-shadow rounded-lg p-4">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-3">
            <UserPlus className="w-5 h-5 text-amber-800" />
            <span className="text-amber-800 font-semibold">You need an Acyberschool invitation to access this course.</span>
          </div>
        </div>
      </div>
    )
  }

  // If the course is linked to a paid offer, learners who have not yet gained
  // access see the purchase option. Once enrolled, the same clean Continue
  // button is used; learners are never encouraged to leave a paid course.
  if (linkedOffers.length > 0 && !isStarted) {
    return (
      <div className="space-y-3">
        {linkedOffers.map((offer: any) => (
          <OfferCard key={offer.offer_id} offer={offer} orgslug={orgslug} />
        ))}
        {renderContributorButton()}
      </div>
    )
  }

  return (
    <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden p-4">
      <div className="space-y-4">
        {renderProgressSection()}
        <button
          onClick={handleCourseAction}
          disabled={isActionLoading}
          aria-label={isStarted ? 'Continue Course' : 'Start Course'}
          className="w-full py-3 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 text-white disabled:opacity-60"
          style={{ backgroundColor: BRAND_RED }}
        >
          {isActionLoading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            renderActionContent()
          )}
        </button>

        {renderContributorButton()}

        <CourseProgress
          course={course}
          orgslug={orgslug}
          isOpen={isProgressOpen}
          onClose={() => setIsProgressOpen(false)}
          trailData={trailData}
        />
      </div>
    </div>
  )
}

export default CoursesActions
