/*
 * app-shell.js
 * Núcleo reutilizável do "chrome" interno do portal (sidebar, topbar,
 * identidade do cliente/usuário, logout, menu mobile, navegação ativa).
 *
 * Mantém EXATAMENTE o mesmo contrato de sessão já validado:
 * - chaves de sessão: portalUsuario / portalAutenticado
 * - fallback de compatibilidade: localStorage "nome"
 * - redireciona para index.html quando não autenticado
 * - logout limpa as mesmas chaves e volta para index.html
 *
 * Usado por: dashboard.html, gr.html, gl.html, sinistros.html
 */
(function (window, document) {
  "use strict";

  var LOGOUT_KEYS = [
    "portalUsuario", "portalAutenticado", "usuarioLogado",
    "nome", "nomeUsuario", "userName", "usuarioNome",
    "foto", "fotoUsuario", "userPhoto", "imagem",
    "nomeCliente", "clienteNome", "cliente", "clientName",
    "logoCliente", "clienteLogo", "logoUrl", "clientLogo",
    "vertente", "perfil", "itensPortal", "itensProcessos"
  ];

  /*
   * Se o SharePoint/Power Automate devolver a logo como caminho relativo
   * (ex.: "/sites/Portal/SiteAssets/logo.png", sem o domínio), configure aqui
   * a URL base do seu tenant para que a imagem seja resolvida corretamente.
   * Deixe como "" se o campo logoCliente já vier sempre com endereço completo
   * (https://...). Pode também ser definida antes deste script via:
   *   <script>window.PORTAL_SHAREPOINT_ORIGIN = "https://suaempresa.sharepoint.com";</script>
   */
  var SHAREPOINT_ORIGIN = window.PORTAL_SHAREPOINT_ORIGIN || "";

  function resolveUrl(url) {
    if (!url) return "";
    url = String(url).trim();
    if (!url) return "";
    // já é absoluta (http://, https://, //cdn, data:, blob:)
    if (/^(https?:)?\/\//i.test(url) || /^(data|blob):/i.test(url)) return url;
    // caminho relativo ao site (ex.: /sites/Portal/SiteAssets/logo.png)
    if (url.charAt(0) === "/") {
      if (SHAREPOINT_ORIGIN) return SHAREPOINT_ORIGIN.replace(/\/$/, "") + url;
      console.warn(
        "[Portal] logoCliente veio como caminho relativo (\"" + url + "\") sem domínio. " +
        "Defina window.PORTAL_SHAREPOINT_ORIGIN com a URL do seu SharePoint para a logo carregar."
      );
      return "";
    }
    return url;
  }

  function plain(value) {
    if (!value) return "";
    if (Array.isArray(value)) return plain(value[0]);
    if (typeof value === "string") {
      try { return plain(JSON.parse(value)); } catch (_) { return value.trim(); }
    }
    if (typeof value === "object") {
      if (Array.isArray(value.results)) return plain(value.results[0]);
      return plain(
        value.Url || value.url || value.Value || value.value ||
        value.serverUrl || value.originalImageUrl || value.absoluteUrl ||
        value.serverRelativeUrl || value.ServerRelativeUrl ||
        value.link || value.href
      );
    }
    return "";
  }

  function logoUrl(value) {
    if (!value) return "";
    if (Array.isArray(value)) return logoUrl(value[0]);
    if (typeof value === "string") {
      try { return logoUrl(JSON.parse(value)); } catch (_) { return resolveUrl(value); }
    }
    if (typeof value === "object") {
      var host = value.serverUrl || value.ServerUrl || value.webUrl || value.WebUrl || "";
      var path = value.serverRelativeUrl || value.ServerRelativeUrl || value.relativeUrl || "";
      if (host && path) return String(host).replace(/\/$/, "") + (String(path).charAt(0) === "/" ? path : "/" + path);
      return logoUrl(value.originalImageUrl || value.absoluteUrl || value.Url || value.url || value.Value || value.value || value.link || value.href || path || host);
    }
    return "";
  }

  function readSessionData() {
    var user = {};
    try { user = JSON.parse(sessionStorage.getItem("portalUsuario") || "{}"); } catch (_) {}
    var authenticated = sessionStorage.getItem("portalAutenticado") === "true" || Boolean(localStorage.getItem("nome"));
    var response = user.body && typeof user.body === "object" ? user.body : {};
    // Compatibilidade para sessões que possam ter sido salvas com o envelope
    // original do Power Automate, inclusive body em formato de texto JSON.
    if (typeof user.body === "string") {
      try { response = JSON.parse(user.body); } catch (_) { response = {}; }
    }

    function first(keys) {
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var found = plain(user[key]) || plain(response[key]) || plain(localStorage.getItem(key)) || plain(sessionStorage.getItem(key));
        if (found) return found;
      }
      return "";
    }

    function firstLogo(keys) {
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var found = logoUrl(user[key]) || logoUrl(response[key]) || logoUrl(localStorage.getItem(key)) || logoUrl(sessionStorage.getItem(key));
        if (found) return found;
      }
      return "";
    }

    function normalizeVertente(value) {
      if (value && typeof value === "object") value = value.Value || value.value || "";
      return String(value || "").trim().toUpperCase();
    }

    return {
      authenticated: authenticated,
      name: first(["nome", "nomeUsuario", "userName", "usuarioNome"]) || user.login || "Usuário",
      client: first(["cliente", "nomeCliente", "clienteNome", "clientName"]) || "Cliente",
      clientLogo: firstLogo(["logoCliente", "LogoCliente", "clienteLogo", "logoUrl", "clientLogo", "logo", "Logo"]),
      photo: user.foto || localStorage.getItem("foto") || "",
      vertente: normalizeVertente(user.vertente || response.vertente || sessionStorage.getItem("vertente") || localStorage.getItem("vertente")),
      perfil: first(["perfil"]) || "",
      itensPortal: readPortalItems(
        user.itensPortal || response.itensPortal || user.conteudosPortal || response.conteudosPortal ||
        user.itens || response.itens || sessionStorage.getItem("itensPortal")
      ),
      itensProcessos: readProcessItems(
        user.itensProcessos || response.itensProcessos || sessionStorage.getItem("itensProcessos")
      )
    };
  }

  function readPortalItems(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try { return readPortalItems(JSON.parse(value)); } catch (_) { return []; }
    }
    if (value && typeof value === "object") {
      var keys = ["itensPortal", "conteudosPortal", "itens", "value", "results", "body"];
      for (var i = 0; i < keys.length; i++) {
        if (value[keys[i]] !== undefined) {
          var list = readPortalItems(value[keys[i]]);
          if (list.length) return list;
        }
      }
    }
    return [];
  }

  function readProcessItems(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try { return readProcessItems(JSON.parse(value)); } catch (_) { return []; }
    }
    if (value && typeof value === "object") {
      var keys = ["itensProcessos", "processos", "itemsProcessos", "value", "results", "body"];
      for (var i = 0; i < keys.length; i++) {
        if (value[keys[i]] !== undefined) {
          var list = readProcessItems(value[keys[i]]);
          if (list.length || Array.isArray(value[keys[i]])) return list;
        }
      }
    }
    return [];
  }

  function allowedModules(vertente) {
    if (vertente === "GR") return ["gr", "sinistros"];
    if (vertente === "GL") return ["gl"];
    if (vertente === "AMBOS") return ["gr", "gl", "sinistros"];
    return [];
  }

  function applyModuleAccess(data) {
    var allowed = allowedModules(data.vertente);
    var current = (window.location.pathname.split("/").pop() || "dashboard.html").toLowerCase();
    var currentModule = { "gr.html": "gr", "gl.html": "gl", "sinistros.html": "sinistros" }[current];

    if (currentModule && allowed.indexOf(currentModule) === -1) {
      window.location.replace("dashboard.html");
      return false;
    }

    document.querySelectorAll("[data-module]").forEach(function (element) {
      element.hidden = allowed.indexOf(element.getAttribute("data-module")) === -1;
    });
    return true;
  }

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (p) { return p.charAt(0); }).join("").toUpperCase() || "U";
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function fillLogo(boxId, url, altPrefix, label) {
    var box = document.getElementById(boxId);
    if (!box) return;
    var fallback = box.querySelector("span");
    var previousLogo = box.querySelector("img[data-client-logo]");
    if (previousLogo) previousLogo.remove();
    if (fallback) fallback.hidden = false;
    if (!url) {
      console.info("[Portal] logoCliente vazio para \"" + label + "\" — exibindo inicial no lugar da logo.");
      return;
    }
    var img = document.createElement("img");
    img.setAttribute("data-client-logo", "");
    img.src = url;
    img.alt = altPrefix + " " + label;
    img.onload = function () {
      if (fallback) fallback.hidden = true;
    };
    img.onerror = function () {
      console.warn(
        "[Portal] Falha ao carregar a logo do cliente em: " + url +
        " — verifique se o endereço é público/absoluto (sem exigir login do SharePoint) e se o CORS permite carregá-lo neste domínio. Exibindo inicial como fallback."
      );
      if (fallback) fallback.hidden = false;
      img.remove();
    };
    box.appendChild(img);
  }

  function populateIdentity(data) {
    setText("topbar-user-name", data.name);
    setText("client-name", data.client);
    setText("sidebar-client-name", data.client);
    document.title = document.title.replace(/\s*\|\s*.*$/, "") + " | " + data.client;

    var clientInitialChar = data.client.charAt(0).toUpperCase() || "C";
    setText("client-initial", clientInitialChar);
    setText("sidebar-client-initial", clientInitialChar);
    fillLogo("client-logo", data.clientLogo, "Logo", data.client);
    fillLogo("sidebar-client-logo", data.clientLogo, "Logo", data.client);

    var greeting = document.getElementById("greeting");
    if (greeting) {
      var hour = new Date().getHours();
      var saudacao = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
      greeting.textContent = saudacao + ", " + data.name.split(" ")[0] + ".";
    }

    var avatar = document.getElementById("topbar-user-avatar");
    if (avatar) {
      if (data.photo) {
        var img = document.createElement("img");
        img.src = data.photo;
        img.alt = "Foto de " + data.name;
        img.onerror = function () { avatar.innerHTML = "<span>" + initials(data.name) + "</span>"; };
        avatar.innerHTML = "";
        avatar.appendChild(img);
      } else {
        avatar.innerHTML = "<span>" + initials(data.name) + "</span>";
      }
    }
  }

  function bindLogout() {
    var btn = document.getElementById("logout-button");
    if (!btn) return;
    btn.addEventListener("click", function () {
      LOGOUT_KEYS.forEach(function (key) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      });
      window.location.assign("index.html");
    });
  }

  function markActiveNav() {
    var current = (window.location.pathname.split("/").pop() || "dashboard.html").toLowerCase();
    var links = document.querySelectorAll(".nav a");
    links.forEach(function (link) {
      var href = (link.getAttribute("href") || "").toLowerCase();
      if (href === current) {
        link.classList.add("active");
        link.setAttribute("aria-current", "page");
      } else {
        link.classList.remove("active");
        link.removeAttribute("aria-current");
      }
    });
  }

  function bindMobileMenu() {
    var toggle = document.getElementById("menu-toggle");
    var sidebar = document.querySelector(".sidebar");
    var overlay = document.getElementById("sidebar-overlay");
    if (!toggle || !sidebar) return;

    function close() {
      sidebar.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      if (overlay) overlay.hidden = true;
    }
    function open() {
      sidebar.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      if (overlay) overlay.hidden = false;
    }
    toggle.addEventListener("click", function () {
      sidebar.classList.contains("is-open") ? close() : open();
    });
    if (overlay) overlay.addEventListener("click", close);
    document.querySelectorAll(".nav a").forEach(function (link) {
      link.addEventListener("click", close);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") close();
    });
  }

  /**
   * Transições suaves entre páginas internas (dashboard ↔ gr ↔ gl ↔ sinistros).
   * Intercepta cliques em links internos, aplica animação de saída e navega.
   * Não afeta links externos, logout nem o fluxo de login.
   */
  function bindPageTransitions() {
    var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    var internalPages = ["dashboard.html", "gr.html", "gl.html", "sinistros.html"];
    var current = (window.location.pathname.split("/").pop() || "dashboard.html").toLowerCase();

    function isInternal(href) {
      if (!href) return false;
      var clean = href.split("?")[0].split("#")[0].toLowerCase();
      return internalPages.indexOf(clean) !== -1;
    }

    function navigateWithTransition(href) {
      if (document.documentElement.classList.contains("page-leaving")) return;
      document.documentElement.classList.add("page-leaving");
      window.setTimeout(function () {
        window.location.href = href;
      }, 300);
    }

    document.addEventListener("click", function (event) {
      var anchor = event.target.closest("a[href]");
      if (!anchor) return;
      var href = anchor.getAttribute("href");
      if (!isInternal(href)) return;
      var targetPage = href.split("?")[0].split("#")[0].toLowerCase();
      if (targetPage === current) {
        event.preventDefault();
        return;
      }
      // permite abrir em nova aba / modifier keys normalmente
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target === "_blank") return;
      event.preventDefault();
      navigateWithTransition(href);
    }, true);
  }

  function init(options) {
    options = options || {};
    applyExternalBrandAssets();
    var data = readSessionData();

    if (!data.authenticated) {
      window.location.replace("index.html");
      return null;
    }

    if (!applyModuleAccess(data)) return null;

    var rawUser = {};
    try { rawUser = JSON.parse(sessionStorage.getItem("portalUsuario") || "{}"); } catch (_) {}
    console.info(
      "[Portal] logoCliente bruto (retorno do Power Automate):", rawUser.logoCliente,
      "\n[Portal] logoCliente resolvido para uso em <img>:", data.clientLogo || "(vazio)"
    );

    populateIdentity(data);
    bindLogout();
    markActiveNav();
    bindMobileMenu();
    bindPageTransitions();

    document.documentElement.classList.add("session-ready");
    if (typeof options.onReady === "function") options.onReady(data);
    return data;
  }

  function applyExternalBrandAssets() {
    var base = "https://repositorio-apisul.github.io/mondelez/";
    document.querySelectorAll('img[src$="logo-apisul-branca.png"]').forEach(function (image) {
      image.src = base + "logo-apisul-branca.png";
    });
    document.querySelectorAll('img[src$="logo-piscina-branca.png"]').forEach(function (image) {
      image.src = base + "logo-piscina-branca.png";
    });
    document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach(function (icon) {
      icon.href = base + "icone-apisul.png";
    });
  }

  window.PortalShell = {
    init: init,
    readSessionData: readSessionData,
    allowedModules: allowedModules,
    getPortalItems: function () { return readSessionData().itensPortal; },
    getProcessItems: function () { return readSessionData().itensProcessos; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (!document.body.hasAttribute("data-shell-manual")) init();
    }, { once: true });
  } else if (!document.body.hasAttribute("data-shell-manual")) {
    init();
  }
})(window, document);
