// Deploy: supabase functions deploy send-complaint --no-verify-jwt
// Secrets: supabase secrets set BREVO_API_KEY=... SENDER_EMAIL=you@verified-sender.com
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const mail = (to: string, subject: string, text: string, from: string) =>
  fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST',
    headers: { 'api-key': Deno.env.get('BREVO_API_KEY')!, 'content-type': 'application/json' },
    body: JSON.stringify({ sender: { name: from, email: Deno.env.get('SENDER_EMAIL')! }, to: [{ email: to }], subject, textContent: text }) });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const { code } = await req.json();
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // Claim the complaint so it can only ever be e-mailed once.
  const { data: c } = await db.from('complaints').update({ emailed: true }).eq('code', code).eq('emailed', false).select().maybeSingle();
  if (!c) return new Response('{}', { headers: cors });
  const { data: u } = await db.from('universities').select('name,slug').eq('id', c.university_id).single();
  const { data: fc } = await db.from('field_contacts').select('email').eq('field_id', c.field_id).maybeSingle();
  const { data: p } = await db.from('complaint_private').select('email').eq('complaint_id', c.id).single();
  const U = u!.name.toUpperCase();
  const site = Deno.env.get('SITE_URL') ?? 'https://sdv-chess.github.io/CampusVoice';
  if (fc?.email) await mail(fc.email, `[${U}] ${c.field_name}: ${c.title} (${c.code})`,
`${U} via CampusVoice\nComplaint ${c.code}\nArea: ${c.field_name}\nReported by: ${c.shared ? c.name + ' <' + p!.email + '>' : 'Anonymous student'}\nDate: ${c.created_at}\n\n${c.title}\n\n${c.body}\n\nReply to the student and update the status here (no login needed):\n${site}/${u!.slug}#/respond/${c.code}/${c.respond_token}`, U + ' CampusVoice');
  await mail(p!.email, `Your ${u!.name} report ${c.code} was sent`, `Your report "${c.title}" was sent to the ${c.field_name} in-charge.\nTracking ID: ${c.code}`, U + ' CampusVoice');
  return new Response('{}', { headers: cors });
});