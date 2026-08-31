import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, errorHandling, secureFetch } from '@services/utils/ts/requests'

export type AppliedLearningEntry = {
  id: number
  entry_uuid: string
  user_id: number
  org_id: number
  course_uuid: string
  activity_uuid: string
  activity_name: string
  module_name: string
  planned_application: string
  previous_application: string
  measurable_change: string
  evidence_notes: string
  application_status: 'planned' | 'applied' | 'measured'
  created_at: string
  updated_at: string
}

export type AppliedLearningCapstone = {
  id: number
  capstone_uuid: string
  user_id: number
  org_id: number
  title: string
  challenge: string
  what_i_applied: string
  measurable_impact: string
  lessons_learned: string
  next_steps: string
  selected_entry_uuids: string[]
  status: 'draft' | 'ready' | 'submitted'
  created_at: string
  updated_at: string
}

export type LearningAttachment = {
  id: number
  attachment_uuid: string
  user_id: number
  org_id: number
  context_type: 'portfolio' | 'capstone'
  context_uuid: string
  kind: 'file' | 'link'
  original_name: string
  stored_name: string
  public_path: string
  external_url: string
  scan_status: 'clean' | 'pending_scan' | 'rejected' | 'scan_error'
  created_at: string
}

export type ReflectionPayload = {
  org_id: number
  course_uuid: string
  activity_uuid: string
  activity_name?: string
  module_name?: string
  planned_application: string
  previous_application?: string
  measurable_change?: string
  evidence_notes?: string
  application_status?: 'planned' | 'applied' | 'measured'
}

function normalizeCourseUuid(value: string) {
  return value.startsWith('course_') ? value : `course_${value}`
}

function normalizeActivityUuid(value: string) {
  return value.startsWith('activity_') ? value : `activity_${value}`
}

export async function getAppliedLearningReflection(activityUuid: string, token?: string) {
  const normalizedUuid = normalizeActivityUuid(activityUuid)
  const res = await secureFetch(
    `${getAPIUrl()}applied-learning/reflection/${encodeURIComponent(normalizedUuid)}`,
    RequestBodyWithAuthHeader('GET', null, null, token)
  )
  return errorHandling(res) as Promise<AppliedLearningEntry | null>
}

export async function saveAppliedLearningReflection(payload: ReflectionPayload, token?: string) {
  const normalizedPayload: ReflectionPayload = {
    ...payload,
    course_uuid: normalizeCourseUuid(payload.course_uuid),
    activity_uuid: normalizeActivityUuid(payload.activity_uuid),
  }
  const res = await secureFetch(
    `${getAPIUrl()}applied-learning/reflection`,
    RequestBodyWithAuthHeader('POST', normalizedPayload, null, token)
  )
  return errorHandling(res) as Promise<AppliedLearningEntry>
}

export async function getMyAppliedLearning(orgId?: number, token?: string) {
  const qs = orgId ? `?org_id=${orgId}` : ''
  const res = await secureFetch(
    `${getAPIUrl()}applied-learning/me${qs}`,
    RequestBodyWithAuthHeader('GET', null, null, token)
  )
  return errorHandling(res) as Promise<AppliedLearningEntry[]>
}

export async function getAppliedLearningSummary(orgId?: number, token?: string) {
  const qs = orgId ? `?org_id=${orgId}` : ''
  const res = await secureFetch(
    `${getAPIUrl()}applied-learning/me/summary${qs}`,
    RequestBodyWithAuthHeader('GET', null, null, token)
  )
  return errorHandling(res) as Promise<{ entries: number; applied: number; measured: number; courses: number }>
}

export async function getMyCapstones(orgId?: number, token?: string) {
  const qs = orgId ? `?org_id=${orgId}` : ''
  const res = await secureFetch(
    `${getAPIUrl()}applied-learning/capstones/me${qs}`,
    RequestBodyWithAuthHeader('GET', null, null, token)
  )
  return errorHandling(res) as Promise<AppliedLearningCapstone[]>
}

export async function saveCapstone(payload: Partial<AppliedLearningCapstone> & { org_id: number; title: string }, token?: string) {
  const res = await secureFetch(
    `${getAPIUrl()}applied-learning/capstones`,
    RequestBodyWithAuthHeader('POST', payload, null, token)
  )
  return errorHandling(res) as Promise<AppliedLearningCapstone>
}

export async function getLearningAttachments(
  orgId: number,
  contextType: 'portfolio' | 'capstone',
  contextUuid: string,
  token?: string
) {
  const params = new URLSearchParams({
    org_id: String(orgId),
    context_type: contextType,
    context_uuid: contextUuid,
  })
  const res = await secureFetch(
    `${getAPIUrl()}applied-learning/attachments?${params.toString()}`,
    RequestBodyWithAuthHeader('GET', null, null, token)
  )
  return errorHandling(res) as Promise<LearningAttachment[]>
}

export async function uploadLearningAttachment(
  orgId: number,
  contextType: 'portfolio' | 'capstone',
  contextUuid: string,
  file: File,
  token?: string
) {
  const params = new URLSearchParams({
    org_id: String(orgId),
    context_type: contextType,
    context_uuid: contextUuid,
  })
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${getAPIUrl()}applied-learning/attachments/file?${params.toString()}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
    credentials: 'include',
  })
  return errorHandling(res) as Promise<LearningAttachment>
}

export async function addLearningLink(
  orgId: number,
  contextType: 'portfolio' | 'capstone',
  contextUuid: string,
  url: string,
  label: string,
  token?: string
) {
  const res = await secureFetch(
    `${getAPIUrl()}applied-learning/attachments/link`,
    RequestBodyWithAuthHeader('POST', {
      org_id: orgId,
      context_type: contextType,
      context_uuid: contextUuid,
      url,
      label,
    }, null, token)
  )
  return errorHandling(res) as Promise<LearningAttachment>
}
