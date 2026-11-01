// Deploy: supabase functions deploy send-complaint --no-verify-jwt   (or paste in the dashboard editor)
// Secrets: BREVO_API_KEY, SENDER_EMAIL, optional SITE_URL (default below)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const ok = () => new Response('{}', { headers: cors });
const mail = (to: string, subject: string, text: string, from: string) =>
  fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST',
    headers: { 'api-key': Deno.env.get('BREVO_API_KEY')!, 'content-type': 'application/json' },
    body: JSON.stringify({ sender: { name: from, email: Deno.env.get('SENDER_EMAIL')! }, to: [{ email: to }], subject, textContent: text }) });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const { code, token, stoken } = await req.json();
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const site = Deno.env.get('SITE_URL') ?? 'https://sdv-chess.github.io/CampusVoice';

  // A reply was posted: token = in-charge, stoken = student. Each message is e-mailed once.
  if (token || stoken) {
    const base = db.from('complaints').select('*').eq('code', code);
    const { data: r } = await (token ? base.eq('respond_token', token) : base.eq('student_token', stoken)).maybeSingle();
    if (!r) return ok();
    const who = token ? 'incharge' : 'student';
    const { data: ms } = await db.from('messages').update({ notified: true }).eq('complaint_id', r.id).eq('sender', who).eq('notified', false).select();
    if (!ms?.length) return ok();
    const { data: u } = await db.from('universities').select('name,slug').eq('id', r.university_id).single();
    const U = u!.name.toUpperCase(), text = ms.map((m) => m.body).join('\n\n');
    if (who === 'incharge') {
      const { data: p } = await db.from('complaint_private').select('email').eq('complaint_id', r.id).single();
      await mail(p!.email, `[${U}] Reply on your report ${r.code}`,
`The ${r.field_name} in-charge replied to "${r.title}":\n\n${text}\n\nStatus: ${r.status}\n\nRead the conversation and reply (private link):\n${site}/${u!.slug}#/track/${r.code}/${r.student_token}\n\nPlease do not reply to this e-mail; use the link above.`, U + ' CampusVoice');
    } else {
      const { data: fc } = await db.from('field_contacts').select('email').eq('field_id', r.field_id).maybeSingle();
      if (fc?.email) await mail(fc.email, `[${U}] Student reply on ${r.code}`,
`${r.shared ? r.name : 'The student'} replied to "${r.title}":\n\n${text}\n\nReply here (no login needed):\n${site}/${u!.slug}#/respond/${r.code}/${r.respond_token}`, U + ' CampusVoice');
    }
    return ok();
  }

  // A new complaint: claim it so it is only ever e-mailed once.
  const { data: c } = await db.from('complaints').update({ emailed: true }).eq('code', code).eq('emailed', false).select().maybeSingle();
  if (!c) return ok();
  const { data: u } = await db.from('universities').select('name,slug').eq('id', c.university_id).single();
  const { data: fc } = await db.from('field_contacts').select('email').eq('field_id', c.field_id).maybeSingle();
  const { data: p } = await db.from('complaint_private').select('email').eq('complaint_id', c.id).single();
  const U = u!.name.toUpperCase();
  if (fc?.email) await mail(fc.email, `[${U}] ${c.field_name}: ${c.title} (${c.code})`,
`${U} via CampusVoice\nComplaint ${c.code}\nArea: ${c.field_name}\nReported by: ${c.shared ? c.name + ' <' + p!.email + '>' : 'Anonymous student'}\nDate: ${c.created_at}\n\n${c.title}\n\n${c.body}\n\nReply to the student and update the status here (no login needed):\n${site}/${u!.slug}#/respond/${c.code}/${c.respond_token}`, U + ' CampusVoice');
  await mail(p!.email, `Your ${u!.name} report ${c.code} was sent`,
`Your report "${c.title}" was sent to the ${c.field_name} in-charge.\nTracking ID: ${c.code}\n\nYour private link (read replies and answer back):\n${site}/${u!.slug}#/track/${c.code}/${c.student_token}\n\nKeep this link private. Please do not reply to this e-mail.`, U + ' CampusVoice');
  return ok();
});