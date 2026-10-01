import { notFound } from 'next/navigation'
import { SectionEditor } from '@/components/section-editor'
import { SECTIONS, sectionBySlug } from '@/lib/sections'

export function generateStaticParams() {
  return SECTIONS.map((s) => ({ section: s.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params
  return { title: sectionBySlug(section)?.title ?? 'Profile' }
}

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section: slug } = await params
  if (!sectionBySlug(slug)) notFound()
  return <SectionEditor slug={slug} />
}
