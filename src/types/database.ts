/**
 * Supabase generated types — placeholder until `npm run db:types` runs
 * against the live project. Once the Pawn Supabase project exists and
 * SUPABASE_ACCESS_TOKEN is in .env.local, run:
 *
 *   npm run db:types
 *
 * The wrapper at scripts/db-types.mjs writes to a temp file, validates the
 * output (>500 bytes, contains `export type Database`), and atomically
 * renames to this path. Never use raw `>` redirect — Abacus Session 15
 * lost their hand-written aliases that way.
 *
 * Until then, this file declares minimal Row shapes for the tables Phase 0
 * actually reads from. Add to this list ONLY when build-time type checking
 * forces you to — every entry here is something the regen will overwrite.
 *
 * Hand-written aliases live in database-aliases.ts and are re-exported
 * below so they survive every regen.
 */

import type {
  GlobalRole,
  Language,
  PermissionSet,
  PoliceReportFormat,
  TenantRole,
  TenantType,
} from './database-aliases'

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type Tenants = {
  Row: {
    id: string
    name: string
    dba: string | null
    parent_tenant_id: string | null
    tenant_type: TenantType
    has_pawn: boolean
    has_repair: boolean
    has_retail: boolean
    police_report_format: PoliceReportFormat
    address: string | null
    city: string | null
    state: string | null
    zip: string | null
    phone: string | null
    email: string | null
    logo_url: string | null
    default_currency: string
    is_active: boolean
    license_key: string | null
    notes: string | null
    created_at: string
    updated_at: string
  }
  Insert: Partial<Tenants['Row']> & { name: string }
  Update: Partial<Tenants['Row']>
  Relationships: []
}

type Profiles = {
  Row: {
    id: string
    tenant_id: string | null
    role: Exclude<GlobalRole, null> | null
    full_name: string | null
    email: string | null
    avatar_url: string | null
    language: Language
    created_at: string
    updated_at: string
  }
  Insert: Partial<Profiles['Row']> & { id: string }
  Update: Partial<Profiles['Row']>
  Relationships: []
}

type UserTenants = {
  Row: {
    id: string
    user_id: string
    tenant_id: string
    role: TenantRole
    permissions: PermissionSet | null
    is_active: boolean
    created_at: string
  }
  Insert: Partial<UserTenants['Row']> & { user_id: string; tenant_id: string }
  Update: Partial<UserTenants['Row']>
  Relationships: []
}

type CreateTenantWithOwnerArgs = {
  p_name: string
  p_superadmin_user_id: string
  p_owner_user_id?: string | null
  p_parent_tenant_id?: string | null
  p_tenant_type?: TenantType
  p_dba?: string | null
  p_address?: string | null
  p_city?: string | null
  p_state?: string | null
  p_zip?: string | null
  p_phone?: string | null
  p_email?: string | null
  p_has_pawn?: boolean
  p_has_repair?: boolean
  p_has_retail?: boolean
  p_police_report_format?: PoliceReportFormat
}

type CreateTenantWithOwnerReturns = {
  tenant_id: string
  license_key: string
}

export type Database = {
  public: {
    Tables: {
      tenants: Tenants
      profiles: Profiles
      user_tenants: UserTenants
    }
    Views: Record<string, never>
    Functions: {
      create_tenant_with_owner: {
        Args: CreateTenantWithOwnerArgs
        Returns: CreateTenantWithOwnerReturns[]
      }
      delete_tenant_cascade: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      claim_tenant_with_license_key: {
        Args: { p_user_id: string; p_license_key: string }
        Returns: string
      }
    }
    Enums: {
      tenant_role: TenantRole
      tenant_type: TenantType
      police_report_format: PoliceReportFormat
    }
    CompositeTypes: Record<string, never>
  }
}

// Re-export hand-written aliases so they're available everywhere we import
// from '@/types/database'.
export * from './database-aliases'
