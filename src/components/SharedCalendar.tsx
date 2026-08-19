import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { BriefcaseBusiness, CalendarDays, ChevronLeft, ChevronRight, Clock3, LoaderCircle, Pencil, Plane, Plus, Trash2, Users } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { CALENDAR_MEMBER_COLORS, calendarGridDays, calendarGridRange, calendarMemberColorMap, isEveryoneCalendarEvent, shiftCalendarMonth, sortCalendarEvents } from "../lib/calendar";
import { resolveCompanyDay } from "../lib/companyCalendar";
import { formatDate, todayJst } from "../lib/format";
import { deleteCalendarEvent, getCalendarMembers, saveCalendarEvent, watchCalendarEvents } from "../services/api";
import type { CalendarEvent, CalendarEventInput, CalendarEventType, CalendarMember, CompanyHolidayOverride } from "../types";

type Notify = (type: "success" | "error", message: string) => void;
type MemberStyle = CSSProperties & { "--member-color": string; "--member-soft": string };

export function SharedCalendar({ holidayOverrides, notify }: { holidayOverrides: CompanyHolidayOverride[]; notify: Notify }) {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const today = todayJst();
  const [viewMonth, setViewMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(today);
  const [members, setMembers] = useState<CalendarMember[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [editor, setEditor] = useState<{ date: string; event?: CalendarEvent } | null>(null);
  const days = useMemo(() => calendarGridDays(viewMonth), [viewMonth]);
  const range = useMemo(() => calendarGridRange(viewMonth), [viewMonth]);
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();
    for (const event of sortCalendarEvents(events)) grouped.set(event.date, [...(grouped.get(event.date) || []), event]);
    return grouped;
  }, [events]);
  const selectedEvents = eventsByDate.get(selectedDate) || [];
  const allMemberIds = useMemo(() => [
    ...members.map((member) => member.id),
    ...events.flatMap((event) => event.participants.map(participantId))
  ], [events, members]);
  const colorMap = useMemo(() => calendarMemberColorMap(allMemberIds), [allMemberIds]);
  const monthTitle = useMemo(() => new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "zh-CN", {
    year: "numeric", month: "long", timeZone: "UTC"
  }).format(new Date(`${viewMonth}-01T00:00:00Z`)), [locale, viewMonth]);
  const weekdayLabels = locale === "ja" ? ["月", "火", "水", "木", "金", "土", "日"] : ["一", "二", "三", "四", "五", "六", "日"];

  useEffect(() => {
    if (!profile) return;
    let active = true;
    setLoadingMembers(true);
    void getCalendarMembers().then((rows) => { if (active) setMembers(rows); })
      .catch((error) => { if (active) notify("error", calendarErrorMessage(error, locale)); })
      .finally(() => { if (active) setLoadingMembers(false); });
    return () => { active = false; };
  }, [locale, notify, profile?.uid]);

  useEffect(() => {
    if (!profile) return;
    setLoadingEvents(true);
    return watchCalendarEvents(profile, range.fromDate, range.toDate, (rows) => {
      setEvents(rows); setLoadingEvents(false);
    }, (error) => {
      setLoadingEvents(false); notify("error", calendarErrorMessage(error, locale));
    });
  }, [locale, notify, profile?.demoDatasetId, profile?.isDemo, profile?.uid, range.fromDate, range.toDate]);

  if (!profile) return null;

  function memberStyle(memberId: string): MemberStyle {
    const palette = CALENDAR_MEMBER_COLORS[colorMap.get(memberId) ?? 0];
    return { "--member-color": palette.color, "--member-soft": palette.soft };
  }
  function isEveryoneEvent(event: CalendarEvent): boolean {
    return isEveryoneCalendarEvent(event, members.map((member) => member.id));
  }
  function selectDay(date: string) {
    setSelectedDate(date);
    if (date.slice(0, 7) !== viewMonth) setViewMonth(date.slice(0, 7));
  }
  function changeMonth(amount: number) {
    const next = shiftCalendarMonth(viewMonth, amount);
    setViewMonth(next); setSelectedDate(`${next}-01`);
  }
  function returnToToday() { setViewMonth(today.slice(0, 7)); setSelectedDate(today); }

  const selectedCompanyDay = resolveCompanyDay(selectedDate, holidayOverrides.find((item) => item.date === selectedDate));

  return <>
    <section className="card shared-calendar-card" aria-labelledby="shared-calendar-title">
      <header className="calendar-card-header">
        <div><span className="eyebrow"><CalendarDays size={14} />{locale === "ja" ? "共有業務カレンダー" : "共享工作日历"}</span><h2 id="shared-calendar-title">{monthTitle}</h2></div>
        <div className="calendar-navigation" aria-label={locale === "ja" ? "月を移動" : "切换月份"}>
          <button type="button" onClick={() => changeMonth(-1)} aria-label={locale === "ja" ? "前の月" : "上个月"}><ChevronLeft size={19} /></button>
          <button type="button" className="calendar-today-button" onClick={returnToToday}>{locale === "ja" ? "今月" : "本月"}</button>
          <button type="button" onClick={() => changeMonth(1)} aria-label={locale === "ja" ? "次の月" : "下个月"}><ChevronRight size={19} /></button>
        </div>
      </header>

      <div className="calendar-legends">
        <div className="calendar-member-legend" aria-label={locale === "ja" ? "共有メンバー" : "共享成员"}>
          {loadingMembers ? <span className="calendar-loading-inline"><LoaderCircle className="spin" size={15} />{locale === "ja" ? "メンバーを確認中" : "正在读取成员"}</span> : members.map((member) => <span className="calendar-member-label" style={memberStyle(member.id)} key={member.id}><i />{member.displayName}</span>)}
        </div>
        <div className="calendar-type-legend" aria-label={locale === "ja" ? "予定の種類" : "日程类型"}>
          <span className="calendar-type-chip work"><BriefcaseBusiness size={13} />{eventTypeLabel("work", locale)}</span>
          <span className="calendar-type-chip business_trip"><Plane size={13} />{eventTypeLabel("business_trip", locale)}</span>
          <span className="calendar-type-chip leave"><LeaveMark />{eventTypeLabel("leave", locale)}</span>
        </div>
      </div>

      <div className="shared-calendar-layout">
        <div className="calendar-month-panel">
          <div className="calendar-weekdays" aria-hidden="true">{weekdayLabels.map((label, index) => <span className={index >= 5 ? "holiday" : ""} key={label}>{label}</span>)}</div>
          <div className="calendar-month-grid" aria-label={monthTitle}>
            {days.map((day) => {
              const dayEvents = eventsByDate.get(day.date) || [];
              const participantIds = [...new Set(dayEvents.flatMap((event) => event.participants.map(participantId)))];
              const eventTypes = [...new Set(dayEvents.map((event) => event.eventType || "work"))];
              const companyDay = resolveCompanyDay(day.date, holidayOverrides.find((item) => item.date === day.date));
              const namedHoliday = companyDay.isHoliday && companyDay.source !== "weekend";
              const hasEveryoneEvent = dayEvents.some(isEveryoneEvent);
              const ariaEventCount = dayEvents.length ? (locale === "ja" ? `、予定${dayEvents.length}件` : `，${dayEvents.length}项日程`) : "";
              return <button type="button" key={day.date}
                className={`calendar-day ${day.inCurrentMonth ? "" : "outside"} ${companyDay.isHoliday ? "holiday" : ""} ${day.date === today ? "today" : ""} ${day.date === selectedDate ? "selected" : ""}`}
                aria-label={`${formatDate(day.date, locale === "ja" ? "ja-JP" : "zh-CN")}${namedHoliday ? `、${companyDay.label}` : ""}${ariaEventCount}`}
                aria-pressed={day.date === selectedDate} onClick={() => selectDay(day.date)}>
                <span className="calendar-day-number">{day.dayNumber}</span>
                {namedHoliday && <small className="calendar-holiday-name">{companyDay.label}</small>}
                <span className="calendar-day-type-markers" aria-hidden="true">{eventTypes.map((type) => <i className={`calendar-day-type ${type}`} key={type}>{type === "business_trip" ? <Plane size={9} /> : type === "leave" ? "休" : <BriefcaseBusiness size={9} />}</i>)}</span>
                <span className="calendar-day-markers" aria-hidden="true">
                  {hasEveryoneEvent && <i className="calendar-everyone-marker"><Users size={10} />{locale === "ja" ? "全員" : "全员"}</i>}
                  {participantIds.slice(0, 3).map((memberId) => <i className="calendar-person-dot" style={memberStyle(memberId)} key={memberId} />)}
                </span>
                {dayEvents.length > 1 && <span className="calendar-event-count" aria-hidden="true">{dayEvents.length}</span>}
              </button>;
            })}
          </div>
          {loadingEvents && <div className="calendar-loading-overlay"><LoaderCircle className="spin" size={23} /><span>{locale === "ja" ? "予定を読み込み中" : "正在读取日程"}</span></div>}
        </div>

        <aside className="calendar-day-panel">
          <div className="calendar-selected-heading">
            <div><small>{locale === "ja" ? "選択した日" : "已选日期"}</small><strong>{formatDate(selectedDate, locale === "ja" ? "ja-JP" : "zh-CN")}</strong>{selectedCompanyDay.isHoliday && <span className="calendar-holiday-chip">{selectedCompanyDay.label}</span>}</div>
            <button className="button primary calendar-add-button" type="button" disabled={loadingMembers || members.length === 0} onClick={() => setEditor({ date: selectedDate })}><Plus size={17} />{locale === "ja" ? "予定を追加" : "添加日程"}</button>
          </div>
          <div className="calendar-day-events">
            {!loadingEvents && selectedEvents.length === 0 && <div className="calendar-empty"><CalendarDays size={26} /><strong>{locale === "ja" ? "予定はありません" : "暂无日程"}</strong><small>{locale === "ja" ? "業務予定・出張・休みを追加できます。" : "可添加工作安排、出差或休息。"}</small></div>}
            {selectedEvents.map((event) => <article className={`calendar-event-row event-${event.eventType}`} key={event.id}>
              <div className="calendar-event-time"><Clock3 size={15} /><span>{calendarTimeLabel(event, locale)}</span></div>
              <div className="calendar-event-copy">
                <div className="calendar-event-title"><span className={`calendar-type-chip ${event.eventType}`}>{eventTypeIcon(event.eventType)}{eventTypeLabel(event.eventType, locale)}</span><strong>{calendarEventTitle(event, locale)}</strong>{isEveryoneEvent(event) && <span className="calendar-all-chip"><Users size={12} />{locale === "ja" ? "全員" : "全员"}</span>}</div>
                {event.startDate !== event.endDate && <small className="calendar-event-range">{event.startDate} – {event.endDate}</small>}
                <div className="calendar-event-participants">{event.participants.map((participant) => <span className="calendar-member-label compact" style={memberStyle(participantId(participant))} key={participantId(participant)}><i />{participant.displayName}</span>)}</div>
                {event.eventType !== "leave" && event.memo && <p>{event.memo}</p>}
                <small>{locale === "ja" ? `作成：${event.createdByName}` : `创建：${event.createdByName}`}</small>
              </div>
              {event.createdBy === profile.uid && <button type="button" className="calendar-edit-button" aria-label={locale === "ja" ? `${calendarEventTitle(event, locale)}を編集` : `编辑${calendarEventTitle(event, locale)}`} onClick={() => setEditor({ date: event.date, event })}><Pencil size={16} /></button>}
            </article>)}
          </div>
          <p className="calendar-record-note">{locale === "ja" ? "休みを含む予定は共有メンバー全員に表示されます。勤怠実績・有給残数・日報には反映されません。" : "包括休息在内的日程会向所有成员显示，不会计入考勤、带薪休假余额或日报。"}</p>
        </aside>
      </div>
    </section>
    {editor && <CalendarEventEditor key={editor.event?.groupId || editor.date} date={editor.date} event={editor.event} members={members} notify={notify} onClose={() => setEditor(null)} />}
  </>;
}

function CalendarEventEditor({ date, event, members, notify, onClose }: { date: string; event?: CalendarEvent; members: CalendarMember[]; notify: Notify; onClose: () => void }) {
  const { locale } = useI18n();
  const selfMember = members.find((member) => member.isCurrentUser);
  const [form, setForm] = useState<CalendarEventInput>({
    ...(event ? { id: event.id, groupId: event.groupId } : {}),
    eventType: event?.eventType || "work",
    startDate: event?.startDate || date,
    endDate: event?.endDate || date,
    title: event?.eventType === "leave" ? "" : event?.title || "",
    startTime: event?.startTime || "",
    endTime: event?.endTime || "",
    memo: event?.eventType === "leave" ? "" : event?.memo || "",
    participantIds: event?.participants.map(participantId) || (selfMember ? [selfMember.id] : [])
  });
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const dayCount = dateSpan(form.startDate, form.endDate);
  const validTimes = !form.endTime || Boolean(form.startTime);
  const orderedTimes = !form.startTime || !form.endTime || form.endTime > form.startTime;
  const canSubmit = Boolean((form.eventType === "leave" || form.title.trim()) && form.participantIds.length && dayCount >= 1 && dayCount <= 60 && validTimes && orderedTimes);

  function toggleParticipant(id: string) {
    setForm((current) => {
      const selected = current.participantIds.includes(id);
      if (selected) return { ...current, participantIds: current.participantIds.filter((item) => item !== id) };
      if (current.participantIds.length >= 3) return current;
      return { ...current, participantIds: [...current.participantIds, id] };
    });
  }
  function selectEveryone() { setForm((current) => ({ ...current, participantIds: members.slice(0, 3).map((member) => member.id) })); }
  function changeType(eventType: CalendarEventType) {
    setForm((current) => eventType === "leave"
      ? { ...current, eventType, title: "", startTime: "", endTime: "", memo: "" }
      : { ...current, eventType });
  }
  async function submit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setErrorMessage("");
    try {
      await saveCalendarEvent(form);
      notify("success", locale === "ja" ? (event ? "予定を更新しました。" : "予定を追加しました。") : (event ? "日程已更新。" : "日程已添加。"));
      onClose();
    } catch (error) {
      const message = calendarErrorMessage(error, locale); setErrorMessage(message); notify("error", message);
    } finally { setBusy(false); }
  }
  async function remove() {
    if (!event || !window.confirm(locale === "ja" ? "この期間の予定をすべて削除しますか？" : "确定删除整个期间的日程吗？")) return;
    setBusy(true); setErrorMessage("");
    try {
      await deleteCalendarEvent(event.id, event.groupId);
      notify("success", locale === "ja" ? "期間全体の予定を削除しました。" : "已删除整个期间的日程。"); onClose();
    } catch (error) {
      const message = calendarErrorMessage(error, locale); setErrorMessage(message); notify("error", message);
    } finally { setBusy(false); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(mouseEvent) => { if (mouseEvent.target === mouseEvent.currentTarget && !busy) onClose(); }}>
    <form className="modal calendar-event-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-event-modal-title" onSubmit={(submitEvent) => void submit(submitEvent)}>
      <div className="calendar-modal-heading"><span className="modal-icon calendar"><CalendarDays size={24} /></span><div><h2 id="calendar-event-modal-title">{locale === "ja" ? (event ? "予定を編集" : "予定を追加") : (event ? "编辑日程" : "添加日程")}</h2><p>{locale === "ja" ? "通常予定・出張・休みを3人で共有します。" : "与三人共享工作安排、出差和休息。"}</p></div></div>
      <fieldset className="calendar-event-type-field"><legend>{locale === "ja" ? "予定の種類" : "日程类型"}</legend><div>{(["work", "business_trip", "leave"] as CalendarEventType[]).map((type) => <label className={`${type} ${form.eventType === type ? "selected" : ""}`} key={type}><input type="radio" name="calendar-event-type" checked={form.eventType === type} onChange={() => changeType(type)} /><span>{eventTypeIcon(type)}{eventTypeLabel(type, locale)}</span></label>)}</div></fieldset>
      <div className="calendar-date-fields">
        <label><span>{locale === "ja" ? "開始日" : "开始日期"}</span><input type="date" value={form.startDate} onChange={(changeEvent) => setForm({ ...form, startDate: changeEvent.target.value, endDate: changeEvent.target.value > form.endDate ? changeEvent.target.value : form.endDate })} required /></label>
        <label><span>{locale === "ja" ? "終了日" : "结束日期"}</span><input type="date" min={form.startDate} value={form.endDate} onChange={(changeEvent) => setForm({ ...form, endDate: changeEvent.target.value })} required /></label>
      </div>
      {dayCount > 60 && <p className="calendar-form-error" role="alert">{locale === "ja" ? "予定期間は60日以内にしてください。" : "日程期间请控制在60天以内。"}</p>}
      {form.eventType !== "leave" && <label><span>{locale === "ja" ? "件名" : "标题"}</span><input value={form.title} maxLength={100} onChange={(changeEvent) => setForm({ ...form, title: changeEvent.target.value })} placeholder={form.eventType === "business_trip" ? (locale === "ja" ? "例：大阪出張" : "例如：大阪出差") : (locale === "ja" ? "例：〇〇社との商談" : "例如：与〇〇公司洽谈")} required /></label>}
      <fieldset className="calendar-participant-field"><legend>{locale === "ja" ? "参加者（1〜3人）" : "参与者（1至3人）"}</legend><div className="calendar-participant-actions"><button className="button ghost" type="button" onClick={selectEveryone}><Users size={15} />{locale === "ja" ? `全員（${members.length}人）` : `全员（${members.length}人）`}</button></div><div>{members.map((member) => {
        const checked = form.participantIds.includes(member.id);
        return <label className={checked ? "selected" : ""} key={member.id}><input type="checkbox" checked={checked} disabled={!checked && form.participantIds.length >= 3} onChange={() => toggleParticipant(member.id)} /><span>{member.displayName}</span></label>;
      })}</div></fieldset>
      {form.eventType === "leave" ? <p className="calendar-leave-privacy"><LeaveMark variant="notice" />{locale === "ja" ? "カレンダーには参加者名と「休み」だけを表示します。理由・メモ・時刻は保存しません。" : "日历只显示参与者姓名和“休息”，不会保存原因、备注或时间。"}</p> : <>
        <div className="calendar-time-fields">
          <label><span>{locale === "ja" ? "開始時刻（任意）" : "开始时间（可选）"}</span><input type="time" value={form.startTime} onChange={(changeEvent) => setForm({ ...form, startTime: changeEvent.target.value, endTime: changeEvent.target.value ? form.endTime : "" })} /></label>
          <label><span>{locale === "ja" ? "終了時刻（任意）" : "结束时间（可选）"}</span><input type="time" value={form.endTime} disabled={!form.startTime} min={form.startTime || undefined} onChange={(changeEvent) => setForm({ ...form, endTime: changeEvent.target.value })} /></label>
        </div>
        <label><span>{locale === "ja" ? "メモ（任意）" : "备注（可选）"}</span><textarea rows={4} value={form.memo} maxLength={1000} onChange={(changeEvent) => setForm({ ...form, memo: changeEvent.target.value })} /><small className="calendar-character-count">{(form.memo || "").length}/1000</small></label>
      </>}
      {errorMessage && <p className="calendar-form-error" role="alert">{errorMessage}</p>}
      <div className="modal-actions calendar-modal-actions">
        {event && <button className="button calendar-delete-button" type="button" disabled={busy} onClick={() => void remove()}><Trash2 size={16} />{locale === "ja" ? "期間全体を削除" : "删除整个期间"}</button>}
        <span /><button className="button ghost" type="button" disabled={busy} onClick={onClose}>{locale === "ja" ? "キャンセル" : "取消"}</button><button className="button primary" type="submit" disabled={busy || !canSubmit}>{busy ? "…" : locale === "ja" ? "保存" : "保存"}</button>
      </div>
    </form>
  </div>;
}

function participantId(participant: CalendarEvent["participants"][number]): string { return participant.memberId || participant.userId || ""; }
function calendarEventTitle(event: CalendarEvent, locale: string): string {
  if (event.eventType !== "leave") return event.title;
  const names = event.participants.map((participant) => participant.displayName).join(locale === "ja" ? "・" : "、");
  return locale === "ja" ? `${names}・休み` : `${names}・休息`;
}
function eventTypeLabel(type: CalendarEventType, locale: string): string {
  const labels = locale === "ja" ? { work: "通常予定", business_trip: "出張", leave: "休み" } : { work: "工作安排", business_trip: "出差", leave: "休息" };
  return labels[type || "work"];
}
function eventTypeIcon(type: CalendarEventType) {
  return type === "business_trip" ? <Plane size={12} /> : type === "leave" ? <LeaveMark /> : <BriefcaseBusiness size={12} />;
}
function LeaveMark({ variant = "regular" }: { variant?: "regular" | "notice" }) {
  return <span className={`calendar-leave-mark ${variant}`} aria-hidden="true">休</span>;
}
function calendarTimeLabel(event: CalendarEvent, locale: string): string {
  if (!event.startTime) return locale === "ja" ? "終日" : "全天";
  return event.endTime ? `${event.startTime}–${event.endTime}` : `${event.startTime}〜`;
}
function dateSpan(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
}
function calendarErrorMessage(error: unknown, locale: string): string {
  const message = error instanceof Error ? error.message.replace(/^Firebase:\s*/i, "") : "";
  return message || (locale === "ja" ? "予定を処理できませんでした。" : "无法处理日程。");
}
