/*
 * dashboard-funcional.js
 * Inicializa o shell compartilhado (sessão, sidebar, topbar, logout) e
 * transforma a Dashboard em um painel executivo real: indicadores,
 * atualizações recentes e gráficos são todos calculados a partir dos
 * mesmos itensPortal já carregados pela sessão (nenhuma chamada nova ao
 * SharePoint, nenhum valor fictício).
 *
 * Reaproveita os helpers expostos por assets/content-funcional.js em
 * window.PortalContent (value, isActive, card, etc.) em vez de duplicar
 * as mesmas regras de leitura de campo.
 */
(function () {
  "use strict";

  function animateCount(el) {
    var target = parseInt(el.getAttribute("data-count"), 10);
    if (isNaN(target)) return;
    var duration = 820;
    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      var value = Math.round(target * eased);
      el.textContent = el.getAttribute("data-pad") === "true" ? String(value).padStart(2, "0") : String(value);
      if (progress < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }

  function revealCascade(selector, baseDelay) {
    var items = document.querySelectorAll(selector);
    var delay = typeof baseDelay === "number" ? baseDelay : 40;
    items.forEach(function (el, index) {
      el.style.animationDelay = (index * delay) + "ms";
      el.classList.add("fade-up");
    });
  }

  function enhanceFocusList() {
    document.querySelectorAll(".focus-list li").forEach(function (li) {
      var checkbox = li.querySelector('input[type="checkbox"]');
      if (!checkbox) return;
      li.addEventListener("click", function (e) {
        if (e.target === checkbox) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      });
      checkbox.addEventListener("change", function () {
        li.style.opacity = checkbox.checked ? "0.55" : "1";
        li.style.textDecoration = checkbox.checked ? "line-through" : "none";
      });
    });
  }

  function setMetric(idStrong, idSub, count, subText) {
    var strong = document.getElementById(idStrong);
    var sub = document.getElementById(idSub);
    if (strong) strong.setAttribute("data-count", String(count));
    if (sub) sub.textContent = subText;
  }

  /* Tenta localizar uma data utilizável do item (Created/Modified vindos do
     SharePoint, ou colunas de negócio equivalentes). Retorna null se nenhuma
     existir — nesse caso a Dashboard não inventa números de "recência". */
  function itemDate(PC, item) {
    var raw = PC.value(item, [
      "Modified", "modified", "Created", "created",
      "DataPublicacao", "DataPublicação", "dataPublicacao",
      "DataCriacao", "DataCriação", "dataCriacao"
    ]);
    if (!raw) return null;
    var d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  function createdDate(PC, item) {
    var raw = PC.value(item, [
      "Created", "created", "DataCriacao", "DataCriação", "dataCriacao",
      "DataPublicacao", "DataPublicação", "dataPublicacao"
    ]);
    if (!raw) return null;
    var d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDate(d) {
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  /* ---------- Indicadores executivos (volume, recência, atualização e diversidade) ---------- */
  function renderIndicators(PC, items) {
    var total = items.length;

    var categoriesSeen = {}, themesSeen = {}, mediaSeen = {};
    var recent30 = 0, stale90 = 0;
    var anyCreatedDate = false, anyUpdatedDate = false;
    var cutoff30 = new Date();
    var cutoff90 = new Date();
    cutoff30.setDate(cutoff30.getDate() - 30);
    cutoff90.setDate(cutoff90.getDate() - 90);

    items.forEach(function (item) {
      var cat = PC.value(item, ["Categoria", "categoria", "CategoriaPortal", "Categoria do Portal"]) || "Conteúdos";
      var theme = PC.value(item, ["Tema", "tema", "TemaPortal", "Tema do Portal"]) || "Geral";
      categoriesSeen[PC.key(cat)] = true;
      themesSeen[PC.key(theme)] = true;

      var type = PC.mediaType(item);
      mediaSeen[PC.key(type || "outro")] = true;

      var created = createdDate(PC, item);
      if (created) {
        anyCreatedDate = true;
        if (created >= cutoff30) recent30++;
      }

      var updated = itemDate(PC, item);
      if (updated) {
        anyUpdatedDate = true;
        if (updated < cutoff90) stale90++;
      }
    });

    var categoryCount = Object.keys(categoriesSeen).length;
    var themeCount = Object.keys(themesSeen).length;
    var mediaCount = Object.keys(mediaSeen).length;

    setMetric("metric-total", "metric-total-sub", total, categoryCount + (categoryCount === 1 ? " categoria" : " categorias"));
    if (anyCreatedDate) {
      setMetric("metric-recent", "metric-recent-sub", recent30, "Últimos 30 dias");
    } else {
      setMetric("metric-recent", "metric-recent-sub", 0, "Sem dados de criação");
    }

    if (anyUpdatedDate) {
      setMetric("metric-stale", "metric-stale-sub", stale90, "Requerem revisão");
    } else {
      setMetric("metric-stale", "metric-stale-sub", 0, "Sem dados de atualização");
    }

    document.getElementById("metric-categories").setAttribute("data-count", String(categoryCount));
    document.getElementById("metric-themes").setAttribute("data-count", String(themeCount));
    document.getElementById("metric-media-types").setAttribute("data-count", String(mediaCount));

    document.querySelectorAll(".metrics strong[data-count]").forEach(animateCount);
  }

  /* ---------- Última atualização (resumo executivo) ---------- */
  function renderLastUpdate(PC, items) {
    var pill = document.getElementById("dashboard-last-update");
    if (!pill) return;
    var latest = null;
    items.forEach(function (item) {
      var d = itemDate(PC, item);
      if (d && (!latest || d > latest)) latest = d;
    });
    if (latest) {
      pill.textContent = "Última atualização: " + formatDate(latest);
      pill.hidden = false;
    }
  }

  /* ---------- Atualizações recentes: reaproveita o componente .media-card ---------- */
  function renderRecent(PC, items) {
    var grid = document.getElementById("dashboard-recent-grid");
    var emptyMsg = document.getElementById("dashboard-recent-empty");
    if (!grid) return;

    var withDate = items
      .map(function (item) { return { item: item, date: itemDate(PC, item) }; })
      .filter(function (entry) { return entry.date; })
      .sort(function (a, b) { return b.date - a.date; });

    var chosen = (withDate.length ? withDate.map(function (e) { return e.item; }) : items).slice(0, 6);
    if (chosen.length < 3 && items.length >= 3) chosen = items.slice(0, 3);

    if (!chosen.length) {
      if (emptyMsg) emptyMsg.hidden = false;
      return;
    }

    grid.innerHTML = chosen.map(function (item) {
      var category = PC.value(item, ["Categoria", "categoria", "CategoriaPortal", "Categoria do Portal"]) || "Conteúdos";
      var theme = PC.value(item, ["Tema", "tema", "TemaPortal", "Tema do Portal"]) || "Geral";
      return PC.card(item, category, theme, PC.key(category), PC.key(theme));
    }).join("");

    PC.initModalTriggers(grid);
    revealCascade("#dashboard-recent-grid .media-card", 60);
  }

  /* ---------- Gráfico "Conteúdos por categoria": barras empilhadas por tema ---------- */
  var BAR_COLORS = ["#2f6fed", "#7c5cff", "#17d1c4", "#ff9a3c", "#4be3a0", "#f28fb0", "#8ab0f5", "#e8b34b"];

  function renderCategoryChart(PC, items) {
    var chart = document.getElementById("dashboard-category-chart");
    var legend = document.getElementById("dashboard-category-legend");
    if (!chart) return;

    var counts = {}, labels = {}, order = [];
    var themes = {}, themeLabels = {}, themeOrder = [];
    items.forEach(function (item) {
      var label = PC.value(item, ["Categoria", "categoria", "CategoriaPortal", "Categoria do Portal"]) || "Conteúdos";
      var themeLabel = PC.value(item, ["Tema", "tema", "TemaPortal", "Tema do Portal"]) || "Geral";
      var k = PC.key(label);
      var themeKey = PC.key(themeLabel);
      if (!counts[k]) { counts[k] = 0; labels[k] = label; order.push(k); }
      counts[k]++;
      if (!themeLabels[themeKey]) { themeLabels[themeKey] = themeLabel; themeOrder.push(themeKey); }
      if (!themes[k]) themes[k] = {};
      themes[k][themeKey] = (themes[k][themeKey] || 0) + 1;
    });

    if (!order.length) return;
    order.sort(function (a, b) { return counts[b] - counts[a]; });
    var top = order.slice(0, 7);
    var max = top.reduce(function (m, k) { return Math.max(m, counts[k]); }, 1);

    chart.innerHTML = top.map(function (k) {
      var pct = Math.max(8, Math.round((counts[k] / max) * 100));
      var presentThemes = themeOrder.filter(function (themeKey) { return themes[k][themeKey]; });
      var segments = presentThemes.map(function (themeKey, segmentIndex) {
        var value = themes[k][themeKey];
        var height = (value / counts[k]) * 100;
        var colorIndex = themeOrder.indexOf(themeKey);
        var radius = segmentIndex === presentThemes.length - 1 ? "border-radius:6px 6px 0 0;" : "";
        var title = PC.escapeHTML(labels[k] + " — " + themeLabels[themeKey] + ": " + value);
        return '<i class="stack-segment" title="' + title + '" style="height:' + height + '%;background:' + BAR_COLORS[colorIndex % BAR_COLORS.length] + ';' + radius + '"></i>';
      }).join("");
      return '<div class="bar-col"><div class="bar bar-stacked" style="height:' + pct + '%" title="' + PC.escapeHTML(labels[k] + ": " + counts[k]) + '">' + segments + '</div><span>' + PC.escapeHTML(labels[k]) + '</span></div>';
    }).join("");

    if (legend) {
      legend.innerHTML = themeOrder.map(function (themeKey, index) {
        return '<span><i style="background:' + BAR_COLORS[index % BAR_COLORS.length] + '"></i>' + PC.escapeHTML(themeLabels[themeKey]) + '</span>';
      }).join("");
    }
  }

  function initExecutiveDashboard(data) {
    var PC = window.PortalContent;
    if (!PC) return; /* segurança: se o helper não carregou, mantém a estrutura sem quebrar */

    var source = Array.isArray(data.itensPortal) ? data.itensPortal : [];
    var items = source.filter(PC.isActive);

    renderIndicators(PC, items);
    renderLastUpdate(PC, items);
    renderRecent(PC, items);
    renderCategoryChart(PC, items);
  }

  function initDashboardExtras(data) {
    initExecutiveDashboard(data);
    revealCascade(".metrics article", 55);
    revealCascade(".module-card", 70);
  }

  window.PortalShell.init({ onReady: initDashboardExtras });
})();
