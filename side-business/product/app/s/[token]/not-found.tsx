/** リンクが使えないとき（期限切れ・作り直し・形の崩れ）。どれが理由か・明細があるかは出さない */
export default function LinkUnusable() {
  return (
    <main className="rounded-card border border-border bg-card p-5">
      <h1 className="text-xl font-bold">このリンクは使えません</h1>
      <p className="mt-3">期限が切れたか、会社がリンクを作り直しました。</p>
      <p className="mt-2">お手数ですが、会社に新しいリンクをお願いしてください。</p>
      <p className="mt-4 text-sm text-muted-foreground">届いたメッセージの一部だけを押した場合も開けないことがあります。リンクを最後まで押しているかもお確かめください。</p>
    </main>
  );
}
