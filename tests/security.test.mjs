import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("RLS: private categories, messages, images, admin-only grants and account roles", async () => {
  const db = new PGlite();
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema storage;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant usage on schema public,auth,storage to authenticated,anon;
 grant select,insert,delete on storage.objects to authenticated;
 `);
  const sql = (
    await readFile(
      new URL("../supabase/migrations/001_harbor.sql", import.meta.url),
      "utf8",
    )
  ).replace(
    "alter publication supabase_realtime add table public.messages;",
    "",
  );
  await db.exec(sql);
  await db.exec(
    "grant select,insert,update,delete on public.profiles,public.categories,public.channels,public.category_members,public.messages to authenticated;grant select on all tables in schema public to anon;",
  );
  const admin = "00000000-0000-0000-0000-000000000001",
    user = "00000000-0000-0000-0000-000000000002";
  await db.exec(
    `insert into auth.users values('${admin}'),('${user}');insert into public.profiles values('${admin}','Admin','admin'),('${user}','Member','player');`,
  );
  const { rows: cs } = await db.query(
    "select * from public.channels order by name",
  );
  const permitted = cs[0],
    denied = cs[1];
  await db.exec(
    `insert into category_members values('${user}','${permitted.category_id}');insert into messages(channel_id,user_id,body) values('${permitted.id}','${admin}','visible'),('${denied.id}','${admin}','secret');insert into storage.objects(bucket_id,name) values('chat-images','${denied.id}/${admin}/hidden.webp');set role authenticated;set request.jwt.claim.sub='${user}';`,
  );
  assert.equal((await db.query("select * from categories")).rows.length, 1);
  assert.equal((await db.query("select * from channels")).rows.length, 1);
  assert.deepEqual(
    (await db.query("select body from messages")).rows.map((x) => x.body),
    ["visible"],
  );
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    0,
  );
  await assert.rejects(
    db.exec(
      `insert into messages(channel_id,user_id,body) values('${denied.id}','${user}','intrusion')`,
    ),
    /row-level security/,
  );
  await assert.rejects(
    db.exec(
      `insert into messages(channel_id,user_id,body) values('${permitted.id}','${admin}','spoof')`,
    ),
    /row-level security/,
  );
  await assert.rejects(
    db.exec(
      `insert into category_members values('${user}','${denied.category_id}')`,
    ),
    /row-level security/,
  );
  await assert.rejects(
    db.exec(
      `select set_category_access('${user}',array['${denied.category_id}']::uuid[])`,
    ),
    /Forbidden/,
  );
  await db.exec(`update profiles set role='admin' where id='${user}'`);
  assert.equal(
    (await db.query(`select role from profiles where id='${user}'`)).rows[0]
      .role,
    "player",
  );
  await assert.rejects(
    db.exec(
      `insert into storage.objects(bucket_id,name) values('chat-images','${denied.id}/${user}/bad.webp')`,
    ),
    /row-level security/,
  );
  await assert.rejects(
    db.exec(
      `insert into messages(channel_id,user_id,body,image_path) values('${permitted.id}','${user}','','${permitted.id}/${user}/missing.webp')`,
    ),
    /row-level security/,
  );
  await db.exec(
    `insert into storage.objects(bucket_id,name) values('chat-images','${permitted.id}/${user}/ok.webp');insert into messages(channel_id,user_id,body,image_path) values('${permitted.id}','${user}','','${permitted.id}/${user}/ok.webp')`,
  );
  assert.equal((await db.query("select * from messages")).rows.length, 2);
  await db.exec(
    `delete from storage.objects where name='${permitted.id}/${user}/ok.webp'`,
  );
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    1,
  );
  await db.exec(
    `set request.jwt.claim.sub='${admin}';select set_category_access('${user}',array[]::uuid[]);set request.jwt.claim.sub='${user}';`,
  );
  assert.equal((await db.query("select * from messages")).rows.length, 0);
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    0,
  );
  await db.exec("reset role;set role anon;");
  assert.equal((await db.query("select * from messages")).rows.length, 0);
  await db.close();
});
