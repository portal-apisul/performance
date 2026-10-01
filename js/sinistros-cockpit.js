/**
 * sinistros-cockpit.js
 * Cockpit operacional interativo do Portal de Sinistros.
 * Dados reais de itensProcessos + cross-filter + Chart.js.
 * A lista é recebida no login e preservada na sessão do portal.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Constantes do processo                                             */
  /* ------------------------------------------------------------------ */
  var FLOW_STAGES = [
    "Abertura",
    "One Page",
    "Doc. Transportadora",
    "Análise Crítica",
    "Relatório de Eventos",
    "Parecer",
    "Concluído"
  ];
  var CURRENT_STAGE_ORDER = [
    "Ag. Doc. Transp",
    "Analise Critica",
    "Em Analise",
    "Analise concluído",
    "Aguard. Culpabilidade (Mondelez)",
    "Pendente pagamento segurado",
    "Concluido"
  ];
  var STAGES = [];

  var SLA_DAYS = 15;
  var COLORS = {
    primary: "#2f6fed",
    secondary: "#7c5cff",
    teal: "#17d1c4",
    ok: "#17a37a",
    warn: "#dfa12a",
    danger: "#d64545",
    muted: "#9fb0c3",
    stage: ["#2f6fed", "#4d8dff", "#7c5cff", "#17d1c4", "#4be3a0", "#f2b56b", "#17a37a"]
  };

  /* ------------------------------------------------------------------ */
  /* Leitura e normalização dos dados reais                             */
  /* ------------------------------------------------------------------ */
  function daysAgo(n) {
    var d = new Date(DATA_REFERENCE_DATE);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return d;
  }

  function addDays(date, n) {
    var d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function parseList(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try { return parseList(JSON.parse(value)); } catch (_) { return []; }
    }
    if (value && typeof value === "object") {
      var keys = ["itensProcessos", "processos", "itemsProcessos", "value", "results", "body"];
      for (var i = 0; i < keys.length; i++) {
        if (value[keys[i]] !== undefined) {
          var list = parseList(value[keys[i]]);
          if (list.length || Array.isArray(value[keys[i]])) return list;
        }
      }
    }
    return [];
  }

  function sessionProcesses() {
    var user = {};
    try { user = JSON.parse(sessionStorage.getItem("portalUsuario") || "{}"); } catch (_) {}
    return parseList(user.itensProcessos || (user.body && user.body.itensProcessos) || sessionStorage.getItem("itensProcessos"));
  }

  function dateValue(value) {
    if (!value) return null;
    var date = new Date(value);
    return isNaN(date.getTime()) || date.getFullYear() < 2000 ? null : date;
  }

  function lookupText(value) {
    if (value && typeof value === "object") return String(value.Value || value.value || value.Title || "").trim();
    return String(value || "").trim();
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function originalStage(value) {
    return lookupText(value) || "Não informado";
  }

  function isClosedStage(value) {
    return /^conclu/i.test(String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  }

  function realSla(item) {
    var keys = [
      "Comunicado_x0020_padr_x00e3_o_x0", "Status_x0020_OnPage",
      "Status_x0020_Documento_x0020_TR", "Status_x0020_Analise_x0020_Criti",
      "Status_x0020_Relatorio_x0020_de_"
    ];
    var statuses = keys.map(function (key) { return String(item[key] || "").trim().toLowerCase(); });
    return statuses.some(function (status) { return status.indexOf("fora do prazo") !== -1; }) ? "Fora" : "Dentro";
  }

  function progressValue(value) {
    if (value === null || value === undefined || value === "") return 0;
    var text = String(value).trim().replace("%", "").replace(",", ".");
    var number = Number(text);
    if (!isFinite(number)) return 0;
    if (number > 0 && number <= 1 && String(value).indexOf("%") === -1) number *= 100;
    return Math.max(0, Math.min(100, Math.round(number * 10) / 10));
  }

  function stageOrderIndex(stage) {
    var index = CURRENT_STAGE_ORDER.indexOf(stage);
    return index === -1 ? CURRENT_STAGE_ORDER.length : index;
  }

  function latestStageDate(item) {
    var stageDates = [
      dateValue(item.field_6),
      dateValue(item.Comunicado_x0020_padr_x00e3_o_x00),
      dateValue(item.EntregaOnPage),
      dateValue(item.field_9),
      dateValue(item.field_11),
      dateValue(item.field_13)
    ].filter(Boolean);
    if (!stageDates.length) return null;
    return stageDates.reduce(function (latest, current) {
      return current > latest ? current : latest;
    });
  }

  function normalizeProcess(item) {
    var stage = originalStage(item.field_3);
    var opened = dateValue(item.field_6) || dateValue(item.DataDoSinistro) || dateValue(item.Created) || new Date();
    var reference = dateValue(item.Data_x0020_Atual) || dateValue(item.Modified) || new Date();
    var count = Math.abs(Number(String(item.Contagem_x0020_de_x0020_Dias || "").replace(",", ".")));
    var totalDays = isFinite(count) && count > 0 ? Math.round(count) : Math.max(0, Math.round((reference - opened) / 86400000));
    var lastStageUpdate = latestStageDate(item);
    var currentStageDays = lastStageUpdate
      ? Math.max(0, Math.floor((reference - lastStageUpdate) / 86400000))
      : null;
    var transitions = {
      "Abertura": opened,
      "One Page": dateValue(item.EntregaOnPage),
      "Doc. Transportadora": dateValue(item.field_9),
      "Análise Crítica": dateValue(item.field_11),
      "Relatório de Eventos": dateValue(item.field_13)
    };
    if (isClosedStage(stage)) transitions["Concluído"] = reference;

    return {
      id: String(item.NumeroProcessoCenop || item.ID || item.ItemInternalId || "—"),
      unit: String(item.field_1 || "Não informado"),
      type: lookupText(item.TipodeSinistro) || "Não informado",
      culpability: lookupText(item.Culpabilidade) || "Não informado",
      opened: opened,
      stage: stage,
      stageId: Number(item["field_3#Id"] || (item.field_3 && item.field_3.Id) || 9999),
      closed: isClosedStage(stage),
      progress: progressValue(item.field_2 !== undefined ? item.field_2 : item.Progresso),
      lastStageUpdate: lastStageUpdate,
      currentStageDays: currentStageDays,
      totalDays: totalDays,
      sla: realSla(item),
      transitions: transitions,
      value: item.ValorCarga || "",
      source: item
    };
  }

  var ALL = sessionProcesses().map(normalizeProcess);
  STAGES = ALL.reduce(function (list, item) {
    if (list.indexOf(item.stage) === -1) list.push(item.stage);
    return list;
  }, []).sort(function (a, b) {
    var orderDiff = stageOrderIndex(a) - stageOrderIndex(b);
    if (orderDiff) return orderDiff;
    var aa = ALL.find(function (item) { return item.stage === a; });
    var bb = ALL.find(function (item) { return item.stage === b; });
    return (aa.stageId - bb.stageId) || a.localeCompare(b, "pt-BR");
  });
  var DATA_REFERENCE_DATE = ALL.reduce(function (latest, item) {
    var current = dateValue(item.source.Data_x0020_Atual) || dateValue(item.source.Modified) || item.opened;
    return current > latest ? current : latest;
  }, new Date(0));
  if (!ALL.length || DATA_REFERENCE_DATE.getTime() === 0) DATA_REFERENCE_DATE = new Date();

  /* ------------------------------------------------------------------ */
  /* Estado de filtros                                                  */
  /* ------------------------------------------------------------------ */
  var state = {
    period: 0,
    status: "todos",
    sla: "todos",
    stages: [],
    selectedProcesses: [],
    aging: "todos",
    search: "",
    sortKey: "totalDays",
    sortDir: -1
  };

  function inPeriod(item) {
    if (!state.period) return true;
    var limit = daysAgo(state.period);
    return item.opened >= limit;
  }

  function filtered(includeProcessSelection) {
    var q = state.search.trim().toLowerCase();
    return ALL.filter(function (item) {
      if (!inPeriod(item)) return false;
      if (state.status === "abertos" && item.closed) return false;
      if (state.status === "concluidos" && !item.closed) return false;
      if (state.sla === "fora" && item.sla !== "Fora") return false;
      if (state.sla === "dentro" && item.sla !== "Dentro") return false;
      if (state.stages.length && state.stages.indexOf(item.stage) === -1) return false;
      if (includeProcessSelection !== false && state.selectedProcesses.length && state.selectedProcesses.indexOf(item.id) === -1) return false;
      if (state.aging !== "todos") {
        var b = agingBucket(item.totalDays);
        if (b !== state.aging) return false;
      }
      if (q) {
        var hay = (item.id + " " + item.unit + " " + item.type + " " + item.culpability + " " + item.stage).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function agingBucket(days) {
    if (days <= 7) return "baixo";
    if (days <= 15) return "medio";
    if (days <= 30) return "alto";
    return "critico";
  }

  /* ------------------------------------------------------------------ */
  /* Métricas                                                           */
  /* ------------------------------------------------------------------ */
  function computeKPIs(data) {
    var total = data.length;
    var open = 0, closed = 0, fora = 0, dentro = 0, sumDays = 0, sumProgress = 0, criticos = 0;
    var stageCount = {};
    STAGES.forEach(function (s) { stageCount[s] = 0; });

    data.forEach(function (d) {
      stageCount[d.stage] = (stageCount[d.stage] || 0) + 1;
      if (d.closed) closed++; else open++;
      if (d.sla === "Fora") fora++; else dentro++;
      sumDays += d.totalDays;
      sumProgress += d.progress;
      if (!d.closed && d.totalDays > SLA_DAYS) criticos++;
    });

    var avg = total ? Math.round((sumDays / total) * 10) / 10 : 0;
    var slaPct = total ? Math.round((dentro / total) * 1000) / 10 : 0;
    var efficiency = total ? Math.round((closed / total) * 1000) / 10 : 0;
    var progressAvg = total ? Math.round((sumProgress / total) * 10) / 10 : 0;

    return {
      total: total,
      open: open,
      closed: closed,
      fora: fora,
      dentro: dentro,
      avg: avg,
      slaPct: slaPct,
      efficiency: efficiency,
      progressAvg: progressAvg,
      criticos: criticos,
      stageCount: stageCount
    };
  }

  function stageTimeStats(data) {
    var stats = {};
    FLOW_STAGES.forEach(function (s, idx) {
      if (idx === 0) return;
      var prev = FLOW_STAGES[idx - 1];
      var times = [];
      data.forEach(function (d) {
        if (d.transitions[s] && d.transitions[prev]) {
          var days = Math.max(0, Math.round((d.transitions[s] - d.transitions[prev]) / 86400000));
          times.push(days);
        }
      });
      if (!times.length) {
        stats[s] = { avg: 0, max: 0, min: 0, p90: 0, n: 0 };
        return;
      }
      times.sort(function (a, b) { return a - b; });
      var sum = times.reduce(function (a, b) { return a + b; }, 0);
      var p90 = times[Math.min(times.length - 1, Math.floor(times.length * 0.9))];
      stats[s] = {
        avg: Math.round((sum / times.length) * 10) / 10,
        max: times[times.length - 1],
        min: times[0],
        p90: p90,
        n: times.length
      };
    });
    return stats;
  }

  function weeklyTrend(data) {
    var weeks = {};
    data.forEach(function (d) {
      var w = weekKey(d.opened);
      if (!weeks[w]) weeks[w] = { open: 0, closed: 0, label: w };
      weeks[w].open++;
      if (d.closed) weeks[w].closed++;
    });
    var keys = Object.keys(weeks).sort();
    return keys.map(function (k) { return weeks[k]; });
  }

  function weekKey(date) {
    var d = new Date(date);
    var onejan = new Date(d.getFullYear(), 0, 1);
    var week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
    return d.getFullYear() + "-S" + String(week).padStart(2, "0");
  }

  /* ------------------------------------------------------------------ */
  /* Charts                                                             */
  /* ------------------------------------------------------------------ */
  var charts = {};

  function destroyChart(id) {
    if (charts[id]) {
      charts[id].destroy();
      delete charts[id];
    }
  }

  function renderTrend(data) {
    var canvas = document.getElementById("sx-chart-trend");
    if (!canvas || typeof Chart === "undefined") return;
    destroyChart("trend");
    var trend = weeklyTrend(data);
    charts.trend = new Chart(canvas, {
      type: "line",
      data: {
        labels: trend.map(function (t) { return t.label; }),
        datasets: [
          {
            label: "Abertos no período",
            data: trend.map(function (t) { return t.open; }),
            borderColor: COLORS.primary,
            backgroundColor: "rgba(47,111,237,0.12)",
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 6
          },
          {
            label: "Concluídos",
            data: trend.map(function (t) { return t.closed; }),
            borderColor: COLORS.ok,
            backgroundColor: "rgba(23,163,122,0.1)",
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: {
            backgroundColor: "#0b1830",
            titleFont: { size: 12 },
            bodyFont: { size: 11 },
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 0 } },
          y: { beginAtZero: true, grid: { color: "#eef2f7" }, ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  function renderTypeMix(data) {
    var canvas = document.getElementById("sx-chart-type");
    if (!canvas || typeof Chart === "undefined") return;
    destroyChart("type");
    var counts = {};
    data.forEach(function (d) {
      counts[d.type] = (counts[d.type] || 0) + 1;
    });
    var labels = Object.keys(counts);
    var values = labels.map(function (l) { return counts[l]; });
    charts.type = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: [COLORS.primary, COLORS.secondary, COLORS.teal, COLORS.warn, COLORS.danger, "#4be3a0"],
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 }, padding: 12 } },
          tooltip: {
            backgroundColor: "#0b1830",
            padding: 10,
            cornerRadius: 8
          }
        }
      }
    });
  }

  function renderSlaBars(data) {
    var canvas = document.getElementById("sx-chart-sla");
    if (!canvas || typeof Chart === "undefined") return;
    destroyChart("sla");
    var byStage = {};
    STAGES.forEach(function (s) {
      if (isClosedStage(s)) return;
      byStage[s] = { dentro: 0, fora: 0 };
    });
    data.forEach(function (d) {
      if (d.closed) return;
      if (!byStage[d.stage]) return;
      if (d.sla === "Fora") byStage[d.stage].fora++;
      else byStage[d.stage].dentro++;
    });
    var labels = Object.keys(byStage);
    charts.sla = new Chart(canvas, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Dentro do SLA",
            data: labels.map(function (l) { return byStage[l].dentro; }),
            backgroundColor: COLORS.ok,
            borderRadius: 6,
            barPercentage: 0.7
          },
          {
            label: "Fora do SLA",
            data: labels.map(function (l) { return byStage[l].fora; }),
            backgroundColor: COLORS.danger,
            borderRadius: 6,
            barPercentage: 0.7
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { backgroundColor: "#0b1830", padding: 10, cornerRadius: 8 }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 35 } },
          y: { stacked: true, beginAtZero: true, grid: { color: "#eef2f7" }, ticks: { font: { size: 10 } } }
        },
        onClick: function (evt, elements) {
          if (!elements.length) return;
          var idx = elements[0].index;
          toggleStageFilter(labels[idx]);
        }
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Render DOM                                                         */
  /* ------------------------------------------------------------------ */
  function renderKPIs(kpis) {
    var map = {
      "kpi-total": kpis.total,
      "kpi-open": kpis.open,
      "kpi-closed": kpis.closed,
      "kpi-sla": kpis.slaPct + "%",
      "kpi-avg": kpis.avg + "d",
      "kpi-criticos": kpis.criticos,
      "kpi-eff": kpis.efficiency + "%",
      "kpi-progress": kpis.progressAvg + "%"
    };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = map[id];
    });

    var sub = {
      "kpi-total-sub": "no período",
      "kpi-open-sub": Math.round((kpis.open / (kpis.total || 1)) * 100) + "% do total",
      "kpi-closed-sub": Math.round((kpis.closed / (kpis.total || 1)) * 100) + "% concluídos",
      "kpi-sla-sub": kpis.dentro + " dentro · " + kpis.fora + " fora",
      "kpi-avg-sub": "média de ciclo",
      "kpi-criticos-sub": "abertos > " + SLA_DAYS + " dias",
      "kpi-eff-sub": "taxa de conclusão",
      "kpi-progress-sub": "média do filtro atual"
    };
    Object.keys(sub).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = sub[id];
    });

    var slaEl = document.getElementById("kpi-sla");
    if (slaEl) {
      var parent = slaEl.closest(".sx-kpi");
      if (parent) {
        parent.setAttribute("data-tone", kpis.slaPct >= 80 ? "ok" : kpis.slaPct >= 60 ? "warn" : "danger");
      }
    }
    var critEl = document.getElementById("kpi-criticos");
    if (critEl) {
      var p = critEl.closest(".sx-kpi");
      if (p) p.setAttribute("data-tone", kpis.criticos > 10 ? "danger" : kpis.criticos > 5 ? "warn" : "ok");
    }
  }

  function renderFunnel(kpis) {
    var root = document.getElementById("sx-funnel");
    if (!root) return;
    var max = Math.max.apply(null, STAGES.map(function (s) { return kpis.stageCount[s] || 0; }).concat([1]));
    root.innerHTML = STAGES.map(function (s) {
      var n = kpis.stageCount[s] || 0;
      var pct = Math.round((n / max) * 100);
      var active = state.stages.indexOf(s) !== -1 ? " is-active" : "";
      var closed = isClosedStage(s) ? " is-closed" : "";
      return (
        '<div class="sx-funnel-row' + active + closed + '" data-stage-index="' + STAGES.indexOf(s) + '" role="button" tabindex="0">' +
          '<span class="sx-funnel-label">' + escapeHtml(s) + '</span>' +
          '<div class="sx-funnel-bar-track"><div class="sx-funnel-bar" style="width:' + pct + '%"></div></div>' +
          '<span class="sx-funnel-count">' + n + '</span>' +
        '</div>'
      );
    }).join("");

    root.querySelectorAll(".sx-funnel-row").forEach(function (row) {
      row.addEventListener("click", function () {
        toggleStageFilter(STAGES[Number(row.getAttribute("data-stage-index"))]);
      });
    });
  }

  function renderStageTimes(data) {
    var root = document.getElementById("sx-stage-times");
    if (!root) return;
    var stats = stageTimeStats(data);
    var maxAvg = 1;
    Object.keys(stats).forEach(function (s) {
      if (stats[s].avg > maxAvg) maxAvg = stats[s].avg;
    });
    root.innerHTML = Object.keys(stats).map(function (s) {
      var st = stats[s];
      var pct = Math.round((st.avg / maxAvg) * 100);
      return (
        '<div class="sx-stage-time">' +
          '<span class="sx-stage-time-label">' + s + '</span>' +
          '<span class="sx-stage-time-meta">méd ' + st.avg + 'd · p90 ' + st.p90 + 'd · máx ' + st.max + 'd</span>' +
          '<div class="sx-stage-time-bar"><div class="sx-stage-time-fill" style="width:' + pct + '%"></div></div>' +
        '</div>'
      );
    }).join("");
  }

  function renderGauge(kpis) {
    var fg = document.getElementById("sx-gauge-fg");
    var val = document.getElementById("sx-gauge-val");
    var legDentro = document.getElementById("sx-leg-dentro");
    var legFora = document.getElementById("sx-leg-fora");
    if (!fg) return;
    var r = 54;
    var c = 2 * Math.PI * r;
    var offset = c - (kpis.slaPct / 100) * c;
    fg.style.strokeDasharray = c;
    fg.style.strokeDashoffset = offset;
    if (val) val.textContent = kpis.slaPct + "%";
    if (legDentro) legDentro.textContent = kpis.dentro;
    if (legFora) legFora.textContent = kpis.fora;
  }

  function renderAging(data) {
    var buckets = { baixo: 0, medio: 0, alto: 0, critico: 0 };
    data.forEach(function (d) {
      if (d.closed) return;
      buckets[agingBucket(d.totalDays)]++;
    });
    ["baixo", "medio", "alto", "critico"].forEach(function (b) {
      var el = document.getElementById("aging-" + b);
      if (el) {
        el.textContent = buckets[b];
        var card = el.closest(".sx-aging-card");
        if (card) {
          card.classList.toggle("is-active", state.aging === b);
        }
      }
    });
  }

  function renderRank(data) {
    var root = document.getElementById("sx-rank");
    if (!root) return;
    var map = {};
    data.forEach(function (d) {
      if (d.closed) return;
      if (!map[d.stage]) map[d.stage] = { n: 0, days: 0 };
      map[d.stage].n++;
      map[d.stage].days += d.totalDays;
    });
    var rows = Object.keys(map).map(function (s) {
      return {
        stage: s,
        n: map[s].n,
        avg: Math.round((map[s].days / map[s].n) * 10) / 10,
        score: map[s].n * (map[s].days / map[s].n)
      };
    }).sort(function (a, b) {
      return stageOrderIndex(a.stage) - stageOrderIndex(b.stage);
    });

    if (!rows.length) {
      root.innerHTML = '<div class="sx-empty">Nenhum gargalo no filtro atual.</div>';
      return;
    }
    root.innerHTML = rows.map(function (r, i) {
      return (
        '<div class="sx-rank-item" data-stage-index="' + STAGES.indexOf(r.stage) + '">' +
          '<span class="sx-rank-pos">' + (i + 1) + '</span>' +
          '<div><div class="sx-rank-name">' + escapeHtml(r.stage) + '</div>' +
          '<div class="sx-rank-sub">' + r.n + ' processos · média ' + r.avg + ' dias</div></div>' +
          '<span class="sx-rank-val">' + Math.round(r.score) + '</span>' +
        '</div>'
      );
    }).join("");

    root.querySelectorAll(".sx-rank-item").forEach(function (el) {
      el.addEventListener("click", function () {
        toggleStageFilter(STAGES[Number(el.getAttribute("data-stage-index"))]);
      });
    });
  }

  function renderTable(data) {
    var tbodies = ["sx-table-body", "sx-table-body-fluxo", "sx-table-body-clone"]
      .map(function (id) { return document.getElementById(id); })
      .filter(Boolean);
    if (!tbodies.length) return;
    var rows = data.slice().sort(function (a, b) {
      var ka = a[state.sortKey];
      var kb = b[state.sortKey];
      if (state.sortKey === "stage") {
        var stageDiff = stageOrderIndex(a.stage) - stageOrderIndex(b.stage);
        if (stageDiff) return stageDiff;
      }
      if (ka === null || ka === undefined) return 1;
      if (kb === null || kb === undefined) return -1;
      if (ka < kb) return -1 * state.sortDir;
      if (ka > kb) return 1 * state.sortDir;
      return 0;
    }).slice(0, 40);

    if (!rows.length) {
      tbodies.forEach(function (tbody) {
        tbody.innerHTML = '<tr><td colspan="10" class="sx-empty">Nenhum sinistro corresponde aos filtros.</td></tr>';
      });
      return;
    }

    var html = rows.map(function (d) {
      var slaClass = d.sla === "Fora" ? "sx-pill-danger" : "sx-pill-ok";
      var statusClass = d.closed ? "sx-pill-ok" : "sx-pill-info";
      var progressTone = d.progress >= 100 ? " is-complete" : d.progress < 50 ? " is-low" : "";
      var selected = state.selectedProcesses.indexOf(d.id) !== -1;
      return (
        '<tr data-process-id="' + escapeHtml(d.id) + '" class="' + (selected ? "is-selected" : "") + '" aria-selected="' + selected + '" title="Clique para selecionar ou remover este processo do filtro">' +
          '<td class="sx-id">' + escapeHtml(d.id) + '</td>' +
          '<td>' + escapeHtml(d.unit) + '</td>' +
          '<td>' + escapeHtml(d.type) + '</td>' +
          '<td>' + escapeHtml(d.stage) + '</td>' +
          '<td class="sx-stage-age" title="' + (d.lastStageUpdate ? "Última atualização da etapa: " + d.lastStageUpdate.toLocaleDateString("pt-BR") : "Nenhuma data de etapa preenchida") + '">' +
            (d.currentStageDays === null ? '<span class="sx-muted">Sem data</span>' : '<strong>' + d.currentStageDays + '</strong>d') +
          '</td>' +
          '<td><div class="sx-progress' + progressTone + '" aria-label="Progresso ' + d.progress + '%">' +
            '<div class="sx-progress-track"><span style="width:' + d.progress + '%"></span></div>' +
            '<strong>' + d.progress + '%</strong>' +
          '</div></td>' +
          '<td><span class="sx-pill ' + statusClass + '">' + (d.closed ? "Concluído" : "Em aberto") + '</span></td>' +
          '<td><span class="sx-pill ' + slaClass + '">' + d.sla + '</span></td>' +
          '<td>' + d.totalDays + 'd</td>' +
          '<td>' + escapeHtml(d.culpability) + '</td>' +
        '</tr>'
      );
    }).join("");
    tbodies.forEach(function (tbody) { tbody.innerHTML = html; });
  }

  function renderStageOptions() {
    var menu = document.getElementById("sx-stage-menu");
    if (!menu) return;
    menu.innerHTML = STAGES.map(function (stage, index) {
      var count = ALL.filter(function (item) { return item.stage === stage; }).length;
      return '<button type="button" class="sx-stage-option" data-stage-index="' + index + '" role="option" aria-selected="false">' +
        '<i></i><span>' + escapeHtml(stage) + '</span><small>' + count + '</small></button>';
    }).join("") + '<button type="button" class="sx-stage-clear">Limpar seleção de estágios</button>';
  }

  function syncStageOptions() {
    var summary = document.getElementById("sx-stage-summary");
    if (summary) {
      summary.textContent = !state.stages.length ? "Todos" : state.stages.length === 1 ? state.stages[0] : state.stages.length + " selecionados";
      summary.title = state.stages.join(", ");
    }
    document.querySelectorAll(".sx-stage-option").forEach(function (option) {
      var stage = STAGES[Number(option.getAttribute("data-stage-index"))];
      var selected = state.stages.indexOf(stage) !== -1;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-selected", String(selected));
      var check = option.querySelector("i");
      if (check) check.textContent = selected ? "✓" : "";
    });
  }

  function renderHint(data) {
    var el = document.getElementById("sx-filter-hint");
    if (!el) return;
    var parts = [];
    if (state.period) parts.push("últimos " + state.period + " dias");
    if (state.status !== "todos") parts.push(state.status);
    if (state.sla !== "todos") parts.push(state.sla === "fora" ? "fora do SLA" : "dentro do SLA");
    if (state.stages.length) parts.push("Estágio Atual: " + state.stages.join(", "));
    if (state.selectedProcesses.length) parts.push(state.selectedProcesses.length + " processo(s) selecionado(s) na lista");
    if (state.aging !== "todos") parts.push("aging: " + state.aging);
    if (state.search) parts.push('busca: "' + state.search + '"');
    if (!parts.length) {
      el.innerHTML = "<span>Exibindo <strong>" + data.length + "</strong> de " + ALL.length + " sinistros recebidos no login</span>";
    } else {
      el.innerHTML = "<span>Filtros ativos: <strong>" + parts.join(" · ") + "</strong> — <strong>" + data.length + "</strong> resultados</span>";
    }
  }

  /* ------------------------------------------------------------------ */
  /* Orquestração                                                       */
  /* ------------------------------------------------------------------ */
  function refresh() {
    var data = filtered();
    var tableData = filtered(false);
    var kpis = computeKPIs(data);
    renderKPIs(kpis);
    renderFunnel(kpis);
    renderStageTimes(data);
    renderGauge(kpis);
    renderAging(data);
    renderRank(data);
    renderTable(tableData);
    renderHint(data);
    renderTrend(data);
    renderTypeMix(data);
    renderSlaBars(data);
  }

  function setFilter(key, value) {
    state[key] = value;
    syncUI();
    refresh();
  }

  function toggleStageFilter(stage) {
    if (!stage) return;
    var index = state.stages.indexOf(stage);
    if (index === -1) state.stages.push(stage);
    else state.stages.splice(index, 1);
    syncUI();
    refresh();
  }

  function toggleProcessFilter(processId) {
    var index = state.selectedProcesses.indexOf(processId);
    if (index === -1) state.selectedProcesses.push(processId);
    else state.selectedProcesses.splice(index, 1);
    syncUI();
    refresh();
  }

  function syncUI() {
    document.querySelectorAll(".sx-period button").forEach(function (btn) {
      btn.classList.toggle("is-active", Number(btn.getAttribute("data-period")) === state.period);
    });
    document.querySelectorAll(".sx-chip[data-status]").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-status") === state.status);
    });
    document.querySelectorAll(".sx-chip[data-sla]").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-sla") === state.sla);
    });
    document.querySelectorAll(".sx-chip[data-filter-all]").forEach(function (btn) {
      btn.classList.toggle("is-active", state.status === "todos" && state.sla === "todos");
    });
    document.querySelectorAll(".sx-kpi").forEach(function (kpi) {
      var st = kpi.getAttribute("data-status-filter");
      var sla = kpi.getAttribute("data-sla-filter");
      var all = kpi.hasAttribute("data-filter-all");
      kpi.classList.toggle("is-active", Boolean((st && st === state.status) || (sla && sla === state.sla) || (all && state.status === "todos" && state.sla === "todos")));
    });
    syncStageOptions();
  }

  function bind() {
    document.querySelectorAll(".sx-period button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setFilter("period", Number(btn.getAttribute("data-period")));
      });
    });

    document.querySelectorAll(".sx-chip[data-status]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var v = btn.getAttribute("data-status");
        setFilter("status", state.status === v ? "todos" : v);
      });
    });

    document.querySelectorAll(".sx-chip[data-sla]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var v = btn.getAttribute("data-sla");
        setFilter("sla", state.sla === v ? "todos" : v);
      });
    });

    document.querySelectorAll(".sx-chip[data-filter-all]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.status = "todos";
        state.sla = "todos";
        syncUI();
        refresh();
      });
    });

    var stageFilter = document.getElementById("sx-stage-filter");
    var stageToggle = document.getElementById("sx-stage-toggle");
    var stageMenu = document.getElementById("sx-stage-menu");
    if (stageToggle && stageFilter) {
      stageToggle.addEventListener("click", function () {
        var open = !stageFilter.classList.contains("is-open");
        stageFilter.classList.toggle("is-open", open);
        stageToggle.setAttribute("aria-expanded", String(open));
      });
    }
    if (stageMenu) {
      stageMenu.addEventListener("click", function (event) {
        if (event.target.closest(".sx-stage-clear")) {
          state.stages = [];
          syncUI();
          refresh();
          return;
        }
        var option = event.target.closest(".sx-stage-option");
        if (!option) return;
        toggleStageFilter(STAGES[Number(option.getAttribute("data-stage-index"))]);
      });
    }
    document.addEventListener("click", function (event) {
      if (!stageFilter || stageFilter.contains(event.target)) return;
      stageFilter.classList.remove("is-open");
      if (stageToggle) stageToggle.setAttribute("aria-expanded", "false");
    });

    document.querySelectorAll(".sx-kpi[data-status-filter]").forEach(function (kpi) {
      kpi.addEventListener("click", function () {
        var v = kpi.getAttribute("data-status-filter");
        setFilter("status", state.status === v ? "todos" : v);
      });
    });

    document.querySelectorAll(".sx-kpi[data-sla-filter]").forEach(function (kpi) {
      kpi.addEventListener("click", function () {
        var v = kpi.getAttribute("data-sla-filter");
        setFilter("sla", state.sla === v ? "todos" : v);
      });
    });

    document.querySelectorAll(".sx-kpi[data-filter-all]").forEach(function (kpi) {
      kpi.addEventListener("click", function () {
        state.status = "todos";
        state.sla = "todos";
        syncUI();
        refresh();
      });
    });

    document.querySelectorAll(".sx-aging-card").forEach(function (card) {
      card.addEventListener("click", function () {
        var b = card.getAttribute("data-bucket");
        setFilter("aging", state.aging === b ? "todos" : b);
      });
    });

    var search = document.getElementById("sx-search");
    if (search) {
      var t;
      search.addEventListener("input", function () {
        clearTimeout(t);
        t = setTimeout(function () {
          setFilter("search", search.value);
        }, 220);
      });
    }

    var reset = document.getElementById("sx-reset");
    if (reset) {
      reset.addEventListener("click", function () {
        state.period = 0;
        state.status = "todos";
        state.sla = "todos";
        state.stages = [];
        state.selectedProcesses = [];
        state.aging = "todos";
        state.search = "";
        if (search) search.value = "";
        syncUI();
        refresh();
      });
    }

    document.querySelectorAll(".sx-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        var id = tab.getAttribute("data-tab");
        document.querySelectorAll(".sx-tab").forEach(function (t) { t.classList.remove("is-active"); });
        document.querySelectorAll(".sx-panel").forEach(function (p) { p.classList.remove("is-active"); });
        tab.classList.add("is-active");
        var panel = document.getElementById("panel-" + id);
        if (panel) panel.classList.add("is-active");
      });
    });

    document.querySelectorAll(".sx-table th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-sort");
        if (state.sortKey === key) state.sortDir *= -1;
        else {
          state.sortKey = key;
          state.sortDir = -1;
        }
        refresh();
      });
    });

    ["sx-table-body", "sx-table-body-fluxo", "sx-table-body-clone"].forEach(function (id) {
      var tbody = document.getElementById(id);
      if (!tbody) return;
      tbody.addEventListener("click", function (event) {
        var row = event.target.closest("tr[data-process-id]");
        if (row) toggleProcessFilter(row.getAttribute("data-process-id"));
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                               */
  /* ------------------------------------------------------------------ */
  function boot() {
    if (!document.getElementById("sx-cockpit")) return;
    renderStageOptions();
    bind();
    syncUI();
    if (typeof Chart !== "undefined") {
      refresh();
    } else {
      // Chart.js ainda carregando
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        if (typeof Chart !== "undefined" || tries > 40) {
          clearInterval(iv);
          refresh();
        }
      }, 100);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
