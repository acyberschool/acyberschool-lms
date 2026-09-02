import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

/*
 This file includes only POST, PUT, DELETE requests for the Media resource.
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
 (a GET helper is also exported for server-side fetching)

 NOTE: services/media/media.ts holds the thumbnail-directory helpers and must
 not be overwritten. This file holds the Media resource API service.
*/

/**
 * Build the media file URL for an uploaded media resource.
 *
 * SECURITY: this points at the authenticated, access-checked API endpoint
 * (GET /api/v1/media/{uuid}/file) — NOT the public storage/CDN URL. The browser
 * sends the session cookie (same-origin), so private-folder files are only
 * served to authorized users, and the storage path is never exposed. The
 * orgUuid/fileId params are kept for signature stability but unused.
 *
 * Pass `{ download: true }` for a save-as URL: the `download` attribute on an
 * anchor is ignored cross-origin, and media is served from the API host, so the
 * attachment disposition has to come from the server.
 */
export function getMediaFileDirectory(
  _orgUuid?: string,
  mediaUuid?: string,
  _fileId?: string,
  options?: { download?: boolean }
) {
  const base = `${getAPIUrl()}media/${mediaUuid}/file`
  return options?.download ? `${base}?download=true` : base
}

/**
 * Build a file URL for media attached to one course Resource activity.
 *
 * Unlike the general Media Library endpoint, this path authorizes through the
 * course activity first and only serves the exact media UUID stored on that
 * activity. An enrolled learner can therefore consume private course content
 * without receiving broad access to the organisation's Media Library.
 */
export function getCourseActivityMediaFileUrl(
  activityUuid: string,
  mediaUuid: string,
  options?: { download?: boolean }
) {
  const base = `${getAPIUrl()}media/course-activity/${activityUuid}/${mediaUuid}/file`
  return options?.download ? `${base}?download=true` : base
}

/** Protected PDF preview URL for an attached PPT/PPTX activity resource. */
export function getCourseActivityMediaPreviewUrl(
  activityUuid: string,
  mediaUuid: string
) {
  return `${getAPIUrl()}media/course-activity/${activityUuid}/${mediaUuid}/preview`
}

/**
 * Create a fresh, random share link for a media file. Each call mints a NEW
 * token (the URL is unique every time) and is revocable server-side. The link
 * still enforces the recipient's access — it is not a public capability.
 */
export async function createMediaShareLink(media_uuid: string, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}media/${media_uuid}/share-link`,
    RequestBodyWithAuthHeader('POST', {}, null, access_token)
  )
  return errorHandling(result)
}

/** Build the shareable, token-based file URL (random + unique every time). */
export function getMediaShareFileUrl(token: string, options?: { download?: boolean }) {
  const base = `${getAPIUrl()}media/shared/${token}/file`
  return options?.download ? `${base}?download=true` : base
}

export async function getOrgMedia(
  org_id: any,
  access_token?: string,
  next?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}media/org/${org_id}/page/1/limit/100`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getMediaById(
  media_uuid: string,
  access_token?: string,
  next?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}media/${media_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function createMedia(formData: FormData, access_token: any) {
  const result: any = await fetch(
    `${getAPIUrl()}media/`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateMedia(
  media_uuid: string,
  body: any,
  access_token: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}media/${media_uuid}`,
    RequestBodyWithAuthHeader('PUT', body, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function deleteMedia(media_uuid: string, access_token: any) {
  const result: any = await fetch(
    `${getAPIUrl()}media/${media_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}
