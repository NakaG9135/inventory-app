"use client";

// パスワード欄は普段●で隠し、確認したい時だけチェックを入れて見えるようにする
export default function ShowPasswordToggle({
  checked,
  onChange,
  className = "mb-2",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label className={`text-sm text-gray-600 flex items-center gap-1 cursor-pointer select-none ${className}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      入力したパスワードを表示する
    </label>
  );
}
