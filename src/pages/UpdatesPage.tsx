import { useState } from "react";
import { Search } from "lucide-react";
import { updates, type UpdateKind } from "../data/updates";
import { useI18n } from "../i18n";

const sortedUpdates = [...updates].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
const kindClasses: Record<UpdateKind, string> = { feature: "green", improvement: "blue", fix: "amber" };
const copy = {
  ja: {
    introduction: "機能の追加・改善・不具合修正を、新しい順に確認できます。",
    search: "更新情報を検索",
    placeholder: "機能名や修正内容で検索",
    timezone: "日時は日本時間（JST）",
    history: "更新履歴",
    date: "更新日時",
    areas: "変更したところ",
    changes: "修正内容",
    benefits: "できるようになったこと",
    empty: "該当する更新情報はありません。別の言葉で検索してください。",
    clear: "検索をクリア",
    kinds: { feature: "機能追加", improvement: "改善", fix: "不具合修正" }
  },
  "zh-CN": {
    introduction: "按时间从新到旧查看新增功能、功能改进及问题修复。",
    search: "搜索更新信息",
    placeholder: "搜索功能名称或修改内容",
    timezone: "时间为日本时间（JST）",
    history: "更新记录",
    date: "更新时间",
    areas: "修改位置",
    changes: "修改内容",
    benefits: "现在可以做什么",
    empty: "没有符合条件的更新信息，请尝试其他关键词。",
    clear: "清除搜索",
    kinds: { feature: "新增功能", improvement: "功能改进", fix: "问题修复" }
  }
} as const;

export function UpdatesPage() {
  const { locale, t } = useI18n();
  const [query, setQuery] = useState("");
  const labels = copy[locale];
  const searchTerm = query.trim().toLocaleLowerCase(locale);
  const filtered = sortedUpdates.filter((entry) => {
    const content = entry.content[locale];
    return [content.title, ...content.areas, ...content.changes, ...content.benefits]
      .join(" ").toLocaleLowerCase(locale).includes(searchTerm);
  });
  const dateFormatter = new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "zh-CN", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });

  return <main className="page updates-page" aria-labelledby="updates-heading">
    <header className="page-heading">
      <h1 id="updates-heading">{t("updates")}</h1>
      <p>{labels.introduction}</p>
    </header>
    <div className="updates-toolbar">
      <label className="updates-search">
        {labels.search}
        <div className="input-with-icon">
          <Search size={18} aria-hidden="true" />
          <input type="search" value={query} placeholder={labels.placeholder} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </label>
      <div className="updates-summary">
        <span role="status">{locale === "ja" ? `${filtered.length}件 / 全${updates.length}件` : `${filtered.length} 条 / 共 ${updates.length} 条`}</span>
        <span>{labels.timezone}</span>
      </div>
    </div>
    {filtered.length ? <ol className="updates-list" aria-label={labels.history}>
      {filtered.map((entry) => {
        const content = entry.content[locale];
        return <li key={entry.id}>
          <article className="card update-entry" aria-labelledby={`update-${entry.id}`}>
            <div className="update-meta">
              <span>{labels.date}</span>
              <time dateTime={entry.updatedAt}>{dateFormatter.format(new Date(entry.updatedAt))}</time>
              <span className={`tag ${kindClasses[entry.kind]}`}>{labels.kinds[entry.kind]}</span>
            </div>
            <div className="update-body">
              <h2 id={`update-${entry.id}`}>{content.title}</h2>
              <div className="update-areas"><span>{labels.areas}</span>{content.areas.map((area) => <span className="tag soft" key={area}>{area}</span>)}</div>
              <div className="update-details">
                <section>
                  <h3>{labels.changes}</h3>
                  <ul>{content.changes.map((change) => <li key={change}>{change}</li>)}</ul>
                </section>
                <section className="update-benefits">
                  <h3>{labels.benefits}</h3>
                  <ul>{content.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}</ul>
                </section>
              </div>
            </div>
          </article>
        </li>;
      })}
    </ol> : <div className="card updates-empty">
      <p>{labels.empty}</p>
      <button type="button" className="button secondary" onClick={() => setQuery("")}>{labels.clear}</button>
    </div>}
  </main>;
}
