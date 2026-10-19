export function reportPeriodError(start: string, end: string, chinese = false): string {
  const valid = (value: string) => {
    const date = new Date(`${value}T00:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!valid(start) || !valid(end)) return chinese ? "请输入有效的开始和结束日期。" : "開始日と終了日を入力してください。";
  if (start > end) return chinese ? "结束日期不能早于开始日期。" : "終了日は開始日以降にしてください。";
  if (Date.parse(end) - Date.parse(start) >= 366 * 86400000) return chinese ? "期间请设为366天以内。" : "期間は366日以内で指定してください。";
  return "";
}
