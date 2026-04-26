/**
 * Spanish translations. Must mirror en.ts exactly — same keys, same shape.
 * Pre-push hook gates drift.
 */

import type { Dictionary } from './en'

export const es: Dictionary = {
  common: {
    appName: 'Pawn',
    loading: 'Cargando…',
    save: 'Guardar',
    saving: 'Guardando…',
    cancel: 'Cancelar',
    delete: 'Eliminar',
    edit: 'Editar',
    back: 'Atrás',
    confirm: 'Confirmar',
    yes: 'Sí',
    no: 'No',
    search: 'Buscar',
    next: 'Siguiente',
    previous: 'Anterior',
    close: 'Cerrar',
    error: 'Algo salió mal',
    requiredField: 'Obligatorio',
  },

  lang: {
    en: 'English',
    es: 'Español',
    toggle: 'Idioma',
  },

  nav: {
    dashboard: 'Panel',
    customers: 'Clientes',
    inventory: 'Inventario',
    pawn: 'Empeños',
    repair: 'Reparación',
    pos: 'Caja',
    reports: 'Reportes',
    compliance: 'Cumplimiento',
    team: 'Equipo',
    settings: 'Ajustes',
    logOut: 'Cerrar sesión',
    portal: 'Mi cuenta',
    portalLoans: 'Mis empeños',
    portalRepairs: 'Mis reparaciones',
    portalLayaways: 'Mis apartados',
  },

  auth: {
    signIn: 'Iniciar sesión',
    signOut: 'Cerrar sesión',
    email: 'Correo electrónico',
    password: 'Contraseña',
    forgotPassword: '¿Olvidaste tu contraseña?',
    magicLink: 'Envíame un enlace para entrar',
    sendMagicLink: 'Enviar enlace',
    magicLinkSent: 'Revisa tu correo para iniciar sesión.',
    setPassword: 'Establecer contraseña',
    setPasswordSubmit: 'Establecer contraseña',
    passwordResetSent:
      'Si ese correo está registrado, te enviamos un enlace para restablecer.',
    invalidCredentials: 'Correo o contraseña incorrectos.',
    sessionExpired: 'Tu sesión expiró. Inicia sesión nuevamente.',
    inviteExpired:
      'Tu enlace de invitación expiró o ya fue usado. Pide al dueño que lo reenvíe.',
  },

  dashboard: {
    title: 'Panel',
    welcome: 'Bienvenido',
    placeholder:
      'Esqueleto de Fase 0 — el panel completo llega en la Fase 1.',
  },

  noTenant: {
    title: 'Sin tienda asignada',
    body: 'Iniciaste sesión pero aún no tienes acceso a una tienda. Pídele al dueño que te invite o inicia sesión con otra cuenta.',
    signOut: 'Cerrar sesión',
  },

  admin: {
    tenants: {
      title: 'Tenants',
      newTenant: 'Nuevo tenant',
      empty: 'Aún no hay tenants. Crea uno para comenzar.',
      tenantType: 'Tipo',
      modules: 'Módulos',
      created: 'Creado',
      pawn: 'Empeños',
      repair: 'Reparación',
      retail: 'Retail',
      typeChainHq: 'Sede de cadena',
      typeShop: 'Tienda',
      typeStandalone: 'Independiente',
    },
    newTenant: {
      title: 'Nuevo tenant',
      name: 'Nombre',
      dba: 'Nombre comercial (DBA)',
      address: 'Dirección',
      city: 'Ciudad',
      state: 'Estado',
      zip: 'ZIP',
      phone: 'Teléfono',
      email: 'Correo',
      tenantType: 'Tipo',
      parent: 'Sede principal (cadena)',
      noParent: '(ninguna — independiente)',
      modules: 'Módulos habilitados',
      pawn: 'Empeños',
      repair: 'Reparación',
      retail: 'Retail / Caja',
      policeReportFormat: 'Formato de reporte policial',
      submit: 'Crear tenant',
      successTitle: 'Tenant creado',
      successBody:
        'Comparte el enlace de inicio con el dueño; el enlace expira una vez usado.',
    },
  },
}
