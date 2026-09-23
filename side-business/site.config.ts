/**
 * サイト全体の設定。屋号・連絡先・料金を変えるときはここだけを直す。
 *
 * 個人の情報は Git に入れず、Vercel の環境変数から読む（未設定なら表示しない）：
 *   OWNER_NAME                 事業者名（個人の氏名。屋号と並べて出す）
 *   BUSINESS_ADDRESS           所在地（営業のメール・FAX には必ず書く。バーチャルオフィス可）
 *   BUSINESS_PHONE             電話番号（050 番号など）
 *   INVOICE_REG_NO             インボイスの登録番号（T＋13 桁。登録したら入れる）
 *   NEXT_PUBLIC_CONTACT_EMAIL  問い合わせ先のメール
 *   NEXT_PUBLIC_BOOKING_URL    オンライン相談の予約ページ（Google カレンダーの予約スケジュールなど）
 *   NEXT_PUBLIC_LINE_URL       LINE 公式アカウントの友だち追加 URL（任意）
 * この事業は個人事業で、どの会社の事業でもない。会社名・会社のロゴ・会社のシステムの画面・データは載せない。
 */

export const SITE = {
  /** 屋号（仮）。商標・同じ屋号が無いか確かめてから決める */
  name: "しめ日ラボ",
  shortName: "しめ日ラボ",
  tagline: "業務委託ドライバーの月末の締めを、御社のルールのまま自動に。",
  description:
    "軽貨物・運送会社向け。業務委託ドライバーの支払明細・振込データ・案件別の利益を、今の Excel のルールのまま自動にする仕組みを、御社のアカウントに作ります。作るのは現役の軽貨物会社の代表。10月からのインボイス経過措置（控除70%）にも対応。",
  locale: "ja_JP",
  /** 本番の URL（環境変数 NEXT_PUBLIC_SITE_URL で上書き） */
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/+$/, ""),
} as const;

export const CONTACT = {
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null,
  bookingUrl: process.env.NEXT_PUBLIC_BOOKING_URL?.trim() || null,
  lineUrl: process.env.NEXT_PUBLIC_LINE_URL?.trim() || null,
} as const;

export type BusinessInfo = {
  ownerName: string | null;
  address: string | null;
  phone: string | null;
  invoiceRegNo: string | null;
};

/** 事業者の情報（サーバー側だけで読む）。未設定の項目は null */
export function businessInfo(): BusinessInfo {
  const v = (key: string) => process.env[key]?.trim() || null;
  return {
    ownerName: v("OWNER_NAME"),
    address: v("BUSINESS_ADDRESS"),
    phone: v("BUSINESS_PHONE"),
    invoiceRegNo: v("INVOICE_REG_NO"),
  };
}

/** 互換のため残す（プライバシーポリシーなどが使う） */
export function ownerName(): string | null {
  return businessInfo().ownerName;
}

/**
 * 料金（すべて税抜）。ドライバーは何人でも同じ料金。サーバー代はお客様が直接払う（見積で目安を示す）。
 * 根拠：競合（1 人月 1,000 円の協会アプリ、月 1〜5 万円の運送 SaaS、初期 100 万円以上の kintone・受託開発）の間に置く。
 */
export type Plan = {
  id: string;
  name: string;
  forWhom: string;
  initialYen: number;
  monthlyYen: number;
  weeks: string;
  includes: string[];
  note?: string;
  featured?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "trial",
    name: "先月分でお試し",
    forWhom: "自社の数字で本当に合うか、まず確かめたい会社",
    initialYen: 50000,
    monthlyYen: 0,
    weeks: "約2週間",
    includes: [
      "先月分の稼働・単価・控除の Excel をお預かり（ドライバー名は番号に置きかえて構いません）",
      "支払明細を自動で計算し、実際の支払額と突き合わせ",
      "合わなかった行と理由を 1 枚にまとめてお渡し",
      "30 分のオンライン説明（録画もお渡し）",
    ],
    note: "本契約になったら、この 5 万円は初期費用から全額差し引きます。",
  },
  {
    id: "payroll",
    name: "支払明細パック",
    forWhom: "業務委託ドライバー 10〜30 人で、月末の支払明細を Excel で作っている会社",
    initialYen: 250000,
    monthlyYen: 18000,
    weeks: "約4週間",
    featured: true,
    includes: [
      "ドライバー・案件・元請の台帳（今の Excel から取り込み）",
      "ドライバー別・案件別の単価と、数量×単価の自動計算",
      "管理費・ロイヤリティ・リースなどの控除と、その月だけの調整",
      "消費税の計算と、免税ドライバーへの支払で控除できない分（経過措置）の表示",
      "登録番号・税率ごとの金額などを載せた支払明細 PDF（仕入明細書として使う形にも対応）",
      "銀行に出せる全銀形式の振込データ（振込は御社が行います。当方はお金に触れません）",
      "フリーランス法の取引条件明示書と、支払期日（60日以内）のチェック",
      "1 か月の並行運用（今の Excel と両方で締め、差が 0 になるまで確かめる）",
    ],
  },
  {
    id: "profit",
    name: "利益まるごとパック",
    forWhom: "ドライバー 20〜50 人・元請が複数あり、どこで儲かっているかを知りたい会社",
    initialYen: 480000,
    monthlyYen: 35000,
    weeks: "約6週間",
    includes: [
      "支払明細パックのすべて",
      "案件別・元請別・ドライバー別の売上・支払・利益と、月ごとの推移",
      "元請への請求書の作成",
      "元請の支払通知と自社の実績の突き合わせ",
      "経費の登録と営業利益、月の目標と進み具合",
      "社長向けのスマホ画面（今月の数字が 1 画面で分かる）",
    ],
  },
];

export const OPTIONS = [
  {
    id: "records",
    name: "運行記録オプション（点呼・業務記録・事故記録）",
    initialYen: 150000,
    monthlyYen: 10000,
    note: "上のパックとあわせてのみ。ドライバー本人が記録し、会社は見られる形で作ります。",
  },
] as const;

/** 保守（月額）に含むもの */
export const MAINTENANCE_INCLUDES = [
  "不具合の修正",
  "税率・経過措置など制度の変更への対応",
  "月 2 時間までの小さな変更",
  "平日のご連絡に 2 営業日以内にお返事",
] as const;
