/*
 * Conteúdo dinâmico do Portal
 *
 * Contrato oficial do Power Automate:
 *   itensPortal[] -> Vertente -> Categoria -> Tema -> card
 *
 * A página (GR, GL ou Sinistros) é definida pela Vertente. Categoria e Tema
 * não criam novas páginas: são seções e subtítulos dentro da página atual.
 */
(function () {
  "use strict";

  var PAGE = {
    "dashboard.html": "DASHBOARD",
    "gr.html": "GR",
    "gl.html": "GL",
    "sinistros.html": "SINISTROS"
  };

  var ICONS = {
    powerbi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M14 2v6h6"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5-6-3.5Z" fill="currentColor" stroke="none"/></svg>',
    infografico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>',
    default: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M14 2v6h6"/></svg>'
  };

  function text(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return text(value.Value || value.value || value.Valor || value.valor || value.Title || value.title || "");
    return String(value).trim();
  }

  function value(item, names) {
    for (var i = 0; i < names.length; i++) {
      if (item[names[i]] !== undefined) return text(item[names[i]]);
    }
    return "";
  }

  /* Campos Choice do SharePoint podem vir como { Value: "Ativo" }.
     Esta função transforma todas as variações em um booleano previsível. */
  function isActive(item) {
    var raw = value(item, ["Ativo", "ativo", "Status", "status", "Publicar", "publicar"]);
    if (!raw) return true;
    var normalized = key(raw);
    return ["true", "sim", "ativo", "publicado", "publicar", "yes", "1"].indexOf(normalized) !== -1;
  }

  function key(value) {
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "geral";
  }

  function escapeHTML(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function pageVertente() {
    var file = (window.location.pathname.split("/").pop() || "").toLowerCase();
    return PAGE[file] || "";
  }

  function matchesVertente(itemVertente, current) {
    if (current === "DASHBOARD") return true;
    var item = key(itemVertente).toUpperCase();
    if (item === "AMBOS") return current === "GR" || current === "GL";
    if (current === "SINISTROS") return item === "SINISTROS" || item === "SINISTRO";
    return item === current;
  }

  function mediaType(item) {
    var raw = value(item, ["TipoMídia", "TipoMidia", "Tipo de Mídia", "Tipo de Midia", "tipoMidia", "tipo_midia", "Midia", "Mídia"]).toLowerCase();
    var link = fileUrl(item);
    /* A extensão da URL do arquivo também é considerada. Assim, um PDF não
       volta a baixar diretamente caso o campo TipoMidia esteja vazio ou
       preenchido com um rótulo genérico. */
    if (isPdfUrl(link)) return "pdf";
    if (raw.indexOf("power") !== -1) return "powerbi";
    if (raw.indexOf("pdf") !== -1 || raw.indexOf("document") !== -1) return "pdf";
    if (raw.indexOf("video") !== -1 || raw.indexOf("vídeo") !== -1) return "video";
    if (raw.indexOf("infograf") !== -1) return "infografico";
    return raw || "default";
  }

  /* URL oficial do conteúdo. A thumbnail é lida separadamente e serve apenas
     como capa do card; nunca é usada para abrir o documento. */
  function fileUrl(item) {
    return value(item, [
      "UrlLink", "URLLink", "urlLink",
      "URL do arquivo", "UrlArquivo", "URLArquivo", "urlArquivo", "fileUrl", "FileUrl",
      "URL", "Url", "url", "Link"
    ]);
  }

  function isPdfUrl(rawUrl) {
    if (!rawUrl) return false;
    if (/^https:\/\/docs\.google\.com\/viewer\?/i.test(rawUrl)) return true;
    try {
      return /\.pdf$/i.test(new URL(rawUrl, window.location.href).pathname);
    } catch (_) {
      return /\.pdf(?:$|[?#])/i.test(String(rawUrl));
    }
  }

  function pdfViewerUrl(rawUrl) {
    if (!rawUrl) return "";
    if (/^https:\/\/docs\.google\.com\/viewer\?/i.test(rawUrl)) return rawUrl;
    return "https://docs.google.com/viewer?url=" + encodeURIComponent(rawUrl) + "&embedded=true";
  }

  function actionLabel(type) {
    if (type === "video") return "Assistir Vídeo";
    if (type === "powerbi") return "Abrir Dashboard";
    if (type === "pdf") return "Visualizar PDF";
    if (type === "infografico") return "Ver Infográfico";
    return "Abrir Link";
  }

  /* Tenta converter links de vídeo (YouTube/Vimeo) para o formato de embed.
     Power BI e outros links já costumam vir prontos para iframe. */
  function embedUrl(rawUrl, type) {
    if (!rawUrl) return "";
    if (type === "pdf" || isPdfUrl(rawUrl)) return pdfViewerUrl(rawUrl);
    if (type === "video") {
      var yt = rawUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
      if (yt) return "https://www.youtube.com/embed/" + yt[1];
      var vimeo = rawUrl.match(/vimeo\.com\/(?:video\/)?(\d+)/);
      if (vimeo) return "https://player.vimeo.com/video/" + vimeo[1];
    }
    return rawUrl;
  }

  var MEDIA_COLORS = { powerbi: "#6fc4ef", pdf: "#f2b56b", video: "#f28fb0", infografico: "#b79cf2", default: "#9fe3c8" };
  var MEDIA_LABELS = { powerbi: "Power BI", pdf: "PDF", video: "Vídeo", infografico: "Infográfico", default: "Outros" };

  /* Mini dashboard executivo no Banner Hero (GR / GL): recalcula o total
     visível, a distribuição por tipo de mídia (donut via conic-gradient) e o
     volume relativo por categoria (mini barras), sempre a partir dos cards
     que sobreviveram ao filtro atual — sem duplicar a lógica de filtragem. */
  function atualizarDashboardBanner(root) {
    var statsContainer = document.getElementById("hero-stats-container");
    if (!statsContainer) return; /* página sem mini dashboard (ex.: Sinistros) */

    var allCards = root.querySelectorAll(".media-card");
    var totalGeral = allCards.length;
    if (totalGeral === 0) { statsContainer.hidden = true; return; }
    statsContainer.hidden = false;

    var visibleCards = root.querySelectorAll(".media-card:not(.is-hidden)");
    var totalVisivel = visibleCards.length;

    var kpiTotal = document.getElementById("stat-total-count");
    var kpiBadge = document.getElementById("stat-filter-ratio");
    if (kpiTotal) kpiTotal.textContent = totalVisivel;
    if (kpiBadge) {
      if (totalVisivel === totalGeral) {
        kpiBadge.textContent = "100% visíveis";
        kpiBadge.classList.remove("is-filtered");
      } else {
        kpiBadge.textContent = "Exibindo " + totalVisivel + " de " + totalGeral;
        kpiBadge.classList.add("is-filtered");
      }
    }

    var mediaCounts = {}, mediaOrder = [];
    visibleCards.forEach(function (cardEl) {
      var type = cardEl.getAttribute("data-type") || "default";
      if (!mediaCounts[type]) { mediaCounts[type] = 0; mediaOrder.push(type); }
      mediaCounts[type]++;
    });

    var donut = document.getElementById("donut-chart-container");
    var legend = document.getElementById("media-legend-container");
    if (legend) legend.innerHTML = "";
    if (donut) {
      if (totalVisivel === 0) {
        donut.style.setProperty("--donut-bg", "conic-gradient(rgba(255,255,255,.15) 0 100%)");
        donut.innerHTML = '<span class="donut-chart-total">0</span>';
      } else {
        var gradientParts = [], acc = 0;
        mediaOrder.forEach(function (type) {
          var qty = mediaCounts[type];
          var pct = (qty / totalVisivel) * 100;
          var color = MEDIA_COLORS[type] || MEDIA_COLORS.default;
          var start = acc, end = acc + pct;
          gradientParts.push(color + " " + start.toFixed(2) + "% " + end.toFixed(2) + "%");
          acc = end;
          if (legend) {
            var li = document.createElement("li");
            li.innerHTML = '<span class="hero-legend-dot" style="background:' + color + '"></span>' +
              escapeHTML((MEDIA_LABELS[type] || MEDIA_LABELS.default) + " · " + qty);
            legend.appendChild(li);
          }
        });
        donut.style.setProperty("--donut-bg", "conic-gradient(" + gradientParts.join(", ") + ")");
        donut.innerHTML = '<span class="donut-chart-total">' + totalVisivel + '</span>';
      }
    }

    var catCounts = {}, catLabels = {}, catOrder = [];
    visibleCards.forEach(function (cardEl) {
      var catKey = cardEl.getAttribute("data-category") || "geral";
      if (!catCounts[catKey]) {
        catCounts[catKey] = 0;
        catOrder.push(catKey);
        var section = cardEl.closest(".content-section");
        var heading = section && section.querySelector(".content-section-head h2");
        catLabels[catKey] = heading ? heading.textContent : catKey;
      }
      catCounts[catKey]++;
    });

    var barsList = document.getElementById("category-bars-container");
    if (barsList) {
      barsList.innerHTML = "";
      var maxCount = catOrder.reduce(function (max, k) { return Math.max(max, catCounts[k]); }, 1);
      catOrder.slice(0, 4).forEach(function (catKey) {
        var qty = catCounts[catKey];
        var pct = Math.max(6, (qty / maxCount) * 100); /* piso visual mínimo para barras não sumirem */
        var li = document.createElement("li");
        li.innerHTML = '<div class="hero-bar-label"><span>' + escapeHTML(catLabels[catKey]) + '</span><span>' + qty + '</span></div>' +
          '<div class="hero-bar-track"><div class="hero-bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>';
        barsList.appendChild(li);
      });
    }
  }

  var EXPAND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  function mediaLabel(item, type) {
    return value(item, ["TipoMídia", "TipoMidia", "Tipo de Mídia", "Tipo de Midia", "Midia", "Mídia"]) || type;
  }

  var CALENDAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';

  function formatModified(item) {
    var raw = value(item, ["Modified", "modified", "Created", "created", "DataModificacao", "DataModificação", "dataModificacao", "DataCriacao", "DataCriação", "dataCriacao"]);
    if (!raw) return "";
    var d = new Date(raw);
    if (isNaN(d.getTime())) return "";
    var dataStr = d.toLocaleDateString("pt-BR");
    var horaStr = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return "Modificado em " + dataStr + " às " + horaStr;
  }

  function card(item, category, theme, categoryKey, themeKey) {
    var type = mediaType(item);
    var title = value(item, ["Title", "Título", "titulo"]) || "Conteúdo sem título";
    var description = value(item, ["Descricao", "Descrição", "descricao", "Description"]) || "Conteúdo disponibilizado para consulta no portal.";
    var link = fileUrl(item);
    var label = mediaLabel(item, type);
    var thumbUrl = value(item, ["Link_thumbnail", "LinkThumbnail", "Link Thumbnail", "linkThumbnail", "link_thumbnail", "Thumbnail", "thumbnail"]);
    var canEmbed = !!link && (type === "powerbi" || type === "video" || type === "pdf");
    var embed = canEmbed ? embedUrl(link, type) : "";
    /* Para PDF, tanto o iframe quanto "Abrir em nova aba" recebem o Viewer.
       A URL original continua dentro do parâmetro url do visualizador. */
    var openUrl = type === "pdf" ? (embed || pdfViewerUrl(link)) : link;
    var modifiedLabel = formatModified(item);
    var modifiedHTML = modifiedLabel
      ? '<span class="media-card-date">' + CALENDAR_ICON + escapeHTML(modifiedLabel) + '</span>'
      : '<span></span>';

    var thumbHTML;
    if (thumbUrl) {
      /* Capa dinâmica vinda da coluna Link_thumbnail do SharePoint — imagem
         estática, leve e rápida; a mídia ao vivo só carrega dentro do modal. */
      thumbHTML =
        '<div class="media-thumb media-thumb--image has-image media-thumb-action" data-type="' + escapeHTML(type) + '" role="button" tabindex="0" aria-label="' + escapeHTML(actionLabel(type) + ': ' + title) + '" data-modal-type="' + escapeHTML(type) +
        '" data-modal-src="' + escapeHTML(embed || openUrl) + '" data-modal-fallback="' + escapeHTML(openUrl) + '" data-modal-title="' + escapeHTML(title) + '">' +
          '<img src="' + escapeHTML(thumbUrl) + '" alt="' + escapeHTML(title) + '" class="card-thumb-img" loading="lazy" />' +
          '<span class="media-type-tag">' + escapeHTML(label) + '</span>' +
        '</div>';
    } else {
      /* Fallback: sem thumbnail cadastrada, mantém o gradiente elegante com
         o ícone padrão do tipo de mídia. */
      thumbHTML =
        '<div class="media-thumb media-thumb--cover" data-cover-type="' + escapeHTML(type) + '">' +
          '<span class="media-thumb-icon">' + (ICONS[type] || ICONS.default) + '</span>' +
          '<span class="media-type-tag">' + escapeHTML(label) + '</span>' +
        '</div>';
    }

    var actionHTML = link
      ? '<button type="button" class="media-card-open" data-modal-type="' + escapeHTML(type) +
        '" data-modal-src="' + escapeHTML(embed || openUrl) + '" data-modal-fallback="' + escapeHTML(openUrl) +
        '" data-modal-title="' + escapeHTML(title) + '">' + actionLabel(type) + ' ' + EXPAND_ICON + '</button>'
      : '<span class="media-card-open is-disabled">Indisponível</span>';

    return '<article class="media-card is-ready fade-up" data-type="' + escapeHTML(type) + '" data-category="' + escapeHTML(categoryKey) + '" data-theme="' + escapeHTML(themeKey) + '" data-title="' + escapeHTML(title.toLowerCase()) + '">' +
      thumbHTML +
      '<div class="media-card-body"><span class="badge badge-blue">' + escapeHTML(theme || category) + '</span>' +
      '<h4>' + escapeHTML(title) + '</h4><p>' + escapeHTML(description) + '</p>' +
      '<div class="media-card-meta">' + modifiedHTML + actionHTML + '</div></div></article>';
  }

  /* Extrai, a partir dos itens já filtrados por vertente, apenas os valores
     de Categoria/Tema/Tipo de Mídia que realmente existem — sem opções
     fantasma/fixas no HTML. */
  function buildFacets(items) {
    var categories = [], categorySeen = {};
    var themes = [], themeSeen = {};
    var medias = [], mediaSeen = {};
    items.forEach(function (item) {
      var catLabel = value(item, ["Categoria", "categoria", "CategoriaPortal", "Categoria do Portal"]) || "Conteúdos";
      var catKey = key(catLabel);
      if (!categorySeen[catKey]) { categorySeen[catKey] = true; categories.push({ key: catKey, label: catLabel }); }

      var themeLabel = value(item, ["Tema", "tema", "TemaPortal", "Tema do Portal"]) || "Geral";
      var themeKey = key(themeLabel);
      if (!themeSeen[themeKey]) { themeSeen[themeKey] = true; themes.push({ key: themeKey, label: themeLabel }); }

      var mType = mediaType(item);
      var mLabel = mediaLabel(item, mType);
      if (!mediaSeen[mType]) { mediaSeen[mType] = true; medias.push({ key: mType, label: mLabel }); }
    });
    return { categories: categories, themes: themes, medias: medias };
  }

  function filterRowHTML(dimension, label, options, ariaLabel) {
    /* Uma dimensão com 0 ou 1 valor possível não precisa de filtro (o
       "Todos" já cobre o mesmo resultado). */
    if (options.length < 2) return "";
    var html = '<div class="filter-bar-row"><span class="filter-bar-label">' + escapeHTML(label) + '</span>' +
      '<div class="filter-bar" role="tablist" aria-label="' + escapeHTML(ariaLabel) + '" data-filter-dimension="' + dimension + '">' +
      '<button class="filter-chip is-active" type="button" data-filter="todos"><i class="chip-dot"></i>Todos</button>';
    options.forEach(function (opt) {
      html += '<button class="filter-chip" type="button" data-filter="' + escapeHTML(opt.key) + '">' +
        '<i class="chip-dot"></i>' + escapeHTML(opt.label) + '</button>';
    });
    return html + '</div></div>';
  }

  function renderDynamicContent(data) {
    var current = pageVertente();
    /* A Dashboard (Visão Geral) não recebe mais o dump completo de todas as
       seções/filtros de GR+GL+Sinistros: ela tem seu próprio painel executivo
       (ver assets/dashboard-funcional.js), que reaproveita os helpers deste
       arquivo via window.PortalContent em vez de duplicar a lógica. */
    if (current === "DASHBOARD") return;
    var source = Array.isArray(data.itensPortal) ? data.itensPortal : [];
    var items = source.filter(function (item) {
      return isActive(item) && matchesVertente(value(item, ["Vertente", "vertente", "VertentePortal", "Vertente do Portal"]), current);
    });
    if (!items.length) {
      console.info("[Portal] Nenhum item do SharePoint para a vertente " + current + ". Itens recebidos:", source.length);
      return;
    }

    items.sort(function (a, b) { return Number(a.OrdemExibicao || a.ordemExibicao || 9999) - Number(b.OrdemExibicao || b.ordemExibicao || 9999); });
    var groups = {};
    items.forEach(function (item) {
      var category = value(item, ["Categoria", "categoria", "CategoriaPortal", "Categoria do Portal"]) || "Conteúdos";
      var theme = value(item, ["Tema", "tema", "TemaPortal", "Tema do Portal"]) || "Geral";
      var categoryKey = key(category);
      groups[categoryKey] = groups[categoryKey] || { label: category, themes: {} };
      groups[categoryKey].themes[key(theme)] = groups[categoryKey].themes[key(theme)] || { label: theme, items: [] };
      groups[categoryKey].themes[key(theme)].items.push(item);
    });

    var main = document.querySelector("#main-content");
    if (!main) return;
    /* Remove de vez o conteúdo estático legado (barra de filtro antiga do
       protótipo, cards de demonstração etc.) em vez de apenas escondê-lo. */
    var oldSections = main.querySelectorAll(".content-cards, .content-section, .filter-bar-row, .filter-bar, .content-grid, .empty-panel");
    oldSections.forEach(function (node) { node.remove(); });

    var root = document.createElement("div");
    root.className = "portal-dynamic-content";

    var facets = buildFacets(items);
    var hasAnyFacet = (facets.categories.length > 1) || (facets.themes.length > 1) || (facets.medias.length > 1);
    var FILTER_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';
    var CHEVRON_ICON = '<svg class="arrow-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
    var SEARCH_ICON = '<svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    var toolbarAndPanelHTML =
      '<div class="toolbar-container' + (hasAnyFacet ? '' : ' is-empty-facets') + '">' +
        '<button type="button" class="btn-toggle-filters" id="btn-toggle-filters" aria-expanded="false" aria-controls="filters-panel-body">' +
          FILTER_ICON +
          '<span>Filtrar conteúdos</span>' +
          '<span class="filters-toggle-badge" hidden>0</span>' +
          CHEVRON_ICON +
        '</button>' +
        '<div class="search-input-wrapper">' +
          SEARCH_ICON +
          '<input type="text" id="search-title-input" placeholder="Buscar por título..." autocomplete="off" />' +
          '<button type="button" class="btn-clear-search" id="btn-clear-search" hidden aria-label="Limpar busca">&times;</button>' +
        '</div>' +
      '</div>' +
      '<div class="filters-panel" id="filters-panel-body" hidden>' +
        '<div class="filters-panel-inner">' +
          '<div class="filter-bars">' +
            filterRowHTML("categoria", "Categoria", facets.categories, "Filtrar por categoria") +
            filterRowHTML("tema", "Tema", facets.themes, "Filtrar por tema") +
            filterRowHTML("midia", "Tipo de Mídia", facets.medias, "Filtrar por tipo de mídia") +
          '</div>' +
          '<div class="filters-panel-actions">' +
            '<button type="button" class="filters-clear-btn">Limpar filtros</button>' +
            '<button type="button" class="filters-apply-btn">Aplicar e fechar</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="empty-state" hidden>' +
        '<span class="empty-state-icon">' + ICONS.default + '</span>' +
        '<h3>Nenhum conteúdo encontrado</h3>' +
        '<p>Tente ajustar os filtros ou o termo buscado.</p>' +
      '</div>';
    root.insertAdjacentHTML("beforeend", toolbarAndPanelHTML);

    Object.keys(groups).forEach(function (groupKey) {
      var group = groups[groupKey];
      var total = Object.keys(group.themes).reduce(function (sum, themeKey) { return sum + group.themes[themeKey].items.length; }, 0);
      var section = '<section class="content-section" data-category="' + groupKey + '" aria-label="' + escapeHTML(group.label) + '"><div class="content-section-head"><span class="content-section-icon">' + ICONS.default + '</span><h2>' + escapeHTML(group.label) + '</h2><span class="content-section-count">' + total + (total === 1 ? ' item' : ' itens') + '</span></div>';
      Object.keys(group.themes).forEach(function (themeKey) {
        var theme = group.themes[themeKey];
        section += '<div class="portal-theme" data-theme="' + themeKey + '"><h3 class="portal-theme-title">' + escapeHTML(theme.label) + '</h3><div class="media-grid">' + theme.items.map(function (item) { return card(item, group.label, theme.label, groupKey, themeKey); }).join("") + '</div></div>';
      });
      root.insertAdjacentHTML("beforeend", section + '</section>');
    });

    var footer = main.querySelector(".page-footer-note");
    main.insertBefore(root, footer || null);
    initFilters(root);
    initModalTriggers(root);
  }

  /* ---------- Filtro cruzado: Categoria + Tema + Tipo de Mídia ----------
     As três dimensões são independentes e combinadas em tempo real sobre o
     mesmo grid, sem recarregar dados do SharePoint. */
  function applyFilters(root, state) {
    var cards = root.querySelectorAll(".media-card");
    var visibleCount = 0;
    var busca = (state.busca || "").trim().toLowerCase();
    cards.forEach(function (cardEl) {
      var matchCategoria = state.categoria === "todos" || cardEl.getAttribute("data-category") === state.categoria;
      var matchTema = state.tema === "todos" || cardEl.getAttribute("data-theme") === state.tema;
      var matchMidia = state.midia === "todos" || cardEl.getAttribute("data-type") === state.midia;
      var matchBusca = !busca || (cardEl.getAttribute("data-title") || "").indexOf(busca) !== -1;
      var show = matchCategoria && matchTema && matchMidia && matchBusca;
      cardEl.classList.toggle("is-hidden", !show);
      if (show) {
        visibleCount++;
        cardEl.classList.remove("is-filtering");
        void cardEl.offsetWidth; /* força reflow para reiniciar a transição de fade-in */
        cardEl.classList.add("is-filtering");
      }
    });

    /* Um tema/categoria some da tela quando nenhum card seu permanece visível. */
    root.querySelectorAll(".portal-theme").forEach(function (themeEl) {
      themeEl.hidden = !themeEl.querySelector(".media-card:not(.is-hidden)");
    });
    root.querySelectorAll(".content-section").forEach(function (sectionEl) {
      sectionEl.hidden = !sectionEl.querySelector(".media-card:not(.is-hidden)");
    });

    var emptyState = root.querySelector(".empty-state");
    if (emptyState) emptyState.hidden = visibleCount !== 0;

    atualizarDashboardBanner(root);
  }

  /* Conta quantas dimensões (categoria/tema/mídia) estão diferentes de
     "todos" e atualiza o badge do botão de abertura do painel. Puramente
     visual — não interfere na lógica de filtragem em si. */
  function updateFiltersBadge(root, state) {
    var badge = root.querySelector(".filters-toggle-badge");
    if (!badge) return;
    var activeCount = ["categoria", "tema", "midia"].reduce(function (count, dim) {
      return count + (state[dim] && state[dim] !== "todos" ? 1 : 0);
    }, 0);
    if ((state.busca || "").trim()) activeCount++;
    badge.textContent = activeCount;
    badge.hidden = activeCount === 0;
    var toggle = root.querySelector(".btn-toggle-filters");
    if (toggle) toggle.classList.toggle("has-active-filters", activeCount > 0);
  }

  /* Painel retrátil: controla apenas abrir/fechar (max-height + opacity).
     Estado inicial é sempre fechado para economizar espaço vertical. */
  function initFiltersPanel(root) {
    var toggle = root.querySelector(".btn-toggle-filters");
    var panel = root.querySelector(".filters-panel");
    var applyBtn = root.querySelector(".filters-apply-btn");
    if (!toggle || !panel) return;

    function openPanel() {
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      toggle.classList.add("is-open");
      requestAnimationFrame(function () { panel.classList.add("is-open"); });
    }
    function closePanel() {
      toggle.setAttribute("aria-expanded", "false");
      toggle.classList.remove("is-open");
      panel.classList.remove("is-open");
      window.setTimeout(function () {
        if (!panel.classList.contains("is-open")) panel.hidden = true;
      }, 320);
    }

    toggle.addEventListener("click", function () {
      if (panel.classList.contains("is-open")) closePanel(); else openPanel();
    });
    if (applyBtn) applyBtn.addEventListener("click", closePanel);
  }

  function initFilters(scope) {
    var root = scope || document;
    var state = { categoria: "todos", tema: "todos", midia: "todos", busca: "" };
    var dimensionGroups = root.querySelectorAll(".filter-bar[data-filter-dimension]");
    dimensionGroups.forEach(function (group) {
      var dimension = group.getAttribute("data-filter-dimension");
      var chips = group.querySelectorAll(".filter-chip");
      chips.forEach(function (chip) {
        chip.addEventListener("click", function () {
          chips.forEach(function (c) { c.classList.remove("is-active"); });
          chip.classList.add("is-active");
          state[dimension] = chip.getAttribute("data-filter");
          applyFilters(root, state);
          updateFiltersBadge(root, state);
        });
      });
    });

    /* Busca por título em tempo real — cruzada com categoria/tema/mídia,
       sem recarregar dados nem duplicar a lógica de filtragem. */
    var searchInput = root.querySelector("#search-title-input");
    var clearSearchBtn = root.querySelector("#btn-clear-search");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        state.busca = searchInput.value;
        if (clearSearchBtn) clearSearchBtn.hidden = !searchInput.value;
        applyFilters(root, state);
        updateFiltersBadge(root, state);
      });
    }
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener("click", function () {
        state.busca = "";
        if (searchInput) searchInput.value = "";
        clearSearchBtn.hidden = true;
        applyFilters(root, state);
        updateFiltersBadge(root, state);
        if (searchInput) searchInput.focus();
      });
    }

    var clearBtn = root.querySelector(".filters-clear-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        state.categoria = "todos"; state.tema = "todos"; state.midia = "todos";
        root.querySelectorAll(".filter-bar[data-filter-dimension] .filter-chip").forEach(function (chip) {
          chip.classList.toggle("is-active", chip.getAttribute("data-filter") === "todos");
        });
        applyFilters(root, state);
        updateFiltersBadge(root, state);
      });
    }

    applyFilters(root, state);
    updateFiltersBadge(root, state);
    initFiltersPanel(root);
  }

  /* ---------- Modal fullscreen (Power BI / PDF / Vídeo / Infográfico) ----------
     Um único modal é reaproveitado por todos os cards da página. */
  var modalEl = null;

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement("div");
    modalEl.className = "portal-modal";
    modalEl.setAttribute("aria-hidden", "true");
    modalEl.innerHTML =
      '<div class="portal-modal-backdrop" data-modal-close></div>' +
      '<div class="portal-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="portal-modal-title">' +
        '<header class="portal-modal-head">' +
          '<h3 id="portal-modal-title"></h3>' +
          '<div class="portal-modal-actions">' +
            '<a class="portal-modal-newtab" href="#" target="_blank" rel="noopener noreferrer">Abrir em nova aba' + EXPAND_ICON + '</a>' +
            '<button type="button" class="portal-modal-close" data-modal-close aria-label="Fechar visualização">&times;</button>' +
          '</div>' +
        '</header>' +
        '<div class="portal-modal-body"></div>' +
      '</div>';
    document.body.appendChild(modalEl);
    modalEl.addEventListener("click", function (e) {
      if (e.target && e.target.hasAttribute("data-modal-close")) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modalEl.classList.contains("is-open")) closeModal();
    });
    return modalEl;
  }

  function openModal(type, embedSrc, fallbackUrl, title) {
    var modal = ensureModal();
    var body = modal.querySelector(".portal-modal-body");
    modal.querySelector("#portal-modal-title").textContent = title || "Conteúdo";
    modal.querySelector(".portal-modal-newtab").href = fallbackUrl || embedSrc || "#";
    body.innerHTML = "";

    if (type === "infografico") {
      var img = document.createElement("img");
      img.className = "portal-modal-image";
      img.src = fallbackUrl || embedSrc;
      img.alt = title || "";
      body.appendChild(img);
    } else if (embedSrc) {
      var iframe = document.createElement("iframe");
      iframe.className = "portal-modal-iframe";
      iframe.src = embedSrc;
      iframe.title = title || "Conteúdo";
      iframe.setAttribute("allowfullscreen", "");
      iframe.setAttribute("allow", "fullscreen; autoplay");
      body.appendChild(iframe);
    } else {
      body.innerHTML = '<p class="portal-modal-empty">Este conteúdo não pode ser exibido aqui. Use "Abrir em nova aba".</p>';
    }

    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    requestAnimationFrame(function () { modal.classList.add("is-open"); });
    document.documentElement.classList.add("portal-modal-open");
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.classList.remove("is-open");
    modalEl.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("portal-modal-open");
    window.setTimeout(function () {
      if (!modalEl.classList.contains("is-open")) {
        modalEl.hidden = true;
        modalEl.querySelector(".portal-modal-body").innerHTML = ""; /* interrompe vídeo/dashboard ao fechar */
      }
    }, 240);
  }

  function openFromTrigger(trigger) {
    openModal(
      trigger.getAttribute("data-modal-type"),
      trigger.getAttribute("data-modal-src"),
      trigger.getAttribute("data-modal-fallback"),
      trigger.getAttribute("data-modal-title")
    );
  }

  function initModalTriggers(scope) {
    var root = scope || document;
    root.querySelectorAll("[data-modal-src]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openFromTrigger(btn);
      });
      btn.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openFromTrigger(btn);
      });
    });
  }

  /* API compartilhada: permite que outras páginas (hoje, a Dashboard
     executiva em dashboard-funcional.js) reaproveitem exatamente as mesmas
     regras de leitura de campo, filtragem e o mesmo componente de card,
     sem duplicar nenhuma função JavaScript. */
  window.PortalContent = {
    value: value,
    isActive: isActive,
    key: key,
    escapeHTML: escapeHTML,
    matchesVertente: matchesVertente,
    mediaType: mediaType,
    mediaLabel: mediaLabel,
    actionLabel: actionLabel,
    card: card,
    ICONS: ICONS,
    MEDIA_LABELS: MEDIA_LABELS,
    MEDIA_COLORS: MEDIA_COLORS,
    initModalTriggers: initModalTriggers
  };

  document.addEventListener("DOMContentLoaded", function () {
    var data = window.PortalShell && window.PortalShell.readSessionData ? window.PortalShell.readSessionData() : { itensPortal: [] };
    renderDynamicContent(data);
  });
})();
