/**
 * Pawn ticket PDF — bilingual EN+ES per CLAUDE.md Rule 6.
 *
 * The document, in print order:
 *   1. Customer copy — the transaction form (PawnTransactionForm.tsx)
 *   2. Reverse side — the shop's reverse-side text, sized to fit one side
 *   3. Store copy — the same form
 * A duplex printer backs the customer's sheet with the reverse.
 *
 * Imagery: collateral photos are NOT embedded. Paper isn't a great medium
 * for jewelry thumbs and the ticket is regulatory not marketing. Customer
 * signature IS embedded if present (passed in as a base64 data URL or
 * absolute http/https URL via PawnTicketData.signatureImage).
 *
 * Legal disclosure block: the statutory statements come from the tenant's
 * jurisdiction row (jurisdictions.ticket_notices, patches/0048), printed
 * EN + ES side by side. Tenants with no jurisdiction on file fall back to
 * the generic placeholder in i18n (pawn.print.legal.*). The Spanish column
 * is a courtesy translation; the English text is the statutory statement.
 *
 * Type discipline: PawnTicketData is exported and the route handler /
 * render helper builds it from the user-scoped Supabase client. Every
 * field is required EXCEPT photos / signature paths (optional, may be
 * null).
 */

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import { reportColors } from '@/lib/tokens'
import type { Dictionary } from '@/lib/i18n/en'
import type { TicketNotice } from '@/lib/jurisdictions/rules'
import { TransactionFormContinuation, TransactionFormPage } from './PawnTransactionForm'
import type {
  InventoryCategory,
  LoanStatus,
  MetalType,
} from '@/types/database-aliases'

// ── Types ──────────────────────────────────────────────────────────────────

export type PawnTicketCollateral = {
  description: string
  category: InventoryCategory
  metal_type: MetalType | null
  karat: number | null
  weight_grams: number | null
  est_value: number
  // FS 539.001 + per-category attributes (patches/0041, 0043). Printed as a
  // full-width detail sub-line under each row to satisfy the statute's item-
  // description requirements (serial, color, gemstones, finish, etc.).
  jewelry_size: string | null
  color: string | null
  gemstone_description: string | null
  // Jewelry details (patches/0106): gender + style are the shop's own;
  // brand / model / serial are FS 539.001(8)(b)2.a-c for a watch or a
  // signed piece and print in the Serial and Brand · Model cells.
  jewelry_gender: string | null
  jewelry_style: string | null
  jewelry_brand: string | null
  jewelry_model: string | null
  jewelry_serial: string | null
  unique_marks: string | null
  firearm_make: string | null
  firearm_model: string | null
  firearm_caliber: string | null
  firearm_serial_number: string | null
  firearm_type: string | null
  firearm_barrel_length_inches: number | null
  firearm_action_type: string | null
  firearm_capacity: number | null
  firearm_finish: string | null
  firearm_number_of_barrels: number | null
  electronic_brand: string | null
  electronic_model: string | null
  electronic_serial: string | null
  tool_brand: string | null
  tool_model: string | null
  // The rest of FS 539.001(8)(b)2.a-d (patches/0107).
  tool_serial: string | null
  general_brand: string | null
  general_model: string | null
  general_serial: string | null
  /** Size of anything that is not jewelry; prints in the Size cell. */
  item_size: string | null
}

export type PawnTicketCustomer = {
  first_name: string
  last_name: string
  middle_name: string | null
  sex: string | null
  race: string | null
  height_inches: number | null
  weight_lbs: number | null
  eye_color: string | null
  hair_color: string | null
  identifying_marks: string | null
  place_of_employment: string | null
  /** The customer's second phone — the form's "Business phone". */
  phone_alt: string | null
  date_of_birth: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  id_type: string | null
  id_number: string | null
  id_state: string | null
}

export type PawnTicketTenant = {
  name: string
  dba: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
}

export type PawnTicketData = {
  /** Which transaction the form records (FL § 539.001(8)(a): "an indication
   *  of whether the transaction is a pawn or a purchase", patches/0115). A
   *  purchase prints its amount paid instead of the lending boxes, no
   *  maturity or default date, no pawn-only statement and no reverse; its
   *  `principal` is the amount paid. */
  transaction: 'pawn' | 'purchase'
  ticket_number: string
  status: LoanStatus
  principal: number
  issue_date: string
  due_date: string
  /** Total interest at end-of-term (principal × monthlyRate × term/30). */
  total_interest_at_term: number
  /** Total payoff at end-of-term (principal + total_interest_at_term). */
  total_payoff_at_term: number
  /** Finance charge over the term as a yearly rate (charge ÷ principal × 365 ÷ term days). */
  apr: number
  /** Time of day the ticket was written, in the shop's timezone ("11:02 AM"). */
  transaction_time: string
  /** Last day to redeem: maturity + the jurisdiction's grace. */
  default_date: string
  /** What redeeming costs on that day, figured with the app's own loan math. */
  amount_at_default: number
  /** The tenant's jurisdiction ("Florida") — heads the form. Null when none is on file. */
  jurisdiction_name: string | null
  customer: PawnTicketCustomer
  tenant: PawnTicketTenant
  collateral: ReadonlyArray<PawnTicketCollateral>
  /** Optional signature image. Either a data URL ('data:image/png;base64,…')
   *  or an absolute http/https URL (signed Storage URL). Null when missing. */
  signatureImage: string | null
  /** Pre-resolved bilingual dictionaries. We accept both because i18n is
   *  set up as a client-side React Context — server code hands the strings
   *  in directly. */
  i18n: { en: Dictionary; es: Dictionary }
  /** English-only legal disclosure printed on the reverse side. The pawn
   *  ticket is a legal document — operator confirmed this block must be
   *  English regardless of customer language preference. Resolved upstream
   *  from settings.pawn_ticket_backpage, falling back to the tenant
   *  jurisdiction's ticket_backpage (patches/0048). Empty = no reverse page. */
  backpage_text: string
  /** Statutory statements from the tenant's jurisdiction, printed in the
   *  sheet's language. Empty = generic placeholder (no jurisdiction on file). */
  legal_notices: ReadonlyArray<TicketNotice>
  /** Add the Spanish courtesy translation after the legal (English) copies:
   *  the customer reads Spanish (customers.language = 'es'). */
  spanish_copy: boolean
  /** Print ONLY the Spanish courtesy translation ("Spanish copy" button). */
  spanish_only: boolean
}

// ── Styles ─────────────────────────────────────────────────────────────────

const PALETTE = {
  ink: reportColors.ink,
  body: reportColors.body,
  muted: reportColors.muted,
  divider: reportColors.divider,
} as const

const styles = StyleSheet.create({
  // ── Footer
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: PALETTE.muted,
  },
  footerTicket: {
    fontFamily: 'JetBrains Mono',
    fontSize: 7,
    color: PALETTE.muted,
  },

  // ── Backpage (reverse-side legal disclosure, English-only)
  backpagePage: {
    paddingTop: 26,
    paddingBottom: 30,
    paddingHorizontal: 32,
    fontSize: 6.6,
    fontFamily: 'Inter',
    fontWeight: 500,
    color: PALETTE.body,
    lineHeight: 1.35,
  },
  backpageHeader: {
    fontSize: 9,
    fontWeight: 700,
    color: PALETTE.ink,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  backpageParagraph: {
    fontSize: 6.6,
    color: PALETTE.body,
    marginBottom: 3.5,
    lineHeight: 1.28,
  },
  backpageMonoLine: {
    fontFamily: 'JetBrains Mono',
    fontSize: 6.6,
    color: PALETTE.body,
    marginBottom: 1,
    lineHeight: 1.3,
  },
  backpageRule: {
    borderBottomWidth: 1,
    borderBottomColor: PALETTE.divider,
    borderBottomStyle: 'solid',
    marginVertical: 4,
  },
})

// ── Backpage block parser ──────────────────────────────────────────────────
//
// The backpage text is plain English with paragraph breaks (\n\n) and section
// separators ("--" on its own line). Lines containing 3+ consecutive
// underscores are treated as form-field lines and rendered in monospace so
// the underscores form continuous handwriting rules.

type BackpageBlock =
  | { kind: 'rule' }
  | { kind: 'paragraph'; lines: string[]; mono: boolean }

function parseBackpageBlocks(text: string): BackpageBlock[] {
  const blocks: BackpageBlock[] = []
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/)

  for (const raw of paragraphs) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (/^--+$/.test(trimmed)) {
      blocks.push({ kind: 'rule' })
      continue
    }
    const lines = raw.split('\n')
    const mono = lines.some((ln) => /_{3,}/.test(ln))
    blocks.push({ kind: 'paragraph', lines, mono })
  }
  return blocks
}

// ── Component ──────────────────────────────────────────────────────────────

export default function PawnTicketPDF({ data }: { data: PawnTicketData }) {
  // The reverse is the pawn's terms: a purchase has none.
  const hasReverse = data.transaction === 'pawn' && data.backpage_text.trim() !== ''
  const docTitle = `${data.transaction === 'purchase' ? 'Purchase' : 'Pawn'} Ticket ${data.ticket_number}`
  const reverse = hasReverse ? <ReversePage data={data} /> : null

  if (data.spanish_only) {
    return (
      <Document title={`${docTitle} — Spanish courtesy copy`}>
        <TransactionFormPage data={data} copy="courtesy" />
        <TransactionFormContinuation data={data} copy="courtesy" />
      </Document>
    )
  }

  return (
    <Document title={docTitle}>
      {hasReverse ? (
        <>
          {/* Blank paper (settings.pawn_ticket_print_reverse, patches/0109):
              each copy's front is followed by the reverse, so a duplex
              printer backs BOTH the customer's and the store's sheet with
              the terms. Items that did not fit on a front come last, so
              they never take a reverse's place. */}
          <TransactionFormPage data={data} copy="customer" />
          {reverse}
          <TransactionFormPage data={data} copy="store" />
          {reverse}
          <TransactionFormContinuation data={data} copy="customer" />
          <TransactionFormContinuation data={data} copy="store" />
        </>
      ) : (
        <>
          {/* Paper with the back already printed, or no terms on file: each
              front, then the items that did not fit on it. */}
          <TransactionFormPage data={data} copy="customer" />
          <TransactionFormContinuation data={data} copy="customer" />
          <TransactionFormPage data={data} copy="store" />
          <TransactionFormContinuation data={data} copy="store" />
        </>
      )}

      {/* The Spanish courtesy translation, last and on its own sheets, stamped
          across as not legally valid. The reverse terms are not translated. */}
      {data.spanish_copy ? (
        <>
          <TransactionFormPage data={data} copy="courtesy" />
          <TransactionFormContinuation data={data} copy="courtesy" />
        </>
      ) : null}
    </Document>
  )
}

/** The reverse side: the terms, English only — the ticket is a legal
 *  document. Printed behind each copy's front on blank paper. */
function ReversePage({ data }: { data: PawnTicketData }) {
  const en = data.i18n.en.pawn.print
  return (
      <Page size="LETTER" style={styles.backpagePage} wrap>
        <Text style={styles.backpageHeader}>
          {en.backpage.header}
        </Text>
        {parseBackpageBlocks(data.backpage_text).map((block, i) => {
          if (block.kind === 'rule') {
            return <View key={i} style={styles.backpageRule} />
          }
          const style = block.mono
            ? styles.backpageMonoLine
            : styles.backpageParagraph
          return (
            <View key={i} style={{ marginBottom: block.mono ? 5 : 0 }}>
              {block.lines.map((line, j) => (
                <Text key={j} style={style}>
                  {line || ' '}
                </Text>
              ))}
            </View>
          )
        })}

        {/* ── Footer: the ticket it backs. No page number — the same
            reverse prints behind each copy. */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerTicket}>
            {data.ticket_number}  ·  {data.tenant.dba?.trim() || data.tenant.name}
          </Text>
        </View>
      </Page>
  )
}
