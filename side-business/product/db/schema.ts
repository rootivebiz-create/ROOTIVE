/**
 * しめ日ラボ（製品）のデータの形。
 *
 * - すべての表に tenant_id を持つ。既定はお客様ごとに別々に置く（1 つの DB に 1 社）が、
 *   将来まとめて提供（SaaS）に切り替えても同じ表で動くようにしておく。
 * - 金額は円の整数、単価・数量は小数を含むので numeric（number として扱う）。
 * - 締めた月（month_closes.status = 'closed'）の稼働・調整・明細は DB の引き金（trigger）でも止める（migrations/9999_guards.sql）。
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const tenantId = () => uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
/** 単価・数量・率：小数を含む。JS では number として受け渡す */
const dec = (name: string) => numeric(name, { precision: 14, scale: 4, mode: "number" });

// ---------------------------------------------------------------- 会社と人

export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  /** 会社の登録番号（T＋13 桁） */
  registrationNo: text("registration_no"),
  /** 会社の消費税の計算方法。原則課税のときだけ、免税の方への支払で控除できない分が出る */
  taxMethod: text("tax_method").notNull().default("general"),
  /** 免税の方にも消費税相当額を払うか */
  payTaxToExempt: boolean("pay_tax_to_exempt").notNull().default(true),
  taxRounding: text("tax_rounding").notNull().default("floor"),
  amountRounding: text("amount_rounding").notNull().default("round"),
  /** ドライバーへの支払の締め日（0＝月末）と支払日（何か月後の何日。0＝末日） */
  closingDay: integer("closing_day").notNull().default(0),
  payMonthOffset: integer("pay_month_offset").notNull().default(1),
  payDay: integer("pay_day").notNull().default(0),
  /** 振込依頼人（全銀）の情報など、会社ごとの細かい設定 */
  settings: jsonb("settings").$type<TenantSettings>().notNull().default(sql`'{}'::jsonb`),
  /** 最初の設定の案内がどこまで進んだか */
  onboarding: jsonb("onboarding").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
});

export type TenantSettings = {
  requester?: {
    code?: string;
    nameKana?: string;
    bankCode?: string;
    bankNameKana?: string;
    branchCode?: string;
    branchNameKana?: string;
    accountType?: "ordinary" | "checking";
    accountNumber?: string;
  };
  /** 明細の注記（相手方の確認のしかた など） */
  statementNote?: string;
  /** AI の読み取りを使ってよいか（お客様の同意） */
  aiAssistConsent?: boolean;
};

export const users = pgTable(
  "users",
  {
    id: id(),
    tenantId: tenantId(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    /** owner（すべて）・staff（登録と締め）・viewer（見るだけ） */
    role: text("role").notNull().default("staff"),
    passwordHash: text("password_hash"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_tenant_email").on(t.tenantId, t.email)],
);

export const sessions = pgTable("sessions", {
  /** クッキーに入れる値のハッシュ（生の値は保存しない） */
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tenantId: tenantId(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const invites = pgTable("invites", {
  /** 招待リンクの値のハッシュ */
  tokenHash: text("token_hash").primaryKey(),
  tenantId: tenantId(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- 台帳

export const drivers = pgTable(
  "drivers",
  {
    id: id(),
    tenantId: tenantId(),
    /** 社内の番号（Excel の取り込みで照合に使う） */
    code: text("code"),
    name: text("name").notNull(),
    kana: text("kana"),
    /** 取り込みで照合する別名（Excel の表記ゆれ） */
    aliases: text("aliases").array().notNull().default(sql`ARRAY[]::text[]`),
    email: text("email"),
    phone: text("phone"),
    invoiceRegistered: boolean("invoice_registered").notNull().default(false),
    registrationNo: text("registration_no"),
    isCorporation: boolean("is_corporation").notNull().default(false),
    /** 源泉徴収の区分（運送は none） */
    withholdingCategory: text("withholding_category").notNull().default("none"),
    bankCode: text("bank_code"),
    bankNameKana: text("bank_name_kana"),
    branchCode: text("branch_code"),
    branchNameKana: text("branch_name_kana"),
    accountType: text("account_type").notNull().default("ordinary"),
    accountNumber: text("account_number"),
    holderKana: text("holder_kana"),
    /** フリーランス法の取引条件を明示した日（未明示なら null） */
    termsIssuedOn: date("terms_issued_on", { mode: "string" }),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("drivers_tenant").on(t.tenantId)],
);

/** 元請（荷主） */
export const clients = pgTable("clients", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  aliases: text("aliases").array().notNull().default(sql`ARRAY[]::text[]`),
  /** 元請の締め日（0＝月末） */
  closingDay: integer("closing_day").notNull().default(0),
  notes: text("notes"),
  createdAt: createdAt(),
});

/** 案件（元請 × 仕事の種類）と標準の単価 */
export const projects = pgTable(
  "projects",
  {
    id: id(),
    tenantId: tenantId(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    aliases: text("aliases").array().notNull().default(sql`ARRAY[]::text[]`),
    /** 数量の単位（個・日・時間・件 など） */
    unit: text("unit").notNull().default("個"),
    /** 受注単価（税抜） */
    billRate: dec("bill_rate").notNull().default(0),
    /** 支払単価（税抜） */
    payRate: dec("pay_rate").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("projects_tenant").on(t.tenantId)],
);

/** ドライバーごとの単価（標準と違う人だけ） */
export const rateOverrides = pgTable(
  "rate_overrides",
  {
    id: id(),
    tenantId: tenantId(),
    driverId: uuid("driver_id").notNull().references(() => drivers.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    payRate: dec("pay_rate").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("rate_overrides_unique").on(t.tenantId, t.driverId, t.projectId)],
);

/**
 * 控除のルール（ロイヤリティ・管理費・リース・保険・立替の精算 など）。
 * driver_id が null なら全員に当てる。kind：percent（委託料 × 率）・fixed（毎月の定額）・per_unit（数量 × 単価）
 */
export const deductionRules = pgTable(
  "deduction_rules",
  {
    id: id(),
    tenantId: tenantId(),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    rate: dec("rate"),
    amount: integer("amount"),
    /** 稼働がある月だけ引くか */
    onlyWhenWorked: boolean("only_when_worked").notNull().default(true),
    /** 会社の売上として消費税がかかるか（ロイヤリティ・管理費・リースは多くの場合かかる。立替の精算はかからない） */
    taxable: boolean("taxable").notNull().default(true),
    /** 取引条件に書いて合意しているか（していないとフリーランス法の減額のおそれを警告） */
    agreedInWriting: boolean("agreed_in_writing").notNull().default(false),
    basis: text("basis"),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("deduction_rules_tenant").on(t.tenantId)],
);

// ---------------------------------------------------------------- 取り込みと稼働

/** 取り込みの列の対応（1 回覚えたら翌月から自動） */
export const mappingProfiles = pgTable("mapping_profiles", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  /** work（稼働表）・payment_notice（元請の支払通知） */
  kind: text("kind").notNull().default("work"),
  /** 見出しの並びから作った目印（同じ形の Excel を見分ける） */
  headerSignature: text("header_signature").notNull(),
  mapping: jsonb("mapping").$type<Record<string, string>>().notNull(),
  options: jsonb("options").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  updatedAt: updatedAt(),
});

export const importBatches = pgTable("import_batches", {
  id: id(),
  tenantId: tenantId(),
  month: date("month", { mode: "string" }).notNull(),
  kind: text("kind").notNull().default("work"),
  fileName: text("file_name").notNull(),
  mappingProfileId: uuid("mapping_profile_id").references(() => mappingProfiles.id, { onDelete: "set null" }),
  rowCount: integer("row_count").notNull().default(0),
  /** draft（確認中）・applied（反映済み）・discarded（取り消し） */
  status: text("status").notNull().default("draft"),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

/** 稼働（ドライバー × 案件 × 月の数量。日付があれば日ごとでもよい） */
export const workEntries = pgTable(
  "work_entries",
  {
    id: id(),
    tenantId: tenantId(),
    month: date("month", { mode: "string" }).notNull(),
    driverId: uuid("driver_id").notNull().references(() => drivers.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    qty: dec("qty").notNull(),
    workDate: date("work_date", { mode: "string" }),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("work_entries_month").on(t.tenantId, t.month)],
);

/** その月だけの足し引き（立替の精算・事故の負担 など。消費税の対象外が既定） */
export const adjustments = pgTable(
  "adjustments",
  {
    id: id(),
    tenantId: tenantId(),
    month: date("month", { mode: "string" }).notNull(),
    driverId: uuid("driver_id").notNull().references(() => drivers.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    /** ＋は支払を増やす、−は減らす */
    amount: integer("amount").notNull(),
    taxable: boolean("taxable").notNull().default(false),
    agreedInWriting: boolean("agreed_in_writing").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("adjustments_month").on(t.tenantId, t.month)],
);

// ---------------------------------------------------------------- 締めと明細

export const monthCloses = pgTable(
  "month_closes",
  {
    tenantId: tenantId(),
    month: date("month", { mode: "string" }).notNull(),
    /** open・closed */
    status: text("status").notNull().default("open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.month] })],
);

/** 支払明細（締めるときの写し。締めたあとは変えない） */
export const statements = pgTable(
  "statements",
  {
    id: id(),
    tenantId: tenantId(),
    month: date("month", { mode: "string" }).notNull(),
    driverId: uuid("driver_id").notNull().references(() => drivers.id, { onDelete: "cascade" }),
    /** 明細の中身（行・控除・調整・税・振込額・記載事項）をそのまま残す */
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    subtotal: integer("subtotal").notNull(),
    tax: integer("tax").notNull(),
    deductions: integer("deductions").notNull(),
    withholding: integer("withholding").notNull().default(0),
    total: integer("total").notNull(),
    /** リンクを無効にしたいときに変える（署名に含める） */
    linkNonce: text("link_nonce").notNull().default(sql`replace(gen_random_uuid()::text, '-', '')`),
    /** ドライバーへリンクを送った（コピーした）日時 */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** ドライバーが初めて開いた日時 */
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("statements_unique").on(t.tenantId, t.month, t.driverId), index("statements_month").on(t.tenantId, t.month)],
);

/** ドライバーの「確認しました」（仕入明細書の相手方の確認の記録）。締めたあとでも書ける */
export const statementConfirmations = pgTable("statement_confirmations", {
  id: id(),
  tenantId: tenantId(),
  statementId: uuid("statement_id").notNull().references(() => statements.id, { onDelete: "cascade" }),
  /** 確認したときの振込額（あとで明細が変わっても、何を確認したか分かるように） */
  totalAtConfirm: integer("total_at_confirm").notNull(),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

/** 明細についての質問・誤りの連絡（ドライバー ⇄ 事務） */
export const statementMessages = pgTable(
  "statement_messages",
  {
    id: id(),
    tenantId: tenantId(),
    statementId: uuid("statement_id").notNull().references(() => statements.id, { onDelete: "cascade" }),
    /** driver・staff */
    author: text("author").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("statement_messages_statement").on(t.statementId)],
);

/**
 * 並行運用の比べ合わせ：今の Excel で出した振込額（お客様が入れる）と、しめ日ラボの振込額を並べる。
 * 差が 0 になるまで並行して締めるための記録。
 */
export const parallelChecks = pgTable(
  "parallel_checks",
  {
    tenantId: tenantId(),
    month: date("month", { mode: "string" }).notNull(),
    driverId: uuid("driver_id").notNull().references(() => drivers.id, { onDelete: "cascade" }),
    excelTotal: integer("excel_total").notNull(),
    note: text("note"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.month, t.driverId] })],
);

// ---------------------------------------------------------------- 元請の支払通知と突合

export const paymentNotices = pgTable("payment_notices", {
  id: id(),
  tenantId: tenantId(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  month: date("month", { mode: "string" }).notNull(),
  fileName: text("file_name").notNull(),
  total: integer("total").notNull().default(0),
  createdAt: createdAt(),
});

export const paymentNoticeLines = pgTable("payment_notice_lines", {
  id: id(),
  tenantId: tenantId(),
  noticeId: uuid("notice_id").notNull().references(() => paymentNotices.id, { onDelete: "cascade" }),
  rawProject: text("raw_project").notNull(),
  rawDriver: text("raw_driver"),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
  qty: dec("qty"),
  unitPrice: dec("unit_price"),
  amount: integer("amount").notNull(),
});

/** 突合で見つかった差と、その後の扱い（問い合わせた・解決した） */
export const reconciliationItems = pgTable("reconciliation_items", {
  id: id(),
  tenantId: tenantId(),
  noticeId: uuid("notice_id").notNull().references(() => paymentNotices.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  /** missing（請求したのに無い）・price（単価違い）・qty（数量違い）・extra（こちらに無い） */
  kind: text("kind").notNull(),
  ourAmount: integer("our_amount").notNull(),
  theirAmount: integer("their_amount").notNull(),
  diff: integer("diff").notNull(),
  /** open・asked・resolved・accepted */
  status: text("status").notNull().default("open"),
  note: text("note"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- 見張り番と記録

/** 見張り番の指摘を「確認済み」にした記録（同じ指摘を毎月出さない） */
export const watchAcks = pgTable(
  "watch_acks",
  {
    tenantId: tenantId(),
    month: date("month", { mode: "string" }).notNull(),
    code: text("code").notNull(),
    subjectId: text("subject_id").notNull(),
    note: text("note"),
    ackedBy: uuid("acked_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.month, t.code, t.subjectId] })],
);

/** 操作の記録（誰が・いつ・何を）。消さない */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: tenantId(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_tenant").on(t.tenantId, t.createdAt)],
);
