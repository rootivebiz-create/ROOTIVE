/**
 * 営業資料の差出人（屋号・事業者名・所在地・電話・メール・登録番号）と、送る前に埋めるべき設定の警告。
 * 値は site.config.ts（businessInfo・CONTACT）から読み、未設定なら【所在地】のような目印を出す。
 */
import { cx } from "@/lib/cx";
import { CONTACT, SITE, businessInfo } from "@/site.config";
import { isLocalSiteUrl } from "./format";

export type SenderRow = {
  label: string;
  value: string | null;
  placeholder: string;
  /** 設定する環境変数（屋号は site.config.ts） */
  env: string;
  /** 未設定でも送ってよい項目（登録番号：未登録なら空のまま） */
  optional?: boolean;
};

export function senderRows(): SenderRow[] {
  const info = businessInfo();
  return [
    { label: "屋号", value: SITE.name, placeholder: "【屋号】", env: "site.config.ts の SITE.name" },
    { label: "事業者名", value: info.ownerName, placeholder: "【事業者名】", env: "OWNER_NAME" },
    { label: "所在地", value: info.address, placeholder: "【所在地】", env: "BUSINESS_ADDRESS" },
    { label: "電話", value: info.phone, placeholder: "【電話番号】", env: "BUSINESS_PHONE" },
    { label: "メール", value: CONTACT.email, placeholder: "【メール】", env: "NEXT_PUBLIC_CONTACT_EMAIL" },
    { label: "登録番号", value: info.invoiceRegNo, placeholder: "【登録番号】", env: "INVOICE_REG_NO", optional: true },
  ];
}

/** 停止の申し出を受ける連絡先。「メール（…）または電話（…）」。どちらも無ければ目印 */
export function stopContact(): { text: string; missing: boolean } {
  const info = businessInfo();
  const parts: string[] = [];
  if (CONTACT.email) parts.push(`メール（${CONTACT.email}）`);
  if (info.phone) parts.push(`電話（${info.phone}）`);
  if (parts.length === 0) return { text: "【メールまたは電話】", missing: true };
  return { text: parts.join("または"), missing: false };
}

export type SetupIssue = { label: string; env: string; note?: string; optional?: boolean };

/** 送る前に埋めるべき設定。空なら準備ができている */
export function setupIssues(): SetupIssue[] {
  const issues: SetupIssue[] = [];
  if (isLocalSiteUrl()) {
    issues.push({ label: "本番のURL", env: "NEXT_PUBLIC_SITE_URL", note: `いまはQRコードが ${SITE.url} を指しています` });
  }
  for (const r of senderRows()) {
    if (r.value) continue;
    issues.push({
      label: r.label,
      env: r.env,
      optional: r.optional,
      note: r.optional ? "インボイスに未登録なら空のままで構いません（印刷されません）" : undefined,
    });
  }
  return issues;
}

/** 画面だけに出す警告（印刷しない）。必須の項目が欠けていれば赤、任意だけなら控えめに */
export function SetupWarning({ className }: { className?: string }) {
  const issues = setupIssues();
  if (issues.length === 0) return null;
  const blocking = issues.some((i) => !i.optional);
  return (
    <div
      role={blocking ? "alert" : "note"}
      className={cx(
        "no-print rounded-card border-2 bg-card p-4 text-sm leading-relaxed",
        blocking ? "border-danger" : "border-warning",
        className,
      )}
    >
      <p className={cx("font-bold", blocking ? "text-danger" : "text-warning")}>
        {blocking ? "送る前に、差出人の情報を入れてください" : "差出人の情報で、まだ入っていないものがあります"}
      </p>
      <p className="mt-1">
        Vercel の環境変数に入れて、もう一度デプロイしてください。入っていない項目は【所在地】のように印刷されます。
      </p>
      <ul className="mt-2 space-y-1">
        {issues.map((i) => (
          <li key={i.env} className="flex flex-wrap gap-x-2">
            <span className="font-bold">{i.label}</span>
            <code className="break-all rounded bg-muted px-1 text-xs leading-5">{i.env}</code>
            {i.note && <span className="text-muted-foreground">{i.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 横に 2 組並べるときに、1 行まるごと使う項目（長くなりやすい） */
const WIDE_ROWS = new Set(["所在地", "登録番号"]);

/**
 * 差出人のブロック。未設定の項目は目印（【所在地】）を出す。登録番号だけは、未設定なら画面にだけ出して印刷しない。
 * tone="fax" は白黒（黒の文字・黒の線だけ）。wide は幅があるとき（sm 以上・印刷）に 2 組ずつ横に並べて行を減らす。
 */
export function SenderBlock({
  tone = "color",
  wide = false,
  className,
}: {
  tone?: "fax" | "color";
  wide?: boolean;
  className?: string;
}) {
  const rows = senderRows();
  return (
    <dl
      className={cx(
        "grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5",
        wide && "sm:grid-cols-[auto_1fr_auto_1fr] print:grid-cols-[auto_1fr_auto_1fr]",
        className,
      )}
    >
      {rows.map((r) => {
        const missing = !r.value;
        return (
          <div key={r.label} className={cx("contents", missing && r.optional && "no-print")}>
            <dt className={cx("whitespace-nowrap font-bold", tone === "fax" ? "text-black" : "text-muted-foreground")}>{r.label}</dt>
            <dd
              className={cx(
                "min-w-0 break-all",
                r.label === "屋号" && "font-bold",
                r.label === "登録番号" && "num",
                wide && WIDE_ROWS.has(r.label) && "sm:col-span-3 print:col-span-3",
              )}
            >
              {missing ? (
                <span className={cx("kit-missing font-bold", tone === "fax" ? "text-black" : "text-danger")}>{r.placeholder}</span>
              ) : (
                r.value
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
