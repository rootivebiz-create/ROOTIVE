import { Card } from "@/components/ui";
import { Badge, Notice, PageHeader } from "~/components/page";
import { ActionButton } from "~/components/settings/form-kit";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { aiConsentHistory, loadCompany } from "~/server/features/settings/company";
import { setAiConsentAction } from "../company/actions";

export const metadata = { title: "AI の同意" };

const fmt = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * AI（Anthropic 社の Claude）に、取り込むファイルの列の見出しを読ませてよいか、のお客様の同意。
 * 既定は「使わない」。オーナーだけが変えられ、変えた記録を残す。
 */
export default async function AiConsentPage() {
  const user = await requirePageUser("viewer");
  const canEdit = roleAtLeast(user.role, "owner");
  const db = await getDb();
  const [t, history] = await Promise.all([loadCompany(db, user.tenantId), aiConsentHistory(db, user.tenantId)]);
  const on = t.settings?.aiAssistConsent === true;

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="AI の同意" description="取り込みのときに AI を使ってよいか、会社として決めて記録します。" />

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">いまの設定</span>
          {on ? <Badge tone="green">AI を使ってよい（同意あり）</Badge> : <Badge>AI を使わない（既定）</Badge>}
        </div>
        <p className="text-sm">
          {on
            ? "同意の記録があります。AI を使う機能が使えるときは、取り込んだファイルの列が自動で分からないときだけ、下の範囲で AI に読ませます。"
            : "AI には何も送りません。列の対応は、しめ日ラボの中の決まりで推測し、分からないところは画面で選んでもらいます。"}
        </p>
      </Card>

      <Card className="space-y-3 text-sm">
        <h2 className="text-base font-bold">同意すると、何が送られるか</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            送るのは、取り込んだファイルの<span className="font-bold">列の見出し</span>と、<span className="font-bold">はじめの数行</span>だけです。どの列が「ドライバー」「案件」「数量」かを推測させるために使います。
          </li>
          <li>
            台帳まるごと（ドライバーの一覧・口座・明細）や、銀行の情報（口座番号・振込データ）は<span className="font-bold">送りません</span>。
          </li>
          <li>送り先は Anthropic 社（AI「Claude」の提供元）です。推測の結果は、画面で人が確かめてから使います。</li>
          <li>いつでも止められます。止めたあとは送りません。</li>
          <li>同意する・止めるたびに、だれが・いつ変えたかを記録します（下の「変えた記録」）。</li>
        </ul>
        <p className="text-xs text-muted-foreground">
          AI を使う機能は、この同意があり、さらにしめ日ラボ側で AI への接続（API キー）を用意しているときだけ動きます。どちらかが無ければ、AI には何も送りません。
        </p>
      </Card>

      {canEdit ? (
        <Card className="space-y-2">
          {on ? (
            <ActionButton action={setAiConsentAction} hidden={{ on: "0" }} label="AI を使わないようにする" variant="primary" />
          ) : (
            <ActionButton
              action={setAiConsentAction}
              hidden={{ on: "1" }}
              label="同意して、AI を使えるようにする"
              variant="secondary"
              confirm={
                <p>
                  取り込むファイルの列の見出しと、はじめの数行だけを、Anthropic 社の AI に送ることに同意します。台帳まるごとや銀行の情報は送りません。いつでも止められます。
                </p>
              }
              confirmLabel="同意する"
            />
          )}
        </Card>
      ) : (
        <Notice tone="info">この設定はオーナーだけが変えられます。</Notice>
      )}

      <section aria-labelledby="history" className="space-y-2">
        <h2 id="history" className="text-lg font-bold">
          変えた記録
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{on ? "この画面で変えた記録はありません。" : "まだ一度も変えていません（はじめから「AI を使わない」です）。"}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {history.map((h, i) => (
              <li key={i} className="flex flex-wrap gap-x-2 border-b border-border py-2">
                <span className="num">{fmt.format(h.at)}</span>
                <span>{h.by ?? "（不明）"}さんが</span>
                <span className="font-bold">{h.on ? "同意しました" : "止めました"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
