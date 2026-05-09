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
      appraisal_photos: {
        Row: {
          appraisal_id: string
          caption: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          kind: Database["public"]["Enums"]["appraisal_photo_kind"]
          position: number
          storage_path: string
          tenant_id: string
        }
        Insert: {
          appraisal_id: string
          caption?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["appraisal_photo_kind"]
          position?: number
          storage_path: string
          tenant_id: string
        }
        Update: {
          appraisal_id?: string
          caption?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["appraisal_photo_kind"]
          position?: number
          storage_path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appraisal_photos_appraisal_id_fkey"
            columns: ["appraisal_id"]
            isOneToOne: false
            referencedRelation: "appraisals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appraisal_photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appraisal_stones: {
        Row: {
          appraisal_id: string
          cert_lab: string | null
          cert_number: string | null
          certified: boolean
          clarity: string | null
          color: string | null
          count: number
          created_at: string
          cut: string | null
          deleted_at: string | null
          est_carat: number | null
          id: string
          notes: string | null
          position: number
          tenant_id: string
          type: string | null
        }
        Insert: {
          appraisal_id: string
          cert_lab?: string | null
          cert_number?: string | null
          certified?: boolean
          clarity?: string | null
          color?: string | null
          count?: number
          created_at?: string
          cut?: string | null
          deleted_at?: string | null
          est_carat?: number | null
          id?: string
          notes?: string | null
          position?: number
          tenant_id: string
          type?: string | null
        }
        Update: {
          appraisal_id?: string
          cert_lab?: string | null
          cert_number?: string | null
          certified?: boolean
          clarity?: string | null
          color?: string | null
          count?: number
          created_at?: string
          cut?: string | null
          deleted_at?: string | null
          est_carat?: number | null
          id?: string
          notes?: string | null
          position?: number
          tenant_id?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appraisal_stones_appraisal_id_fkey"
            columns: ["appraisal_id"]
            isOneToOne: false
            referencedRelation: "appraisals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appraisal_stones_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appraisals: {
        Row: {
          appraisal_number: string | null
          appraised_value: number
          appraiser_signature_storage_path: string | null
          appraiser_user_id: string
          comparable_data: Json | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_signature_storage_path: string | null
          deleted_at: string | null
          finalized_at: string | null
          finalized_by: string | null
          id: string
          inventory_item_id: string | null
          is_printed: boolean
          item_description: string
          karat: number | null
          metal_type: Database["public"]["Enums"]["metal_type"] | null
          notes: string | null
          printed_at: string | null
          purpose: Database["public"]["Enums"]["appraisal_purpose"]
          replacement_value: number | null
          status: Database["public"]["Enums"]["appraisal_status"]
          tenant_id: string
          updated_at: string
          updated_by: string | null
          valid_from: string
          valid_until: string | null
          valuation_method: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          weight_grams: number | null
        }
        Insert: {
          appraisal_number?: string | null
          appraised_value: number
          appraiser_signature_storage_path?: string | null
          appraiser_user_id: string
          comparable_data?: Json | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_signature_storage_path?: string | null
          deleted_at?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          inventory_item_id?: string | null
          is_printed?: boolean
          item_description: string
          karat?: number | null
          metal_type?: Database["public"]["Enums"]["metal_type"] | null
          notes?: string | null
          printed_at?: string | null
          purpose: Database["public"]["Enums"]["appraisal_purpose"]
          replacement_value?: number | null
          status?: Database["public"]["Enums"]["appraisal_status"]
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          valid_from: string
          valid_until?: string | null
          valuation_method?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          weight_grams?: number | null
        }
        Update: {
          appraisal_number?: string | null
          appraised_value?: number
          appraiser_signature_storage_path?: string | null
          appraiser_user_id?: string
          comparable_data?: Json | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_signature_storage_path?: string | null
          deleted_at?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          inventory_item_id?: string | null
          is_printed?: boolean
          item_description?: string
          karat?: number | null
          metal_type?: Database["public"]["Enums"]["metal_type"] | null
          notes?: string | null
          printed_at?: string | null
          purpose?: Database["public"]["Enums"]["appraisal_purpose"]
          replacement_value?: number | null
          status?: Database["public"]["Enums"]["appraisal_status"]
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          valid_from?: string
          valid_until?: string | null
          valuation_method?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "appraisals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appraisals_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appraisals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
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
      customer_portal_invites: {
        Row: {
          consumed_at: string | null
          consumed_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          email: string
          expires_at: string
          id: string
          tenant_id: string
          token: string
        }
        Insert: {
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          email: string
          expires_at: string
          id?: string
          tenant_id: string
          token?: string
        }
        Update: {
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          email?: string
          expires_at?: string
          id?: string
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_portal_invites_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_portal_invites_tenant_id_fkey"
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
          dl_raw_payload: string | null
          email: string | null
          email_unsubscribe_token: string | null
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
          loyalty_points_balance: number
          marketing_opt_in: boolean
          middle_name: string | null
          notes: string | null
          phone: string | null
          phone_alt: string | null
          photo_url: string | null
          place_of_employment: string | null
          referral_code: string | null
          referral_credited: boolean
          referred_by_customer_id: string | null
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
          dl_raw_payload?: string | null
          email?: string | null
          email_unsubscribe_token?: string | null
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
          loyalty_points_balance?: number
          marketing_opt_in?: boolean
          middle_name?: string | null
          notes?: string | null
          phone?: string | null
          phone_alt?: string | null
          photo_url?: string | null
          place_of_employment?: string | null
          referral_code?: string | null
          referral_credited?: boolean
          referred_by_customer_id?: string | null
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
          dl_raw_payload?: string | null
          email?: string | null
          email_unsubscribe_token?: string | null
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
          loyalty_points_balance?: number
          marketing_opt_in?: boolean
          middle_name?: string | null
          notes?: string | null
          phone?: string | null
          phone_alt?: string | null
          photo_url?: string | null
          place_of_employment?: string | null
          referral_code?: string | null
          referral_credited?: boolean
          referred_by_customer_id?: string | null
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
            foreignKeyName: "customers_referred_by_customer_id_fkey"
            columns: ["referred_by_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ebay_listing_events: {
        Row: {
          created_at: string
          error_text: string | null
          http_status: number | null
          id: string
          kind: Database["public"]["Enums"]["ebay_listing_event_kind"]
          listing_id: string | null
          request_payload: Json | null
          response_payload: Json | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          error_text?: string | null
          http_status?: number | null
          id?: string
          kind: Database["public"]["Enums"]["ebay_listing_event_kind"]
          listing_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          error_text?: string | null
          http_status?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["ebay_listing_event_kind"]
          listing_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ebay_listing_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "ebay_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ebay_listing_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ebay_listings: {
        Row: {
          category_id: string
          condition_id: string
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          description: string
          ebay_listing_id: string | null
          ebay_offer_id: string | null
          ebay_sku: string | null
          error_text: string | null
          format: Database["public"]["Enums"]["ebay_listing_format"]
          id: string
          inventory_item_id: string
          last_synced_at: string | null
          list_price: number
          marketing_message: string | null
          photo_urls: Json
          quantity: number
          sale_id: string | null
          sold_at: string | null
          status: Database["public"]["Enums"]["ebay_listing_status"]
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string | null
          view_count: number | null
          watcher_count: number | null
        }
        Insert: {
          category_id: string
          condition_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          description: string
          ebay_listing_id?: string | null
          ebay_offer_id?: string | null
          ebay_sku?: string | null
          error_text?: string | null
          format?: Database["public"]["Enums"]["ebay_listing_format"]
          id?: string
          inventory_item_id: string
          last_synced_at?: string | null
          list_price: number
          marketing_message?: string | null
          photo_urls?: Json
          quantity?: number
          sale_id?: string | null
          sold_at?: string | null
          status?: Database["public"]["Enums"]["ebay_listing_status"]
          tenant_id: string
          title: string
          updated_at?: string
          updated_by?: string | null
          view_count?: number | null
          watcher_count?: number | null
        }
        Update: {
          category_id?: string
          condition_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          description?: string
          ebay_listing_id?: string | null
          ebay_offer_id?: string | null
          ebay_sku?: string | null
          error_text?: string | null
          format?: Database["public"]["Enums"]["ebay_listing_format"]
          id?: string
          inventory_item_id?: string
          last_synced_at?: string | null
          list_price?: number
          marketing_message?: string | null
          photo_urls?: Json
          quantity?: number
          sale_id?: string | null
          sold_at?: string | null
          status?: Database["public"]["Enums"]["ebay_listing_status"]
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          view_count?: number | null
          watcher_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ebay_listings_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ebay_listings_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ebay_listings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaign_recipients: {
        Row: {
          bounce_reason: string | null
          bounced_at: string | null
          campaign_id: string
          complained_at: string | null
          created_at: string
          customer_id: string
          delivered_at: string | null
          email: string
          failed_at: string | null
          failure_reason: string | null
          id: string
          language: string
          message_log_id: string | null
          resend_message_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["email_campaign_recipient_status"]
          tenant_id: string
        }
        Insert: {
          bounce_reason?: string | null
          bounced_at?: string | null
          campaign_id: string
          complained_at?: string | null
          created_at?: string
          customer_id: string
          delivered_at?: string | null
          email: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          language: string
          message_log_id?: string | null
          resend_message_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_campaign_recipient_status"]
          tenant_id: string
        }
        Update: {
          bounce_reason?: string | null
          bounced_at?: string | null
          campaign_id?: string
          complained_at?: string | null
          created_at?: string
          customer_id?: string
          delivered_at?: string | null
          email?: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          language?: string
          message_log_id?: string | null
          resend_message_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_campaign_recipient_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaign_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaign_recipients_message_log_id_fkey"
            columns: ["message_log_id"]
            isOneToOne: false
            referencedRelation: "message_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaign_recipients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          body_html: string
          body_text: string
          bounced_count: number
          complained_count: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          delivered_count: number
          failed_count: number
          id: string
          name: string
          recipient_count: number
          scheduled_at: string | null
          segment_language: string | null
          segment_marketing_opt_in_only: boolean
          segment_tags: string[]
          sent_at: string | null
          status: Database["public"]["Enums"]["email_campaign_status"]
          subject: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body_html: string
          body_text: string
          bounced_count?: number
          complained_count?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          delivered_count?: number
          failed_count?: number
          id?: string
          name: string
          recipient_count?: number
          scheduled_at?: string | null
          segment_language?: string | null
          segment_marketing_opt_in_only?: boolean
          segment_tags?: string[]
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_campaign_status"]
          subject: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body_html?: string
          body_text?: string
          bounced_count?: number
          complained_count?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          delivered_count?: number
          failed_count?: number
          id?: string
          name?: string
          recipient_count?: number
          scheduled_at?: string | null
          segment_language?: string | null
          segment_marketing_opt_in_only?: boolean
          segment_tags?: string[]
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_campaign_status"]
          subject?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_tenant_id_fkey"
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
          is_hidden_from_catalog: boolean
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
          is_hidden_from_catalog?: boolean
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
          is_hidden_from_catalog?: boolean
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
          pawn_category_slug: string | null
          pawn_subcategory_slug: string | null
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
          pawn_category_slug?: string | null
          pawn_subcategory_slug?: string | null
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
          pawn_category_slug?: string | null
          pawn_subcategory_slug?: string | null
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
          min_monthly_charge: number | null
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
          min_monthly_charge?: number | null
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
          min_monthly_charge?: number | null
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
      loyalty_events: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          kind: string
          performed_by: string | null
          points_delta: number
          reason: string | null
          source_id: string | null
          source_kind: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          kind: string
          performed_by?: string | null
          points_delta: number
          reason?: string | null
          source_id?: string | null
          source_kind?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          kind?: string
          performed_by?: string | null
          points_delta?: number
          reason?: string | null
          source_id?: string | null
          source_kind?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      market_data_points: {
        Row: {
          amount: number
          created_at: string
          est_value: number | null
          id: string
          item_category: Database["public"]["Enums"]["inventory_category"]
          item_description: string
          item_embedding: string | null
          karat: number | null
          metal_type: Database["public"]["Enums"]["metal_type"] | null
          source_row_id: string
          source_table: string
          source_tenant_id: string
          state: string | null
          transaction_date: string
          transaction_type: string
          weight_grams: number | null
        }
        Insert: {
          amount: number
          created_at?: string
          est_value?: number | null
          id?: string
          item_category: Database["public"]["Enums"]["inventory_category"]
          item_description: string
          item_embedding?: string | null
          karat?: number | null
          metal_type?: Database["public"]["Enums"]["metal_type"] | null
          source_row_id: string
          source_table: string
          source_tenant_id: string
          state?: string | null
          transaction_date: string
          transaction_type: string
          weight_grams?: number | null
        }
        Update: {
          amount?: number
          created_at?: string
          est_value?: number | null
          id?: string
          item_category?: Database["public"]["Enums"]["inventory_category"]
          item_description?: string
          item_embedding?: string | null
          karat?: number | null
          metal_type?: Database["public"]["Enums"]["metal_type"] | null
          source_row_id?: string
          source_table?: string
          source_tenant_id?: string
          state?: string | null
          transaction_date?: string
          transaction_type?: string
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "market_data_points_source_tenant_id_fkey"
            columns: ["source_tenant_id"]
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
      pawn_intake_categories: {
        Row: {
          created_at: string
          deleted_at: string | null
          icon: string
          id: string
          is_active: boolean
          label: string
          parent_id: string | null
          requires_ffl: boolean
          slug: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          label: string
          parent_id?: string | null
          requires_ffl?: boolean
          slug: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          label?: string
          parent_id?: string | null
          requires_ffl?: boolean
          slug?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pawn_intake_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "pawn_intake_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pawn_intake_categories_tenant_id_fkey"
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
          assigned_at: string | null
          assigned_to: string | null
          balance_due: number | null
          claimed_at: string | null
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
          assigned_at?: string | null
          assigned_to?: string | null
          balance_due?: number | null
          claimed_at?: string | null
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
          assigned_at?: string | null
          assigned_to?: string | null
          balance_due?: number | null
          claimed_at?: string | null
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
          google_place_id: string | null
          google_reviews_daily_quota: number | null
          google_reviews_hidden_review_times: number[]
          google_reviews_min_star_floor: number
          loyalty_earn_rate_loan_interest: number
          loyalty_earn_rate_retail: number
          loyalty_enabled: boolean
          loyalty_redemption_rate: number
          loyalty_referral_bonus: number
          min_loan_amount: number | null
          pawn_ticket_backpage: string | null
          resend_from_email: string | null
          resend_from_name: string | null
          tenant_id: string
          twilio_account_sid: string | null
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
          google_place_id?: string | null
          google_reviews_daily_quota?: number | null
          google_reviews_hidden_review_times?: number[]
          google_reviews_min_star_floor?: number
          loyalty_earn_rate_loan_interest?: number
          loyalty_earn_rate_retail?: number
          loyalty_enabled?: boolean
          loyalty_redemption_rate?: number
          loyalty_referral_bonus?: number
          min_loan_amount?: number | null
          pawn_ticket_backpage?: string | null
          resend_from_email?: string | null
          resend_from_name?: string | null
          tenant_id: string
          twilio_account_sid?: string | null
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
          google_place_id?: string | null
          google_reviews_daily_quota?: number | null
          google_reviews_hidden_review_times?: number[]
          google_reviews_min_star_floor?: number
          loyalty_earn_rate_loan_interest?: number
          loyalty_earn_rate_retail?: number
          loyalty_enabled?: boolean
          loyalty_redemption_rate?: number
          loyalty_referral_bonus?: number
          min_loan_amount?: number | null
          pawn_ticket_backpage?: string | null
          resend_from_email?: string | null
          resend_from_name?: string | null
          tenant_id?: string
          twilio_account_sid?: string | null
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
      spot_price_overrides: {
        Row: {
          created_at: string
          id: string
          metal_type: Database["public"]["Enums"]["metal_type"]
          multiplier: number
          purity: Database["public"]["Enums"]["metal_purity"]
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          metal_type: Database["public"]["Enums"]["metal_type"]
          multiplier?: number
          purity: Database["public"]["Enums"]["metal_purity"]
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          metal_type?: Database["public"]["Enums"]["metal_type"]
          multiplier?: number
          purity?: Database["public"]["Enums"]["metal_purity"]
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spot_price_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      spot_prices: {
        Row: {
          created_at: string
          currency: string
          fetched_at: string
          id: string
          metal_type: Database["public"]["Enums"]["metal_type"]
          price_per_gram: number
          price_per_troy_oz: number
          purity: Database["public"]["Enums"]["metal_purity"]
          source: string
          source_request_id: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          fetched_at: string
          id?: string
          metal_type: Database["public"]["Enums"]["metal_type"]
          price_per_gram: number
          price_per_troy_oz: number
          purity: Database["public"]["Enums"]["metal_purity"]
          source: string
          source_request_id?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          fetched_at?: string
          id?: string
          metal_type?: Database["public"]["Enums"]["metal_type"]
          price_per_gram?: number
          price_per_troy_oz?: number
          purity?: Database["public"]["Enums"]["metal_purity"]
          source?: string
          source_request_id?: string | null
        }
        Relationships: []
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
          stripe_account_id: string | null
          stripe_connected_at: string | null
          stripe_publishable_key: string | null
          stripe_terminal_location_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          billing_enabled?: boolean
          created_at?: string
          stripe_account_id?: string | null
          stripe_connected_at?: string | null
          stripe_publishable_key?: string | null
          stripe_terminal_location_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          billing_enabled?: boolean
          created_at?: string
          stripe_account_id?: string | null
          stripe_connected_at?: string | null
          stripe_publishable_key?: string | null
          stripe_terminal_location_id?: string | null
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
      tenant_ebay_credentials: {
        Row: {
          access_token_expires_at: string | null
          connected_at: string | null
          created_at: string
          disconnected_at: string | null
          ebay_user_id: string | null
          environment: Database["public"]["Enums"]["ebay_environment"]
          fulfillment_policy_id: string | null
          merchant_location_key: string | null
          payment_policy_id: string | null
          refresh_token_expires_at: string | null
          return_policy_id: string | null
          site_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          access_token_expires_at?: string | null
          connected_at?: string | null
          created_at?: string
          disconnected_at?: string | null
          ebay_user_id?: string | null
          environment?: Database["public"]["Enums"]["ebay_environment"]
          fulfillment_policy_id?: string | null
          merchant_location_key?: string | null
          payment_policy_id?: string | null
          refresh_token_expires_at?: string | null
          return_policy_id?: string | null
          site_id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          access_token_expires_at?: string | null
          connected_at?: string | null
          created_at?: string
          disconnected_at?: string | null
          ebay_user_id?: string | null
          environment?: Database["public"]["Enums"]["ebay_environment"]
          fulfillment_policy_id?: string | null
          merchant_location_key?: string | null
          payment_policy_id?: string | null
          refresh_token_expires_at?: string | null
          return_policy_id?: string | null
          site_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_ebay_credentials_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_google_reviews: {
        Row: {
          fetched_at: string
          last_error: string | null
          last_error_at: string | null
          payload: Json
          place_id: string
          quota_calls_used: number
          quota_window_start: string | null
          rating: number | null
          tenant_id: string
          total_review_count: number | null
        }
        Insert: {
          fetched_at: string
          last_error?: string | null
          last_error_at?: string | null
          payload: Json
          place_id: string
          quota_calls_used?: number
          quota_window_start?: string | null
          rating?: number | null
          tenant_id: string
          total_review_count?: number | null
        }
        Update: {
          fetched_at?: string
          last_error?: string | null
          last_error_at?: string | null
          payload?: Json
          place_id?: string
          quota_calls_used?: number
          quota_window_start?: string | null
          rating?: number | null
          tenant_id?: string
          total_review_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_google_reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_loan_rates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_default: boolean
          label: string
          min_monthly_charge: number | null
          rate_monthly: number
          sort_order: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          label: string
          min_monthly_charge?: number | null
          rate_monthly: number
          sort_order?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          label?: string
          min_monthly_charge?: number | null
          rate_monthly?: number
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_loan_rates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_secrets: {
        Row: {
          created_at: string
          id: string
          kind: string
          tenant_id: string
          updated_at: string
          vault_secret_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          tenant_id: string
          updated_at?: string
          vault_secret_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          tenant_id?: string
          updated_at?: string
          vault_secret_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_secrets_tenant_id_fkey"
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
          agency_store_id: string | null
          city: string | null
          created_at: string
          dba: string | null
          default_currency: string
          email: string | null
          has_firearms: boolean
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
          public_about: string | null
          public_catalog_enabled: boolean
          public_hours: Json | null
          public_landing_enabled: boolean
          public_slug: string | null
          state: string | null
          tenant_type: Database["public"]["Enums"]["tenant_type"]
          updated_at: string
          zip: string | null
        }
        Insert: {
          address?: string | null
          agency_store_id?: string | null
          city?: string | null
          created_at?: string
          dba?: string | null
          default_currency?: string
          email?: string | null
          has_firearms?: boolean
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
          public_about?: string | null
          public_catalog_enabled?: boolean
          public_hours?: Json | null
          public_landing_enabled?: boolean
          public_slug?: string | null
          state?: string | null
          tenant_type?: Database["public"]["Enums"]["tenant_type"]
          updated_at?: string
          zip?: string | null
        }
        Update: {
          address?: string | null
          agency_store_id?: string | null
          city?: string | null
          created_at?: string
          dba?: string | null
          default_currency?: string
          email?: string | null
          has_firearms?: boolean
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
          public_about?: string | null
          public_catalog_enabled?: boolean
          public_hours?: Json | null
          public_landing_enabled?: boolean
          public_slug?: string | null
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
      watch_models: {
        Row: {
          brand: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          est_value_max: number
          est_value_min: number
          id: string
          model: string
          nickname: string | null
          notes: string | null
          reference_no: string | null
          updated_at: string
          updated_by: string | null
          year_end: number | null
          year_start: number | null
        }
        Insert: {
          brand: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          est_value_max: number
          est_value_min: number
          id?: string
          model: string
          nickname?: string | null
          notes?: string | null
          reference_no?: string | null
          updated_at?: string
          updated_by?: string | null
          year_end?: number | null
          year_start?: number | null
        }
        Update: {
          brand?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          est_value_max?: number
          est_value_min?: number
          id?: string
          model?: string
          nickname?: string | null
          notes?: string | null
          reference_no?: string | null
          updated_at?: string
          updated_by?: string | null
          year_end?: number | null
          year_start?: number | null
        }
        Relationships: []
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
      consume_google_reviews_quota: {
        Args: { p_cap: number; p_place_id: string; p_tenant_id: string }
        Returns: boolean
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
      get_tenant_secret: {
        Args: { p_kind: string; p_tenant_id: string }
        Returns: string
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
      seed_pawn_intake_categories: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      seed_pawn_intake_subcategories: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      set_tenant_secret: {
        Args: { p_kind: string; p_tenant_id: string; p_value: string }
        Returns: string
      }
    }
    Enums: {
      appraisal_photo_kind:
        | "front"
        | "back"
        | "detail"
        | "serial"
        | "cert"
        | "reference"
      appraisal_purpose:
        | "insurance"
        | "estate"
        | "sale"
        | "pawn_intake"
        | "collateral_review"
        | "customer_request"
      appraisal_status: "draft" | "finalized" | "voided"
      billing_cycle: "monthly" | "yearly"
      card_present_status:
        | "not_used"
        | "pending"
        | "succeeded"
        | "failed"
        | "refunded"
      comm_preference: "email" | "sms" | "whatsapp" | "none"
      customer_doc_kind: "id_scan" | "signature"
      ebay_environment: "sandbox" | "production"
      ebay_listing_event_kind:
        | "create_offer"
        | "publish"
        | "update"
        | "end"
        | "sync"
        | "webhook_received"
      ebay_listing_format: "FIXED_PRICE" | "AUCTION"
      ebay_listing_status:
        | "draft"
        | "submitting"
        | "active"
        | "ended"
        | "sold"
        | "error"
      email_campaign_recipient_status:
        | "queued"
        | "sent"
        | "delivered"
        | "bounced"
        | "complained"
        | "failed"
        | "skipped"
      email_campaign_status:
        | "draft"
        | "scheduled"
        | "sending"
        | "sent"
        | "canceled"
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
        | "saas_trial_ending"
        | "saas_payment_failed"
        | "saas_payment_recovered"
        | "saas_subscription_cancelled"
        | "portal_invite"
        | "email_campaign"
      message_status: "queued" | "sent" | "delivered" | "failed" | "opted_out"
      metal_purity:
        | "pure_24k"
        | "22k"
        | "18k"
        | "14k"
        | "10k"
        | "sterling_925"
        | "platinum_950"
        | "palladium_950"
        | "fine"
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
        | "assigned_to_tech"
        | "claimed_by_tech"
        | "qa_started"
        | "qa_completed"
        | "qa_returned"
      repair_photo_kind: "intake" | "in_progress" | "final" | "reference"
      repair_status:
        | "intake"
        | "quoted"
        | "awaiting_approval"
        | "assigned"
        | "in_progress"
        | "needs_parts"
        | "tech_qa"
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
      appraisal_photo_kind: [
        "front",
        "back",
        "detail",
        "serial",
        "cert",
        "reference",
      ],
      appraisal_purpose: [
        "insurance",
        "estate",
        "sale",
        "pawn_intake",
        "collateral_review",
        "customer_request",
      ],
      appraisal_status: ["draft", "finalized", "voided"],
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
      ebay_environment: ["sandbox", "production"],
      ebay_listing_event_kind: [
        "create_offer",
        "publish",
        "update",
        "end",
        "sync",
        "webhook_received",
      ],
      ebay_listing_format: ["FIXED_PRICE", "AUCTION"],
      ebay_listing_status: [
        "draft",
        "submitting",
        "active",
        "ended",
        "sold",
        "error",
      ],
      email_campaign_recipient_status: [
        "queued",
        "sent",
        "delivered",
        "bounced",
        "complained",
        "failed",
        "skipped",
      ],
      email_campaign_status: [
        "draft",
        "scheduled",
        "sending",
        "sent",
        "canceled",
      ],
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
        "saas_trial_ending",
        "saas_payment_failed",
        "saas_payment_recovered",
        "saas_subscription_cancelled",
        "portal_invite",
        "email_campaign",
      ],
      message_status: ["queued", "sent", "delivered", "failed", "opted_out"],
      metal_purity: [
        "pure_24k",
        "22k",
        "18k",
        "14k",
        "10k",
        "sterling_925",
        "platinum_950",
        "palladium_950",
        "fine",
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
        "assigned_to_tech",
        "claimed_by_tech",
        "qa_started",
        "qa_completed",
        "qa_returned",
      ],
      repair_photo_kind: ["intake", "in_progress", "final", "reference"],
      repair_status: [
        "intake",
        "quoted",
        "awaiting_approval",
        "assigned",
        "in_progress",
        "needs_parts",
        "tech_qa",
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
