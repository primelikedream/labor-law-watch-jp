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

function render() {
  const filtered = state.items.filter((item) => {
    if (!state.sources.has(item.source)) return false;
    if (state.query) {
      const haystack = `${item.title} ${item.summary ?? ""}`.toLowerCase();
      if (!haystack.includes(state.query.toLowerCase())) return false;
    }
    return true;
  });

  document.getElementById("itemCount").textContent = `${filtered.length}件のトピック`;
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
    .map((date) => {
      const cards = groups
        .get(date)
        .map((item) => {
          const badgeClass = item.source === "egov_law_update" ? "item-badge law" : "item-badge";
          return `
            <div class="item-card">
              <span class="${badgeClass}">${escapeHtml(item.category)}</span>
              <p class="item-title"><a href="${item.url}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a></p>
              <p class="item-summary">${escapeHtml(item.summary ?? "")}</p>
            </div>`;
        })
        .join("");
      return `<section class="date-group"><h2 class="date-heading">${date}</h2>${cards}</section>`;
    })
    .join("");
}

function setupControls() {
  document.getElementById("searchBox").addEventListener("input", (e) => {
    state.query = e.target.value.trim();
    render();
  });

  document.querySelectorAll('#sourceFilter input[type="checkbox"]').forEach((box) => {
    box.addEventListener("change", () => {
      if (box.checked) state.sources.add(box.value);
      else state.sources.delete(box.value);
      render();
    });
  });
}

async function init() {
  setupControls();
  try {
    await loadItems();
    render();
  } catch (err) {
    document.getElementById("timeline").innerHTML = `<p class="empty-state">データの読み込みに失敗しました: ${err.message}</p>`;
  }
}

init();
