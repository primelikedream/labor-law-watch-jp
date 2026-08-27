const params = new URLSearchParams(location.search);
const periodDays = params.has("days") ? Number(params.get("days")) : null;

const SOURCE_CLASS = { egov_law_update: "law", nikkei_news: "nikkei", rosei_news: "rosei" };
const SOURCE_LABEL = { mhlw_news: "厚労省", egov_law_update: "法令改正", nikkei_news: "日経新聞", rosei_news: "労政時報" };
// 統合カードでどの記事を代表(主)表示にするかの優先順位(公式情報を優先)
const SOURCE_PRIORITY = { egov_law_update: 0, mhlw_news: 1, nikkei_news: 2, rosei_news: 3 };
const STAGES = ["審議会検討", "国会提出・審議", "成立・公布", "施行"];
const PRESETS = [
  { key: "7", days: 7, label: "直近7日" },
  { key: "30", days: 30, label: "直近30日" },
  { key: "90", days: 90, label: "直近90日" },
  { key: "all", days: null, label: "全期間" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const state = {
  items: [],
  sources: new Set(["mhlw_news", "egov_law_update", "nikkei_news", "rosei_news"]),
  query: "",
  guidelineOnly: false,
  dateFrom: periodDays ? isoDaysAgo(periodDays) : null,
  dateTo: null,
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

function renderStageTrack(stage) {
  if (!stage) return "";
  const idx = STAGES.indexOf(stage);
  const dots = STAGES.map((_, i) => `<span class="stage-dot ${i <= idx ? "filled" : ""}"></span>`).join("");
  return `
    <div class="stage-track" title="法制化の進捗(見出しからの推定です。正確性は保証しません)">
      <span class="stage-dots">${dots}</span>
      <span class="stage-label">${escapeHtml(stage)}</span>
    </div>`;
}

// storyIdが同じ項目(=同一の出来事を報じている項目)を1つの「ストーリー」にまとめる。
// 代表記事(primary)は公式情報を優先し、進捗段階はグループ内で最も進んだ段階を採用する。
function groupIntoStories(items) {
  const byStory = new Map();
  for (const item of items) {
    const key = item.storyId || item.id;
    if (!byStory.has(key)) byStory.set(key, []);
    byStory.get(key).push(item);
  }

  return [...byStory.values()].map((members) => {
    const sorted = [...members].sort(
      (a, b) => (SOURCE_PRIORITY[a.source] ?? 9) - (SOURCE_PRIORITY[b.source] ?? 9),
    );
    const primary = sorted[0];
    const related = sorted.slice(1);
    const bestStage = members
      .map((m) => m.stage)
      .filter(Boolean)
      .sort((a, b) => STAGES.indexOf(b) - STAGES.indexOf(a))[0];
    return {
      primary,
      related,
      dateKey: primary.publishedAt.slice(0, 10),
      stage: bestStage,
      isGuideline: members.some((m) => m.isGuideline),
    };
  });
}

function withinPeriod(item) {
  const d = item.publishedAt.slice(0, 10);
  if (state.dateFrom && d < state.dateFrom) return false;
  if (state.dateTo && d > state.dateTo) return false;
  return true;
}

function syncPeriodControls() {
  document.getElementById("dateFromInput").value = state.dateFrom ?? "";
  document.getElementById("dateToInput").value = state.dateTo ?? "";

  const activePreset = PRESETS.find((p) => {
    if (p.days === null) return !state.dateFrom && !state.dateTo;
    return state.dateFrom === isoDaysAgo(p.days) && !state.dateTo;
  });
  document.querySelectorAll(".pill[data-preset]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(activePreset?.key === btn.dataset.preset));
  });
}

let bannerDismissed = false;

function renderBanner(periodCount) {
  const banner = document.getElementById("periodBanner");
  if (!periodDays || bannerDismissed) {
    banner.hidden = true;
    return;
  }
  const label = periodDays <= 1 ? "日次ダイジェスト" : `直近${periodDays}日間`;
  banner.hidden = false;
  banner.innerHTML = `<span>${label}(${periodCount}件)を表示中</span><button type="button" id="periodBannerClear">すべての期間を見る →</button>`;
  document.getElementById("periodBannerClear").addEventListener("click", () => {
    bannerDismissed = true;
    state.dateFrom = null;
    state.dateTo = null;
    syncPeriodControls();
    render();
  });
}

function renderStats() {
  const items = state.items;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = items.filter((i) => new Date(i.publishedAt).getTime() >= weekAgo).length;
  const lawCount = items.filter((i) => i.source === "egov_law_update").length;
  const newsCount = items.filter((i) => i.source === "mhlw_news").length;
  const nikkeiCount = items.filter((i) => i.source === "nikkei_news").length;
  const roseiCount = items.filter((i) => i.source === "rosei_news").length;
  const guidelineCount = items.filter((i) => i.isGuideline).length;

  const stats = [
    { n: items.length, l: "総収集件数", cls: "" },
    { n: recent, l: "直近7日間", cls: "accent" },
    { n: lawCount, l: "法令改正", cls: "seal" },
    { n: newsCount, l: "厚労省 新着情報", cls: "" },
    { n: nikkeiCount, l: "日経新聞", cls: "nikkei" },
    { n: roseiCount, l: "労政時報", cls: "rosei" },
    { n: guidelineCount, l: "解説・ガイドライン", cls: "accent" },
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
    if (state.guidelineOnly && !item.isGuideline) return false;
    if (state.query) {
      const haystack = `${item.title} ${item.summary ?? ""}`.toLowerCase();
      if (!haystack.includes(state.query.toLowerCase())) return false;
    }
    return true;
  });

  const stories = groupIntoStories(filtered);

  document.getElementById("countLine").textContent = `${stories.length}件のトピックを表示中`;
  document.getElementById("emptyState").hidden = stories.length !== 0;

  const groups = new Map();
  for (const story of stories) {
    if (!groups.has(story.dateKey)) groups.set(story.dateKey, []);
    groups.get(story.dateKey).push(story);
  }
  const sortedDates = [...groups.keys()].sort((a, b) => b.localeCompare(a));

  const timeline = document.getElementById("timeline");
  timeline.innerHTML = sortedDates
    .map((dateKey) => {
      const { d, y } = fmtDateLabel(dateKey);
      const cards = groups
        .get(dateKey)
        .map((story) => {
          const item = story.primary;
          const cls = SOURCE_CLASS[item.source] ?? "";
          const time = new Date(item.publishedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
          const relatedRow = story.related.length
            ? `<div class="related-row">関連: ${story.related
                .map(
                  (r) =>
                    `<a class="chip ${SOURCE_CLASS[r.source] ?? ""}" href="${r.url}" target="_blank" rel="noopener">${SOURCE_LABEL[r.source] ?? r.category}</a>`,
                )
                .join("")}</div>`
            : "";
          return `
            <article class="item ${cls}">
              <div class="item-top">
                <span class="chip ${cls}">${escapeHtml(item.category)}</span>
                ${story.isGuideline ? '<span class="chip outline">解説・ガイドライン</span>' : ""}
                <span class="item-time">${time}</span>
              </div>
              <p class="item-title"><a href="${item.url}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a></p>
              <p class="item-summary">${escapeHtml(item.summary ?? "")}</p>
              ${renderStageTrack(story.stage)}
              ${relatedRow}
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

  document.getElementById("guidelineToggle").addEventListener("click", (e) => {
    state.guidelineOnly = !state.guidelineOnly;
    e.target.setAttribute("aria-pressed", String(state.guidelineOnly));
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

  document.querySelectorAll(".pill[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = PRESETS.find((p) => p.key === btn.dataset.preset);
      state.dateFrom = preset.days ? isoDaysAgo(preset.days) : null;
      state.dateTo = null;
      syncPeriodControls();
      render();
    });
  });

  document.getElementById("dateFromInput").addEventListener("change", (e) => {
    state.dateFrom = e.target.value || null;
    syncPeriodControls();
    render();
  });
  document.getElementById("dateToInput").addEventListener("change", (e) => {
    state.dateTo = e.target.value || null;
    syncPeriodControls();
    render();
  });
}

async function init() {
  setupControls();
  syncPeriodControls();
  try {
    await loadItems();
    renderStats();
    render();
  } catch (err) {
    document.getElementById("timeline").innerHTML = `<p class="empty">データの読み込みに失敗しました: ${err.message}</p>`;
  }
}

init();
