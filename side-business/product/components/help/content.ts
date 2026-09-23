/**
 * ヘルプの中身（純粋なデータと小さな関数。画面とテストの両方から読む）。
 * - 言葉は社長・事務・ドライバーに向けた、短い、やさしい文にする
 * - 法律や税金の判断はしない（「記録から分かること」「確認をおすすめ」まで）
 * - リンクは、その役割で開ける画面にだけ付ける（need）
 */
import type { Role } from "~/server/auth";

export type HelpLink = { href: string; label: string; need: Role };

export type HelpStep = { title: string; body: string; links: HelpLink[] };

/** 月末の流れ（6 つ） */
export const MONTH_END_STEPS: HelpStep[] = [
  {
    title: "稼働を取り込む",
    body: "今お使いの稼働の Excel・CSV を、形を変えずにそのまま置きます。台帳と名前が合わないところだけ聞かれるので、候補から選んで答えます。答えた書き方は覚えるので、来月からは聞きません。立替の精算など、その月だけの足し引きは「稼働と調整」で入れます。",
    links: [
      { href: "/import", label: "取り込み", need: "viewer" },
      { href: "/work", label: "稼働と調整", need: "viewer" },
    ],
  },
  {
    title: "見張り番を見る",
    body: "記録から分かる、確かめてほしいことを赤・黄・お知らせで並べます。指摘ごとに「何が・いくら・どこを直すか・根拠」が出ます。赤い指摘は、直すか、直さない理由を書いて「確認済み」にしてから締めます。",
    links: [{ href: "/watch", label: "見張り番", need: "viewer" }],
  },
  {
    title: "明細を作って、ドライバーへ送る",
    body: "支払明細を作り、ドライバーごとのリンクを LINE・SMS・メールで送ります。ドライバーはアプリもパスワードも無しで開き、「確認しました」を押したり、おかしな行から質問したりできます。質問は「ドライバーからの質問」に届きます。",
    links: [
      { href: "/statements", label: "支払明細", need: "viewer" },
      { href: "/statements/inbox", label: "ドライバーからの質問", need: "viewer" },
    ],
  },
  {
    title: "振込データを作る",
    body: "明細の振込額から、銀行の「総合振込」にそのまま読み込めるファイル（全銀の形式）を作ります。銀行で振り込んだら、「実際に振り込んだ日」を入れておきます（約束した支払日と比べられます）。",
    links: [{ href: "/transfer", label: "振込データ", need: "viewer" }],
  },
  {
    title: "締める",
    body: "締める前の確かめの項目を見てから締めます。締めた月の稼働・調整・明細は、だれも書き換えられなくなります。直すときは、オーナーが理由を書いて締めを外します。",
    links: [{ href: "/close", label: "締め", need: "viewer" }],
  },
  {
    title: "元請と突き合わせて、利益と会計へ",
    body: "元請のお支払通知を置くと、こちらの請求（数量・単価）と比べて差を出し、問い合わせ文の下書きまで作ります（送るかは人が決めます）。利益の画面で元請・案件ごとのもうけを見て、会計ソフトへ取り込む仕訳を書き出します。",
    links: [
      { href: "/reconcile", label: "元請との突合", need: "viewer" },
      { href: "/profit", label: "利益", need: "viewer" },
      { href: "/export", label: "会計ソフトへ", need: "staff" },
    ],
  },
];

export type Faq = { id: string; q: string; a: string[]; links: HelpLink[] };

/** よくある質問（事務の方から） */
export const FAQS: Faq[] = [
  {
    id: "names",
    q: "取り込みで、ドライバーや案件の名前が合わない",
    a: [
      "取り込みの確認の「名前の確認」で、候補から正しい人（案件）を選んでください。選んだ書き方を覚えるので、来月からは聞きません。",
      "台帳にまだいない人（案件）は、その場で登録できます。",
      "答えた書き方は、設定のドライバー・案件の「別名」に入ります。間違えて覚えさせたときは、その「別名」から消してください。書き方の違い（「青木」「アオキ」など）を、先に「別名」へ足しておくこともできます。",
      "列の読み方（どの列が名前・数量か）は、取り込みの画面の「覚えている読み方」で忘れさせられます。",
    ],
    links: [
      { href: "/import", label: "取り込み", need: "viewer" },
      { href: "/settings/drivers", label: "設定：ドライバー", need: "viewer" },
      { href: "/settings/projects", label: "設定：案件と単価", need: "viewer" },
    ],
  },
  {
    id: "fix-statement",
    q: "明細を直したい",
    a: [
      "締める前なら、「稼働と調整」で数量や足し引きを直し、支払明細の画面で「明細を作り直す」を押します。単価や控除の間違いは、設定で直してから作り直します。",
      "中身が変わると版が上がり、ドライバーの画面には何が変わったかが出ます。送ってあるリンクのままで新しい版が見られます。確認済みの人には、もう一度確認をお願いすることになるので、直したことを伝えてください。",
      "締めた月は、先にオーナーが締めを外してから直します（次の質問）。",
    ],
    links: [
      { href: "/work", label: "稼働と調整", need: "viewer" },
      { href: "/statements", label: "支払明細", need: "viewer" },
    ],
  },
  {
    id: "reopen",
    q: "締めを外したい",
    a: [
      "締めを外せるのはオーナーだけです。締めの画面の「締めを外す」から、理由を書いて外します。理由は操作の記録に残ります。",
      "直したら明細を作り直し、ドライバーに直したことを伝えてから、もう一度締めてください。",
    ],
    links: [{ href: "/close", label: "締め", need: "viewer" }],
  },
  {
    id: "transfer",
    q: "振込データを銀行に取り込むには",
    a: [
      "振込データの画面でファイルを作ります。全銀協の形式（1 行 120 桁・Shift_JIS）です。",
      "インターネットバンキングの「総合振込」の「ファイルの取り込み（アップロード）」から読み込み、銀行の画面の人数と合計が、しめ日ラボの画面と同じか確かめてから振り込んでください。銀行によって細かい決まりが少し違うことがあります。",
      "振込依頼人（会社の口座など）の情報は、オーナーが「設定 → 会社」で入れます。振り込んだら「実際に振り込んだ日」を入れてください。",
    ],
    links: [
      { href: "/transfer", label: "振込データ", need: "viewer" },
      { href: "/settings/company", label: "設定：会社", need: "viewer" },
    ],
  },
  {
    id: "driver-link",
    q: "ドライバーが明細を開けない",
    a: [
      "リンクには期限があります（作った日から 120 日）。また、「リンクを作り直す」を押すと、前のリンクは使えなくなります。支払明細の画面から、今のリンクを送り直してください。",
      "LINE の中で開けないときは、リンクを長押しして、Safari や Chrome などのブラウザで開くよう伝えてください。リンクが途中で切れて届いていないかも確かめてください。",
      "ドライバーが見られるのは、自分の明細だけです。ほかの人の明細は見えません。",
    ],
    links: [{ href: "/statements", label: "支払明細", need: "viewer" }],
  },
  {
    id: "accounting",
    q: "会計ソフトに取り込みたい",
    a: [
      "「会計ソフトへ」で、お使いのソフト（弥生会計・freee・マネーフォワード、または汎用の CSV）を選んで書き出します。ドライバー 1 人ごとに 1 枚の伝票になります。",
      "勘定科目と税区分の対応は、最初に一度、顧問の税理士さんと確かめてから保存してください。締めてから書き出すことをおすすめします（締める前は、稼働が変わると仕訳も変わります）。",
    ],
    links: [{ href: "/export", label: "会計ソフトへ", need: "staff" }],
  },
  {
    id: "password",
    q: "パスワードを変えたい・忘れた",
    a: [
      "変えるときは「自分のアカウント」で、今のパスワードを入れてから変えます。",
      "忘れたときは、オーナーに頼んでください。オーナーが利用者の画面で一度「止める」にしてから「招待のリンクを作る」を押すと、そのリンクから新しいパスワードを決められます。オーナーが 1 人だけで、そのオーナーが忘れたときは、下の連絡先へご連絡ください。",
    ],
    links: [
      { href: "/settings/account", label: "自分のアカウント", need: "viewer" },
      { href: "/settings/users", label: "設定：利用者", need: "owner" },
    ],
  },
];

/** 見張り番がすること */
export const WATCH_DOES: string[] = [
  "締める前に、この月の記録（稼働・明細・控除・取引条件・口座・登録番号 など）から、確かめてほしいことを並べます。",
  "指摘ごとに「何が・いくら・どこを直すか（ボタン）・根拠（法令の名前と、公的な資料へのリンク）」を出します。",
  "直さないと決めた指摘は、理由を書いて「確認済み」にできます。同じ指摘を毎月くり返しません。",
  "赤い指摘が残っている間は、締められません（オーナーが理由を書いたときだけ、残したまま締められます。理由は操作の記録に残ります）。",
];

/** 見張り番がしないこと */
export const WATCH_DOES_NOT: string[] = [
  "法律や税金の判断はしません。「〜のおそれがあります」「確認をおすすめします」までです。最終的な判断は、会社と、税理士・弁護士・社労士などの専門家にお任せします。",
  "雇用にあたるかどうかなど、ドライバーの働き方の判断はしません。",
  "しめ日ラボに入っていない記録（紙だけの契約書・口頭の約束など）は見られません。入っている記録から分かることだけです。",
  "何も出ないことは、法令に沿っているという判定ではありません。",
  "勝手に直したり、元請やドライバーへ勝手に送ったりはしません。",
];

export type SupportContact = { email: string | null; lineUrl: string | null; fallback: string };

/** 連絡先が無いときの文 */
export const SUPPORT_FALLBACK = "導入を担当した者にご連絡ください。";

/**
 * 困ったときの連絡先（環境変数 NEXT_PUBLIC_SUPPORT_EMAIL・NEXT_PUBLIC_SUPPORT_LINE_URL）。
 * 形の正しいものだけを使う（メールは「@」のある形、LINE は https:// のリンク）。無ければ「導入を担当した者に」。
 */
export function supportContact(env: Record<string, string | undefined>): SupportContact {
  const email = (env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "").trim();
  const line = (env.NEXT_PUBLIC_SUPPORT_LINE_URL ?? "").trim();
  return {
    email: /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) ? email : null,
    lineUrl: isHttpsUrl(line) ? line : null,
    fallback: SUPPORT_FALLBACK,
  };
}

function isHttpsUrl(value: string): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
