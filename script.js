// 更新内容は data/*.json に書き出された静的ファイルを読むだけ(GASには問い合わせない)。
// 読み込みに失敗しても、HTML側の「調整中」「準備中」の表示がそのまま残る。

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
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = a.dataset.ready;
    a.removeAttribute("aria-disabled");
    ready[key] = true;
  });
  if (ready.entry && ready.survey) {
    document.querySelectorAll('[data-role="entry-pending"]').forEach((el) => el.remove());
  }
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
function renderCastDetail(list, schedule) {
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

  if (c.catch || c.profile || links.length > 0) {
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
  renderSchedule(schedule && schedule[castId(c, idx)]);
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const pad2 = (n) => String(n).padStart(2, "0");

// 出勤予定のカレンダー。日付のマスの中に、接客できる時間帯を書く。前の月・次の月へ切り替えられる。
function renderSchedule(days) {
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
      const times = Array.isArray(days[date]) ? days[date] : [];
      const cell = document.createElement("div");
      cell.className = "cal-day" + (times.length ? " has-entry" : "") + (date === today ? " today" : "") + (date < today ? " past" : "");
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
        li.textContent = month + "/" + d + "(" + wd + ") " + times.join("、");
        list.appendChild(li);
      }
    }
    box.appendChild(grid);
    if (list.children.length > 0) box.appendChild(list);   // スマホでは、マスの中の文字の代わりに、この一覧を出す
  };
  draw();
  section.hidden = false;
}

loadJson("data/next.json")
  .then((data) => {
    renderNext(data);
    renderLinks(data);
  })
  .catch(() => {});

if (document.getElementById("video-list")) {
  loadJson("data/videos.json").then(renderVideos).catch(() => {});
}

if (document.getElementById("cast-grid")) {
  loadJson("data/cast.json").then(renderCast).catch(() => {});
}

if (document.getElementById("detail-status")) {
  // 出勤予定が読めなくても、キャストの詳細は出す
  Promise.all([loadJson("data/cast.json"), loadJson("data/schedule.json").catch(() => ({}))])
    .then(([list, schedule]) => renderCastDetail(list, schedule))
    .catch(() => {
      const s = document.getElementById("detail-status");
      if (s) s.textContent = "読み込めませんでした。時間をおいて、もう一度お試しください。";
    });
}
