import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessTranslationProvider, TranslatedText } from "./useBusinessTranslation";
import type { BusinessTranslation } from "./types";
const state = vi.hoisted(() => ({ locale: "zh-CN" }));
const translate = vi.hoisted(() => vi.fn());
vi.mock("../../i18n", () => ({ useI18n: () => ({ locale: state.locale }) }));
vi.mock("./api", () => ({ translateBusinessContent: translate }));
const resource = { id: "work-a", sourceLocale: "ja" as const, contentVersion: "version-a" };
function response(version = "version-a", fields = { name: "中文名称", description: "中文说明" }): BusinessTranslation { return { kind: "initiative", id: "work-a", targetLocale: "zh-CN", contentVersion: version, fields, cached: false }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { vi.resetAllMocks(); state.locale = "zh-CN"; });
describe("business translation isolation", () => {
  it("shows the original after failure and retries without any content save", async () => {
    translate.mockRejectedValueOnce(new Error("translation down")).mockResolvedValueOnce(response());
    render(<BusinessTranslationProvider uid="yasushi"><TranslatedText kind="initiative" resource={resource} field="name" text="日本語の名称" /></BusinessTranslationProvider>);
    expect(await screen.findByText("翻译失败・显示原文")).toBeInTheDocument(); expect(screen.getByText("日本語の名称")).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "重试翻译" }));
    expect(await screen.findByText("中文名称")).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "原文" })); expect(screen.getByText("日本語の名称")).toBeInTheDocument(); expect(translate).toHaveBeenCalledTimes(2);
  });
  it("shares one request and cached result across fields of the exact resource version", async () => {
    translate.mockResolvedValue(response()); const view = render(<BusinessTranslationProvider uid="yasushi"><TranslatedText kind="initiative" resource={resource} field="name" text="名称" /><TranslatedText kind="initiative" resource={resource} field="description" text="説明" /></BusinessTranslationProvider>);
    await screen.findByText("中文说明"); expect(translate).toHaveBeenCalledTimes(1);
    view.rerender(<BusinessTranslationProvider uid="yasushi"><TranslatedText key="later" kind="initiative" resource={resource} field="name" text="名称" /></BusinessTranslationProvider>);
    await screen.findByText("中文名称"); expect(translate).toHaveBeenCalledTimes(1);
  });
  it("rejects a late translation of an older source version", async () => {
    const old = deferred<BusinessTranslation>(); const current = deferred<BusinessTranslation>(); translate.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const view = render(<BusinessTranslationProvider uid="yasushi"><TranslatedText kind="initiative" resource={resource} field="name" text="旧名称" /></BusinessTranslationProvider>);
    view.rerender(<BusinessTranslationProvider uid="yasushi"><TranslatedText kind="initiative" resource={{ ...resource, contentVersion: "version-b" }} field="name" text="新名称" /></BusinessTranslationProvider>);
    await act(async () => current.resolve(response("version-b", { name: "新的名称", description: "" }))); await screen.findByText("新的名称");
    await act(async () => old.resolve(response())); expect(screen.queryByText("中文名称")).not.toBeInTheDocument(); expect(screen.getByText("新的名称")).toBeInTheDocument();
  });
  it("does not reuse previous account content or replies", async () => {
    const old = deferred<BusinessTranslation>(); const current = deferred<BusinessTranslation>(); translate.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const view = render(<BusinessTranslationProvider uid="yasushi"><TranslatedText kind="initiative" resource={resource} field="name" text="原文" /></BusinessTranslationProvider>);
    view.rerender(<BusinessTranslationProvider uid="fang"><TranslatedText kind="initiative" resource={resource} field="name" text="原文" /></BusinessTranslationProvider>);
    await act(async () => old.resolve(response())); expect(screen.queryByText("中文名称")).not.toBeInTheDocument();
    await act(async () => current.resolve(response("version-a", { name: "当前账号译文", description: "" }))); expect(await screen.findByText("当前账号译文")).toBeInTheDocument();
  });
  it("ignores a response carrying the wrong locale or revision", async () => {
    translate.mockResolvedValue({ ...response(), targetLocale: "ja", contentVersion: "wrong-version" });
    render(<BusinessTranslationProvider uid="yasushi"><TranslatedText kind="initiative" resource={resource} field="name" text="原文を保持" /></BusinessTranslationProvider>);
    expect(await screen.findByText("翻译失败・显示原文")).toBeInTheDocument(); expect(screen.getByText("原文を保持")).toBeInTheDocument(); expect(screen.queryByText("中文名称")).not.toBeInTheDocument();
  });
  it("limits simultaneous translation requests to three", async () => {
    const pending = Array.from({ length: 5 }, () => deferred<BusinessTranslation>()); pending.forEach(p => translate.mockReturnValueOnce(p.promise));
    render(<BusinessTranslationProvider uid="yasushi">{pending.map((_, index) => <TranslatedText key={index} kind="initiative" resource={{ ...resource, id: `work-${index}` }} field="name" text={`原文${index}`} />)}</BusinessTranslationProvider>);
    await waitFor(() => expect(translate).toHaveBeenCalledTimes(3));
    await act(async () => pending[0].resolve({ ...response(), id: "work-0" })); await waitFor(() => expect(translate).toHaveBeenCalledTimes(4));
    await act(async () => pending[1].resolve({ ...response(), id: "work-1" })); await waitFor(() => expect(translate).toHaveBeenCalledTimes(5));
  });
});
