export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  app: {
    Tables: {
      application_equipment_links: {
        Row: {
          application_id: string
          created_at: string
          id: string
          position: number
          url: string
        }
        ComputedFields: never
        Insert: {
          application_id: string
          created_at?: string
          id?: string
          position: number
          url: string
        }
        Update: {
          application_id?: string
          created_at?: string
          id?: string
          position?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: 'application_equipment_links_application_id_fkey'
            columns: ['application_id']
            isOneToOne: false
            referencedRelation: 'join_applications'
            referencedColumns: ['id']
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          actor_nickname: string | null
          actor_role: string | null
          category: string
          created_at: string
          details: NonNullable<Json>
          id: number
          summary: string
          target_email: string | null
          target_id: string | null
          target_kind: string | null
          target_nickname: string | null
          target_user_id: string | null
        }
        ComputedFields: never
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          actor_nickname?: string | null
          actor_role?: string | null
          category: string
          created_at?: string
          details?: NonNullable<Json>
          id?: never
          summary: string
          target_email?: string | null
          target_id?: string | null
          target_kind?: string | null
          target_nickname?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          actor_nickname?: string | null
          actor_role?: string | null
          category?: string
          created_at?: string
          details?: NonNullable<Json>
          id?: never
          summary?: string
          target_email?: string | null
          target_id?: string | null
          target_kind?: string | null
          target_nickname?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'audit_log_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'audit_log_target_user_id_fkey'
            columns: ['target_user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      character_classes: {
        Row: {
          id: number
          is_active: boolean
          name: string
          slug: string
          sort_order: number
        }
        ComputedFields: never
        Insert: {
          id?: never
          is_active?: boolean
          name: string
          slug: string
          sort_order: number
        }
        Update: {
          id?: never
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      join_applications: {
        Row: {
          applicant_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          status: string
          submitted_at: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          applicant_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          status: string
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          applicant_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          status?: string
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'join_applications_applicant_id_fkey'
            columns: ['applicant_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'join_applications_decided_by_fkey'
            columns: ['decided_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          about: string | null
          access_role: string
          avatar_path: string | null
          birth_date: string | null
          city: string | null
          class_id: number
          created_at: string
          display_name: string
          game_nickname: string
          id: string
          is_primary_admin: boolean
          joined_on: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          about?: string | null
          access_role: string
          avatar_path?: string | null
          birth_date?: string | null
          city?: string | null
          class_id: number
          created_at?: string
          display_name: string
          game_nickname: string
          id: string
          is_primary_admin?: boolean
          joined_on?: string | null
          updated_at?: string
        }
        Update: {
          about?: string | null
          access_role?: string
          avatar_path?: string | null
          birth_date?: string | null
          city?: string | null
          class_id?: number
          created_at?: string
          display_name?: string
          game_nickname?: string
          id?: string
          is_primary_admin?: boolean
          joined_on?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_class_id_fkey'
            columns: ['class_id']
            isOneToOne: false
            referencedRelation: 'character_classes'
            referencedColumns: ['id']
          },
        ]
      }
      user_notifications: {
        Row: {
          actor_id: string | null
          body: string
          created_at: string
          id: string
          kind: string
          read_at: string | null
          recipient_id: string
          source_id: string
          source_kind: string
          target_id: string | null
          target_kind: string | null
          title: string
        }
        ComputedFields: never
        Insert: {
          actor_id?: string | null
          body?: string
          created_at?: string
          id?: string
          kind: string
          read_at?: string | null
          recipient_id: string
          source_id: string
          source_kind: string
          target_id?: string | null
          target_kind?: string | null
          title: string
        }
        Update: {
          actor_id?: string | null
          body?: string
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          recipient_id?: string
          source_id?: string
          source_kind?: string
          target_id?: string | null
          target_kind?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_notifications_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_notifications_recipient_id_fkey'
            columns: ['recipient_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      vote_ballots: {
        Row: {
          created_at: string
          id: string
          option_id: string
          updated_at: string
          vote_id: string
          voter_id: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          option_id: string
          updated_at?: string
          vote_id: string
          voter_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          option_id?: string
          updated_at?: string
          vote_id?: string
          voter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'vote_ballots_vote_id_fkey'
            columns: ['vote_id']
            isOneToOne: false
            referencedRelation: 'votes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vote_ballots_vote_id_option_id_fkey'
            columns: ['vote_id', 'option_id']
            isOneToOne: false
            referencedRelation: 'vote_options'
            referencedColumns: ['vote_id', 'id']
          },
          {
            foreignKeyName: 'vote_ballots_voter_id_fkey'
            columns: ['voter_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      vote_options: {
        Row: {
          id: string
          label: string
          normalized_label: string
          position: number
          vote_id: string
        }
        ComputedFields: never
        Insert: {
          id?: string
          label: string
          normalized_label: string
          position: number
          vote_id: string
        }
        Update: {
          id?: string
          label?: string
          normalized_label?: string
          position?: number
          vote_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'vote_options_vote_id_fkey'
            columns: ['vote_id']
            isOneToOne: false
            referencedRelation: 'votes'
            referencedColumns: ['id']
          },
        ]
      }
      votes: {
        Row: {
          application_id: string | null
          closed_at: string | null
          closed_by: string | null
          context: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          title: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          application_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          context?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          title: string
          updated_at?: string
        }
        Update: {
          application_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          context?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'votes_application_id_fkey'
            columns: ['application_id']
            isOneToOne: false
            referencedRelation: 'join_applications'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'votes_closed_by_fkey'
            columns: ['closed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'votes_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'app'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  app: {
    Enums: {},
  },
} as const
