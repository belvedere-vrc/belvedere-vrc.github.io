// 更新内容は data/*.json に書き出された静的ファイルを読むだけ(GASには問い合わせない)。
// 読み込みに失敗しても、HTML側の「調整中」「準備中」の表示がそのまま残る。

// イベント名のロゴ画像。サイトのフォルダー(index.html と同じ場所)に置いたファイル名を書く(例 "logo.png" / "logo.svg")。
// 背景が透明な画像を想定。空のあいだと、画像が読み込めないときは、文字のロゴ(BELVEDERE)のまま。
// 使う場所: 各ページ上部のロゴ(ヘッダー)と、トップページの大見出しの上(index.html の data-logo の画像)。
const LOGO = "";
const LOGO_ALT = "Belvedere（仮）";

function applyLogo() {
  if (!LOGO) return;
  const probe = new Image();
  probe.onload = () => {
    document.querySelectorAll(".site-header .logo").forEach((a) => {
      const img = document.createElement("img");
      img.className = "logo-img";
      img.src = LOGO;
      img.alt = LOGO_ALT;
      a.textContent = "";
      a.appendChild(img);
    });
    document.querySelectorAll("img[data-logo]").forEach((img) => {
      img.src = LOGO;
      img.alt = LOGO_ALT;
      img.hidden = false;
    });
  };
  probe.src = LOGO;
}
applyLogo();

// トップページの背景(ワールドの写真など)。サイトのフォルダー(index.html と同じ場所)に置いた画像のファイル名を書く(例 "hero.jpg")。
// 空のあいだと、画像が読み込めないときは、今までの背景のまま。横長の写真(幅 1920px ほど、500KB 以下がおすすめ)。
// 写真の上に、暗い幕をかけて、文字を読みやすくする(下の方は、ページの色に溶けるようにしてある)。
const HERO_IMAGE = "";

function applyHero(src) {
  const hero = document.querySelector(".hero");
  if (!hero || !src) return;
  const probe = new Image();
  probe.onload = () => {
    hero.style.setProperty("--hero-image", 'url("' + src + '")');
    hero.classList.add("has-bg");
  };
  probe.src = src;
}
applyHero(HERO_IMAGE);

async function loadJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(path + ": " + res.status);
  return res.json();
}

function isSafeUrl(value) {
  try {
    const u = new URL(value, location.href);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch (e) {
    return false;
  }
}

// YouTube の URL(watch / youtu.be / embed / shorts)から動画IDを取り出す。
function youtubeId(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") id = u.pathname.slice(1);
    else if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
      else {
        const m = u.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/);
        if (m) id = m[1];
      }
    }
    return /^[\w-]{6,20}$/.test(id) ? id : "";
  } catch (e) {
    return "";
  }
}

function renderNext(data) {
  document.querySelectorAll("#next-list [data-key]").forEach((el) => {
    const v = data[el.dataset.key];
    if (v) el.textContent = v;
  });
  const note = document.getElementById("next-note");
  if (note && data.note) note.textContent = data.note;
  const updated = document.getElementById("next-updated");
  if (updated && data.updated) updated.textContent = "最終更新 " + data.updated;
}

// 申し込み・アンケートのリンク。URLが入ったものだけボタンを有効にする。
function renderLinks(data) {
  const urls = { entry: data.entryUrl, survey: data.surveyUrl };
  const ready = { entry: false, survey: false };
  document.querySelectorAll("[data-link]").forEach((a) => {
    const key = a.dataset.link;
    const url = urls[key];
    if (!url || !isSafeUrl(url)) return;
    a.href = url;
    // 別のサイトのURLは別タブで開く。サイト内のページ(apply.html など)は、そのまま開く。
    if (/^https?:\/\//i.test(url)) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    a.textContent = a.dataset.ready;
    a.removeAttribute("aria-disabled");
    ready[key] = true;
  });
  if (ready.entry && ready.survey) {
    document.querySelectorAll('[data-role="entry-pending"]').forEach((el) => el.remove());
  }

  // ヘッダーなどの「お申し込み」ボタンは、申し込みのURLが入ったら、申し込み欄を経由せず、直接そこへつなぐ。
  document.querySelectorAll("[data-entry-nav]").forEach((a) => {
    const url = urls.entry;
    if (!url || !isSafeUrl(url)) return;
    a.href = url;
    if (/^https?:\/\//i.test(url)) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  });
}

// 営業日の一覧 [{ date: "2026-12-05", type: "通常" | "時間外", start: "21:00"(あるときだけ) }](日付の古い順)。
// data/days.json(営業日時シート)を使う。無いときは、次回開催の日付(data/next.json の date)を「通常」の1日として使う。
function businessDays(days, next) {
  let list = (Array.isArray(days) ? days : [])
    .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.type !== "特別")   // 特別営業は、告知のみ(事前の予約は受け付けない)ので、予約の営業日には入れない
    .map((d) => {
      const day = { date: d.date, type: d.type === "時間外" ? "時間外" : "通常" };
      if (/^\d{1,2}:\d{2}$/.test(String(d.start || ""))) day.start = d.start;
      return day;
    });
  if (list.length === 0 && next && next.date) {
    const m = String(next.date).match(/(\d{4})\s*[年\/.-]\s*(\d{1,2})\s*[月\/.-]\s*(\d{1,2})/);
    if (m) list = [{ date: m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2), type: "通常" }];
  }
  // 同じ日付に、通常営業と時間外の両方があってもよい(通常営業が先)
  const rank = (d) => (d.type === "時間外" ? 1 : 0);
  return list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : rank(a) - rank(b)));
}

// 特別営業(告知のみ・事前の予約は受け付けない)の一覧。今日(日本時間)以降のものを、日付の古い順に。
// data/days.json の type が「特別」の行。start(開始時刻)と note(説明)は、あるときだけ出す。
function specialDays(days) {
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  return (Array.isArray(days) ? days : [])
    .filter((d) => d && d.type === "特別" && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// トップページの「特別営業のお知らせ」。特別営業がないときは、欄ごと出さない。
function renderSpecial(days) {
  const section = document.getElementById("special");
  const list = document.getElementById("special-list");
  if (!section || !list) return;
  const items = specialDays(days);
  if (items.length === 0) return;
  list.textContent = "";
  items.forEach((d) => {
    const [y, m, dd] = d.date.split("-").map(Number);
    const li = document.createElement("li");
    const date = document.createElement("strong");
    date.textContent = y + "年" + m + "月" + dd + "日(" + WEEKDAYS[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()] + ")" + (d.start ? " " + d.start + "〜" : "");
    li.appendChild(date);
    if (d.note) {
      const note = document.createElement("span");
      note.className = "special-note";
      note.textContent = d.note;
      li.appendChild(note);
    }
    list.appendChild(li);
  });
  section.hidden = false;
}

// 申し込み画面(サイト内の apply.html)へつなぐURL。params で、キャストや日付を最初から選んだ状態で開く。
// 申し込みのURLが別サイトのフォームなら、事前の選択はできないので、internalOnly のときは空を返す。
function entryHref(entryUrl, params, internalOnly) {
  if (!entryUrl || !isSafeUrl(entryUrl)) return "";
  if (/^https?:\/\//i.test(entryUrl)) return internalOnly ? "" : entryUrl;
  const q = new URLSearchParams();
  Object.keys(params || {}).forEach((k) => { if (params[k]) q.set(k, params[k]); });
  const s = q.toString();
  return entryUrl + (s ? (entryUrl.includes("?") ? "&" : "?") + s : "");
}

// 紹介動画は複数本。data/videos.json の [{ title, url }, ...] を上から順に並べる。
function renderVideos(list) {
  const box = document.getElementById("video-list");
  if (!box || !Array.isArray(list)) return;
  const items = list.filter((v) => v && v.url && isSafeUrl(v.url));
  if (items.length === 0) return;
  box.textContent = "";
  items.forEach((v) => {
    const item = document.createElement("div");
    item.className = "video-item";

    if (v.title) {
      const h = document.createElement("h3");
      h.textContent = v.title;
      item.appendChild(h);
    }

    item.appendChild(buildVideoFrame(v.url, v.title || "イベント紹介動画"));
    box.appendChild(item);
  });
}

// 動画1本分の枠。YouTubeは埋め込み、それ以外のURLはリンクボタンにする。
function buildVideoFrame(url, title) {
  const frame = document.createElement("div");
  frame.className = "video-frame";
  const id = youtubeId(url);
  if (id) {
    const iframe = document.createElement("iframe");
    iframe.src = "https://www.youtube-nocookie.com/embed/" + id;
    iframe.title = title;
    iframe.allow = "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen";
    iframe.allowFullscreen = true;
    iframe.loading = "lazy";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    frame.appendChild(iframe);
  } else {
    const a = document.createElement("a");
    a.className = "btn";
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "動画を見る";
    frame.classList.add("link-only");
    frame.appendChild(a);
  }
  return frame;
}

// キャストの識別子。シートの id 列が空のときは、並び順の番号("c1", "c2", …)。
// GAS側(publish.gs の readCast_)と同じ規則にしてある。
function castId(c, i) {
  return c.id || "c" + (i + 1);
}

// キャスト一覧。カード全体が詳細ページへのリンクになる。
function renderCast(list) {
  const grid = document.getElementById("cast-grid");
  if (!grid || !Array.isArray(list) || list.length === 0) return;
  grid.textContent = "";
  list.forEach((c, i) => {
    const card = document.createElement("a");
    card.className = "cast-card";
    card.href = "cast-detail.html?id=" + encodeURIComponent(castId(c, i));

    const photo = document.createElement("div");
    photo.className = "photo";
    if (c.image && isSafeUrl(c.image)) photo.style.backgroundImage = 'url("' + encodeURI(c.image) + '")';
    else photo.textContent = "NO IMAGE";
    card.appendChild(photo);

    const name = document.createElement("h3");
    name.textContent = c.name || "";
    card.appendChild(name);

    if (c.catch) {
      const p = document.createElement("p");
      p.textContent = c.catch;
      card.appendChild(p);
    }
    const more = document.createElement("span");
    more.className = "more";
    more.textContent = "View more";
    card.appendChild(more);
    grid.appendChild(card);
  });
}

// 写真を拡大して見せる(ダイアログ)。ダイアログに未対応のブラウザでは、画像を別タブで開く。
function openLightbox(src, alt) {
  let dlg = document.getElementById("lightbox");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "lightbox";
    const img = document.createElement("img");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "lightbox-close";
    close.textContent = "閉じる";
    close.addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });  // 外側をクリックしても閉じる
    dlg.append(img, close);
    document.body.appendChild(dlg);
  }
  if (typeof dlg.showModal !== "function") {
    window.open(src, "_blank", "noopener");
    return;
  }
  const img = dlg.querySelector("img");
  img.src = src;
  img.alt = alt || "";
  dlg.showModal();
}

function buildPhoto(src, alt, className) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.setAttribute("aria-label", (alt || "写真") + "を拡大する");
  const img = document.createElement("img");
  img.src = src;
  img.alt = alt || "";
  img.loading = "lazy";
  btn.appendChild(img);
  btn.addEventListener("click", () => openLightbox(src, alt));
  return btn;
}

// リンクボタンの文字。表示名が書かれていないときは、URLのサイト名から付ける。
const LINK_LABELS = {
  "x.com": "X", "twitter.com": "X", "instagram.com": "Instagram", "youtube.com": "YouTube", "youtu.be": "YouTube",
  "twitch.tv": "Twitch", "tiktok.com": "TikTok", "booth.pm": "BOOTH", "pixiv.net": "pixiv", "fanbox.cc": "FANBOX",
  "note.com": "note", "bsky.app": "Bluesky", "discord.gg": "Discord", "discord.com": "Discord", "vrchat.com": "VRChat",
};

function linkLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    for (const d in LINK_LABELS) {
      if (host === d || host.endsWith("." + d)) return LINK_LABELS[d];
    }
  } catch (e) {}
  return "リンク";
}

// キャスト詳細。cast-detail.html?id=… の id に合うキャストを cast.json から探して表示する。
function renderCastDetail(list, schedule, next, days) {
  const status = document.getElementById("detail-status");
  if (!status || !Array.isArray(list)) return;
  const id = new URLSearchParams(location.search).get("id");
  const idx = list.findIndex((c, i) => castId(c, i) === id);
  if (idx < 0) {
    status.textContent = "キャストが見つかりませんでした。一覧からお選びください。";
    return;
  }
  const c = list[idx];
  const name = c.name || "";

  document.getElementById("detail-name").textContent = name;
  document.title = name + " | " + document.title;
  status.remove();
  // ページの並び順は、名前 → 代表写真 → 動画(見出しなし) → 自己紹介文 → リンク → 写真
  if (c.image && isSafeUrl(c.image)) {
    document.getElementById("detail-hero-photo").appendChild(buildPhoto(encodeURI(c.image), name, "thumb hero-photo"));
    document.getElementById("detail-hero").hidden = false;
  }

  const videos = (Array.isArray(c.videos) ? c.videos : []).filter((v) => v && isSafeUrl(v));
  if (videos.length > 0) {
    const box = document.getElementById("detail-video-list");
    videos.forEach((v) => {
      const item = document.createElement("div");
      item.className = "video-item";
      item.appendChild(buildVideoFrame(v, name + "の動画"));
      box.appendChild(item);
    });
    document.getElementById("detail-videos").hidden = false;
  }

  const catchEl = document.getElementById("detail-catch");
  if (c.catch) catchEl.textContent = c.catch;
  else catchEl.remove();

  const profile = document.getElementById("detail-profile");
  if (c.profile) profile.textContent = c.profile;   // 改行はCSS(white-space: pre-line)でそのまま出す
  else profile.remove();

  // リンクは複数。links は [{label, url}]。古い形式(link に1つだけ)も読む。
  const links = (Array.isArray(c.links) ? c.links : c.link ? [{ label: "", url: c.link }] : [])
    .filter((l) => l && l.url && isSafeUrl(l.url));
  const linkBox = document.getElementById("detail-links");
  links.forEach((l) => {
    const a = document.createElement("a");
    a.className = "btn btn-small";
    a.href = l.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = l.label || linkLabel(l.url);
    linkBox.appendChild(a);
  });
  if (links.length === 0) linkBox.remove();

  // 申し込み(このキャストを指名して)。申し込みのURLが入っているときだけ出す。
  const cid = castId(c, idx);
  const entryUrl = next && next.entryUrl;
  const applyHref = entryHref(entryUrl, { cast: cid });
  if (applyHref) {
    const a = document.getElementById("detail-apply");
    a.href = applyHref;
    if (/^https?:\/\//i.test(applyHref)) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    document.getElementById("detail-apply-wrap").hidden = false;
  }

  if (c.catch || c.profile || links.length > 0 || applyHref) {
    document.getElementById("detail-main").hidden = false;
  } else {
    document.getElementById("cast-detail").remove();   // 何も出すものが無いときは、余白ごと消す
  }

  // 写真の欄は photos 列の写真。代表写真は上に出しているので、同じものは重ねて出さない。
  const photos = (Array.isArray(c.photos) ? c.photos : [])
    .filter((p, i, all) => p && isSafeUrl(p) && p !== c.image && all.indexOf(p) === i);
  if (photos.length > 0) {
    const grid = document.getElementById("photo-grid");
    photos.forEach((p) => {
      const item = buildPhoto(encodeURI(p), name, "thumb gallery-item");
      const img = item.querySelector("img");
      // 読み込めたら、写真の縦横比を入れる(切り取らずに並べるため)
      const fit = () => {
        if (img.naturalWidth && img.naturalHeight) item.style.setProperty("--r", String(img.naturalWidth / img.naturalHeight));
      };
      if (img.complete) fit();
      else img.addEventListener("load", fit);
      grid.appendChild(item);
    });
    document.getElementById("detail-photos").hidden = false;
  }

  // 出勤予定(カレンダー)。data/schedule.json は { キャストid: { "2026-12-05": ["21:00-23:00", …], … } }
  // 予定のある日を押すと、そのキャストと日付を選んだ状態で、申し込み画面を開く
  // (営業日でない日は、予定として見せるだけで、押せない)
  const bizDates = new Set(businessDays(days, next).map((d) => d.date));
  renderSchedule(schedule && schedule[cid], (date) => (bizDates.has(date) ? entryHref(entryUrl, { cast: cid, date }, true) : ""));
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// 時間帯を、開始時刻の早い順に並べる。時刻が読めないもの(「出勤」など)は最後。同じ開始時刻は、書いた順。
function sortTimes(times) {
  const start = (t) => {
    const m = String(t).match(/(\d{1,2})\s*[:：時]\s*(\d{2})?/);
    return m ? Number(m[1]) * 60 + Number(m[2] || 0) : Infinity;
  };
  return times
    .map((t, i) => ({ t, s: start(t), i }))
    .sort((a, b) => (a.s === b.s ? a.i - b.i : a.s < b.s ? -1 : 1))
    .map((x) => x.t);
}
const pad2 = (n) => String(n).padStart(2, "0");

// 出勤予定のカレンダー。日付のマスの中に、接客できる時間帯を書く。前の月・次の月へ切り替えられる。
function renderSchedule(days, hrefFor) {
  const section = document.getElementById("detail-schedule");
  const box = document.getElementById("calendar");
  if (!section || !box || !days || typeof days !== "object") return;

  const dates = Object.keys(days)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Array.isArray(days[d]) && days[d].length > 0)
    .sort();
  if (dates.length === 0) return;

  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);   // 日本時間の今日
  const curMonth = today.slice(0, 7);
  const lastMonth = dates[dates.length - 1].slice(0, 7);
  if (lastMonth < curMonth) return;   // 予定がすべて過去なら、欄ごと出さない

  // 今月から、予定のある最後の月まで(最大36か月)
  const months = [];
  let y = Number(curMonth.slice(0, 4));
  let m = Number(curMonth.slice(5, 7));
  while (months.length < 36) {
    const key = y + "-" + pad2(m);
    months.push(key);
    if (key >= lastMonth) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }

  // 最初は、予定のある最初の月(今月に無ければ、次の月以降)
  let idx = months.findIndex((k) => dates.some((d) => d.startsWith(k)));
  if (idx < 0) idx = 0;

  const draw = () => {
    const key = months[idx];
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(5, 7));
    box.textContent = "";

    const head = document.createElement("div");
    head.className = "cal-head";
    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "btn btn-small";
    prev.textContent = "‹ 前の月";
    prev.disabled = idx === 0;
    prev.addEventListener("click", () => { idx -= 1; draw(); });
    const title = document.createElement("span");
    title.className = "cal-title";
    title.textContent = year + "年" + month + "月";
    const next = document.createElement("button");
    next.type = "button";
    next.className = "btn btn-small";
    next.textContent = "次の月 ›";
    next.disabled = idx === months.length - 1;
    next.addEventListener("click", () => { idx += 1; draw(); });
    head.append(prev, title, next);
    box.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "cal-grid";
    WEEKDAYS.forEach((w, i) => {
      const th = document.createElement("div");
      th.className = "cal-week" + (i === 0 ? " sun" : i === 6 ? " sat" : "");
      th.textContent = w;
      grid.appendChild(th);
    });
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let i = 0; i < firstWeekday; i++) {
      const blank = document.createElement("div");
      blank.className = "cal-day blank";
      grid.appendChild(blank);
    }
    const list = document.createElement("ul");
    list.className = "cal-list";
    for (let d = 1; d <= lastDay; d++) {
      const date = key + "-" + pad2(d);
      const times = Array.isArray(days[date]) ? sortTimes(days[date]) : [];
      // 今日以降の予定のある日は、申し込み画面へのリンクにする(申し込みを受け付けているときだけ)
      const href = times.length && date >= today && hrefFor ? hrefFor(date) : "";
      const cell = document.createElement(href ? "a" : "div");
      if (href) {
        cell.href = href;
        cell.setAttribute("aria-label", month + "月" + d + "日で申し込む");
      }
      cell.className = "cal-day" + (times.length ? " has-entry" : "") + (href ? " link" : "") + (date === today ? " today" : "") + (date < today ? " past" : "");
      const num = document.createElement("span");
      num.className = "d";
      num.textContent = String(d);
      cell.appendChild(num);
      times.forEach((t) => {
        const span = document.createElement("span");
        span.className = "t";
        span.textContent = t;
        cell.appendChild(span);
      });
      grid.appendChild(cell);

      if (times.length && date >= today) {
        const li = document.createElement("li");
        const wd = WEEKDAYS[new Date(Date.UTC(year, month - 1, d)).getUTCDay()];
        const label = month + "/" + d + "(" + wd + ") " + times.join("、");
        if (href) {
          const a = document.createElement("a");
          a.href = href;
          a.textContent = label;
          li.appendChild(a);
        } else {
          li.textContent = label;
        }
        list.appendChild(li);
      }
    }
    box.appendChild(grid);
    if (list.children.length > 0) box.appendChild(list);   // スマホでは、マスの中の文字の代わりに、この一覧を出す
    if (box.querySelector(".cal-day.link")) {
      const hint = document.createElement("p");
      hint.className = "cal-hint";
      hint.textContent = "予定のある日を押すと、その日でお申し込みできます。";
      box.appendChild(hint);
    }
  };
  draw();
  section.hidden = false;
}

// 広告バナー。data/ads.json は [{ places: ["top"|"cast"|"apply", …], image, url, alt, from, to }]。
// ページにある枠(data-ad="場所")に、その場所の広告を、シートの上の行から順に入れる(1枠に1つ。広告が足りない枠は出さない)。
// 掲載期間(from〜to、日本時間の日付)を過ぎた広告は、サイトを更新しなくても出なくなる。
function renderAds(list) {
  if (!Array.isArray(list)) return;
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const live = list.filter((a) =>
    a && Array.isArray(a.places) && a.image && a.url && isSafeUrl(a.image) && isSafeUrl(a.url) &&
    (!a.from || a.from <= today) && (!a.to || today <= a.to));
  const used = {};
  document.querySelectorAll("[data-ad]").forEach((slot) => {
    const place = slot.dataset.ad;
    const n = used[place] || 0;
    used[place] = n + 1;
    const ad = live.filter((a) => a.places.includes(place))[n];
    if (!ad) return;

    const link = document.createElement("a");
    link.className = "ad";
    link.href = ad.url;
    if (/^https?:\/\//i.test(ad.url)) {
      link.target = "_blank";
      link.rel = "noopener noreferrer sponsored";
    }
    const img = document.createElement("img");
    img.src = encodeURI(ad.image);
    img.alt = ad.alt || "広告";
    img.loading = "lazy";
    const label = document.createElement("span");
    label.className = "ad-label";
    label.textContent = "PR";
    link.append(img, label);
    slot.textContent = "";
    slot.appendChild(link);
    slot.hidden = false;
  });
}

if (document.querySelector("[data-ad]")) {
  loadJson("data/ads.json").then(renderAds).catch(() => {});
}

loadJson("data/next.json")
  .then((data) => {
    renderNext(data);
    renderLinks(data);
  })
  .catch(() => {});

if (document.getElementById("special")) {
  loadJson("data/days.json").then(renderSpecial).catch(() => {});
}

if (document.getElementById("video-list")) {
  loadJson("data/videos.json").then(renderVideos).catch(() => {});
}

if (document.getElementById("cast-grid")) {
  loadJson("data/cast.json").then(renderCast).catch(() => {});
}

if (document.getElementById("detail-status")) {
  // 出勤予定が読めなくても、キャストの詳細は出す
  Promise.all([
    loadJson("data/cast.json"),
    loadJson("data/schedule.json").catch(() => ({})),
    loadJson("data/next.json").catch(() => ({})),
    loadJson("data/days.json").catch(() => []),
  ])
    .then(([list, schedule, next, days]) => renderCastDetail(list, schedule, next, days))
    .catch(() => {
      const s = document.getElementById("detail-status");
      if (s) s.textContent = "読み込めませんでした。時間をおいて、もう一度お試しください。";
    });
}
