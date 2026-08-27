import CourseLandingEditor from '@components/Acyberschool/CourseLandingEditor'

export const dynamic = 'force-dynamic'

export default async function CourseLandingPageEditor({ params }: { params: Promise<{ orgslug: string; courseuuid: string }> }) {
  const { orgslug, courseuuid } = await params
  return <CourseLandingEditor orgslug={orgslug} courseuuid={courseuuid} />
}
