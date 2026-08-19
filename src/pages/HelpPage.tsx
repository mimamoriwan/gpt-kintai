import {
  BarChart3,
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardPenLine,
  Clock3,
  Languages,
  Paperclip,
  PackageSearch,
  ShieldCheck,
  Tags,
  Type,
  Users
} from "lucide-react";
import type { ReactNode } from "react";
import { useAppFontSize, type AppFontSize } from "../appFontSize";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

type GuideStep = {
  icon: typeof Clock3;
  title: string;
  description: string;
  points: string[];
};

type GuideCopy = {
  eyebrow: string;
  title: string;
  introduction: string;
  languageNote: string;
  quickTitle: string;
  quickDescription: string;
  cycleTitle: string;
  cycleDescription: string;
  employeeTitle: string;
  employeeDescription: string;
  managerTitle: string;
  managerDescription: string;
  presidentTitle: string;
  presidentDescription: string;
  cautionTitle: string;
  cautions: string[];
  supportTitle: string;
  supportDescription: string;
  textSizeLabel: string;
  textSizeStandard: string;
  textSizeLarge: string;
  textSizeExtraLarge: string;
  employeeSteps: GuideStep[];
  cycleSteps: GuideStep[];
  managerSteps: GuideStep[];
  presidentSteps: GuideStep[];
};

const copy: Record<"ja" | "zh-CN", GuideCopy> = {
  ja: {
    eyebrow: "はじめての方へ",
    title: "使い方 / 使用指南",
    introduction: "勤務実態と業務内容を記録し、日報から週次レポート・定例会レジュメ・フィードバックへつなぐ使い方を説明します。表示する内容は、あなたの権限に合わせています。",
    languageNote: "右のボタンで日本語と簡体字を切り替えられます。選んだ文字の大きさは、このページだけでなくシステムの全画面に反映されます。",
    quickTitle: "毎日の基本の流れ",
    quickDescription: "迷ったときは、この4つの順番で操作してください。",
    cycleTitle: "記録を週次・月次資料へつなぐ流れ",
    cycleDescription: "「業務サイクル」では、毎日の記録を週報・定例会・月次資料へまとめます。表示・編集できる項目は、従業員・管理担当者・社長の権限によって異なります。",
    employeeTitle: "従業員向けの詳しい使い方",
    employeeDescription: "勤怠と日報は、原則として勤務した日に記録します。",
    managerTitle: "管理担当者向け",
    managerDescription: "従業員の記録確認と、システムの設定を行います。",
    presidentTitle: "社長向け",
    presidentDescription: "ホームの共有業務カレンダーへ予定を登録できます。勤怠、日報、商品候補、週次・月次資料は引き続き閲覧専用です。",
    cautionTitle: "このシステムで行わないこと",
    cautions: [
      "GPSで現在地を取得しません。",
      "表示する経過時間は休憩未控除です。給与・残業・休日割増は計算しません。",
      "AIによる日本語化は、入力済みの日報と商品記録が対象です。リアルタイム音声翻訳、商談録音、自動議事録作成は行いません。",
      "通信できる状態で使用してください。オフラインでの自動同期はありません。",
      "パスワードは本人だけで管理し、他の人と共有しないでください。"
    ],
    supportTitle: "困ったとき",
    supportDescription: "エラーが出た場合は、同じ操作を何度も繰り返さず、画面のスクリーンショットと操作した時刻を管理担当者へ知らせてください。",
    textSizeLabel: "文字の大きさ",
    textSizeStandard: "標準",
    textSizeLarge: "大",
    textSizeExtraLarge: "特大",
    employeeSteps: [
      {
        icon: Clock3,
        title: "1. 始業する",
        description: "ホームで勤務形態を選び、「始業する」を押します。",
        points: ["出社・出張・リモート・その他から、実際の働き方を選びます。", "会社休日に業務がなければ操作は不要です。業務を行う場合だけ「休日業務を開始」を押します。", "始業打刻を忘れた場合は「始業時刻を指定して記録」から、当日の実際の始業時刻と理由を入力します。", "前日の終業忘れが表示された場合は、先に実際の終業時刻と修正理由を登録します。"]
      },
      {
        icon: Tags,
        title: "2. 業務メモを残す",
        description: "仕事をした都度、短い文章とタグで記録します。",
        points: ["最初に「日報の日付」が記録したい日になっていることを確認します。", "タグは仕事を整理するための目印です。必要なタグは自分で追加できます。", "見積書や商品資料などがある場合は、メモを追加する前に「この報告に書類を添付」から選びます。", "追加済みの業務メモは編集・削除できます。提出済み日報は自動変更されないため、必要な場合は日報も修正します。", "訪問・出張・外回りがあった場合だけ、日報欄で該当するチェックを入れます。"]
      },
      {
        icon: ClipboardPenLine,
        title: "3. 日報を作成・提出する",
        description: "業務メモからAIで下書きを作り、内容を確認して提出します。",
        points: ["日報作成ボタンを押すと、業務メモと保存した添付ファイルをOpenAI APIへ送り、資料の内容も参考にして下書きを作ります。URLリンクは自動解析しません。", "同じ入力内容では保存済み下書きを再利用し、APIでの成功生成は1日2回までです。", "AIで下書きを作れない場合も、日報欄へ手入力して提出できます。", "AIの文章は必ず本人が読み、事実と違う内容があれば直します。", "中国語で入力した場合は原文を保存し、日本語版を自動作成します。", "提出後に修正するときは、修正理由も記録します。"]
      },
      {
        icon: CheckCircle2,
        title: "4. 終業する",
        description: "仕事が終わったらホームの「終業する」を押します。",
        points: ["確認画面で時刻を確認してから確定します。", "会社休日に仕事をした場合も、通常と同じく終業打刻と日報提出が必要です。"]
      },
      {
        icon: CalendarDays,
        title: "共有業務カレンダーを使う",
        description: "ホームの日付を選び、訪問・商談・出張・会議などの業務予定を3人で共有します。",
        points: ["通常予定・出張では件名と参加者を入力し、必要に応じて期間、時刻、メモを追加します。「全員」で3人を一括選択できます。", "休みは氏名と期間だけを共有し、理由・メモ・時刻は保存しません。変更・期間全体の削除ができるのは作成者だけです。", "休みを含む予定は勤怠実績・有給残数・日報には反映されません。実際に勤務しなかった日の記録は、従来どおり業務サイクルで別に登録します。"]
      },
      {
        icon: BarChart3,
        title: "記録を確認する",
        description: "「記録」では、自分の勤怠と提出済み日報を確認できます。",
        points: ["提出済み日報を修正すると、以前の内容と修正履歴が残ります。", "「確認が必要」は提出失敗や修正可能という意味ではなく、管理担当者がまだ内容を確認していない状態です。", "管理担当者が確認すると「確認済み」と表示されます。"]
      },
      {
        icon: Paperclip,
        title: "写真・ファイル・リンク",
        description: "各業務メモに、その報告の根拠となる資料を添付できます。",
        points: ["メモ本文を入力し、資料を選んでから「報告を追加」を押します。", "写真、PDF、Word、Excel、HTTP/HTTPSリンクを登録できます。", "添付は1件の報告につき最大5件・合計20MBです。日報のAI作成で解析できるのは1日最大10ファイル・合計20MBです。", "日報のAI作成を押した場合、保存したファイルはOpenAI APIにも送信されます。個人情報や業務に関係のない資料は添付しないでください。"]
      },
      {
        icon: PackageSearch,
        title: "商品候補を登録する",
        description: "店頭・出張先・ネットなどで気になった商品を、写真または手入力で記録します。",
        points: [
          "正面・JAN・原材料の写真はすべて任意です。AIで読み取った内容は、必ず確認・修正してから登録します。",
          "同じJANの商品は既存商品に発見記録を追加します。JANがない場合は、似た候補から既存商品か新規商品かを選びます。",
          "「気になる理由」には、中国市場から見て注目した点を自分の言葉で残してください。"
        ]
      },
      {
        icon: CalendarDays,
        title: "週の計画を登録する",
        description: "週のはじめに、目標・調査予定・訪問予定・作成する資料・相談事項を登録します。",
        points: ["日本語または中国語で入力できます。", "確定した週報と、自分が参加した定例会の記録も同じ画面で確認できます。"]
      },
      {
        icon: ClipboardCheck,
        title: "休み・成果物を記録する",
        description: "予定勤務日に働かなかった理由や、業務で作成・受領した資料の保存先を残します。",
        points: ["予定勤務日に働かなかった場合は、「業務サイクル」→「非勤務理由」で有給休暇・体調不良などを登録します。会社休日に勤務しなかっただけの場合は登録不要です。", "見積書や調査資料などはGoogle Driveへ保存し、資料名とリンクを管理担当者へ伝えて「関連資料」への索引登録を依頼します。"]
      }
    ],
    cycleSteps: [
      {
        icon: CalendarDays,
        title: "1. 週の計画を下書きする",
        description: "従業員が週の目標、調査・訪問予定、成果物、相談事項を入力します。",
        points: ["週は月曜日から日曜日までです。", "従業員は下書きを保存し、管理担当者が内容を確認して「計画を確定」します。社長は閲覧のみです。"]
      },
      {
        icon: ClipboardPenLine,
        title: "2. 毎日の実績を残す",
        description: "勤怠、業務メモ、日報、商品候補を通常どおり記録します。",
        points: ["予定勤務日に働かなかった場合は「非勤務理由」を登録します。", "見積書・調査資料・取引先メールなどはDriveへ保存し、管理担当者が「関連資料」へ登録します。"]
      },
      {
        icon: BookOpenCheck,
        title: "3. 前週のレポートを作る",
        description: "AIが前週の日報・業務メモなどを月曜会議用の下書きに整理し、管理担当者が事実確認・編集します。",
        points: ["概要、主な成果、課題・リスク、判断が必要な事項、テーマ別実績、次週の優先事項、勤怠指標をまとめます。", "AIへ送るのは文字情報と勤怠集計だけで、写真・添付・Drive内の文書は送りません。", "AIが確認できない内容は推測で補わず、空欄または要確認として扱います。管理者未確認の日報が残っている間は最終確定できません。"]
      },
      {
        icon: Users,
        title: "4. 月曜定例会を記録する",
        description: "確定した週報を見ながら、前週の振り返りと今週の方針を確認します。",
        points: ["管理担当者がフィードバック、中国市場情報、決定事項、担当者、期限を記録します。", "従業員は自分の意見・計画を追記でき、社長は閲覧のみです。"]
      },
      {
        icon: ShieldCheck,
        title: "5. 月次資料と更新準備へまとめる",
        description: "管理担当者が月ごとのデータを出力し、会社Driveへ保存した確定版を登録します。",
        points: ["確定後に元の記録が修正された場合は、旧版を残したまま新版を再出力します。", "在留更新の必要書類はシステムで決めず、行政書士の最新確認内容に合わせて準備状況を更新します。"]
      }
    ],
    managerSteps: [
      {
        icon: ClipboardCheck,
        title: "提出内容を確認する",
        description: "管理画面の「確認が必要」から日報を開き、内容を確認します。",
        points: ["問題がなければ「確認済みにする」を押します。", "手入力始業は、実際の始業時刻・操作時刻・理由を確認し、問題がなければ確認済みにします。", "本人が修正した日報は再確認が必要になります。本人の原文を管理者が上書きすることはありません。"]
      },
      {
        icon: BriefcaseBusiness,
        title: "業務カテゴリを管理する",
        description: "会社全体で集計したい仕事の大分類を設定します。",
        points: ["業務カテゴリは全員共通、業務メモのタグは本人が整理に使う細かな目印です。", "在留資格申請時の職務内容と大きくずれない名称に整えます。"]
      },
      {
        icon: CalendarDays,
        title: "会社カレンダーを管理する",
        description: "土日祝のほか、会社独自休日や例外的な出勤日を設定します。",
        points: ["お盆や年末年始は開始日と終了日を指定して一括登録できます。中国の旧正月は自動判定されないため、会社全体が休む場合だけ会社休日として登録します。", "会社休日だけでは勤務日数に加算されません。休日に実際に始業した記録は「休日勤務」として表示されます。"]
      },
      {
        icon: Users,
        title: "利用者を管理する",
        description: "アカウントの追加・無効化と権限設定を行います。",
        points: ["従業員、従業員・管理担当、社長（閲覧のみ）から選びます。", "退職者など使用しないアカウントは削除せず無効化します。"]
      },
      {
        icon: PackageSearch,
        title: "商品候補を確認する",
        description: "未確認の発見記録を確認し、商品の検討状態と事実情報を管理します。",
        points: ["本人の「気になる理由」は上書きせず、問題がなければ確認済みにします。", "商品名・JAN・メーカー・原材料を修正するときは、理由を入力して変更履歴を残します。"]
      },
      {
        icon: BriefcaseBusiness,
        title: "雇用・職務基準を管理する",
        description: "申請時の職務内容と会社共通カテゴリの関係、基準文書のDriveリンクを登録します。",
        points: ["原本ファイルはGoogle Driveに保管し、アプリへ複製しません。", "AIは在留資格への適合を判定せず、活動分布と未分類件数の確認に使います。"]
      },
      {
        icon: CalendarDays,
        title: "週次サイクルを確定する",
        description: "週次計画を確認し、前週の日報から週報下書きを作り、月曜定例会の記録を残します。",
        points: ["日付、タグ、日報などの参照元を確認し、記録にない事実を追加しないでください。未確認日報がある週報は最終確定できません。", "次週の優先事項には、確定事項か提案かを明記し、担当者・期限・完了条件を設定します。", "「印刷・PDF保存」から、会議用レジュメとして印刷またはブラウザのPDF保存ができます。"]
      },
      {
        icon: Paperclip,
        title: "証拠索引と月次資料を管理する",
        description: "成果物のDriveリンクを資料索引へ登録し、月ごとの勤務・活動説明資料を出力します。",
        points: ["「業務サイクル」→「関連資料」で対象者、資料名、日付、関係者、公開範囲を登録します。", "「月次資料」からJSON・CSV・添付一覧・印刷用資料を出力して会社Driveへ保存します。", "確定後に過去記録が修正された場合は、旧版を残して新版を作成します。"]
      },
      {
        icon: ShieldCheck,
        title: "在留更新準備を確認する",
        description: "在留期限、行政書士への確認日、必要書類の準備状況を管理します。",
        points: ["120日前・90日前・60日前を目安に準備状況を確認します。", "必要書類はシステムが決めず、行政書士が確認した最新の一覧へ更新します。"]
      }
    ],
    presidentSteps: [
      {
        icon: CalendarDays,
        title: "共有業務予定を登録する",
        description: "ホームで3人の予定を確認し、日付を選んで自分やほかのメンバーの業務予定を登録します。",
        points: ["人ごとの色と通常予定・出張・休みの表示で予定を確認でき、3人共通の予定には「全員」と表示されます。", "複数日の予定は期間全体をまとめて変更・削除します。休みの理由やメモは保存されません。", "カレンダー予定は勤怠・有給残数・日報に反映されず、予定の登録以外では社長用アカウントの閲覧専用権限は変わりません。"]
      },
      {
        icon: BarChart3,
        title: "勤務状況を見る",
        description: "管理画面で利用者と期間を選び、勤務日数や始業・終業時刻を確認します。",
        points: ["休日勤務や修正された記録も一覧で確認できます。", "表示時間は休憩未控除で、給与計算用の時間ではありません。"]
      },
      {
        icon: ClipboardCheck,
        title: "日報を見る",
        description: "指定期間に提出された日報と添付資料を閲覧します。",
        points: ["中国語の日報は原文と日本語版の両方を確認できます。", "社長用アカウントは閲覧専用で、入力・修正・削除はできません。"]
      },
      {
        icon: PackageSearch,
        title: "商品候補を見る",
        description: "候補商品の基本情報と、誰がどのような理由で気になったかを比較します。",
        points: ["商品名・JAN・メーカー・原材料を検索できます。", "社長用アカウントでは閲覧と比較だけができ、登録・修正・状態変更はできません。"]
      },
      {
        icon: BookOpenCheck,
        title: "週報・会議・月次資料を見る",
        description: "確定した週次レポート、定例会の決定事項、月次の勤怠・活動資料を閲覧します。",
        points: ["会議前に、概要、勤怠指標、テーマ別実績、判断事項、今週の優先事項を確認できます。", "必要に応じて週次レポートを印刷またはPDF保存できます。", "社長用アカウントは閲覧専用で、確定や内容変更はできません。"]
      }
    ]
  },
  "zh-CN": {
    eyebrow: "首次使用",
    title: "使用指南 / 使い方",
    introduction: "这里说明如何记录实际出勤和工作内容，并将日报连接到周报、例会资料和反馈。显示内容会根据您的权限自动调整。",
    languageNote: "可使用右侧按钮切换日语和简体中文。选择的文字大小会应用到本系统的所有页面，不仅限于本页面。",
    quickTitle: "每天的基本流程",
    quickDescription: "不清楚如何操作时，请按照以下4个步骤进行。",
    cycleTitle: "从日常记录到周报和月度资料",
    cycleDescription: "在“工作周期”页面，可以把每天的记录汇总为周报、例会记录和月度资料。可查看和编辑的内容会根据员工、管理员和社长的权限而不同。",
    employeeTitle: "员工详细使用方法",
    employeeDescription: "原则上，请在实际工作的当天记录考勤并提交日报。",
    managerTitle: "管理员使用方法",
    managerDescription: "确认员工记录并管理系统设置。",
    presidentTitle: "社长使用方法",
    presidentDescription: "可以在首页的共享工作日历中登记日程。考勤、日报、商品候选及周度和月度资料仍为只读。",
    cautionTitle: "本系统不处理的事项",
    cautions: [
      "本系统不会通过GPS获取当前位置。",
      "显示的经过时间未扣除休息时间，也不计算工资、加班费或节假日加班费。",
      "AI生成日语仅适用于已输入的日报和商品记录。本系统不提供实时语音翻译、商务洽谈录音或自动制作会议纪要。",
      "请在能够联网的环境中使用，本系统不支持离线自动同步。",
      "密码仅限本人保管，请勿与他人共享。"
    ],
    supportTitle: "遇到问题时",
    supportDescription: "发生错误时，请不要连续重复相同操作。请将错误画面的截图和操作时间告知管理员。",
    textSizeLabel: "字体大小",
    textSizeStandard: "标准",
    textSizeLarge: "大",
    textSizeExtraLarge: "特大",
    employeeSteps: [
      {
        icon: Clock3,
        title: "1. 开始工作",
        description: "在首页选择工作方式，然后点击“开始工作”。",
        points: ["请根据实际情况选择到公司、出差、远程办公或其他。", "公司休息日如无工作则无需操作；实际工作时请点击“开始休息日工作”。", "如果忘记打卡，请使用“指定开始时间并记录”，填写当天实际开始时间和原因。", "如果显示前一天未结束工作，请先登记实际结束时间和修改理由。"]
      },
      {
        icon: Tags,
        title: "2. 记录工作备忘",
        description: "每完成一项工作，用简短文字和标签进行记录。",
        points: ["请先确认“日报日期”是需要记录的日期。", "标签用于整理工作，可根据需要自行添加。", "如有报价单或商品资料，请在添加备忘前通过“为此报告添加文件”选择资料。", "已添加的工作备忘可以编辑或删除。已提交日报不会自动改变，如有需要也请修改日报。", "只有实际发生访问、出差或外出工作时，才在日报栏勾选相应选项。"]
      },
      {
        icon: ClipboardPenLine,
        title: "3. 制作并提交日报",
        description: "根据工作备忘让AI生成草稿，确认内容后提交。",
        points: ["点击生成日报按钮后，工作备忘和已保存的附件会发送到OpenAI API，AI会参考资料内容生成草稿。不会自动分析URL链接。", "相同输入内容会复用已保存草稿，通过API成功生成每天最多2次。", "即使AI无法生成草稿，也可以在日报栏手动输入并提交。", "必须由本人确认AI生成的文字，如与事实不符请修改。", "使用中文输入时，系统会保存原文并自动生成日语版。", "提交后需要修改时，必须填写修改理由。"]
      },
      {
        icon: CheckCircle2,
        title: "4. 结束工作",
        description: "工作结束后，在首页点击“结束工作”。",
        points: ["请在确认画面核对时间后再确定。", "公司休息日实际工作时，也必须正常结束打卡并提交日报。"]
      },
      {
        icon: CalendarDays,
        title: "使用共享工作日历",
        description: "在首页选择日期，共享访问、洽谈、出差和会议等三人的工作日程。",
        points: ["普通日程和出差需要填写标题及参与者，可按需添加期间、时间和备注。点击“全员”可一次选择三人。", "休息只共享姓名和期间，不保存原因、备注或时间。只有创建者可以修改或删除整个期间。", "包括休息在内的日程不会计入考勤、带薪休假余额或日报。实际未出勤记录仍需在工作周期中另行登记。"]
      },
      {
        icon: BarChart3,
        title: "查看记录",
        description: "在“记录”页面可以查看自己的考勤和已提交日报。",
        points: ["修改已提交日报时，原内容和修改记录会被保留。", "“需要确认”并不表示提交失败或可以修改，而是表示管理员尚未确认内容。", "管理员确认后，日报会显示为“已确认”。"]
      },
      {
        icon: Paperclip,
        title: "照片、文件和链接",
        description: "可在每条工作备忘中附加能够证明该项工作的资料。",
        points: ["先填写备忘内容并选择资料，然后点击“添加报告”。", "可添加照片、PDF、Word、Excel和HTTP/HTTPS链接。", "每条报告最多5个附件，合计不超过20MB。AI生成日报时，每天最多分析10个文件、合计20MB。", "点击AI生成日报后，已保存的文件也会发送到OpenAI API。请勿上传个人隐私或与工作无关的资料。"]
      },
      {
        icon: PackageSearch,
        title: "登记商品候选",
        description: "把在店内、出差地或网上发现的感兴趣商品，通过照片或手动输入进行记录。",
        points: [
          "商品正面、JAN码和配料表照片均为可选。AI识别后，请务必确认并修正内容再登记。",
          "JAN码相同的商品会添加到已有商品的发现记录中。没有JAN码时，请从相似候选中选择已有商品或新建商品。",
          "请在“感兴趣的理由”中，用自己的话记录从中国市场角度关注的地方。"
        ]
      },
      {
        icon: CalendarDays,
        title: "登记每周计划",
        description: "每周开始时，登记本周目标、调查和访问计划、预定制作的资料以及需要商量的事项。",
        points: ["可以使用日语或中文输入。", "还可以在同一页面查看已确定的周报和本人参加的例会记录。"]
      },
      {
        icon: ClipboardCheck,
        title: "登记未工作原因和成果资料",
        description: "记录计划工作日未工作的原因，以及工作中制作或收到的资料保存位置。",
        points: ["计划工作日未工作时，请在“工作周期”→“未出勤原因”登记休假、身体不适等原因。仅因公司休息日未工作时无需登记。", "报价单、调查资料等请保存在Google Drive，并把资料名称和链接告知管理员，由管理员登记到“相关资料”索引中。"]
      }
    ],
    cycleSteps: [
      {
        icon: CalendarDays,
        title: "1. 填写每周计划草稿",
        description: "员工填写本周目标、调查和访问计划、成果资料以及需要商量的事项。",
        points: ["每周从星期一开始，到星期日结束。", "员工保存草稿，管理员确认内容后点击“确定计划”。社长仅可查看。"]
      },
      {
        icon: ClipboardPenLine,
        title: "2. 记录每天的实际工作",
        description: "照常记录考勤、工作备忘、日报和商品候选。",
        points: ["计划工作日未工作时，请登记“未出勤原因”。", "报价单、调查资料、客户邮件等保存在Drive，由管理员登记到“相关资料”。"]
      },
      {
        icon: BookOpenCheck,
        title: "3. 制作上周报告",
        description: "AI把上周的日报和工作备忘等整理成周一会议用草稿，由管理员核对事实并编辑。",
        points: ["报告包含概要、主要成果、问题与风险、待决定事项、按主题整理的实际工作、下周优先事项和考勤指标。", "只向AI发送文字信息和考勤汇总，不发送照片、附件或Drive内的文件。", "AI无法确认的内容不会自行推测，而是留空或标为待确认。只要还有管理员未确认的日报，周报就不能最终确定。"]
      },
      {
        icon: Users,
        title: "4. 记录星期一例会",
        description: "查看已确定的周报，回顾上周工作并确认本周方针。",
        points: ["管理员记录反馈、中国市场信息、决定事项、负责人和期限。", "员工可以补充自己的意见和计划，社长仅可查看。"]
      },
      {
        icon: ShieldCheck,
        title: "5. 汇总月度资料和在留更新准备",
        description: "管理员导出每月数据，并登记保存在公司Drive中的确定版。",
        points: ["确定后如原始记录被修改，请保留旧版并重新输出新版。", "在留更新所需文件不由系统决定，应按照行政书士最新确认的内容更新准备状态。"]
      }
    ],
    managerSteps: [
      {
        icon: ClipboardCheck,
        title: "确认提交内容",
        description: "从管理页面的“需要确认”打开日报并检查内容。",
        points: ["确认无误后点击“标记为已确认”。", "对于补录的开始时间，请核对实际开始时间、操作时间和原因，确认无误后标记为已确认。", "员工修改日报后需要重新确认，管理员不会直接覆盖员工的原文。"]
      },
      {
        icon: BriefcaseBusiness,
        title: "管理工作类别",
        description: "设置公司用于统计的工作大类。",
        points: ["工作类别为全员共用；工作备忘标签是员工个人用于细分整理的标记。", "类别名称应与在留资格申请中记载的工作内容大致一致。"]
      },
      {
        icon: CalendarDays,
        title: "管理公司日历",
        description: "设置周末、节假日、公司特别休息日和例外工作日。",
        points: ["盂兰盆节和年末年初可指定开始、结束日期后批量登记。中国春节不会自动判断，只有公司整体休息时才登记为公司休息日。", "公司休息日不会计入工作天数；休息日实际开始工作的记录会显示为“休息日工作”。"]
      },
      {
        icon: Users,
        title: "管理用户",
        description: "添加、停用账号并设置权限。",
        points: ["可选择员工、员工兼管理员、社长（只读）三种权限。", "离职人员等不再使用的账号请停用，不要直接删除。"]
      },
      {
        icon: PackageSearch,
        title: "确认商品候选",
        description: "确认未审核的发现记录，并管理商品评估状态和事实信息。",
        points: ["不要覆盖员工填写的“感兴趣的理由”，确认无误后标记为已确认。", "修改商品名、JAN码、制造商或配料时，必须填写理由并保留修改历史。"]
      },
      {
        icon: BriefcaseBusiness,
        title: "管理员工和职责基准",
        description: "登记申请时的工作内容、公司工作类别之间的关系及基准文件的Drive链接。",
        points: ["原始文件保存在Google Drive，不复制到本系统。", "AI不判断在留资格是否适合，只显示工作分布和未分类数量。"]
      },
      {
        icon: CalendarDays,
        title: "确定每周工作流程",
        description: "确认每周计划，根据上周日报制作周报草稿，并记录周一例会。",
        points: ["请核对日期、标签、日报等来源，不要加入记录中没有的事实。如果仍有未确认日报，周报不能最终确定。", "下周优先事项需标明是已确定事项还是建议，并设置负责人、期限和完成标准。", "通过“打印・保存PDF”，可打印会议资料或使用浏览器保存为PDF。"]
      },
      {
        icon: Paperclip,
        title: "管理证据索引和月度资料",
        description: "把成果资料的Drive链接登记到资料索引，并输出每月的考勤和工作说明资料。",
        points: ["在“工作周期”→“相关资料”登记对象、资料名、日期、相关人员和公开范围。", "从“月度资料”导出JSON、CSV、附件清单和打印用资料，并保存到公司Drive。", "确定后如过去记录被修改，保留旧版并制作新版。"]
      },
      {
        icon: ShieldCheck,
        title: "确认在留更新准备",
        description: "管理在留期限、向行政书士确认的日期和文件准备状态。",
        points: ["在到期前120天、90天和60天确认准备情况。", "所需文件不由系统决定，请更新为行政书士确认的最新清单。"]
      }
    ],
    presidentSteps: [
      {
        icon: CalendarDays,
        title: "登记共享工作日程",
        description: "在首页查看三人的安排，选择日期后登记自己或其他成员的工作日程。",
        points: ["可通过成员颜色以及普通日程、出差、休息标识来区分安排，三人共同参加时会显示“全员”。", "跨多日的日程按整个期间修改或删除，休息原因和备注不会保存。", "日历日程不会计入考勤、带薪休假余额或日报；除日程登记外，社长账号的只读权限保持不变。"]
      },
      {
        icon: BarChart3,
        title: "查看考勤情况",
        description: "在管理页面选择用户和期间，查看工作天数及开始、结束时间。",
        points: ["休息日工作和已修改的记录也可在列表中确认。", "显示时间未扣除休息时间，不是工资计算用工时。"]
      },
      {
        icon: ClipboardCheck,
        title: "查看日报",
        description: "查看指定期间内提交的日报和附件。",
        points: ["中文日报可同时查看中文原文和日语版。", "社长账号为只读权限，不能输入、修改或删除。"]
      },
      {
        icon: PackageSearch,
        title: "查看商品候选",
        description: "查看候选商品基本信息，并比较由谁发现以及感兴趣的理由。",
        points: ["可按商品名、JAN码、制造商和配料进行搜索。", "社长账号仅可查看和比较，不能登记、修改或更改状态。"]
      },
      {
        icon: BookOpenCheck,
        title: "查看周报、会议和月度资料",
        description: "查看已确定的周报、例会决定事项以及月度考勤和活动资料。",
        points: ["可在会议前查看概要、考勤指标、各主题实际工作、待决定事项和本周优先事项。", "需要时可打印周报或保存为PDF。", "社长账号为只读权限，不能确定或修改内容。"]
      }
    ]
  }
};

function GuideCard({ step }: { step: GuideStep }) {
  const Icon = step.icon;
  return <article className="help-guide-card">
    <span className="help-card-icon"><Icon size={22} /></span>
    <div>
      <h3>{step.title}</h3>
      <p>{step.description}</p>
      <ul>{step.points.map((point) => <li key={point}>{point}</li>)}</ul>
    </div>
  </article>;
}

function GuideSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="help-section">
    <div className="help-section-heading"><h2>{title}</h2><p>{description}</p></div>
    {children}
  </section>;
}

export function HelpPage() {
  const { profile } = useAuth();
  const { locale, setLocale } = useI18n();
  const guide = copy[locale];
  const isManager = profile?.role === "employee_manager";
  const isPresident = profile?.role === "president_viewer";
  const showEmployeeGuide = !isPresident;
  const { fontSize, setFontSize } = useAppFontSize();

  return <main className="page help-page">
    <header className="page-heading help-heading">
      <div>
        <span className="eyebrow"><BookOpenCheck size={14} />{guide.eyebrow}</span>
        <h1>{guide.title}</h1>
        <p>{guide.introduction}</p>
      </div>
      <div className="help-language-panel" aria-label={locale === "ja" ? "説明言語" : "说明语言"}>
        <span><Languages size={17} />Language</span>
        <div>
          <button className={locale === "ja" ? "active" : ""} onClick={() => setLocale("ja")}>日本語</button>
          <button className={locale === "zh-CN" ? "active" : ""} onClick={() => setLocale("zh-CN")}>简体中文</button>
        </div>
        <span><Type size={17} />{guide.textSizeLabel}</span>
        <div className="help-font-size-options">
          {([
            ["standard", guide.textSizeStandard],
            ["large", guide.textSizeLarge],
            ["extra-large", guide.textSizeExtraLarge]
          ] satisfies [AppFontSize, string][]).map(([size, label]) => <button
            key={size}
            type="button"
            className={fontSize === size ? "active" : ""}
            aria-pressed={fontSize === size}
            onClick={() => setFontSize(size)}
          >{label}</button>)}
        </div>
      </div>
    </header>

    <p className="help-language-note">{guide.languageNote}</p>

    {showEmployeeGuide && <>
      <GuideSection title={guide.quickTitle} description={guide.quickDescription}>
        <div className="help-quick-flow">
          {guide.employeeSteps.slice(0, 4).map((step) => {
            const Icon = step.icon;
            return <article key={step.title}><span><Icon size={20} /></span><strong>{step.title}</strong><small>{step.description}</small></article>;
          })}
        </div>
      </GuideSection>
      <GuideSection title={guide.employeeTitle} description={guide.employeeDescription}>
        <div className="help-guide-grid">{guide.employeeSteps.map((step) => <GuideCard key={step.title} step={step} />)}</div>
      </GuideSection>
    </>}

    <GuideSection title={guide.cycleTitle} description={guide.cycleDescription}>
      <div className="help-guide-grid">{guide.cycleSteps.map((step) => <GuideCard key={step.title} step={step} />)}</div>
    </GuideSection>

    {isManager && <GuideSection title={guide.managerTitle} description={guide.managerDescription}>
      <div className="help-guide-grid">{guide.managerSteps.map((step) => <GuideCard key={step.title} step={step} />)}</div>
    </GuideSection>}

    {isPresident && <GuideSection title={guide.presidentTitle} description={guide.presidentDescription}>
      <div className="help-guide-grid">{guide.presidentSteps.map((step) => <GuideCard key={step.title} step={step} />)}</div>
    </GuideSection>}

    <section className="help-bottom-grid">
      <article className="card help-caution-card">
        <span className="help-card-icon amber"><ShieldCheck size={22} /></span>
        <div><h2>{guide.cautionTitle}</h2><ul>{guide.cautions.map((item) => <li key={item}>{item}</li>)}</ul></div>
      </article>
      <article className="card help-support-card">
        <span className="help-card-icon green"><BookOpenCheck size={22} /></span>
        <div><h2>{guide.supportTitle}</h2><p>{guide.supportDescription}</p></div>
      </article>
    </section>
  </main>;
}
