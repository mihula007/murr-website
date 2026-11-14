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
      broadcast_drafts: {
        Row: {
          author_id: string
          body: string
          channels: string[]
          created_at: string
          id: string
          source_id: string | null
          source_kind: string | null
          subject: string | null
        }
        ComputedFields: never
        Insert: {
          author_id: string
          body: string
          channels: string[]
          created_at?: string
          id?: string
          source_id?: string | null
          source_kind?: string | null
          subject?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          channels?: string[]
          created_at?: string
          id?: string
          source_id?: string | null
          source_kind?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'broadcast_drafts_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      broadcast_templates: {
        Row: {
          author_id: string
          body: string
          channels: string[]
          created_at: string
          id: string
          name: string
          subject: string | null
        }
        ComputedFields: never
        Insert: {
          author_id: string
          body: string
          channels: string[]
          created_at?: string
          id?: string
          name: string
          subject?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          channels?: string[]
          created_at?: string
          id?: string
          name?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'broadcast_templates_author_id_fkey'
            columns: ['author_id']
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
      discussion_messages: {
        Row: {
          author_id: string | null
          body: string
          changed_at: string
          created_at: string
          edited_at: string | null
          id: string
          reply_to_id: string | null
          thread_id: string
        }
        ComputedFields: never
        Insert: {
          author_id?: string | null
          body: string
          changed_at?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          reply_to_id?: string | null
          thread_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          changed_at?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          reply_to_id?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'discussion_messages_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'discussion_messages_reply_to_id_fkey'
            columns: ['reply_to_id']
            isOneToOne: false
            referencedRelation: 'discussion_messages'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'discussion_messages_thread_id_fkey'
            columns: ['thread_id']
            isOneToOne: false
            referencedRelation: 'discussion_threads'
            referencedColumns: ['id']
          },
        ]
      }
      discussion_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'discussion_reactions_message_id_fkey'
            columns: ['message_id']
            isOneToOne: false
            referencedRelation: 'discussion_messages'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'discussion_reactions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      discussion_reads: {
        Row: {
          read_up_to: string
          thread_id: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          read_up_to: string
          thread_id: string
          user_id: string
        }
        Update: {
          read_up_to?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'discussion_reads_thread_id_fkey'
            columns: ['thread_id']
            isOneToOne: false
            referencedRelation: 'discussion_threads'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'discussion_reads_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      discussion_threads: {
        Row: {
          created_at: string
          event_id: string | null
          id: string
          market_listing_id: string | null
          publication_id: string | null
          vote_id: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          event_id?: string | null
          id?: string
          market_listing_id?: string | null
          publication_id?: string | null
          vote_id?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string | null
          id?: string
          market_listing_id?: string | null
          publication_id?: string | null
          vote_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'discussion_threads_event_id_fkey'
            columns: ['event_id']
            isOneToOne: true
            referencedRelation: 'events'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'discussion_threads_market_listing_id_fkey'
            columns: ['market_listing_id']
            isOneToOne: true
            referencedRelation: 'market_listings'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'discussion_threads_publication_id_fkey'
            columns: ['publication_id']
            isOneToOne: true
            referencedRelation: 'publications'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'discussion_threads_vote_id_fkey'
            columns: ['vote_id']
            isOneToOne: true
            referencedRelation: 'votes'
            referencedColumns: ['id']
          },
        ]
      }
      event_activity_records: {
        Row: {
          class_id: number
          event_id: string
          group_name: string | null
          is_leader: boolean
          nickname: string
          status: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          class_id: number
          event_id: string
          group_name?: string | null
          is_leader?: boolean
          nickname: string
          status: string
          user_id: string
        }
        Update: {
          class_id?: number
          event_id?: string
          group_name?: string | null
          is_leader?: boolean
          nickname?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'event_activity_records_class_id_fkey'
            columns: ['class_id']
            isOneToOne: false
            referencedRelation: 'character_classes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'event_activity_records_event_id_fkey'
            columns: ['event_id']
            isOneToOne: false
            referencedRelation: 'events'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'event_activity_records_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      event_attendance: {
        Row: {
          answer: string
          answered_at: string
          event_id: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          answer: string
          answered_at?: string
          event_id: string
          user_id: string
        }
        Update: {
          answer?: string
          answered_at?: string
          event_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'event_attendance_event_id_fkey'
            columns: ['event_id']
            isOneToOne: false
            referencedRelation: 'events'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'event_attendance_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      event_group_members: {
        Row: {
          event_id: string
          group_id: string
          is_leader: boolean
          position: number
          user_id: string
        }
        ComputedFields: never
        Insert: {
          event_id: string
          group_id: string
          is_leader?: boolean
          position: number
          user_id: string
        }
        Update: {
          event_id?: string
          group_id?: string
          is_leader?: boolean
          position?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'event_group_members_group_id_event_id_fkey'
            columns: ['group_id', 'event_id']
            isOneToOne: false
            referencedRelation: 'event_groups'
            referencedColumns: ['id', 'event_id']
          },
          {
            foreignKeyName: 'event_group_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      event_groups: {
        Row: {
          created_at: string
          event_id: string
          id: string
          name: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: 'event_groups_event_id_fkey'
            columns: ['event_id']
            isOneToOne: false
            referencedRelation: 'events'
            referencedColumns: ['id']
          },
        ]
      }
      event_templates: {
        Row: {
          created_at: string
          created_by: string
          description: string
          event_type: string
          id: string
          time_msk: string
          title: string
          weekday: number
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by: string
          description: string
          event_type: string
          id?: string
          time_msk: string
          title: string
          weekday: number
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string
          event_type?: string
          id?: string
          time_msk?: string
          title?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: 'event_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      events: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          description: string
          event_type: string
          id: string
          recurring_preset: string | null
          starts_at: string
          title: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          event_type: string
          id?: string
          recurring_preset?: string | null
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          event_type?: string
          id?: string
          recurring_preset?: string | null
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'events_closed_by_fkey'
            columns: ['closed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'events_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      group_template_groups: {
        Row: {
          id: string
          name: string
          position: number
          template_id: string
        }
        ComputedFields: never
        Insert: {
          id?: string
          name: string
          position: number
          template_id: string
        }
        Update: {
          id?: string
          name?: string
          position?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'group_template_groups_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'group_templates'
            referencedColumns: ['id']
          },
        ]
      }
      group_template_members: {
        Row: {
          group_id: string
          is_leader: boolean
          position: number
          template_id: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          group_id: string
          is_leader?: boolean
          position: number
          template_id: string
          user_id: string
        }
        Update: {
          group_id?: string
          is_leader?: boolean
          position?: number
          template_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'group_template_members_group_id_template_id_fkey'
            columns: ['group_id', 'template_id']
            isOneToOne: false
            referencedRelation: 'group_template_groups'
            referencedColumns: ['id', 'template_id']
          },
          {
            foreignKeyName: 'group_template_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      group_templates: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: 'group_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
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
      market_listings: {
        Row: {
          author_id: string | null
          category: string
          content: NonNullable<Json>
          cover_url: string | null
          created_at: string
          discussion_enabled: boolean
          excerpt: string
          id: string
          published_at: string | null
          search_text: string
          status: string
          summary: string | null
          title: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          author_id?: string | null
          category: string
          content: NonNullable<Json>
          cover_url?: string | null
          created_at?: string
          discussion_enabled?: boolean
          excerpt: string
          id?: string
          published_at?: string | null
          search_text: string
          status: string
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          category?: string
          content?: NonNullable<Json>
          cover_url?: string | null
          created_at?: string
          discussion_enabled?: boolean
          excerpt?: string
          id?: string
          published_at?: string | null
          search_text?: string
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'market_listings_author_id_fkey'
            columns: ['author_id']
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
      publication_attachments: {
        Row: {
          content_type: string
          file_name: string
          id: string
          path: string
          position: number
          publication_id: string
          size: number
        }
        ComputedFields: never
        Insert: {
          content_type: string
          file_name: string
          id?: string
          path: string
          position: number
          publication_id: string
          size: number
        }
        Update: {
          content_type?: string
          file_name?: string
          id?: string
          path?: string
          position?: number
          publication_id?: string
          size?: number
        }
        Relationships: [
          {
            foreignKeyName: 'publication_attachments_publication_id_fkey'
            columns: ['publication_id']
            isOneToOne: false
            referencedRelation: 'publications'
            referencedColumns: ['id']
          },
        ]
      }
      publications: {
        Row: {
          author_id: string | null
          category: string
          content: NonNullable<Json>
          cover_url: string | null
          created_at: string
          discussion_enabled: boolean
          excerpt: string
          id: string
          published_at: string | null
          search_text: string
          show_author: boolean
          status: string
          summary: string | null
          title: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          author_id?: string | null
          category: string
          content: NonNullable<Json>
          cover_url?: string | null
          created_at?: string
          discussion_enabled?: boolean
          excerpt: string
          id?: string
          published_at?: string | null
          search_text: string
          show_author?: boolean
          status: string
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          category?: string
          content?: NonNullable<Json>
          cover_url?: string | null
          created_at?: string
          discussion_enabled?: boolean
          excerpt?: string
          id?: string
          published_at?: string | null
          search_text?: string
          show_author?: boolean
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'publications_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      section_views: {
        Row: {
          section: string
          seen_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          section: string
          seen_at: string
          user_id: string
        }
        Update: {
          section?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'section_views_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      telegram_announcements: {
        Row: {
          created_at: string
          event_id: string
          id: string
          text_html: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          text_html: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          text_html?: string
        }
        Relationships: [
          {
            foreignKeyName: 'telegram_announcements_event_id_fkey'
            columns: ['event_id']
            isOneToOne: false
            referencedRelation: 'events'
            referencedColumns: ['id']
          },
        ]
      }
      telegram_event_messages: {
        Row: {
          announcement_id: string
          chat_id: number
          event_id: string
          message_id: number
          sent_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          announcement_id: string
          chat_id: number
          event_id: string
          message_id: number
          sent_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          chat_id?: number
          event_id?: string
          message_id?: number
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'telegram_event_messages_announcement_id_fkey'
            columns: ['announcement_id']
            isOneToOne: false
            referencedRelation: 'telegram_announcements'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'telegram_event_messages_event_id_fkey'
            columns: ['event_id']
            isOneToOne: false
            referencedRelation: 'events'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'telegram_event_messages_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      telegram_link_codes: {
        Row: {
          code_hash: string
          expires_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          code_hash: string
          expires_at: string
          user_id: string
        }
        Update: {
          code_hash?: string
          expires_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'telegram_link_codes_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      telegram_links: {
        Row: {
          blocked_at: string | null
          chat_id: number
          display_name: string
          linked_at: string
          telegram_user_id: number
          user_id: string
          username: string | null
        }
        ComputedFields: never
        Insert: {
          blocked_at?: string | null
          chat_id: number
          display_name: string
          linked_at?: string
          telegram_user_id: number
          user_id: string
          username?: string | null
        }
        Update: {
          blocked_at?: string | null
          chat_id?: number
          display_name?: string
          linked_at?: string
          telegram_user_id?: number
          user_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'telegram_links_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      user_deletions: {
        Row: {
          cleanup_paths: string[]
          created_at: string
          email: string
          last_error: string | null
          nickname: string
          requested_by: string | null
          stage: string
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          cleanup_paths?: string[]
          created_at?: string
          email: string
          last_error?: string | null
          nickname: string
          requested_by?: string | null
          stage: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cleanup_paths?: string[]
          created_at?: string
          email?: string
          last_error?: string | null
          nickname?: string
          requested_by?: string | null
          stage?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_deletions_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'profiles'
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
