/**
 * End-to-end smoke test against a running server (npm run dev) and the
 * configured Supabase project. Creates a throwaway user, uploads a synthetic
 * speech chunk (OpenAI TTS), waits for the transcribe/embed pipeline, then
 * exercises search and RAG chat. Deletes the user afterwards.
 *
 * Usage: node scripts/smoke-test.mjs   (expects server/.env to be sourced)
 */
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8787';
const SUPABASE = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const SPEECH_TEXT =
  'We discussed the contract with George. We decided to send the proposal tomorrow before noon.';

let step = '';
function fail(message) {
  console.error(`SMOKE TEST FAILED at [${step}]: ${message}`);
  process.exit(1);
}
async function req(url, options = {}, expectOk = true) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (expectOk && !res.ok) fail(`${options.method ?? 'GET'} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
  return { status: res.status, data };
}

async function main() {
  if (!SUPABASE || !SERVICE_KEY || !OPENAI_KEY) fail('Missing SUPABASE_URL / SERVICE_ROLE / OPENAI_API_KEY env vars');

  step = 'create test user';
  const email = `e2e-${Date.now()}@test.aimemory.local`;
  const password = 'Test-aimemory-159!';
  const created = await req(`${SUPABASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const userId = created.data.user?.id ?? created.data.id;
  if (!userId) fail(`No user id in response: ${JSON.stringify(created.data).slice(0, 300)}`);
  console.log(`ok - user ${email} (${userId})`);

  let token;
  try {
    step = 'log in test user';
    const login = await req(`${SUPABASE}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    token = login.data.access_token;
    if (!token) fail('No access_token');
    console.log('ok - logged in');
  } catch (err) {
    await cleanup(userId);
    throw err;
  }

  const auth = { Authorization: `Bearer ${token}` };

  try {
    step = 'create session';
    const clientId = crypto.randomUUID();
    const session = await req(`${BASE}/v1/sessions`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, startedAt: new Date().toISOString() }),
    });
    console.log(`ok - session ${session.data.id}`);

    step = 'synthesize speech (OpenAI TTS)';
    const tts = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input: SPEECH_TEXT }),
    });
    if (!tts.ok) fail(`TTS -> ${tts.status}: ${(await tts.text()).slice(0, 300)}`);
    const audio = Buffer.from(await tts.arrayBuffer());
    console.log(`ok - synthesized ${audio.length} bytes of speech`);

    step = 'upload chunk';
    const form = new FormData();
    const startedAt = new Date();
    const endedAt = new Date(startedAt.getTime() + 15000);
    form.append('sessionId', clientId);
    form.append('chunkIndex', '0');
    form.append('startedAt', startedAt.toISOString());
    form.append('endedAt', endedAt.toISOString());
    form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'chunk.mp3');
    const upload = await req(`${BASE}/v1/uploads`, { method: 'POST', headers: { ...auth }, body: form });
    console.log(`ok - chunk queued: ${upload.data.chunkId}`);

    step = 'wait for transcription + embedding';
    let chunks = [];
    let completed = false;
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 4000));
      const list = await req(`${BASE}/v1/chunks?sessionId=${session.data.id}`, { headers: auth });
      chunks = list.data.chunks ?? [];
      const status = chunks[0]?.processingStatus;
      if (status === 'completed' || status === 'failed') {
        if (status === 'failed') fail('chunk processing failed');
        completed = true;
        break;
      }
    }
    if (!completed) fail('chunk still not completed after 2 minutes');
    console.log(`ok - transcribed: "${chunks[0].text}"`);

    step = 'keyword search';
    const search = await req(`${BASE}/v1/search?q=George`, { headers: auth });
    if ((search.data.results ?? []).length === 0) fail('search returned 0 results for "George"');
    console.log(`ok - search "George": ${search.data.results.length} result(s)`);

    step = 'RAG chat';
    const chat = await req(`${BASE}/v1/chat`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What did we decide about the contract with George?' }),
    });
    console.log('ok - chat answer:');
    console.log(`   "${chat.data.answer}"`);
    console.log(`   citations: ${(chat.data.citations ?? []).length} chunk(s) with timestamps`);

    console.log('\nSMOKE TEST PASSED');
  } finally {
    await cleanup(userId);
  }
}

async function cleanup(userId) {
  try {
    await fetch(`${SUPABASE}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    console.log('cleanup - test user deleted (rows cascade)');
  } catch {
    console.error('cleanup failed - delete the test user manually');
  }
}

main().catch((err) => {
  console.error(`SMOKE TEST FAILED at [${step}]:`, err.message ?? err);
  process.exit(1);
});
