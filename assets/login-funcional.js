(function () {
  "use strict";
  const FLOW_URL =
    "https://default93fd837dc6f34dc8b1aae9f5e490df.d6.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/19/workflows/149b56bd99964e609a77a815ef9c43aa/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=L5V9-BfNTcfNKoNNgpXU4pZUkfTIQh_D42MHhF5ZA2Q";

  function unwrapResponse(result) {
    var current = result || {};
    // A ação "Resposta" do Power Automate pode chegar como { statusCode, body }
    // e o próprio body pode ser um objeto ou uma string JSON. Desembrulhamos
    // somente envelopes de transporte, preservando os dados oficiais do portal.
    for (var depth = 0; depth < 4; depth++) {
      if (typeof current === "string") {
        try { current = JSON.parse(current); } catch (_) { break; }
      }
      if (!current || typeof current !== "object" || Array.isArray(current)) break;
      if (current.body !== undefined &&
          (current.statusCode !== undefined || current.headers !== undefined || current.body.itensPortal !== undefined)) {
        current = current.body;
        continue;
      }
      break;
    }
    return current && typeof current === "object" && !Array.isArray(current) ? current : result || {};
  }

  function normalizeVertente(value) {
    return String(value || "").trim().toUpperCase();
  }

  function firstValue(source, keys) {
    for (var i = 0; i < keys.length; i++) {
      var value = source && source[keys[i]];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return "";
  }

  /*
   * O Power Automate pode devolver itensPortal de três formas equivalentes:
   * uma lista, texto JSON ou um objeto que contém a lista em value/body.
   * Normalizamos aqui, no momento do login, para que os dados nunca se
   * percam antes de serem gravados na sessão.
   */
  function portalItems(source) {
    if (Array.isArray(source)) return source;
    if (typeof source === "string") {
      try { return portalItems(JSON.parse(source)); } catch (_) { return []; }
    }
    if (source && typeof source === "object") {
      var keys = ["itensPortal", "conteudosPortal", "itens", "value", "results", "body"];
      for (var i = 0; i < keys.length; i++) {
        if (source[keys[i]] !== undefined) {
          var list = portalItems(source[keys[i]]);
          if (list.length) return list;
        }
      }
    }
    return [];
  }

  function processItems(source) {
    if (Array.isArray(source)) return source;
    if (typeof source === "string") {
      try { return processItems(JSON.parse(source)); } catch (_) { return []; }
    }
    if (source && typeof source === "object") {
      var keys = ["itensProcessos", "processos", "itemsProcessos", "value", "results", "body"];
      for (var i = 0; i < keys.length; i++) {
        if (source[keys[i]] !== undefined) {
          var list = processItems(source[keys[i]]);
          if (list.length || Array.isArray(source[keys[i]])) return list;
        }
      }
    }
    return [];
  }

  function initializeLogin() {
    applyExternalBrandAssets();
    const form = document.getElementById("login-form");
    const loginField = document.getElementById("login");
    const passwordField = document.getElementById("password");
    const submitButton = form && form.querySelector(".submit-button");
    const eyeButton = form && form.querySelector(".eye-button");
    const rememberField = form && form.querySelector('input[name="remember"]');
    if (!form || !loginField || !passwordField || !submitButton) return;

    function showMessage(text, type) {
      let node = form.querySelector(".message");
      if (!node) {
        node = document.createElement("p");
        form.appendChild(node);
      }
      node.className = "message " + type;
      node.setAttribute("role", type === "error" ? "alert" : "status");
      node.textContent = text;
    }

    function setLoading(active) {
      loginField.disabled = active;
      passwordField.disabled = active;
      submitButton.disabled = active;
      submitButton.innerHTML = active
        ? "<span>VALIDANDO...</span>"
        : '<span>ENTRAR</span><span aria-hidden="true">→</span>';
    }

    form.addEventListener(
      "submit",
      async function (event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const login = loginField.value.trim();
        const senha = passwordField.value.trim();

        if (!login || !senha) {
          showMessage(
            !login && !senha
              ? "Informe seu usuário e sua senha."
              : !login
                ? "Informe seu usuário."
                : "Informe sua senha.",
            "error",
          );
          return;
        }

        setLoading(true);
        try {
          const response = await fetch(FLOW_URL, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ login: login, senha: senha }),
          });
          const rawResponse = await response.text();
          let result = {};
          if (rawResponse) {
            try {
              result = JSON.parse(rawResponse);
            } catch (_) {
              throw new Error("O fluxo retornou uma resposta inválida.");
            }
          }

          const payload = unwrapResponse(result);

          const success =
            response.ok &&
            (payload.sucesso === true ||
              String(payload.sucesso).toLowerCase() === "true" ||
              String(result.statusCode) === "200");
          if (!success) {
            showMessage(
              payload.mensagem || result.mensagem ||
                (response.ok
                  ? "Usuário ou senha inválidos."
                  : "Não foi possível validar o acesso."),
              "error",
            );
            return;
          }

          // A lista é salva tanto dentro do usuário quanto em uma chave própria.
          // Isso mantém a sessão compatível com todas as páginas internas.
          const items = portalItems(payload) || portalItems(result);
          const processos = processItems(payload.itensProcessos !== undefined ? payload.itensProcessos : result.itensProcessos);
          const user = {
            login: login,
            nome: payload.nome || result.nome || login,
            foto: payload.foto || result.foto || "",
            cliente: payload.cliente || result.cliente || "",
            logoCliente: firstValue(payload, ["logoCliente", "LogoCliente", "clienteLogo", "logoUrl", "clientLogo", "logo", "Logo"]) || firstValue(result, ["logoCliente", "LogoCliente", "clienteLogo", "logoUrl", "clientLogo", "logo", "Logo"]),
            vertente: normalizeVertente(payload.vertente || result.vertente),
            perfil: payload.perfil || result.perfil || "",
            itensPortal: items,
            itensProcessos: processos,
          };
          sessionStorage.setItem("portalAutenticado", "true");
          sessionStorage.setItem("portalUsuario", JSON.stringify(user));
          sessionStorage.setItem("usuarioLogado", JSON.stringify(user));
          // Mantém uma cópia direta para compatibilidade com todas as páginas
          // internas, além do objeto oficial portalUsuario.
          sessionStorage.setItem("itensPortal", JSON.stringify(items));
          sessionStorage.setItem("itensProcessos", JSON.stringify(processos));

          if (rememberField && rememberField.checked) {
            localStorage.setItem("portalLoginLembrado", login);
          } else {
            localStorage.removeItem("portalLoginLembrado");
          }

          showMessage(payload.mensagem || result.mensagem || "Acesso autorizado.", "success");
          window.setTimeout(function () {
            window.location.href = "dashboard.html";
          }, 650);
        } catch (error) {
          console.error(error);
          showMessage(
            "Erro de comunicação com o Power Automate. Verifique a conexão e a permissão CORS do fluxo.",
            "error",
          );
        } finally {
          setLoading(false);
        }
      },
      true,
    );

    if (eyeButton) {
      eyeButton.addEventListener(
        "click",
        function (event) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const isVisible = passwordField.type === "text";
          passwordField.type = isVisible ? "password" : "text";
          eyeButton.setAttribute("aria-pressed", String(!isVisible));
          eyeButton.setAttribute(
            "aria-label",
            isVisible ? "Mostrar senha" : "Ocultar senha",
          );
        },
        true,
      );
    }

    const savedLogin = localStorage.getItem("portalLoginLembrado");
    if (savedLogin) {
      loginField.value = savedLogin;
      if (rememberField) rememberField.checked = true;
    }
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeLogin, { once: true });
  } else {
    initializeLogin();
  }
})();
