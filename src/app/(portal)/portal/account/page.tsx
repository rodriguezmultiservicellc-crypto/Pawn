import { resolvePortalCustomer } from '@/lib/portal/customer'
import AccountContent from './content'

/**
 * Customer portal account settings — currently just "set or change
 * password." Email is read-only (it's the auth identity). Future home
 * for language preference, communication preferences, etc.
 */
export default async function PortalAccountPage() {
  const customer = await resolvePortalCustomer()
  return (
    <AccountContent
      email={customer.customerEmail}
      customerName={customer.customerName}
    />
  )
}
