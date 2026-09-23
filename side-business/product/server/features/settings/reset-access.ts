/**
 * 入れなくなったときの入り直し（導入を担当した者の作業。画面からは使わない）。
 *
 * オーナーが 1 人だけで、そのオーナーがパスワードを忘れた・やめてしまったときは、画面の中で招待を作れる人がいない。
 * そのときに scripts/reset-access.ts から、その人（か、代わりにオーナーにする人）の招待リンクを作り直す。
 * リンクを開いて新しいパスワードを決めると入れる（受け取りは画面の招待と同じ acceptInviteAction。
 * パスワードを決めた時点で、前のパスワードは使えなくなる。止めていた人は再開になる）。
 *
 * - "server-only" を読み込まない（Next.js の外の tsx から動かすため）。DB は引数でもらう
 * - リンクの値は保存しない。保存はハッシュだけ（画面の招待と同じ）。期限は既定 24 時間
 * - 同じ人への、まだ使われていない古い招待は無効にする
 * - 操作の記録に残す（画面の招待と同じ invite.create に via: "reset-access"。画面の外の作業なので userId は空）
 */
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { randomToken, sha256 } from "~/server/tokens";
import { ROLE_LABEL } from "./format";

export const RESET_DEFAULT_HOURS = 24;
export const RESET_MAX_HOURS = 168;
/** 操作の記録の detail.via（画面の招待と見分ける） */
export const RESET_VIA = "reset-access";

type Role = keyof typeof ROLE_LABEL;
const ROLE_RANK: Record<Role, number> = { owner: 0, staff: 1, viewer: 2 };
const isRole = (r: string): r is Role => r in ROLE_RANK;

export class ResetAccessError extends Error {}

export type AccessUser = {
  id: string;
  tenantId: string;
  tenantName: string;
  name: string;
  email: string;
  role: Role;
  disabled: boolean;
  hasPassword: boolean;
};

/** すべての会社の利用者（パスワードのハッシュは返さない）。会社 → オーナー → 名前の順 */
export async function listAccessUsers(db: Db): Promise<AccessUser[]> {
  const rows = await db
    .select({
      id: s.users.id,
      tenantId: s.users.tenantId,
      tenantName: s.tenants.name,
      name: s.users.name,
      email: s.users.email,
      role: s.users.role,
      disabledAt: s.users.disabledAt,
      passwordHash: s.users.passwordHash,
    })
    .from(s.users)
    .innerJoin(s.tenants, eq(s.tenants.id, s.users.tenantId))
    .orderBy(asc(s.tenants.createdAt), asc(s.tenants.id), asc(s.users.createdAt));
  // 会社の並び（古い順）はそのままに、会社の中だけオーナー → 事務 → 閲覧（sort は安定なので、同じ役割は登録順）
  const tenantOrder = new Map<string, number>();
  for (const r of rows) if (!tenantOrder.has(r.tenantId)) tenantOrder.set(r.tenantId, tenantOrder.size);
  return rows
    .map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      tenantName: r.tenantName,
      name: r.name,
      email: r.email,
      role: isRole(r.role) ? r.role : ("viewer" as const),
      disabled: !!r.disabledAt,
      hasPassword: !!r.passwordHash,
    }))
    .sort((a, b) => tenantOrder.get(a.tenantId)! - tenantOrder.get(b.tenantId)! || ROLE_RANK[a.role] - ROLE_RANK[b.role]);
}

export type ResetAccessInput = {
  email: string;
  /** 同じメールアドレスが複数の会社にあるときに指定する */
  tenantId?: string | null;
  hours?: number;
  /** 招待を受けたらオーナーにする（オーナーがやめてしまったとき、ほかの利用者をオーナーにする） */
  makeOwner?: boolean;
  /** その人のいまのログイン（ほかの端末を含む）をすべて切る */
  signOut?: boolean;
  /** 何をするかだけを返し、書き込まない */
  dryRun?: boolean;
  now?: Date;
};

export type ResetAccessResult = {
  user: AccessUser;
  /** 招待を受けたあとの役割 */
  role: Role;
  /** 招待リンクの値（1 回だけ表示する）。試し（dryRun）のときは null */
  token: string | null;
  expiresAt: Date;
  hours: number;
  /** 無効にした古い招待の数 */
  expiredInvites: number;
  /** 切ったログインの数 */
  signedOut: number;
  /** 受け取ったあとの、その会社の有効なオーナーの数（1 なら、もう 1 人をすすめる） */
  ownersAfter: number;
  dryRun: boolean;
};

/**
 * その人の招待リンクを作り直す。
 * 見つからない・複数の会社にある・期限の時間が範囲の外のときは ResetAccessError。
 */
export async function resetAccess(db: Db, input: ResetAccessInput): Promise<ResetAccessResult> {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new ResetAccessError("入り直す人のメールアドレスを --email で指定してください（--list で一覧を出せます）");
  const hours = input.hours ?? RESET_DEFAULT_HOURS;
  if (!Number.isInteger(hours) || hours < 1 || hours > RESET_MAX_HOURS) {
    throw new ResetAccessError(`--hours は 1〜${RESET_MAX_HOURS} の整数（時間）にしてください`);
  }
  const everyone = await listAccessUsers(db);
  const all = everyone.filter((u) => u.email.toLowerCase() === email);
  const candidates = input.tenantId ? all.filter((u) => u.tenantId === input.tenantId) : all;
  if (candidates.length === 0) {
    throw new ResetAccessError(
      input.tenantId && all.length
        ? `${email} は、指定した会社（${input.tenantId}）の利用者ではありません。--list で確かめてください`
        : `${email} の利用者が見つかりません。--list で利用者の一覧を確かめてください（まだ誰も登録していない会社は、/setup の登録リンクから）`,
    );
  }
  if (candidates.length > 1) {
    throw new ResetAccessError(`${email} は ${candidates.length} 社にあります。--tenant で会社の id を指定してください（--list で確かめられます）`);
  }
  const user = candidates[0];
  const role: Role = input.makeOwner ? "owner" : user.role;
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + hours * 3600_000);

  const owners = everyone.filter((u) => u.tenantId === user.tenantId && u.role === "owner" && !u.disabled && u.id !== user.id).length;
  const ownersAfter = owners + (role === "owner" ? 1 : 0);

  const base = { user, role, hours, expiresAt, ownersAfter };
  if (input.dryRun) return { ...base, token: null, expiredInvites: 0, signedOut: 0, dryRun: true };

  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const expired = await t
      .update(s.invites)
      .set({ expiresAt: now })
      .where(and(eq(s.invites.tenantId, user.tenantId), eq(s.invites.email, user.email), isNull(s.invites.usedAt), gt(s.invites.expiresAt, now)))
      .returning({ tokenHash: s.invites.tokenHash });
    const token = randomToken();
    await t.insert(s.invites).values({ tokenHash: sha256(token), tenantId: user.tenantId, email: user.email, name: user.name, role, expiresAt, createdAt: now });
    const signedOut = input.signOut
      ? (
          await t
            .delete(s.sessions)
            .where(and(eq(s.sessions.tenantId, user.tenantId), eq(s.sessions.userId, user.id)))
            .returning({ id: s.sessions.id })
        ).length
      : 0;
    await t.insert(s.auditLog).values({
      tenantId: user.tenantId,
      userId: null,
      action: "invite.create",
      entity: "invite",
      detail: {
        email: user.email,
        name: user.name,
        role,
        reactivates: user.disabled,
        via: RESET_VIA,
        hours,
        ...(role !== user.role ? { roleBefore: user.role } : {}),
        ...(input.signOut ? { signedOut } : {}),
      },
    });
    return { ...base, token, expiredInvites: expired.length, signedOut, dryRun: false };
  });
}

// ---------------------------------------------------------------- コマンドの引数と表示（純関数）

export type ResetArgs = {
  help: boolean;
  list: boolean;
  email: string | null;
  tenantId: string | null;
  hours: number;
  url: string | null;
  makeOwner: boolean;
  signOut: boolean;
  dryRun: boolean;
};

export const RESET_USAGE = [
  "使い方（導入を担当した者の作業。お客様の DB の接続文字列が要ります）",
  "  利用者の一覧：",
  "    DATABASE_URL='postgres://…' npx tsx scripts/reset-access.ts --list",
  "  入り直しのリンクを作る：",
  "    DATABASE_URL='postgres://…' npx tsx scripts/reset-access.ts --email 社長のメール --url https://お客様のURL",
  "",
  "  --email <メール>   入り直す人（登録してあるメールアドレス）",
  "  --url <https://…>  お客様のしめ日ラボの URL（付けるとリンクをそのまま出します）",
  `  --hours <時間>     リンクの期限（既定 ${RESET_DEFAULT_HOURS} 時間・${RESET_MAX_HOURS} 時間まで）`,
  "  --make-owner       受け取ったらオーナーにする（オーナーがやめてしまったとき、ほかの利用者に）",
  "  --sign-out         その人のいまのログイン（ほかの端末も）をすべて切る（端末をなくした・のぞかれたおそれ）",
  "  --tenant <id>      同じメールアドレスが複数の会社にあるときの会社の id",
  "  --dry-run          何をするかだけを出し、書き込まない",
  "",
  "  DATABASE_URL が無いときは、手元の PGlite（PGLITE_DIR、既定 .data/pglite。開発サーバーを止めてから）を使います。",
].join("\n");

/** 引数を読む。誤りは problems に日本語で */
export function parseResetArgs(argv: readonly string[]): { args: ResetArgs; problems: string[] } {
  const args: ResetArgs = { help: false, list: false, email: null, tenantId: null, hours: RESET_DEFAULT_HOURS, url: null, makeOwner: false, signOut: false, dryRun: false };
  const problems: string[] = [];
  const valueFlags = new Set(["--email", "--tenant", "--hours", "--url"]);
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    // 「--email=a@b」と「--email a@b」のどちらでも
    const inline = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const flag = inline > 0 ? raw.slice(0, inline) : raw;
    let value: string | undefined;
    if (valueFlags.has(flag)) {
      if (inline > 0) value = raw.slice(inline + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) value = argv[++i];
      if (value === undefined || value.trim() === "") {
        problems.push(`${flag} のあとに値を書いてください`);
        continue;
      }
      value = value.trim();
    }
    switch (flag) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--list":
        args.list = true;
        break;
      case "--make-owner":
        args.makeOwner = true;
        break;
      case "--sign-out":
        args.signOut = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--email":
        args.email = value!.toLowerCase();
        break;
      case "--tenant":
        args.tenantId = value!;
        break;
      case "--hours": {
        const n = Number(value!.normalize("NFKC"));
        if (!Number.isInteger(n) || n < 1 || n > RESET_MAX_HOURS) problems.push(`--hours は 1〜${RESET_MAX_HOURS} の整数（時間）にしてください`);
        else args.hours = n;
        break;
      }
      case "--url": {
        const url = normalizeBaseUrl(value!);
        if (!url) problems.push("--url は https:// で始まる、お客様のしめ日ラボの URL にしてください（例：https://shimebi-sample.vercel.app）");
        else args.url = url;
        break;
      }
      default:
        problems.push(`知らない指定です：${raw}（--help で使い方を出せます）`);
    }
  }
  if (!args.help && !args.list && !args.email && problems.length === 0) problems.push("--list か --email のどちらかを指定してください（--help で使い方を出せます）");
  if (args.list && args.email) problems.push("--list と --email は一緒に使えません");
  return { args, problems };
}

/** お客様の URL（https、手元なら http://localhost も）。末尾の / とパスは落とす */
export function normalizeBaseUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
  return u.origin;
}

/** 招待リンク（URL が無ければ、パスだけ） */
export function resetLink(baseUrl: string | null, token: string): string {
  return `${baseUrl ?? ""}/invite/${token}`;
}

const JST = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** --list の表示（パスワードのハッシュ・リンクの値は出さない） */
export function formatAccessList(users: readonly AccessUser[]): string {
  if (users.length === 0) return "利用者がいません（最初のオーナーは /setup の登録リンクから登録します）。";
  const lines: string[] = [];
  let tenant: string | null = null;
  for (const u of users) {
    if (u.tenantId !== tenant) {
      tenant = u.tenantId;
      const owners = users.filter((x) => x.tenantId === u.tenantId && x.role === "owner" && !x.disabled).length;
      if (lines.length) lines.push("");
      lines.push(`${u.tenantName}（会社の id：${u.tenantId}）・有効なオーナー ${owners}人`);
    }
    const marks = [ROLE_LABEL[u.role], u.disabled && "止めています", !u.hasPassword && "パスワード未設定"].filter(Boolean).join("・");
    lines.push(`  ${u.name}  ${u.email}  ${marks}`);
  }
  return lines.join("\n");
}

/** リンクを作ったあとの表示 */
export function formatResetResult(r: ResetAccessResult, baseUrl: string | null): string {
  const who = `${r.user.tenantName} の ${r.user.name}さん（${r.user.email}）`;
  const roleText = r.role === r.user.role ? ROLE_LABEL[r.role] : `${ROLE_LABEL[r.user.role]} → ${ROLE_LABEL[r.role]}`;
  const lines: string[] = [];
  if (r.dryRun) {
    lines.push(`（試し：書き込みはしていません）${who}に、入り直しのリンク（${roleText}・${r.hours} 時間）を作ります。`);
    if (r.user.disabled) lines.push("この人は止めてあります。リンクから入ると再開になります。");
    return lines.join("\n");
  }
  lines.push(`${who}の入り直しのリンクを作りました（${roleText}）。`);
  lines.push(`  ${resetLink(baseUrl, r.token!)}`);
  if (!baseUrl) lines.push("  （先頭に、お客様のしめ日ラボの URL を付けて渡してください。--url を付けると、そのまま出します）");
  lines.push(`期限：${JST.format(r.expiresAt)} まで（${r.hours} 時間）。1 回だけ使えます。リンクはここにしか出ません。`);
  lines.push("ご本人と電話などで確かめてから、ご本人にだけ渡してください（グループの LINE やメールの転送に貼らない）。");
  lines.push("開いて新しいパスワードを決めると入れます。前のパスワードは使えなくなります。");
  if (r.user.disabled) lines.push("この人は止めてありました。リンクから入ると再開になります。");
  if (r.expiredInvites) lines.push(`同じ人への古い招待 ${r.expiredInvites}件は使えなくしました。`);
  if (r.signedOut) lines.push(`いまのログイン ${r.signedOut}か所を切りました。`);
  lines.push("操作の記録に「利用者を招待した」（入り直し）を残しました。");
  if (r.ownersAfter <= 1) lines.push("この会社のオーナーは 1 人だけです。入れたら「設定 → 利用者」で、もう 1 人をオーナーにしておくようおすすめしてください。");
  return lines.join("\n");
}
