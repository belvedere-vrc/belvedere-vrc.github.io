// アンケート画面。お申し込み画面(apply.js)と同じ形で、1問ずつ答えてもらい、最後に確認して、アンケート用のGoogleフォームへ送信する。
// Googleフォームの画面は出さない。質問と送信先は survey-config.js(フォームの公開ページから作る)。
//
// 流れ: 質問1 → 質問2 → … → お名前 → VRChatのプロフィールURL → XのプロフィールURL → メールアドレス → 確認 → 送信
//  ・最後の4つ(答える人の情報)は、お申し込み画面と同じ質問・同じ確認(survey-config.js に、type が name / vrchat / x / email の質問があるとき)。必須。
//  ・選択の質問は、選んだ時点で次の画面に進む(「次へ」は出さない)。長文・短文の質問は、書いて「次へ」。
//  ・必須でない質問は、空のまま進める。
//  ・長文・短文の答えは、フォームへ送る前に、必ずエスケープする(制御文字・見えない文字を除く／HTMLの記号を文字参照に／先頭が = + - @ のときは ' を付ける)。
//    選択の答えは、フォームの選択肢と完全に同じ文字で送る(エスケープしない)。
(function () {
  const cfg = window.SURVEY_CONFIG || {};
  const root = document.getElementById("survey");
  if (!root) return;

  const questions = Array.isArray(cfg.questions) ? cfg.questions : [];
  const configured =
    typeof cfg.action === "string" && /^https?:\/\//.test(cfg.action) &&
    questions.length > 0 && questions.every((q) => q && /^entry\.\d+$/.test(q.entry || ""));

  const TOTAL = questions.length + 1;   // 質問 + 確認
  const answers = {};                   // { key: 答え }
  let step = 0;
  let sending = false;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  /* ---------- 答えのエスケープ(保存する前に、必ず通す) ---------- */
  const escapeText = (v) => {
    let s = String(v == null ? "" : v)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")   // 改行(\n \r)とタブは残す
      .trim()
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return s;
  };
  const hasText = (v) => escapeText(v) !== "";

  /* ---------- 答える人の情報(お申し込み画面と同じ。お名前・VRChat・X・メール) ---------- */
  // 入力された文字を、決まった形のURLにする。読めないときは、空の文字を返す(apply.js と同じ)。
  const normalizeVrchat = (v) => {
    const m = String(v).trim().match(/^(?:https?:\/\/)?(?:www\.)?vrchat\.com\/home\/user\/(usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?(?:[?#].*)?$/i);
    return m ? "https://vrchat.com/home/user/" + m[1].toLowerCase() : "";
  };
  const normalizeX = (v) => {
    const m = String(v).trim().match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/i);
    return m && !/^(home|i|explore|search|settings|messages|notifications|intent|share|compose)$/i.test(m[1]) ? "https://x.com/" + m[1] : "";
  };
  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  // type が name / vrchat / x / email の質問は、このサイトで、質問の文と確認を決める(フォームの質問の名前は、何でもよい)。
  // 答えが、アンケートに答えた人を、予約と結びつける手がかりになる。送る値: name=エスケープ、vrchat・x=整えたURL、email=そのまま。
  const PROFILE = {
    name: {
      label: "お名前", title: "お名前を教えてください", lead: "予約のときと同じ、VRChatでの表示名をご記入ください。",
      input: { placeholder: "お名前", autocomplete: "nickname" },
      check: (v) => (hasText(v) ? (v.length > 100 ? "100文字以内でご記入ください。" : "") : "お名前をご記入ください。"),
      send: (v) => escapeText(v), show: (v) => v,
    },
    vrchat: {
      label: "VRChatのプロフィール", title: "VRChatのプロフィールのURLを教えてください",
      lead: "VRChatのサイトで、ご自身のプロフィールページを開き、そのURLをご記入ください(例 https://vrchat.com/home/user/usr_…)。",
      input: { placeholder: "https://vrchat.com/home/user/usr_...", autocomplete: "off", inputmode: "url" },
      check: (v) => (normalizeVrchat(v) ? "" : "VRChatのプロフィールのURLをご確認ください(https://vrchat.com/home/user/usr_… の形です)。"),
      send: normalizeVrchat, show: normalizeVrchat,
    },
    x: {
      label: "Xのプロフィール", title: "XのプロフィールのURLを教えてください", lead: "ご自身のXのプロフィールのURLをご記入ください(例 https://x.com/アカウント名)。",
      input: { placeholder: "https://x.com/...", autocomplete: "off", inputmode: "url" },
      check: (v) => (normalizeX(v) ? "" : "XのプロフィールのURLをご確認ください(https://x.com/アカウント名 の形です)。"),
      send: normalizeX, show: normalizeX,
    },
    email: {
      label: "メールアドレス", title: "メールアドレスを教えてください", lead: "予約のときと同じメールアドレスをご記入ください。",
      input: { type: "email", placeholder: "example@mail.com", autocomplete: "email", inputmode: "email" },
      check: (v) => (emailOk(v) ? "" : "メールアドレスの形式をご確認ください。"),
      send: (v) => v, show: (v) => v,
    },
  };
  // 質問ごとの、送る値と、確認画面に出す値
  const sendValue = (q) => {
    const a = answers[q.key];
    if (PROFILE[q.type]) return PROFILE[q.type].send(a);
    return q.type === "choice" ? a : escapeText(a);
  };
  const showValue = (q) => {
    const a = answers[q.key];
    if (PROFILE[q.type]) return PROFILE[q.type].show(a);
    return a;
  };

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
    const wrap = el("div", "apply-step");
    const bar = el("div", "apply-progress");
    bar.setAttribute("aria-hidden", "true");
    const fill = el("span");
    fill.style.width = Math.round(((step + 1) / TOTAL) * 100) + "%";
    bar.appendChild(fill);
    wrap.appendChild(bar);
    wrap.appendChild(el("p", "apply-count", "STEP " + (step + 1) + " / " + TOTAL));

    const h = el("h2", "apply-q", title);
    h.tabIndex = -1;
    wrap.appendChild(h);
    if (lead) {
      const p = el("p", "apply-lead", lead);
      p.style.whiteSpace = "pre-line";
      wrap.appendChild(p);
    }
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
  const advance = () => go(Math.min(step + 1, TOTAL - 1));

  // 選ぶ画面(カード)。選んだ時点で、次の画面に進む
  function choiceStep(q) {
    const grid = el("div", "apply-choices k-survey");
    (q.options || []).forEach((opt) => {
      const b = el("button", "apply-choice");
      b.type = "button";
      const on = answers[q.key] === opt;
      b.setAttribute("aria-pressed", String(on));
      if (on) b.classList.add("on");
      b.appendChild(el("span", "name", opt));
      b.addEventListener("click", () => {
        answers[q.key] = opt;
        grid.querySelectorAll(".apply-choice").forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
        b.classList.add("on");
        b.setAttribute("aria-pressed", "true");
        setTimeout(advance, 160);
      });
      grid.appendChild(b);
    });
    return frame(q.title, q.lead, grid, { next: false }).wrap;
  }

  // 書く画面(長文は複数行の欄、短文は下線の入力欄)
  function textStep(q) {
    const long = q.type === "paragraph";
    const input = el(long ? "textarea" : "input", long ? "apply-textarea" : "apply-input");
    if (!long) input.type = "text";
    input.maxLength = long ? 2000 : 200;
    input.setAttribute("aria-label", q.title);
    input.setAttribute("data-autofocus", "");
    input.value = answers[q.key] || "";
    if (long) input.rows = 6;

    const done = (err) => {
      const v = input.value;
      if (q.required && !hasText(v)) { err.textContent = "ご記入ください。"; input.focus(); return; }
      answers[q.key] = hasText(v) ? v.trim() : "";
      advance();
    };
    const lead = (q.lead ? q.lead + "\n" : "") + (q.required ? "" : "(任意です。書かずに、次へ進めます。)");
    const { wrap, err } = frame(q.title, lead.trim(), input, { onNext: done });
    if (!long) input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); done(err); } });
    return wrap;
  }

  // 答える人の情報を書く画面(お申し込み画面と同じ。必須)
  function profileStep(q) {
    const p = PROFILE[q.type];
    const input = el("input", "apply-input");
    input.type = p.input.type || "text";
    input.placeholder = p.input.placeholder || "";
    input.autocomplete = p.input.autocomplete || "off";
    input.maxLength = 200;
    input.setAttribute("aria-label", p.title);
    input.setAttribute("data-autofocus", "");
    if (p.input.inputmode) input.inputMode = p.input.inputmode;
    input.value = answers[q.key] || "";

    const done = (err) => {
      const v = input.value.trim();
      const msg = p.check(v);
      if (msg) { err.textContent = msg; input.focus(); return; }
      answers[q.key] = v;
      advance();
    };
    const { wrap, err } = frame(p.title, p.lead, input, { onNext: done });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); done(err); } });
    return wrap;
  }

  // 確認画面
  function confirmStep() {
    const dl = el("dl", "apply-summary stack");   // 質問と答えが長いので、上下に並べる
    questions.forEach((q) => {
      const d = el("div");
      d.appendChild(el("dt", null, PROFILE[q.type] ? PROFILE[q.type].label : q.title));
      const dd = el("dd", null, showValue(q) ? showValue(q) : "(未回答)");
      dd.style.whiteSpace = "pre-wrap";
      d.appendChild(dd);
      dl.appendChild(d);
    });
    const body = el("div");
    body.appendChild(dl);
    // いたずら送信よけ(人には見えない欄。入っていたら、送らない)
    const trap = el("input", "apply-trap");
    trap.type = "text"; trap.name = "website"; trap.tabIndex = -1; trap.autocomplete = "off";
    trap.setAttribute("aria-hidden", "true");
    body.appendChild(trap);
    body.appendChild(el("p", "apply-fine", "いただいたご回答は、イベントの運営の参考にさせていただきます。"));

    const { wrap, err } = frame("この内容で、送信しますか？", "内容をご確認ください。", body, {
      nextLabel: "送信する",
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
    questions.forEach((q) => {
      const a = answers[q.key];
      if (a === undefined || a === "") return;                       // 未回答の質問は、送らない
      body.set(q.entry, sendValue(q));                               // 選択は、選択肢のまま。書いた答えは、エスケープして送る。お名前・URLは、整えて送る
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);   // 通信が止まったままにならないように
    try {
      // Googleフォームの回答の受け口へ送る。返事は(別のサイトなので)読めない。通信そのものが失敗したときだけ分かる。
      await fetch(cfg.action, { method: "POST", mode: "no-cors", body, signal: ctrl.signal });
      clearTimeout(timer);
      finish();
    } catch (e) {
      clearTimeout(timer);
      sending = false;
      btn.disabled = false;
      btn.textContent = "送信する";
      err.textContent = "送信できませんでした。通信の状態をご確認のうえ、もう一度お試しください。";
    }
  }

  function finish() {
    const wrap = el("div", "apply-step apply-done");
    wrap.appendChild(el("p", "apply-count", "THANK YOU"));
    const h = el("h2", "apply-q", "ご回答ありがとうございました");
    h.tabIndex = -1;
    wrap.appendChild(h);
    wrap.appendChild(el("p", "apply-lead", "いただいたご意見は、今後のイベントの参考にさせていただきます。"));
    const back = el("a", "btn btn-ghost", "トップへ戻る");
    back.href = "index.html";
    wrap.appendChild(back);
    show(wrap);
    h.focus({ preventScroll: true });
  }

  function render() {
    const q = questions[step];
    let node;
    if (!q) node = confirmStep();
    else if (q.type === "choice") node = choiceStep(q);
    else if (PROFILE[q.type]) node = profileStep(q);
    else node = textStep(q);
    show(node);
  }

  function start() {
    if (!configured) {
      root.textContent = "";
      root.appendChild(el("p", "apply-empty", "アンケートは、準備中です。準備ができ次第、こちらでご案内します。"));
      return;
    }
    // 最初の質問の上に、アンケートの説明(フォームの説明)を出す
    if (cfg.intro && questions[0] && !questions[0].lead) questions[0].lead = cfg.intro;
    render();
  }
  start();
})();
