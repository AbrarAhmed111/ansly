import { TailorForm } from './tailor-form'

export const metadata = { title: 'Tailor for a job' }

const param = (value: string | string[] | undefined) => (typeof value === 'string' ? value.slice(0, 2000) : undefined)

export default async function TailorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  return <TailorForm prefill={{ title: param(params.title), company: param(params.company), url: param(params.url) }} />
}
