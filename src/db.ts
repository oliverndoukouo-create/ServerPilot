import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type SupabaseConfiguration = {
  url: string;
  serviceKey: string;
};

export function readSupabaseConfiguration(environment: NodeJS.ProcessEnv): SupabaseConfiguration | undefined {
  const url = environment.SUPABASE_URL?.trim();
  const serviceKey = environment.SUPABASE_SECRET_KEY?.trim();
  if (!url && !serviceKey) return undefined;
  if (!url || !serviceKey) {
    throw new Error('Supabase requires both SUPABASE_URL and SUPABASE_SECRET_KEY.');
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
      throw new Error('invalid protocol');
    }
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTPS URL (or localhost for development).');
  }
  return { url, serviceKey };
}

let client: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient | undefined {
  if (client) return client;
  const configuration = readSupabaseConfiguration(process.env);
  if (!configuration) return undefined;

  client = createClient(configuration.url, configuration.serviceKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  return client;
}
