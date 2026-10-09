// 名称・規格の表記ゆれを吸収して、同じ品目として照合するためのキーを作る
//   全角/半角（ｍ/m、ｹ/ケ）、ヶ/ケ、大文字/小文字（Ea/EA）、空白の有無、
//   ㎟の表記（外字・㎟・mm2・sq）、×/x の違いを同じ扱いにする
export function normKey(value: string): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\uE000/g, "SQ") // 古いExcelで㎟が外字になっているもの
    .toUpperCase()
    .replace(/MM2|SQ|□/g, "SQ")
    .replace(/ヶ/g, "ケ")
    .replace(/ヵ/g, "カ")
    .replace(/[×X*]/g, "X")
    .replace(/\s+/g, "");
}

// 規格の（ ）書き（「(20m×4本)」など）を除いたキー。完全一致しない時の予備に使う
export function normKeyLoose(value: string): string {
  return normKey(String(value ?? "").replace(/[（(][^（）()]*[）)]/g, ""));
}

// 見出し判定用：空白と【】を除く
export function cleanLabel(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s【】]/g, "");
}

// ※の注意書きの先頭の「※」を除く（画面では※を別に表示し、Excelでは※を付けて出す）
export function stripNoteMark(value: string): string {
  return String(value ?? "").replace(/^[\s　]*[※＊*][\s　]*/, "");
}

// 外字の㎟を画面で読める文字に戻す
export function displayText(value: string): string {
  return String(value ?? "").replace(/\uE000/g, "㎟");
}

// Excelに書き出す時は、過去の見積りと同じ外字の㎟（社内のPCに登録してある文字）に戻す
export function gaijiText(value: string): string {
  return value.replace(/㎟/g, "\uE000");
}
