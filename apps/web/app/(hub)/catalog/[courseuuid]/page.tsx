import CourseStorefrontLanding from '@components/Acyberschool/CourseStorefrontLanding'

export const dynamic = 'force-dynamic'

export default async function PublicCoursePage({ params }: { params: Promise<{ courseuuid: string }> }) {
  const { courseuuid } = await params
  return <CourseStorefrontLanding courseuuid={courseuuid} />
}
