export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          changes: Json | null
          created_at: string
          id: string
          ip_address: string | null
          record_id: string | null
          table_name: string
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          created_at?: string
          id?: string
          ip_address?: string | null
          record_id?: string | null
          table_name: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          created_at?: string
          id?: string
          ip_address?: string | null
          record_id?: string | null
          table_name?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_log: {
        Row: {
          amount: number | null
          created_at: string
          customer_snapshot: Json
          event_type: string
          exported_at: string | null
          exported_batch_id: string | null
          exported_format:
            | Database["public"]["Enums"]["police_report_format"]
            | null
          id: string
          items_snapshot: Json
          occurred_at: string
          source_id: string
          source_table: string
          tenant_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          customer_snapshot: Json
          event_type: string
          exported_at?: string | null
          exported_batch_id?: string | null
          exported_format?:
            | Database["public"]["Enums"]["police_report_format"]
            | null
          id?: string
          items_snapshot: Json
          occurred_at?: string
          source_id: string
          source_table: string
          tenant_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          customer_snapshot?: Json
          event_type?: string
          exported_at?: string | null
          exported_batch_id?: string | null
          exported_format?:
            | Database["public"]["Enums"]["police_report_format"]
            | null
          id?: string
          items_snapshot?: Json
          occurred_at?: string
          source_id?: string
          source_table?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          language: string
          role: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          language?: string
          role?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          language?: string
          role?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          abandoned_repair_days: number
          buy_hold_period_days: number
          created_at: string
          default_currency: string
          default_loan_interest_rate: number
          default_loan_term_days: number
          email_from: string | null
          resend_api_key: string | null
          tenant_id: string
          twilio_account_sid: string | null
          twilio_auth_token: string | null
          twilio_phone_number: string | null
          twilio_whatsapp_number: string | null
          updated_at: string
        }
        Insert: {
          abandoned_repair_days?: number
          buy_hold_period_days?: number
          created_at?: string
          default_currency?: string
          default_loan_interest_rate?: number
          default_loan_term_days?: number
          email_from?: string | null
          resend_api_key?: string | null
          tenant_id: string
          twilio_account_sid?: string | null
          twilio_auth_token?: string | null
          twilio_phone_number?: string | null
          twilio_whatsapp_number?: string | null
          updated_at?: string
        }
        Update: {
          abandoned_repair_days?: number
          buy_hold_period_days?: number
          created_at?: string
          default_currency?: string
          default_loan_interest_rate?: number
          default_loan_term_days?: number
          email_from?: string | null
          resend_api_key?: string | null
          tenant_id?: string
          twilio_account_sid?: string | null
          twilio_auth_token?: string | null
          twilio_phone_number?: string | null
          twilio_whatsapp_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_billing_settings: {
        Row: {
          billing_enabled: boolean
          created_at: string
          stripe_access_token: string | null
          stripe_account_id: string | null
          stripe_connected_at: string | null
          stripe_publishable_key: string | null
          stripe_refresh_token: string | null
          stripe_terminal_location_id: string | null
          stripe_webhook_secret: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          billing_enabled?: boolean
          created_at?: string
          stripe_access_token?: string | null
          stripe_account_id?: string | null
          stripe_connected_at?: string | null
          stripe_publishable_key?: string | null
          stripe_refresh_token?: string | null
          stripe_terminal_location_id?: string | null
          stripe_webhook_secret?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          billing_enabled?: boolean
          created_at?: string
          stripe_access_token?: string | null
          stripe_account_id?: string | null
          stripe_connected_at?: string | null
          stripe_publishable_key?: string | null
          stripe_refresh_token?: string | null
          stripe_terminal_location_id?: string | null
          stripe_webhook_secret?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_billing_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          dba: string | null
          default_currency: string
          email: string | null
          has_pawn: boolean
          has_repair: boolean
          has_retail: boolean
          id: string
          is_active: boolean
          license_key: string | null
          logo_url: string | null
          name: string
          notes: string | null
          parent_tenant_id: string | null
          phone: string | null
          police_report_format: Database["public"]["Enums"]["police_report_format"]
          state: string | null
          tenant_type: Database["public"]["Enums"]["tenant_type"]
          updated_at: string
          zip: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          dba?: string | null
          default_currency?: string
          email?: string | null
          has_pawn?: boolean
          has_repair?: boolean
          has_retail?: boolean
          id?: string
          is_active?: boolean
          license_key?: string | null
          logo_url?: string | null
          name: string
          notes?: string | null
          parent_tenant_id?: string | null
          phone?: string | null
          police_report_format?: Database["public"]["Enums"]["police_report_format"]
          state?: string | null
          tenant_type?: Database["public"]["Enums"]["tenant_type"]
          updated_at?: string
          zip?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          dba?: string | null
          default_currency?: string
          email?: string | null
          has_pawn?: boolean
          has_repair?: boolean
          has_retail?: boolean
          id?: string
          is_active?: boolean
          license_key?: string | null
          logo_url?: string | null
          name?: string
          notes?: string | null
          parent_tenant_id?: string | null
          phone?: string | null
          police_report_format?: Database["public"]["Enums"]["police_report_format"]
          state?: string | null
          tenant_type?: Database["public"]["Enums"]["tenant_type"]
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenants_parent_tenant_id_fkey"
            columns: ["parent_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          created_at: string
          default_date_range: string | null
          id: string
          language: string
          notify_email: boolean
          notify_sms: boolean
          notify_whatsapp: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_date_range?: string | null
          id?: string
          language?: string
          notify_email?: boolean
          notify_sms?: boolean
          notify_whatsapp?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_date_range?: string | null
          id?: string
          language?: string
          notify_email?: boolean
          notify_sms?: boolean
          notify_whatsapp?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_tenants: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          permissions: Json | null
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          permissions?: Json | null
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          permissions?: Json | null
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_tenants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_tenant_with_license_key: {
        Args: { p_license_key: string; p_user_id: string }
        Returns: string
      }
      create_tenant_with_owner: {
        Args: {
          p_address?: string
          p_city?: string
          p_dba?: string
          p_email?: string
          p_has_pawn?: boolean
          p_has_repair?: boolean
          p_has_retail?: boolean
          p_name: string
          p_owner_user_id?: string
          p_parent_tenant_id?: string
          p_phone?: string
          p_police_report_format?: Database["public"]["Enums"]["police_report_format"]
          p_state?: string
          p_superadmin_user_id: string
          p_tenant_type?: Database["public"]["Enums"]["tenant_type"]
          p_zip?: string
        }
        Returns: {
          license_key: string
          tenant_id: string
        }[]
      }
      delete_tenant_cascade: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      my_accessible_tenant_ids: { Args: never; Returns: string[] }
      my_chain_tenant_ids: { Args: never; Returns: string[] }
      my_is_owner: { Args: { p_tenant_id: string }; Returns: boolean }
      my_is_staff: { Args: { p_tenant_id: string }; Returns: boolean }
      my_role_in_tenant: {
        Args: { p_tenant_id: string }
        Returns: Database["public"]["Enums"]["tenant_role"]
      }
      my_tenant_ids: { Args: never; Returns: string[] }
    }
    Enums: {
      police_report_format: "fl_leadsonline"
      tenant_role:
        | "owner"
        | "chain_admin"
        | "manager"
        | "pawn_clerk"
        | "repair_tech"
        | "appraiser"
        | "client"
      tenant_type: "chain_hq" | "shop" | "standalone"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      police_report_format: ["fl_leadsonline"],
      tenant_role: [
        "owner",
        "chain_admin",
        "manager",
        "pawn_clerk",
        "repair_tech",
        "appraiser",
        "client",
      ],
      tenant_type: ["chain_hq", "shop", "standalone"],
    },
  },
} as const

// Hand-written aliases — re-exported so they survive every regen.
export * from './database-aliases'
