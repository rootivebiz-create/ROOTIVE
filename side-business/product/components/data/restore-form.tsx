"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { restoreAction, type RestoreState } from "~/app/(app)/data/actions";

/** この画面から送れる大きさ（サーバーの上限に合わせる） */
// 画面からの送信は、置き場所（Vercel）で 1 回 約 4.5MB まで。余白を見て 4MB（大きいときは手元の読み戻しで）
const MAX_MB = 4;

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

/**
 * 別の場所へ移すときの読み戻し（オーナーだけ）。
 * ① ZIP を選ぶ → ②「中身を確かめる」（書き込まない）→ ③ 印を付けて「読み込む」。
 * 同じファイルを 2 回送るので、選んだファイルは手元に持っておく（フォームが空に戻らないように、自分で送る）。
 */
export function RestoreForm() {
  const [state, dispatch, pending] = useActionState<RestoreState, FormData>(restoreAction, undefined);
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // 確かめた結果は、そのとき送ったファイルのものだけを見せる（選び直したら確かめ直す）
  const [sentFile, setSentFile] = useState<File | null>(null);
  const checked = state?.ok && state.data?.mode === "check" && sentFile === file ? state.data.summary : null;
  const done = state?.ok && state.data?.mode === "apply" ? state.data : null;
  const tooBig = !!file && file.size > MAX_MB * 1024 * 1024;

  const send = (mode: "check" | "apply") => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("mode", mode);
    if (confirm) fd.set("confirm", "on");
    setSentFile(file);
    startTransition(() => dispatch(fd));
  };
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    send("check");
  };

  if (done) {
    return (
      <div role="status" className="space-y-3 rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
        <p className="font-bold text-success">{state?.ok ? state.message : ""}</p>
        <p>
          「{done.summary.tenantName}」を読み込みました（{done.summary.rows.toLocaleString("ja-JP")}行・明細の版 {done.summary.versions}件）。行の数と、明細のすべての版のハッシュが、書き出したときと同じことを確かめました。
        </p>
        {done.invites.length > 0 ? (
          <div className="space-y-2">
            <p className="font-bold">読み込んだ会社に入るための招待のリンク（7 日で切れます）</p>
            <p>パスワードは書き出していないため、オーナーの方は、このリンクからパスワードを決め直してください。事務・閲覧の方は、入ったあと「設定 → 利用者」から招待し直してください。</p>
            <ul className="space-y-2">
              {done.invites.map((i) => (
                <li key={i.email} className="rounded-lg border border-border bg-card p-2">
                  <p className="font-bold">
                    {i.name}（{i.email}）
                  </p>
                  <p className="break-all text-xs">{i.url}</p>
                  <Button
                    variant="secondary"
                    className="mt-1"
                    onClick={() => {
                      void navigator.clipboard?.writeText(i.url).then(() => setCopied(i.email));
                    }}
                  >
                    {copied === i.email ? "コピーしました" : "リンクをコピー"}
                  </Button>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">リンクを開くと、いまのログインが読み込んだ会社のものに切り替わります。</p>
          </div>
        ) : (
          <p>読み込んだデータに、使えるオーナーがいませんでした。この場所を管理している方に、利用者の追加を頼んでください。</p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="block text-sm font-bold">書き出しの ZIP（{MAX_MB}MB まで）</span>
        <input
          type="file"
          name="file"
          accept=".zip,application/zip"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setConfirm(false);
          }}
          className="mt-1 block min-h-11 w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-border file:bg-card file:px-4 file:font-bold"
        />
      </label>
      {tooBig && <p className="text-sm text-danger">ファイルが大きすぎます（この画面からは {MAX_MB}MB まで）。大きいときは、導入を担当した者にご相談ください（手元から読み戻せます）。</p>}

      {state && !state.ok && sentFile === file && (
        <p role="alert" className="whitespace-pre-line rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      {checked ? (
        <div className="space-y-3 rounded-lg border border-border p-3 text-sm">
          <p className="font-bold text-success">{state?.ok ? state.message : ""}</p>
          <dl className="grid gap-1">
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">会社</dt>
              <dd className="font-bold">{checked.tenantName}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">書き出した日時</dt>
              <dd>{when(checked.exportedAt)}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">中身</dt>
              <dd>
                {checked.rows.toLocaleString("ja-JP")}行・明細の版 {checked.versions}件
              </dd>
            </div>
          </dl>
          {checked.olderSchema && (
            <p className="text-muted-foreground">前の版のしめ日ラボで書き出したものです。今の版で増えた項目は、はじめの値で入ります。</p>
          )}
          <details>
            <summary className="inline-flex min-h-11 cursor-pointer items-center">表ごとの行数を見る</summary>
            <ul className="mt-1 grid gap-1 sm:grid-cols-2">
              {checked.tables.map((t) => (
                <li key={t.name} className="flex justify-between gap-3">
                  <span>{t.label}</span>
                  <span className="num">{t.rows.toLocaleString("ja-JP")}行</span>
                </li>
              ))}
            </ul>
          </details>
          <label className="flex min-h-11 items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-1 h-5 w-5" />
            <span>
              この内容で読み込みます。「{checked.tenantName}」は、この場所に新しい会社として入ります（いまの会社のデータは変わりません）。
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => send("apply")} disabled={pending || !confirm || !file}>
              {pending ? "読み込んでいます…" : "読み込む"}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="submit" variant="secondary" disabled={pending || !file || tooBig}>
          {pending ? "確かめています…" : "中身を確かめる（まだ読み込みません）"}
        </Button>
      )}
    </form>
  );
}
