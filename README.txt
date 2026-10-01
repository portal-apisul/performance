PORTAL DE SINISTROS APISUL — EXTRAÇÃO

Estrutura:
- index.html: página de login
- dashboard.html: página interna/dashboard
- assets/: CSS, JavaScript, imagem da marca e fontes
- favicon.svg: ícone do site

Como testar:
1. Abra esta pasta em um servidor local.
2. Exemplo com Python:
   python -m http.server 8000
3. Acesse:
   http://localhost:8000/index.html

Depois de uma autenticação válida, o login direciona para dashboard.html.
O fluxo de autenticação continua conectado ao endpoint original do Power Automate.

Observação:
Evite abrir os HTMLs diretamente pelo protocolo file://. Use um servidor local
ou publique a pasta em uma hospedagem estática para que os módulos JavaScript
sejam carregados corretamente.
PORTAL DE GESTÃO & PERFORMANCE — PACOTE HTML

Versão 2.2: imagens institucionais carregadas por links externos para reduzir o tamanho do pacote.

Páginas incluídas: index.html, dashboard.html, gr.html, gl.html e sinistros.html.
O dashboard lê o nome e a logo do cliente devolvidos pelo Power Automate nos campos
cliente e logoCliente. A logo aceita URL direta ou os formatos de imagem/hiperlink
usuais do SharePoint; se não puder ser carregada, a inicial do cliente é exibida.
