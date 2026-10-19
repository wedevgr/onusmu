import { config } from '../config';
import { supabase } from '../supabase';
import type {
  BillingResponse,
  ChatRequest,
  BriefingResponse,
  ChatResponse,
  ChatStreamHandlers,
  Conversation,
  ConversationsResponse,
  CreateReminderRequest,
  CreateSessionRequest,
  CreateSessionResponse,
  HealthResponse,
  ListChunksResponse,
  ListSessionsResponse,
  MessagesResponse,
  OkResponse,
  Reminder,
  RemindersResponse,
  InsightsResponse,
  UndoInsightResponse,
  SaveTermRequest,
  TermResponse,
  TermsResponse,
  SearchParams,
  SearchResponse,
  SettingsResponse,
  SuggestionsResponse,
  StopSessionRequest,
  StopSessionResponse,
  UpdateReminderRequest,
  UploadChunkRequest,
  UploadResponse,
} from './types';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method: Method;
  body?: unknown;
  form?: () => FormData;
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function refreshAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

function extractErrorMessage(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const value = record.error ?? record.message;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function request<T>(path: string, options: RequestOptions, retried = false): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new ApiError('Έχεις αποσυνδεθεί.', 401);
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form();
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, { method: options.method, headers, body });
  } catch {
    throw new ApiError('Σφάλμα δικτύου. Έλεγξε τη σύνδεσή σου.', 0);
  }

  if (response.status === 401 && !retried) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      await supabase.auth.signOut();
      throw new ApiError('Η σύνδεσή σου έληξε. Συνδέσου ξανά.', 401);
    }
    return request<T>(path, options, true);
  }

  const text = await response.text();
  let data: unknown = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message = extractErrorMessage(data) ?? `Το αίτημα απέτυχε (${response.status}).`;
    throw new ApiError(message, response.status);
  }

  return data as T;
}

/**
 * POST /v1/chat/stream: server-sent events read with XMLHttpRequest, which (unlike fetch in
 * React Native) delivers the response text while it is still arriving.
 */
async function streamChatRequest(
  body: ChatRequest,
  handlers: ChatStreamHandlers,
  retried = false,
): Promise<ChatResponse> {
  const token = await getAccessToken();
  if (!token) throw new ApiError('Έχεις αποσυνδεθεί.', 401);

  const outcome = await new Promise<ChatResponse | 'unauthorized'>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let read = 0;
    let finished = false;

    const handleEvent = (block: string): void => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const raw = /^data: (.*)$/m.exec(block)?.[1];
      if (!event || raw === undefined) return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }
      if (event === 'start') handlers.onStart?.(String(data.conversationId));
      else if (event === 'status') handlers.onStatus?.(String(data.text ?? ''));
      else if (event === 'delta') handlers.onDelta?.(String(data.text ?? ''));
      else if (event === 'done') {
        finished = true;
        resolve(data as unknown as ChatResponse);
      } else if (event === 'error') {
        finished = true;
        reject(new ApiError(String(data.message ?? 'Δεν ήταν δυνατή η απάντηση.'), 500));
      }
    };

    // Each event ends with a blank line; handle the complete ones received so far.
    const consume = (): void => {
      if (xhr.status !== 200) return;
      const text = xhr.responseText;
      let end = text.indexOf('\n\n', read);
      while (end >= 0) {
        handleEvent(text.slice(read, end));
        read = end + 2;
        end = text.indexOf('\n\n', read);
      }
    };

    xhr.open('POST', `${config.apiUrl}/v1/chat/stream`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'text/event-stream');
    // Setting onprogress is what makes React Native deliver the text incrementally.
    xhr.onprogress = consume;
    xhr.onload = () => {
      if (xhr.status === 401 && !retried) {
        resolve('unauthorized');
        return;
      }
      if (xhr.status !== 200) {
        let message: string | null = null;
        try {
          message = extractErrorMessage(JSON.parse(xhr.responseText));
        } catch {
          message = null;
        }
        reject(new ApiError(message ?? `Το αίτημα απέτυχε (${xhr.status}).`, xhr.status));
        return;
      }
      consume();
      if (!finished) reject(new ApiError('Η απάντηση διακόπηκε. Δοκίμασε ξανά.', 0));
    };
    xhr.onerror = () => reject(new ApiError('Σφάλμα δικτύου. Έλεγξε τη σύνδεσή σου.', 0));
    xhr.send(JSON.stringify(body));
  });

  if (outcome !== 'unauthorized') return outcome;
  const refreshed = await refreshAccessToken();
  if (!refreshed) {
    await supabase.auth.signOut();
    throw new ApiError('Η σύνδεσή σου έληξε. Συνδέσου ξανά.', 401);
  }
  return streamChatRequest(body, handlers, true);
}

function buildQuery(params: object): string {
  const parts = Object.entries(params)
    .filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== undefined && typeof entry[1] !== 'object',
    )
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export const api = {
  healthz: (): Promise<HealthResponse> => request('/healthz', { method: 'GET' }),

  createSession: (body: CreateSessionRequest): Promise<CreateSessionResponse> =>
    request('/v1/sessions', { method: 'POST', body }),

  stopSession: (clientId: string, body: StopSessionRequest): Promise<StopSessionResponse> =>
    request(`/v1/sessions/${encodeURIComponent(clientId)}/stop`, { method: 'POST', body }),

  listSessions: (params: { from?: string; to?: string } = {}): Promise<ListSessionsResponse> =>
    request(`/v1/sessions${buildQuery(params)}`, { method: 'GET' }),

  deleteSession: (id: string): Promise<OkResponse> =>
    request(`/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  uploadChunk: (input: UploadChunkRequest): Promise<UploadResponse> =>
    request('/v1/uploads', {
      method: 'POST',
      form: () => {
        const form = new FormData();
        form.append('sessionId', input.sessionId);
        form.append('chunkIndex', String(input.chunkIndex));
        form.append('startedAt', input.startedAt);
        form.append('endedAt', input.endedAt);
        form.append('file', { uri: input.fileUri, name: input.fileName, type: 'audio/m4a' } as unknown as Blob);
        return form;
      },
    }),

  listChunks: (params: {
    sessionId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<ListChunksResponse> => request(`/v1/chunks${buildQuery(params)}`, { method: 'GET' }),

  deleteChunk: (id: string): Promise<OkResponse> =>
    request(`/v1/chunks/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  search: (params: SearchParams): Promise<SearchResponse> =>
    request(`/v1/search${buildQuery(params)}`, { method: 'GET' }),

  getSettings: (): Promise<SettingsResponse> => request('/v1/settings', { method: 'GET' }),

  getBriefings: (): Promise<BriefingResponse> => request('/v1/briefing', { method: 'GET' }),

  updateSettings: (patch: Partial<SettingsResponse>): Promise<SettingsResponse> =>
    request('/v1/settings', { method: 'PUT', body: patch }),

  updateTimezone: (timezone: string): Promise<OkResponse> =>
    request('/v1/settings/timezone', { method: 'PUT', body: { timezone } }),

  listReminders: (): Promise<RemindersResponse> => request('/v1/reminders', { method: 'GET' }),

  createReminder: (body: CreateReminderRequest): Promise<Reminder> =>
    request('/v1/reminders', { method: 'POST', body }),

  updateReminder: (id: string, body: UpdateReminderRequest): Promise<Reminder> =>
    request(`/v1/reminders/${encodeURIComponent(id)}`, { method: 'PATCH', body }),

  deleteReminder: (id: string): Promise<OkResponse> =>
    request(`/v1/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listInsights: (): Promise<InsightsResponse> => request('/v1/insights', { method: 'GET' }),

  markInsightsSeen: (chunkIds: string[]): Promise<OkResponse> =>
    request('/v1/insights/seen', { method: 'POST', body: { chunkIds } }),

  undoInsight: (chunkId: string, index: number): Promise<UndoInsightResponse> =>
    request('/v1/insights/undo', { method: 'POST', body: { chunkId, index } }),

  listTerms: (): Promise<TermsResponse> => request('/v1/terms', { method: 'GET' }),

  createTerm: (body: SaveTermRequest): Promise<TermResponse> =>
    request('/v1/terms', { method: 'POST', body }),

  updateTerm: (id: string, body: SaveTermRequest): Promise<TermResponse> =>
    request(`/v1/terms/${encodeURIComponent(id)}`, { method: 'PATCH', body }),

  deleteTerm: (id: string): Promise<OkResponse> =>
    request(`/v1/terms/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  sendChat: (body: ChatRequest): Promise<ChatResponse> =>
    request('/v1/chat', { method: 'POST', body }),

  streamChat: (body: ChatRequest, handlers: ChatStreamHandlers): Promise<ChatResponse> =>
    streamChatRequest(body, handlers),

  listConversations: (): Promise<ConversationsResponse> =>
    request('/v1/chat/conversations', { method: 'GET' }),

  getSuggestions: (): Promise<SuggestionsResponse> =>
    request('/v1/suggestions', { method: 'GET' }),

  listMessages: (conversationId: string): Promise<MessagesResponse> =>
    request(`/v1/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'GET',
    }),

  deleteConversation: (conversationId: string): Promise<unknown> =>
    request(`/v1/chat/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' }),

  getBilling: (): Promise<BillingResponse> => request('/v1/billing', { method: 'GET' }),

  deleteAccount: (): Promise<OkResponse> => request('/v1/account', { method: 'DELETE' }),
};

export type { Conversation };
