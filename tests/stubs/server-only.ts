/**
 * `server-only` の代わり（Vitest 用）。
 *
 * 本番では `import "server-only"` がクライアントからの取り込みを止めてくれるが、
 * Vitest は素の Node なので、そのままだと読み込めない。
 * テストのときだけ何もしないモジュールに差し替える（vitest.config.ts の alias）。
 */
export {};
