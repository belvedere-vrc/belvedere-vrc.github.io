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

    const frame = document.createElement("div");
    frame.className = "video-frame";
    const id = youtubeId(v.url);
    if (id) {
      const iframe = document.createElement("iframe");
      iframe.src = "https://www.youtube-nocookie.com/embed/" + id;
      iframe.title = v.title || "イベント紹介動画";
      iframe.allow = "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen";
      iframe.allowFullscreen = true;
      iframe.loading = "lazy";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      frame.appendChild(iframe);
    } else {
      // YouTube以外のURLは埋め込まず、リンクで開く。
      const a = document.createElement("a");
      a.className = "btn";
      a.href = v.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "動画を見る";
      frame.classList.add("link-only");
      frame.appendChild(a);
    }
    item.appendChild(frame);
    box.appendChild(item);
  });
}

function renderCast(list) {
  const grid = document.getElementById("cast-grid");
  if (!grid || !Array.isArray(list) || list.length === 0) return;
  grid.textContent = "";
  list.forEach((c) => {
    const card = document.createElement("article");
    card.className = "cast-card";

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
    if (c.link && isSafeUrl(c.link)) {
      const a = document.createElement("a");
      a.href = c.link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "SNS";
      card.appendChild(a);
    }
    grid.appendChild(card);
  });
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
