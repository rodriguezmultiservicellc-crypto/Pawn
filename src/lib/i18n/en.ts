/**
 * English translations — source of truth for keys.
 *
 * Add a key here AND to es.ts simultaneously. The pre-push hook
 * (.githooks/pre-push) compares key sets and rejects pushes where en.ts
 * and es.ts diverge.
 *
 * Phase 0 covers common, nav, auth, dashboard placeholder, noTenant, admin.
 * Add module sections (customers, inventory, pawn, repair, pos, reports,
 * compliance, team, settings) as those phases land.
 */

export const en = {
  common: {
    appName: 'Pawn',
    loading: 'Loading…',
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    back: 'Back',
    confirm: 'Confirm',
    yes: 'Yes',
    no: 'No',
    search: 'Search',
    next: 'Next',
    previous: 'Previous',
    close: 'Close',
    error: 'Something went wrong',
    requiredField: 'Required',
  },

  lang: {
    en: 'English',
    es: 'Español',
    toggle: 'Language',
  },

  nav: {
    dashboard: 'Dashboard',
    customers: 'Customers',
    inventory: 'Inventory',
    pawn: 'Pawn',
    repair: 'Repair',
    pos: 'POS',
    reports: 'Reports',
    compliance: 'Compliance',
    team: 'Team',
    settings: 'Settings',
    logOut: 'Log out',
    portal: 'My Account',
    portalLoans: 'My loans',
    portalRepairs: 'My repairs',
    portalLayaways: 'My layaways',
  },

  auth: {
    signIn: 'Sign in',
    signOut: 'Sign out',
    email: 'Email',
    password: 'Password',
    forgotPassword: 'Forgot your password?',
    magicLink: 'Email me a sign-in link',
    sendMagicLink: 'Send link',
    magicLinkSent: 'Check your email for a sign-in link.',
    setPassword: 'Set password',
    setPasswordSubmit: 'Set password',
    passwordResetSent:
      "If that email is registered, we've sent a reset link.",
    invalidCredentials: 'Email or password is incorrect.',
    sessionExpired: 'Your session expired. Please sign in again.',
    inviteExpired:
      'Your invite link has expired or was already used. Ask an owner to resend it.',
  },

  dashboard: {
    title: 'Dashboard',
    welcome: 'Welcome',
    placeholder: 'Phase 0 skeleton — full dashboard ships in Phase 1.',
  },

  noTenant: {
    title: 'No shop assigned',
    body: "You're signed in but you don't have access to a shop yet. Ask the owner to invite you, or sign in with a different account.",
    signOut: 'Sign out',
  },

  admin: {
    tenants: {
      title: 'Tenants',
      newTenant: 'New tenant',
      empty: 'No tenants yet. Create one to get started.',
      tenantType: 'Type',
      modules: 'Modules',
      created: 'Created',
      pawn: 'Pawn',
      repair: 'Repair',
      retail: 'Retail',
      typeChainHq: 'Chain HQ',
      typeShop: 'Shop',
      typeStandalone: 'Standalone',
    },
    newTenant: {
      title: 'New tenant',
      name: 'Name',
      dba: 'Doing business as',
      address: 'Address',
      city: 'City',
      state: 'State',
      zip: 'ZIP',
      phone: 'Phone',
      email: 'Email',
      tenantType: 'Type',
      parent: 'Parent (chain HQ)',
      noParent: '(none — standalone)',
      modules: 'Modules enabled',
      pawn: 'Pawn loans',
      repair: 'Repair tickets',
      retail: 'Retail / POS',
      policeReportFormat: 'Police-report format',
      submit: 'Create tenant',
      successTitle: 'Tenant created',
      successBody:
        'Share the onboarding link with the owner; the link expires once used.',
    },
  },
}

export type Dictionary = typeof en
