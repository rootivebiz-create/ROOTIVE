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
 *   NEXT_PUBLIC_PRODUCT_DEMO_URL  製品のデモを置いた URL（例 https://…vercel.app）。入口は <URL>/demo/start。
 *                              未設定なら「製品のデモを触る」は出さない（ビルドのときに読むので、変えたら再デプロイ）
 * この事業は個人事業で、どの会社の事業でもない。会社名・会社のロゴ・会社のシステムの画面・データは載せない。
 */

/**
 * 作り手が「軽貨物の運送会社を経営している本人」だと書いてよいか。
 * 会社の承認で書いてよいと決めたときだけ true。false にすると、サイト・営業資料のすべてが
 * 「運送業の支払の仕組みに詳しい作り手が、AIを使って作ります」といった中立の書き方になる（components/kit/maker.ts）。
 */
const MAKER_IS_OPERATOR = true;

/**
 * 本番の URL。NEXT_PUBLIC_SITE_URL → Vercel の本番ドメイン（VERCEL_PROJECT_PRODUCTION_URL）→ 手元の開発用の順で決める。
 * 末尾の「/」は外す。
 */
export function siteUrlFrom(env: Record<string, string | undefined>): string {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercel = (env.VERCEL_PROJECT_PRODUCTION_URL ?? env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL)?.trim();
  const url = explicit || (vercel ? `https://${vercel.replace(/^https?:\/\//, "")}` : "http://localhost:3200");
  return url.replace(/\/+$/, "");
}

export const SITE = {
  /** 屋号（仮）。商標・同じ屋号が無いか確かめてから決める */
  name: "しめ日ラボ",
  shortName: "しめ日ラボ",
  /** ページの題・共有の画像の説明に使う。短く（トップの大見出しは components/landing/product-content.ts の HERO） */
  tagline: "月末の締めを今のExcelのまま。元請の支払通知とのズレも円で。",
  description: `軽貨物・運送会社向けの、月末の締めの仕組みです。今のExcelをそのまま取り込み、支払明細・ドライバーの確認・振込データまで。元請の支払通知と自社の記録を突き合わせ、少ない可能性がある差を金額で出します。${
    MAKER_IS_OPERATOR ? "作るのは現役の軽貨物会社の代表。" : "運送業の支払の仕組みに詳しい作り手が、AIを使って作ります。"
  }`,
  locale: "ja_JP",
  /** 本番の URL（siteUrlFrom の順で決める） */
  url: siteUrlFrom({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  }),
  /** 作り手が運送会社を経営していると書いてよいか（上の MAKER_IS_OPERATOR。会社の承認で書いてよいと決めたときだけ true） */
  makerIsOperator: MAKER_IS_OPERATOR as boolean,
} as const;

/**
 * SNS・チャットで共有したときの画像（public/og.png・1200×630）。
 * ページで openGraph を書くと、レイアウトの openGraph は丸ごと置きかわる（画像も消える）ので、
 * ページ側の openGraph にも images: [SHARE_IMAGE] を入れる。
 */
export const SHARE_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: `${SITE.name}｜${SITE.tagline}`,
} as const;

export const CONTACT = {
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null,
  bookingUrl: process.env.NEXT_PUBLIC_BOOKING_URL?.trim() || null,
  lineUrl: process.env.NEXT_PUBLIC_LINE_URL?.trim() || null,
} as const;

/**
 * 製品のデモの入口（<URL>/demo/start）。来た人ごとに架空の会社を 1 つ作り、24 時間で消える（製品の README）。
 * http(s) の URL だけを受け付け、末尾の「/」や「/demo/start」は付いていても付いていなくてもよい。
 * 使えない値・未設定なら null（画面ではリンクごと出さない）。
 */
export function productDemoStartUrl(raw: string | undefined | null): string | null {
  const text = raw?.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text.replace(/^\/+/, "")}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname) return null;
  const base = `${url.origin}${url.pathname}`.replace(/\/+$/, "").replace(/\/demo\/start$/, "");
  return `${base}/demo/start`;
}

export const PRODUCT = {
  /** 製品のデモの入口。NEXT_PUBLIC_PRODUCT_DEMO_URL が無ければ null */
  demoUrl: productDemoStartUrl(process.env.NEXT_PUBLIC_PRODUCT_DEMO_URL),
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
 * 料金（すべて税抜）。ドライバーは何人でも同じ料金。
 * 売るのは製品（side-business/product）を御社の Vercel ＋ Postgres に置いて立ち上げ、毎月の保守をすること。
 * サーバー代（Vercel・Postgres）はお客様が各社へ直接払う（見積で目安を示す）。
 * includes には、製品が今できることだけを書く（無い機能を約束しない。できないことは note で正直に書く）。
 * 金額を変えるときはここだけを直す（画面・営業資料は lib/plans.ts などでここから組み立てる）。
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
      "先月分の稼働・単価・控除の Excel をお預かり（ドライバーの名前は番号に置きかえ、口座・住所の列は消してお送りください）",
      "製品で先月分の明細を計算し、今の振込額と 1 円単位で比べる並行運用レポート（差があれば原因の候補つき）",
      "元請の支払通知（CSV・Excel）があれば、自社の稼働と突き合わせて、差を金額で",
      "見張り番の指摘（支払期日・合意の記録が無い控除・振込手数料・10月からの消費税の負担 など。いただいた記録から分かることと根拠だけ）",
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
      "今の Excel・CSV をそのまま取り込み（列の意味を当て、ファイルの形と名前の表記ゆれを覚えるので、翌月からは置くだけ）",
      "控除のルール（ロイヤリティ・管理費・リースなど）を、よく使う形から選んで今の取引条件のとおりに登録。いつ・どの書面で合意したかも記録",
      "支払明細 PDF（仕入明細書の記載事項を載せる形。税率ごとの金額と消費税・登録番号など）",
      "ドライバーへ明細のリンク（アプリもパスワードも不要）。「確認しました」の記録と、明細の行ごとの質問",
      "取引条件の明示書を台帳から作り、ドライバーの「受け取りました」を記録",
      "締め前の見張り番（取引条件の明示・支払期日・合意の記録が無い控除・振込手数料・口座の不備 など。根拠つきで、判定はしません）",
      "銀行に出せる全銀形式の振込データ（前回から口座が変わった人を必ず表示。振込は御社が行い、当方はお金に触れません）",
      "月の締め（締めた月は書き換えできません）と、誰がいつ何をしたかの記録",
      "今の Excel との並行運用（振込額を 1 人ずつ 1 円単位で比べ、合ってから本番へ）",
    ],
  },
  {
    id: "profit",
    name: "利益まるごとパック",
    forWhom: "元請が複数あり、支払通知が実績と合っているか・どこで儲かっているかを知りたい会社（ドライバー 20〜50 人ほど）",
    initialYen: 480000,
    monthlyYen: 35000,
    weeks: "約6週間",
    includes: [
      "支払明細パックのすべて",
      "元請の支払通知（CSV・Excel）と自社の記録の突き合わせ。少ない可能性がある差を金額で出し、丁寧な問い合わせ文の下書きまで",
      "案件別・元請別・ドライバー別の利益と、月ごとの推移（10月からの消費税の負担も分けて表示）",
      "社長の1枚（その月の数字を 1 枚にまとめた PDF）",
      "会計ソフト向けの仕訳 CSV（弥生会計のインポート形式 ほか。取り込む前に、勘定科目と税区分を税理士さんと確かめてください）",
    ],
  },
];

/** パックとあわせて付けるもの。製品の標準に無いものは、無いと正直に書く */
export const OPTIONS = [
  {
    id: "records",
    name: "運行記録オプション（点呼・業務記録・事故記録）",
    initialYen: 150000,
    monthlyYen: 10000,
    note: "上のパックとあわせてのみ。ご相談のうえ、御社向けに作ります（製品の標準には入っていません）。",
  },
] as const;

/** 保守（月額）に含むもの */
export const MAINTENANCE_INCLUDES = [
  "不具合の修正と、製品の改良（新しい版は御社の画面に自動で届きます）",
  "税率・経過措置など、制度が変わったときの手直し",
  "月 2 時間までの小さな変更",
  "平日のご連絡に 2 営業日以内にお返事",
] as const;
