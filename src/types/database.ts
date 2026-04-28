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
      billing_invoices: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          due_date: string | null
          hosted_invoice_url: string | null
          id: string
          invoice_pdf_url: string | null
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          status: string
          stripe_invoice_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          due_date?: string | null
          hosted_invoice_url?: string | null
          id?: string
          invoice_pdf_url?: string | null
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          status: string
          stripe_invoice_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          due_date?: string | null
          hosted_invoice_url?: string | null
          id?: string
          invoice_pdf_url?: string | null
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          stripe_invoice_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_invoices_tenant_id_fkey"
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
          auth_user_id: string | null
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
          auth_user_id?: string | null
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
          auth_user_id?: string | null
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
      inventory_transfer_items: {
        Row: {
          created_at: string
          description_snapshot: string | null
          est_value: number | null
          id: string
          inventory_item_id: string
          sku_snapshot: string | null
          tenant_id: string
          transfer_id: string
        }
        Insert: {
          created_at?: string
          description_snapshot?: string | null
          est_value?: number | null
          id?: string
          inventory_item_id: string
          sku_snapshot?: string | null
          tenant_id: string
          transfer_id: string
        }
        Update: {
          created_at?: string
          description_snapshot?: string | null
          est_value?: number | null
          id?: string
          inventory_item_id?: string
          sku_snapshot?: string | null
          tenant_id?: string
          transfer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transfer_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transfer_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transfer_items_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "inventory_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transfers: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          carrier: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          from_tenant_id: string
          id: string
          item_id: string | null
          notes: string | null
          received_at: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          requested_at: string
          requested_by: string | null
          shipped_at: string | null
          status: Database["public"]["Enums"]["transfer_status"]
          tenant_id: string
          to_tenant_id: string
          tracking_number: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          carrier?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          from_tenant_id: string
          id?: string
          item_id?: string | null
          notes?: string | null
          received_at?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requested_at?: string
          requested_by?: string | null
          shipped_at?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          tenant_id: string
          to_tenant_id: string
          tracking_number?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          carrier?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          from_tenant_id?: string
          id?: string
          item_id?: string | null
          notes?: string | null
          received_at?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requested_at?: string
          requested_by?: string | null
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
      layaway_payments: {
        Row: {
          amount: number
          card_present_status: Database["public"]["Enums"]["card_present_status"]
          created_at: string
          deleted_at: string | null
          id: string
          layaway_id: string
          notes: string | null
          occurred_at: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          performed_by: string | null
          reader_id: string | null
          stripe_payment_intent_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          card_present_status?: Database["public"]["Enums"]["card_present_status"]
          created_at?: string
          deleted_at?: string | null
          id?: string
          layaway_id: string
          notes?: string | null
          occurred_at?: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          performed_by?: string | null
          reader_id?: string | null
          stripe_payment_intent_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          card_present_status?: Database["public"]["Enums"]["card_present_status"]
          created_at?: string
          deleted_at?: string | null
          id?: string
          layaway_id?: string
          notes?: string | null
          occurred_at?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          performed_by?: string | null
          reader_id?: string | null
          stripe_payment_intent_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "layaway_payments_layaway_id_fkey"
            columns: ["layaway_id"]
            isOneToOne: false
            referencedRelation: "layaways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layaway_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      layaways: {
        Row: {
          balance_remaining: number
          cancellation_fee_pct: number
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          deleted_at: string | null
          down_payment: number
          final_due_date: string | null
          first_payment_due: string | null
          id: string
          layaway_number: string | null
          notes: string | null
          paid_total: number
          sale_id: string
          schedule_kind: string
          status: Database["public"]["Enums"]["layaway_status"]
          tenant_id: string
          total_due: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          balance_remaining: number
          cancellation_fee_pct?: number
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          deleted_at?: string | null
          down_payment?: number
          final_due_date?: string | null
          first_payment_due?: string | null
          id?: string
          layaway_number?: string | null
          notes?: string | null
          paid_total?: number
          sale_id: string
          schedule_kind: string
          status?: Database["public"]["Enums"]["layaway_status"]
          tenant_id: string
          total_due: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          balance_remaining?: number
          cancellation_fee_pct?: number
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          deleted_at?: string | null
          down_payment?: number
          final_due_date?: string | null
          first_payment_due?: string | null
          id?: string
          layaway_number?: string | null
          notes?: string | null
          paid_total?: number
          sale_id?: string
          schedule_kind?: string
          status?: Database["public"]["Enums"]["layaway_status"]
          tenant_id?: string
          total_due?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "layaways_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layaways_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layaways_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_collateral_items: {
        Row: {
          category: Database["public"]["Enums"]["inventory_category"]
          created_at: string
          deleted_at: string | null
          description: string
          est_value: number
          id: string
          karat: number | null
          loan_id: string
          metal_type: Database["public"]["Enums"]["metal_type"] | null
          photo_path: string | null
          position: number
          tenant_id: string
          weight_grams: number | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["inventory_category"]
          created_at?: string
          deleted_at?: string | null
          description: string
          est_value?: number
          id?: string
          karat?: number | null
          loan_id: string
          metal_type?: Database["public"]["Enums"]["metal_type"] | null
          photo_path?: string | null
          position?: number
          tenant_id: string
          weight_grams?: number | null
        }
        Update: {
          category?: Database["public"]["Enums"]["inventory_category"]
          created_at?: string
          deleted_at?: string | null
          description?: string
          est_value?: number
          id?: string
          karat?: number | null
          loan_id?: string
          metal_type?: Database["public"]["Enums"]["metal_type"] | null
          photo_path?: string | null
          position?: number
          tenant_id?: string
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loan_collateral_items_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_collateral_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_events: {
        Row: {
          amount: number | null
          event_type: Database["public"]["Enums"]["loan_event_type"]
          fees_paid: number
          id: string
          interest_paid: number
          loan_id: string
          new_due_date: string | null
          notes: string | null
          occurred_at: string
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          performed_by: string | null
          principal_paid: number
          tenant_id: string
        }
        Insert: {
          amount?: number | null
          event_type: Database["public"]["Enums"]["loan_event_type"]
          fees_paid?: number
          id?: string
          interest_paid?: number
          loan_id: string
          new_due_date?: string | null
          notes?: string | null
          occurred_at?: string
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          performed_by?: string | null
          principal_paid?: number
          tenant_id: string
        }
        Update: {
          amount?: number | null
          event_type?: Database["public"]["Enums"]["loan_event_type"]
          fees_paid?: number
          id?: string
          interest_paid?: number
          loan_id?: string
          new_due_date?: string | null
          notes?: string | null
          occurred_at?: string
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          performed_by?: string | null
          principal_paid?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_events_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          deleted_at: string | null
          due_date: string
          id: string
          interest_rate_monthly: number
          is_printed: boolean
          issue_date: string
          notes: string | null
          principal: number
          printed_at: string | null
          signature_path: string | null
          source_loan_id: string | null
          status: Database["public"]["Enums"]["loan_status"]
          tenant_id: string
          term_days: number
          ticket_number: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          deleted_at?: string | null
          due_date: string
          id?: string
          interest_rate_monthly: number
          is_printed?: boolean
          issue_date?: string
          notes?: string | null
          principal: number
          printed_at?: string | null
          signature_path?: string | null
          source_loan_id?: string | null
          status?: Database["public"]["Enums"]["loan_status"]
          tenant_id: string
          term_days: number
          ticket_number?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          deleted_at?: string | null
          due_date?: string
          id?: string
          interest_rate_monthly?: number
          is_printed?: boolean
          issue_date?: string
          notes?: string | null
          principal?: number
          printed_at?: string | null
          signature_path?: string | null
          source_loan_id?: string | null
          status?: Database["public"]["Enums"]["loan_status"]
          tenant_id?: string
          term_days?: number
          ticket_number?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loans_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_source_loan_id_fkey"
            columns: ["source_loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      message_log: {
        Row: {
          body_rendered: string
          channel: Database["public"]["Enums"]["message_channel"]
          created_at: string
          customer_id: string | null
          delivered_at: string | null
          error_text: string | null
          id: string
          kind: Database["public"]["Enums"]["message_kind"]
          provider_id: string | null
          related_layaway_id: string | null
          related_loan_id: string | null
          related_repair_ticket_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["message_status"]
          tenant_id: string
          to_address: string
        }
        Insert: {
          body_rendered: string
          channel: Database["public"]["Enums"]["message_channel"]
          created_at?: string
          customer_id?: string | null
          delivered_at?: string | null
          error_text?: string | null
          id?: string
          kind: Database["public"]["Enums"]["message_kind"]
          provider_id?: string | null
          related_layaway_id?: string | null
          related_loan_id?: string | null
          related_repair_ticket_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          tenant_id: string
          to_address: string
        }
        Update: {
          body_rendered?: string
          channel?: Database["public"]["Enums"]["message_channel"]
          created_at?: string
          customer_id?: string | null
          delivered_at?: string | null
          error_text?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          provider_id?: string | null
          related_layaway_id?: string | null
          related_loan_id?: string | null
          related_repair_ticket_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["message_status"]
          tenant_id?: string
          to_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_log_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_log_related_layaway_id_fkey"
            columns: ["related_layaway_id"]
            isOneToOne: false
            referencedRelation: "layaways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_log_related_loan_id_fkey"
            columns: ["related_loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_log_related_repair_ticket_id_fkey"
            columns: ["related_repair_ticket_id"]
            isOneToOne: false
            referencedRelation: "repair_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          channel: Database["public"]["Enums"]["message_channel"]
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          is_enabled: boolean
          kind: Database["public"]["Enums"]["message_kind"]
          language: string
          subject: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          whatsapp_content_sid: string | null
        }
        Insert: {
          body: string
          channel: Database["public"]["Enums"]["message_channel"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_enabled?: boolean
          kind: Database["public"]["Enums"]["message_kind"]
          language: string
          subject?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          whatsapp_content_sid?: string | null
        }
        Update: {
          body?: string
          channel?: Database["public"]["Enums"]["message_channel"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_enabled?: boolean
          kind?: Database["public"]["Enums"]["message_kind"]
          language?: string
          subject?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          whatsapp_content_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_tenant_id_fkey"
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
      register_sessions: {
        Row: {
          card_batch_total: number | null
          cash_variance: number | null
          closed_at: string | null
          closed_by: string | null
          closing_cash_counted: number | null
          created_at: string
          deleted_at: string | null
          expected_cash: number | null
          id: string
          notes: string | null
          opened_at: string
          opened_by: string | null
          opening_cash: number
          status: Database["public"]["Enums"]["register_session_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          card_batch_total?: number | null
          cash_variance?: number | null
          closed_at?: string | null
          closed_by?: string | null
          closing_cash_counted?: number | null
          created_at?: string
          deleted_at?: string | null
          expected_cash?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_cash?: number
          status?: Database["public"]["Enums"]["register_session_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          card_batch_total?: number | null
          cash_variance?: number | null
          closed_at?: string | null
          closed_by?: string | null
          closing_cash_counted?: number | null
          created_at?: string
          deleted_at?: string | null
          expected_cash?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_cash?: number
          status?: Database["public"]["Enums"]["register_session_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "register_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_ticket_events: {
        Row: {
          amount: number | null
          event_type: Database["public"]["Enums"]["repair_event_type"]
          id: string
          new_status: Database["public"]["Enums"]["repair_status"] | null
          notes: string | null
          occurred_at: string
          performed_by: string | null
          tenant_id: string
          ticket_id: string
        }
        Insert: {
          amount?: number | null
          event_type: Database["public"]["Enums"]["repair_event_type"]
          id?: string
          new_status?: Database["public"]["Enums"]["repair_status"] | null
          notes?: string | null
          occurred_at?: string
          performed_by?: string | null
          tenant_id: string
          ticket_id: string
        }
        Update: {
          amount?: number | null
          event_type?: Database["public"]["Enums"]["repair_event_type"]
          id?: string
          new_status?: Database["public"]["Enums"]["repair_status"] | null
          notes?: string | null
          occurred_at?: string
          performed_by?: string | null
          tenant_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_ticket_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "repair_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_ticket_items: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          inventory_item_id: string | null
          notes: string | null
          quantity: number
          tenant_id: string
          ticket_id: string
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description: string
          id?: string
          inventory_item_id?: string | null
          notes?: string | null
          quantity?: number
          tenant_id: string
          ticket_id: string
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          inventory_item_id?: string | null
          notes?: string | null
          quantity?: number
          tenant_id?: string
          ticket_id?: string
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "repair_ticket_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_ticket_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_ticket_items_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "repair_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_ticket_photos: {
        Row: {
          caption: string | null
          created_at: string
          deleted_at: string | null
          id: string
          kind: Database["public"]["Enums"]["repair_photo_kind"]
          position: number
          storage_path: string
          tenant_id: string
          ticket_id: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["repair_photo_kind"]
          position?: number
          storage_path: string
          tenant_id: string
          ticket_id: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["repair_photo_kind"]
          position?: number
          storage_path?: string
          tenant_id?: string
          ticket_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_ticket_photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_ticket_photos_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "repair_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_ticket_stones: {
        Row: {
          clarity: string | null
          color: string | null
          created_at: string
          deleted_at: string | null
          id: string
          mounting_position: string | null
          mounting_type: string | null
          notes: string | null
          shape: string | null
          shop_inventory_item_id: string | null
          size_mm: number | null
          source: string
          stone_index: number
          stone_type: string
          tenant_id: string
          ticket_id: string
          weight_carats: number | null
        }
        Insert: {
          clarity?: string | null
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          mounting_position?: string | null
          mounting_type?: string | null
          notes?: string | null
          shape?: string | null
          shop_inventory_item_id?: string | null
          size_mm?: number | null
          source: string
          stone_index: number
          stone_type: string
          tenant_id: string
          ticket_id: string
          weight_carats?: number | null
        }
        Update: {
          clarity?: string | null
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          mounting_position?: string | null
          mounting_type?: string | null
          notes?: string | null
          shape?: string | null
          shop_inventory_item_id?: string | null
          size_mm?: number | null
          source?: string
          stone_index?: number
          stone_type?: string
          tenant_id?: string
          ticket_id?: string
          weight_carats?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_ticket_stones_shop_inventory_item_id_fkey"
            columns: ["shop_inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_ticket_stones_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_ticket_stones_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "repair_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_tickets: {
        Row: {
          assigned_to: string | null
          balance_due: number | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          deleted_at: string | null
          deposit_amount: number
          deposit_collected_at: string | null
          description: string | null
          id: string
          is_locked: boolean
          item_description: string
          notes_internal: string | null
          paid_amount: number
          picked_up_at: string | null
          pickup_by_name: string | null
          pickup_id_check: string | null
          pickup_signature_path: string | null
          promised_date: string | null
          quote_amount: number | null
          quote_approved_at: string | null
          quote_set_at: string | null
          service_type: Database["public"]["Enums"]["service_type"]
          source_inventory_item_id: string | null
          status: Database["public"]["Enums"]["repair_status"]
          tenant_id: string
          ticket_number: string | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_to?: string | null
          balance_due?: number | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          deleted_at?: string | null
          deposit_amount?: number
          deposit_collected_at?: string | null
          description?: string | null
          id?: string
          is_locked?: boolean
          item_description: string
          notes_internal?: string | null
          paid_amount?: number
          picked_up_at?: string | null
          pickup_by_name?: string | null
          pickup_id_check?: string | null
          pickup_signature_path?: string | null
          promised_date?: string | null
          quote_amount?: number | null
          quote_approved_at?: string | null
          quote_set_at?: string | null
          service_type: Database["public"]["Enums"]["service_type"]
          source_inventory_item_id?: string | null
          status?: Database["public"]["Enums"]["repair_status"]
          tenant_id: string
          ticket_number?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_to?: string | null
          balance_due?: number | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          deleted_at?: string | null
          deposit_amount?: number
          deposit_collected_at?: string | null
          description?: string | null
          id?: string
          is_locked?: boolean
          item_description?: string
          notes_internal?: string | null
          paid_amount?: number
          picked_up_at?: string | null
          pickup_by_name?: string | null
          pickup_id_check?: string | null
          pickup_signature_path?: string | null
          promised_date?: string | null
          quote_amount?: number | null
          quote_approved_at?: string | null
          quote_set_at?: string | null
          service_type?: Database["public"]["Enums"]["service_type"]
          source_inventory_item_id?: string | null
          status?: Database["public"]["Enums"]["repair_status"]
          tenant_id?: string
          ticket_number?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_tickets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_tickets_source_inventory_item_id_fkey"
            columns: ["source_inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_tickets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_time_logs: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          started_at: string
          stopped_at: string | null
          technician_id: string
          tenant_id: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          started_at: string
          stopped_at?: string | null
          technician_id: string
          tenant_id: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          started_at?: string
          stopped_at?: string | null
          technician_id?: string
          tenant_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_time_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_time_logs_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "repair_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      return_items: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          line_total: number
          quantity: number
          restock: boolean
          return_id: string
          sale_item_id: string
          tenant_id: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          line_total: number
          quantity: number
          restock?: boolean
          return_id: string
          sale_item_id: string
          tenant_id: string
          unit_price: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          line_total?: number
          quantity?: number
          restock?: boolean
          return_id?: string
          sale_item_id?: string
          tenant_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_sale_item_id_fkey"
            columns: ["sale_item_id"]
            isOneToOne: false
            referencedRelation: "sale_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      returns: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          performed_by: string | null
          reason: string | null
          refund_method: Database["public"]["Enums"]["payment_method"]
          refunded_at: string | null
          refunded_total: number
          return_number: string | null
          sale_id: string
          status: Database["public"]["Enums"]["return_status"]
          subtotal: number
          tax_amount: number
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          performed_by?: string | null
          reason?: string | null
          refund_method?: Database["public"]["Enums"]["payment_method"]
          refunded_at?: string | null
          refunded_total?: number
          return_number?: string | null
          sale_id: string
          status?: Database["public"]["Enums"]["return_status"]
          subtotal?: number
          tax_amount?: number
          tenant_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          performed_by?: string | null
          reason?: string | null
          refund_method?: Database["public"]["Enums"]["payment_method"]
          refunded_at?: string | null
          refunded_total?: number
          return_number?: string | null
          sale_id?: string
          status?: Database["public"]["Enums"]["return_status"]
          subtotal?: number
          tax_amount?: number
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "returns_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          inventory_item_id: string | null
          line_discount: number
          line_total: number
          position: number
          quantity: number
          returned_qty: number
          sale_id: string
          tenant_id: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description: string
          id?: string
          inventory_item_id?: string | null
          line_discount?: number
          line_total?: number
          position?: number
          quantity?: number
          returned_qty?: number
          sale_id: string
          tenant_id: string
          unit_price?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          inventory_item_id?: string | null
          line_discount?: number
          line_total?: number
          position?: number
          quantity?: number
          returned_qty?: number
          sale_id?: string
          tenant_id?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_payments: {
        Row: {
          amount: number
          card_present_status: Database["public"]["Enums"]["card_present_status"]
          created_at: string
          deleted_at: string | null
          id: string
          notes: string | null
          occurred_at: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          performed_by: string | null
          reader_id: string | null
          sale_id: string
          stripe_payment_intent_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          card_present_status?: Database["public"]["Enums"]["card_present_status"]
          created_at?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          occurred_at?: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          performed_by?: string | null
          reader_id?: string | null
          sale_id: string
          stripe_payment_intent_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          card_present_status?: Database["public"]["Enums"]["card_present_status"]
          created_at?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          occurred_at?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          performed_by?: string | null
          reader_id?: string | null
          sale_id?: string
          stripe_payment_intent_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          deleted_at: string | null
          discount_amount: number
          id: string
          is_locked: boolean
          notes: string | null
          paid_total: number
          register_session_id: string | null
          returned_total: number
          sale_kind: Database["public"]["Enums"]["sale_kind"]
          sale_number: string | null
          status: Database["public"]["Enums"]["sale_status"]
          subtotal: number
          tax_amount: number
          tax_rate: number
          tenant_id: string
          total: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          discount_amount?: number
          id?: string
          is_locked?: boolean
          notes?: string | null
          paid_total?: number
          register_session_id?: string | null
          returned_total?: number
          sale_kind?: Database["public"]["Enums"]["sale_kind"]
          sale_number?: string | null
          status?: Database["public"]["Enums"]["sale_status"]
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          tenant_id: string
          total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          discount_amount?: number
          id?: string
          is_locked?: boolean
          notes?: string | null
          paid_total?: number
          register_session_id?: string | null
          returned_total?: number
          sale_kind?: Database["public"]["Enums"]["sale_kind"]
          sale_number?: string | null
          status?: Database["public"]["Enums"]["sale_status"]
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          tenant_id?: string
          total?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_register_session_id_fkey"
            columns: ["register_session_id"]
            isOneToOne: false
            referencedRelation: "register_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_tenant_id_fkey"
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
          resend_from_email: string | null
          resend_from_name: string | null
          tenant_id: string
          twilio_account_sid: string | null
          twilio_auth_token: string | null
          twilio_messaging_service_sid: string | null
          twilio_phone_number: string | null
          twilio_sms_from: string | null
          twilio_whatsapp_from: string | null
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
          resend_from_email?: string | null
          resend_from_name?: string | null
          tenant_id: string
          twilio_account_sid?: string | null
          twilio_auth_token?: string | null
          twilio_messaging_service_sid?: string | null
          twilio_phone_number?: string | null
          twilio_sms_from?: string | null
          twilio_whatsapp_from?: string | null
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
          resend_from_email?: string | null
          resend_from_name?: string | null
          tenant_id?: string
          twilio_account_sid?: string | null
          twilio_auth_token?: string | null
          twilio_messaging_service_sid?: string | null
          twilio_phone_number?: string | null
          twilio_sms_from?: string | null
          twilio_whatsapp_from?: string | null
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
      stripe_payment_links: {
        Row: {
          amount: number
          checkout_url: string | null
          created_at: string
          currency: string
          customer_id: string
          id: string
          paid_at: string | null
          source_id: string
          source_kind: string
          status: string
          stripe_account_id: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          checkout_url?: string | null
          created_at?: string
          currency?: string
          customer_id: string
          id?: string
          paid_at?: string | null
          source_id: string
          source_kind: string
          status?: string
          stripe_account_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          checkout_url?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          id?: string
          paid_at?: string | null
          source_id?: string
          source_kind?: string
          status?: string
          stripe_account_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_payment_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_payment_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          code: string
          created_at: string
          description: string | null
          feature_limits: Json
          features: Json
          id: string
          is_active: boolean
          is_public: boolean
          name: string
          price_monthly_cents: number
          price_yearly_cents: number | null
          sort_order: number
          stripe_price_monthly_id: string | null
          stripe_price_yearly_id: string | null
          stripe_product_id: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          feature_limits?: Json
          features?: Json
          id?: string
          is_active?: boolean
          is_public?: boolean
          name: string
          price_monthly_cents: number
          price_yearly_cents?: number | null
          sort_order?: number
          stripe_price_monthly_id?: string | null
          stripe_price_yearly_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          feature_limits?: Json
          features?: Json
          id?: string
          is_active?: boolean
          is_public?: boolean
          name?: string
          price_monthly_cents?: number
          price_yearly_cents?: number | null
          sort_order?: number
          stripe_price_monthly_id?: string | null
          stripe_price_yearly_id?: string | null
          stripe_product_id?: string | null
          updated_at?: string
        }
        Relationships: []
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
      tenant_subscriptions: {
        Row: {
          billing_cycle: Database["public"]["Enums"]["billing_cycle"]
          cancel_at_period_end: boolean
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          internal_notes: string | null
          last_invoice_amount_cents: number | null
          last_invoice_id: string | null
          last_invoice_paid_at: string | null
          next_invoice_amount_cents: number | null
          next_invoice_due_at: string | null
          plan_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tenant_id: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"]
          cancel_at_period_end?: boolean
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          internal_notes?: string | null
          last_invoice_amount_cents?: number | null
          last_invoice_id?: string | null
          last_invoice_paid_at?: string | null
          next_invoice_amount_cents?: number | null
          next_invoice_due_at?: string | null
          plan_id: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"]
          cancel_at_period_end?: boolean
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          internal_notes?: string | null
          last_invoice_amount_cents?: number | null
          last_invoice_id?: string | null
          last_invoice_paid_at?: string | null
          next_invoice_amount_cents?: number | null
          next_invoice_due_at?: string | null
          plan_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_subscriptions_tenant_id_fkey"
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
      get_my_customer_id: { Args: never; Returns: string }
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
      billing_cycle: "monthly" | "yearly"
      card_present_status:
        | "not_used"
        | "pending"
        | "succeeded"
        | "failed"
        | "refunded"
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
      layaway_status: "active" | "completed" | "cancelled" | "defaulted"
      loan_event_type:
        | "issued"
        | "payment"
        | "extension"
        | "redemption"
        | "forfeiture"
        | "void"
      loan_status:
        | "active"
        | "extended"
        | "partial_paid"
        | "redeemed"
        | "forfeited"
        | "voided"
      message_channel: "sms" | "whatsapp" | "email"
      message_kind:
        | "loan_maturity_t7"
        | "loan_maturity_t1"
        | "loan_due_today"
        | "loan_overdue_t1"
        | "loan_overdue_t7"
        | "repair_ready"
        | "repair_pickup_reminder"
        | "layaway_payment_due"
        | "layaway_overdue"
        | "layaway_completed"
        | "custom"
      message_status: "queued" | "sent" | "delivered" | "failed" | "opted_out"
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
      payment_method: "cash" | "card" | "check" | "other"
      police_report_format: "fl_leadsonline"
      register_session_status: "open" | "closed" | "reconciled"
      repair_event_type:
        | "intake"
        | "quote_set"
        | "approved"
        | "started"
        | "paused"
        | "resumed"
        | "parts_needed"
        | "parts_received"
        | "completed"
        | "pickup"
        | "abandoned_conversion"
        | "void"
        | "note"
        | "photo_added"
      repair_photo_kind: "intake" | "in_progress" | "final" | "reference"
      repair_status:
        | "intake"
        | "quoted"
        | "awaiting_approval"
        | "in_progress"
        | "needs_parts"
        | "ready"
        | "picked_up"
        | "abandoned"
        | "voided"
      return_status: "issued" | "voided"
      sale_kind: "retail" | "layaway"
      sale_status:
        | "open"
        | "completed"
        | "voided"
        | "partial_returned"
        | "fully_returned"
      service_type:
        | "repair"
        | "stone_setting"
        | "sizing"
        | "restring"
        | "plating"
        | "engraving"
        | "custom"
      subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "cancelled"
        | "unpaid"
        | "incomplete"
        | "incomplete_expired"
      tenant_role:
        | "owner"
        | "chain_admin"
        | "manager"
        | "pawn_clerk"
        | "repair_tech"
        | "appraiser"
        | "client"
      tenant_type: "chain_hq" | "shop" | "standalone"
      transfer_status:
        | "pending"
        | "in_transit"
        | "received"
        | "cancelled"
        | "accepted"
        | "rejected"
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
      billing_cycle: ["monthly", "yearly"],
      card_present_status: [
        "not_used",
        "pending",
        "succeeded",
        "failed",
        "refunded",
      ],
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
      layaway_status: ["active", "completed", "cancelled", "defaulted"],
      loan_event_type: [
        "issued",
        "payment",
        "extension",
        "redemption",
        "forfeiture",
        "void",
      ],
      loan_status: [
        "active",
        "extended",
        "partial_paid",
        "redeemed",
        "forfeited",
        "voided",
      ],
      message_channel: ["sms", "whatsapp", "email"],
      message_kind: [
        "loan_maturity_t7",
        "loan_maturity_t1",
        "loan_due_today",
        "loan_overdue_t1",
        "loan_overdue_t7",
        "repair_ready",
        "repair_pickup_reminder",
        "layaway_payment_due",
        "layaway_overdue",
        "layaway_completed",
        "custom",
      ],
      message_status: ["queued", "sent", "delivered", "failed", "opted_out"],
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
      payment_method: ["cash", "card", "check", "other"],
      police_report_format: ["fl_leadsonline"],
      register_session_status: ["open", "closed", "reconciled"],
      repair_event_type: [
        "intake",
        "quote_set",
        "approved",
        "started",
        "paused",
        "resumed",
        "parts_needed",
        "parts_received",
        "completed",
        "pickup",
        "abandoned_conversion",
        "void",
        "note",
        "photo_added",
      ],
      repair_photo_kind: ["intake", "in_progress", "final", "reference"],
      repair_status: [
        "intake",
        "quoted",
        "awaiting_approval",
        "in_progress",
        "needs_parts",
        "ready",
        "picked_up",
        "abandoned",
        "voided",
      ],
      return_status: ["issued", "voided"],
      sale_kind: ["retail", "layaway"],
      sale_status: [
        "open",
        "completed",
        "voided",
        "partial_returned",
        "fully_returned",
      ],
      service_type: [
        "repair",
        "stone_setting",
        "sizing",
        "restring",
        "plating",
        "engraving",
        "custom",
      ],
      subscription_status: [
        "trialing",
        "active",
        "past_due",
        "cancelled",
        "unpaid",
        "incomplete",
        "incomplete_expired",
      ],
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
      transfer_status: [
        "pending",
        "in_transit",
        "received",
        "cancelled",
        "accepted",
        "rejected",
      ],
    },
  },
} as const

// Hand-written aliases — re-exported so they survive every regen.
export * from './database-aliases'
