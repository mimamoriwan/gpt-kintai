import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";

vi.mock("../auth", () => ({
  useAuth: () => ({ profile: { uid: "president", displayName: "社長", role: "president_viewer", active: true } })
}));

vi.mock("../i18n", () => ({
  useI18n: () => ({ locale: "ja", t: (key: string) => key })
}));

vi.mock("../components/SharedCalendar", () => ({
  SharedCalendar: () => <div>共有業務カレンダー本体</div>
}));

vi.mock("../services/api", () => ({
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  correctAttendance: vi.fn()
}));

afterEach(cleanup);

describe("HomePage president view", () => {
  it("shows the shared calendar without attendance or daily-report controls", () => {
    render(<HomePage attendance={[]} reports={[]} holidayOverrides={[]} onReport={vi.fn()} notify={vi.fn()} />);

    expect(screen.getByText("共有業務カレンダー本体")).toBeInTheDocument();
    expect(screen.queryByText("workStatus")).not.toBeInTheDocument();
    expect(screen.queryByText("reportReminder")).not.toBeInTheDocument();
    expect(screen.queryByText("最近の勤務")).not.toBeInTheDocument();
  });
});
