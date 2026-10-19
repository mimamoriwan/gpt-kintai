import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { getPushState } from "../lib/pushStorage";
import { disableAnnouncementPush, enableAnnouncementPush, getPushEnvironment, sendAnnouncementPushTest } from "../services/announcementPush";

export function AnnouncementPushSettings() {
  const { profile } = useAuth();
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const environment = getPushEnvironment();
  const denied = "Notification" in window && Notification.permission === "denied";
  useEffect(() => {
    let active = true;
    const refresh = () => { void getPushState().then(state => {
      if (active) setEnabled(Boolean(state?.enabled && state.userId === profile?.uid));
    }).catch(() => { if (active) setEnabled(false); }); };
    refresh();
    window.addEventListener("announcement-push-settings", refresh);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("announcement-push-settings", refresh); window.removeEventListener("focus", refresh); };
  }, [profile?.uid]);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setNotice(""); setFailed(false);
    try { await action(); setNotice(success); }
    catch (error) {
      setFailed(true);
      const code = error && typeof error === "object" && "code" in error ? error.code : error instanceof Error ? error.message : "";
      setNotice(code === "functions/resource-exhausted"
        ? (zh ? "距离上次测试发送不足1分钟。请稍等后重试。通知权限没有改变。" : "前回のテスト送信から1分経っていません。少し待ってから再送してください。通知の許可は変わっていません。")
        : code === "push/permission-denied"
        ? (zh ? "未获得通知权限。请在设备设置中允许此应用的通知。" : "通知が許可されていません。端末の設定でこのアプリの通知を許可してください。")
        : (zh ? "无法完成通知设置。请检查网络和通知权限，然后重试。测试通知请间隔1分钟再发送。" : "通知の設定・送信が完了しませんでした。通信と通知の許可を確認して再度お試しください。テスト送信は1分ほど間隔を空けてください。"));
    } finally { setBusy(false); }
  }
  const guidance = environment === "home-screen" ? (zh ? "iPhone或iPad请从主屏幕的图标打开应用。尚未添加时，请在Safari的共享菜单中选择“添加到主屏幕”。需要iOS／iPadOS 16.4或更新版本。" : "iPhone・iPadではホーム画面のアイコンから開いてください。未追加の場合はSafariの共有メニューから「ホーム画面に追加」を選びます。iOS／iPadOS 16.4以降が必要です。")
    : environment === "unsupported" ? (zh ? "此浏览器无法使用通知。请使用支持通知的浏览器；iPhone需要iOS 16.4或更新版本，并从主屏幕打开。" : "この環境では通知を利用できません。対応ブラウザーをご利用ください。iPhoneではiOS 16.4以降でホーム画面から開く必要があります。")
    : environment === "not-configured" ? (zh ? "通知功能的准备尚未完成，请等待管理员启用。" : "通知機能の準備中です。管理担当者による有効化をお待ちください。")
    : denied ? (zh ? "通知权限已被拒绝。iPhone请打开“设置”→“通知”，选择此应用并允许通知。电脑请在浏览器的网站权限中允许通知。" : "通知が拒否されています。iPhoneでは「設定」→「通知」からこのアプリを選び、通知を許可してください。PCではブラウザーのサイト権限を確認してください。") : "";
  return <section className="card push-settings" aria-labelledby="push-settings-title">
    <h2 id="push-settings-title"><Bell size={21} />{zh ? "此设备的通知" : "この端末のお知らせ通知"}</h2>
    <p>{zh ? "接收发给自己的新通知。通知画面仅提示有新消息，正文在应用中查看。每台设备分别设置。" : "自分宛ての新しいお知らせを受け取ります。通知には新着があることだけを表示し、本文はアプリで確認します。端末ごとに設定します。"}</p>
    <p><strong>{enabled && !denied ? (zh ? "已开启" : "通知ON") : (zh ? "已关闭" : "通知OFF")}</strong></p>
    {guidance && <p className="push-guidance">{guidance}</p>}
    <div className="push-settings-actions">
      {!enabled && <button className="button primary" disabled={busy || !profile || environment !== "supported" || denied} onClick={() => void run(() => enableAnnouncementPush(profile!.uid, locale), zh ? "通知设置已完成。请发送测试通知并确认是否收到。" : "通知設定が完了しました。テスト通知を送って受信をご確認ください。")}>{busy ? (zh ? "处理中…" : "処理中…") : (zh ? "允许通知" : "通知を許可する")}</button>}
      {enabled && <><button className="button secondary" disabled={busy} onClick={() => void run(disableAnnouncementPush, zh ? "此设备的通知已关闭。断网时将在重新连接后完成服务器端解除。" : "この端末の通知をOFFにしました。通信できない場合は再接続後にサーバーの解除を完了します。")}>{zh ? "关闭通知" : "通知をOFFにする"}</button><button className="button primary" disabled={busy || denied} onClick={() => void run(sendAnnouncementPushTest, zh ? "已受理发送。请确认此设备是否收到通知。" : "送信を受け付けました。この端末に通知が届いたかご確認ください。")}>{zh ? "发送测试通知" : "テスト通知を送る"}</button></>}
    </div>
    {notice && <p role={failed ? "alert" : "status"}>{notice}</p>}
    <small>{zh ? "回复和确认操作不会推送通知。提示音和显示时间由设备的通知及专注模式设置决定。" : "返信や確認操作では通知しません。通知音・表示時刻は端末の通知設定や集中モードに従います。"}</small>
  </section>;
}
