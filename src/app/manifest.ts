import type { MetadataRoute } from 'next'
import { colors } from '@/lib/tokens'

/** Home-screen / installed-app identity. Icons are generated from the
 *  Sol Pawn app icon: src/app/icon.png (tab), apple-icon.png (iOS),
 *  favicon.ico, public/icon-{192,512}.png (this manifest). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sol Pawn',
    short_name: 'Sol Pawn',
    start_url: '/',
    display: 'standalone',
    background_color: colors.navy,
    theme_color: colors.navy,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
