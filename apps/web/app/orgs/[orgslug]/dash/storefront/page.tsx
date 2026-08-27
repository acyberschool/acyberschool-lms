import StorefrontCoursePages from './storefront'

export const dynamic = 'force-dynamic'

export default async function StorefrontPagesPage({ params }: { params: Promise<{ orgslug: string }> }) {
  const { orgslug } = await params
  return <StorefrontCoursePages orgslug={orgslug} />
}
