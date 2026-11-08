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

// キャスト詳細。cast-detail.html?id=… の id に合うキャストを cast.json から探して表示する。
function renderCastDetail(list) {
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

  const link = document.getElementById("detail-link");
  if (c.link && isSafeUrl(c.link)) link.href = c.link;
  else link.remove();

  if (c.catch || c.profile || (c.link && isSafeUrl(c.link))) {
    document.getElementById("detail-main").hidden = false;
  } else {
    document.getElementById("cast-detail").remove();   // 何も出すものが無いときは、余白ごと消す
  }

  // 写真の欄は photos 列の写真。代表写真は上に出しているので、同じものは重ねて出さない。
  const photos = (Array.isArray(c.photos) ? c.photos : [])
    .filter((p, i, all) => p && isSafeUrl(p) && p !== c.image && all.indexOf(p) === i);
  if (photos.length > 0) {
    const grid = document.getElementById("photo-grid");
    photos.forEach((p) => grid.appendChild(buildPhoto(encodeURI(p), name, "thumb")));
    document.getElementById("detail-photos").hidden = false;
  }
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
  loadJson("data/cast.json")
    .then(renderCastDetail)
    .catch(() => {
      const s = document.getElementById("detail-status");
      if (s) s.textContent = "読み込めませんでした。時間をおいて、もう一度お試しください。";
    });
}
