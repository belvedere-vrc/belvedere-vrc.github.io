// アンケート画面(survey.html)の設定。入力画面はこのサイトで作り、送信だけ、アンケート用のGoogleフォームに渡す。
// このファイルは、フォームの公開ページから、質問・選択肢・質問の番号(entry.数字)を読み取って作った。
// フォームの質問を変えたり、足したりしたら、フォームのURLを渡して、作り直してもらう(質問の番号が変わるため)。
//
// 質問の種類: choice=選択(1つ選ぶ。選ぶと次に進む)/ paragraph=長文 / text=短文。required=必須。
// 選択肢の文字は、フォームの選択肢と、完全に同じにする(違うと、Googleに受け付けられない)。
window.SURVEY_CONFIG = {
  action: "https://docs.google.com/forms/d/e/1FAIpQLSfnMmf7VaX8LJVFDFWAarqZKbzYgRYmOfg9cNcVjtB6JJGf2Q/formResponse",
  intro: "お客様によりイベントを楽しんでいただくため、アンケートにご協力ください。\n所要時間は1~2分を見込んでおります。\n回答の一部はキャストにも共有させていただく場合がございますので、ご了承ください。",
  questions: [
    {
      "key": "q1",
      "entry": "entry.1975806787",
      "type": "choice",
      "title": "Q1. 本イベントを知ったきっかけを教えてください。",
      "lead": "",
      "required": true,
      "options": [
        "X（旧Twitter）でポストを見た",
        "YouTubeの動画を見た",
        "公式サイトを見た",
        "フレンドが紹介してくれた",
        "VRChat内で見た",
        "その他"
      ]
    },
    {
      "key": "q2",
      "entry": "entry.1682283147",
      "type": "paragraph",
      "title": "Q2. 本イベントのよかったところ（楽しみにしているところ）を教えてください。",
      "lead": "",
      "required": true
    },
    {
      "key": "q3",
      "entry": "entry.1706583317",
      "type": "choice",
      "title": "Q3. Q2の内容をキャストに共有してもよいでしょうか？",
      "lead": "",
      "required": true,
      "options": [
        "はい",
        "いいえ"
      ]
    },
    {
      "key": "q4",
      "entry": "entry.1142119641",
      "type": "paragraph",
      "title": "Q4. 本イベントの改善点、希望などありましたらご記入ください。",
      "lead": "こちらの内容は運営のみ拝見いたします。",
      "required": false
    },
    {
      "key": "q5",
      "entry": "entry.1584653819",
      "type": "paragraph",
      "title": "Q5. 本イベントで、接客を受けてみたいキャストはいますか？",
      "lead": "所属しているキャスト以外でも構いません。\nその場合はX（旧Twitter）のIDも添えていただけると幸いです。",
      "required": false
    },
    {
      "key": "q6",
      "entry": "entry.423197244",
      "type": "name",
      "title": "お名前",
      "lead": "",
      "required": true
    },
    {
      "key": "q7",
      "entry": "entry.414289435",
      "type": "vrchat",
      "title": "VRChat ユーザープロフィール",
      "lead": "",
      "required": true
    },
    {
      "key": "q8",
      "entry": "entry.1907220206",
      "type": "x",
      "title": "X プロフィールURL",
      "lead": "",
      "required": true
    },
    {
      "key": "q9",
      "entry": "entry.981569200",
      "type": "email",
      "title": "メールアドレス",
      "lead": "",
      "required": true
    }
  ]
};
