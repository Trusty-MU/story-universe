// Public client config. The anon key is a publishable key: on its own it can't read any data
// (RLS has no policies, storage is private). The family passcode guards the Edge Functions.
export const SUPABASE_URL = "https://bxrifunbkyhnzpstkgxw.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4cmlmdW5ia3lobnpwc3RrZ3h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3OTQ4MTgsImV4cCI6MjExMDM3MDgxOH0.1B8WWuHxcO-eaX9kCHTHCJQaGiE5dazvGHpPBIQtx_c";
