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
      ai_insights: {
        Row: {
          id: string
          company_id: string
          month: string
          model: string
          findings: Json
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          company_id: string
          month: string
          model?: string
          findings?: Json
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          month?: string
          model?: string
          findings?: Json
          created_by?: string | null
          created_at?: string
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
        }
        Insert: {
          company_id: string
          month: string
          bill_target?: number
          profit_target?: number
          memo?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          month?: string
          bill_target?: number
          profit_target?: number
          memo?: string
          created_at?: string
          updated_at?: string
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
        }
        Relationships: []
      }
    }
    Views: {
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
      default_expense_categories: {
        Args: {
          p_company_id: string
        }
        Returns: number
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
      expense_kind: "fixed" | "variable"
      invoice_status: "draft" | "issued" | "paid"
      item_unit: "day" | "piece"
      month_status: "open" | "closed"
      rounding_mode: "none" | "floor" | "round" | "ceil"
      tax_mode: "taxable" | "exempt"
      user_role: "owner" | "admin" | "viewer" | "driver"
    }
    CompositeTypes: Record<string, never>
  }
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
export type Views<T extends keyof Database["public"]["Views"]> = Database["public"]["Views"][T]["Row"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
