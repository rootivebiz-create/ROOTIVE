/** class 名をつなぐ（false・null・undefined・空文字は飛ばす） */
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
