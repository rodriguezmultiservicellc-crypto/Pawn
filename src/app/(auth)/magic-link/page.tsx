import { Suspense } from 'react'
import MagicLinkForm from './form'

export default function MagicLinkPage() {
  return (
    <Suspense fallback={null}>
      <MagicLinkForm />
    </Suspense>
  )
}
