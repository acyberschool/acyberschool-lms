import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
  errorHandling,
  getResponseMetadata,
} from '@services/utils/ts/requests'

/**
 * Acyberschool is assignment-based: a learner should never see a paid course
 * merely because it exists in the same organization. The API's direct course
 * access policy is authoritative; this helper uses that same check to remove
 * inaccessible cards from learner lists and search results.
 */
async function filterToAssignedCourses(courses: any, next: any, access_token?: any) {
  if (!Array.isArray(courses)) return courses
  if (!access_token) return []

  const checked = await Promise.all(
    courses.map(async (course: any) => {
      if (!course?.course_uuid) return null
      try {
        const result = await fetch(
          `${getAPIUrl()}courses/${course.course_uuid}/meta?slim=true`,
          RequestBodyWithAuthHeader('GET', null, next, access_token)
        )
        return result.ok ? course : null
      } catch {
        return null
      }
    })
  )

  return checked.filter(Boolean)
}

export async function getOrgCourses(
  org_slug: string,
  next: any,
  access_token?: any,
  include_unpublished: boolean = false
) {
  const url = `${getAPIUrl()}courses/org_slug/${org_slug}/page/1/limit/100${include_unpublished ? '?include_unpublished=true' : ''}`
  const result: any = await fetch(
    url,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)

  // Dashboard/admin views ask explicitly for unpublished courses and should
  // retain the complete management list. Learner views only receive courses
  // that pass the explicit Acyberschool enrollment check.
  return include_unpublished ? res : filterToAssignedCourses(res, next, access_token)
}

export async function searchOrgCourses(
  org_slug: string,
  query: string,
  page: number = 1,
  limit: number = 10,
  next: any,
  access_token?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/org_slug/${org_slug}/search?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return filterToAssignedCourses(res, next, access_token)
}

export async function getCourseMetadata(
  course_uuid: string,
  next: any,
  access_token: string | null | undefined,
  options?: { slim?: boolean; withUnpublishedActivities?: boolean }
) {
  const searchParams = new URLSearchParams()
  if (options?.slim) searchParams.set('slim', 'true')
  if (options?.withUnpublishedActivities !== undefined) {
    searchParams.set('with_unpublished_activities', String(options.withUnpublishedActivities))
  }
  const qs = searchParams.toString() ? `?${searchParams.toString()}` : ''
  const result = await fetch(
    `${getAPIUrl()}courses/course_${course_uuid}/meta${qs}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token || undefined)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateCourse(course_uuid: any, data: any, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}`,
    RequestBodyWithAuthHeader('PUT', data, null,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourse(course_uuid: string, next: any, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourseById(course_id: string, next: any, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/id/${course_id}`,
    RequestBodyWithAuthHeader('GET', null, next,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateCourseThumbnail(course_uuid: any, formData: FormData, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/thumbnail`,
    RequestBodyFormWithAuthHeader('PUT', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function createNewCourse(
  org_id: string,
  course_body: any,
  thumbnail: any,
  access_token: any
) {
  const formData = new FormData()
  formData.append('name', course_body.name || '')
  formData.append('description', course_body.description || '')
  // Acyberschool courses are never created public. Learner access is explicit
  // via the automatically linked course UserGroup.
  formData.append('public', 'false')
  formData.append('learnings', course_body.learnings || '')
  formData.append('tags', course_body.tags || '')
  formData.append('about', course_body.description || '')

  if (thumbnail) {
    formData.append('thumbnail', thumbnail)
  }

  const result = await fetch(
    `${getAPIUrl()}courses/?org_id=${org_id}`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function deleteCourseFromBackend(course_uuid: any, access_token:any) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null,access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function cloneCourse(course_uuid: string, access_token: string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/clone`,
    RequestBodyWithAuthHeader('POST', null, null, access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function getCourseContributors(course_uuid: string, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/contributors`,
    RequestBodyWithAuthHeader('GET', null, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function editContributor(course_uuid: string, contributor_id: string, authorship: any, authorship_status: any, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/contributors/${contributor_id}?authorship=${authorship}&authorship_status=${authorship_status}`,
    RequestBodyWithAuthHeader('PUT', null, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function removeContributor(course_uuid: string, contributor_id: string, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/contributors/${contributor_id}`,
    RequestBodyWithAuthHeader('DELETE', null, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function applyForContributor(course_uuid: string, data: any, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/apply-contributor`,
    RequestBodyWithAuthHeader('POST', data, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function bulkAddContributors(course_uuid: string, data: any, access_token:string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/bulk-add-contributors`,
    RequestBodyWithAuthHeader('POST', data, null,access_token || undefined)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function bulkRemoveContributors(course_uuid: string, data: any, access_token: string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/bulk-remove-contributors`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token || undefined)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCourseRights(course_uuid: string, access_token: string | null | undefined) {
  const result: any = await fetch(
    `${getAPIUrl()}courses/${course_uuid}/rights`,
    RequestBodyWithAuthHeader('GET', null, null,access_token || undefined)
  )
  const res = await errorHandling(result)
  return res
}
