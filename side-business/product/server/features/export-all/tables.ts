import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as s from "~/db/schema";

/**
 * 全データの書き出し・読み戻しで扱う表（読み戻す順に並べる）。
 * - 参照される表を先に（会社 → 利用者 → 台帳 → 取り込み → 稼働 → 明細 → …）
 * - 締めた月の守り（DB の引き金）に止められないよう、month_closes はいちばん最後に入れる
 * - 表を足したら、ここにも足す（足し忘れはテストが見つける）
 */

export type TableSpec = {
  /** DB の表の名前（CSV のファイル名にも使う） */
  name: string;
  table: PgTable;
  /** 日本語の名前と、README に書く説明 */
  label: string;
  about: string;
  /** 並べる列（DB の列の名前） */
  order: string[];
  /** 書き出さない列（パスワードのハッシュなど） */
  omit?: string[];
  /** 読み戻すか（招待は、リンクの値を書き出さないので読み戻さない） */
  restore: boolean;
  /** 読み戻すときに id を振り直す（操作の記録の通し番号は、移した先の番号と重なるため） */
  renumber?: boolean;
  /** 会社の表そのもの（tenant_id ではなく id で絞る） */
  self?: boolean;
};

export const EXPORT_TABLES: TableSpec[] = [
  {
    name: "tenants",
    table: s.tenants,
    label: "会社",
    about: "会社の名前・登録番号・消費税の計算方法・端数の扱い・締め日と支払日・細かい設定（settings：振込依頼人など）。1 行だけです。",
    order: ["id"],
    restore: true,
    self: true,
  },
  {
    name: "users",
    table: s.users,
    label: "利用者",
    about: "しめ日ラボを使う人（名前・メール・役割）。パスワードは書き出していません（読み戻したあとは、招待のリンクから決め直します）。",
    order: ["created_at", "id"],
    omit: ["password_hash"],
    restore: true,
  },
  {
    name: "invites",
    table: s.invites,
    label: "招待",
    about: "利用者の招待の記録（宛先・役割・期限・使った日時）。リンクの値は書き出さないため、読み戻しません。",
    order: ["created_at", "email"],
    omit: ["token_hash"],
    restore: false,
  },
  {
    name: "drivers",
    table: s.drivers,
    label: "ドライバー",
    about: "ドライバーの台帳（番号・名前・インボイスの登録・振込先の口座・取引条件を明示した日・委託の開始と終了 など）。",
    order: ["created_at", "id"],
    restore: true,
  },
  { name: "clients", table: s.clients, label: "元請", about: "元請（荷主）の名前・別名・締め日。", order: ["created_at", "id"], restore: true },
  {
    name: "projects",
    table: s.projects,
    label: "案件",
    about: "案件（元請 × 仕事の種類）と、標準の受注単価・支払単価（税抜）・数量の単位。",
    order: ["created_at", "id"],
    restore: true,
  },
  {
    name: "rate_overrides",
    table: s.rateOverrides,
    label: "ドライバーごとの単価",
    about: "標準と違う支払単価のドライバーと、その単価で合意した日。",
    order: ["created_at", "id"],
    restore: true,
  },
  {
    name: "deduction_rules",
    table: s.deductionRules,
    label: "控除のルール",
    about: "ロイヤリティ・管理費・リースなどの控除（率・定額・数量あたり）と、書面での合意の有無・合意した日・根拠。",
    order: ["sort", "created_at", "id"],
    restore: true,
  },
  {
    name: "mapping_profiles",
    table: s.mappingProfiles,
    label: "取り込みの列の対応",
    about: "Excel の取り込みで覚えた「どの列が何か」の対応。",
    order: ["updated_at", "id"],
    restore: true,
  },
  {
    name: "import_batches",
    table: s.importBatches,
    label: "取り込みの記録",
    about: "Excel・CSV を取り込んだ記録（ファイル名・月・行数・状態・中身のまとめ）。元のファイルそのものは入っていません。",
    order: ["created_at", "id"],
    restore: true,
  },
  {
    name: "work_entries",
    table: s.workEntries,
    label: "稼働",
    about: "ドライバー × 案件 × 月の数量（日付がある行は日ごと）。どの取り込みから入ったかも残ります。",
    order: ["month", "created_at", "id"],
    restore: true,
  },
  {
    name: "adjustments",
    table: s.adjustments,
    label: "調整",
    about: "その月だけの足し引き（立替の精算・事故の負担など）。＋は支払を増やし、−は減らします。",
    order: ["month", "created_at", "id"],
    restore: true,
  },
  {
    name: "statements",
    table: s.statements,
    label: "支払明細（いまの版）",
    about: "ドライバーごと・月ごとの支払明細のいまの版。snapshot に明細の中身（行・控除・調整・税・振込額・記載事項）がそのまま入っています。",
    order: ["month", "driver_id"],
    restore: true,
  },
  {
    name: "statement_versions",
    table: s.statementVersions,
    label: "支払明細（すべての版）",
    about: "明細を作り直すたびに残した、すべての版の写しとハッシュ。中身は statement_versions/ フォルダーにも 1 版 1 ファイルで入っています。",
    order: ["month", "statement_id", "version"],
    restore: true,
  },
  {
    name: "statement_confirmations",
    table: s.statementConfirmations,
    label: "ドライバーの確認",
    about: "ドライバーが「確認しました」を押した記録（どの版・どのハッシュ・そのときの振込額・日時）。",
    order: ["created_at", "id"],
    restore: true,
  },
  {
    name: "statement_messages",
    table: s.statementMessages,
    label: "明細の質問と返事",
    about: "明細についてのドライバーからの質問と、事務からの返事・解決にした日時。",
    order: ["created_at", "id"],
    restore: true,
  },
  {
    name: "terms_records",
    table: s.termsRecords,
    label: "取引条件の記録",
    about: "取引条件を明示した記録（版・明示した日・中身の写し・送った日時・ドライバーが受け取った日時）。",
    order: ["driver_id", "version"],
    restore: true,
  },
  {
    name: "parallel_checks",
    table: s.parallelChecks,
    label: "Excel との比べ合わせ",
    about: "今までの Excel で出した振込額（並行して使っていた間に入れたもの）。",
    order: ["month", "driver_id"],
    restore: true,
  },
  {
    name: "payment_notices",
    table: s.paymentNotices,
    label: "元請の支払通知",
    about: "元請から届いた支払通知（元請・月・ファイル名・合計・入金日・差し引かれた手数料）。",
    order: ["month", "created_at", "id"],
    restore: true,
  },
  {
    name: "payment_notice_lines",
    table: s.paymentNoticeLines,
    label: "支払通知の行",
    about: "支払通知の 1 行ずつ（書いてあった案件名・ドライバー名・数量・単価・金額）。",
    order: ["notice_id", "id"],
    restore: true,
  },
  {
    name: "reconciliation_items",
    table: s.reconciliationItems,
    label: "突合で見つかった差",
    about: "支払通知と自社の記録の差（種類・金額）と、問い合わせた日時・解決した日時・取り戻せた額。",
    order: ["created_at", "id"],
    restore: true,
  },
  {
    name: "transfer_batches",
    table: s.transferBatches,
    label: "振込データの記録",
    about: "作った振込データ（振込指定日・人数・合計・入れた明細）と、実際に振り込んだ日。口座番号は入っていません（口座は drivers.csv）。",
    order: ["month", "created_at", "id"],
    restore: true,
  },
  {
    name: "watch_acks",
    table: s.watchAcks,
    label: "見張り番の確認済み",
    about: "見張り番の指摘を「確認済み」にした記録（月・指摘の種類・対象・メモ）。",
    order: ["month", "code", "subject_id"],
    restore: true,
  },
  {
    name: "audit_log",
    table: s.auditLog,
    label: "操作の記録",
    about: "だれが・いつ・何をしたかの記録（消せない表）。detail に中身が JSON で入っています。読み戻すと番号（id）は振り直します（並びは同じ）。",
    order: ["id"],
    restore: true,
    renumber: true,
  },
  {
    name: "month_closes",
    table: s.monthCloses,
    label: "月の締め",
    about: "締めた月（締めた日時・締めた人・外した日時と理由・締めにかかった分数）。",
    order: ["month"],
    restore: true,
  },
];

/** 書き出さない表（ログイン中のしるし）と、その理由 */
export const NOT_EXPORTED_TABLES: { name: string; reason: string }[] = [{ name: "sessions", reason: "ログイン中のしるし（持ち出すと、なりすましに使われるおそれがあるため）" }];

export type ColumnInfo = { name: string; sqlType: string };

/** 表の列（DB の名前と型）。書き出さない列は除く */
export function columnsOf(spec: TableSpec): ColumnInfo[] {
  const omit = new Set(spec.omit ?? []);
  return getTableConfig(spec.table)
    .columns.filter((c) => !omit.has(c.name))
    .map((c) => ({ name: c.name, sqlType: c.getSQLType() }));
}

/** 表の中のほかの表への参照（読み戻す前に、ZIP の中だけで閉じているかを確かめる） */
export function referencesOf(spec: TableSpec): { column: string; table: string; foreignColumn: string }[] {
  return getTableConfig(spec.table).foreignKeys.flatMap((fk) => {
    const ref = fk.reference();
    if (ref.columns.length !== 1) return [];
    return [{ column: ref.columns[0].name, table: getTableConfig(ref.foreignTable).name, foreignColumn: ref.foreignColumns[0].name }];
  });
}
