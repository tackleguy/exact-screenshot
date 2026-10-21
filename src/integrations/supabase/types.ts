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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      comments: {
        Row: {
          author_name: string | null
          body: string
          created_at: string
          id: string
          parent_comment_id: string | null
          post_id: string
          user_id: string
        }
        Insert: {
          author_name?: string | null
          body: string
          created_at?: string
          id?: string
          parent_comment_id?: string | null
          post_id: string
          user_id: string
        }
        Update: {
          author_name?: string | null
          body?: string
          created_at?: string
          id?: string
          parent_comment_id?: string | null
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      community_posts: {
        Row: {
          author_name: string | null
          author_tier: string | null
          base_weight_oz: number
          clone_count: number
          created_at: string
          description: string | null
          gear_data: Json
          id: string
          is_featured: boolean
          item_count: number
          packing_list_id: string | null
          title: string
          total_cost: number
          total_weight_oz: number
          trail_name: string | null
          trip_type: string | null
          user_id: string
        }
        Insert: {
          author_name?: string | null
          author_tier?: string | null
          base_weight_oz?: number
          clone_count?: number
          created_at?: string
          description?: string | null
          gear_data?: Json
          id?: string
          is_featured?: boolean
          item_count?: number
          packing_list_id?: string | null
          title: string
          total_cost?: number
          total_weight_oz?: number
          trail_name?: string | null
          trip_type?: string | null
          user_id: string
        }
        Update: {
          author_name?: string | null
          author_tier?: string | null
          base_weight_oz?: number
          clone_count?: number
          created_at?: string
          description?: string | null
          gear_data?: Json
          id?: string
          is_featured?: boolean
          item_count?: number
          packing_list_id?: string | null
          title?: string
          total_cost?: number
          total_weight_oz?: number
          trail_name?: string | null
          trip_type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      gear_items: {
        Row: {
          category: string
          created_at: string
          id: string
          link: string | null
          name: string
          price: number
          qty: number
          type: string
          user_id: string
          weight: number
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          link?: string | null
          name: string
          price?: number
          qty?: number
          type?: string
          user_id: string
          weight?: number
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          link?: string | null
          name?: string
          price?: number
          qty?: number
          type?: string
          user_id?: string
          weight?: number
        }
        Relationships: []
      }
      packing_list_items: {
        Row: {
          created_at: string
          gear_item_id: string
          id: string
          packed: boolean
          packing_list_id: string
        }
        Insert: {
          created_at?: string
          gear_item_id: string
          id?: string
          packed?: boolean
          packing_list_id: string
        }
        Update: {
          created_at?: string
          gear_item_id?: string
          id?: string
          packed?: boolean
          packing_list_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "packing_list_items_gear_item_id_fkey"
            columns: ["gear_item_id"]
            isOneToOne: false
            referencedRelation: "gear_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_list_items_packing_list_id_fkey"
            columns: ["packing_list_id"]
            isOneToOne: false
            referencedRelation: "packing_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      packing_lists: {
        Row: {
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shopping_items: {
        Row: {
          created_at: string
          id: string
          name: string
          price: number
          priority: string
          purchased: boolean
          store: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          price?: number
          priority?: string
          purchased?: boolean
          store?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          price?: number
          priority?: string
          purchased?: boolean
          store?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ski_areas: {
        Row: {
          bounds: Json | null
          country: string
          country_name: string
          counts: Json
          created_at: string
          elevation_max_ft: number | null
          elevation_min_ft: number | null
          file: string | null
          id: string
          latitude: number
          lifts: number
          locality: string
          longitude: number
          name: string
          notes: string | null
          region: string
          ski_types: string[]
          slug: string
          website: string | null
        }
        Insert: {
          bounds?: Json | null
          country?: string
          country_name?: string
          counts?: Json
          created_at?: string
          elevation_max_ft?: number | null
          elevation_min_ft?: number | null
          file?: string | null
          id: string
          latitude: number
          lifts?: number
          locality?: string
          longitude: number
          name: string
          notes?: string | null
          region?: string
          ski_types?: string[]
          slug: string
          website?: string | null
        }
        Update: {
          bounds?: Json | null
          country?: string
          country_name?: string
          counts?: Json
          created_at?: string
          elevation_max_ft?: number | null
          elevation_min_ft?: number | null
          file?: string | null
          id?: string
          latitude?: number
          lifts?: number
          locality?: string
          longitude?: number
          name?: string
          notes?: string | null
          region?: string
          ski_types?: string[]
          slug?: string
          website?: string | null
        }
        Relationships: []
      }
      trip_journal: {
        Row: {
          avg_day_temp_f: number | null
          avg_night_temp_f: number | null
          bug_level: string | null
          companions: string | null
          created_at: string
          difficulty_rating: number | null
          distance_miles: number | null
          elevation_gain_ft: number | null
          elevation_loss_ft: number | null
          end_date: string | null
          gear_notes: string | null
          hero_photo_url: string | null
          highest_point_ft: number | null
          hiking_time_hours: number | null
          id: string
          is_public: boolean
          packing_list_id: string | null
          snow_ice: string | null
          start_date: string | null
          trail_condition: string | null
          trail_name: string | null
          trip_name: string
          trip_notes: string | null
          user_id: string
          water_sources: string | null
          weather_conditions: string[] | null
        }
        Insert: {
          avg_day_temp_f?: number | null
          avg_night_temp_f?: number | null
          bug_level?: string | null
          companions?: string | null
          created_at?: string
          difficulty_rating?: number | null
          distance_miles?: number | null
          elevation_gain_ft?: number | null
          elevation_loss_ft?: number | null
          end_date?: string | null
          gear_notes?: string | null
          hero_photo_url?: string | null
          highest_point_ft?: number | null
          hiking_time_hours?: number | null
          id?: string
          is_public?: boolean
          packing_list_id?: string | null
          snow_ice?: string | null
          start_date?: string | null
          trail_condition?: string | null
          trail_name?: string | null
          trip_name: string
          trip_notes?: string | null
          user_id: string
          water_sources?: string | null
          weather_conditions?: string[] | null
        }
        Update: {
          avg_day_temp_f?: number | null
          avg_night_temp_f?: number | null
          bug_level?: string | null
          companions?: string | null
          created_at?: string
          difficulty_rating?: number | null
          distance_miles?: number | null
          elevation_gain_ft?: number | null
          elevation_loss_ft?: number | null
          end_date?: string | null
          gear_notes?: string | null
          hero_photo_url?: string | null
          highest_point_ft?: number | null
          hiking_time_hours?: number | null
          id?: string
          is_public?: boolean
          packing_list_id?: string | null
          snow_ice?: string | null
          start_date?: string | null
          trail_condition?: string | null
          trail_name?: string | null
          trip_name?: string
          trip_notes?: string | null
          user_id?: string
          water_sources?: string | null
          weather_conditions?: string[] | null
        }
        Relationships: []
      }
      trip_journal_days: {
        Row: {
          camp_location: string | null
          day_number: number
          id: string
          journal_id: string
          miles: number | null
          notes: string | null
        }
        Insert: {
          camp_location?: string | null
          day_number: number
          id?: string
          journal_id: string
          miles?: number | null
          notes?: string | null
        }
        Update: {
          camp_location?: string | null
          day_number?: number
          id?: string
          journal_id?: string
          miles?: number | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_journal_days_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "trip_journal"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_journal_photos: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          journal_id: string
          photo_url: string
          sort_order: number
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          journal_id: string
          photo_url: string
          sort_order?: number
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          journal_id?: string
          photo_url?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "trip_journal_photos_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "trip_journal"
            referencedColumns: ["id"]
          },
        ]
      }
      user_trails: {
        Row: {
          created_at: string
          days: string
          difficulty: string
          distance: number
          elevation: number
          id: string
          location: string
          name: string
          season: string
          tags: string[]
          user_id: string
        }
        Insert: {
          created_at?: string
          days?: string
          difficulty?: string
          distance?: number
          elevation?: number
          id?: string
          location?: string
          name: string
          season?: string
          tags?: string[]
          user_id: string
        }
        Update: {
          created_at?: string
          days?: string
          difficulty?: string
          distance?: number
          elevation?: number
          id?: string
          location?: string
          name?: string
          season?: string
          tags?: string[]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      subscription_tier: "base_camp" | "summit" | "thru_hiker"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      subscription_tier: ["base_camp", "summit", "thru_hiker"],
    },
  },
} as const
