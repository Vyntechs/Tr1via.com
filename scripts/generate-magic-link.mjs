// One-shot script: generate a magic-link URL via the Supabase admin API.
// Bypasses email entirely — the URL itself is the auth. Run with:
//   node --env-file=.env.local scripts/generate-magic-link.mjs <email> [redirectTo]
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const email = process.argv[2] ?? 'brandon@vyntechs.com';
const redirectTo = process.argv[3] ?? 'https://tr1via.com/auth/callback';

const { data, error } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email,
  options: { redirectTo },
});

if (error) {
  console.error('generateLink failed:', error.message);
  process.exit(1);
}

console.log('email:', email);
console.log('redirect_to:', redirectTo);
console.log('action_link:', data?.properties?.action_link);
console.log('hashed_token:', data?.properties?.hashed_token);
console.log('email_otp:', data?.properties?.email_otp);
