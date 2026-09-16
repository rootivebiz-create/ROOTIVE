import type { RoundingMode } from "./types";

/** 金額・数量は小数 2 桁、率は小数 4 桁を前提に整数化して誤差なく計算する */
const S4 = 10_000n; // 1e4
const S8 = 100_000_000n; // 1e8

/** x を 1e4 倍した整数（BigInt）へ。小数 4 桁で四捨五入 */
export function toS4(x: number): bigint {
  if (!Number.isFinite(x)) return 0n;
  return BigInt(Math.round(x * 10_000));
}

export function fromS4(v: bigint): number {
  return Number(v) / 10_000;
}

/** 2 つの数値の積（それぞれ小数 4 桁精度）を誤差なく求める。結果は小数 8 桁精度の BigInt */
export function mulS8(a: number, b: number): bigint {
  return toS4(a) * toS4(b);
}

export function fromS8(v: bigint): number {
  return Number(v) / 100_000_000;
}

/** S8 整数（値 × 1e8）に端数処理を適用し、数値へ戻す */
export function applyRoundingS8(valueS8: bigint, mode: RoundingMode): number {
  if (mode === "none") return fromS8(valueS8);
  const q = valueS8 / S8; // 0 方向へ切り捨て
  const r = valueS8 % S8;
  if (r === 0n) return Number(q);
  switch (mode) {
    case "floor":
      return Number(r < 0n ? q - 1n : q);
    case "ceil":
      return Number(r > 0n ? q + 1n : q);
    case "round": {
      // 四捨五入（0 から遠い方向）
      const abs = r < 0n ? -r : r;
      if (abs * 2n >= S8) return Number(r < 0n ? q - 1n : q + 1n);
      return Number(q);
    }
    default:
      return fromS8(valueS8);
  }
}

/** 数値へ端数処理を適用（小数 8 桁精度で評価） */
export function applyRounding(value: number, mode: RoundingMode): number {
  if (mode === "none") return value;
  const s8 = BigInt(Math.round(value * 100_000_000));
  return applyRoundingS8(s8, mode);
}

/** 誤差の出ない金額の合計（小数 4 桁精度） */
export function sumMoney(values: Iterable<number>): number {
  let acc = 0n;
  for (const v of values) acc += toS4(v);
  return fromS4(acc);
}

/** a × b を小数 4 桁精度の数値として返す（会社売上・ドライバー売上用） */
export function mulMoney(a: number, b: number): number {
  const s8 = mulS8(a, b);
  // S8 → S4 に丸め（四捨五入）
  const q = s8 / S4;
  const r = s8 % S4;
  const abs = r < 0n ? -r : r;
  const adj = abs * 2n >= S4 ? (r < 0n ? -1n : 1n) : 0n;
  return fromS4(q + adj);
}

export function subMoney(a: number, b: number): number {
  return fromS4(toS4(a) - toS4(b));
}

export function addMoney(a: number, b: number): number {
  return fromS4(toS4(a) + toS4(b));
}

/** 表示用の整数丸め：四捨五入、負数は 0 から遠い方向 */
export function roundDisplay(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const abs = Math.round(Math.abs(x) + 1e-9);
  if (abs === 0) return 0;
  return x < 0 ? -abs : abs;
}
