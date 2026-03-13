// 全角英数→半角
function toHankaku(str: string): string {
  return str
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ");
}

// ひらがな→カタカナ
function toKatakana(str: string): string {
  return str.replace(/[\u3041-\u3096]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60)
  );
}

// ローマ字→カタカナ（長音符・促音は無視して読み変換）
function romajiToKatakana(str: string): string {
  let s = str;
  const r: [RegExp, string][] = [
    // 3文字パターン優先
    [/sha/g, "シャ"], [/shi/g, "シ"], [/shu/g, "シュ"], [/she/g, "シェ"], [/sho/g, "ショ"],
    [/chi/g, "チ"], [/cha/g, "チャ"], [/chu/g, "チュ"], [/che/g, "チェ"], [/cho/g, "チョ"],
    [/tsu/g, "ツ"],
    [/kya/g, "キャ"], [/kyu/g, "キュ"], [/kyo/g, "キョ"],
    [/nya/g, "ニャ"], [/nyu/g, "ニュ"], [/nyo/g, "ニョ"],
    [/hya/g, "ヒャ"], [/hyu/g, "ヒュ"], [/hyo/g, "ヒョ"],
    [/mya/g, "ミャ"], [/myu/g, "ミュ"], [/myo/g, "ミョ"],
    [/rya/g, "リャ"], [/ryu/g, "リュ"], [/ryo/g, "リョ"],
    [/gya/g, "ギャ"], [/gyu/g, "ギュ"], [/gyo/g, "ギョ"],
    [/bya/g, "ビャ"], [/byu/g, "ビュ"], [/byo/g, "ビョ"],
    [/pya/g, "ピャ"], [/pyu/g, "ピュ"], [/pyo/g, "ピョ"],
    [/ja/g, "ジャ"], [/ji/g, "ジ"], [/ju/g, "ジュ"], [/je/g, "ジェ"], [/jo/g, "ジョ"],
    // 2文字パターン
    [/ka/g, "カ"], [/ki/g, "キ"], [/ku/g, "ク"], [/ke/g, "ケ"], [/ko/g, "コ"],
    [/ga/g, "ガ"], [/gi/g, "ギ"], [/gu/g, "グ"], [/ge/g, "ゲ"], [/go/g, "ゴ"],
    [/sa/g, "サ"], [/su/g, "ス"], [/se/g, "セ"], [/so/g, "ソ"],
    [/za/g, "ザ"], [/zu/g, "ズ"], [/ze/g, "ゼ"], [/zo/g, "ゾ"],
    [/ta/g, "タ"], [/te/g, "テ"], [/to/g, "ト"],
    [/da/g, "ダ"], [/de/g, "デ"], [/do/g, "ド"],
    [/na/g, "ナ"], [/ni/g, "ニ"], [/nu/g, "ヌ"], [/ne/g, "ネ"], [/no/g, "ノ"],
    [/ha/g, "ハ"], [/hi/g, "ヒ"], [/fu/g, "フ"], [/hu/g, "フ"], [/he/g, "ヘ"], [/ho/g, "ホ"],
    [/ma/g, "マ"], [/mi/g, "ミ"], [/mu/g, "ム"], [/me/g, "メ"], [/mo/g, "モ"],
    [/ya/g, "ヤ"], [/yu/g, "ユ"], [/yo/g, "ヨ"],
    [/ra/g, "ラ"], [/ri/g, "リ"], [/ru/g, "ル"], [/re/g, "レ"], [/ro/g, "ロ"],
    [/wa/g, "ワ"], [/wo/g, "ヲ"],
    [/ba/g, "バ"], [/bi/g, "ビ"], [/bu/g, "ブ"], [/be/g, "ベ"], [/bo/g, "ボ"],
    [/pa/g, "パ"], [/pi/g, "ピ"], [/pu/g, "プ"], [/pe/g, "ペ"], [/po/g, "ポ"],
    // n処理（母音の前以外はン）
    [/nn/g, "ン"], [/n(?=[^aiueo]|$)/g, "ン"],
    // 単独母音
    [/a/g, "ア"], [/i/g, "イ"], [/u/g, "ウ"], [/e/g, "エ"], [/o/g, "オ"],
  ];
  for (const [pat, rep] of r) s = s.replace(pat, rep);
  return s;
}

// 完全正規化：全角→半角 → 小文字 → ひらがな→カタカナ → ローマ字→カタカナ
function fullNormalize(str: string): string {
  return romajiToKatakana(toKatakana(toHankaku(str.trim().toLowerCase())));
}

export function isFuzzyMatch(a: string, b: string): boolean {
  const x = fullNormalize(a);
  const y = fullNormalize(b);
  if (!x || !y) return false;

  // 部分一致（前方一致・後方一致・含む）
  if (x.includes(y) || y.includes(x)) return true;

  // バイグラム類似度（Dice係数）
  const getBigrams = (str: string): Set<string> => {
    const s = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) s.add(str.slice(i, i + 2));
    return s;
  };
  const bx = getBigrams(x);
  const by = getBigrams(y);
  if (bx.size === 0 || by.size === 0) return false;
  let common = 0;
  bx.forEach((bg) => { if (by.has(bg)) common++; });
  return (2 * common) / (bx.size + by.size) >= 0.35;
}
