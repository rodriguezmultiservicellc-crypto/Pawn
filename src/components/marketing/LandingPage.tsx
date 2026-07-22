'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  HandCoins,
  Wrench,
  ShoppingCart,
  Package,
  UsersThree,
  ShieldCheck,
  DeviceMobile,
  ChatCircle,
  ChartBar,
  Buildings,
  ArrowRight,
  Check,
  CaretDown,
  type Icon,
} from '@phosphor-icons/react'

/**
 * Sol Pawn public marketing landing (apex domain "/"). Self-contained +
 * bilingual — its own EN/ES toggle and copy dictionary, so it needs no
 * I18nProvider (the app i18n system is keyed for the product UI, not
 * marketing copy). Renders under the root layout, which already provides
 * globals.css tokens (navy / gold / blue / card / border …) + the font
 * stack. Design system: navy chrome + light canvas + gold CTA (DESIGN-
 * lunaazul.md), mirroring the product itself.
 */

type Lang = 'en' | 'es'

const NAV = {
  en: { modules: 'Modules', how: 'How it works', pricing: 'Pricing', faq: 'FAQ' },
  es: { modules: 'Módulos', how: 'Cómo funciona', pricing: 'Precios', faq: 'Preguntas' },
} as const

const COPY = {
  en: {
    login: 'Log in',
    startFree: 'Start free',
    getStarted: 'Get started',
    seePricing: 'See pricing',
    heroTitle: 'Every counter in your shop — finally one system',
    heroSub:
      'Pawn loans, repair tickets, retail POS, inventory, and compliance — one customer file across all of it. Built for pawn and jewelry shops, bilingual from day one.',
    trust: '14-day trial • No credit card • Cancel anytime',
    statsTitle: 'Every service. One counter',
    statsSub: 'A working ops console — not a brochure.',
    overviewTitle: 'Everything the front desk touches, in one place',
    modulesTitle: 'Ten modules, one login',
    modulesSub:
      'Turn on only what your shop runs. Jewelry-only? Skip pawn. Repair-only? Skip the loan book.',
    howTitle: 'Set it up in an afternoon. Use it forever',
    howSub: 'No consultants, no setup fee. You can be taking tickets today.',
    pricingTitle: 'Pay only for what your shop runs',
    pricingSub: 'Three plans, annual billing saves ~17%. Prices in USD.',
    mostPopular: 'Most popular',
    perMonth: '/mo',
    faqTitle: 'Questions you probably have',
    ctaTitle: 'Ready to run a calmer shop floor?',
    ctaSub:
      'Stop juggling spreadsheets, paper tickets, and three different apps. This is what your shop should have had all along.',
    footerTagline: 'The operating system for pawn & jewelry shops.',
    footerProduct: 'A product of Rodriguez Multi Service LLC.',
    colPlatform: 'Platform',
    colCompany: 'Company',
    linkPrivacy: 'Privacy',
    linkContact: 'Contact',
    rights: 'All rights reserved.',
  },
  es: {
    login: 'Iniciar sesión',
    startFree: 'Prueba gratis',
    getStarted: 'Empezar',
    seePricing: 'Ver precios',
    heroTitle: 'Cada mostrador de tu tienda — por fin en un solo sistema',
    heroSub:
      'Préstamos de empeño, órdenes de reparación, punto de venta, inventario y cumplimiento — una sola ficha del cliente para todo. Hecho para casas de empeño y joyerías, bilingüe desde el primer día.',
    trust: 'Prueba de 14 días • Sin tarjeta de crédito • Cancela cuando quieras',
    statsTitle: 'Todos los servicios. Un mostrador',
    statsSub: 'Una consola de operación real — no un folleto.',
    overviewTitle: 'Todo lo que pasa por el mostrador, en un solo lugar',
    modulesTitle: 'Diez módulos, un solo acceso',
    modulesSub:
      'Activa solo lo que usa tu tienda. ¿Solo joyería? Omite empeño. ¿Solo reparación? Omite el libro de préstamos.',
    howTitle: 'Configúralo en una tarde. Úsalo siempre',
    howSub: 'Sin consultores, sin costo de instalación. Puedes tomar órdenes hoy mismo.',
    pricingTitle: 'Paga solo por lo que usa tu tienda',
    pricingSub: 'Tres planes, la facturación anual ahorra ~17%. Precios en USD.',
    mostPopular: 'Más popular',
    perMonth: '/mes',
    faqTitle: 'Preguntas que seguramente tienes',
    ctaTitle: '¿Listo para un mostrador más tranquilo?',
    ctaSub:
      'Deja de hacer malabares con hojas de cálculo, tickets de papel y tres apps distintas. Esto es lo que tu tienda debió tener desde siempre.',
    footerTagline: 'El sistema operativo para casas de empeño y joyerías.',
    footerProduct: 'Un producto de Rodriguez Multi Service LLC.',
    colPlatform: 'Plataforma',
    colCompany: 'Compañía',
    linkPrivacy: 'Privacidad',
    linkContact: 'Contacto',
    rights: 'Todos los derechos reservados.',
  },
} as const

const STATS: ReadonlyArray<{
  en: { label: string; value: string }
  es: { label: string; value: string }
}> = [
  { en: { label: 'Active loans', value: '1,284' }, es: { label: 'Préstamos activos', value: '1,284' } },
  { en: { label: 'Loan book', value: '$92,410' }, es: { label: 'Cartera', value: '$92,410' } },
  { en: { label: 'Redeemed today', value: '37' }, es: { label: 'Rescatados hoy', value: '37' } },
  { en: { label: 'Repairs in progress', value: '18' }, es: { label: 'Reparaciones en curso', value: '18' } },
  { en: { label: 'Register today', value: '$4,860' }, es: { label: 'Caja hoy', value: '$4,860' } },
  { en: { label: 'Compliance exports', value: '12' }, es: { label: 'Exportes de cumplimiento', value: '12' } },
]

const OVERVIEW: ReadonlyArray<{
  en: { stat: string; label: string }
  es: { stat: string; label: string }
}> = [
  { en: { stat: '10', label: 'Integrated modules' }, es: { stat: '10', label: 'Módulos integrados' } },
  { en: { stat: '1', label: 'Customer file, every counter' }, es: { stat: '1', label: 'Ficha del cliente, todo mostrador' } },
  { en: { stat: '7', label: 'Roles & permissions' }, es: { stat: '7', label: 'Roles y permisos' } },
  { en: { stat: 'EN/ES', label: 'Fully bilingual' }, es: { stat: 'EN/ES', label: 'Totalmente bilingüe' } },
]

const MODULES: ReadonlyArray<{
  icon: Icon
  en: { title: string; desc: string }
  es: { title: string; desc: string }
}> = [
  {
    icon: HandCoins,
    en: { title: 'Pawn loans', desc: 'Intake, redeem, extend, forfeit. Per-state rate caps, ticket print & lock, full payment history.' },
    es: { title: 'Préstamos de empeño', desc: 'Ingreso, rescate, extensión, decomiso. Topes de tasa por estado, impresión y bloqueo de ticket, historial completo de pagos.' },
  },
  {
    icon: Wrench,
    en: { title: 'Repair & stone setting', desc: 'Multi-item tickets, work-order board, technician time logs, before/after photos, pickup signatures.' },
    es: { title: 'Reparación y montaje', desc: 'Órdenes de varios artículos, tablero de trabajo, registro de tiempo por técnico, fotos antes/después, firmas de entrega.' },
  },
  {
    icon: ShoppingCart,
    en: { title: 'Retail & POS', desc: 'Card-present via Stripe Terminal, layaway, returns, split tender, end-of-day register close.' },
    es: { title: 'Venta y punto de venta', desc: 'Tarjeta presente con Stripe Terminal, apartado, devoluciones, pago dividido, cierre de caja diario.' },
  },
  {
    icon: Package,
    en: { title: 'Inventory & spot pricing', desc: 'Metal weights, karat, stones, live gold/silver spot feed, melt values, multi-photo carousel.' },
    es: { title: 'Inventario y precio spot', desc: 'Peso del metal, quilates, piedras, precio spot de oro/plata en vivo, valor de fundición, carrusel de fotos.' },
  },
  {
    icon: UsersThree,
    en: { title: 'Customers & ID capture', desc: 'ID scan, physical description, banned-list flags, and jurisdiction-based retention rules.' },
    es: { title: 'Clientes y captura de ID', desc: 'Escaneo de ID, descripción física, marcas de lista negra y reglas de retención por jurisdicción.' },
  },
  {
    icon: ShieldCheck,
    en: { title: 'Compliance & police reports', desc: 'Write-once compliance log, FL LeadsOnline export, and enforced ID-retention windows.' },
    es: { title: 'Cumplimiento y reportes policiales', desc: 'Registro de cumplimiento de escritura única, exporte FL LeadsOnline y ventanas de retención de ID.' },
  },
  {
    icon: DeviceMobile,
    en: { title: 'Customer portal', desc: 'Pay off a loan by link, track repair status, view layaway balances — bilingual, self-service.' },
    es: { title: 'Portal del cliente', desc: 'Paga un préstamo por enlace, sigue el estado de la reparación, ve saldos de apartado — bilingüe y autoservicio.' },
  },
  {
    icon: ChatCircle,
    en: { title: 'Communications', desc: 'SMS, WhatsApp, and email. Maturity reminders, repair-ready alerts, layaway nudges — bilingual.' },
    es: { title: 'Comunicaciones', desc: 'SMS, WhatsApp y correo. Recordatorios de vencimiento, avisos de reparación lista, recordatorios de apartado — bilingüe.' },
  },
  {
    icon: ChartBar,
    en: { title: 'Reporting', desc: 'Daily register, pawn aging, redemptions & forfeitures, interest income, inventory turn, chain rollup.' },
    es: { title: 'Reportes', desc: 'Caja diaria, antigüedad de préstamos, rescates y decomisos, ingreso por interés, rotación de inventario, consolidado de cadena.' },
  },
  {
    icon: Buildings,
    en: { title: 'Multi-store & chains', desc: 'HQ rollup with branch isolation and one-click inventory transfers between sibling shops.' },
    es: { title: 'Multi-tienda y cadenas', desc: 'Consolidado de matriz con aislamiento por sucursal y traslados de inventario entre tiendas hermanas.' },
  },
]

const STEPS: ReadonlyArray<{
  en: { title: string; desc: string }
  es: { title: string; desc: string }
}> = [
  {
    en: { title: 'Sign up', desc: 'Create your shop in five minutes and pick the modules you run — pawn, repair, retail, or all three.' },
    es: { title: 'Regístrate', desc: 'Crea tu tienda en cinco minutos y elige los módulos que usas — empeño, reparación, venta o los tres.' },
  },
  {
    en: { title: 'Configure', desc: 'Add staff and set roles, load your rate tables, and import customers and inventory.' },
    es: { title: 'Personaliza', desc: 'Agrega personal y define roles, carga tus tablas de tasas e importa clientes e inventario.' },
  },
  {
    en: { title: 'Operate', desc: 'Run every counter from one dashboard, on any device on the floor.' },
    es: { title: 'Opera', desc: 'Maneja cada mostrador desde un panel, en cualquier dispositivo del piso.' },
  },
]

const PLANS: ReadonlyArray<{
  highlight?: boolean
  price: string
  en: { name: string; blurb: string; users: string; features: string[]; cta: string }
  es: { name: string; blurb: string; users: string; features: string[]; cta: string }
}> = [
  {
    price: 'Free',
    en: {
      name: 'Starter',
      blurb: 'One counter, one location.',
      users: 'Up to 1 user',
      cta: 'Start free',
      features: ['Pawn loans', 'Retail & POS', 'Customers & ID capture', 'Inventory & spot pricing', 'Daily register report'],
    },
    es: {
      name: 'Inicial',
      blurb: 'Un mostrador, una ubicación.',
      users: 'Hasta 1 usuario',
      cta: 'Prueba gratis',
      features: ['Préstamos de empeño', 'Venta y POS', 'Clientes y captura de ID', 'Inventario y precio spot', 'Reporte de caja diaria'],
    },
  },
  {
    highlight: true,
    price: '$79',
    en: {
      name: 'Pro',
      blurb: 'The full shop floor.',
      users: 'Up to 6 users',
      cta: 'Start free',
      features: ['Everything in Starter', 'Repair & stone setting', 'Compliance & police reports', 'SMS / WhatsApp / email', 'Customer portal', 'Full reporting suite'],
    },
    es: {
      name: 'Pro',
      blurb: 'Todo el piso de venta.',
      users: 'Hasta 6 usuarios',
      cta: 'Prueba gratis',
      features: ['Todo lo de Inicial', 'Reparación y montaje', 'Cumplimiento y reportes policiales', 'SMS / WhatsApp / correo', 'Portal del cliente', 'Suite completa de reportes'],
    },
  },
  {
    price: '$149',
    en: {
      name: 'Chain',
      blurb: 'HQ plus branches.',
      users: 'Up to 20 users',
      cta: 'Get started',
      features: ['Everything in Pro', 'Multi-store rollup', 'Inventory transfers', 'Chain-admin role', 'Priority support'],
    },
    es: {
      name: 'Cadena',
      blurb: 'Matriz más sucursales.',
      users: 'Hasta 20 usuarios',
      cta: 'Empezar',
      features: ['Todo lo de Pro', 'Consolidado multi-tienda', 'Traslados de inventario', 'Rol de administrador de cadena', 'Soporte prioritario'],
    },
  },
]

const FAQS: ReadonlyArray<{
  en: { q: string; a: string }
  es: { q: string; a: string }
}> = [
  {
    en: { q: 'Do I need a credit card to start?', a: 'No. Start on a 14-day trial with no card, and cancel anytime.' },
    es: { q: '¿Necesito tarjeta de crédito para empezar?', a: 'No. Empieza con una prueba de 14 días sin tarjeta y cancela cuando quieras.' },
  },
  {
    en: { q: 'Is it built for pawn compliance?', a: 'Yes. Every pawn and buy-outright transaction writes a permanent compliance record, and the FL LeadsOnline exporter reads straight from it. ID-retention windows are enforced automatically.' },
    es: { q: '¿Está hecho para el cumplimiento de empeño?', a: 'Sí. Cada empeño y compra directa genera un registro de cumplimiento permanente, y el exportador FL LeadsOnline lee directamente de él. Las ventanas de retención de ID se aplican automáticamente.' },
  },
  {
    en: { q: 'Can my staff have different access levels?', a: 'Yes. Each person gets a per-shop role — owner, manager, pawn clerk, repair tech, or appraiser — with only the access that role needs.' },
    es: { q: '¿Mi personal puede tener distintos niveles de acceso?', a: 'Sí. Cada persona recibe un rol por tienda — dueño, gerente, cajero de empeño, técnico de reparación o tasador — con solo el acceso que ese rol necesita.' },
  },
  {
    en: { q: 'Is everything bilingual?', a: 'Yes. The interface, printed tickets, and customer messages all render in English and Spanish — the customer’s language preference picks which one sends.' },
    es: { q: '¿Todo es bilingüe?', a: 'Sí. La interfaz, los tickets impresos y los mensajes al cliente se muestran en inglés y español — la preferencia de idioma del cliente decide cuál se envía.' },
  },
  {
    en: { q: 'Does it handle multiple stores?', a: 'Yes. A chain HQ rolls up every branch while keeping each shop’s book isolated, and inventory transfers between sibling stores are one click.' },
    es: { q: '¿Maneja varias tiendas?', a: 'Sí. Una matriz consolida cada sucursal manteniendo aislado el libro de cada tienda, y los traslados de inventario entre tiendas hermanas son de un clic.' },
  },
  {
    en: { q: 'What happens to my data?', a: 'Your shop’s data is isolated from every other tenant, encrypted at rest, and yours to export at any time.' },
    es: { q: '¿Qué pasa con mis datos?', a: 'Los datos de tu tienda están aislados de cualquier otro cliente, cifrados en reposo, y son tuyos para exportar en cualquier momento.' },
  },
]

export default function LandingPage({
  initialLang = 'en',
}: {
  initialLang?: Lang
}) {
  const [lang, setLang] = useState<Lang>(initialLang)
  const t = COPY[lang]
  const nav = NAV[lang]

  return (
    <main className="flex-1 bg-background text-foreground">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="font-display text-xl font-bold text-foreground">
            Sol Pawn
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-text-secondary md:flex">
            <a href="#modules" className="hover:text-foreground">{nav.modules}</a>
            <a href="#how" className="hover:text-foreground">{nav.how}</a>
            <a href="#pricing" className="hover:text-foreground">{nav.pricing}</a>
            <a href="#faq" className="hover:text-foreground">{nav.faq}</a>
          </nav>
          <div className="flex items-center gap-2.5">
            <LangToggle lang={lang} onChange={setLang} />
            <Link
              href="/login"
              className="hidden rounded-xl px-3.5 py-2 text-sm font-semibold text-foreground hover:bg-background sm:inline-block"
            >
              {t.login}
            </Link>
            <Link
              href="/onboard"
              className="rounded-xl bg-gold px-4 py-2 text-sm font-bold text-navy shadow-sm transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg"
            >
              {t.startFree}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.55]"
          style={{
            background:
              'radial-gradient(60% 55% at 50% 0%, color-mix(in srgb, var(--color-gold) 18%, transparent), transparent 70%)',
          }}
        />
        <div className="mx-auto max-w-4xl px-4 pb-14 pt-16 text-center sm:px-6 sm:pt-24">
          <h1 className="font-display text-4xl font-black leading-[1.08] tracking-tight text-foreground sm:text-6xl">
            {t.heroTitle}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-text-secondary">
            {t.heroSub}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/onboard"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gold px-7 text-base font-bold text-navy shadow-md transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg sm:w-auto"
            >
              {t.getStarted}
              <ArrowRight size={18} weight="bold" />
            </Link>
            <a
              href="#pricing"
              className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-border bg-card px-7 text-base font-semibold text-foreground transition-all hover:-translate-y-0.5 hover:shadow-lg sm:w-auto"
            >
              {t.seePricing}
            </a>
          </div>
          <p className="mt-5 text-sm font-medium text-muted">{t.trust}</p>
        </div>

        {/* Live stats strip */}
        <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
          <div className="rounded-2xl bg-navy p-5 shadow-lg sm:p-7">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/55">
                {t.statsTitle}
              </h2>
              <span className="text-[11px] text-white/40">{t.statsSub}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {STATS.map((s, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-3"
                >
                  <div className="font-mono text-xl font-extrabold tabular-nums text-gold">
                    {s[lang].value}
                  </div>
                  <div className="mt-0.5 text-[11px] font-medium text-white/60">
                    {s[lang].label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Overview stat cards ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <h2 className="text-center font-display text-2xl font-bold text-foreground sm:text-3xl">
          {t.overviewTitle}
        </h2>
        <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {OVERVIEW.map((o, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-5 text-center"
            >
              <div className="font-display text-3xl font-black text-gold sm:text-4xl">
                {o[lang].stat}
              </div>
              <div className="mt-1 text-sm font-medium text-text-secondary">
                {o[lang].label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Modules ─────────────────────────────────────────────────────── */}
      <section id="modules" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
            {t.modulesTitle}
          </h2>
          <p className="mt-3 text-text-secondary">{t.modulesSub}</p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map(({ icon: ModIcon, ...m }, i) => (
            <div
              key={i}
              className="group rounded-xl border border-border bg-card p-5 transition-all hover:-translate-y-1 hover:shadow-lg"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold/15 text-gold">
                <ModIcon size={22} weight="regular" />
              </span>
              <h3 className="mt-3.5 text-base font-bold text-foreground">
                {m[lang].title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
                {m[lang].desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section id="how" className="scroll-mt-20 bg-card/60 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
              {t.howTitle}
            </h2>
            <p className="mt-3 text-text-secondary">{t.howSub}</p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy font-mono text-lg font-bold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-lg font-bold text-foreground">
                  {s[lang].title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
                  {s[lang].desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────── */}
      <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
            {t.pricingTitle}
          </h2>
          <p className="mt-3 text-text-secondary">{t.pricingSub}</p>
        </div>
        <div className="mt-10 grid items-start gap-5 lg:grid-cols-3">
          {PLANS.map((p, i) => {
            const pl = p[lang]
            return (
              <div
                key={i}
                className={`relative rounded-2xl border bg-card p-6 ${
                  p.highlight
                    ? 'border-gold shadow-lg lg:-mt-3 lg:mb-3'
                    : 'border-border'
                }`}
              >
                {p.highlight ? (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gold px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-navy">
                    {t.mostPopular}
                  </span>
                ) : null}
                <h3 className="text-lg font-bold text-foreground">{pl.name}</h3>
                <p className="mt-0.5 text-sm text-text-secondary">{pl.blurb}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="font-display text-4xl font-black text-foreground">
                    {p.price}
                  </span>
                  {p.price !== 'Free' ? (
                    <span className="text-sm font-medium text-muted">{t.perMonth}</span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs font-medium text-muted">{pl.users}</div>
                <Link
                  href="/onboard"
                  className={`mt-5 flex h-11 w-full items-center justify-center rounded-xl text-sm font-bold transition-all hover:-translate-y-0.5 ${
                    p.highlight
                      ? 'bg-gold text-navy hover:bg-gold-2 hover:shadow-lg'
                      : 'border border-border bg-card text-foreground hover:shadow-lg'
                  }`}
                >
                  {pl.cta}
                </Link>
                <ul className="mt-5 space-y-2.5">
                  {pl.features.map((f, fi) => (
                    <li key={fi} className="flex items-start gap-2 text-sm text-text-secondary">
                      <Check size={16} weight="bold" className="mt-0.5 shrink-0 text-gold" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section id="faq" className="scroll-mt-20 bg-card/60 py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-center font-display text-3xl font-bold text-foreground sm:text-4xl">
            {t.faqTitle}
          </h2>
          <div className="mt-8 space-y-3">
            {FAQS.map((f, i) => (
              <FaqRow key={i} q={f[lang].q} a={f[lang].a} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="rounded-2xl bg-navy px-6 py-12 text-center shadow-lg sm:px-12 sm:py-16">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold text-white sm:text-4xl">
            {t.ctaTitle}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/70">{t.ctaSub}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/onboard"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gold px-7 text-base font-bold text-navy transition-all hover:-translate-y-0.5 hover:bg-gold-2 hover:shadow-lg sm:w-auto"
            >
              {t.startFree}
              <ArrowRight size={18} weight="bold" />
            </Link>
            <Link
              href="/login"
              className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-white/20 bg-white/[0.07] px-7 text-base font-semibold text-white transition-colors hover:bg-white/15 sm:w-auto"
            >
              {t.login}
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-card">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="font-display text-lg font-bold text-foreground">Sol Pawn</div>
            <p className="mt-2 max-w-xs text-sm text-text-secondary">
              {t.footerTagline}
            </p>
            <p className="mt-3 text-xs text-muted">{t.footerProduct}</p>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-muted">
              {t.colPlatform}
            </div>
            <ul className="mt-3 space-y-2 text-sm text-text-secondary">
              <li><a href="#modules" className="hover:text-foreground">{nav.modules}</a></li>
              <li><a href="#how" className="hover:text-foreground">{nav.how}</a></li>
              <li><a href="#pricing" className="hover:text-foreground">{nav.pricing}</a></li>
              <li><a href="#faq" className="hover:text-foreground">{nav.faq}</a></li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-muted">
              {t.colCompany}
            </div>
            <ul className="mt-3 space-y-2 text-sm text-text-secondary">
              <li><Link href="/login" className="hover:text-foreground">{t.login}</Link></li>
              <li>
                <a href="mailto:hello@solpawn.com" className="hover:text-foreground">
                  {t.linkContact}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-muted sm:flex-row sm:px-6">
            <span>© 2026 Rodriguez Multi Service LLC. {t.rights}</span>
            <LangToggle lang={lang} onChange={setLang} />
          </div>
        </div>
      </footer>
    </main>
  )
}

function LangToggle({
  lang,
  onChange,
}: {
  lang: Lang
  onChange: (l: Lang) => void
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-border">
      {(['en', 'es'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          aria-pressed={lang === l}
          className={`px-2.5 py-1.5 text-xs font-bold uppercase transition-colors ${
            lang === l
              ? 'bg-navy text-white'
              : 'bg-card text-text-secondary hover:text-foreground'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

function FaqRow({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
      >
        <span className="text-sm font-semibold text-foreground">{q}</span>
        <CaretDown
          size={16}
          weight="bold"
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <p className="px-4 pb-4 text-sm leading-relaxed text-text-secondary">{a}</p>
      ) : null}
    </div>
  )
}
