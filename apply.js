// お申し込み画面。1問ずつ進む形で入力してもらい、最後に確認して、Googleフォームへ送信する。
// Googleフォームの画面は出さない。設定は apply-config.js。読み込みに失敗したときは、HTML側の文言が残る。
//
// 流れ: 指名の有無 →(指名ありなら)キャスト → 営業日 → 時間帯の枠 → 部屋 → お名前 → VRChatのプロフィールURL → XのプロフィールURL → メールアドレス → 確認 → 送信
//  ・営業日は、キャストの出勤予定(data/schedule.json)に日付がある日(今日以降)。営業日時シートには、特別営業(告知のみ)の日だけを書く。
//  ・通常営業の枠は、固定の開催時刻(設定 regularStart。21:00 など)の1つだけ。通常営業の日は、設定 regularWeekday の曜日(例 6=毎週土曜)だけ。
//    通常営業の日は、開催時刻の前後1時間(設定 eventGap。21:00なら 20:00・20:30・21:30・22:00)の枠は、選べない。
//    それ以外の、出勤予定に入っている時間帯の枠(通常営業のない曜日の枠も)は、すべて「時間外」
//    (部屋は、スイートのみ。時間外手数料がかかる)。通常営業の枠は、その時刻に出勤しているキャストから、予約できる数を数える。
//    regularStart が空のあいだは、すべて通常(時間外にしない)。
//  ・時間外かどうかは、選んだ時間帯で決まる。だから、時間帯を選んだあとに、お部屋(と料金)を選ぶ。
//  ・料金は、お部屋を選ぶ画面と確認画面に出す(設定の price・nominationFee・overtimeFee。指名ありは指名料、時間外は手数料を足した合計)。
//  ・枠は30分単位。キャストの出勤予定(data/schedule.json)の時間帯の中だけ選べる。
//  ・選んだ時点で次の画面に進む画面(指名・キャスト・営業日・時間帯・部屋)には、「次へ」ボタンを出さない。
//  ・指名ありは、同じキャストのすでにある予約の前後1時間(開始が1時間以内=21:00の予約なら、20:00〜22:00開始)の枠を、全員が選べない
//    (data/booked.json の cast。接客60分＋余裕30分=90分の重なりと同じ結果)。選べる枠が無い日は、そのキャストを選べない。
//  ・予約した人は、その予約の時刻になるまで、次のお申し込みができない(このブラウザーでの目安。本当の判定は、名前とメールで、予約セッションのGASが行う)。
//  ・指名なしは、その時間帯に出勤しているキャストの人数 − 2(指名のために空けておく人数)までの件数だけ、受け付ける
//    (同じ時間帯の指名なしの予約を、data/booked.json の any で数える)。人数が足りない時間帯は、選べない。
//  ・指名のあるキャストが、通常サロンで指名なしの担当に回ること(指名のお客様が優先)は、運営の割り当ての話なので、ここでは数えない。
(function () {
  const cfg = window.APPLY_CONFIG || {};
  const root = document.getElementById("apply");
  if (!root) return;

  const FIELD_KEYS = ["plan", "cast", "date", "slot", "name", "vrchat", "x", "email"];
  const SLOT = Object.assign({ unit: 30, service: 60, block: 90, anyReserve: 2, eventGap: 60 }, cfg.slot || {});
  const SUFFIX = cfg.nominationSuffix || "＋指名";

  // answers: date(2026-12-05) / room / nominate("yes"|"no") / cast(名前) / castId / slot(開始の分) / name / email
  const answers = {};
  let step = 0;
  let sending = false;
  let castList = [];   // [{ id, name, image }]
  let bizDays = [];    // [{ date }](出勤予定に日付がある日。今日以降)
  let schedule = {};   // { キャストid: { 日付: ["20:00-23:00"] } }
  let booked = {};     // { cast: { キャストid: { 日付: ["21:00"] } } }

  // 入口ごとの事前入力(URLの ?cast=キャストid&date=2026-12-05)。
  //  ・トップやヘッダーから: 何もなし(最初から順に入力)
  //  ・キャストの紹介ページから: ?cast=…  → 指名ありで、そのキャストが選ばれた状態。指名の有無とキャストの選択は飛ばす
  //  ・キャストの出勤予定の日付から: ?cast=…&date=…  → さらに、営業日の選択も飛ばす
  const params = new URLSearchParams(location.search);
  const castParam = params.get("cast") || "";
  const dateParam = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") || "") ? params.get("date") : "";
  let castLocked = false;
  let dateLocked = false;
  let dateNote = "";

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // 送信先と、質問の番号がすべて入っているときだけ、受け付ける
  const configured =
    typeof cfg.action === "string" && /^https?:\/\//.test(cfg.action) &&
    cfg.fields && FIELD_KEYS.every((k) => typeof cfg.fields[k] === "string" && /^entry\.\d+$/.test(cfg.fields[k]));

  const rooms = Array.isArray(cfg.rooms) ? cfg.rooms : [];

  /* ---------- 日付・時刻の道具(日本時間) ---------- */
  const nowJst = () => new Date(Date.now() + 9 * 3600 * 1000);
  const todayIso = () => nowJst().toISOString().slice(0, 10);
  const nowMinutes = () => nowJst().getUTCHours() * 60 + nowJst().getUTCMinutes();
  const hhmm = (m) => pad2(Math.floor(m / 60)) + ":" + pad2(m % 60);   // 24時を超えても、そのまま(25:00 など)
  const toMin = (h, m) => Number(h) * 60 + Number(m);
  // 「2026-12-05」→「2026年12月5日(土)」(次回開催の日付の書き方と同じ)
  const dateLabel = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return y + "年" + m + "月" + d + "日(" + WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ")";
  };

  /* ---------- 営業日・出勤・枠 ---------- */
  // 通常営業の枠は、固定の開催時刻(設定 regularStart)の1つだけ。開始が開催時刻と同じ枠が「通常」、それ以外の枠は「時間外」。
  // 通常営業の日は、設定 regularWeekday(0=日曜〜6=土曜。例 6)の曜日だけ。空のあいだは、毎日(出勤予定のある日は、すべて通常営業の日)。
  // その曜日ではない日は、通常営業がないので、出勤予定の枠は、すべて時間外。
  // regularStart が空のあいだは、すべて「通常」(時間外にしない)。
  const regularTime = () => {   // 固定の開催時刻(0時からの分)。無いときは null
    const m = String(cfg.regularStart || "").match(/^(\d{1,2}):(\d{2})$/);
    return m ? toMin(m[1], m[2]) : null;
  };
  const regularDay = (iso) => {   // その日は、通常営業の日か
    const w = cfg.regularWeekday;
    if (w === undefined || w === null || w === "") return true;
    return new Date(iso + "T00:00:00Z").getUTCDay() === Number(w);
  };
  const regularMin = (iso) => (regularDay(iso) ? regularTime() : null);   // その日の通常営業の枠(開始の分)。通常営業がない日は null
  // 通常営業の日は、通常営業の開始時刻の前後 eventGap 分(1時間)以内の枠は、選べない(開催時刻ちょうどの枠は、通常営業の枠なので、選べる)。
  // 21:00開催なら、20:00・20:30・21:30・22:00 が不可。通常営業のない日は、この制限をかけない。
  const aroundRegular = (iso, s) => {
    const t = regularMin(iso);
    return t !== null && s !== t && Math.abs(s - t) <= SLOT.eventGap;
  };
  const slotType = (iso, s) => {
    if (regularTime() === null) return "通常";
    const t = regularMin(iso);
    return t !== null && s === t ? "通常" : "時間外";
  };
  // いま選んでいる時間帯の種類(通常か時間外)。時間帯を選ぶまでは、通常
  const typeOf = () => (answers.slot === undefined ? "通常" : slotType(answers.date, answers.slot));
  // 出勤予定に日付がある日(今日以降)を、営業日にする
  const scheduleDays = () => {
    const set = {};
    Object.keys(schedule).forEach((cid) => {
      const days = schedule[cid] || {};
      Object.keys(days).forEach((d) => { if (/^\d{4}-\d{2}-\d{2}$/.test(d) && parseWindows(days[d]).length > 0) set[d] = true; });
    });
    return Object.keys(set).filter((d) => d >= todayIso()).sort().map((d) => ({ date: d }));
  };

  // 出勤予定の文字(「20:00-23:30」)を、分の範囲にする。時刻が読めないもの(「出勤」だけ)は、枠を作れないので、除く
  function parseWindows(list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((t) => {
      const m = String(t).match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~〜～–ー－]\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
      if (!m) return;
      const s = toMin(m[1], m[2]);
      const e = toMin(m[3], m[4]);
      if (e > s) out.push({ s, e });
    });
    return out;
  }
  const castWindows = (castId, date) => parseWindows(schedule[castId] && schedule[castId][date]);
  const castWorks = (castId, date) => castWindows(castId, date).length > 0;
  // そのキャストが、その日に指名できる(選べる枠が、ひとつでも残っている)か。
  // すでにある予約が終わったあと(接客60分＋余裕30分のあと)の枠なら、同じキャストでも、続けて指名できる。
  const castFree = (castId, date) => castWorks(castId, date) && hasOpenSlot(date, castId);

  // 予約の開始時刻の一覧(「21:00」の文字)を、分にする
  const startsToMin = (list) => (Array.isArray(list) ? list : [])
    .map((t) => { const m = String(t).match(/(\d{1,2}):(\d{2})/); return m ? toMin(m[1], m[2]) : null; })
    .filter((x) => x !== null);

  // 指名なしの受付数: 30分の区間(開始が u)に出勤しているキャストの人数 − 指名のために空けておく人数
  const anyCapacity = (date, u) => Math.max(0, castList.filter((c) =>
    castWindows(c.id, date).some((w) => w.s <= u && u + SLOT.unit <= w.e)).length - SLOT.anyReserve);

  // 指名なしの予約を s に入れたとき、すでにある指名なしの予約(starts)とあわせて、受付数を超えないか。
  // 1件の予約は、開始から block 分(接客＋余裕)、ひとりのキャストをふさぐ。受付数は、接客している区間(service分)で見る。
  function anyFits(date, s, starts) {
    const all = starts.concat([s]);
    for (let u = s; u < s + SLOT.block; u += SLOT.unit) {
      if (!all.some((b) => b <= u && u < b + SLOT.service)) continue;
      const busy = all.filter((b) => b <= u && u < b + SLOT.block).length;
      if (busy > anyCapacity(date, u)) return false;
    }
    return true;
  }

  // その日の枠の一覧。castId があれば、そのキャストの出勤とブロックで、なければ、指名なしの受付数で決める。
  // reason: ""=選べる / "out"=出勤時間外(指名なしは、人数が足りない時間帯) / "past"=過ぎた枠 / "booked"=予約済みの枠に近い、または指名なしが満席
  function slotList(date, castId) {
    let windows = [];
    if (castId) windows = castWindows(castId, date);
    else castList.forEach((c) => { windows = windows.concat(castWindows(c.id, date)); });
    if (windows.length === 0) return [];

    const bk = booked || {};
    const bookedMin = castId ? startsToMin(((bk.cast || {})[castId] || {})[date]) : [];
    const anyMin = castId ? [] : startsToMin((bk.any || {})[date]);
    const today = todayIso();
    const nowMin = nowMinutes();
    const lo = Math.min.apply(null, windows.map((w) => w.s));
    const hi = Math.max.apply(null, windows.map((w) => w.e));

    // 出勤の時間帯の中の、30分刻みの枠すべて。開催時刻と同じ開始の枠が通常、それ以外は時間外(type)
    const out = [];
    for (let s = Math.ceil(lo / SLOT.unit) * SLOT.unit; s + SLOT.service <= hi; s += SLOT.unit) {
      let reason = "";
      let inShift;
      if (castId) {
        inShift = windows.some((w) => w.s <= s && s + SLOT.service <= w.e);
      } else {
        inShift = true;
        for (let u = s; u < s + SLOT.service; u += SLOT.unit) if (anyCapacity(date, u) < 1) { inShift = false; break; }
      }
      if (!inShift) reason = "out";
      else if (date < today || (date === today && s <= nowMin)) reason = "past";
      else if (aroundRegular(date, s)) reason = "event";
      else if (castId ? bookedMin.some((b) => s < b + SLOT.block && b < s + SLOT.block) : !anyFits(date, s, anyMin)) reason = "booked";
      out.push({ start: s, label: hhmm(s) + "-" + hhmm(s + SLOT.service), type: slotType(date, s), reason });
    }
    return out;
  }
  const hasOpenSlot = (date, castId) => slotList(date, castId).some((s) => !s.reason);

  /* ---------- 流れ ---------- */
  const nominated = () => answers.nominate === "yes";
  const ALL_STEPS = ["nominate", "cast", "date", "slot", "room", "name", "vrchat", "x", "email", "confirm"];
  const steps = () => {
    // 最初に、指名の有無とキャストを決める。キャストを先に選ぶので、営業日は、そのキャストが出勤する日だけが出る。
    const s = [];
    if (!castLocked) s.push("nominate");
    if (nominated() && !castLocked) s.push("cast");
    if (!dateLocked) s.push("date");
    s.push("slot", "room", "name", "vrchat", "x", "email", "confirm");
    return s;
  };
  // そのキャストが、今日以降の営業日のどれかで、指名できる(選べる枠が残っている)か
  const castAnyFree = (castId) => bizDays.some((d) => d.date >= todayIso() && castFree(castId, d.date));
  const castAnyWorks = (castId) => bizDays.some((d) => d.date >= todayIso() && castWorks(castId, d.date));
  const planValue = () => (answers.room || "") + (nominated() ? SUFFIX : "");

  // 選び直したときに、それに頼っている回答を外す
  function setAnswer(key, value) {
    answers[key] = value;
    if (key === "date") {
      delete answers.slot; delete answers.room;   // 時間帯(と、それで決まるお部屋)は、選び直す
      if (answers.castId && !castFree(answers.castId, value)) { delete answers.cast; delete answers.castId; }
    } else if (key === "nominate") {
      delete answers.slot; delete answers.room;
      if (value === "no") { delete answers.cast; delete answers.castId; }
    } else if (key === "cast") {
      delete answers.slot; delete answers.room;
      // キャストを選び直したとき、選んである営業日が、そのキャストで選べなければ、営業日から選び直してもらう
      if (answers.date && !castFree(answers.castId, answers.date)) delete answers.date;
    } else if (key === "slot") {
      // 時間帯で、通常か時間外かが決まる。選んであるお部屋が、その種類で選べなければ、お部屋を選び直す
      const allowed = roomsFor(typeOf()).map((r) => r.value);
      if (answers.room && allowed.indexOf(answers.room) < 0) delete answers.room;
    }
  }
  const roomsFor = (type) => rooms.filter((r) => !Array.isArray(r.types) || r.types.indexOf(type) >= 0);

  /* ---------- 画面の部品 ---------- */
  function show(node) {
    root.textContent = "";
    root.appendChild(node);
    const focus = node.querySelector("[data-autofocus]");
    if (focus) focus.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // 画面の枠(進み具合 → 本体 → 戻る/次へ)
  function frame(title, lead, body, opts) {
    // 進み具合は、最初から全部で10。画面ごとに番号が決まっている(指名なし・キャスト指定済みで飛ばす画面の番号は、とばす)
    const no = ALL_STEPS.indexOf(steps()[step]) + 1;
    const wrap = el("div", "apply-step");

    const bar = el("div", "apply-progress");
    bar.setAttribute("aria-hidden", "true");
    const fill = el("span");
    fill.style.width = Math.round((no / ALL_STEPS.length) * 100) + "%";
    bar.appendChild(fill);
    wrap.appendChild(bar);
    wrap.appendChild(el("p", "apply-count", "STEP " + no + " / " + ALL_STEPS.length));

    // キャストや日付を指定して来たときは、選ばれている内容を見せて、やり直せるようにする
    if (castLocked || dateLocked) {
      const chip = el("p", "apply-preset");
      const parts = [];
      if (castLocked) parts.push("指名：" + answers.cast);
      if (dateLocked) parts.push("希望日：" + dateText());
      chip.appendChild(el("span", null, parts.join("　／　")));
      const reset = el("button", "apply-reset", "選び直す");
      reset.type = "button";
      reset.addEventListener("click", () => {
        castLocked = false;
        dateLocked = false;
        ["date", "room", "nominate", "cast", "castId", "slot"].forEach((k) => delete answers[k]);
        go(0);
      });
      chip.appendChild(reset);
      wrap.appendChild(chip);
    }

    const h = el("h2", "apply-q", title);
    h.tabIndex = -1;
    wrap.appendChild(h);
    if (lead) wrap.appendChild(el("p", "apply-lead", lead));
    wrap.appendChild(body);

    const err = el("p", "apply-error");
    err.setAttribute("role", "alert");
    wrap.appendChild(err);

    const nav = el("div", "apply-nav");
    if (step > 0) {
      const back = el("button", "apply-back", "‹ 戻る");
      back.type = "button";
      back.addEventListener("click", () => go(step - 1));
      nav.appendChild(back);
    }
    if (opts && opts.next !== false) {
      const next = el("button", "btn", (opts && opts.nextLabel) || "次へ");
      next.type = "button";
      next.addEventListener("click", () => opts && opts.onNext && opts.onNext(err));
      nav.appendChild(next);
    }
    wrap.appendChild(nav);
    return { wrap, err };
  }

  function go(n) {
    step = n;
    render();
  }
  function advance() {
    go(Math.min(step + 1, steps().length - 1));
  }

  // 選ぶ画面(カード)。options: [{ value, label, note, image, id }]
  function choiceStep(kind, title, lead, options, selected, onPick, emptyMessage) {
    if (options.length === 0) {
      return frame(title, lead, el("p", "apply-empty", emptyMessage), { next: false }).wrap;
    }
    const grid = el("div", "apply-choices k-" + kind);
    options.forEach((o) => {
      const b = el("button", "apply-choice");
      b.type = "button";
      const on = selected === o.value;
      b.setAttribute("aria-pressed", String(on));
      if (on) b.classList.add("on");
      if (o.image && isSafeUrl(o.image)) {
        const ph = el("span", "ph");
        ph.style.backgroundImage = 'url("' + encodeURI(o.image) + '")';
        b.appendChild(ph);
      } else if (kind === "cast") {
        // 指名するキャストを選ぶ画面は、顔写真(キャスト紹介シートの image)を出す。写真がないキャストは、同じ大きさの枠だけ出す
        b.appendChild(el("span", "ph none", "NO IMAGE"));
      }
      b.appendChild(el("span", "name", o.label || o.value));
      if (o.note) b.appendChild(el("span", "note", o.note));
      if (o.price) b.appendChild(el("span", "price", o.price));
      if (o.yen) b.appendChild(el("span", "yen", "（" + o.yen + "）"));
      if (o.priceNote) b.appendChild(el("span", "note", o.priceNote));
      if (o.disabled) { b.disabled = true; grid.appendChild(b); return; }
      b.addEventListener("click", () => {
        onPick(o);
        grid.querySelectorAll(".apply-choice").forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
        b.classList.add("on");
        b.setAttribute("aria-pressed", "true");
        setTimeout(advance, 160);
      });
      grid.appendChild(b);
    });
    // 選んだ時点で次の画面に進むので、「次へ」ボタンは出さない(選び直しは、もう一度、選択肢を押す)
    return frame(title, lead, grid, { next: false }).wrap;
  }

  // 時間帯の枠を選ぶ画面
  function slotStep() {
    const date = answers.date;
    const castId = nominated() ? answers.castId : "";
    const list = slotList(date, castId);
    const lead = (nominated() ? answers.cast + "の" : "") + dateText() + "の枠です。" + SLOT.service + "分のお時間です。";

    if (!list.some((s) => !s.reason)) {
      const msg = list.length === 0 ? "この日は、選べる枠がありません。" : "この日は、選べる枠が残っていません。";
      return frame("ご希望の時間帯をお選びください", lead, el("p", "apply-empty", msg + "別の日や、別のキャストをお選びください。"), { next: false }).wrap;
    }

    const grid = el("div", "apply-slots");
    list.forEach((s) => {
      const b = el("button", "apply-slot");
      b.type = "button";
      b.appendChild(el("span", "t", hhmm(s.start)));
      b.appendChild(el("span", "u", "〜" + hhmm(s.start + SLOT.service)));
      if (s.type === "時間外" && regularTime() !== null) b.appendChild(el("span", "o", "時間外"));   // 通常営業の枠(開催時刻)以外は、時間外
      if (s.reason) {
        b.disabled = true;
        b.classList.add("off", "r-" + s.reason);
        if (s.reason === "booked") b.setAttribute("title", "ほかのご予約があるため、選べません");
        if (s.reason === "event") b.setAttribute("title", "通常営業の開始の前後1時間のため、選べません");
      } else {
        const on = answers.slot === s.start;
        b.setAttribute("aria-pressed", String(on));
        if (on) b.classList.add("on");
        b.addEventListener("click", () => {
          setAnswer("slot", s.start);
          grid.querySelectorAll(".apply-slot").forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
          b.classList.add("on");
          b.setAttribute("aria-pressed", "true");
          setTimeout(advance, 160);
        });
      }
      grid.appendChild(b);
    });
    const body = el("div");
    body.appendChild(grid);
    // 通常営業の枠は、開催時刻の1つだけ。それ以外の時間帯は、時間外(追加料金)になることを、時間帯を選ぶところで案内する
    const rt = regularTime();
    if (rt !== null) {
      const msg = regularDay(date)
        ? "通常営業は、" + hhmm(rt) + " の枠です。その前後1時間は、お受けしていません。それ以外の時間帯は、時間外の営業となります。"
        : "この日は、通常営業はありません。すべて、時間外の営業となります。";
      body.appendChild(el("p", "apply-notice", msg + (cfg.overtimeNote || "")));
    }
    if (list.length > 1) body.appendChild(el("p", "apply-fine", "灰色の枠は、出勤の時間外か、ほかのご予約のため、選べません。"));
    if (!castId) body.appendChild(el("p", "apply-fine", "指名なしのお席は、時間帯ごとに受付できる数に限りがあります。"));
    return frame("ご希望の時間帯をお選びください", lead, body, { next: false }).wrap;   // 選んだ時点で次へ進むので、「次へ」は出さない
  }

  // 書く画面(下線だけの入力欄)
  function textStep(key, title, lead, attrs, validate) {
    const input = el("input", "apply-input");
    input.type = attrs.type || "text";
    input.placeholder = attrs.placeholder || "";
    input.autocomplete = attrs.autocomplete || "off";
    input.maxLength = 200;
    input.setAttribute("aria-label", title);
    input.setAttribute("data-autofocus", "");
    if (attrs.inputmode) input.inputMode = attrs.inputmode;
    input.value = answers[key] || "";

    const done = (err) => {
      const v = input.value.trim();
      const msg = validate(v);
      if (msg) { err.textContent = msg; input.focus(); return; }
      answers[key] = v;
      advance();
    };
    const { wrap, err } = frame(title, lead, input, { onNext: done });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); done(err); } });
    return wrap;
  }

  /* ---------- お名前のエスケープ(保存する前に、必ず通す) ---------- */
  // お名前は自由に書ける欄なので、台帳(スプレッドシート)やメール、名簿の画面で、式やHTMLとして働かないようにしてから送る。
  //  1. 制御文字と、見えない文字(ゼロ幅・文字の向きを変える記号)を取り除く
  //  2. HTMLの記号を、文字参照に置き換える( & → &amp;  < → &lt;  > → &gt;  " → &quot;  ' → &#39; )
  //  3. 先頭が = + - @ のときは、頭に ' を付ける(スプレッドシートで、式として扱われないように)
  // 確認画面には、入力されたままの名前を見せる(送る値だけを変える)。
  // この画面を通さずに、フォームへ直接送られた回答には効かないので、受け取る側(予約のGAS)でも、同じ処理をする。
  const escapeName = (v) => {
    let s = String(v == null ? "" : v)
      .replace(/[\u0000-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g, "")
      .trim()
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return s;
  };

  /* ---------- プロフィールのURL(VRChat・X) ---------- */
  // 入力された文字を、決まった形のURLにする。読めないときは、空の文字を返す。
  //  ・VRChat: https://vrchat.com/home/user/usr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (ユーザーのプロフィールページ)
  //  ・X: https://x.com/ユーザー名 (twitter.com でも可。ユーザー名は半角英数字と _ の15文字まで)
  const normalizeVrchat = (v) => {
    const m = String(v).trim().match(/^(?:https?:\/\/)?(?:www\.)?vrchat\.com\/home\/user\/(usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?(?:[?#].*)?$/i);
    return m ? "https://vrchat.com/home/user/" + m[1].toLowerCase() : "";
  };
  const normalizeX = (v) => {
    const m = String(v).trim().match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/i);
    return m && !/^(home|i|explore|search|settings|messages|notifications|intent|share|compose)$/i.test(m[1]) ? "https://x.com/" + m[1] : "";
  };

  /* ---------- 料金 ---------- */
  // 設定(apply-config.js): 部屋ごとの price(予約料金)・nominationFee(指名料)と、時間外の overtimeFee(どれも、数字。単位はクレジット)。
  // price が数字で入っていない部屋は、料金を出さない。
  const money = (n) => Number(n).toLocaleString("ja-JP") + "クレジット";
  // 日本円に換算した目安(「約1,880円」)。設定 yenRate: { credits: 600, yen: ○○ }(○クレジットを買うときの円の価格)から計算し、10円単位に丸める。
  // 設定が入っていないあいだは、空の文字(円は出さない)。お支払いはクレジットなので、円は、あくまで目安として添える。
  const yenText = (credits) => {
    const r = cfg.yenRate;
    if (!r || !(Number(r.credits) > 0) || !(Number(r.yen) > 0)) return "";
    return "約" + (Math.round((credits * Number(r.yen)) / Number(r.credits) / 10) * 10).toLocaleString("ja-JP") + "円";
  };
  const roomOf = (value) => rooms.find((r) => r.value === value);
  function priceOf(room, withNomination, type) {
    if (!room || typeof room.price !== "number") return null;
    const parts = [["予約料金", room.price]];
    if (withNomination && typeof room.nominationFee === "number") parts.push(["指名料", room.nominationFee]);
    if (type === "時間外" && typeof cfg.overtimeFee === "number") parts.push(["時間外手数料", cfg.overtimeFee]);
    return { parts, total: parts.reduce((a, p) => a + p[1], 0) };
  }

  const slotText = () => (answers.slot === undefined ? "" : hhmm(answers.slot) + "-" + hhmm(answers.slot + SLOT.service));
  // 時間外の枠には、「（時間外）」を付けて送る(通常と時間外を、受け取る側で見分けるため)
  const slotSendText = () => slotText() + (typeOf() === "時間外" && regularTime() !== null ? "（時間外）" : "");
  const dateText = () => dateLabel(answers.date);

  function confirmStep() {
    const dl = el("dl", "apply-summary");
    const rows = [["希望の営業日", dateText()], ["区分", planValue()]];
    if (nominated()) rows.push(["指名キャスト", answers.cast]);
    rows.push(["希望の時間帯", slotSendText()]);
    const pr = priceOf(roomOf(answers.room), nominated(), typeOf());
    if (pr) {
      pr.parts.forEach(([k, v]) => rows.push([k, money(v)]));
      rows.push(["合計", money(pr.total) + (yenText(pr.total) ? "（" + yenText(pr.total) + "）" : "")]);
    } else if (typeOf() === "時間外" && cfg.overtimeFee) {
      rows.push(["時間外手数料", typeof cfg.overtimeFee === "number" ? money(cfg.overtimeFee) : cfg.overtimeFee]);
    }
    rows.push(["お名前", answers.name], ["VRChatのプロフィール", normalizeVrchat(answers.vrchat)], ["Xのプロフィール", normalizeX(answers.x)], ["メールアドレス", answers.email]);
    rows.forEach(([k, v]) => {
      const d = el("div");
      d.appendChild(el("dt", null, k));
      d.appendChild(el("dd", null, v));
      dl.appendChild(d);
    });

    const body = el("div");
    body.appendChild(dl);
    if (typeOf() === "時間外" && cfg.overtimeNote && !pr) body.appendChild(el("p", "apply-fine", cfg.overtimeNote));
    if (nominated() && !pr) body.appendChild(el("p", "apply-fine", "指名料が加算されます。"));   // 料金が設定されているときは、内訳の行に出る
    // いたずら送信よけ(人には見えない欄。入っていたら、送らない)
    const trap = el("input", "apply-trap");
    trap.type = "text"; trap.name = "website"; trap.tabIndex = -1; trap.autocomplete = "off";
    trap.setAttribute("aria-hidden", "true");
    body.appendChild(trap);
    body.appendChild(el("p", "apply-fine", "枠は先着順です。ほぼ同時に申し込みがあった場合は、先に送信された方を優先し、お申し込みが反映されないことがあります。その場合は、メールでお知らせします。"));
    body.appendChild(el("p", "apply-fine", "送信すると、ご入力のメールアドレス宛に、確認のメールをお送りします。"));

    const { wrap, err } = frame("この内容で、お申し込みしますか？", "内容をご確認ください。", body, {
      nextLabel: "お申し込みする",
      onNext: () => submit(err, trap, wrap),
    });
    return wrap;
  }

  async function submit(err, trap, wrap) {
    if (sending) return;
    err.textContent = "";
    if (trap.value) { finish(); return; }     // 人ではない送信は、何もせずに終わらせる
    sending = true;
    const btn = wrap.querySelector(".apply-nav .btn");
    btn.disabled = true;
    btn.textContent = "送信しています…";

    const body = new URLSearchParams();
    body.set(cfg.fields.plan, planValue());
    body.set(cfg.fields.cast, nominated() ? answers.cast : "");
    body.set(cfg.fields.date, dateText());
    body.set(cfg.fields.slot, slotSendText());   // 時間外の枠には「（時間外）」が付く(例 18:00-19:00（時間外）)
    body.set(cfg.fields.name, escapeName(answers.name));   // お名前は、必ずエスケープしてから送る
    body.set(cfg.fields.vrchat, normalizeVrchat(answers.vrchat));
    body.set(cfg.fields.x, normalizeX(answers.x));
    body.set(cfg.fields.email, answers.email);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);   // 通信が止まったままにならないように
    try {
      // Googleフォームの回答の受け口へ送る。返事は(別のサイトなので)読めない。通信そのものが失敗したときだけ分かる。
      await fetch(cfg.action, { method: "POST", mode: "no-cors", body, signal: ctrl.signal });
      clearTimeout(timer);
      saveLock();
      finish();
    } catch (e) {
      clearTimeout(timer);
      sending = false;
      btn.disabled = false;
      btn.textContent = "お申し込みする";
      err.textContent = "送信できませんでした。通信の状態をご確認のうえ、もう一度お試しください。";
    }
  }

  /* ---------- 予約した人は、その予約の時刻になるまで、次のお申し込みができない(このブラウザーでの目安) ---------- */
  const LOCK_KEY = "belvedere.lastBooking";
  function saveLock() {
    try { localStorage.setItem(LOCK_KEY, JSON.stringify({ date: answers.date, start: answers.slot })); } catch (e) { /* 保存できなくても、そのまま進む */ }
  }
  function activeLock() {
    try {
      const v = JSON.parse(localStorage.getItem(LOCK_KEY) || "null");
      if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v.date || "") || typeof v.start !== "number") return null;
      const today = todayIso();
      return v.date > today || (v.date === today && v.start > nowMinutes()) ? v : null;
    } catch (e) { return null; }
  }
  function lockedScreen(v) {
    const wrap = el("div", "apply-step apply-done");
    wrap.appendChild(el("p", "apply-count", "RESERVED"));
    const h = el("h2", "apply-q", "お申し込み済みのご予約があります");
    h.tabIndex = -1;
    wrap.appendChild(h);
    wrap.appendChild(el("p", "apply-lead", dateLabel(v.date) + " " + hhmm(v.start) + "〜 のご予約です。その時刻になるまで、次のお申し込みはできません。"));
    const back = el("a", "btn btn-ghost", "トップへ戻る");
    back.href = "index.html";
    wrap.appendChild(back);
    const fine = el("p", "apply-fine", "お申し込みが受け付けられなかったとお知らせのメールが届いた場合は、");
    const release = el("button", "apply-reset", "こちらで解除できます");
    release.type = "button";
    release.addEventListener("click", () => {
      try { localStorage.removeItem(LOCK_KEY); } catch (e) { /* 何もしない */ }
      render();
    });
    fine.appendChild(release);
    fine.appendChild(document.createTextNode("。"));
    wrap.appendChild(fine);
    return wrap;
  }

  function finish() {
    const wrap = el("div", "apply-step apply-done");
    wrap.appendChild(el("p", "apply-count", "THANK YOU"));
    const h = el("h2", "apply-q", "お申し込みを受け付けました");
    h.tabIndex = -1;
    wrap.appendChild(h);
    wrap.appendChild(el("p", "apply-lead", "ご入力のメールアドレス宛に、確認のメールをお送りします。"));
    wrap.appendChild(el("p", "apply-fine", "しばらくしてもメールが届かない場合は、迷惑メールのフォルダーをご確認ください。"));
    const back = el("a", "btn btn-ghost", "トップへ戻る");
    back.href = "index.html";
    wrap.appendChild(back);
    show(wrap);
    h.focus({ preventScroll: true });
  }

  /* ---------- 各ステップ ---------- */
  function render() {
    const lock = activeLock();
    if (lock) { show(lockedScreen(lock)); return; }
    const name = steps()[step];
    let node;
    if (name === "date") {
      const today = todayIso();
      const options = bizDays
        .filter((d) => d.date >= today)
        // 接客できるキャストがいない日(出勤がない・枠が残っていない日)は、出さない。指名ありは、そのキャストで選べる日だけ。
        .filter((d) => (answers.castId ? castFree(answers.castId, d.date) : hasOpenSlot(d.date, "")))
        .map((d) => ({ value: d.date, date: d.date, label: dateLabel(d.date) }));
      node = choiceStep("date", "ご希望の営業日をお選びください", dateNote, options, answers.date,
        (o) => setAnswer("date", o.date),
        castLocked ? answers.cast + "は、お申し込みできる営業日がありません(枠が埋まっています)。「選び直す」から、別のキャストや指名なしをお選びください。"
          : answers.castId ? answers.cast + "は、お申し込みできる営業日がありません(枠が埋まっています)。「戻る」から、別のキャストや指名なしをお選びください。"
          : "お申し込みできる営業日は、調整中です。決まり次第、受け付けます。");
    } else if (name === "room") {
      // お部屋を選ぶときに、料金を出す(指名ありなら指名料を足した合計、時間外なら時間外手数料も足した合計)
      const options = roomsFor(typeOf()).map((r) => {
        const p = priceOf(r, nominated(), typeOf());
        return {
          value: r.value, note: r.note,
          price: p ? money(p.total) : "",
          yen: p ? yenText(p.total) : "",
          priceNote: p && p.parts.length > 1 ? p.parts.map((x) => x[0] + " " + x[1].toLocaleString("ja-JP")).join(" ＋ ") : "",
        };
      });
      node = choiceStep("room", "ご希望のお部屋をお選びください", options.some((o) => o.yen) ? (cfg.yenNote || "") : "",
        options, answers.room, (o) => setAnswer("room", o.value), "お部屋は準備中です。");
    } else if (name === "nominate") {
      node = choiceStep("nominate", "指名をされますか？", "", [
        { value: "no", label: "指名なし" },
        { value: "yes", label: "指名あり", note: "指名料が加算されます。" },
      ], answers.nominate, (o) => setAnswer("nominate", o.value), "");
    } else if (name === "cast") {
      // 営業日より先に選ぶので、今日以降の営業日のどれかに出勤するキャストを出す(枠がすべて埋まっているキャストは、灰色)
      const options = castList
        .filter((c) => castAnyWorks(c.id))
        .map((c) => ({ value: c.name, id: c.id, image: c.image, disabled: !castAnyFree(c.id), note: castAnyFree(c.id) ? "" : "お申し込みできる枠は、埋まっています" }));
      node = choiceStep("cast", "指名するキャストをお選びください", "出勤の予定があるキャストです。出勤日は、キャストの紹介ページでもご覧いただけます。", options, answers.cast,
        (o) => { answers.castId = o.id; setAnswer("cast", o.value); }, "出勤するキャストは、決まり次第、お知らせします。");
    } else if (name === "slot") {
      node = slotStep();
    } else if (name === "name") {
      node = textStep("name", "お名前を教えてください", "VRChatでの表示名をご記入ください。", { placeholder: "お名前", autocomplete: "nickname" },
        (v) => (escapeName(v) ? (v.length > 100 ? "100文字以内でご記入ください。" : "") : "お名前をご記入ください。"));   // 見えない文字だけの名前は、空として扱う
    } else if (name === "vrchat") {
      node = textStep("vrchat", "VRChatのプロフィールのURLを教えてください", "VRChatのサイトで、ご自身のプロフィールページを開き、そのURLをご記入ください(例 https://vrchat.com/home/user/usr_…)。", { type: "text", placeholder: "https://vrchat.com/home/user/usr_...", autocomplete: "off", inputmode: "url" },
        (v) => (normalizeVrchat(v) ? "" : "VRChatのプロフィールのURLをご確認ください(https://vrchat.com/home/user/usr_… の形です)。"));
    } else if (name === "x") {
      node = textStep("x", "XのプロフィールのURLを教えてください", "ご自身のXのプロフィールのURLをご記入ください(例 https://x.com/アカウント名)。", { type: "text", placeholder: "https://x.com/...", autocomplete: "off", inputmode: "url" },
        (v) => (normalizeX(v) ? "" : "XのプロフィールのURLをご確認ください(https://x.com/アカウント名 の形です)。"));
    } else if (name === "email") {
      node = textStep("email", "メールアドレスを教えてください", "確認のメールをお送りします。", { type: "email", placeholder: "example@mail.com", autocomplete: "email", inputmode: "email" },
        (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "" : "メールアドレスの形式をご確認ください。"));
    } else {
      node = confirmStep();
    }
    show(node);
  }

  function start() {
    if (!configured) {
      root.textContent = "";
      root.appendChild(el("p", "apply-empty", "お申し込みの受付は、準備中です。準備ができ次第、こちらでご案内します。"));
      return;
    }
    render();
  }

  // 入口で指定されたキャストと日付を、選択済みにする(読み込みのあと)
  function applyPresets() {
    if (!castParam) return;
    const c = castList.find((x) => x.id === castParam);
    if (!c) return;
    answers.cast = c.name;
    answers.castId = c.id;
    answers.nominate = "yes";
    castLocked = true;
    if (dateParam) {
      const day = bizDays.find((d) => d.date === dateParam && d.date >= todayIso());
      if (day && castFree(c.id, day.date)) {
        answers.date = day.date;
        dateLocked = true;
      } else if (day && castWorks(c.id, day.date)) {
        dateNote = dateLabel(dateParam) + "は、" + c.name + "の枠がすべて埋まっています。別の営業日をお選びください。";
      } else {
        dateNote = dateLabel(dateParam) + "は、お申し込みの受付日に含まれていません。ご希望の営業日をお選びください。";
      }
    }
  }

  // キャスト(指名の候補)・営業日・出勤予定・予約済みの枠を読んでから、始める。
  // 予約済みの枠(booked.json)と出勤予定が読めないときは、その分の制限なしで進める(送信後に、運営側が判定する)。
  const empty = () => ({});
  Promise.all([
    loadJson("data/cast.json").catch(() => []),
    loadJson("data/schedule.json").catch(empty),
    loadJson("data/booked.json").catch(empty),
  ]).then(([cast, sched, bk]) => {
    // id は、キャストの詳細ページと同じ規則(castId: 並び順を含むので、名前で絞る前に付ける)
    castList = (Array.isArray(cast) ? cast : [])
      .map((c, i) => (c ? { id: castId(c, i), name: c.name, image: c.image } : null))
      .filter((c) => c && c.name);
    schedule = sched && typeof sched === "object" ? sched : {};
    booked = bk && typeof bk === "object" ? bk : {};
    bizDays = scheduleDays();   // 出勤予定に日付がある日が、営業日
    applyPresets();
    start();
  });
})();
