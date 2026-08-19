import { describe, expect, it } from "vitest";
import { calendarEventPayload, calendarGridDays, calendarGridRange, calendarMemberColorMap, isEveryoneCalendarEvent, shiftCalendarMonth, sortCalendarEvents } from "./calendar";
import type { CalendarEvent } from "../types";

describe("shared calendar helpers", () => {
  it("builds a six-week Monday-first month grid", () => {
    const days = calendarGridDays("2026-08");
    expect(days).toHaveLength(42);
    expect(days[0]).toEqual({ date: "2026-07-27", dayNumber: 27, inCurrentMonth: false });
    expect(days[41].date).toBe("2026-09-06");
    expect(calendarGridRange("2026-08")).toEqual({ fromDate: "2026-07-27", toDate: "2026-09-06" });
  });

  it("moves across year boundaries", () => {
    expect(shiftCalendarMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftCalendarMonth("2026-12", 1)).toBe("2027-01");
  });

  it("sorts all-day events before timed events and then by start time", () => {
    const base = {
      date: "2026-08-03",
      endTime: "",
      memo: "",
      participants: [],
      createdBy: "manager",
      createdByName: "管理者"
    } as unknown as CalendarEvent;
    const rows = sortCalendarEvents([
      { ...base, id: "late", title: "午後", startTime: "15:00" },
      { ...base, id: "all-day", title: "終日", startTime: "" },
      { ...base, id: "early", title: "午前", startTime: "09:30" }
    ]);
    expect(rows.map((row) => row.id)).toEqual(["all-day", "early", "late"]);
  });

  it("assigns distinct stable colors to the three current members", () => {
    const first = calendarMemberColorMap(["fang", "manager", "president"]);
    const second = calendarMemberColorMap(["president", "fang", "manager"]);
    expect(new Set(first.values()).size).toBe(3);
    expect([...first.entries()]).toEqual([...second.entries()]);
  });

  it("marks only one event shared by every current member as an everyone event", () => {
    const event = {
      participants: [
        { memberId: "fang", displayName: "方" },
        { memberId: "manager", displayName: "管理者" },
        { memberId: "president", displayName: "社長" }
      ]
    } as CalendarEvent;
    expect(isEveryoneCalendarEvent(event, ["fang", "manager", "president"])).toBe(true);
    expect(isEveryoneCalendarEvent({ ...event, participants: event.participants.slice(0, 2) }, ["fang", "manager", "president"])).toBe(false);
  });

  it("omits unset optional IDs from a new event payload", () => {
    const payload = calendarEventPayload({
      id: undefined,
      groupId: undefined,
      eventType: "business_trip",
      startDate: "2026-08-19",
      endDate: "2026-08-22",
      title: "福岡・大分出張",
      participantIds: ["manager", "fang", "president"]
    });
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("groupId");
    expect(payload).toMatchObject({ startTime: "", endTime: "", memo: "" });
  });

  it("keeps valid IDs when editing an existing event", () => {
    const payload = calendarEventPayload({
      id: "event_20260819",
      groupId: "group-1",
      eventType: "work",
      startDate: "2026-08-19",
      endDate: "2026-08-19",
      title: "商談",
      participantIds: ["manager"]
    });
    expect(payload).toMatchObject({ id: "event_20260819", groupId: "group-1" });
  });
});
