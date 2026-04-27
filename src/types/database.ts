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
      customer_documents: {
        Row: {
          byte_size: number | null
          created_at: string
          created_by: string | null
          customer_id: string
          deleted_at: string | null
          id: string
          id_expiry: string | null
          id_number: string | null
          id_state: string | null
          id_type: Database["public"]["Enums"]["id_document_type"] | null
          kind: Database["public"]["Enums"]["customer_doc_kind"]
          mime_type: string | null
          notes: string | null
          storage_path: string
          tenant_id: string
        }
        Insert: {
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          deleted_at?: string | null
          id?: string
          id_expiry?: string | null
          id_number?: string | null
          id_state?: string | null
          id_type?: Database["public"]["Enums"]["id_document_type"] | null
          kind: Database["public"]["Enums"]["customer_doc_kind"]
          mime_type?: string | null
          notes?: string | null
          storage_path: string
          tenant_id: string
        }
        Update: {
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          deleted_at?: string | null
          id?: string
          id_expiry?: string | null
          id_number?: string | null
          id_state?: string | null
          id_type?: Database["public"]["Enums"]["id_document_type"] | null
          kind?: Database["public"]["Enums"]["customer_doc_kind"]
          mime_type?: string | null
          notes?: string | null
          storage_path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_documents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address1: string | null
          address2: string | null
          banned_at: string | null
          banned_by: string | null
          banned_reason: string | null
          city: string | null
          comm_preference: Database["public"]["Enums"]["comm_preference"]
          country: string | null
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          deleted_at: string | null
          email: string | null
          eye_color: string | null
          first_name: string
          hair_color: string | null
          height_inches: number | null
          id: string
          id_country: string | null
          id_expiry: string | null
          id_number: string | null
          id_state: string | null
          id_type: Database["public"]["Enums"]["id_document_type"] | null
          identifying_marks: string | null
          is_banned: boolean
          language: string
          last_name: string
          marketing_opt_in: boolean
          middle_name: string | null
          notes: string | null
          phone: string | null
          phone_alt: string | null
          photo_url: string | null
          place_of_employment: string | null
          sex: string | null
          state: string | null
          tags: string[] | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          weight_lbs: number | null
          zip: string | null
        }
        Insert: {
          address1?: string | null
          address2?: string | null
          banned_at?: string | null
          banned_by?: string | null
          banned_reason?: string | null
          city?: string | null
          comm_preference?: Database["public"]["Enums"]["comm_preference"]
          country?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          eye_color?: string | null
          first_name: string
          hair_color?: string | null
          height_inches?: number | null
          id?: string
          id_country?: string | null
          id_expiry?: string | null
          id_number?: string | null
          id_state?: string | null
          id_type?: Database["public"]["Enums"]["id_document_type"] | null
          identifying_marks?: string | null
          is_banned?: boolean
          language?: string
          last_name: string
          marketing_opt_in?: boolean
          middle_name?: string | null
          notes?: string | null
          phone?: string | null
          phone_alt?: string | null
          photo_url?: string | null
          place_of_employment?: string | null
          sex?: string | null
          state?: string | null
          tags?: string[] | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          weight_lbs?: number | null
          zip?: string | null
        }
        Update: {
          address1?: string | null
          address2?: string | null
          banned_at?: string | null
          banned_by?: string | null
          banned_reason?: string | null
          city?: string | null
          comm_preference?: Database["public"]["Enums"]["comm_preference"]
          country?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          eye_color?: string | null
          first_name?: string
          hair_color?: string | null
          height_inches?: number | null
          id?: string
          id_country?: string | null
          id_expiry?: string | null
          id_number?: string | null
          id_state?: string | null
          id_type?: Database["public"]["Enums"]["id_document_type"] | null
          identifying_marks?: string | null
          is_banned?: boolean
          language?: string
          last_name?: string
          marketing_opt_in?: boolean
          middle_name?: string | null
          notes?: string | null
          phone?: string | null
          phone_alt?: string | null
          photo_url?: string | null
          place_of_employment?: string | null
          sex?: string | null
          state?: string | null
          tags?: string[] | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          weight_lbs?: number | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_item_photos: {
        Row: {
          byte_size: number | null
          caption: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          is_primary: boolean
          item_id: string
          mime_type: string | null
          position: number
          storage_path: string
          tenant_id: string
        }
        Insert: {
          byte_size?: number | null
          caption?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_primary?: boolean
          item_id: string
          mime_type?: string | null
          position?: number
          storage_path: string
          tenant_id: string
        }
        Update: {
          byte_size?: number | null
          caption?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_primary?: boolean
          item_id?: string
          mime_type?: string | null
          position?: number
          storage_path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_item_photos_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_item_photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_item_stones: {
        Row: {
          carat: number | null
          certificate: string | null
          clarity: string | null
          color: string | null
          count: number
          created_at: string
          cut: string | null
          deleted_at: string | null
          id: string
          is_total_carat: boolean
          item_id: string
          notes: string | null
          position: number
          stone_type: string | null
          tenant_id: string
        }
        Insert: {
          carat?: number | null
          certificate?: string | null
          clarity?: string | null
          color?: string | null
          count?: number
          created_at?: string
          cut?: string | null
          deleted_at?: string | null
          id?: string
          is_total_carat?: boolean
          item_id: string
          notes?: string | null
          position?: number
          stone_type?: string | null
          tenant_id: string
        }
        Update: {
          carat?: number | null
          certificate?: string | null
          clarity?: string | null
          color?: string | null
          count?: number
          created_at?: string
          cut?: string | null
          deleted_at?: string | null
          id?: string
          is_total_carat?: boolean
          item_id?: string
          notes?: string | null
          position?: number
          stone_type?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_item_stones_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_item_stones_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          acquired_at: string
          acquired_cost: number | null
          brand: string | null
          category: Database["public"]["Enums"]["inventory_category"]
          cost_basis: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string
          hold_until: string | null
          id: string
          karat: string | null
          list_price: number | null
          location: Database["public"]["Enums"]["inventory_location"]
          metal: Database["public"]["Enums"]["metal_type"] | null
          model: string | null
          notes: string | null
          released_from_hold_at: string | null
          sale_price: number | null
          serial_number: string | null
          sku: string
          sku_number: number
          sold_at: string | null
          source: Database["public"]["Enums"]["inventory_source"]
          source_loan_id: string | null
          source_repair_id: string | null
          source_vendor: string | null
          staff_memo: string | null
          status: Database["public"]["Enums"]["inventory_status"]
          tags: string[] | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          weight_dwt: number | null
          weight_grams: number | null
        }
        Insert: {
          acquired_at?: string
          acquired_cost?: number | null
          brand?: string | null
          category?: Database["public"]["Enums"]["inventory_category"]
          cost_basis?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description: string
          hold_until?: string | null
          id?: string
          karat?: string | null
          list_price?: number | null
          location?: Database["public"]["Enums"]["inventory_location"]
          metal?: Database["public"]["Enums"]["metal_type"] | null
          model?: string | null
          notes?: string | null
          released_from_hold_at?: string | null
          sale_price?: number | null
          serial_number?: string | null
          sku: string
          sku_number: number
          sold_at?: string | null
          source: Database["public"]["Enums"]["inventory_source"]
          source_loan_id?: string | null
          source_repair_id?: string | null
          source_vendor?: string | null
          staff_memo?: string | null
          status?: Database["public"]["Enums"]["inventory_status"]
          tags?: string[] | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          weight_dwt?: number | null
          weight_grams?: number | null
        }
        Update: {
          acquired_at?: string
          acquired_cost?: number | null
          brand?: string | null
          category?: Database["public"]["Enums"]["inventory_category"]
          cost_basis?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string
          hold_until?: string | null
          id?: string
          karat?: string | null
          list_price?: number | null
          location?: Database["public"]["Enums"]["inventory_location"]
          metal?: Database["public"]["Enums"]["metal_type"] | null
          model?: string | null
          notes?: string | null
          released_from_hold_at?: string | null
          sale_price?: number | null
          serial_number?: string | null
          sku?: string
          sku_number?: number
          sold_at?: string | null
          source?: Database["public"]["Enums"]["inventory_source"]
          source_loan_id?: string | null
          source_repair_id?: string | null
          source_vendor?: string | null
          staff_memo?: string | null
          status?: Database["public"]["Enums"]["inventory_status"]
          tags?: string[] | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          weight_dwt?: number | null
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transfers: {
        Row: {
          cancelled_at: string | null
          carrier: string | null
          created_at: string
          created_by: string | null
          from_tenant_id: string
          id: string
          item_id: string
          notes: string | null
          received_at: string | null
          shipped_at: string | null
          status: Database["public"]["Enums"]["transfer_status"]
          tenant_id: string
          to_tenant_id: string
          tracking_number: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cancelled_at?: string | null
          carrier?: string | null
          created_at?: string
          created_by?: string | null
          from_tenant_id: string
          id?: string
          item_id: string
          notes?: string | null
          received_at?: string | null
          shipped_at?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          tenant_id: string
          to_tenant_id: string
          tracking_number?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cancelled_at?: string | null
          carrier?: string | null
          created_at?: string
          created_by?: string | null
          from_tenant_id?: string
          id?: string
          item_id?: string
          notes?: string | null
          received_at?: string | null
          shipped_at?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          tenant_id?: string
          to_tenant_id?: string
          tracking_number?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transfers_from_tenant_id_fkey"
            columns: ["from_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transfers_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transfers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transfers_to_tenant_id_fkey"
            columns: ["to_tenant_id"]
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
      tenant_counters: {
        Row: {
          counter_name: string
          last_value: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          counter_name: string
          last_value?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          counter_name?: string
          last_value?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
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
      next_tenant_counter: {
        Args: { p_counter_name: string; p_tenant_id: string }
        Returns: number
      }
    }
    Enums: {
      comm_preference: "email" | "sms" | "whatsapp" | "none"
      customer_doc_kind: "id_scan" | "signature"
      id_document_type:
        | "drivers_license"
        | "state_id"
        | "passport"
        | "military_id"
        | "permanent_resident_card"
        | "other"
      inventory_category:
        | "ring"
        | "necklace"
        | "bracelet"
        | "earrings"
        | "pendant"
        | "chain"
        | "watch"
        | "coin"
        | "bullion"
        | "loose_stone"
        | "electronics"
        | "tool"
        | "instrument"
        | "other"
      inventory_location:
        | "case"
        | "safe"
        | "vault"
        | "display"
        | "workshop"
        | "offsite"
        | "transfer"
      inventory_source:
        | "pawn_forfeit"
        | "bought"
        | "consigned"
        | "new_stock"
        | "repair_excess"
        | "abandoned_repair"
      inventory_status:
        | "available"
        | "held"
        | "sold"
        | "scrapped"
        | "transferred"
        | "returned"
      metal_type:
        | "gold"
        | "silver"
        | "platinum"
        | "palladium"
        | "rose_gold"
        | "white_gold"
        | "tungsten"
        | "titanium"
        | "stainless_steel"
        | "mixed"
        | "none"
        | "other"
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
      transfer_status: "pending" | "in_transit" | "received" | "cancelled"
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
      comm_preference: ["email", "sms", "whatsapp", "none"],
      customer_doc_kind: ["id_scan", "signature"],
      id_document_type: [
        "drivers_license",
        "state_id",
        "passport",
        "military_id",
        "permanent_resident_card",
        "other",
      ],
      inventory_category: [
        "ring",
        "necklace",
        "bracelet",
        "earrings",
        "pendant",
        "chain",
        "watch",
        "coin",
        "bullion",
        "loose_stone",
        "electronics",
        "tool",
        "instrument",
        "other",
      ],
      inventory_location: [
        "case",
        "safe",
        "vault",
        "display",
        "workshop",
        "offsite",
        "transfer",
      ],
      inventory_source: [
        "pawn_forfeit",
        "bought",
        "consigned",
        "new_stock",
        "repair_excess",
        "abandoned_repair",
      ],
      inventory_status: [
        "available",
        "held",
        "sold",
        "scrapped",
        "transferred",
        "returned",
      ],
      metal_type: [
        "gold",
        "silver",
        "platinum",
        "palladium",
        "rose_gold",
        "white_gold",
        "tungsten",
        "titanium",
        "stainless_steel",
        "mixed",
        "none",
        "other",
      ],
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
      transfer_status: ["pending", "in_transit", "received", "cancelled"],
    },
  },
} as const

// Hand-written aliases — re-exported so they survive every regen.
export * from './database-aliases'
