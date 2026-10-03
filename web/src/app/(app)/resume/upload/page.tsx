import { UploadResume } from './upload-resume'

export const metadata = { title: 'Master resume' }

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams
  return <UploadResume resumeId={id ?? null} />
}
