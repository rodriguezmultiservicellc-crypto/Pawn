import { Suspense } from 'react'
import CallbackHandler from './handler'

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackHandler />
    </Suspense>
  )
}
