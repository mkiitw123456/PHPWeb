-- Run once in a new Supabase project.
create table public.profiles(id uuid primary key references auth.users on delete cascade,name text not null check(char_length(name) between 1 and 60),role text not null default 'user' check(role in ('admin','user','player')));
create table public.categories(id uuid primary key default gen_random_uuid(),name text not null check(char_length(name) between 1 and 60));
create table public.channels(id uuid primary key default gen_random_uuid(),category_id uuid not null references public.categories on delete cascade,name text not null check(char_length(name) between 1 and 60));
create table public.category_members(user_id uuid references public.profiles on delete cascade,category_id uuid references public.categories on delete cascade,primary key(user_id,category_id));
create table public.messages(id uuid primary key default gen_random_uuid(),channel_id uuid not null references public.channels on delete cascade,user_id uuid not null default auth.uid() references public.profiles,body text not null default '' check(char_length(body)<=4000),image_path text,created_at timestamptz not null default now(),check(length(trim(body))>0 or image_path is not null));
create index channels_category on public.channels(category_id);
create index members_category on public.category_members(category_id,user_id);
create index messages_history on public.messages(channel_id,created_at desc);
create index messages_author on public.messages(user_id);
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin')$$;
create function public.can_category(cid uuid) returns boolean language sql stable security definer set search_path='' as $$select public.is_admin() or exists(select 1 from public.category_members where user_id=(select auth.uid()) and category_id=cid)$$;
create function public.can_channel(cid uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.channels where id=cid and public.can_category(category_id))$$;
create function public.shares_category(uid uuid) returns boolean language sql stable security definer set search_path='' as $$select public.is_admin() or uid=(select auth.uid()) or exists(select 1 from public.category_members a join public.category_members b using(category_id) where a.user_id=(select auth.uid()) and b.user_id=uid) or exists(select 1 from public.profiles where id=uid and role='admin')$$;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.channels enable row level security;
alter table public.category_members enable row level security;
alter table public.messages enable row level security;
-- Explicit privileges also work when Dashboard automatic table exposure is off.
revoke all on public.profiles,public.categories,public.channels,public.category_members,public.messages from anon;
grant select on public.profiles to authenticated;
grant select,insert,update,delete on public.categories,public.channels,public.category_members to authenticated;
grant select,insert on public.messages to authenticated;
create policy profiles_read on public.profiles for select to authenticated using(public.shares_category(id));
create policy categories_read on public.categories for select to authenticated using(public.can_category(id));
create policy categories_admin on public.categories for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy channels_read on public.channels for select to authenticated using(public.can_category(category_id));
create policy channels_admin on public.channels for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy members_read on public.category_members for select to authenticated using(user_id=(select auth.uid()) or public.is_admin());
create policy members_admin on public.category_members for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy messages_read on public.messages for select to authenticated using(public.can_channel(channel_id));
create policy messages_insert on public.messages for insert to authenticated with check(user_id=(select auth.uid()) and public.can_channel(channel_id) and (image_path is null or (image_path like channel_id::text||'/'||auth.uid()::text||'/%' and exists(select 1 from storage.objects where bucket_id='chat-images' and name=image_path))));
-- Server timestamp and basic per-user burst protection, including direct API calls.
create function public.guard_message() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
 if (select count(*) from public.messages where user_id=new.user_id and created_at>now()-interval '10 seconds')>=10 then raise exception '傳送太快，請稍後再試';end if;
 new.created_at=clock_timestamp();return new;end$$;
create trigger guard_message before insert on public.messages for each row execute function public.guard_message();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('chat-images','chat-images',false,3145728,array['image/webp','image/jpeg','image/png']);
-- Use text comparison to avoid unsafe casts on arbitrary object names.
create function public.can_image(path text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.channels where id::text=split_part(path,'/',1) and public.can_category(category_id))$$;
create policy images_read on storage.objects for select to authenticated using(bucket_id='chat-images' and public.can_image(name));
create policy images_insert on storage.objects for insert to authenticated with check(bucket_id='chat-images' and public.can_image(name) and split_part(name,'/',2)=(select auth.uid())::text);
create policy images_delete on storage.objects for delete to authenticated using(bucket_id='chat-images' and split_part(name,'/',2)=(select auth.uid())::text and not exists(select 1 from public.messages where image_path=name));
-- Grants are replaced atomically; only administrators may call this RPC.
create function public.set_category_access(target uuid,category_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.is_admin() then raise exception 'Forbidden';end if;
 if not exists(select 1 from public.profiles where id=target and role<>'admin') then raise exception 'Invalid member';end if;
 delete from public.category_members where user_id=target;
 insert into public.category_members(user_id,category_id) select target,unnest(category_ids) on conflict do nothing;
end$$;
revoke all on function public.set_category_access(uuid,uuid[]) from public,anon;
grant execute on function public.set_category_access(uuid,uuid[]) to authenticated;
-- Webhook delivery claim: service role only, prevents client-triggered duplicates.
create table public.notification_deliveries(message_id uuid primary key references public.messages on delete cascade,status text not null default 'sending',created_at timestamptz not null default now());
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon,authenticated;
alter publication supabase_realtime add table public.messages;
insert into public.categories(name) values('工作空間'),('專案協作');
insert into public.channels(category_id,name) select id,'一般交流' from public.categories where name='工作空間';
insert into public.channels(category_id,name) select id,'交付紀錄' from public.categories where name='專案協作';
