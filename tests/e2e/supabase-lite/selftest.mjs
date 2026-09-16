#!/usr/bin/env node
/**
 * supabase-lite の単体検証（Playwright を使わない）
 *
 * @supabase/supabase-js でサーバーに接続し、アプリが使う API（Auth / PostgREST / RPC / Storage）が
 * 期待どおりに動くことを assert する。DB を作り直し、専用ポートでサーバーを起動して検証し、終了時に止める。
 *
 *   node tests/e2e/supabase-lite/selftest.mjs
 *
 * 環境変数:
 *   SELFTEST_PORT     サーバーのポート（既定 54325）
 *   SELFTEST_DB       DB 名（既定 rootive_selftest）
 *   SELFTEST_EXTERNAL=1  既に起動しているサーバー（SELFTEST_URL、既定 http://127.0.0.1:54321）を使い、DB は作り直さない
 */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const PORT = Number(process.env.SELFTEST_PORT ?? 54325);
const DBNAME = process.env.SELFTEST_DB ?? "rootive_selftest";
const PG_PORT = process.env.TEST_PG_PORT ?? "54329";
const EXTERNAL = process.env.SELFTEST_EXTERNAL === "1";
const URL_BASE = EXTERNAL ? (process.env.SELFTEST_URL ?? "http://127.0.0.1:54321") : `http://127.0.0.1:${PORT}`;
const STORAGE_DIR = path.join(ROOT, "tests/e2e/.storage-selftest");

let dbUrl = process.env.TEST_DATABASE_URL ? `${process.env.TEST_DATABASE_URL.replace(/\/[^/]*$/, "")}/${DBNAME}` : `postgresql://postgres@127.0.0.1:${PG_PORT}/${DBNAME}`;
let child = null;
let passed = 0;

function step(name) {
  passed++;
  console.log(`  ok ${passed}: ${name}`);
}

function sql(query) {
  return execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", query], { encoding: "utf8" }).trim();
}

async function waitFor(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // 起動待ち
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`起動待ちがタイムアウトしました: ${url}`);
}

async function startServer() {
  const out = execFileSync("bash", [path.join(HERE, "prepare-db.sh"), DBNAME], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const m = /DB_URL=(.+)/.exec(out);
  if (m) dbUrl = m[1].trim();
  fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
  child = spawn(process.execPath, [path.join(HERE, "server.mjs"), "--port", String(PORT), "--db", dbUrl, "--storage", STORAGE_DIR], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "inherit"],
  });
  child.stdout.on("data", (d) => {
    if (process.env.SELFTEST_VERBOSE) process.stdout.write(d);
  });
  await waitFor(`${URL_BASE}/health`);
}

function stopServer() {
  if (child) {
    child.kill("SIGTERM");
    child = null;
  }
  if (!EXTERNAL) fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
}

const clientOpts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

async function main() {
  if (!EXTERNAL) await startServer();
  const keys = await (await fetch(`${URL_BASE}/__test/keys`)).json();
  assert.ok(keys.anon && keys.service_role, "鍵を取得できること");
  const printed = execFileSync(process.execPath, [path.join(HERE, "server.mjs"), "--print-keys"], { encoding: "utf8" });
  assert.ok(printed.includes(`ANON_KEY=${keys.anon}`) && printed.includes(`SERVICE_ROLE_KEY=${keys.service_role}`), "--print-keys の鍵がサーバーの鍵と一致すること（決定的）");
  step("鍵（anon / service_role）");

  const admin = createClient(URL_BASE, keys.service_role, clientOpts);

  // ---- 会社と招待（service_role は RLS をバイパス） ----
  const { data: company, error: cErr } = await admin.from("companies").insert({ name: "株式会社ROOTIVE" }).select().single();
  assert.equal(cErr, null, cErr?.message);
  assert.equal(company.name, "株式会社ROOTIVE");
  assert.equal(typeof company.default_royalty_rate, "number", "numeric は number で返ること");
  assert.equal(company.default_royalty_rate, 0.1);
  assert.equal(typeof company.created_at, "string");
  step("service_role で companies を insert().select().single()");

  // (a) 招待なしで createUser → エラー
  {
    const { data, error } = await admin.auth.admin.createUser({ email: "nobody@example.com", email_confirm: true });
    assert.ok(error, "招待が無いユーザーの作成は失敗すること");
    assert.equal(data.user, null);
    assert.match(error.message, /Database error creating new user/);
    step("招待なしの createUser はエラー（Database error creating new user）");
  }

  const ownerEmail = "owner@example.com";
  const { error: invErr } = await admin.from("invitations").insert([
    { company_id: company.id, email: ownerEmail, role: "owner", display_name: "オーナー" },
    { company_id: company.id, email: "viewer@example.com", role: "viewer", display_name: "閲覧者", expires_at: new Date(Date.now() + 86400000).toISOString() },
  ]);
  assert.equal(invErr, null, invErr?.message);
  step("配列 insert（キーが揃っていない行は DEFAULT）");

  // (a) 招待ありで createUser → 成功（トリガーで profiles が作られる）
  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email: ownerEmail, email_confirm: true, user_metadata: { display_name: "オーナー" } });
  assert.equal(createErr, null, createErr?.message);
  assert.equal(created.user.email, ownerEmail);
  assert.equal(created.user.user_metadata.display_name, "オーナー");
  const { data: prof } = await admin.from("profiles").select("*").eq("id", created.user.id).maybeSingle();
  assert.equal(prof?.role, "owner", "トリガーで profiles が作られること");
  step("招待ありの createUser → profiles 自動作成");

  {
    const { data: dup, error: dupErr } = await admin.auth.admin.createUser({ email: ownerEmail });
    assert.ok(dupErr && dup.user === null);
    assert.equal(dupErr.code, "email_exists");
    step("重複メールの createUser は email_exists");
  }

  // listUsers / getUserById / updateUserById
  {
    const { data: list, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
    assert.equal(error, null, error?.message);
    assert.ok(list.users.some((u) => u.email === ownerEmail));
    const { data: byId } = await admin.auth.admin.getUserById(created.user.id);
    assert.equal(byId.user.id, created.user.id);
    const { data: upd, error: updErr } = await admin.auth.admin.updateUserById(created.user.id, { password: "password123", user_metadata: { nick: "kanta" } });
    assert.equal(updErr, null, updErr?.message);
    assert.equal(upd.user.user_metadata.nick, "kanta");
    step("admin.listUsers / getUserById / updateUserById");
  }

  // (b) generateLink → verifyOtp でセッション取得
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: ownerEmail });
  assert.equal(linkErr, null, linkErr?.message);
  assert.ok(link.properties.hashed_token, "hashed_token が返ること");
  assert.equal(link.properties.verification_type, "magiclink");
  assert.equal(link.user.email, ownerEmail);
  const owner = createClient(URL_BASE, keys.anon, clientOpts);
  const { data: verified, error: verifyErr } = await owner.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  assert.equal(verifyErr, null, verifyErr?.message);
  assert.ok(verified.session?.access_token && verified.session?.refresh_token);
  assert.equal(verified.user.email, ownerEmail);
  step("generateLink → verifyOtp でセッション");

  {
    const { error } = await owner.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
    assert.ok(error, "使用済みトークンは拒否されること");
    assert.equal(error.code, "otp_expired");
    step("使用済み token_hash は otp_expired");
  }

  {
    const { data, error } = await owner.auth.getUser();
    assert.equal(error, null, error?.message);
    assert.equal(data.user.id, created.user.id);
    assert.ok(data.user.last_sign_in_at, "last_sign_in_at が更新されること");
    step("getUser（Bearer）");
  }

  {
    const { data, error } = await owner.auth.refreshSession();
    assert.equal(error, null, error?.message);
    assert.ok(data.session?.access_token);
    step("refresh_token でセッション更新");
  }

  {
    const pw = createClient(URL_BASE, keys.anon, clientOpts);
    const { data, error } = await pw.auth.signInWithPassword({ email: ownerEmail, password: "password123" });
    assert.equal(error, null, error?.message);
    assert.equal(data.user.email, ownerEmail);
    const { error: bad } = await pw.auth.signInWithPassword({ email: ownerEmail, password: "wrong" });
    assert.ok(bad && /Invalid login credentials/.test(bad.message));
    const { error: updErr } = await pw.auth.updateUser({ password: "newpassword123", data: { display_name: "オーナー2" } });
    assert.equal(updErr, null, updErr?.message);
    const { error: relogin } = await pw.auth.signInWithPassword({ email: ownerEmail, password: "newpassword123" });
    assert.equal(relogin, null, relogin?.message);
    await pw.auth.signOut();
    step("signInWithPassword / updateUser / signOut");
  }

  {
    const anon = createClient(URL_BASE, keys.anon, clientOpts);
    const { error } = await anon.auth.signInWithOtp({ email: ownerEmail, options: { shouldCreateUser: false } });
    assert.equal(error, null, error?.message);
    const otp = await (await fetch(`${URL_BASE}/__test/last-otp?email=${encodeURIComponent(ownerEmail)}`)).json();
    assert.equal(otp.type, "magiclink");
    const { data, error: vErr } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: otp.token_hash });
    assert.equal(vErr, null, vErr?.message);
    assert.ok(data.session);
    const { error: unknownErr } = await anon.auth.signInWithOtp({ email: "unknown@example.com", options: { shouldCreateUser: false } });
    assert.equal(unknownErr, null, "存在しないメールでも 200");
    const r = await fetch(`${URL_BASE}/__test/last-otp?email=unknown@example.com`);
    assert.equal(r.status, 404);
    step("signInWithOtp → /__test/last-otp → verifyOtp");
  }

  {
    const anon = createClient(URL_BASE, keys.anon, clientOpts);
    const { error } = await anon.auth.resetPasswordForEmail(ownerEmail);
    assert.equal(error, null, error?.message);
    const otp = await (await fetch(`${URL_BASE}/__test/last-otp?email=${encodeURIComponent(ownerEmail)}`)).json();
    assert.equal(otp.type, "recovery");
    const { data, error: vErr } = await anon.auth.verifyOtp({ type: "recovery", token_hash: otp.token_hash });
    assert.equal(vErr, null, vErr?.message);
    assert.ok(data.session);
    step("resetPasswordForEmail → recovery の verifyOtp");
  }

  // (c) 認証ユーザーでの CRUD・RPC・ビュー
  const { data: seed, error: seedErr } = await owner.rpc("seed_initial_data");
  assert.equal(seedErr, null, seedErr?.message);
  assert.equal(seed.drivers, 10);
  assert.equal(seed.entries, 10);
  step("rpc(seed_initial_data)（jsonb 戻り値）");

  {
    const { data, error, count } = await owner.from("drivers").select("*", { count: "exact" }).eq("company_id", company.id).order("sort_order").order("name");
    assert.equal(error, null, error?.message);
    assert.equal(count, 10);
    assert.equal(data.length, 10);
    assert.equal(data[0].name, "相曽慧");
    assert.equal(typeof data[0].royalty_rate, "number");
    assert.equal(data[0].royalty_rate, 0.1);
    assert.equal(data[0].mgmt_fee, 15000);
    assert.equal(typeof data[0].is_active, "boolean");
    step("select { count: exact } / 複数 order / numeric → number");
  }

  {
    const { count, error } = await owner.from("work_entries").select("*", { count: "exact", head: true });
    assert.equal(error, null, error?.message);
    assert.equal(count, 10);
    step("head: true の count");
  }

  {
    const { data, error } = await owner.from("drivers").select("id, name").in("name", ["相曽慧", "川島幹太"]).order("name", { ascending: false });
    assert.equal(error, null, error?.message);
    assert.deepEqual(
      data.map((d) => d.name),
      ["相曽慧", "川島幹太"].sort().reverse(),
    );
    step("in() / order desc / 列指定 select");
  }

  {
    const { data, error } = await owner.from("drivers").select("name").order("sort_order").range(2, 4);
    assert.equal(error, null, error?.message);
    assert.deepEqual(
      data.map((d) => d.name),
      ["沼田基", "今井皇輝", "石田泰典"],
    );
    step("range()");
  }

  {
    const { data, error } = await owner.from("drivers").select("name").or(`name.eq.相曽慧,name.eq.Temu`).eq("company_id", company.id);
    assert.equal(error, null, error?.message);
    assert.deepEqual(
      data.map((d) => d.name),
      ["相曽慧"],
    );
    const { data: like } = await owner.from("projects").select("name").ilike("name", "%amazon%").order("name");
    assert.deepEqual(
      like.map((p) => p.name),
      ["三郷Amazon", "川口領家Amazon"],
    );
    const { data: isNull } = await owner.from("drivers").select("name").is("rounding_mode", null).eq("name", "相曽慧");
    assert.equal(isNull.length, 1);
    const { data: notNull } = await owner.from("drivers").select("name").not("rounding_mode", "is", null);
    assert.equal(notNull.length, 0);
    const { data: neq } = await owner.from("drivers").select("name").neq("name", "相曽慧").gte("sort_order", 9);
    assert.equal(neq.length, 2);
    step("or() / ilike / is null / not.is.null / neq / gte");
  }

  {
    const { data, error } = await owner.from("drivers").select("*").eq("name", "存在しない").maybeSingle();
    assert.equal(error, null, "maybeSingle の 0 行はエラーにならない");
    assert.equal(data, null);
    const { data: one, error: oneErr } = await owner.from("drivers").select("*").eq("name", "相曽慧").single();
    assert.equal(oneErr, null, oneErr?.message);
    assert.equal(one.name, "相曽慧");
    const { error: zeroErr } = await owner.from("drivers").select("*").eq("name", "存在しない").single();
    assert.ok(zeroErr);
    assert.equal(zeroErr.code, "PGRST116");
    step("maybeSingle（0 行 → null）/ single（0 行 → PGRST116）");
  }

  {
    const { data, error } = await owner.from("v_month_summary").select("*").eq("company_id", company.id).eq("month", "2026-09-01").maybeSingle();
    assert.equal(error, null, error?.message);
    assert.ok(data, "v_month_summary に 2026-09 があること");
    assert.equal(data.month, "2026-09-01", "date は YYYY-MM-DD 文字列");
    assert.equal(data.bill, 2559573, "§2.6 の合計売上");
    assert.ok(Math.abs(data.profit - 652490.3) < 0.01, `利益 ${data.profit}`);
    assert.ok(Math.abs(data.payout - 1907082.7) < 0.01, `支払 ${data.payout}`);
    assert.equal(data.status, "open");
    step("v_month_summary の合計（売上 2,559,573／利益 652,490.3／支払 1,907,082.7）");
  }

  {
    const { data, error } = await owner.from("v_driver_month_summary").select("driver_name, payout, driver_profit").eq("month", "2026-09-01").order("driver_sort_order");
    assert.equal(error, null, error?.message);
    const aiso = data.find((d) => d.driver_name === "相曽慧");
    assert.equal(aiso.payout, 396643);
    assert.equal(aiso.driver_profit, 86882);
    step("v_driver_month_summary（相曽慧 支払 396,643／利益 86,882）");
  }

  const { data: newDriver, error: insErr } = await owner.from("drivers").insert({ company_id: company.id, name: "テスト太郎", royalty_rate: 0.1, mgmt_fee: 15000 }).select().single();
  assert.equal(insErr, null, insErr?.message);
  assert.equal(newDriver.name, "テスト太郎");
  step("insert().select().single()");

  {
    const { data, error } = await owner.from("drivers").update({ memo: "更新済み", mgmt_fee: 12000 }).eq("id", newDriver.id).select();
    assert.equal(error, null, error?.message);
    assert.equal(data.length, 1);
    assert.equal(data[0].memo, "更新済み");
    assert.equal(data[0].mgmt_fee, 12000);
    const { error: noRep } = await owner.from("drivers").update({ memo: "更新2" }).eq("id", newDriver.id);
    assert.equal(noRep, null);
    step("update().eq().select() / return=minimal");
  }

  {
    const { error: dupErr } = await owner.from("drivers").insert({ company_id: company.id, name: "テスト太郎" });
    assert.ok(dupErr);
    assert.equal(dupErr.code, "23505");
    step("一意制約違反は code 23505");
  }

  {
    const item = (await owner.from("project_items").select("id").eq("name", "標準").limit(1).single()).data;
    const { error } = await owner.from("driver_pay_overrides").upsert({ driver_id: newDriver.id, project_item_id: item.id, pay_rate: 20000 }, { onConflict: "driver_id,project_item_id" });
    assert.equal(error, null, error?.message);
    const { data, error: e2 } = await owner
      .from("driver_pay_overrides")
      .upsert({ driver_id: newDriver.id, project_item_id: item.id, pay_rate: 21000 }, { onConflict: "driver_id,project_item_id" })
      .select();
    assert.equal(e2, null, e2?.message);
    assert.equal(data[0].pay_rate, 21000);
    const { count } = await owner.from("driver_pay_overrides").select("*", { count: "exact", head: true }).eq("driver_id", newDriver.id);
    assert.equal(count, 1, "upsert で行が増えないこと");
    const { error: e3 } = await owner.from("driver_pay_overrides").upsert({ driver_id: newDriver.id, project_item_id: item.id, pay_rate: 99 }, { onConflict: "driver_id,project_item_id", ignoreDuplicates: true });
    assert.equal(e3, null);
    const { data: after } = await owner.from("driver_pay_overrides").select("pay_rate").eq("driver_id", newDriver.id).single();
    assert.equal(after.pay_rate, 21000, "ignoreDuplicates は既存行を変更しない");
    step("upsert onConflict（merge / ignore）");
  }

  {
    const { data, error } = await owner.from("drivers").delete().eq("id", newDriver.id).select("id");
    assert.equal(error, null, error?.message);
    assert.equal(data.length, 1);
    const { data: gone } = await owner.from("drivers").select("id").eq("id", newDriver.id).maybeSingle();
    assert.equal(gone, null);
    step("delete().eq().select()");
  }

  {
    const { data, error } = await owner.rpc("copy_previous_month", { p_month: "2026-10-01" });
    assert.equal(error, null, error?.message);
    assert.equal(data, 10, "整数の戻り値");
    const { data: again } = await owner.rpc("copy_previous_month", { p_month: "2026-10-01" });
    assert.equal(again, 0, "冪等");
    const { data: defaults, error: dErr } = await owner.rpc("entry_defaults", {
      p_driver_id: (await owner.from("drivers").select("id").eq("name", "吉田雅一").single()).data.id,
      p_project_item_id: (await owner.from("project_items").select("id").eq("bill_rate", 23025).eq("pay_rate", 21780).single()).data.id,
    });
    assert.equal(dErr, null, dErr?.message);
    assert.equal(defaults.length, 1, "returns table は配列");
    assert.equal(defaults[0].pay_rate, 21960, "個別単価が反映されること");
    const { data: single, error: sErr } = await owner
      .rpc("entry_defaults", { p_driver_id: (await owner.from("drivers").select("id").eq("name", "相曽慧").single()).data.id, p_project_item_id: (await owner.from("project_items").select("id").eq("bill_rate", 8500).single()).data.id })
      .single();
    assert.equal(sErr, null, sErr?.message);
    assert.equal(single.bill_rate, 8500);
    const { data: isAdmin } = await owner.rpc("is_admin");
    assert.equal(isAdmin, true, "boolean の戻り値");
    const { data: inv, error: invRpcErr } = await owner.rpc("create_invitation", { p_email: "driver1@example.com", p_role: "viewer", p_display_name: "ドライバー1" });
    assert.equal(invRpcErr, null, invRpcErr?.message);
    assert.ok(inv && typeof inv.token === "string", "複合型（単一行）の戻り値はオブジェクト");
    const { data: backup, error: bErr } = await owner.rpc("export_backup");
    assert.equal(bErr, null, bErr?.message);
    assert.equal(backup.work_entries.length, 20);
    const { error: viewerRpc } = await owner.rpc("reopen_month", { p_month: "2026-08-01" });
    assert.ok(viewerRpc && viewerRpc.code === "P0001", "RAISE EXCEPTION は P0001 で本文に message");
    step("rpc: integer / table / single / boolean / 複合型 / jsonb / エラー");
  }

  // (d) 締め済み月への update → MONTH_CLOSED
  {
    const { data: snap, error } = await owner.rpc("close_month", { p_month: "2026-09-01", p_note: "テスト締め" });
    assert.equal(error, null, error?.message);
    assert.equal(snap.summary.bill, 2559573);
    const entry = (await owner.from("work_entries").select("id").eq("month", "2026-09-01").limit(1).single()).data;
    const { error: closedErr } = await owner.from("work_entries").update({ qty: 1 }).eq("id", entry.id);
    assert.ok(closedErr, "締め済み月の更新は失敗すること");
    assert.equal(closedErr.hint, "MONTH_CLOSED");
    assert.equal(closedErr.code, "P0001");
    const { error: delErr } = await owner.from("work_entries").delete().eq("id", entry.id);
    assert.equal(delErr?.hint, "MONTH_CLOSED");
    const { data: closed } = await owner.from("month_closings").select("status").eq("month", "2026-09-01").single();
    assert.equal(closed.status, "closed");
    const { error: reopenErr } = await owner.rpc("reopen_month", { p_month: "2026-09-01" });
    assert.equal(reopenErr, null, reopenErr?.message);
    step("close_month → 締め済み月の update/delete は hint MONTH_CLOSED → reopen_month（void）");
  }

  // (e) viewer で insert → RLS エラー
  {
    const { data: vUser, error: vErr } = await admin.auth.admin.createUser({ email: "viewer@example.com", email_confirm: true });
    assert.equal(vErr, null, vErr?.message);
    const { data: vLink } = await admin.auth.admin.generateLink({ type: "magiclink", email: "viewer@example.com" });
    const viewer = createClient(URL_BASE, keys.anon, clientOpts);
    const { error: vv } = await viewer.auth.verifyOtp({ type: "magiclink", token_hash: vLink.properties.hashed_token });
    assert.equal(vv, null, vv?.message);
    const { data: canRead, error: readErr } = await viewer.from("drivers").select("id", { count: "exact" });
    assert.equal(readErr, null, readErr?.message);
    assert.equal(canRead.length, 10, "viewer は閲覧できる");
    const { error: insErr2 } = await viewer.from("drivers").insert({ company_id: company.id, name: "不正追加" });
    assert.ok(insErr2, "viewer の insert は拒否されること");
    assert.equal(insErr2.code, "42501");
    const { data: updData, error: updErr2 } = await viewer.from("drivers").update({ memo: "x" }).eq("name", "相曽慧").select();
    assert.equal(updErr2, null);
    assert.equal(updData.length, 0, "viewer の update は 0 行（RLS）");
    const { error: rpcErr } = await viewer.rpc("copy_previous_month", { p_month: "2026-11-01" });
    assert.equal(rpcErr?.hint, "FORBIDDEN");
    const { data: vProfile } = await viewer.from("profiles").select("role").eq("id", vUser.user.id).single();
    assert.equal(vProfile.role, "viewer");
    step("viewer: select 可 / insert は 42501 / update は 0 行 / rpc は FORBIDDEN");
  }

  // (f) Storage
  {
    const content = JSON.stringify({ hello: "world", month: "2026-09" });
    const objectPath = `${company.id}/2026-09_test.json`;
    const { data: up, error: upErr } = await admin.storage.from("backups").upload(objectPath, content, { contentType: "application/json", upsert: false });
    assert.equal(upErr, null, upErr?.message);
    assert.equal(up.path, objectPath);
    assert.equal(up.fullPath, `backups/${objectPath}`);
    const { error: dupUp } = await admin.storage.from("backups").upload(objectPath, content, { contentType: "application/json" });
    assert.ok(dupUp && /already exists/i.test(dupUp.message), "上書きは x-upsert が無ければ拒否");
    const { error: upsertErr } = await admin.storage.from("backups").upload(objectPath, content + "\n", { contentType: "application/json", upsert: true });
    assert.equal(upsertErr, null, upsertErr?.message);

    const { data: signed, error: signErr } = await admin.storage.from("backups").createSignedUrl(objectPath, 60);
    assert.equal(signErr, null, signErr?.message);
    assert.ok(signed.signedUrl.startsWith(`${URL_BASE}/storage/v1/object/sign/backups/`), signed.signedUrl);
    const fetched = await fetch(signed.signedUrl);
    assert.equal(fetched.status, 200);
    assert.equal(await fetched.text(), content + "\n");
    assert.match(fetched.headers.get("content-type") ?? "", /application\/json/);

    const { data: blob, error: dlErr } = await admin.storage.from("backups").download(objectPath);
    assert.equal(dlErr, null, dlErr?.message);
    assert.equal(await blob.text(), content + "\n");

    const { data: list, error: listErr } = await admin.storage.from("backups").list(company.id, { limit: 100, sortBy: { column: "name", order: "asc" } });
    assert.equal(listErr, null, listErr?.message);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "2026-09_test.json");
    assert.equal(list[0].metadata.mimetype, "application/json");
    const { data: rootList } = await admin.storage.from("backups").list("");
    assert.equal(rootList[0].name, company.id, "フォルダ階層");
    assert.equal(rootList[0].id, null);

    // owner（authenticated）は自社フォルダなら閲覧できる（RLS）。他社フォルダは見えない
    const { data: ownerList, error: ownerListErr } = await owner.storage.from("backups").list(company.id);
    assert.equal(ownerListErr, null, ownerListErr?.message);
    assert.equal(ownerList.length, 1);
    const { error: ownerDlErr } = await owner.storage.from("backups").download(objectPath);
    assert.equal(ownerDlErr, null, ownerDlErr?.message);
    const { error: otherErr } = await owner.storage.from("backups").upload("other-company/x.json", "{}", { contentType: "application/json" });
    assert.ok(otherErr, "他社フォルダへの upload は RLS で拒否");
    const { error: missing } = await admin.storage.from("backups").download("none/none.json");
    assert.ok(missing);
    const { data: buckets, error: bucketsErr } = await admin.storage.listBuckets();
    assert.equal(bucketsErr, null, bucketsErr?.message);
    assert.ok(buckets.some((b) => b.id === "backups"));
    const { data: removed, error: rmErr } = await admin.storage.from("backups").remove([objectPath]);
    assert.equal(rmErr, null, rmErr?.message);
    assert.equal(removed.length, 1);
    step("storage: upload / upsert / createSignedUrl / download / list / RLS / remove");
  }

  // 招待リンクログインの流れ（lib/actions/auth.ts の acceptInviteAction と同じ手順）
  {
    const email = "admin@example.com";
    await admin.from("invitations").insert({ company_id: company.id, email, role: "admin", display_name: "管理者" });
    const { data: u, error: uErr } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { display_name: "管理者" } });
    assert.equal(uErr, null, uErr?.message);
    const { data: p } = await admin.from("profiles").select("id").eq("id", u.user.id).maybeSingle();
    assert.ok(p);
    const { data: l } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const c = createClient(URL_BASE, keys.anon, clientOpts);
    const { error: e } = await c.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: "magiclink" });
    assert.equal(e, null, e?.message);
    const { data: me } = await c.from("profiles").select("role, display_name").eq("id", u.user.id).single();
    assert.equal(me.role, "admin");
    assert.equal(me.display_name, "管理者");
    const { error: applyErr } = await admin.rpc("apply_invitation", { p_user_id: u.user.id, p_email: email });
    assert.equal(applyErr, null, applyErr?.message);
    step("招待リンクログインの流れ（createUser → generateLink → verifyOtp → profiles）");
  }

  // 埋め込みリソースは 400
  {
    const { error } = await owner.from("work_entries").select("id, drivers(name)").limit(1);
    assert.ok(error && /埋め込み/.test(error.message));
    step("埋め込みリソースは明示的なエラー");
  }

  const n = Number(sql("select count(*) from public.audit_logs"));
  assert.ok(n > 0, "監査ログがトリガーで記録されていること");
  step(`監査ログ ${n} 件`);

  console.log(`\nsupabase-lite selftest: ${passed} 件すべて通りました`);
}

main()
  .then(() => {
    stopServer();
    process.exit(0);
  })
  .catch((e) => {
    console.error("\nselftest 失敗:", e);
    stopServer();
    process.exit(1);
  });
