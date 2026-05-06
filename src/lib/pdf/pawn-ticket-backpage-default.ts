/**
 * Default reverse-side ("backpage") text for the bilingual pawn ticket PDF.
 *
 * Source: Florida Ch. 539 standard pawn ticket reverse. The front of the
 * ticket is bilingual EN+ES per CLAUDE.md Rule 6, but the legal disclosure
 * block is English-only — the ticket is a legal document and the operator
 * confirmed it must print in English regardless of customer language
 * preference.
 *
 * Operators override this per-tenant via settings.pawn_ticket_backpage on
 * /settings/loan-rates. NULL/empty in DB = fall back to this text.
 *
 * Sections are separated by `--` (rendered as horizontal rules) and
 * paragraphs by blank lines (rendered with paragraph spacing). The
 * blank-underscore lines in the form sections (LOST PAWN TICKET STATEMENT,
 * REDEEMER'S IDENTIFICATION) print as actual lines for handwriting.
 */

export const PAWN_TICKET_BACKPAGE_DEFAULT = `In consideration of and to secure the amount identified as the Total of Payments, Pledgor hereby deposits with the issuer of this pawn ticket the Pledged Goods described on the reverse hereof.

The Pledgor/Seller represents and warrants that the pledged/sold goods are not stolen, rented, or leased, and that they have no liens or encumbrances against them. Pledgor/Seller also attests to be the rightful owner of the pledged/sold property, and that Pledgor/Seller has the right to pledge/sell the property. Pledgor/Seller attests that the Pledgor/Seller is not in voluntary or involuntary bankruptcy of any type and is at least 18 years of age.

Any personal property pledged to a Pawnbroker within this state which is not redeemed within 30 days following the maturity date of the pawn, if the 30th day is not a business day, then the following business day, is automatically forfeited to the Pawnbroker, and absolute right, title, and interest in and to the property vests in and is deemed conveyed to the Pawnbroker by operation of law, and no further notice is necessary. The Pledgor is not obligated to redeem the pledged goods.

In this pawn transaction a Pawnbroker may contract for and receive a pawn service charge (Finance Charge) of 25 percent of the Amount Financed for each 30 day period, except that the Pawnbroker is entitled to receive a minimum pawn service charge of $5.00 for each such 30 day period. This pawn service charge consists of 2 percent interest charge and the remainder in storage and service fees.

On pledged goods redeemed within the first 30 days from the date of the pawn transaction, a Pawnbroker may collect a 25 percent pawn service charge. On pledged goods redeemed after the first 30 days but before the 61st day after the date of the pawn transaction, a Pawnbroker may collect a pawn service fee equal to twice the amount charged for the first 30 day period.

A pawn may be extended upon mutual agreement of the parties. In this event, the daily pawn service charge for the extension shall be equal to one-thirtieth of the original pawn service charge.

Proper identification required on all redemptions. Firearms only redeemable by the original Pledgor. On other types of loans and during the first 30 days after the original transaction date only the original Pledgor or Pledgor's attorney-in-fact may redeem the pledged goods. After the first 30 days, only the original Pledgor or the Pledgor's authorized representative is entitled to redeem the pledged goods (firearms excluded); however, if the Pawnbroker determines that the person is not the original Pledgor, or the Pledgor's authorized representative, the Pawnbroker is not required to allow the redemption of the pledged goods by such person. The person redeeming the pledged goods must sign the Pledgor's copy of the pawnbroker transaction form, which the pawnbroker will retain as evidence of the person's receipt of the pledged goods. If the person redeeming the pledged goods is the Pledgor's authorized representative, that person must present notarized authorization from the original Pledgor and show identification to the Pawnbroker and the Pawnbroker shall record that person's name, address and identification on the pawnbroker transaction form retained by the pawnshop.

Any person who knowingly gives false verification of ownership or gives a false or altered identification and who receives money from a Pawnbroker for goods sold or pledged commits:
(a) If the value of the money received is less than $300, a felony of the third degree, punishable as provided in s.775.082, s.775.083, or s.775.084.
(b) If the value of the money received is $300 or more, a felony of the second degree, punishable as provided in s.775.082, s.775.083, or s.775.084.

If the pawnbroker transaction form is lost, destroyed, or stolen, the Pledgor must immediately advise the issuing Pawnbroker in writing by certified or registered mail, return receipt requested, or in person evidenced by a signed receipt.

If the pledged goods are lost or damaged while in the Pawnbroker's possession, the Pawnbroker may satisfy the Pledgor's claim by replacing the item with like kind of merchandise of equal value, with which the Pledgor can reasonably replace the goods. Such replacement is a defense to any civil action based upon the loss or damage of the goods.

In the event of litigation or arbitration, the losing party shall be responsible for all the attorney's fees of both parties.

Pledged goods may be redeemed by mail by agreement between the Pledgor and the Pawnbroker. The Pledgor must pay in advance all monies due and a charge by the Pawnbroker to recover the cost and expenses involved in packaging, insuring, and shipping of the pledged goods. The Pawnbroker shall insure the pledged goods in an amount acceptable to the Pledgor. The Pawnbroker's liability for loss or damage in connection with the shipment of such pledged goods is limited to the amount of the insurance coverage obtained.

No oral representation shall in any way change or modify these written conditions, and such oral representations shall in no way be binding upon the issuer of this pawn ticket.

* PROPER IDENTIFICATION REQUIRED ON ALL REDEMPTIONS * FIREARMS ONLY REDEEMABLE BY THE ORIGINAL PLEDGOR *
* NO GOODS SHOWN FOR REDEMPTION UNLESS PAID IN ADVANCE * NO PERSONAL CHECKS ACCEPTED * NO GOODS SENT COD *
* VERBAL AGREEMENTS FOR ADDITIONAL DAYS ARE NON BINDING *
* NOTICE: See Reverse Side *

--

LOST PAWN TICKET STATEMENT

Fee: $2.00                                Date ____________________

My ticket was      lost,      destroyed,      stolen.  (Circle proper word)

Pledgor _______________________________________________

Pledgor's I.D. Type & Number __________________________

Employee/PS ___________________________________________

--

I HEREBY ACKNOWLEDGE RECEIPT OF PLEDGED PROPERTY
LISTED ON THE REVERSE SIDE OF THIS CONTRACT.

X _______________________________________________
   Redeemer's Signature                       Date

REDEEMER'S IDENTIFICATION IF OTHER THAN ORIGINAL PLEDGOR

Name: _________________________________________________

Address: ______________________________________________

ID Number and Type ____________________________________

                                  Right Thumb Print of Pledgor/Seller`
