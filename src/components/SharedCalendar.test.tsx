import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDate, todayJst } from "../lib/format";
import type { AttendanceRecord, CalendarEvent, DailyReport } from "../types";
import { SharedCalendar } from "./SharedCalendar";

const members = [
  { id: "fang", displayName: "方", linkedUserId: "fang-user", isCurrentUser: false, active: true, order: 10 },
  { id: "manager", displayName: "管理者", linkedUserId: "manager", isCurrentUser: true, active: true, order: 20 },
  { id: "president", displayName: "社長", active: true, order: 30 }
];

const serviceMocks = vi.hoisted(() => ({
  getCalendarMembers: vi.fn(),
  watchCalendarEvents: vi.fn(),
  saveCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn()
}));
const authState = vi.hoisted(() => ({
  profile: { uid: "manager", displayName: "管理者", role: "employee_manager", active: true }
}));

vi.mock("../auth", () => ({
  useAuth: () => ({ profile: authState.profile })
}));

vi.mock("../i18n", () => ({ useI18n: () => ({ locale: "ja" }) }));

vi.mock("../services/api", () => serviceMocks);

beforeEach(() => {
  authState.profile = { uid: "manager", displayName: "管理者", role: "employee_manager", active: true };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SharedCalendar", () => {
  it("shows member colors, an everyone event, and edit controls only for the creator", async () => {
    const today = todayJst();
    const events = [
      {
        id: "everyone",
        groupId: "everyone",
        date: today,
        startDate: today,
        endDate: today,
        eventType: "work",
        title: "全員会議",
        startTime: "10:00",
        endTime: "11:00",
        memo: "週の方針を確認",
        participants: members.map((member) => ({ memberId: member.id, displayName: member.displayName })),
        createdBy: "manager",
        createdByName: "管理者"
      },
      {
        id: "president-only",
        groupId: "president-only",
        date: today,
        startDate: today,
        endDate: today,
        eventType: "work",
        title: "社長の訪問予定",
        startTime: "",
        endTime: "",
        memo: "",
        participants: [{ memberId: "president", displayName: "社長" }],
        createdBy: "fang",
        createdByName: "方"
      }
    ] as CalendarEvent[];
    serviceMocks.getCalendarMembers.mockResolvedValue(members);
    serviceMocks.watchCalendarEvents.mockImplementation((_profile, _from, _to, callback) => {
      callback(events);
      return vi.fn();
    });

    render(<SharedCalendar attendance={[]} reports={[]} holidayOverrides={[]} notify={vi.fn()} />);

    expect(await screen.findByText("全員会議")).toBeInTheDocument();
    expect(screen.getByText("社長の訪問予定")).toBeInTheDocument();
    expect(screen.getAllByText("全員").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("全員会議を編集")).toBeInTheDocument();
    expect(screen.queryByLabelText("社長の訪問予定を編集")).not.toBeInTheDocument();
    for (const member of members) expect(screen.getAllByText(member.displayName).length).toBeGreaterThan(0);
  });

  it("opens a new event form with the signed-in creator selected", async () => {
    serviceMocks.getCalendarMembers.mockResolvedValue(members);
    serviceMocks.watchCalendarEvents.mockImplementation((_profile, _from, _to, callback) => {
      callback([]);
      return vi.fn();
    });

    render(<SharedCalendar attendance={[]} reports={[]} holidayOverrides={[]} notify={vi.fn()} />);
    const addButton = await screen.findByRole("button", { name: "予定を追加" });
    await waitFor(() => expect(addButton).toBeEnabled());
    fireEvent.click(addButton);

    expect(screen.getByRole("dialog", { name: "予定を追加" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "管理者" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "方" })).not.toBeChecked();
  });

  it("selects all three members and hides private fields for leave", async () => {
    serviceMocks.getCalendarMembers.mockResolvedValue(members);
    serviceMocks.watchCalendarEvents.mockImplementation((_profile, _from, _to, callback) => { callback([]); return vi.fn(); });
    render(<SharedCalendar attendance={[]} reports={[]} holidayOverrides={[]} notify={vi.fn()} />);
    const addButton = await screen.findByRole("button", { name: "予定を追加" });
    await waitFor(() => expect(addButton).toBeEnabled());
    fireEvent.click(addButton);
    fireEvent.click(screen.getByText("休み", { selector: ".calendar-event-type-field span" }));
    fireEvent.click(screen.getByRole("button", { name: "全員（3人）" }));
    for (const member of members) expect(screen.getByRole("checkbox", { name: member.displayName })).toBeChecked();
    expect(screen.queryByText("件名")).not.toBeInTheDocument();
    expect(screen.getByText(/理由・メモ・時刻は保存しません/)).toBeInTheDocument();
    expect(document.querySelector(".calendar-leave-privacy .calendar-leave-mark")).toHaveTextContent("休");
    expect(document.querySelector(".lucide-umbrella")).not.toBeInTheDocument();
  });

  it("shows submitted and missing daily-report days while excluding a company holiday without attendance", async () => {
    const today = todayJst();
    const holiday = previousDate(today, 1);
    const submittedDate = previousDate(today, 2);
    serviceMocks.getCalendarMembers.mockResolvedValue(members);
    serviceMocks.watchCalendarEvents.mockImplementation((_profile, _from, _to, callback) => { callback([]); return vi.fn(); });

    render(<SharedCalendar
      attendance={[] as AttendanceRecord[]}
      reports={[{ userId: "manager", reportDate: submittedDate }] as DailyReport[]}
      holidayOverrides={[{ id: "holiday", date: holiday, dayType: "company_holiday", label: "臨時休業" }]}
      notify={vi.fn()}
    />);

    expect(await screen.findByLabelText(/日報の提出状況/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${formatDate(submittedDate)}、日報提出済み` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${formatDate(today)}、日報未提出` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${formatDate(holiday)}、臨時休業` })).not.toHaveAccessibleName(/日報未提出/);
  });

  it("hides report status on the signed-in member's leave without attendance", async () => {
    const today = todayJst();
    serviceMocks.getCalendarMembers.mockResolvedValue(members);
    serviceMocks.watchCalendarEvents.mockImplementation((_profile, _from, _to, callback) => { callback([leaveEvent(today, { memberId: "manager", displayName: "管理者" })]); return vi.fn(); });

    render(<SharedCalendar
      attendance={[]}
      reports={[{ userId: "manager", reportDate: today }] as DailyReport[]}
      holidayOverrides={[{ id: "workday", date: today, dayType: "workday" }]}
      notify={vi.fn()}
    />);

    const day = await screen.findByRole("button", { name: `${formatDate(today)}、予定1件` });
    expect(day).not.toHaveAccessibleName(/日報提出済み|日報未提出/);
  });

  it("keeps the signed-in member's report status when only another member is on leave", async () => {
    const today = todayJst();
    serviceMocks.getCalendarMembers.mockResolvedValue(members);
    serviceMocks.watchCalendarEvents.mockImplementation((_profile, _from, _to, callback) => { callback([leaveEvent(today, { memberId: "fang", displayName: "方" })]); return vi.fn(); });

    render(<SharedCalendar attendance={[]} reports={[]} holidayOverrides={[{ id: "workday", date: today, dayType: "workday" }]} notify={vi.fn()} />);

    expect(await screen.findByRole("button", { name: `${formatDate(today)}、予定1件、日報未提出` })).toBeInTheDocument();
  });

  it("recognizes a legacy user id as the signed-in member's leave", async () => {
    const today = todayJst();
    serviceMocks.getCalendarMembers.mockResolvedValue(members);
    serviceMocks.watchCalendarEvents.mockImplementation((_profile, _from, _to, callback) => { callback([leaveEvent(today, { userId: "manager", displayName: "管理者" })]); return vi.fn(); });

    render(<SharedCalendar attendance={[]} reports={[]} holidayOverrides={[{ id: "workday", date: today, dayType: "workday" }]} notify={vi.fn()} />);

    const day = await screen.findByRole("button", { name: `${formatDate(today)}、予定1件` });
    expect(day).not.toHaveAccessibleName(/日報未提出/);
  });

  it("hides report status for the signed-in member's leave even with attendance", async () => {
    const today = todayJst();
    serviceMocks.getCalendarMembers.mockResolvedValue(members);
    serviceMocks.watchCalendarEvents.mockImplementation((_profile, _from, _to, callback) => { callback([leaveEvent(today, { memberId: "manager", displayName: "管理者" })]); return vi.fn(); });

    render(<SharedCalendar
      attendance={[{ userId: "manager", workDate: today }] as AttendanceRecord[]}
      reports={[]}
      holidayOverrides={[{ id: "holiday", date: today, dayType: "company_holiday", label: "臨時休業" }]}
      notify={vi.fn()}
    />);

    const day = await screen.findByRole("button", { name: `${formatDate(today)}、臨時休業、予定1件` });
    expect(day).not.toHaveAccessibleName(/日報提出済み|日報未提出/);
  });

  it("shows report status for holiday work when the signed-in member has not requested leave", async () => {
    const today = todayJst();
    serviceMocks.getCalendarMembers.mockResolvedValue(members);
    serviceMocks.watchCalendarEvents.mockImplementation((_profile, _from, _to, callback) => { callback([]); return vi.fn(); });

    render(<SharedCalendar
      attendance={[{ userId: "manager", workDate: today }] as AttendanceRecord[]}
      reports={[]}
      holidayOverrides={[{ id: "holiday", date: today, dayType: "company_holiday", label: "臨時休業" }]}
      notify={vi.fn()}
    />);

    expect(await screen.findByRole("button", { name: `${formatDate(today)}、臨時休業、日報未提出` })).toBeInTheDocument();
  });

  it("does not render report status for the president viewer", async () => {
    authState.profile = { uid: "president", displayName: "社長", role: "president_viewer", active: true };
    serviceMocks.getCalendarMembers.mockResolvedValue(members);
    serviceMocks.watchCalendarEvents.mockImplementation((_profile, _from, _to, callback) => { callback([]); return vi.fn(); });

    render(<SharedCalendar
      attendance={[{ userId: "president", workDate: todayJst() }] as AttendanceRecord[]}
      reports={[{ userId: "president", reportDate: todayJst() }] as DailyReport[]}
      holidayOverrides={[]}
      notify={vi.fn()}
    />);

    await screen.findByText("共有業務カレンダー");
    expect(screen.queryByLabelText("日報の提出状況")).not.toBeInTheDocument();
    expect(document.querySelector(".calendar-day-report-status")).not.toBeInTheDocument();
    expect(document.querySelector(".calendar-selected-statuses .calendar-report-status")).not.toBeInTheDocument();
  });

  it("does not show provisional report marks while calendar events are loading", async () => {
    serviceMocks.getCalendarMembers.mockResolvedValue(members);
    serviceMocks.watchCalendarEvents.mockImplementation(() => vi.fn());

    render(<SharedCalendar attendance={[]} reports={[]} holidayOverrides={[]} notify={vi.fn()} />);

    await screen.findByText("予定を読み込み中");
    expect(document.querySelector(".calendar-day-report-status")).not.toBeInTheDocument();
    expect(document.querySelector(".calendar-selected-statuses .calendar-report-status")).not.toBeInTheDocument();
  });
});

function leaveEvent(date: string, participant: { memberId?: string; userId?: string; displayName: string }): CalendarEvent {
  return {
    id: `leave-${participant.memberId || participant.userId}`,
    groupId: `leave-${participant.memberId || participant.userId}`,
    date,
    startDate: date,
    endDate: date,
    eventType: "leave",
    title: "",
    startTime: "",
    endTime: "",
    memo: "",
    participants: [participant],
    createdBy: participant.userId || participant.memberId || "manager",
    createdByName: participant.displayName
  } as CalendarEvent;
}

function previousDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}
