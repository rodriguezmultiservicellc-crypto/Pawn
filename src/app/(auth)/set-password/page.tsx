import { Suspense } from 'react'
import SetPasswordForm from './form'

export default function SetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <SetPasswordForm />
    </Suspense>
  )
}
