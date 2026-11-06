import { createHash } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import { HttpsError } from "firebase-functions/v2/https";
import { MODEL } from "./domain.js";
import type { Ask } from "./pipeline.js";
import { AI_TIMEOUT_MS, AI_STAGE_LABEL, deadline } from "./limits.js";

export function createMeetingAsk(apiKey: string, uid: string, signal: AbortSignal): Ask {
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: AI_TIMEOUT_MS.meeting_brief });
  return async q => {
    signal.throwIfAborted();
    const budget = deadline(AI_TIMEOUT_MS[q.name], `${AI_STAGE_LABEL[q.name]}に時間がかかり、制限時間に達しました。既存の編集内容は保持しています。期間または対象者を分けて再作成してください。`, signal);
    try {
    const schema = z.toJSONSchema(q.schema) as Record<string, unknown>; delete schema.$schema;
    const stream = await client.responses.create({
      model: MODEL, reasoning: { effort: q.effort }, store: false, stream: true, max_output_tokens: 24000,
      safety_identifier: createHash("sha256").update(uid).digest("hex").slice(0, 32),
      input: [{ role: "system", content: q.instruction }, { role: "user", content: JSON.stringify(q.data) }],
      text: { format: { type: "json_schema", name: q.name, strict: true, schema } }
    }, { signal: budget.signal, timeout: AI_TIMEOUT_MS[q.name] });
    for await (const event of stream) {
      budget.signal.throwIfAborted();
      if (event.type === "response.completed") {
        // Only accept the completed structured result. Partial deltas never become a report.
        const result = event.response;
        const text = result.output.filter(item => item.type === "message").flatMap(item => item.content).filter(item => item.type === "output_text").map(item => item.text).join("");
        if (result.status !== "completed" || !text) throw new HttpsError("data-loss", "AIの出力が完了しませんでした。途中の資料は表示していません。期間を分けて再作成してください。");
        try { return JSON.parse(text); } catch { throw new HttpsError("data-loss", "AIの出力を読み取れませんでした。"); }
      }
      if (event.type === "response.incomplete") throw new HttpsError("data-loss", "AIの出力が完了しませんでした。途中の資料は表示していません。期間を分けて再作成してください。");
      if (event.type === "response.failed" || event.type === "error") throw new HttpsError("unavailable", `${AI_STAGE_LABEL[q.name]}中にAI側の処理が失敗しました。既存の編集内容は保持しています。`);
    }
    budget.signal.throwIfAborted();
    throw new HttpsError("unavailable", `${AI_STAGE_LABEL[q.name]}中にAIの応答が途切れました。途中の資料は表示していません。`);
    } catch (error) {
      if (budget.signal.aborted) throw budget.signal.reason;
      if (error instanceof OpenAI.APIConnectionTimeoutError) throw new HttpsError("deadline-exceeded", `${AI_STAGE_LABEL[q.name]}の応答待ちが制限時間に達しました。既存の編集内容は保持しています。`);
      throw error;
    } finally { budget.dispose(); }
  };
}
