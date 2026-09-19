// このファイルは scripts/gen-db-types.mjs により自動生成されています。手で編集しないでください。
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      adjustments: {
        Row: {
          id: string
          company_id: string
          driver_month_id: string
          label: string
          amount: number
          count_as_profit: boolean
          recurring_id: string | null
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          driver_month_id: string
          label: string
          amount: number
          count_as_profit?: boolean
          recurring_id?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          driver_month_id?: string
          label?: string
          amount?: number
          count_as_profit?: boolean
          recurring_id?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_conversations: {
        Row: {
          id: string
          company_id: string
          title: string
          month: string | null
          message_count: number
          last_message_at: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          title?: string
          month?: string | null
          message_count?: number
          last_message_at?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          title?: string
          month?: string | null
          message_count?: number
          last_message_at?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_insights: {
        Row: {
          id: string
          company_id: string
          month: string
          model: string
          findings: Json
          created_by: string | null
          created_at: string
          kind: string
          summary: string
          actions: Json
        }
        Insert: {
          id?: string
          company_id: string
          month: string
          model?: string
          findings?: Json
          created_by?: string | null
          created_at?: string
          kind?: string
          summary?: string
          actions?: Json
        }
        Update: {
          id?: string
          company_id?: string
          month?: string
          model?: string
          findings?: Json
          created_by?: string | null
          created_at?: string
          kind?: string
          summary?: string
          actions?: Json
        }
        Relationships: []
      }
      ai_messages: {
        Row: {
          id: string
          company_id: string
          conversation_id: string
          role: string
          content: string
          model: string
          data_months: number
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          company_id: string
          conversation_id: string
          role: string
          content?: string
          model?: string
          data_months?: number
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          conversation_id?: string
          role?: string
          content?: string
          model?: string
          data_months?: number
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      alerts: {
        Row: {
          id: string
          company_id: string
          month: string | null
          code: string
          severity: Database["public"]["Enums"]["alert_severity"]
          title: string
          detail: string
          amount: number | null
          ref_table: string
          ref_id: string
          href: string
          status: Database["public"]["Enums"]["alert_status"]
          fingerprint: string
          detected_at: string
          resolved_at: string | null
          resolved_by: string | null
          note: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          month?: string | null
          code: string
          severity?: Database["public"]["Enums"]["alert_severity"]
          title: string
          detail?: string
          amount?: number | null
          ref_table?: string
          ref_id?: string
          href?: string
          status?: Database["public"]["Enums"]["alert_status"]
          fingerprint: string
          detected_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          note?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          month?: string | null
          code?: string
          severity?: Database["public"]["Enums"]["alert_severity"]
          title?: string
          detail?: string
          amount?: number | null
          ref_table?: string
          ref_id?: string
          href?: string
          status?: Database["public"]["Enums"]["alert_status"]
          fingerprint?: string
          detected_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          note?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      applicant_events: {
        Row: {
          id: string
          company_id: string
          applicant_id: string
          happened_on: string
          stage: Database["public"]["Enums"]["applicant_stage"] | null
          note: string
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          company_id: string
          applicant_id: string
          happened_on?: string
          stage?: Database["public"]["Enums"]["applicant_stage"] | null
          note?: string
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          applicant_id?: string
          happened_on?: string
          stage?: Database["public"]["Enums"]["applicant_stage"] | null
          note?: string
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      applicants: {
        Row: {
          id: string
          company_id: string
          name: string
          kana: string
          phone: string
          email: string
          source: string
          stage: Database["public"]["Enums"]["applicant_stage"]
          applied_on: string
          interview_on: string | null
          started_on: string | null
          driver_id: string | null
          has_license: boolean | null
          has_vehicle: boolean | null
          checklist: Json
          memo: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          name: string
          kana?: string
          phone?: string
          email?: string
          source?: string
          stage?: Database["public"]["Enums"]["applicant_stage"]
          applied_on?: string
          interview_on?: string | null
          started_on?: string | null
          driver_id?: string | null
          has_license?: boolean | null
          has_vehicle?: boolean | null
          checklist?: Json
          memo?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          name?: string
          kana?: string
          phone?: string
          email?: string
          source?: string
          stage?: Database["public"]["Enums"]["applicant_stage"]
          applied_on?: string
          interview_on?: string | null
          started_on?: string | null
          driver_id?: string | null
          has_license?: boolean | null
          has_vehicle?: boolean | null
          checklist?: Json
          memo?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          id: string
          company_id: string | null
          actor_id: string | null
          action: string
          table_name: string
          record_id: string | null
          before: Json | null
          after: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          company_id?: string | null
          actor_id?: string | null
          action: string
          table_name: string
          record_id?: string | null
          before?: Json | null
          after?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          company_id?: string | null
          actor_id?: string | null
          action?: string
          table_name?: string
          record_id?: string | null
          before?: Json | null
          after?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      bank_imports: {
        Row: {
          id: string
          company_id: string
          file_name: string
          format: string
          row_count: number
          inserted_count: number
          skipped_count: number
          matched_count: number
          period_from: string | null
          period_to: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          company_id: string
          file_name?: string
          format?: string
          row_count?: number
          inserted_count?: number
          skipped_count?: number
          matched_count?: number
          period_from?: string | null
          period_to?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          file_name?: string
          format?: string
          row_count?: number
          inserted_count?: number
          skipped_count?: number
          matched_count?: number
          period_from?: string | null
          period_to?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      bank_transactions: {
        Row: {
          id: string
          company_id: string
          import_id: string | null
          txn_date: string
          description: string
          amount: number
          balance: number | null
          status: Database["public"]["Enums"]["bank_txn_status"]
          invoice_id: string | null
          expense_id: string | null
          matched_at: string | null
          matched_by: string | null
          auto_matched: boolean
          memo: string
          fingerprint: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          import_id?: string | null
          txn_date: string
          description?: string
          amount: number
          balance?: number | null
          status?: Database["public"]["Enums"]["bank_txn_status"]
          invoice_id?: string | null
          expense_id?: string | null
          matched_at?: string | null
          matched_by?: string | null
          auto_matched?: boolean
          memo?: string
          fingerprint: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          import_id?: string | null
          txn_date?: string
          description?: string
          amount?: number
          balance?: number | null
          status?: Database["public"]["Enums"]["bank_txn_status"]
          invoice_id?: string | null
          expense_id?: string | null
          matched_at?: string | null
          matched_by?: string | null
          auto_matched?: boolean
          memo?: string
          fingerprint?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      cash_snapshots: {
        Row: {
          id: string
          company_id: string
          as_of: string
          balance: number
          memo: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          as_of: string
          balance: number
          memo?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          as_of?: string
          balance?: number
          memo?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      chat_channels: {
        Row: {
          id: string
          company_id: string
          name: string
          description: string
          is_default: boolean
          is_active: boolean
          sort_order: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          name: string
          description?: string
          is_default?: boolean
          is_active?: boolean
          sort_order?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          name?: string
          description?: string
          is_default?: boolean
          is_active?: boolean
          sort_order?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          id: string
          company_id: string
          channel_id: string
          author_id: string
          body: string
          mentions: Json
          edited_at: string | null
          created_at: string
          updated_at: string
          author_name: string
          author_role: Database["public"]["Enums"]["user_role"] | null
        }
        Insert: {
          id?: string
          company_id: string
          channel_id: string
          author_id: string
          body: string
          mentions?: Json
          edited_at?: string | null
          created_at?: string
          updated_at?: string
          author_name?: string
          author_role?: Database["public"]["Enums"]["user_role"] | null
        }
        Update: {
          id?: string
          company_id?: string
          channel_id?: string
          author_id?: string
          body?: string
          mentions?: Json
          edited_at?: string | null
          created_at?: string
          updated_at?: string
          author_name?: string
          author_role?: Database["public"]["Enums"]["user_role"] | null
        }
        Relationships: []
      }
      chat_reads: {
        Row: {
          company_id: string
          channel_id: string
          profile_id: string
          last_read_at: string
          updated_at: string
        }
        Insert: {
          company_id: string
          channel_id: string
          profile_id: string
          last_read_at?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          channel_id?: string
          profile_id?: string
          last_read_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          id: string
          company_id: string
          name: string
          honorific: string
          address: string
          tel: string
          invoice_reg_no: string
          payment_month_offset: number
          payment_day: number
          memo: string
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          name: string
          honorific?: string
          address?: string
          tel?: string
          invoice_reg_no?: string
          payment_month_offset?: number
          payment_day?: number
          memo?: string
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          name?: string
          honorific?: string
          address?: string
          tel?: string
          invoice_reg_no?: string
          payment_month_offset?: number
          payment_day?: number
          memo?: string
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          id: string
          name: string
          rounding_mode: Database["public"]["Enums"]["rounding_mode"]
          default_royalty_rate: number
          default_mgmt_fee: number
          payout_month_offset: number
          payout_day: number
          statement_note: string
          invoice_reg_no: string
          address: string
          tel: string
          driver_portal_show_royalty: boolean
          yayoi_accounts: Json
          created_at: string
          updated_at: string
          tax_rate: number
          tax_rounding: Database["public"]["Enums"]["rounding_mode"]
          logo_path: string | null
          seal_path: string | null
          driver_portal_show_open_month: boolean
          fiscal_month: number
          fb_consignor_code: string
          fb_consignor_kana: string
          fb_bank_code: string
          fb_bank_name: string
          fb_branch_code: string
          fb_branch_name: string
          fb_account_type: Database["public"]["Enums"]["bank_account_type"] | null
          fb_account_number: string
        }
        Insert: {
          id?: string
          name: string
          rounding_mode?: Database["public"]["Enums"]["rounding_mode"]
          default_royalty_rate?: number
          default_mgmt_fee?: number
          payout_month_offset?: number
          payout_day?: number
          statement_note?: string
          invoice_reg_no?: string
          address?: string
          tel?: string
          driver_portal_show_royalty?: boolean
          yayoi_accounts?: Json
          created_at?: string
          updated_at?: string
          tax_rate?: number
          tax_rounding?: Database["public"]["Enums"]["rounding_mode"]
          logo_path?: string | null
          seal_path?: string | null
          driver_portal_show_open_month?: boolean
          fiscal_month?: number
          fb_consignor_code?: string
          fb_consignor_kana?: string
          fb_bank_code?: string
          fb_bank_name?: string
          fb_branch_code?: string
          fb_branch_name?: string
          fb_account_type?: Database["public"]["Enums"]["bank_account_type"] | null
          fb_account_number?: string
        }
        Update: {
          id?: string
          name?: string
          rounding_mode?: Database["public"]["Enums"]["rounding_mode"]
          default_royalty_rate?: number
          default_mgmt_fee?: number
          payout_month_offset?: number
          payout_day?: number
          statement_note?: string
          invoice_reg_no?: string
          address?: string
          tel?: string
          driver_portal_show_royalty?: boolean
          yayoi_accounts?: Json
          created_at?: string
          updated_at?: string
          tax_rate?: number
          tax_rounding?: Database["public"]["Enums"]["rounding_mode"]
          logo_path?: string | null
          seal_path?: string | null
          driver_portal_show_open_month?: boolean
          fiscal_month?: number
          fb_consignor_code?: string
          fb_consignor_kana?: string
          fb_bank_code?: string
          fb_bank_name?: string
          fb_branch_code?: string
          fb_branch_name?: string
          fb_account_type?: Database["public"]["Enums"]["bank_account_type"] | null
          fb_account_number?: string
        }
        Relationships: []
      }
      contracts: {
        Row: {
          id: string
          company_id: string
          driver_id: string
          title: string
          status: Database["public"]["Enums"]["contract_status"]
          start_on: string
          end_on: string | null
          auto_renew: boolean
          notice_days: number
          file_path: string
          agreed_at: string | null
          memo: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          driver_id: string
          title?: string
          status?: Database["public"]["Enums"]["contract_status"]
          start_on: string
          end_on?: string | null
          auto_renew?: boolean
          notice_days?: number
          file_path?: string
          agreed_at?: string | null
          memo?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          driver_id?: string
          title?: string
          status?: Database["public"]["Enums"]["contract_status"]
          start_on?: string
          end_on?: string | null
          auto_renew?: boolean
          notice_days?: number
          file_path?: string
          agreed_at?: string | null
          memo?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      daily_reports: {
        Row: {
          id: string
          company_id: string
          work_date: string
          month: string
          driver_id: string
          vehicle_id: string | null
          pre_at: string | null
          pre_method: Database["public"]["Enums"]["roll_call_method"] | null
          pre_alcohol: number | null
          pre_alcohol_ok: boolean | null
          pre_health_ok: boolean | null
          pre_inspection_ok: boolean | null
          pre_instruction: string
          pre_by: string | null
          post_at: string | null
          post_method: Database["public"]["Enums"]["roll_call_method"] | null
          post_alcohol: number | null
          post_alcohol_ok: boolean | null
          post_condition_ok: boolean | null
          post_incident: string
          post_by: string | null
          start_at: string | null
          end_at: string | null
          break_minutes: number
          distance_km: number | null
          odo_start: number | null
          odo_end: number | null
          memo: string
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          work_date: string
          month: string
          driver_id: string
          vehicle_id?: string | null
          pre_at?: string | null
          pre_method?: Database["public"]["Enums"]["roll_call_method"] | null
          pre_alcohol?: number | null
          pre_alcohol_ok?: boolean | null
          pre_health_ok?: boolean | null
          pre_inspection_ok?: boolean | null
          pre_instruction?: string
          pre_by?: string | null
          post_at?: string | null
          post_method?: Database["public"]["Enums"]["roll_call_method"] | null
          post_alcohol?: number | null
          post_alcohol_ok?: boolean | null
          post_condition_ok?: boolean | null
          post_incident?: string
          post_by?: string | null
          start_at?: string | null
          end_at?: string | null
          break_minutes?: number
          distance_km?: number | null
          odo_start?: number | null
          odo_end?: number | null
          memo?: string
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          work_date?: string
          month?: string
          driver_id?: string
          vehicle_id?: string | null
          pre_at?: string | null
          pre_method?: Database["public"]["Enums"]["roll_call_method"] | null
          pre_alcohol?: number | null
          pre_alcohol_ok?: boolean | null
          pre_health_ok?: boolean | null
          pre_inspection_ok?: boolean | null
          pre_instruction?: string
          pre_by?: string | null
          post_at?: string | null
          post_method?: Database["public"]["Enums"]["roll_call_method"] | null
          post_alcohol?: number | null
          post_alcohol_ok?: boolean | null
          post_condition_ok?: boolean | null
          post_incident?: string
          post_by?: string | null
          start_at?: string | null
          end_at?: string | null
          break_minutes?: number
          distance_km?: number | null
          odo_start?: number | null
          odo_end?: number | null
          memo?: string
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          id: string
          company_id: string
          kind: Database["public"]["Enums"]["document_kind"]
          driver_id: string | null
          vehicle_id: string | null
          label: string
          number: string
          issued_on: string | null
          expires_on: string | null
          reminder_days: number
          file_path: string
          memo: string
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          kind: Database["public"]["Enums"]["document_kind"]
          driver_id?: string | null
          vehicle_id?: string | null
          label?: string
          number?: string
          issued_on?: string | null
          expires_on?: string | null
          reminder_days?: number
          file_path?: string
          memo?: string
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          kind?: Database["public"]["Enums"]["document_kind"]
          driver_id?: string | null
          vehicle_id?: string | null
          label?: string
          number?: string
          issued_on?: string | null
          expires_on?: string | null
          reminder_days?: number
          file_path?: string
          memo?: string
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      driver_instructions: {
        Row: {
          id: string
          company_id: string
          driver_id: string
          kind: string
          instructed_on: string
          hours: number
          topics: string
          instructor: string
          memo: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          driver_id: string
          kind?: string
          instructed_on: string
          hours?: number
          topics?: string
          instructor?: string
          memo?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          driver_id?: string
          kind?: string
          instructed_on?: string
          hours?: number
          topics?: string
          instructor?: string
          memo?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      driver_months: {
        Row: {
          id: string
          company_id: string
          month: string
          driver_id: string
          mgmt_fee: number
          memo: string
          created_at: string
          updated_at: string
          tax_rate: number | null
          tax_rounding: Database["public"]["Enums"]["rounding_mode"] | null
          tax_mode: Database["public"]["Enums"]["tax_mode"] | null
        }
        Insert: {
          id?: string
          company_id: string
          month: string
          driver_id: string
          mgmt_fee?: number
          memo?: string
          created_at?: string
          updated_at?: string
          tax_rate?: number | null
          tax_rounding?: Database["public"]["Enums"]["rounding_mode"] | null
          tax_mode?: Database["public"]["Enums"]["tax_mode"] | null
        }
        Update: {
          id?: string
          company_id?: string
          month?: string
          driver_id?: string
          mgmt_fee?: number
          memo?: string
          created_at?: string
          updated_at?: string
          tax_rate?: number | null
          tax_rounding?: Database["public"]["Enums"]["rounding_mode"] | null
          tax_mode?: Database["public"]["Enums"]["tax_mode"] | null
        }
        Relationships: []
      }
      driver_pay_overrides: {
        Row: {
          company_id: string
          driver_id: string
          project_item_id: string
          pay_rate: number | null
          created_at: string
          updated_at: string
          bill_rate: number | null
        }
        Insert: {
          company_id: string
          driver_id: string
          project_item_id: string
          pay_rate?: number | null
          created_at?: string
          updated_at?: string
          bill_rate?: number | null
        }
        Update: {
          company_id?: string
          driver_id?: string
          project_item_id?: string
          pay_rate?: number | null
          created_at?: string
          updated_at?: string
          bill_rate?: number | null
        }
        Relationships: []
      }
      driver_recurring_adjustments: {
        Row: {
          id: string
          company_id: string
          driver_id: string
          label: string
          amount: number
          count_as_profit: boolean
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          driver_id: string
          label: string
          amount: number
          count_as_profit?: boolean
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          driver_id?: string
          label?: string
          amount?: number
          count_as_profit?: boolean
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      drivers: {
        Row: {
          id: string
          company_id: string
          name: string
          kana: string
          is_active: boolean
          royalty_rate: number | null
          mgmt_fee: number
          rounding_mode: Database["public"]["Enums"]["rounding_mode"] | null
          phone: string
          email: string
          bank_info: string
          memo: string
          sort_order: number
          created_at: string
          updated_at: string
          tax_mode: Database["public"]["Enums"]["tax_mode"]
          invoice_reg_no: string
          payout_month_offset: number | null
          payout_day: number | null
          line_user_id: string
          line_linked_at: string | null
          bank_code: string
          bank_name: string
          branch_code: string
          branch_name: string
          account_type: Database["public"]["Enums"]["bank_account_type"] | null
          account_number: string
          account_holder_kana: string
        }
        Insert: {
          id?: string
          company_id: string
          name: string
          kana?: string
          is_active?: boolean
          royalty_rate?: number | null
          mgmt_fee?: number
          rounding_mode?: Database["public"]["Enums"]["rounding_mode"] | null
          phone?: string
          email?: string
          bank_info?: string
          memo?: string
          sort_order?: number
          created_at?: string
          updated_at?: string
          tax_mode?: Database["public"]["Enums"]["tax_mode"]
          invoice_reg_no?: string
          payout_month_offset?: number | null
          payout_day?: number | null
          line_user_id?: string
          line_linked_at?: string | null
          bank_code?: string
          bank_name?: string
          branch_code?: string
          branch_name?: string
          account_type?: Database["public"]["Enums"]["bank_account_type"] | null
          account_number?: string
          account_holder_kana?: string
        }
        Update: {
          id?: string
          company_id?: string
          name?: string
          kana?: string
          is_active?: boolean
          royalty_rate?: number | null
          mgmt_fee?: number
          rounding_mode?: Database["public"]["Enums"]["rounding_mode"] | null
          phone?: string
          email?: string
          bank_info?: string
          memo?: string
          sort_order?: number
          created_at?: string
          updated_at?: string
          tax_mode?: Database["public"]["Enums"]["tax_mode"]
          invoice_reg_no?: string
          payout_month_offset?: number | null
          payout_day?: number | null
          line_user_id?: string
          line_linked_at?: string | null
          bank_code?: string
          bank_name?: string
          branch_code?: string
          branch_name?: string
          account_type?: Database["public"]["Enums"]["bank_account_type"] | null
          account_number?: string
          account_holder_kana?: string
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          id: string
          company_id: string
          name: string
          kind: Database["public"]["Enums"]["expense_kind"]
          memo: string
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          name: string
          kind?: Database["public"]["Enums"]["expense_kind"]
          memo?: string
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          name?: string
          kind?: Database["public"]["Enums"]["expense_kind"]
          memo?: string
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          id: string
          company_id: string
          month: string
          category_id: string
          label: string
          amount: number
          tax_mode: Database["public"]["Enums"]["tax_mode"]
          incurred_on: string | null
          driver_id: string | null
          project_id: string | null
          vendor: string
          memo: string
          recurring_id: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
          receipt_path: string
          ocr: Json
        }
        Insert: {
          id?: string
          company_id: string
          month: string
          category_id: string
          label: string
          amount: number
          tax_mode?: Database["public"]["Enums"]["tax_mode"]
          incurred_on?: string | null
          driver_id?: string | null
          project_id?: string | null
          vendor?: string
          memo?: string
          recurring_id?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          receipt_path?: string
          ocr?: Json
        }
        Update: {
          id?: string
          company_id?: string
          month?: string
          category_id?: string
          label?: string
          amount?: number
          tax_mode?: Database["public"]["Enums"]["tax_mode"]
          incurred_on?: string | null
          driver_id?: string | null
          project_id?: string | null
          vendor?: string
          memo?: string
          recurring_id?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          receipt_path?: string
          ocr?: Json
        }
        Relationships: []
      }
      import_profiles: {
        Row: {
          id: string
          company_id: string
          name: string
          client_id: string | null
          project_id: string | null
          mapping: Json
          driver_match: Json
          item_match: Json
          header_row: number
          encoding: string
          memo: string
          is_active: boolean
          last_used_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          name: string
          client_id?: string | null
          project_id?: string | null
          mapping?: Json
          driver_match?: Json
          item_match?: Json
          header_row?: number
          encoding?: string
          memo?: string
          is_active?: boolean
          last_used_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          name?: string
          client_id?: string | null
          project_id?: string | null
          mapping?: Json
          driver_match?: Json
          item_match?: Json
          header_row?: number
          encoding?: string
          memo?: string
          is_active?: boolean
          last_used_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      import_runs: {
        Row: {
          id: string
          company_id: string
          profile_id: string | null
          file_name: string
          month: string | null
          row_count: number
          applied_count: number
          skipped_count: number
          unmatched: Json
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          company_id: string
          profile_id?: string | null
          file_name?: string
          month?: string | null
          row_count?: number
          applied_count?: number
          skipped_count?: number
          unmatched?: Json
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          profile_id?: string | null
          file_name?: string
          month?: string | null
          row_count?: number
          applied_count?: number
          skipped_count?: number
          unmatched?: Json
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      incidents: {
        Row: {
          id: string
          company_id: string
          driver_id: string | null
          vehicle_id: string | null
          occurred_at: string
          kind: Database["public"]["Enums"]["incident_kind"]
          place: string
          description: string
          cause: string
          prevention: string
          reported: boolean
          cost: number
          memo: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          driver_id?: string | null
          vehicle_id?: string | null
          occurred_at: string
          kind?: Database["public"]["Enums"]["incident_kind"]
          place?: string
          description?: string
          cause?: string
          prevention?: string
          reported?: boolean
          cost?: number
          memo?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          driver_id?: string | null
          vehicle_id?: string | null
          occurred_at?: string
          kind?: Database["public"]["Enums"]["incident_kind"]
          place?: string
          description?: string
          cause?: string
          prevention?: string
          reported?: boolean
          cost?: number
          memo?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      integration_logs: {
        Row: {
          id: string
          company_id: string
          kind: Database["public"]["Enums"]["integration_kind"]
          action: string
          status: string
          message: string
          detail: Json
          created_at: string
        }
        Insert: {
          id?: string
          company_id: string
          kind: Database["public"]["Enums"]["integration_kind"]
          action?: string
          status?: string
          message?: string
          detail?: Json
          created_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          kind?: Database["public"]["Enums"]["integration_kind"]
          action?: string
          status?: string
          message?: string
          detail?: Json
          created_at?: string
        }
        Relationships: []
      }
      integration_secrets: {
        Row: {
          company_id: string
          kind: Database["public"]["Enums"]["integration_kind"]
          secrets: Json
          updated_at: string
        }
        Insert: {
          company_id: string
          kind: Database["public"]["Enums"]["integration_kind"]
          secrets?: Json
          updated_at?: string
        }
        Update: {
          company_id?: string
          kind?: Database["public"]["Enums"]["integration_kind"]
          secrets?: Json
          updated_at?: string
        }
        Relationships: []
      }
      integrations: {
        Row: {
          id: string
          company_id: string
          kind: Database["public"]["Enums"]["integration_kind"]
          is_enabled: boolean
          config: Json
          status: string
          last_ok_at: string | null
          last_error: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          kind: Database["public"]["Enums"]["integration_kind"]
          is_enabled?: boolean
          config?: Json
          status?: string
          last_ok_at?: string | null
          last_error?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          kind?: Database["public"]["Enums"]["integration_kind"]
          is_enabled?: boolean
          config?: Json
          status?: string
          last_ok_at?: string | null
          last_error?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          id: string
          company_id: string
          email: string
          role: Database["public"]["Enums"]["user_role"]
          driver_id: string | null
          display_name: string
          token: string
          expires_at: string
          accepted_at: string | null
          cancelled_at: string | null
          link_used_at: string | null
          invited_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          company_id: string
          email: string
          role?: Database["public"]["Enums"]["user_role"]
          driver_id?: string | null
          display_name?: string
          token?: string
          expires_at?: string
          accepted_at?: string | null
          cancelled_at?: string | null
          link_used_at?: string | null
          invited_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          email?: string
          role?: Database["public"]["Enums"]["user_role"]
          driver_id?: string | null
          display_name?: string
          token?: string
          expires_at?: string
          accepted_at?: string | null
          cancelled_at?: string | null
          link_used_at?: string | null
          invited_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      invoice_items: {
        Row: {
          id: string
          company_id: string
          invoice_id: string
          project_id: string | null
          project_item_id: string | null
          name: string
          unit: Database["public"]["Enums"]["item_unit"] | null
          qty: number
          unit_price: number
          amount: number
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          invoice_id: string
          project_id?: string | null
          project_item_id?: string | null
          name: string
          unit?: Database["public"]["Enums"]["item_unit"] | null
          qty?: number
          unit_price?: number
          amount?: number
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          invoice_id?: string
          project_id?: string | null
          project_item_id?: string | null
          name?: string
          unit?: Database["public"]["Enums"]["item_unit"] | null
          qty?: number
          unit_price?: number
          amount?: number
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          id: string
          company_id: string
          client_id: string
          month: string
          invoice_no: string
          status: Database["public"]["Enums"]["invoice_status"]
          issue_date: string
          due_date: string | null
          subtotal: number
          tax_rate: number
          tax_rounding: Database["public"]["Enums"]["rounding_mode"]
          tax: number
          total: number
          paid_on: string | null
          note: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          client_id: string
          month: string
          invoice_no: string
          status?: Database["public"]["Enums"]["invoice_status"]
          issue_date?: string
          due_date?: string | null
          subtotal?: number
          tax_rate?: number
          tax_rounding?: Database["public"]["Enums"]["rounding_mode"]
          tax?: number
          total?: number
          paid_on?: string | null
          note?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          client_id?: string
          month?: string
          invoice_no?: string
          status?: Database["public"]["Enums"]["invoice_status"]
          issue_date?: string
          due_date?: string | null
          subtotal?: number
          tax_rate?: number
          tax_rounding?: Database["public"]["Enums"]["rounding_mode"]
          tax?: number
          total?: number
          paid_on?: string | null
          note?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      line_link_codes: {
        Row: {
          code: string
          company_id: string
          driver_id: string | null
          profile_id: string | null
          expires_at: string
          used_at: string | null
          created_at: string
        }
        Insert: {
          code: string
          company_id: string
          driver_id?: string | null
          profile_id?: string | null
          expires_at: string
          used_at?: string | null
          created_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          driver_id?: string | null
          profile_id?: string | null
          expires_at?: string
          used_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      loan_payments: {
        Row: {
          id: string
          company_id: string
          loan_id: string
          seq: number
          due_on: string
          principal: number
          interest: number
          total: number
          balance: number
          paid_on: string | null
          memo: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          loan_id: string
          seq: number
          due_on: string
          principal?: number
          interest?: number
          total?: number
          balance?: number
          paid_on?: string | null
          memo?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          loan_id?: string
          seq?: number
          due_on?: string
          principal?: number
          interest?: number
          total?: number
          balance?: number
          paid_on?: string | null
          memo?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      loans: {
        Row: {
          id: string
          company_id: string
          name: string
          lender: string
          principal: number
          annual_rate: number
          start_on: string
          months: number
          payment_day: number
          monthly_payment: number
          status: Database["public"]["Enums"]["loan_status"]
          memo: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          name: string
          lender?: string
          principal?: number
          annual_rate?: number
          start_on: string
          months?: number
          payment_day?: number
          monthly_payment?: number
          status?: Database["public"]["Enums"]["loan_status"]
          memo?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          name?: string
          lender?: string
          principal?: number
          annual_rate?: number
          start_on?: string
          months?: number
          payment_day?: number
          monthly_payment?: number
          status?: Database["public"]["Enums"]["loan_status"]
          memo?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      month_closings: {
        Row: {
          company_id: string
          month: string
          status: Database["public"]["Enums"]["month_status"]
          closed_at: string | null
          closed_by: string | null
          reopened_at: string | null
          reopened_by: string | null
          snapshot: Json | null
          backup_path: string | null
          note: string
          created_at: string
          updated_at: string
        }
        Insert: {
          company_id: string
          month: string
          status?: Database["public"]["Enums"]["month_status"]
          closed_at?: string | null
          closed_by?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          snapshot?: Json | null
          backup_path?: string | null
          note?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          month?: string
          status?: Database["public"]["Enums"]["month_status"]
          closed_at?: string | null
          closed_by?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          snapshot?: Json | null
          backup_path?: string | null
          note?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      month_targets: {
        Row: {
          company_id: string
          month: string
          bill_target: number
          profit_target: number
          memo: string
          created_at: string
          updated_at: string
          expense_target: number
          driver_target: number
        }
        Insert: {
          company_id: string
          month: string
          bill_target?: number
          profit_target?: number
          memo?: string
          created_at?: string
          updated_at?: string
          expense_target?: number
          driver_target?: number
        }
        Update: {
          company_id?: string
          month?: string
          bill_target?: number
          profit_target?: number
          memo?: string
          created_at?: string
          updated_at?: string
          expense_target?: number
          driver_target?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          company_id: string
          email: string
          display_name: string
          role: Database["public"]["Enums"]["user_role"]
          driver_id: string | null
          is_active: boolean
          created_at: string
          updated_at: string
          line_user_id: string
          line_linked_at: string | null
        }
        Insert: {
          id: string
          company_id: string
          email: string
          display_name?: string
          role?: Database["public"]["Enums"]["user_role"]
          driver_id?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          line_user_id?: string
          line_linked_at?: string | null
        }
        Update: {
          id?: string
          company_id?: string
          email?: string
          display_name?: string
          role?: Database["public"]["Enums"]["user_role"]
          driver_id?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
          line_user_id?: string
          line_linked_at?: string | null
        }
        Relationships: []
      }
      project_items: {
        Row: {
          id: string
          company_id: string
          project_id: string
          name: string
          unit: Database["public"]["Enums"]["item_unit"]
          bill_rate: number
          pay_rate: number
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          project_id: string
          name?: string
          unit?: Database["public"]["Enums"]["item_unit"]
          bill_rate?: number
          pay_rate?: number
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          project_id?: string
          name?: string
          unit?: Database["public"]["Enums"]["item_unit"]
          bill_rate?: number
          pay_rate?: number
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          id: string
          company_id: string
          name: string
          client_name: string
          is_active: boolean
          memo: string
          sort_order: number
          created_at: string
          updated_at: string
          client_id: string | null
          target_margin: number | null
        }
        Insert: {
          id?: string
          company_id: string
          name: string
          client_name?: string
          is_active?: boolean
          memo?: string
          sort_order?: number
          created_at?: string
          updated_at?: string
          client_id?: string | null
          target_margin?: number | null
        }
        Update: {
          id?: string
          company_id?: string
          name?: string
          client_name?: string
          is_active?: boolean
          memo?: string
          sort_order?: number
          created_at?: string
          updated_at?: string
          client_id?: string | null
          target_margin?: number | null
        }
        Relationships: []
      }
      recurring_expenses: {
        Row: {
          id: string
          company_id: string
          category_id: string
          label: string
          amount: number
          tax_mode: Database["public"]["Enums"]["tax_mode"]
          driver_id: string | null
          project_id: string | null
          vendor: string
          start_month: string | null
          end_month: string | null
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
          payment_day: number | null
        }
        Insert: {
          id?: string
          company_id: string
          category_id: string
          label: string
          amount: number
          tax_mode?: Database["public"]["Enums"]["tax_mode"]
          driver_id?: string | null
          project_id?: string | null
          vendor?: string
          start_month?: string | null
          end_month?: string | null
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
          payment_day?: number | null
        }
        Update: {
          id?: string
          company_id?: string
          category_id?: string
          label?: string
          amount?: number
          tax_mode?: Database["public"]["Enums"]["tax_mode"]
          driver_id?: string | null
          project_id?: string | null
          vendor?: string
          start_month?: string | null
          end_month?: string | null
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
          payment_day?: number | null
        }
        Relationships: []
      }
      safety_managers: {
        Row: {
          id: string
          company_id: string
          name: string
          office: string
          profile_id: string | null
          driver_id: string | null
          appointed_on: string | null
          training_on: string | null
          training_expires_on: string | null
          notified_on: string | null
          memo: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          name: string
          office?: string
          profile_id?: string | null
          driver_id?: string | null
          appointed_on?: string | null
          training_on?: string | null
          training_expires_on?: string | null
          notified_on?: string | null
          memo?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          name?: string
          office?: string
          profile_id?: string | null
          driver_id?: string | null
          appointed_on?: string | null
          training_on?: string | null
          training_expires_on?: string | null
          notified_on?: string | null
          memo?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      tax_tasks: {
        Row: {
          id: string
          company_id: string
          kind: string
          title: string
          detail: string
          due_on: string
          status: Database["public"]["Enums"]["tax_task_status"]
          done_on: string | null
          amount: number | null
          memo: string
          is_generated: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          kind: string
          title: string
          detail?: string
          due_on: string
          status?: Database["public"]["Enums"]["tax_task_status"]
          done_on?: string | null
          amount?: number | null
          memo?: string
          is_generated?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          kind?: string
          title?: string
          detail?: string
          due_on?: string
          status?: Database["public"]["Enums"]["tax_task_status"]
          done_on?: string | null
          amount?: number | null
          memo?: string
          is_generated?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          id: string
          company_id: string
          plate: string
          maker: string
          model: string
          ownership: Database["public"]["Enums"]["vehicle_ownership"]
          driver_id: string | null
          lease_monthly: number
          odometer: number | null
          memo: string
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          plate: string
          maker?: string
          model?: string
          ownership?: Database["public"]["Enums"]["vehicle_ownership"]
          driver_id?: string | null
          lease_monthly?: number
          odometer?: number | null
          memo?: string
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          plate?: string
          maker?: string
          model?: string
          ownership?: Database["public"]["Enums"]["vehicle_ownership"]
          driver_id?: string | null
          lease_monthly?: number
          odometer?: number | null
          memo?: string
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      work_day_entries: {
        Row: {
          id: string
          company_id: string
          work_date: string
          month: string
          driver_id: string
          project_item_id: string
          qty: number
          memo: string
          source: Database["public"]["Enums"]["entry_source"]
          status: Database["public"]["Enums"]["day_entry_status"]
          reject_reason: string
          submitted_by: string | null
          approved_by: string | null
          approved_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          work_date: string
          month: string
          driver_id: string
          project_item_id: string
          qty?: number
          memo?: string
          source?: Database["public"]["Enums"]["entry_source"]
          status?: Database["public"]["Enums"]["day_entry_status"]
          reject_reason?: string
          submitted_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          work_date?: string
          month?: string
          driver_id?: string
          project_item_id?: string
          qty?: number
          memo?: string
          source?: Database["public"]["Enums"]["entry_source"]
          status?: Database["public"]["Enums"]["day_entry_status"]
          reject_reason?: string
          submitted_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      work_entries: {
        Row: {
          id: string
          company_id: string
          month: string
          driver_id: string
          project_item_id: string
          qty: number
          bill_rate: number
          pay_rate: number
          royalty_rate: number
          rounding_mode: Database["public"]["Enums"]["rounding_mode"]
          memo: string
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
          qty_source: string
        }
        Insert: {
          id?: string
          company_id: string
          month: string
          driver_id: string
          project_item_id: string
          qty?: number
          bill_rate: number
          pay_rate: number
          royalty_rate: number
          rounding_mode?: Database["public"]["Enums"]["rounding_mode"]
          memo?: string
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          qty_source?: string
        }
        Update: {
          id?: string
          company_id?: string
          month?: string
          driver_id?: string
          project_item_id?: string
          qty?: number
          bill_rate?: number
          pay_rate?: number
          royalty_rate?: number
          rounding_mode?: Database["public"]["Enums"]["rounding_mode"]
          memo?: string
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          qty_source?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_ai_conversation_list: {
        Row: {
          id: string | null
          company_id: string | null
          title: string | null
          month: string | null
          message_count: number | null
          last_message_at: string | null
          created_by: string | null
          created_at: string | null
          last_role: string | null
          last_content: string | null
        }
        Relationships: []
      }
      v_alert_summary: {
        Row: {
          company_id: string | null
          month: string | null
          open_count: number | null
          high_count: number | null
          medium_count: number | null
          low_count: number | null
          total_count: number | null
          last_detected_at: string | null
        }
        Relationships: []
      }
      v_applicant_list: {
        Row: {
          id: string | null
          company_id: string | null
          name: string | null
          kana: string | null
          phone: string | null
          email: string | null
          source: string | null
          stage: Database["public"]["Enums"]["applicant_stage"] | null
          applied_on: string | null
          interview_on: string | null
          started_on: string | null
          driver_id: string | null
          has_license: boolean | null
          has_vehicle: boolean | null
          checklist: Json | null
          memo: string | null
          created_by: string | null
          created_at: string | null
          updated_at: string | null
          driver_name: string | null
          event_count: number | null
          last_event_on: string | null
          days_since_applied: number | null
        }
        Relationships: []
      }
      v_bank_transaction_list: {
        Row: {
          id: string | null
          company_id: string | null
          import_id: string | null
          txn_date: string | null
          description: string | null
          amount: number | null
          balance: number | null
          status: Database["public"]["Enums"]["bank_txn_status"] | null
          invoice_id: string | null
          expense_id: string | null
          auto_matched: boolean | null
          memo: string | null
          created_at: string | null
          invoice_no: string | null
          invoice_total: number | null
          client_name: string | null
          expense_label: string | null
          import_file_name: string | null
        }
        Relationships: []
      }
      v_chat_channel_list: {
        Row: {
          id: string | null
          company_id: string | null
          name: string | null
          description: string | null
          is_default: boolean | null
          is_active: boolean | null
          sort_order: number | null
          created_at: string | null
          message_count: number | null
          last_message_at: string | null
          last_author_name: string | null
          last_body: string | null
          unread_count: number | null
          mention_count: number | null
          last_read_at: string | null
        }
        Relationships: []
      }
      v_chat_message_list: {
        Row: {
          id: string | null
          company_id: string | null
          channel_id: string | null
          author_id: string | null
          author_name: string | null
          author_role: Database["public"]["Enums"]["user_role"] | null
          body: string | null
          mentions: Json | null
          is_mine: boolean | null
          is_mentioned: boolean | null
          edited_at: string | null
          created_at: string | null
        }
        Relationships: []
      }
      v_client_month_summary: {
        Row: {
          company_id: string | null
          month: string | null
          client_id: string | null
          client_name: string | null
          client_sort_order: number | null
          project_count: number | null
          entry_count: number | null
          qty_total: number | null
          bill: number | null
        }
        Relationships: []
      }
      v_contract_list: {
        Row: {
          id: string | null
          company_id: string | null
          driver_id: string | null
          title: string | null
          status: Database["public"]["Enums"]["contract_status"] | null
          start_on: string | null
          end_on: string | null
          auto_renew: boolean | null
          notice_days: number | null
          file_path: string | null
          agreed_at: string | null
          memo: string | null
          created_by: string | null
          created_at: string | null
          updated_at: string | null
          driver_name: string | null
          driver_is_active: boolean | null
          days_left: number | null
          period_status: string | null
        }
        Relationships: []
      }
      v_daily_report_list: {
        Row: {
          id: string | null
          company_id: string | null
          work_date: string | null
          month: string | null
          driver_id: string | null
          driver_name: string | null
          vehicle_id: string | null
          vehicle_plate: string | null
          pre_at: string | null
          pre_method: Database["public"]["Enums"]["roll_call_method"] | null
          pre_alcohol: number | null
          pre_alcohol_ok: boolean | null
          pre_health_ok: boolean | null
          pre_inspection_ok: boolean | null
          pre_instruction: string | null
          post_at: string | null
          post_method: Database["public"]["Enums"]["roll_call_method"] | null
          post_alcohol: number | null
          post_alcohol_ok: boolean | null
          post_condition_ok: boolean | null
          post_incident: string | null
          start_at: string | null
          end_at: string | null
          break_minutes: number | null
          distance_km: number | null
          odo_start: number | null
          odo_end: number | null
          memo: string | null
          pre_done: boolean | null
          post_done: boolean | null
          roll_call_done: boolean | null
          qty_total: number | null
          entry_count: number | null
          created_at: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      v_day_status: {
        Row: {
          company_id: string | null
          month: string | null
          pending_count: number | null
          approved_count: number | null
          work_day_count: number | null
          roll_call_missing_count: number | null
        }
        Relationships: []
      }
      v_document_list: {
        Row: {
          id: string | null
          company_id: string | null
          kind: Database["public"]["Enums"]["document_kind"] | null
          driver_id: string | null
          driver_name: string | null
          vehicle_id: string | null
          vehicle_plate: string | null
          label: string | null
          number: string | null
          issued_on: string | null
          expires_on: string | null
          reminder_days: number | null
          file_path: string | null
          memo: string | null
          is_active: boolean | null
          created_at: string | null
          days_left: number | null
          expiry_status: string | null
        }
        Relationships: []
      }
      v_driver_month_summary: {
        Row: {
          company_id: string | null
          month: string | null
          driver_id: string | null
          driver_name: string | null
          driver_sort_order: number | null
          driver_is_active: boolean | null
          driver_default_mgmt_fee: number | null
          driver_month_id: string | null
          memo: string | null
          entry_count: number | null
          active_entry_count: number | null
          bill: number | null
          pay: number | null
          margin: number | null
          royalty: number | null
          mgmt_fee_setting: number | null
          mgmt_fee: number | null
          adjustment_count: number | null
          adj_pay: number | null
          adj_profit: number | null
          payout: number | null
          driver_profit: number | null
          is_closed: boolean | null
          tax_mode: Database["public"]["Enums"]["tax_mode"] | null
          tax_rate: number | null
          tax_rounding: Database["public"]["Enums"]["rounding_mode"] | null
          tax_base: number | null
          tax: number | null
          payout_incl: number | null
        }
        Relationships: []
      }
      v_expense_list: {
        Row: {
          id: string | null
          company_id: string | null
          month: string | null
          category_id: string | null
          category_name: string | null
          kind: Database["public"]["Enums"]["expense_kind"] | null
          category_sort_order: number | null
          label: string | null
          amount: number | null
          tax_mode: Database["public"]["Enums"]["tax_mode"] | null
          incurred_on: string | null
          driver_id: string | null
          driver_name: string | null
          project_id: string | null
          project_name: string | null
          vendor: string | null
          memo: string | null
          recurring_id: string | null
          created_at: string | null
          updated_at: string | null
          is_closed: boolean | null
        }
        Relationships: []
      }
      v_expense_summary: {
        Row: {
          company_id: string | null
          month: string | null
          category_id: string | null
          category_name: string | null
          kind: Database["public"]["Enums"]["expense_kind"] | null
          category_sort_order: number | null
          expense_count: number | null
          amount: number | null
          taxable_amount: number | null
        }
        Relationships: []
      }
      v_import_profile_list: {
        Row: {
          id: string | null
          company_id: string | null
          name: string | null
          client_id: string | null
          project_id: string | null
          mapping: Json | null
          driver_match: Json | null
          item_match: Json | null
          header_row: number | null
          encoding: string | null
          memo: string | null
          is_active: boolean | null
          last_used_at: string | null
          created_by: string | null
          created_at: string | null
          updated_at: string | null
          client_name: string | null
          project_name: string | null
          run_count: number | null
        }
        Relationships: []
      }
      v_invoice_list: {
        Row: {
          id: string | null
          company_id: string | null
          client_id: string | null
          client_name: string | null
          client_sort_order: number | null
          month: string | null
          invoice_no: string | null
          status: Database["public"]["Enums"]["invoice_status"] | null
          issue_date: string | null
          due_date: string | null
          subtotal: number | null
          tax_rate: number | null
          tax_rounding: Database["public"]["Enums"]["rounding_mode"] | null
          tax: number | null
          total: number | null
          paid_on: string | null
          note: string | null
          created_at: string | null
          updated_at: string | null
          item_count: number | null
        }
        Relationships: []
      }
      v_loan_list: {
        Row: {
          id: string | null
          company_id: string | null
          name: string | null
          lender: string | null
          principal: number | null
          annual_rate: number | null
          start_on: string | null
          months: number | null
          payment_day: number | null
          monthly_payment: number | null
          status: Database["public"]["Enums"]["loan_status"] | null
          memo: string | null
          created_by: string | null
          created_at: string | null
          updated_at: string | null
          payment_count: number | null
          paid_count: number | null
          remaining_principal: number | null
          paid_principal: number | null
          total_interest: number | null
          next_due_on: string | null
          next_total: number | null
          final_due_on: string | null
        }
        Relationships: []
      }
      v_loan_payment_list: {
        Row: {
          id: string | null
          company_id: string | null
          loan_id: string | null
          seq: number | null
          due_on: string | null
          principal: number | null
          interest: number | null
          total: number | null
          balance: number | null
          paid_on: string | null
          memo: string | null
          created_at: string | null
          updated_at: string | null
          loan_name: string | null
          lender: string | null
          is_paid: boolean | null
          is_overdue: boolean | null
        }
        Relationships: []
      }
      v_month_kpi: {
        Row: {
          company_id: string | null
          month: string | null
          status: Database["public"]["Enums"]["month_status"] | null
          bill: number | null
          pay: number | null
          royalty: number | null
          margin: number | null
          mgmt_fee: number | null
          adj_profit: number | null
          payout: number | null
          payout_incl: number | null
          profit: number | null
          expense_total: number | null
          expense_fixed: number | null
          expense_variable: number | null
          operating_profit: number | null
          operating_margin: number | null
          bill_target: number | null
          profit_target: number | null
          entry_count: number | null
          active_driver_count: number | null
          driver_count: number | null
          expense_target: number | null
          driver_target: number | null
          work_day_count: number | null
          contribution: number | null
          net_fixed_cost: number | null
          contribution_rate: number | null
          payout_rate: number | null
          break_even_bill: number | null
          break_even_ratio: number | null
          bill_per_driver: number | null
          profit_per_driver: number | null
          bill_per_work_day: number | null
          expense_achievement: number | null
          bill_achievement: number | null
          profit_achievement: number | null
        }
        Relationships: []
      }
      v_month_list: {
        Row: {
          company_id: string | null
          month: string | null
          driver_count: number | null
          entry_count: number | null
          bill: number | null
          profit: number | null
          payout: number | null
          profit_rate: number | null
          status: Database["public"]["Enums"]["month_status"] | null
          closed_at: string | null
          backup_path: string | null
          closing_note: string | null
        }
        Relationships: []
      }
      v_month_pl: {
        Row: {
          company_id: string | null
          month: string | null
          driver_count: number | null
          active_driver_count: number | null
          entry_count: number | null
          bill: number | null
          pay: number | null
          margin: number | null
          royalty: number | null
          mgmt_fee: number | null
          adj_pay: number | null
          adj_profit: number | null
          payout: number | null
          tax: number | null
          payout_incl: number | null
          profit: number | null
          expense_total: number | null
          expense_fixed: number | null
          expense_variable: number | null
          expense_count: number | null
          operating_profit: number | null
          operating_margin: number | null
          bill_target: number | null
          profit_target: number | null
          target_memo: string | null
          status: Database["public"]["Enums"]["month_status"] | null
        }
        Relationships: []
      }
      v_month_summary: {
        Row: {
          company_id: string | null
          month: string | null
          driver_count: number | null
          active_driver_count: number | null
          entry_count: number | null
          bill: number | null
          pay: number | null
          margin: number | null
          royalty: number | null
          mgmt_fee: number | null
          adj_pay: number | null
          adj_profit: number | null
          payout: number | null
          profit: number | null
          profit_rate: number | null
          status: Database["public"]["Enums"]["month_status"] | null
          closed_at: string | null
          closed_by: string | null
          reopened_at: string | null
          backup_path: string | null
          closing_note: string | null
          tax: number | null
          payout_incl: number | null
        }
        Relationships: []
      }
      v_project_pl: {
        Row: {
          company_id: string | null
          month: string | null
          project_id: string | null
          project_name: string | null
          client_id: string | null
          client_name: string | null
          project_is_active: boolean | null
          project_sort_order: number | null
          target_margin: number | null
          entry_count: number | null
          driver_count: number | null
          qty_total: number | null
          bill: number | null
          pay: number | null
          margin: number | null
          royalty: number | null
          entry_profit: number | null
          expense_direct: number | null
          expense_count: number | null
          project_profit: number | null
          project_margin: number | null
          below_target: boolean | null
          is_closed: boolean | null
        }
        Relationships: []
      }
      v_project_summary: {
        Row: {
          company_id: string | null
          month: string | null
          project_id: string | null
          project_item_id: string | null
          project_name: string | null
          client_name: string | null
          item_name: string | null
          unit: Database["public"]["Enums"]["item_unit"] | null
          project_sort_order: number | null
          item_sort_order: number | null
          entry_count: number | null
          driver_count: number | null
          qty_total: number | null
          bill: number | null
          pay: number | null
          margin: number | null
          royalty: number | null
          entry_profit: number | null
          profit_rate: number | null
        }
        Relationships: []
      }
      v_recurring_expense_list: {
        Row: {
          id: string | null
          company_id: string | null
          category_id: string | null
          category_name: string | null
          kind: Database["public"]["Enums"]["expense_kind"] | null
          label: string | null
          amount: number | null
          tax_mode: Database["public"]["Enums"]["tax_mode"] | null
          driver_id: string | null
          driver_name: string | null
          project_id: string | null
          project_name: string | null
          vendor: string | null
          start_month: string | null
          end_month: string | null
          is_active: boolean | null
          sort_order: number | null
          created_at: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      v_staff: {
        Row: {
          id: string | null
          company_id: string | null
          display_name: string | null
          email: string | null
          role: Database["public"]["Enums"]["user_role"] | null
          is_active: boolean | null
          line_linked: boolean | null
          created_at: string | null
        }
        Relationships: []
      }
      v_tax_task_list: {
        Row: {
          id: string | null
          company_id: string | null
          kind: string | null
          title: string | null
          detail: string | null
          due_on: string | null
          status: Database["public"]["Enums"]["tax_task_status"] | null
          done_on: string | null
          amount: number | null
          memo: string | null
          is_generated: boolean | null
          created_by: string | null
          created_at: string | null
          updated_at: string | null
          days_left: number | null
          urgency: string | null
        }
        Relationships: []
      }
      v_vehicle_list: {
        Row: {
          id: string | null
          company_id: string | null
          plate: string | null
          maker: string | null
          model: string | null
          ownership: Database["public"]["Enums"]["vehicle_ownership"] | null
          driver_id: string | null
          driver_name: string | null
          lease_monthly: number | null
          odometer: number | null
          memo: string | null
          is_active: boolean | null
          sort_order: number | null
          created_at: string | null
          next_expires_on: string | null
          next_kind: Database["public"]["Enums"]["document_kind"] | null
          expired_count: number | null
        }
        Relationships: []
      }
      v_work_day_entry_list: {
        Row: {
          id: string | null
          company_id: string | null
          work_date: string | null
          month: string | null
          driver_id: string | null
          driver_name: string | null
          driver_sort_order: number | null
          project_item_id: string | null
          project_id: string | null
          project_name: string | null
          item_name: string | null
          unit: Database["public"]["Enums"]["item_unit"] | null
          qty: number | null
          memo: string | null
          source: Database["public"]["Enums"]["entry_source"] | null
          status: Database["public"]["Enums"]["day_entry_status"] | null
          reject_reason: string | null
          submitted_by: string | null
          approved_by: string | null
          approved_at: string | null
          created_at: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      v_work_entry_calc: {
        Row: {
          id: string | null
          company_id: string | null
          month: string | null
          driver_id: string | null
          project_item_id: string | null
          project_id: string | null
          driver_name: string | null
          driver_sort_order: number | null
          driver_is_active: boolean | null
          project_name: string | null
          client_name: string | null
          item_name: string | null
          unit: Database["public"]["Enums"]["item_unit"] | null
          qty: number | null
          bill_rate: number | null
          pay_rate: number | null
          royalty_rate: number | null
          rounding_mode: Database["public"]["Enums"]["rounding_mode"] | null
          memo: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string | null
          updated_at: string | null
          bill: number | null
          pay: number | null
          margin: number | null
          royalty: number | null
          entry_profit: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_day_entries: {
        Args: {
          p_month: string
        }
        Returns: number
      }
      apply_invitation: {
        Args: {
          p_user_id: string
          p_email: string
          p_token?: string
        }
        Returns: Database["public"]["Tables"]["profiles"]["Row"]
      }
      apply_master_rates: {
        Args: {
          p_month: string
          p_driver_id?: string
          p_project_item_id?: string
          p_entry_ids?: string[]
        }
        Returns: number
      }
      apply_recurring_expenses: {
        Args: {
          p_month: string
        }
        Returns: number
      }
      approve_day_entries: {
        Args: {
          p_ids: string[]
          p_approve?: boolean
          p_reason?: string
        }
        Returns: number
      }
      bank_auto_match: {
        Args: {
          p_import_id?: string
        }
        Returns: number
      }
      bank_match_invoice: {
        Args: {
          p_txn_id: string
          p_invoice_id: string
        }
        Returns: undefined
      }
      bank_set_status: {
        Args: {
          p_txn_id: string
          p_status: Database["public"]["Enums"]["bank_txn_status"]
        }
        Returns: undefined
      }
      build_invoice: {
        Args: {
          p_client_id: string
          p_month: string
        }
        Returns: string
      }
      bulk_set_entries: {
        Args: {
          p_month: string
          p_project_item_id: string
          p_rows: Json
        }
        Returns: Json
      }
      cash_forecast: {
        Args: {
          p_from: string
          p_to: string
        }
        Returns: {
          event_date: string
          kind: string
          label: string
          detail: string
          amount: number
          ref_id: string
          status: string
          month: string
        }[]
      }
      chat_mark_read: {
        Args: {
          p_channel_id: string
        }
        Returns: undefined
      }
      chat_post: {
        Args: {
          p_channel_id: string
          p_body: string
          p_mentions?: string[]
        }
        Returns: string
      }
      chat_unread_total: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      close_month: {
        Args: {
          p_month: string
          p_note?: string
        }
        Returns: Json
      }
      copy_previous_month: {
        Args: {
          p_month: string
        }
        Returns: number
      }
      create_invitation: {
        Args: {
          p_email: string
          p_role: Database["public"]["Enums"]["user_role"]
          p_driver_id?: string
          p_display_name?: string
        }
        Returns: Database["public"]["Tables"]["invitations"]["Row"]
      }
      current_app_role: {
        Args: Record<PropertyKey, never>
        Returns: Database["public"]["Enums"]["user_role"]
      }
      current_company_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      current_driver_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      default_chat_channels: {
        Args: {
          p_company_id: string
        }
        Returns: number
      }
      default_expense_categories: {
        Args: {
          p_company_id: string
        }
        Returns: number
      }
      detect_anomalies: {
        Args: {
          p_month: string
        }
        Returns: Json
      }
      detect_anomalies_core: {
        Args: {
          p_company_id: string
          p_month: string
        }
        Returns: Json
      }
      driver_day_items: {
        Args: Record<PropertyKey, never>
        Returns: {
          project_item_id: string
          project_name: string
          item_name: string
          unit: Database["public"]["Enums"]["item_unit"]
          recent: boolean
        }[]
      }
      driver_portal_current: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      driver_portal_months: {
        Args: Record<PropertyKey, never>
        Returns: {
          month: string
          status: Database["public"]["Enums"]["month_status"]
          payout: number
          pay: number
          royalty: number
          mgmt_fee: number
          adj_pay: number
          closed_at: string
          tax: number
          payout_incl: number
        }[]
      }
      driver_portal_statement: {
        Args: {
          p_month: string
        }
        Returns: Json
      }
      ensure_driver_month: {
        Args: {
          p_company_id: string
          p_month: string
          p_driver_id: string
        }
        Returns: string
      }
      ensure_tax_tasks: {
        Args: {
          p_year: number
        }
        Returns: number
      }
      entry_defaults: {
        Args: {
          p_driver_id: string
          p_project_item_id: string
        }
        Returns: {
          bill_rate: number
          pay_rate: number
          royalty_rate: number
          rounding_mode: Database["public"]["Enums"]["rounding_mode"]
        }[]
      }
      export_backup: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      generate_loan_schedule: {
        Args: {
          p_loan_id: string
        }
        Returns: number
      }
      import_backup: {
        Args: {
          p_data: Json
        }
        Returns: Json
      }
      import_has_id_conflict: {
        Args: {
          p_company_id: string
          p_data: Json
        }
        Returns: boolean
      }
      is_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_driver_user: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_month_closed: {
        Args: {
          p_company_id: string
          p_month: string
        }
        Returns: boolean
      }
      is_owner: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_service_role: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_staff: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      line_consume_code: {
        Args: {
          p_code: string
          p_line_user_id: string
          p_company_id?: string
        }
        Returns: Json
      }
      line_issue_code: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      line_unlink: {
        Args: {
          p_driver_id?: string
        }
        Returns: undefined
      }
      month_day_date: {
        Args: {
          p_month: string
          p_offset: number
          p_day: number
        }
        Returns: string
      }
      month_snapshot: {
        Args: {
          p_month: string
        }
        Returns: Json
      }
      rate_diffs: {
        Args: {
          p_month: string
        }
        Returns: {
          entry_id: string
          driver_id: string
          driver_name: string
          project_id: string
          project_item_id: string
          project_name: string
          item_name: string
          qty: number
          bill_rate: number
          pay_rate: number
          royalty_rate: number
          rounding_mode: Database["public"]["Enums"]["rounding_mode"]
          master_bill_rate: number
          master_pay_rate: number
          master_royalty_rate: number
          master_rounding_mode: Database["public"]["Enums"]["rounding_mode"]
        }[]
      }
      recalc_invoice: {
        Args: {
          p_invoice_id: string
        }
        Returns: undefined
      }
      record_alert: {
        Args: {
          p_company_id: string
          p_month: string
          p_code: string
          p_severity: Database["public"]["Enums"]["alert_severity"]
          p_title: string
          p_detail: string
          p_amount: number
          p_ref_table: string
          p_ref_id: string
          p_href: string
          p_fingerprint: string
        }
        Returns: string
      }
      reopen_month: {
        Args: {
          p_month: string
        }
        Returns: undefined
      }
      reset_company_data: {
        Args: {
          p_company_name: string
        }
        Returns: Json
      }
      round_by_mode: {
        Args: {
          p_value: number
          p_mode: Database["public"]["Enums"]["rounding_mode"]
        }
        Returns: number
      }
      seed_initial_data: {
        Args: {
          p_with_entries?: boolean
        }
        Returns: Json
      }
      set_alert_status: {
        Args: {
          p_alert_id: string
          p_status: Database["public"]["Enums"]["alert_status"]
          p_note?: string
        }
        Returns: undefined
      }
      set_invoice_status: {
        Args: {
          p_invoice_id: string
          p_status: Database["public"]["Enums"]["invoice_status"]
          p_paid_on?: string
        }
        Returns: undefined
      }
      set_month_backup_path: {
        Args: {
          p_month: string
          p_path: string
        }
        Returns: undefined
      }
      submit_day_entries: {
        Args: {
          p_work_date: string
          p_item_ids: string[]
          p_qtys: number[]
          p_driver_id?: string
          p_memo?: string
        }
        Returns: number
      }
      sync_work_entry_from_days: {
        Args: {
          p_company_id: string
          p_month: string
          p_driver_id: string
          p_project_item_id: string
        }
        Returns: undefined
      }
      t_assert: {
        Args: {
          cond: boolean
          msg: string
        }
        Returns: undefined
      }
      t_expect_error: {
        Args: {
          sql: string
          expected_hint?: string
          msg?: string
        }
        Returns: undefined
      }
      t_rowcount: {
        Args: {
          sql: string
        }
        Returns: number
      }
      write_audit: {
        Args: {
          p_company_id: string
          p_action: string
          p_table: string
          p_record_id: string
          p_before: Json
          p_after: Json
        }
        Returns: undefined
      }
    }
    Enums: {
      alert_severity: "high" | "medium" | "low"
      alert_status: "open" | "resolved" | "ignored"
      applicant_stage: "applied" | "contacted" | "interview" | "docs" | "contract" | "started" | "declined" | "rejected"
      bank_account_type: "ordinary" | "checking" | "savings"
      bank_txn_status: "unmatched" | "matched" | "ignored"
      contract_status: "draft" | "active" | "ended"
      day_entry_status: "submitted" | "approved" | "rejected"
      document_kind: "license" | "vehicle_inspection" | "compulsory_insurance" | "voluntary_insurance" | "health_check" | "safety_training" | "contract" | "other"
      entry_source: "staff" | "driver" | "import" | "line"
      expense_kind: "fixed" | "variable"
      incident_kind: "accident" | "violation" | "near_miss"
      integration_kind: "line" | "google_drive" | "bank"
      invoice_status: "draft" | "issued" | "paid"
      item_unit: "day" | "piece"
      loan_status: "active" | "paid" | "planned"
      month_status: "open" | "closed"
      roll_call_method: "face" | "phone" | "video" | "app"
      rounding_mode: "none" | "floor" | "round" | "ceil"
      tax_mode: "taxable" | "exempt"
      tax_task_status: "todo" | "done" | "skipped"
      user_role: "owner" | "admin" | "viewer" | "driver"
      vehicle_ownership: "owned" | "lease" | "driver"
    }
    CompositeTypes: Record<string, never>
  }
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
export type Views<T extends keyof Database["public"]["Views"]> = Database["public"]["Views"][T]["Row"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
