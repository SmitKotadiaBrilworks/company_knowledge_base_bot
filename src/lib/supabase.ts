import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Lazy initialization: clients are created on first use, not at module load.
// This prevents Next.js `next build` from throwing "supabaseUrl is required"
// when env vars are not set at build time (e.g. CI).

let _admin: ReturnType<typeof createClient<Database>> | null = null;
let _public: ReturnType<typeof createClient<Database>> | null = null;

// Admin client — server-side only (API routes).
// Bypasses Row Level Security so it can read/write without a user session.
export function getSupabaseAdmin() {
  if (!_admin) {
    _admin = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _admin;
}

// Public client — usable from client components (respects RLS).
export function getSupabase() {
  if (!_public) {
    _public = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _public;
}
