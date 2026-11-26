// パスワードの決まり（新規登録・再設定で共通）

export const PASSWORD_RULES = [
  "10文字以上",
  "大文字（A〜Z）を含む",
  "小文字（a〜z）を含む",
  "数字（0〜9）を含む",
  "記号（! @ # $ % ^ & *）のいずれかを含む",
];

export const PASSWORD_RULE_MESSAGE = "パスワードは大文字・小文字・数字・記号を含み10文字以上にしてください";

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{10,}$/;

export const isValidPassword = (password: string) => PASSWORD_REGEX.test(password);

// 口頭やメモで伝えても読み間違えにくい文字だけを使う（0とO、1とlとI などは除く）
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGIT = "23456789";
const SYMBOL = "!@#$%&*";

const randomInt = (max: number) => {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % max;
};

const pick = (chars: string) => chars[randomInt(chars.length)];

// 決まりを満たすパスワードを自動で作る
export function generatePassword(length = 12): string {
  const all = UPPER + LOWER + DIGIT;
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
