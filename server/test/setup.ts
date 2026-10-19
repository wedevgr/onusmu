// Dummy configuration set before anything loads .env (dotenv never overrides existing values),
// so tests cannot reach the real database or OpenAI. Tests here only run pure logic.
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_ANON_KEY = 'test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
process.env.OPENAI_API_KEY = '';
process.env.CHAT_ENCRYPTION_KEY = '0'.repeat(64);
process.env.ENCRYPTION_KEYS = '';
process.env.ENCRYPTION_ACTIVE_KEY_ID = '';
