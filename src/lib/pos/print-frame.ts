'use client'

/**
 * Print an HTML document straight to the printer: fetch it, load it into an
 * invisible same-origin frame and call print() on that frame. No new tab, no
 * PDF viewer — the browser's print step opens directly on the receipt.
 *
 * Rejects (so the caller can show an error) when the page cannot be loaded.
 */
export async function printHtmlFromUrl(url: string): Promise<void> {
  const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' })
  if (!res.ok) throw new Error(`print_fetch_${res.status}`)
  const html = await res.text()

  await new Promise<void>((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    // Off-screen but laid out: a display:none frame prints blank in some
    // browsers.
    Object.assign(frame.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '0',
      height: '0',
      border: '0',
      visibility: 'hidden',
    })

    let removed = false
    const cleanup = () => {
      if (removed) return
      removed = true
      frame.remove()
    }

    frame.onload = () => {
      const win = frame.contentWindow
      if (!win) {
        cleanup()
        reject(new Error('print_frame_unavailable'))
        return
      }
      win.addEventListener('afterprint', () => setTimeout(cleanup, 500))
      // Give fonts/layout a frame to settle before the print snapshot.
      setTimeout(() => {
        try {
          win.focus()
          win.print()
          resolve()
        } catch (err) {
          cleanup()
          reject(err instanceof Error ? err : new Error('print_failed'))
          return
        }
        // Safety net when afterprint never fires.
        setTimeout(cleanup, 60_000)
      }, 150)
    }

    frame.srcdoc = html
    document.body.appendChild(frame)
  })
}
