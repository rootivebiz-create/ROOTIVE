import { canSeeConfidential, DEFAULT_CONFIDENTIAL_SCOPE, type ConfidentialScope, type Role } from "@/lib/db/types";

/**
 * ユーザーごとの見せる範囲（0029。純関数・サーバーとブラウザの両方で使う）。
 *
 * 誰に何を見せるかは、ロール → 会社の機密の見せ方（confidential_scope）→ **その人だけの上書き**（profiles.access_overrides）で決まる。
 * DB の `can_see_management()` / `can_see_confidential(key)` / `can_export()` と同じ判定をここに持ち、
 * 画面・Server Action・出力の口はすべて `effectiveAccess()` の結果（`SessionContext.access`）を見る。
 *
 * - 代表（owner）は常にすべて。ドライバーは会社の数字を見ない（どちらも上書きは効かない）
 * - 上書きはロールの既定と違うものだけを持つ（「ロールのとおり」はキーを消す）
 */

export const ACCESS_KEYS = ["management", "loans", "cash", "bank_account", "export"] as const;
export type AccessKey = (typeof ACCESS_KEYS)[number];
export type AccessMode = "allow" | "deny";
export type AccessOverrides = Partial<Record<AccessKey, AccessMode>>;
/** 実際に見えるか（true＝見える・できる） */
export type Access = Record<AccessKey, boolean>;

export const ACCESS_LABELS: Record<AccessKey, string> = {
  management: "経営の数字",
  loans: "借入と納税",
  cash: "現金残高と資金繰り",
  bank_account: "ドライバーの振込口座",
  export: "出力（ダウンロード）",
};

export const ACCESS_DESCRIPTIONS: Record<AccessKey, string> = {
  management: "ホーム・資金繰り・案件別・ドライバー別の採算・財務・レポート・AI 相談、会社利益の表示、経営のアラート",
  loans: "財務の画面の借入金・返済予定・決算と税務の期限",
  cash: "資金繰りの残高と入出金の見通し",
  bank_account: "ドライバーの振込先の口座（ドライバーの編集・振込データ）",
  export: "CSV・Excel・PDF・ZIP・バックアップのダウンロード",
};

/** 上書きの選択肢（画面の表示用。"role" は上書きなし） */
export type AccessChoice = "role" | AccessMode;
export const ACCESS_CHOICE_LABELS: Record<AccessChoice, string> = {
  role: "ロールのとおり",
  allow: "見せる",
  deny: "見せない",
};

/** ロールでできること（招待・ロール変更の画面の説明） */
export const ROLE_SUMMARIES: Record<Role, string> = {
  owner: "すべての操作（ユーザー管理・会社設定・締め解除・代表の画面を含む）",
  admin: "稼働・マスタ・管理費・調整の登録と月締め、出力、経営の数字の閲覧",
  clerk: "事務の仕事（稼働・日報・配車・請求・支払・月締め）。経営の数字・振込口座・借入・監査ログは既定で見えない",
  viewer: "閲覧と出力のみ（編集はできない）",
  driver: "自分の今日の報告・予定と休みの申請・締め済み月の支払明細（ドライバーポータル）",
};

const STAFF: Role[] = ["owner", "admin", "clerk", "viewer"];

/** 上書きを設定できるロール（代表とドライバーには効かない） */
export function canCustomizeAccess(role: Role): boolean {
  return role === "admin" || role === "clerk" || role === "viewer";
}

/** profiles.access_overrides（jsonb）を型のある形に直す（知らないキー・値は捨てる） */
export function toAccessOverrides(value: unknown): AccessOverrides {
  const out: AccessOverrides = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const raw = value as Record<string, unknown>;
  for (const key of ACCESS_KEYS) {
    const v = raw[key];
    if (v === "allow" || v === "deny") out[key] = v;
  }
  return out;
}

/** 上書きなしのとき（ロールと会社の見せ方だけ）に見えるか */
export function roleAccess(role: Role, scope: ConfidentialScope = DEFAULT_CONFIDENTIAL_SCOPE): Access {
  const staff = STAFF.includes(role);
  return {
    management: role === "owner" || role === "admin" || role === "viewer",
    loans: canSeeConfidential(role, scope, "loans"),
    cash: canSeeConfidential(role, scope, "cash"),
    bank_account: canSeeConfidential(role, scope, "bank_account"),
    export: staff,
  };
}

/** 実際に見えるか（DB の can_see_management / can_see_confidential / can_export と同じ判定） */
export function effectiveAccess(role: Role, overrides: AccessOverrides | unknown, scope: ConfidentialScope = DEFAULT_CONFIDENTIAL_SCOPE): Access {
  const base = roleAccess(role, scope);
  if (!canCustomizeAccess(role)) return base;
  const ov = toAccessOverrides(overrides);
  const out = { ...base };
  for (const key of ACCESS_KEYS) {
    if (ov[key] === "allow") out[key] = true;
    if (ov[key] === "deny") out[key] = false;
  }
  return out;
}

/**
 * profiles の行（role・access_overrides）から、経営の数字を見せる人か。
 * サービスロールで宛先を選ぶとき（週次サマリー・重大なアラートの LINE）に使う。RLS が効かないのでここで絞る
 */
export function seesManagement(p: { role: Role; access_overrides?: unknown }): boolean {
  return effectiveAccess(p.role, p.access_overrides).management;
}

/** 画面の選択（ロールのとおり／見せる／見せない）から保存する上書きを作る。ロールの既定と同じ選択はキーを持たない */
export function buildAccessOverrides(role: Role, choices: Partial<Record<AccessKey, AccessChoice>>, scope: ConfidentialScope = DEFAULT_CONFIDENTIAL_SCOPE): AccessOverrides {
  if (!canCustomizeAccess(role)) return {};
  const base = roleAccess(role, scope);
  const out: AccessOverrides = {};
  for (const key of ACCESS_KEYS) {
    const c = choices[key];
    if (c === "allow" && !base[key]) out[key] = "allow";
    if (c === "deny" && base[key]) out[key] = "deny";
  }
  return out;
}

/** 上書きの数（一覧の「個別の設定 N 件」） */
export function overrideCount(role: Role, overrides: unknown): number {
  if (!canCustomizeAccess(role)) return 0;
  return Object.keys(toAccessOverrides(overrides)).length;
}

/**
 * 借入・現金は、経営の数字の画面（財務・資金繰り）の中にあるので、経営の数字が見えないと実際には見る場所が無い。
 * 画面で「この設定は効きません」と出すための判定
 */
export function isAccessMoot(key: AccessKey, access: Access): boolean {
  return (key === "loans" || key === "cash") && !access.management;
}

/**
 * スタッフが最初に行く画面（入れない画面から戻すときもここ）。
 * 経営の数字を見ない人はホーム（経営の数字）へ行かない：編集できる人は事務、閲覧者は稼働
 */
export function staffHome(role: Role, access: Pick<Access, "management">, startPage?: string | null): string {
  if (role === "driver") return "/driver";
  const canOffice = role === "owner" || role === "admin" || role === "clerk";
  // 事務員はいつも事務から（経営の数字を見せる設定でも、ホームへはナビから行く）
  if (role === "clerk") return "/office";
  if (!access.management) return canOffice ? "/office" : "/entries";
  if (startPage === "office" && canOffice) return "/office";
  return "/dashboard";
}
