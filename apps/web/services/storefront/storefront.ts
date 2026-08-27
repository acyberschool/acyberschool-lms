import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests'

export interface StorefrontSection {
  type: string
  heading?: string | null
  body?: string | null
  image_url?: string | null
}

export interface StorefrontConfig {
  enabled: boolean
  headline?: string | null
  subheadline?: string | null
  cta_label: string
  price_minor: number
  currency: string
  sections: StorefrontSection[]
  custom_html?: string | null
  custom_html_enabled: boolean
}

export interface StoreCourse {
  id: number
  course_uuid: string
  name: string
  description?: string | null
  about?: string | null
  learnings?: string | null
  tags?: string | null
  thumbnail_type?: 'image' | 'video' | 'both' | null
  thumbnail_image?: string | null
  thumbnail_video?: string | null
  org_id: number
  org_uuid?: string | null
  org_slug?: string | null
  org_name?: string | null
  storefront: StorefrontConfig
}

export async function getStoreCourses(page = 1, limit = 24): Promise<{ items: StoreCourse[]; total: number }> {
  const res = await fetch(`${getAPIUrl()}store/courses?page=${page}&limit=${limit}`, { cache: 'no-store' })
  return errorHandling(res)
}

export async function getStoreCourse(courseUuid: string): Promise<StoreCourse> {
  const res = await fetch(`${getAPIUrl()}store/courses/${encodeURIComponent(courseUuid)}`, { cache: 'no-store' })
  return errorHandling(res)
}

export async function getStoreAccess(courseUuid: string, accessToken?: string) {
  const res = await fetch(
    `${getAPIUrl()}store/courses/${encodeURIComponent(courseUuid)}/access`,
    RequestBodyWithAuthHeader('GET', null, { cache: 'no-store' }, accessToken)
  )
  return errorHandling(res)
}

export async function enrollStoreCourse(courseUuid: string, accessToken?: string) {
  const res = await fetch(
    `${getAPIUrl()}store/courses/${encodeURIComponent(courseUuid)}/enroll`,
    RequestBodyWithAuthHeader('POST', null, null, accessToken)
  )
  return errorHandling(res)
}

export async function createStoreCheckout(courseUuid: string, accessToken?: string): Promise<{ checkout_url: string; session_id: string }> {
  const res = await fetch(
    `${getAPIUrl()}store/courses/${encodeURIComponent(courseUuid)}/checkout`,
    RequestBodyWithAuthHeader('POST', null, null, accessToken)
  )
  return errorHandling(res)
}

export async function getStoreEntry(courseUuid: string, accessToken?: string): Promise<{ org_slug: string; path: string; completed: boolean }> {
  const res = await fetch(
    `${getAPIUrl()}store/courses/${encodeURIComponent(courseUuid)}/entry`,
    RequestBodyWithAuthHeader('GET', null, { cache: 'no-store' }, accessToken)
  )
  return errorHandling(res)
}

export async function saveStoreLanding(courseUuid: string, config: StorefrontConfig, accessToken?: string): Promise<StoreCourse> {
  const res = await fetch(
    `${getAPIUrl()}store/courses/${encodeURIComponent(courseUuid)}/landing`,
    RequestBodyWithAuthHeader('PUT', config, null, accessToken)
  )
  return errorHandling(res)
}
