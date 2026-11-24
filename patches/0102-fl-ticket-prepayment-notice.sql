-- 0102 — Florida pawn ticket: the "no refund for paying off early" line.
--
-- The shop's paper Florida Pawnbroker Transaction Form carries this sentence
-- beside the finance charge:
--
--   "If you pay off your loan early you will not be entitled to a refund of
--    part of the finance charge."
--
-- It was left off Pawn's ticket (Progress item 542) because Pawn then charged
-- by the day, which made it untrue. Since patches/0100 the charge is the full
-- 30-day period (Fla. Stat. § 539.001(11)(c): the charge for a redemption "at
-- any time within 30 days after the date of the pawn" is the whole amount of
-- paragraph (a)), so the sentence is true again and goes back on.
--
-- What it is, and is not:
--   - It is NOT one of the statements § 539.001(8)(b) requires on the form
--     (checked 2026-11-23: subsection (8) says nothing about refunds). It is
--     the shop's own disclosure, printed with the jurisdiction's notices
--     because the ticket prints no wording from code (CLAUDE.md rule 18).
--   - It speaks of the FINANCE CHARGE on the ticket — the charge for the
--     first period. It does not touch § 539.001(11)(c)'s last sentence ("Any
--     unused pawn service charge paid in advance by the pledgor shall be
--     refunded by the pawnbroker"), which is about charges paid ahead.
--
-- Printed first, right under the lending boxes it explains. Not bold.
-- Running this again changes nothing.

UPDATE jurisdictions
   SET ticket_notices =
         jsonb_build_array(
           jsonb_build_object(
             'bold', false,
             'en', 'If you pay off your loan early you will not be entitled to a refund of part of the finance charge.',
             'es', 'Si usted paga su préstamo antes de tiempo, no tendrá derecho a un reembolso de parte del cargo financiero.'
           )
         ) || ticket_notices,
       verified_on = DATE '2026-11-23',
       verified_source = 'Fla. Stat. § 539.001 (2026), subsections (8)(b), (9)(a), (9)(c), (10), (11)(a)-(c), (11)(e), (12)(c)'
 WHERE code = 'US-FL'
   AND NOT EXISTS (
     SELECT 1
       FROM jsonb_array_elements(ticket_notices) AS n
      WHERE n->>'en' LIKE 'If you pay off your loan early%'
   );
