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
}

export interface ListChunksResponse {
  chunks: Chunk[];
}

export interface SearchParams {
  q: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface SearchResult {
  id: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  text: string;
  score: number;
}

export interface SearchResponse {
  results: SearchResult[];
}

export interface SettingsResponse {
  keepAudio: boolean;
  // Reminders found in recordings are created directly instead of waiting for confirmation.
  autoReminders: boolean;
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

export interface Reminder {
  id: string;
  text: string;
  dueAt: string | null;
  status: ReminderStatus;
  // Set when the server suggested this reminder from a recording.
  sourceChunkId: string | null;
  createdAt: string;
}

export interface RemindersResponse {
  reminders: Reminder[];
}

export interface CreateReminderRequest {
  text: string;
  dueAt: string | null;
}

export interface UpdateReminderRequest {
  text?: string;
  dueAt?: string | null;
  status?: Exclude<ReminderStatus, 'suggested'>;
}
