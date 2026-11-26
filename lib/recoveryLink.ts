// メールの「パスワード再設定」リンクで開かれた時の情報。
// Supabase は読み込みが済むと URL の # 以降を消すので、消される前（このファイルが読み込まれた時点）に控えておく

const hash = typeof window === "undefined" ? "" : window.location.hash;
const params = new URLSearchParams(hash.replace(/^#/, ""));

// 再設定リンクで開かれた時の # 以降（そうでなければ空）
export const recoveryLinkHash = params.get("type") === "recovery" ? hash : "";

// リンクが期限切れ・使用済みの時に Supabase が付けてくるエラー（なければ空）
export const recoveryLinkError = params.get("error_code") ?? params.get("error") ?? "";
