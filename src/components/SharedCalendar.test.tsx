import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todayJst } from "../lib/format";
import type { CalendarEvent } from "../types";
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

vi.mock("../auth", () => ({
  useAuth: () => ({ profile: { uid: "manager", displayName: "管理者", role: "employee_manager", active: true } })
}));

vi.mock("../i18n", () => ({ useI18n: () => ({ locale: "ja" }) }));

vi.mock("../services/api", () => serviceMocks);

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

    render(<SharedCalendar holidayOverrides={[]} notify={vi.fn()} />);

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

    render(<SharedCalendar holidayOverrides={[]} notify={vi.fn()} />);
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
    render(<SharedCalendar holidayOverrides={[]} notify={vi.fn()} />);
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
});
