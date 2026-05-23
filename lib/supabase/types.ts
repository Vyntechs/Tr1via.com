// Generated types stub. The real version is produced by:
//   npm run typegen
// which runs `supabase gen types typescript --local --schema public > lib/supabase/types.ts`
//
// This stub holds us over until that's run. It matches 0001_init.sql.
// When you regenerate, the supabase CLI will overwrite this file with the
// canonical types.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      hosts: { Row: HostRow; Insert: HostInsert; Update: Partial<HostInsert> };
      venues: { Row: VenueRow; Insert: VenueInsert; Update: Partial<VenueInsert> };
      nights: { Row: NightRow; Insert: NightInsert; Update: Partial<NightInsert> };
      games: { Row: GameRow; Insert: GameInsert; Update: Partial<GameInsert> };
      categories: { Row: CategoryRow; Insert: CategoryInsert; Update: Partial<CategoryInsert> };
      questions: { Row: QuestionRow; Insert: QuestionInsert; Update: Partial<QuestionInsert> };
      players: { Row: PlayerRow; Insert: PlayerInsert; Update: Partial<PlayerInsert> };
      game_participations: { Row: ParticipationRow; Insert: ParticipationInsert; Update: Partial<ParticipationInsert> };
      answers: { Row: AnswerRow; Insert: AnswerInsert; Update: Partial<AnswerInsert> };
      reveals: { Row: RevealRow; Insert: RevealInsert; Update: Partial<RevealInsert> };
      adjustments: { Row: AdjustmentRow; Insert: AdjustmentInsert; Update: Partial<AdjustmentInsert> };
      topic_suggestions: { Row: TopicSuggestionRow; Insert: TopicSuggestionInsert; Update: Partial<TopicSuggestionInsert> };
      audience_topic_votes: { Row: AudienceTopicVoteRow; Insert: AudienceTopicVoteInsert; Update: Partial<AudienceTopicVoteInsert> };
    };
    Views: {
      game_scores: { Row: GameScoreRow };
    };
    Functions: {
      resolve_question: { Args: { p_question_id: string }; Returns: void };
      current_device_id: { Args: Record<string, never>; Returns: string | null };
      current_player_id: { Args: { p_night_id: string }; Returns: string | null };
      is_night_host: { Args: { p_night_id: string }; Returns: boolean };
    };
    Enums: Record<string, never>;
  };
}

// ─── row shapes ────────────────────────────────────────────────────────

export interface HostRow {
  id: string;
  user_id: string;
  display_name: string;
  default_venue: string | null;
  is_first_night_complete: boolean;
  created_at: string;
}
export type HostInsert = Omit<HostRow, "id" | "created_at" | "is_first_night_complete"> & {
  id?: string;
  created_at?: string;
  is_first_night_complete?: boolean;
};

export interface VenueRow {
  id: string;
  host_id: string;
  name: string;
  brand_color: string | null;
  created_at: string;
}
export type VenueInsert = Omit<VenueRow, "id" | "created_at"> & { id?: string; created_at?: string };

export interface NightRow {
  id: string;
  host_id: string;
  venue_name: string;
  room_code: string;
  theme_key: string;
  is_locked: boolean;
  scheduled_at: string | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string;
}
export type NightInsert = Omit<NightRow, "id" | "created_at" | "theme_key" | "is_locked" | "opened_at" | "closed_at" | "scheduled_at"> & {
  id?: string;
  created_at?: string;
  theme_key?: string;
  is_locked?: boolean;
  opened_at?: string | null;
  closed_at?: string | null;
  scheduled_at?: string | null;
};

export interface GameRow {
  id: string;
  night_id: string;
  game_no: 1 | 2;
  category_count: number;
  question_count: number;
  state: "draft" | "ready" | "live" | "done";
  started_at: string | null;
  ended_at: string | null;
}
export type GameInsert = Omit<GameRow, "id" | "category_count" | "question_count" | "state" | "started_at" | "ended_at"> & {
  id?: string;
  category_count?: number;
  question_count?: number;
  state?: GameRow["state"];
  started_at?: string | null;
  ended_at?: string | null;
};

export interface CategoryRow {
  id: string;
  game_id: string;
  name: string;
  topic: string;
  position: number;
  color: string | null;
  state: "draft" | "generating" | "review" | "ready";
  flavor: Json | null;
  created_at: string;
}
export type CategoryInsert = Omit<CategoryRow, "id" | "created_at" | "color" | "state" | "flavor"> & {
  id?: string;
  created_at?: string;
  color?: string | null;
  state?: CategoryRow["state"];
  flavor?: Json | null;
};

export interface QuestionRow {
  id: string;
  category_id: string;
  point_value: 100 | 200 | 300 | 400 | 500 | 600 | 700 | null;
  prompt: string;
  options: [string, string, string, string];
  correct_index: 0 | 1 | 2 | 3;
  image_url: string | null;
  image_attribution: string | null;
  image_source: "pexels" | "upload" | null;
  difficulty: number;
  source: "ai" | "host-edit";
  is_picked: boolean;
  fact_blurb: string | null;
  played_at: string | null;
  finished_at: string | null;
}
export type QuestionInsert = Omit<QuestionRow, "id" | "image_url" | "image_attribution" | "image_source" | "difficulty" | "source" | "is_picked" | "fact_blurb" | "played_at" | "finished_at" | "point_value"> & {
  id?: string;
  point_value?: QuestionRow["point_value"];
  image_url?: string | null;
  image_attribution?: string | null;
  image_source?: QuestionRow["image_source"];
  difficulty?: number;
  source?: QuestionRow["source"];
  is_picked?: boolean;
  fact_blurb?: string | null;
  played_at?: string | null;
  finished_at?: string | null;
};

export interface PlayerRow {
  id: string;
  night_id: string;
  device_id: string;
  display_name: string;
  joined_at: string;
  last_seen_at: string;
  app_switch_total_seconds: number;
  removed_at: string | null;
}
export type PlayerInsert = Omit<PlayerRow, "id" | "joined_at" | "last_seen_at" | "app_switch_total_seconds" | "removed_at"> & {
  id?: string;
  joined_at?: string;
  last_seen_at?: string;
  app_switch_total_seconds?: number;
  removed_at?: string | null;
};

export interface ParticipationRow {
  id: string;
  game_id: string;
  player_id: string;
  joined_at: string;
}
export type ParticipationInsert = Omit<ParticipationRow, "id" | "joined_at"> & { id?: string; joined_at?: string };

export interface AnswerRow {
  id: string;
  question_id: string;
  player_id: string;
  chosen_index: 0 | 1 | 2 | 3;
  scramble: [number, number, number, number];
  locked_at: string;
  ms_to_lock: number;
  is_correct: boolean | null;
  awarded_points: number | null;
}
export type AnswerInsert = Omit<AnswerRow, "id" | "locked_at" | "is_correct" | "awarded_points"> & {
  id?: string;
  locked_at?: string;
  is_correct?: boolean | null;
  awarded_points?: number | null;
};

export interface RevealRow {
  id: string;
  game_id: string;
  question_id: string;
  event: "reveal" | "undo" | "end-early" | "resolve";
  occurred_at: string;
  metadata: Json | null;
}
export type RevealInsert = Omit<RevealRow, "id" | "occurred_at" | "metadata"> & {
  id?: string;
  occurred_at?: string;
  metadata?: Json | null;
};

export interface AdjustmentRow {
  id: string;
  player_id: string;
  game_id: string;
  delta: number;
  reason: string | null;
  created_at: string;
}
export type AdjustmentInsert = Omit<AdjustmentRow, "id" | "created_at" | "reason"> & {
  id?: string;
  created_at?: string;
  reason?: string | null;
};

export interface TopicSuggestionRow {
  id: string;
  player_id: string;
  text: string;
  created_at: string;
}
export type TopicSuggestionInsert = Omit<TopicSuggestionRow, "id" | "created_at"> & { id?: string; created_at?: string };

export interface AudienceTopicVoteRow {
  id: string;
  night_id: string;
  player_id: string;
  topic: string;
  voted_at: string;
}
export type AudienceTopicVoteInsert = Omit<AudienceTopicVoteRow, "id" | "voted_at"> & { id?: string; voted_at?: string };

export interface GameScoreRow {
  game_id: string;
  player_id: string;
  display_name: string;
  score: number;
  correct_count: number;
  answered_count: number;
  fastest_correct_ms: number | null;
}
