import { startTransition, type FormEvent } from 'react'

/**
 * onSubmit handler for a form driven by useActionState.
 *
 * React resets a `<form action={fn}>` after the action runs: every field goes
 * back to its default, but component state does not. A checkbox held in state
 * then shows unticked while the page still treats it as on, and the next Save
 * sends the wrong value. Submitting through onSubmit keeps what the person
 * typed — after a rejected save and after a good one.
 *
 *   const [state, action, pending] = useActionState(saveAction, {})
 *   <form onSubmit={submitKeepingValues(action)}>
 */
export function submitKeepingValues(action: (formData: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(() => action(formData))
  }
}
