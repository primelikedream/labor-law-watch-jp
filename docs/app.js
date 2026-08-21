const params = new URLSearchParams(location.search);
const periodDays = params.has("days") ? Number(params.get("days")) : null;

const state = {
  items: [],
  sources: new Set(["mhlw_news", "egov_law_update"]),
  query: "",
};

async function loadItems() {
  const res = await fetch("data/items.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`データ取得失敗: ${res.status}`);
  const data = await res.json();
  state.items = data.items ?? [];
  document.getElementById("updatedAt").textContent = data.updatedAt
    ? `最終更新: ${new Date(data.updatedAt).toLocaleString("ja-JP")}`
    : "";
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDateLabel(dateKey) {
  const [y, m, d] = dateKey.split("-");
  return { d: `${Number(m)}/${Number(d)}`, y };
}

function withinPeriod(item) {
  if (!periodDays) return true;
  const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  return new Date(item.publishedAt).getTime() >= cutoff;
}

function renderBanner(periodCount) {
  const banner = document.getElementById("periodBanner");
  if (!periodDays) {
    banner.hidden = true;
    return;
  }
  const label = periodDays <= 1 ? "日次ダイジェスト" : `直近${periodDays}日間`;
  banner.hidden = false;
  banner.innerHTML = `<span>${label}(${periodCount}件)を表示中</span><a href="./">すべてのトピックを見る →</a>`;
}

function renderStats() {
  const items = state.items;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = items.filter((i) => new Date(i.publishedAt).getTime() >= weekAgo).length;
  const lawCount = items.filter((i) => i.source === "egov_law_update").length;
  const newsCount = items.filter((i) => i.source === "mhlw_news").length;

  const stats = [
    { n: items.length, l: "総トピック数", cls: "" },
    { n: recent, l: "直近7日間", cls: "accent" },
    { n: lawCount, l: "法令改正", cls: "seal" },
    { n: newsCount, l: "厚労省 新着情報", cls: "" },
  ];
  document.getElementById("stats").innerHTML = stats
    .map((s) => `<div class="stat"><div class="n ${s.cls}">${s.n}</div><div class="l">${s.l}</div></div>`)
    .join("");
}

function render() {
  const periodItems = state.items.filter(withinPeriod);
  renderBanner(periodItems.length);

  const filtered = periodItems.filter((item) => {
    if (!state.sources.has(item.source)) return false;
    if (state.query) {
      const haystack = `${item.title} ${item.summary ?? ""}`.toLowerCase();
      if (!haystack.includes(state.query.toLowerCase())) return false;
    }
    return true;
  });

  document.getElementById("countLine").textContent = `${filtered.length}件のトピックを表示中`;
  document.getElementById("emptyState").hidden = filtered.length !== 0;

  const groups = new Map();
  for (const item of filtered) {
    const dateKey = item.publishedAt.slice(0, 10);
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey).push(item);
  }
  const sortedDates = [...groups.keys()].sort((a, b) => b.localeCompare(a));

  const timeline = document.getElementById("timeline");
  timeline.innerHTML = sortedDates
    .map((dateKey) => {
      const { d, y } = fmtDateLabel(dateKey);
      const cards = groups
        .get(dateKey)
        .map((item) => {
          const isLaw = item.source === "egov_law_update";
          const time = new Date(item.publishedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
          return `
            <article class="item ${isLaw ? "law" : ""}">
              <div class="item-top">
                <span class="chip ${isLaw ? "law" : ""}">${escapeHtml(item.category)}</span>
                <span class="item-time">${time}</span>
              </div>
              <p class="item-title"><a href="${item.url}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a></p>
              <p class="item-summary">${escapeHtml(item.summary ?? "")}</p>
            </article>`;
        })
        .join("");
      return `
        <div class="date-group">
          <div class="date-label"><span class="d">${d}</span><span class="y">${y}</span></div>
          <div class="items">${cards}</div>
        </div>`;
    })
    .join("");
}

function setupControls() {
  document.getElementById("searchBox").addEventListener("input", (e) => {
    state.query = e.target.value.trim();
    render();
  });

  document.querySelectorAll(".pill[data-source]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const src = btn.dataset.source;
      const pressed = btn.getAttribute("aria-pressed") === "true";
      if (pressed) {
        if (state.sources.size === 1) return;
        state.sources.delete(src);
      } else {
        state.sources.add(src);
      }
      btn.setAttribute("aria-pressed", String(!pressed));
      render();
    });
  });
}

async function init() {
  setupControls();
  try {
    await loadItems();
    renderStats();
    render();
  } catch (err) {
    document.getElementById("timeline").innerHTML = `<p class="empty">データの読み込みに失敗しました: ${err.message}</p>`;
  }
}

init();
