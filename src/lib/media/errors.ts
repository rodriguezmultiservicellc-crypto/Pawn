/**
 * Classify a getUserMedia failure so the UI can give advice that matches what
 * actually went wrong.
 *
 * WHY: both camera and mic call sites used to show one message —
 * "Could not access camera. Check browser permissions." — for every failure.
 * That is actively misleading for the most common desktop failure,
 * NotReadableError, which means permission WAS granted and the device WAS
 * found, but the OS refused to hand it over (almost always another app already
 * holds it: Teams, Zoom, the Windows Camera app, another browser tab). Telling
 * someone to check permissions there sends them to the one place that is
 * already correct.
 *
 * Spec names plus the legacy aliases older browsers still throw:
 *   https://developer.mozilla.org/docs/Web/API/MediaDevices/getUserMedia#exceptions
 */

export type MediaErrorKind =
  /** User (or policy) blocked access. */
  | 'denied'
  /** Device exists and is permitted, but is busy or the OS refused it. */
  | 'inUse'
  /** No camera/microphone present at all. */
  | 'notFound'
  /** No device satisfies the requested constraints. */
  | 'constraints'
  /** Page is not a secure context — getUserMedia needs HTTPS or localhost. */
  | 'insecure'
  /** Anything else. */
  | 'unknown'

export function classifyMediaError(err: unknown): MediaErrorKind {
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name: unknown }).name)
      : ''

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'denied'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'inUse'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'notFound'
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'constraints'
    case 'SecurityError':
      return 'insecure'
    default:
      return 'unknown'
  }
}

/** The DOMException name, for the support-friendly suffix. '' when absent. */
export function mediaErrorName(err: unknown): string {
  return typeof err === 'object' && err !== null && 'name' in err
    ? String((err as { name: unknown }).name)
    : ''
}

/**
 * Build the user-facing string: the advice for what actually happened, plus the
 * raw error name in parentheses. The suffix stays because it is what lets an
 * operator paste something useful into a support message — that is exactly how
 * this bug was reported.
 */
export function mediaErrorMessage(
  err: unknown,
  messages: Record<MediaErrorKind, string>,
): string {
  const kind = classifyMediaError(err)
  const name = mediaErrorName(err)
  return name ? `${messages[kind]} (${name})` : messages[kind]
}
