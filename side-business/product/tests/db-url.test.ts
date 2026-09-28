import { describe, expect, it } from "vitest";
import { cleanPostgresUrl, isPostgresUrl } from "../db/url";

describe("Postgres の接続文字列をそろえる", () => {
  it("Neon の channel_binding・Prisma 向けの pgbouncer などは外し、sslmode などは残す", () => {
    expect(cleanPostgresUrl("postgresql://u:p@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require")).toBe(
      "postgresql://u:p@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
    );
    expect(cleanPostgresUrl("postgres://u:p@h:6543/postgres?pgbouncer=true&connection_limit=1")).toBe("postgres://u:p@h:6543/postgres");
    expect(cleanPostgresUrl("postgres://u:p@h/db?Channel_Binding=require&options=endpoint%3Dep-x")).toBe("postgres://u:p@h/db?options=endpoint%3Dep-x");
  });

  it("ユーザー名・パスワード（記号入り）・ホストは一文字も変えない。項目が無ければそのまま", () => {
    const pw = "postgres://user:p%40ss%3Fw%26rd@host.example:5432/db";
    expect(cleanPostgresUrl(pw)).toBe(pw);
    expect(cleanPostgresUrl(`  ${pw}?sslmode=require  `)).toBe(`${pw}?sslmode=require`);
    expect(cleanPostgresUrl("postgres://u:p@h/db?channel_binding=require")).toBe("postgres://u:p@h/db");
    expect(cleanPostgresUrl("postgres://u:p@h/db?%E0=1&sslmode=require")).toBe("postgres://u:p@h/db?%E0=1&sslmode=require");
  });

  it("postgres:// と postgresql:// だけを接続文字列とみなす", () => {
    expect(isPostgresUrl("postgres://u:p@h/db")).toBe(true);
    expect(isPostgresUrl(" postgresql://u:p@h/db ")).toBe(true);
    expect(isPostgresUrl("mysql://u:p@h/db")).toBe(false);
    expect(isPostgresUrl("")).toBe(false);
    expect(isPostgresUrl(undefined)).toBe(false);
  });
});
