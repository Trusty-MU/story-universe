// Story Universe: family members (list, add, update).
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const PASSCODE = Deno.env.get("FAMILY_PASSCODE");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-family-passcode",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const ROLES = ["kid", "parent", "other"];
const COLS = "id,name,role,birth_month,notes";

type Fields = { name?: string; role?: string; birth_month?: string | null; notes?: string | null };

function clean(p: Fields, partial: boolean) {
  const out: Record<string, string | null> = {};
  if (p.name !== undefined || !partial) {
    const name = (p.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) throw new Error("Please enter a name");
    if (name.length > 40) throw new Error("That name is too long (40 characters max)");
    out.name = name;
  }
  if (p.role !== undefined || !partial) {
    if (!ROLES.includes(p.role ?? "")) throw new Error("Choose kid, parent or other");
    out.role = p.role!;
  }
  if (p.birth_month !== undefined) {
    const b = (p.birth_month ?? "").trim();
    if (!b) out.birth_month = null;
    else {
      const m = b.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
      if (!m || +m[2] < 1 || +m[2] > 12) throw new Error("Birth month should look like 2024-05");
      const d = `${m[1]}-${m[2]}-01`;
      if (Date.parse(d) > Date.now()) throw new Error("Birth month can't be in the future");
      out.birth_month = d;
    }
  }
  if (p.notes !== undefined) out.notes = (p.notes ?? "").trim().slice(0, 500) || null;
  return out;
}

function friendly(error: { code?: string; message: string }, name?: string | null): never {
  if (error.code === "23505") throw new Error(`${name ?? "That person"} is already in the family`);
  throw new Error(error.message);
}

async function list() {
  const { data, error } = await sb.from("family_members").select(COLS);
  if (error) throw error;
  const rank = (r: string) => (r === "kid" ? 0 : r === "parent" ? 1 : 2);
  return (data ?? []).sort((a, b) =>
    rank(a.role) - rank(b.role) || (b.birth_month ?? "").localeCompare(a.birth_month ?? "") || a.name.localeCompare(b.name));
}

async function add(p: Fields) {
  const row = clean(p, false);
  const { data, error } = await sb.from("family_members").insert(row).select(COLS).single();
  if (error) friendly(error, row.name);
  return data;
}

async function update(p: Fields & { id: string }) {
  if (!p.id) throw new Error("Missing id");
  const row = clean(p, true);
  if (!Object.keys(row).length) throw new Error("Nothing to change");
  const { data, error } = await sb.from("family_members").update(row).eq("id", p.id).select(COLS).single();
  if (error) friendly(error, row.name);
  return data;
}

const ACTIONS: Record<string, (p: any) => Promise<unknown>> = { list, add, update };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (PASSCODE && req.headers.get("x-family-passcode") !== PASSCODE) return json({ error: "Wrong passcode" }, 401);
  try {
    const { action, ...params } = await req.json();
    const fn = ACTIONS[action];
    if (!fn) return json({ error: `Unknown action: ${action}` }, 400);
    return json({ ok: true, data: await fn(params) });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: err instanceof Error ? err.message : (err as any)?.message ?? String(err) }, 500);
  }
});
