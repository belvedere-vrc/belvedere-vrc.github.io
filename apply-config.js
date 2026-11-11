// お申し込み画面(apply.html)の設定。
// 入力画面はこのサイトで作り、送信だけGoogleフォームに渡す。Googleフォーム側の「質問」と、ここの項目を結ぶ番号を書く。
//
// 【設定のしかた】
//  1. Googleフォームの右上メニュー(︙)→「事前入力したURLを取得」で、全部の質問に適当な文字を入れて、リンクを取得する。
//     リンクの中の「entry.数字=…」が、質問ごとの番号。
//  2. action には、フォームのURLの「/viewform」の部分を「/formResponse」に変えたものを書く。
//     例  https://docs.google.com/forms/d/e/1FAIpQLSxxxxxxxx/formResponse
//  3. fields に、質問ごとの番号を書く(「entry.123456789」の形)。質問は8つ、すべて「短文」にしておく。
//
// action と fields がすべて入るまでは、申し込み画面は「準備中」と出て、送信できない。
//
// 区分や枠の決まりは、予約・受付システム(予約セッション)の決定に合わせて直す。下の部屋の名前や、枠の長さは【仮置き】。
window.APPLY_CONFIG = {
  action: "https://docs.google.com/forms/d/e/1FAIpQLSeacG8TICskOlQI-4CkX29RMeXY-v9a_qgQGhZnrrKWZmeXaA/formResponse",
  fields: {
    plan: "entry.214831025",    // 区分(部屋の名前。指名ありなら「＋指名」が付く)
    cast: "entry.2043152631",    // 指名キャスト(指名なしのときは、空で送る)
    date: "entry.145383734",    // 希望の営業日
    slot: "entry.10917196",    // 希望の時間帯(例 21:00-22:00)
    name: "entry.220791412",    // お名前(VRChatの表示名)
    vrchat: "entry.1497520376",  // VRChatのプロフィールのURL(https://vrchat.com/home/user/usr_… の形に整えて送る)
    x: "entry.1583057986",       // XのプロフィールのURL(https://x.com/アカウント名 の形に整えて送る)
    email: "entry.280807652"    // メールアドレス
  },

  // 部屋。types は、その部屋を選べる営業の種類(営業日シートの type)。「通常」は通常開催、「時間外」は時間外の開催。
  // どの部屋にも、指名あり・なしがある。value はGoogleフォームへ送る文字(指名ありは、後ろに nominationSuffix が付く)。
  rooms: [
    // price=予約料金、nominationFee=指名料(どちらも数字。単位はクレジット)。部屋を選ぶ画面と確認画面に出る。price を入れない部屋は、料金を出さない。
    // 金額は『料金・収益配分.md』の料金表(2026-10-29 確定)のとおり。変わったら、ここを直す。
    { value: "通常サロン", note: "落ち着いたサロンで、語らいのひとときを。", types: ["通常"], price: 500, nominationFee: 1000 },
    { value: "スーペリアスイート", note: "専用のスイートで、ゆっくりお過ごしいただけます。", types: ["通常", "時間外"], price: 500, nominationFee: 2000 },
    { value: "インペリアルスイート", note: "最上級の専用スイートで、特別なひとときを。", types: ["通常", "時間外"], price: 1500, nominationFee: 2000 }
  ],
  nominationSuffix: "＋指名",

  // 時間外の営業日に出す案内と、確認画面に出す手数料(2026-11-08 決定: 1,000クレジット。指名の有無によらず同額)。
  overtimeFee: 1000,   // 数字(単位はクレジット)。部屋の料金に足される
  overtimeNote: "追加で1,000クレジットがかかります。",

  // 日本円に換算した目安を、お部屋を選ぶ画面と確認画面の合計に添える(例「1,500クレジット（約1,880円）」)。
  // 「credits クレジットが yen 円」と書く。2026-11-11 決定: 1クレジットあたり 1.4円 で換算する(高めに見た目安)。
  // yen が 0 のあいだは、円は出さない。円は10円単位に丸める。価格は、あくまでクレジット建て(円は目安)。
  yenRate: { credits: 1, yen: 1.4 },
  yenNote: "日本円は目安です。お支払いは、VRChatのクレジットで行います。",

  // 通常営業の枠: 固定の開催時刻と曜日。【仮設定 2026-11-11: 毎週土曜日の 21:00〜】(正式な日時は、キャストをそろえるときに決める)
  // 通常営業の枠は、開催日(regularWeekday の曜日)の regularStart の1つだけ。出勤予定のそれ以外の枠は、すべて時間外(スイートのみ・手数料あり)。
  // regularStart が空のあいだは、すべて通常(時間外にしない)。regularWeekday は 0=日曜〜6=土曜。空なら、出勤予定のある日は、毎日、通常営業の日。
  // ※ regularWeekday は、GAS(publish.gs)の REGULAR_WEEKDAY(トップの「次回開催」の日付を決める)と、同じ値にする。
  regularStart: "21:00",
  regularWeekday: 6,

  // 枠の決まり(分)。unit=枠の単位、service=1回の接客の長さ、block=1回の予約でふさぐ長さ(接客＋余裕)。
  // 指名のあるとき、同じキャストの予約の前後(開始どうしが block 分未満=30分刻みでは前後1時間)の枠は、全員が選べない。
  // 指名なしの受付数は、その時間帯に出勤しているキャストの人数 − anyReserve(指名のために空けておく人数)。
  slot: { unit: 30, service: 60, block: 90, anyReserve: 2 }
};
