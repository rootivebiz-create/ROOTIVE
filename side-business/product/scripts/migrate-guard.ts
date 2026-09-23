/**
 * マイグレーションを当ててよいかの判断（純関数。scripts/migrate.ts が使い、テストでも確かめる）。
 *
 * Vercel はリポジトリとつなぐと、本番のブランチ以外への push ごとにプレビューをビルドする。
 * ビルドの前に毎回 `migrate.ts --if-configured` が動くので、ここで止めないと、確かめる前のブランチの
 * マイグレーションが **お客様の本番の DB** に当たってしまう（当てたマイグレーションは戻せない）。
 * 環境変数の側でも DATABASE_URL は本番だけに入れている（scripts/provision-plan.ts）が、
 * 前に作ったプロジェクトはプレビューにも入っていることがあるので、コードの側でも止める。
 */
export type MigrationDecision = { run: true; url: string } | { run: false; reason: string; fail?: boolean };

export function migrationDecision(opts: { ifConfigured: boolean; databaseUrl?: string; vercelEnv?: string }): MigrationDecision {
  const vercelEnv = opts.vercelEnv?.trim();
  // Vercel のビルドのうち、本番（production）でないもの（preview・development）は、DB に触れない
  if (opts.ifConfigured && vercelEnv && vercelEnv !== "production") {
    return {
      run: false,
      reason: `Vercel のビルドが本番ではない（VERCEL_ENV=${vercelEnv}）ので、マイグレーションは当てません（本番の DB は本番のデプロイのときだけ変えます）`,
    };
  }
  const url = opts.databaseUrl?.trim();
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    if (opts.ifConfigured) return { run: false, reason: "DATABASE_URL が無いので、マイグレーションは飛ばします（PGlite は起動時に当てます）" };
    return { run: false, reason: "DATABASE_URL（postgres://…）がありません", fail: true };
  }
  return { run: true, url };
}
