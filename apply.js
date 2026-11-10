// お申し込み画面。1問ずつ進む形で入力してもらい、最後に確認して、Googleフォームへ送信する。
// Googleフォームの画面は出さない。設定は apply-config.js。読み込みに失敗したときは、HTML側の文言が残る。
//
// 流れ: 営業日 → 部屋 → 指名の有無 →(指名ありなら)キャスト → 時間帯の枠 → お名前 → VRChatのプロフィールURL → XのプロフィールURL → メールアドレス → 確認 → 送信
//  ・営業日は、data/days.json(営業日時シート)。種類が「時間外」の日は、選べる部屋が変わり、手数料の案内が出る。
//  ・通常営業は、予約に関係なく、固定の開催時刻(設定 regularStart。営業日時シートの start で日ごとに変えることも可)に開催する。
//    その前後1時間以内の開始は、開始時刻ちょうどを除いて、全員が一律で選べない
//    (21:00開催なら、20:00・20:30・21:30・22:00が不可。21:00と、それより外の時刻は選べる)。時間外の営業・時刻が無い日は、かけない。
//  ・同じ日付に、通常営業と時間外の両方がある日は、営業日の選択肢に2つ出る(時間外には「（時間外）」が付く)。部屋・手数料・前後の予約不可は、それぞれ別。
//    → 営業日(日付)を決めれば、予約できない日時も決まる。
//  ・枠は30分単位。キャストの出勤予定(data/schedule.json)の時間帯の中だけ選べる。
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

  // answers: date(2026-12-05) / type("通常"か"時間外"。同じ日付に両方ある日があるので、日付とあわせて営業日として選ぶ) / room / nominate("yes"|"no") / cast(名前) / castId / slot(開始の分) / name / email
  const answers = {};
  let step = 0;
  let sending = false;
  let castList = [];   // [{ id, name, image }]
  let bizDays = [];    // [{ date, type }]
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
  // いま選んでいる営業の種類。同じ日付に、通常営業と時間外の両方がある日があるので、日付だけでは決まらない(営業日の選択で決める)。
  const typeOf = () => answers.type || "通常";
  // 通常営業は、予約に関係なく、営業日時シートの start の時刻に開催する。その前後 eventGap 分(1時間)以内の開始は、
  // 開始時刻ちょうどを除いて、全キャスト・全員が一律で、予約できない(21:00開催なら、20:00・20:30・21:30・22:00)。
  // 開催時刻は、基本的に固定(設定 regularStart)。営業日時シートの start に書いた日だけ、その時刻を使う(例外の日用)。
  // 時刻がどちらにも無い日、時間外の営業は、かけない(同じ日に、通常営業と時間外の両方がある場合も、時間外の営業にはかけない)。
  function eventBlocked(iso, s, type) {
    if (type !== "通常") return false;
    const d = bizDays.find((x) => x.date === iso && x.type === "通常");
    const start = d && (d.start || cfg.regularStart);
    if (!start) return false;
    const m = String(start).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return false;
    const t = toMin(m[1], m[2]);
    return s !== t && Math.abs(s - t) <= SLOT.eventGap;
  }

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
  const castFree = (castId, date, type) => castWorks(castId, date) && hasOpenSlot(date, castId, type);

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
  function slotList(date, castId, type) {
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
      else if (eventBlocked(date, s, type)) reason = "event";
      else if (castId ? bookedMin.some((b) => s < b + SLOT.block && b < s + SLOT.block) : !anyFits(date, s, anyMin)) reason = "booked";
      out.push({ start: s, label: hhmm(s) + "-" + hhmm(s + SLOT.service), reason });
    }
    return out;
  }
  const hasOpenSlot = (date, castId, type) => slotList(date, castId, type).some((s) => !s.reason);

  /* ---------- 流れ ---------- */
  const nominated = () => answers.nominate === "yes";
  const steps = () => {
    const s = [];
    if (!dateLocked) s.push("date");
    s.push("room");
    if (!castLocked) s.push("nominate");
    if (nominated() && !castLocked) s.push("cast");
    s.push("slot", "name", "vrchat", "x", "email", "confirm");
    return s;
  };
  const planValue = () => (answers.room || "") + (nominated() ? SUFFIX : "");

  // 選び直したときに、それに頼っている回答を外す
  function setAnswer(key, value) {
    answers[key] = value;
    if (key === "date") {
      delete answers.slot;
      const allowed = roomsFor(typeOf()).map((r) => r.value);
      if (answers.room && allowed.indexOf(answers.room) < 0) delete answers.room;
      if (answers.castId && !castFree(answers.castId, value, typeOf())) { delete answers.cast; delete answers.castId; }
    } else if (key === "nominate") {
      delete answers.slot;
      if (value === "no") { delete answers.cast; delete answers.castId; }
    } else if (key === "cast") {
      delete answers.slot;
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
    const list = steps();
    const wrap = el("div", "apply-step");

    const bar = el("div", "apply-progress");
    bar.setAttribute("aria-hidden", "true");
    const fill = el("span");
    fill.style.width = Math.round(((step + 1) / list.length) * 100) + "%";
    bar.appendChild(fill);
    wrap.appendChild(bar);
    wrap.appendChild(el("p", "apply-count", "STEP " + (step + 1) + " / " + list.length));

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
      }
      b.appendChild(el("span", "name", o.label || o.value));
      if (o.note) b.appendChild(el("span", "note", o.note));
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
    const { wrap, err } = frame(title, lead, grid, {
      onNext: (e) => { if (selected === undefined && !grid.querySelector(".on")) e.textContent = "ひとつお選びください。"; else advance(); },
    });
    return wrap;
  }

  // 時間帯の枠を選ぶ画面
  function slotStep() {
    const date = answers.date;
    const castId = nominated() ? answers.castId : "";
    const list = slotList(date, castId, answers.type);
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
      if (s.reason) {
        b.disabled = true;
        b.classList.add("off", "r-" + s.reason);
        if (s.reason === "booked") b.setAttribute("title", "ほかのご予約があるため、選べません");
        if (s.reason === "event") b.setAttribute("title", "営業の開始の前後のため、選べません");
      } else {
        const on = answers.slot === s.start;
        b.setAttribute("aria-pressed", String(on));
        if (on) b.classList.add("on");
        b.addEventListener("click", () => {
          answers.slot = s.start;
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
    body.appendChild(el("p", "apply-fine", "灰色の枠は、出勤の時間外か、ほかのご予約のため、選べません。"));
    if (!castId) body.appendChild(el("p", "apply-fine", "指名なしのお席は、時間帯ごとに受付できる数に限りがあります。"));
    return frame("ご希望の時間帯をお選びください", lead, body, {
      onNext: (e) => { if (answers.slot === undefined) e.textContent = "ひとつお選びください。"; else advance(); },
    }).wrap;
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

  const slotText = () => (answers.slot === undefined ? "" : hhmm(answers.slot) + "-" + hhmm(answers.slot + SLOT.service));
  const dateText = () => dateLabel(answers.date) + (typeOf() === "時間外" ? "（時間外）" : "");

  function confirmStep() {
    const dl = el("dl", "apply-summary");
    const rows = [["希望の営業日", dateText()], ["区分", planValue()]];
    if (nominated()) rows.push(["指名キャスト", answers.cast]);
    rows.push(["希望の時間帯", slotText()]);
    if (typeOf() === "時間外" && cfg.overtimeFee) rows.push(["時間外手数料", cfg.overtimeFee]);
    rows.push(["お名前", answers.name], ["VRChatのプロフィール", normalizeVrchat(answers.vrchat)], ["Xのプロフィール", normalizeX(answers.x)], ["メールアドレス", answers.email]);
    rows.forEach(([k, v]) => {
      const d = el("div");
      d.appendChild(el("dt", null, k));
      d.appendChild(el("dd", null, v));
      dl.appendChild(d);
    });

    const body = el("div");
    body.appendChild(dl);
    if (typeOf() === "時間外" && cfg.overtimeNote) body.appendChild(el("p", "apply-fine", cfg.overtimeNote));
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
    body.set(cfg.fields.date, dateText());   // 時間外の営業には「（時間外）」が付く(同じ日に、通常営業と時間外の両方がある日を見分けるため)
    body.set(cfg.fields.slot, slotText());
    body.set(cfg.fields.name, answers.name);
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
        .filter((d) => !castLocked || castFree(answers.castId, d.date, d.type))
        .map((d) => ({ value: d.date + "|" + d.type, date: d.date, type: d.type, label: dateLabel(d.date) + (d.type === "時間外" ? "（時間外）" : ""), note: d.type === "時間外" ? "時間外の営業です。" + (cfg.overtimeNote || "") : "" }));
      node = choiceStep("date", "ご希望の営業日をお選びください", dateNote, options, answers.date ? answers.date + "|" + typeOf() : undefined,
        (o) => { answers.type = o.type; setAnswer("date", o.date); },
        castLocked ? answers.cast + "は、お申し込みできる営業日がありません(枠が埋まっています)。「選び直す」から、別のキャストや指名なしをお選びください。"
          : "お申し込みできる営業日は、調整中です。決まり次第、受け付けます。");
    } else if (name === "room") {
      const options = roomsFor(typeOf()).map((r) => ({ value: r.value, note: r.note }));
      node = choiceStep("room", "ご希望のお部屋をお選びください", typeOf() === "時間外" ? "時間外の営業は、スイートのみのご案内です。" : "",
        options, answers.room, (o) => setAnswer("room", o.value), "お部屋は準備中です。");
    } else if (name === "nominate") {
      node = choiceStep("nominate", "指名をされますか？", "指名は、1回のご予約につき、1人のキャストにお願いします。", [
        { value: "no", label: "指名なし", note: "担当のキャストは、運営が決めます。" },
        { value: "yes", label: "指名する", note: "お好きなキャストを、1人、指名できます。" },
      ], answers.nominate, (o) => setAnswer("nominate", o.value), "");
    } else if (name === "cast") {
      const options = castList
        .filter((c) => castWorks(c.id, answers.date))
        .map((c) => ({ value: c.name, id: c.id, image: c.image, disabled: !hasOpenSlot(answers.date, c.id, typeOf()), note: hasOpenSlot(answers.date, c.id, typeOf()) ? "" : "この日の枠は、埋まっています" }));
      node = choiceStep("cast", "指名するキャストをお選びください", dateText() + "に出勤するキャストです。", options, answers.cast,
        (o) => { setAnswer("cast", o.value); answers.castId = o.id; }, "この日に出勤するキャストは、決まり次第、お知らせします。");
    } else if (name === "slot") {
      node = slotStep();
    } else if (name === "name") {
      node = textStep("name", "お名前を教えてください", "VRChatでの表示名をご記入ください。", { placeholder: "お名前", autocomplete: "nickname" },
        (v) => (v ? (v.length > 100 ? "100文字以内でご記入ください。" : "") : "お名前をご記入ください。"));
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
      // 同じ日付に、通常営業と時間外の両方があるときは、日付だけでは決められない(営業日の選択で、どちらかを選んでもらう)
      const days = bizDays.filter((d) => d.date === dateParam && d.date >= todayIso());
      const free = days.filter((d) => castFree(c.id, d.date, d.type));
      if (days.length === 1 && free.length === 1) {
        answers.date = days[0].date;
        answers.type = days[0].type;
        dateLocked = true;
      } else if (free.length > 1) {
        dateNote = dateLabel(dateParam) + "は、通常営業と時間外の両方があります。ご希望の営業をお選びください。";
      } else if (days.some((d) => castWorks(c.id, d.date))) {
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
    loadJson("data/next.json").catch(empty),
    loadJson("data/days.json").catch(() => []),
    loadJson("data/schedule.json").catch(empty),
    loadJson("data/booked.json").catch(empty),
  ]).then(([cast, next, days, sched, bk]) => {
    // id は、キャストの詳細ページと同じ規則(castId: 並び順を含むので、名前で絞る前に付ける)
    castList = (Array.isArray(cast) ? cast : [])
      .map((c, i) => (c ? { id: castId(c, i), name: c.name, image: c.image } : null))
      .filter((c) => c && c.name);
    bizDays = businessDays(days, next);
    schedule = sched && typeof sched === "object" ? sched : {};
    booked = bk && typeof bk === "object" ? bk : {};
    applyPresets();
    start();
  });
})();
