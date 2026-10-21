export interface HealthResponse {
  ok: boolean;
}

export interface CreateSessionRequest {
  clientId: string;
  startedAt: string;
}

export interface CreateSessionResponse {
  id: string;
  clientId: string;
  startedAt: string;
  status: string;
}

export interface StopSessionRequest {
  endedAt: string;
}

export interface StopSessionResponse {
  id: string;
  status: string;
  durationSeconds: number;
}

export interface SessionSummary {
  id: string;
  clientId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  status: string;
  chunkCount: number;
}

export interface ListSessionsResponse {
  sessions: SessionSummary[];
}

export interface UploadChunkRequest {
  sessionId: string;
  chunkIndex: number;
  startedAt: string;
  endedAt: string;
  fileUri: string;
  fileName: string;
}

export interface UploadResponse {
  chunkId: string;
  sessionId: string;
  status: string;
}

export interface Chunk {
  id: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  text: string;
  processingStatus: string;
  createdAt: string;
  // What was understood from it; missing on older servers.
  insights?: Insight[];
}

export interface ListChunksResponse {
  chunks: Chunk[];
}

export interface SearchParams {
  q: string;
  from?: string;
  to?: string;
  limit?: number;
  // exact: literal matches (fast). related: other matches by meaning (slower).
  mode?: 'exact' | 'related';
}

export interface SearchResult {
  id: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  text: string;
  score: number;
  // exact: contains the searched words. related: about the same thing in other words.
  // Optional so an older server still works.
  match?: 'exact' | 'related';
  // [start, end) character ranges of matched words.
  highlights?: Array<[number, number]>;
}

export interface SearchResponse {
  results: SearchResult[];
}

export interface SettingsResponse {
  keepAudio: boolean;
  // Reminders found in recordings are created directly instead of waiting for confirmation.
  autoReminders: boolean;
  // Morning briefing notification and its local time, "HH:mm". Missing on older servers.
  briefingEnabled?: boolean;
  briefingTime?: string;
}

export interface Briefing {
  date: string;
  title: string;
  body: string;
}

export interface BriefingResponse {
  briefings: Briefing[];
}

export interface Citation {
  chunkId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  text: string;
  score: number;
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
}

export interface ChatResponse {
  conversationId: string;
  messageId: string;
  answer: string;
  citations: Citation[];
  // Questions the user might ask next; only from the streaming endpoint.
  followUps?: string[];
}

export interface ChatStreamHandlers {
  onStart?: (conversationId: string) => void;
  // What the server is doing before the answer starts, e.g. "Ψάχνω στις καταγραφές σου…".
  onStatus?: (text: string) => void;
  // A piece of the answer; may contain [n] source markers, removed in the final answer.
  onDelta?: (text: string) => void;
}

export interface Conversation {
  id: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConversationsResponse {
  conversations: Conversation[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[] | null;
  createdAt: string;
}

export interface MessagesResponse {
  messages: ChatMessage[];
}

export interface SuggestionsResponse {
  suggestions: string[];
}

export type PlanId = 'free' | 'starter' | 'plus' | 'pro' | 'unlimited';

export interface BillingResponse {
  plan: PlanId;
  // Where the plan was bought: 'stripe', 'manual', 'app_store', 'play_store', or null on Free.
  provider: string | null;
  period: 'day' | 'month';
  limitSeconds: number | null;
  usedSeconds: number;
  remainingSeconds: number | null;
  periodStart: string;
  resetsAt: string;
}

export interface OkResponse {
  ok: boolean;
}

export type ReminderStatus = 'suggested' | 'pending' | 'done' | 'dismissed';

export type RepeatFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

// How a reminder repeats, as the server stores it.
export interface Repeat {
  freq: RepeatFrequency;
  interval: number;
  days?: number[];
  monthDay?: number;
  time: string;
  start: string;
  until?: string;
}

// What the app sends: the rest of the rule comes from the reminder's date.
export interface RepeatInput {
  freq: RepeatFrequency;
  interval?: number;
}

export interface Reminder {
  id: string;
  text: string;
  dueAt: string | null;
  status: ReminderStatus;
  // Set when the server suggested this reminder from a recording.
  sourceChunkId: string | null;
  createdAt: string;
  // Repeating reminders; missing on older servers.
  repeat?: Repeat | null;
  // e.g. "Κάθε Δευτέρα 09:00".
  repeatLabel?: string | null;
  // The next dates to notify, starting with dueAt.
  upcoming?: string[];
  // Groups the server gave it; missing on older servers.
  tags?: ReminderTag[];
  // Set when the reminder is about paying or collecting money.
  money?: ReminderMoney | null;
}

export type ReminderTag = 'money' | 'work' | 'home' | 'car' | 'health' | 'family' | 'shopping' | 'errands';

export interface ReminderMoney {
  // Null when no amount was said.
  amount: number | null;
  currency: string;
  // pay: the user pays. receive: someone pays the user.
  direction: 'pay' | 'receive';
}

export interface RemindersResponse {
  reminders: Reminder[];
}

export interface CreateReminderRequest {
  text: string;
  dueAt: string | null;
  repeat?: RepeatInput | null;
}

export interface UpdateReminderRequest {
  text?: string;
  dueAt?: string | null;
  status?: Exclude<ReminderStatus, 'suggested'>;
  // null stops repeating.
  repeat?: RepeatInput | null;
}

export type TermKind = 'person' | 'place' | 'business' | 'thing' | 'other';

// A name the user mentions in recordings: who or what it is and how it was misheard.
export interface Term {
  id: string;
  term: string;
  kind: TermKind;
  note: string;
  variants: string[];
  mentions: number;
  source: 'auto' | 'user';
  lastSeenAt: string;
}

export interface TermsResponse {
  terms: Term[];
}

export interface TermResponse {
  term: Term | null;
}

export interface SaveTermRequest {
  term?: string;
  kind?: TermKind;
  note?: string;
}

export type InsightType =
  | 'task'
  | 'done'
  | 'stopped'
  | 'settled'
  | 'expense'
  | 'income'
  | 'debt'
  | 'receivable'
  | 'measure';

// One thing understood from a recording, e.g. "Έξοδο 70,00 € · Σέρβις Auris"; can be undone.
export interface Insight {
  type: InsightType;
  label: string;
  refId: string;
  undone?: boolean;
}

export interface RecordingInsights {
  chunkId: string;
  sessionId: string;
  startedAt: string;
  items: Insight[];
}

export interface InsightsResponse {
  recordings: RecordingInsights[];
}

export interface UndoInsightResponse {
  items: Insight[];
}
