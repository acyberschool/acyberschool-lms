'use client'

import { Input } from '@components/ui/input'
import { Textarea } from '@components/ui/textarea'
import FormLayout, { FormField, FormLabelAndMessage } from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { createNewCourse } from '@services/courses/courses'
import { createChapter } from '@services/courses/chapters'
import { createUserGroup, linkResourcesToUserGroup } from '@services/usergroups/usergroups'
import React from 'react'
import { BarLoader } from 'react-spinners'
import { revalidateTags } from '@services/utils/ts/requests'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import toast from 'react-hot-toast'
import { useFormik } from 'formik'
import * as Yup from 'yup'
import { LockKeyhole, UploadCloud } from 'lucide-react'
import FormTagInput from '@components/Objects/StyledElements/Form/TagInput'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

function CreateCourseModal({ closeModal, orgslug }: any) {
  const { track } = useLHAnalytics('dashboard')
  const router = useRouter()
  const session = useLHSession() as any
  const org = useOrg() as any
  const queryClient = useQueryClient()

  const validationSchema = Yup.object().shape({
    name: Yup.string().required('Course name is required').max(100),
    description: Yup.string().required('Course description is required').max(1000),
    learnings: Yup.string(),
    tags: Yup.string(),
    thumbnail: Yup.mixed().nullable(),
  })

  const formik = useFormik({
    initialValues: {
      name: '',
      description: '',
      learnings: '',
      tags: '',
      thumbnail: null,
    },
    validationSchema,
    onSubmit: async (values, { setSubmitting }) => {
      const token = session.data?.tokens?.access_token
      if (!org?.id || !token) {
        toast.error('Your admin session is still loading. Please try again.')
        setSubmitting(false)
        return
      }

      const loadingToast = toast.loading('Creating your private course...')
      try {
        const res = await createNewCourse(
          org.id,
          {
            name: values.name,
            description: values.description,
            learnings: values.learnings,
            tags: values.tags,
            visibility: false,
          },
          values.thumbnail,
          token
        )

        if (!res.success) {
          throw new Error(typeof res.data?.detail === 'string' ? res.data.detail : 'Course creation failed')
        }

        const course = res.data
        const courseUuid = course.course_uuid
        const courseId = courseUuid?.replace('course_', '') || courseUuid
        const courseOrgId = course.org_id ?? org.id

        try {
          await createChapter(
            {
              name: 'First Chapter',
              description: '',
              thumbnail_image: '',
              course_id: course.id,
              org_id: courseOrgId,
            },
            token
          )
        } catch {
          // The course remains valid if this convenience step fails.
        }

        let accessGroupLinked = false
        try {
          const groupResult = await createUserGroup(
            {
              name: `${values.name} Learners`,
              description: `Learner access for ${values.name}`,
              org_id: courseOrgId,
            },
            token
          )

          if (groupResult.status === 200 && groupResult.data?.id) {
            const linkResult = await linkResourcesToUserGroup(
              groupResult.data.id,
              courseUuid,
              courseOrgId,
              token
            )
            accessGroupLinked = linkResult.status === 200
          }
        } catch (error) {
          console.error('Could not create automatic course access group', error)
        }

        track(AnalyticsEvent.CourseCreated, {
          thumbnail_source: values.thumbnail ? 'upload' : 'none',
          visibility: 'private',
          has_learnings: !!values.learnings?.trim(),
        })

        await revalidateTags(['courses'], orgslug)
        queryClient.invalidateQueries({ queryKey: queryKeys.courses.list(orgslug) })
        queryClient.invalidateQueries({ queryKey: queryKeys.usergroups.list(org.id) })
        toast.dismiss(loadingToast)
        closeModal()

        if (accessGroupLinked) {
          toast.success('Private course created. Add content, then add learners to its access group.')
          router.push(`/dash/courses/course/${courseId}/content?new_activity=1`)
        } else {
          toast('Course created safely. Link a learner group before publishing.', { icon: '🔒' })
          router.push(`/dash/courses/course/${courseId}/access`)
        }
      } catch (error: any) {
        toast.error(error?.message || 'Failed to create course', { id: loadingToast })
      } finally {
        setSubmitting(false)
      }
    },
  })

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) formik.setFieldValue('thumbnail', file)
  }

  return (
    <FormLayout onSubmit={formik.handleSubmit}>
      <div className="mb-5 rounded-xl border border-[#C51635]/15 bg-[#C51635]/[0.04] p-4">
        <div className="flex items-start gap-3">
          <LockKeyhole className="mt-0.5 h-5 w-5 text-[#C51635]" />
          <div>
            <div className="font-bold text-gray-900">Assigned learners only</div>
            <p className="mt-1 text-sm leading-5 text-gray-500">
              Every Acyberschool course is private. A learner access group is created automatically. Only people you add to that group can open the course.
            </p>
          </div>
        </div>
      </div>

      <FormField name="name">
        <FormLabelAndMessage label="Course name" message={formik.errors.name} />
        <Form.Control asChild>
          <Input name="name" onChange={formik.handleChange} value={formik.values.name} required />
        </Form.Control>
      </FormField>

      <FormField name="description">
        <FormLabelAndMessage label="Description" message={formik.errors.description} />
        <Form.Control asChild>
          <Textarea name="description" onChange={formik.handleChange} value={formik.values.description} required />
        </Form.Control>
      </FormField>

      <FormField name="thumbnail">
        <FormLabelAndMessage label="Course image" message={formik.errors.thumbnail} />
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
          {formik.values.thumbnail ? (
            <img
              src={URL.createObjectURL(formik.values.thumbnail as File)}
              className="mb-4 h-32 w-full rounded-lg object-cover"
              alt="Course thumbnail preview"
            />
          ) : (
            <div className="mb-4 flex h-28 items-center justify-center rounded-lg bg-white text-sm text-gray-400">
              Add a course image if you have one
            </div>
          )}
          <input
            type="file"
            id="acyberschool-course-thumbnail"
            className="hidden"
            onChange={handleFileChange}
            accept="image/jpeg,image/png,image/webp,image/gif"
          />
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700"
            onClick={() => document.getElementById('acyberschool-course-thumbnail')?.click()}
          >
            <UploadCloud size={16} />
            Upload image
          </button>
        </div>
      </FormField>

      <FormField name="learnings">
        <FormLabelAndMessage label="What will learners achieve?" message={formik.errors.learnings} />
        <FormTagInput
          placeholder="Type a learning outcome and press Enter"
          value={formik.values.learnings}
          onChange={(value) => formik.setFieldValue('learnings', value)}
          error={formik.errors.learnings}
        />
      </FormField>

      <FormField name="tags">
        <FormLabelAndMessage label="Tags" message={formik.errors.tags} />
        <FormTagInput
          placeholder="Optional tags"
          value={formik.values.tags}
          onChange={(value) => formik.setFieldValue('tags', value)}
          error={formik.errors.tags}
        />
      </FormField>

      <div className="mt-6 flex justify-end">
        <Form.Submit asChild>
          <button
            type="submit"
            disabled={formik.isSubmitting}
            className="min-w-36 rounded-lg bg-black px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
          >
            {formik.isSubmitting ? <BarLoader width={70} color="#ffffff" /> : 'Create private course'}
          </button>
        </Form.Submit>
      </div>
    </FormLayout>
  )
}

export default CreateCourseModal
