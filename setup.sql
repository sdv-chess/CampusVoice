-- CampusVoice: run this whole file once in Supabase > SQL Editor.
create table universities(id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[A-Z0-9]{3,30}$'), name text not null,
  owner_id uuid not null references auth.users on delete cascade);
create table university_private(university_id uuid primary key references universities on delete cascade, authority_email text);
create table fields(id uuid primary key default gen_random_uuid(),
  university_id uuid not null references universities on delete cascade, name text not null);
create table field_contacts(field_id uuid primary key references fields on delete cascade,
  university_id uuid not null references universities on delete cascade, email text not null);
create table complaints(id uuid primary key default gen_random_uuid(), code text unique not null,
  university_id uuid not null references universities on delete cascade,
  field_id uuid references fields on delete set null, field_name text,
  title text not null, body text not null, shared boolean default false, name text,
  status text default 'Sent to in-charge', note text default '', flag boolean default false,
  emailed boolean default false, created_at timestamptz default now());
create table complaint_private(complaint_id uuid primary key references complaints on delete cascade,
  university_id uuid not null, email text not null);

create function owns(u uuid) returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from universities where id=u and owner_id=auth.uid()) $$;

alter table universities enable row level security; alter table university_private enable row level security;
alter table fields enable row level security; alter table field_contacts enable row level security;
alter table complaints enable row level security; alter table complaint_private enable row level security;

create policy "public read" on universities for select using (true);
create policy "owner edit" on universities for update to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy "owner all" on university_private for all to authenticated using (owns(university_id)) with check (owns(university_id));
create policy "public read" on fields for select using (true);
create policy "owner write" on fields for all to authenticated using (owns(university_id)) with check (owns(university_id));
create policy "owner all" on field_contacts for all to authenticated using (owns(university_id)) with check (owns(university_id));
create policy "owner read" on complaints for select to authenticated using (owns(university_id));
create policy "owner update" on complaints for update to authenticated using (owns(university_id)) with check (owns(university_id));
create policy "owner read" on complaint_private for select to authenticated using (owns(university_id));
-- Students never read complaints directly: they use the two functions below.

create function submit_complaint(p_slug text,p_field uuid,p_title text,p_body text,p_shared boolean,p_name text,p_email text)
returns text language plpgsql security definer set search_path=public as $$
declare u universities; f fields; c text; cid uuid;
begin
  select * into u from universities where slug=upper(p_slug); if not found then raise exception 'Unknown university'; end if;
  select * into f from fields where id=p_field and university_id=u.id; if not found then raise exception 'Unknown area'; end if;
  if length(trim(p_title)) not between 5 and 120 or length(trim(p_body)) not between 20 and 4000
     or p_email !~ '^\S+@\S+\.\S+$' then raise exception 'Invalid input'; end if;
  if f.name ~* 'lost' then p_shared:=true; end if;
  c:='CV-'||upper(substr(md5(random()::text||clock_timestamp()::text),1,6));
  insert into complaints(code,university_id,field_id,field_name,title,body,shared,name)
    values(c,u.id,f.id,f.name,trim(p_title),trim(p_body),p_shared,case when p_shared then left(trim(p_name),80) end) returning id into cid;
  insert into complaint_private values(cid,u.id,lower(trim(p_email)));
  return c;
end $$;

create function track_complaint(p_code text)
returns table(title text,field_name text,status text,note text,created_at timestamptz,university text)
language sql security definer set search_path=public as $$
  select c.title,c.field_name,c.status,c.note,c.created_at,u.name
  from complaints c join universities u on u.id=c.university_id where c.code=upper(trim(p_code)) $$;

-- For YOU (the seller): after creating the buyer's login under Authentication > Users (tick "Auto Confirm"), run e.g.:
--   select new_university('IITDHARWAD','IIT Dharwad','iitdharwad@campusvoice.com');
create function new_university(p_slug text,p_name text,p_owner_email text) returns void
language plpgsql as $$
declare uid uuid; oid uuid;
begin
  select id into oid from auth.users where email=p_owner_email;
  if oid is null then raise exception 'Create the user in Authentication first'; end if;
  insert into universities(slug,name,owner_id) values(upper(p_slug),p_name,oid) returning id into uid;
  insert into fields(university_id,name) select uid,n from unnest(array['Hostel','Mess food','Canteen','Academics','Vending machines','Maintenance','Lost and found']) n;
end $$;
revoke execute on function new_university(text,text,text) from public, anon, authenticated;
