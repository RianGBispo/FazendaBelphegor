/* ============================================================
   Fazenda Belphegor — painel estático (GitHub Pages)
   Lê os dados direto da planilha pública do Google Sheets.
   ============================================================ */

const CONFIG = {
  // ID da planilha (parte da URL entre /d/ e /edit)
  SHEET_ID: "1Yuynmq_CdNlkdhZIr0AcJuuoyXLPtIGUugxI1oUB7UM",
  // Nome exato da aba
  SHEET_NAME: "Registros",
  // Nome exibido na barra lateral
  SHEET_LABEL: "Planilha Belphegor",
  // Quantos membros aparecem no ranking
  RANKING_SIZE: 20,
  // Recarrega sozinho a cada X ms (0 desliga)
  AUTO_REFRESH_MS: 5 * 60 * 1000,
};

/* ---------------- helpers ---------------- */

const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const money = (n) => "$ " + Math.round(n || 0).toLocaleString("pt-BR");
const num = (n) => (n || 0).toLocaleString("pt-BR");
const pad2 = (n) => String(n).padStart(2, "0");

/** Converte texto/numero da planilha em number, tolerando "1.234,56", "R$ 1,234.56", "4200". */
function toNum(raw) {
  if (raw === null || raw === undefined || raw === "") return 0;
  if (typeof raw === "number") return raw;
  let s = String(raw).replace(/[^\d,.-]/g, "");
  if (!s) return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // o separador que aparece por último é o decimal
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // só vírgula: separador de milhar se o número inteiro seguir o padrão 1,234,567
    s = /^-?\d{1,3}(,\d{3})+$/.test(s)
      ? s.replace(/,/g, "")
      : s.replace(",", ".");
  } else if (lastDot > -1) {
    // só ponto: separador de milhar se seguir o padrão 1.234.567
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Converte "35%", 0.35 ou 35 em fração 0.35. */
function toPct(raw) {
  if (raw === null || raw === undefined || raw === "") return 0;
  if (typeof raw === "number") return raw > 1 ? raw / 100 : raw;
  const hasSign = String(raw).includes("%");
  const n = toNum(raw);
  if (hasSign) return n / 100;
  return n > 1 ? n / 100 : n;
}

const TRUES = [
  "true",
  "sim",
  "s",
  "yes",
  "y",
  "pago",
  "x",
  "1",
  "✔",
  "✓",
  "✅",
  "ok",
];
function toBool(raw) {
  if (typeof raw === "boolean") return raw;
  if (raw === null || raw === undefined) return false;
  return TRUES.includes(String(raw).trim().toLowerCase());
}

/** gviz devolve datas como "Date(2026,7,14)". Também aceita "14/08/2026" e ISO. */
function toDate(raw) {
  if (raw === null || raw === undefined || raw === "")
    return { label: "—", ts: 0 };
  if (raw instanceof Date) return { label: fmtDate(raw), ts: raw.getTime() };
  const s = String(raw).trim();
  let m = s.match(/^Date\((\d+),(\d+),(\d+)/);
  if (m) {
    const d = new Date(+m[1], +m[2], +m[3]);
    return { label: fmtDate(d), ts: d.getTime() };
  }
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const d = new Date(year, +m[2] - 1, +m[1]);
    return { label: fmtDate(d), ts: d.getTime() };
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return { label: fmtDate(d), ts: d.getTime() };
  }
  return { label: s, ts: 0 };
}

const fmtDate = (d) =>
  pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear();

/* ---------------- leitura da planilha ---------------- */

const COLUMNS = {
  discordId: ["discord id", "discordid", "id"],
  nome: ["nome", "membro"],
  tipo: ["tipo", "item", "produto"],
  quantidade: ["quantidade", "qtd", "qtde"],
  total: ["total", "valor total", "valor"],
  data: ["data"],
  aprovadoPor: ["aprovado por", "aprovadopor", "aprovador"],
  pago: ["pago", "status"],
  cargo: ["cargo", "funcao", "função"],
  pagamento: ["pagamento", "a receber", "comissao", "comissão"],
  pct: ["% do cargo", "porcentagem", "percentual", "%"],
};

const normalizeLabel = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

function mapColumns(cols) {
  const map = {};
  const labels = cols.map(
    (c, i) => normalizeLabel(c.label) || String.fromCharCode(65 + i),
  );
  for (const [key, aliases] of Object.entries(COLUMNS)) {
    const wanted = aliases.map(normalizeLabel);
    let idx = labels.findIndex((l) => wanted.includes(l));
    if (idx === -1)
      idx = labels.findIndex((l) => wanted.some((w) => l.startsWith(w)));
    map[key] = idx;
  }
  // fallback posicional (ordem A:K da planilha) para colunas não encontradas
  const order = [
    "discordId",
    "nome",
    "tipo",
    "quantidade",
    "total",
    "data",
    "aprovadoPor",
    "pago",
    "cargo",
    "pagamento",
    "pct",
  ];
  order.forEach((key, i) => {
    if (map[key] === -1 && cols[i]) map[key] = i;
  });
  return map;
}

async function fetchSheet() {
  const url =
    "https://docs.google.com/spreadsheets/d/" +
    CONFIG.SHEET_ID +
    "/gviz/tq?tqx=out:json&headers=1&sheet=" +
    encodeURIComponent(CONFIG.SHEET_NAME) +
    "&_=" +
    Date.now();

  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status + " ao ler a planilha");

  const text = await res.text();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1)
    throw new Error("Resposta inesperada do Google Sheets");

  const payload = JSON.parse(text.slice(start, end + 1));
  if (payload.status === "error") {
    const msg = (payload.errors || [])
      .map((e) => e.detailed_message || e.message)
      .join(" ");
    throw new Error(msg || "A planilha recusou a consulta");
  }

  const table = payload.table || { cols: [], rows: [] };
  const map = mapColumns(table.cols || []);
  const cell = (row, key) => {
    const i = map[key];
    if (i === undefined || i < 0) return null;
    const c = (row.c || [])[i];
    if (!c) return null;
    return c.v !== null && c.v !== undefined ? c.v : (c.f ?? null);
  };

  const records = (table.rows || [])
    .map((row, i) => {
      const nome = String(cell(row, "nome") ?? "").trim();
      const total = toNum(cell(row, "total"));
      const pct = toPct(cell(row, "pct"));
      const rawPag = cell(row, "pagamento");
      const pagamento =
        rawPag === null || rawPag === "" ? total * pct : toNum(rawPag);
      const d = toDate(cell(row, "data"));
      return {
        key: i,
        discordId: String(cell(row, "discordId") ?? "").trim(),
        nome,
        tipo: String(cell(row, "tipo") ?? "").trim() || "—",
        qtd: toNum(cell(row, "quantidade")),
        total,
        data: d.label,
        ts: d.ts,
        aprovadoPor: String(cell(row, "aprovadoPor") ?? "").trim() || "—",
        pago: toBool(cell(row, "pago")),
        cargo: String(cell(row, "cargo") ?? "").trim() || "—",
        pagamento,
        pct,
      };
    })
    .filter((r) => r.nome || r.discordId);

  // sem Discord ID a agregação usa o nome como chave
  records.forEach((r) => {
    if (!r.discordId) r.discordId = "nome:" + r.nome.toLowerCase();
  });
  return records;
}

/* ---------------- dados de demonstração (?demo=1) ---------------- */

function demoRecords() {
  const PRECO = {
    Trigo: 120,
    Milho: 95,
    Leite: 210,
    Ovos: 65,
    Uva: 180,
    Lã: 150,
  };
  const CARGOS = {
    Líder: 0.35,
    "Vice-Líder": 0.3,
    Gerente: 0.25,
    Farmeiro: 0.15,
    Novato: 0.1,
  };
  const MEMBROS = {
    "Kaio Belmont": ["284915027384930001", "Líder"],
    "Nina Vargas": ["371028475610293002", "Vice-Líder"],
    "Rafa Duarte": ["419283746501928003", "Gerente"],
    "Ester Villar": ["847362910384756007", "Gerente"],
    "Tom Okada": ["528374619203847004", "Farmeiro"],
    "Lia Moreno": ["610293847561029005", "Farmeiro"],
    "Bruno Sato": ["738291046573829006", "Novato"],
    "Caio Ferraz": ["956102837465019008", "Novato"],
  };
  const RAW = [
    ["Kaio Belmont", "Trigo", 4200, "14/08/2026", "Ester Villar", true],
    ["Kaio Belmont", "Leite", 1100, "15/08/2026", "Rafa Duarte", false],
    ["Nina Vargas", "Milho", 3800, "13/08/2026", "Kaio Belmont", true],
    ["Nina Vargas", "Uva", 900, "15/08/2026", "Kaio Belmont", false],
    ["Nina Vargas", "Ovos", 3000, "16/08/2026", "Rafa Duarte", false],
    ["Rafa Duarte", "Trigo", 2600, "12/08/2026", "Nina Vargas", true],
    ["Ester Villar", "Uva", 1600, "10/08/2026", "Kaio Belmont", true],
    ["Ester Villar", "Lã", 1250, "15/08/2026", "Kaio Belmont", false],
    ["Tom Okada", "Ovos", 5400, "14/08/2026", "Rafa Duarte", true],
    ["Tom Okada", "Lã", 700, "16/08/2026", "Ester Villar", false],
    ["Lia Moreno", "Leite", 1500, "11/08/2026", "Nina Vargas", true],
    ["Lia Moreno", "Trigo", 1200, "16/08/2026", "Rafa Duarte", false],
    ["Bruno Sato", "Milho", 1900, "13/08/2026", "Ester Villar", true],
    ["Bruno Sato", "Ovos", 2200, "16/08/2026", "Rafa Duarte", false],
    ["Caio Ferraz", "Trigo", 800, "14/08/2026", "Nina Vargas", true],
    ["Caio Ferraz", "Milho", 640, "16/08/2026", "Ester Villar", false],
  ];
  return RAW.map((r, i) => {
    const [id, cargo] = MEMBROS[r[0]];
    const pct = CARGOS[cargo];
    const total = r[2] * PRECO[r[1]];
    const d = toDate(r[3]);
    return {
      key: i,
      discordId: id,
      nome: r[0],
      tipo: r[1],
      qtd: r[2],
      total,
      data: d.label,
      ts: d.ts,
      aprovadoPor: r[4],
      pago: r[5],
      cargo,
      pagamento: total * pct,
      pct,
    };
  });
}

/* ---------------- estado ---------------- */

const state = {
  records: [],
  loading: true,
  error: null,
  view: "dash",
  membroId: null,
  tipo: "Todos os tipos",
  status: "Todos",
  busca: "",
};

const $view = document.getElementById("view");
const $status = document.getElementById("statusBar");

function aggregates() {
  const byId = {};
  for (const r of state.records) {
    const a =
      byId[r.discordId] ||
      (byId[r.discordId] = {
        nome: r.nome,
        discordId: r.discordId,
        cargo: r.cargo,
        pct: r.pct,
        total: 0,
        qtd: 0,
        pagamento: 0,
        pago: 0,
        pendente: 0,
        count: 0,
      });
    a.total += r.total;
    a.qtd += r.qtd;
    a.pagamento += r.pagamento;
    a.count += 1;
    if (r.pago) a.pago += r.pagamento;
    else a.pendente += r.pagamento;
    if (r.pct) a.pct = r.pct;
    if (r.cargo && r.cargo !== "—") a.cargo = r.cargo;
  }
  return Object.values(byId).sort((a, b) => b.total - a.total);
}

const tipos = () =>
  [...new Set(state.records.map((r) => r.tipo))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );

function filteredRecords() {
  const q = state.busca.trim().toLowerCase();
  return state.records.filter(
    (r) =>
      (state.tipo === "Todos os tipos" || r.tipo === state.tipo) &&
      (state.status === "Todos" || (state.status === "Pago") === r.pago) &&
      (!q || r.nome.toLowerCase().includes(q) || r.discordId.includes(q)),
  );
}

/* ---------------- navegação ---------------- */

const TABS = [
  ["dash", "Visão geral"],
  ["registros", "Registros"],
  ["ranking", "Ranking"],
  ["membro", "Membro"],
];

const TITLES = {
  dash: ["Painel", "Visão geral da fazenda"],
  registros: ["Planilha", "Registros de farm"],
  ranking: ["Desempenho", "Ranking geral"],
  membro: ["Perfil", "Página do membro"],
};

function renderNav() {
  document.getElementById("nav").innerHTML = TABS.map(
    ([id, label]) =>
      `<button data-tab="${id}" class="${state.view === id ? "on" : ""}">
       <span class="dot"></span><span>${label}</span>
     </button>`,
  ).join("");
}

function goto(view, membroId) {
  const hash =
    view === "membro" && membroId
      ? `#/membro/${encodeURIComponent(membroId)}`
      : `#/${view}`;
  if (location.hash === hash) applyRoute();
  else location.hash = hash;
}

function applyRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const view = TABS.some(([id]) => id === parts[0]) ? parts[0] : "dash";
  state.view = view;
  if (view === "membro" && parts[1])
    state.membroId = decodeURIComponent(parts[1]);
  render();
}

/* ---------------- render ---------------- */

function render() {
  renderNav();
  document.getElementById("pageKicker").textContent = TITLES[state.view][0];
  document.getElementById("pageTitle").textContent = TITLES[state.view][1];

  if (state.loading) {
    $view.dataset.view = "loading";
    $view.innerHTML = skeleton();
    return;
  }
  if (state.error) {
    $view.dataset.view = "error";
    $view.innerHTML = "";
    return;
  }
  if (!state.records.length) {
    $view.dataset.view = "empty";
    $view.innerHTML = emptyState();
    return;
  }

  if (state.view === "registros" && $view.dataset.view === "registros") {
    updateRegistros();
    return;
  }

  $view.dataset.view = state.view;
  if (state.view === "dash") $view.innerHTML = viewDash();
  else if (state.view === "registros") {
    $view.innerHTML = viewRegistros();
    updateRegistros();
  } else if (state.view === "ranking") $view.innerHTML = viewRanking();
  else $view.innerHTML = viewMembro();
}

const skeleton =
  () => `<div class="grid-kpi">${'<div class="skeleton"></div>'.repeat(4)}</div>
  <div class="grid-2" style="margin-top:18px">
    <div class="skeleton" style="height:320px"></div><div class="skeleton" style="height:320px"></div>
  </div>`;

const emptyState = () => `<div class="empty">
    <h2>Nenhum registro ainda</h2>
    <p>A aba <strong>${esc(CONFIG.SHEET_NAME)}</strong> da planilha está sem linhas de dados.
       Adicione registros a partir da linha 2 e clique em <strong>Atualizar</strong>.
       Para ver o layout com dados de exemplo, abra o site com <code>?demo=1</code> no final da URL.</p>
  </div>`;

/* ---- visão geral ---- */

function viewDash() {
  const recs = state.records;
  const list = aggregates();
  const totalGeral = recs.reduce((s, r) => s + r.total, 0);
  const pagoGeral = recs
    .filter((r) => r.pago)
    .reduce((s, r) => s + r.pagamento, 0);
  const pendenteGeral = recs
    .filter((r) => !r.pago)
    .reduce((s, r) => s + r.pagamento, 0);
  const t = list[0];

  const kpis = [
    [
      "Total farmado",
      money(totalGeral),
      recs.length + " registros na planilha",
    ],
    ["Já pago", money(pagoGeral), "confirmado pela gerência"],
    [
      "A pagar",
      money(pendenteGeral),
      recs.filter((r) => !r.pago).length + " registros pendentes",
    ],
    ["Membros ativos", String(list.length), "com registro no período"],
  ];

  const pendentes = list
    .filter((m) => m.pendente > 0)
    .sort((a, b) => b.pendente - a.pendente);
  const recentes = recs
    .slice()
    .sort((a, b) => b.ts - a.ts || b.key - a.key)
    .slice(0, 6);
  const chasers = list.slice(1, 5);

  return `<section class="section">
    <div class="grid-kpi">
      ${kpis
        .map(
          ([l, v, n]) => `<div class="kpi">
          <div class="kpi-label">${esc(l)}</div>
          <div class="kpi-value">${esc(v)}</div>
          <div class="kpi-note">${esc(n)}</div>
        </div>`,
        )
        .join("")}
    </div>

    <div class="grid-2">
      <div class="top1">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span class="tag">Top 1 Farm</span>
          <span class="tag-muted">por valor total</span>
        </div>
        <div class="top1-head">
          <div class="top1-rank">01</div>
          <div style="display:flex;flex-direction:column;gap:8px;padding-top:6px">
            <div class="top1-name">${esc(t.nome)}</div>
            <div class="top1-meta">${esc(t.cargo)} · ${Math.round(t.pct * 100)}% do cargo · ID ${esc(t.discordId)}</div>
          </div>
        </div>
        <div class="top1-stats">
          <div class="stat"><div class="stat-label">Total farmado</div><div class="stat-value">${money(t.total)}</div></div>
          <div class="stat"><div class="stat-label">Vai receber</div><div class="stat-value pay">${money(t.pagamento)}</div></div>
          <div class="stat"><div class="stat-label">Quantidade</div><div class="stat-value">${num(t.qtd)} un.</div></div>
        </div>
        <button class="btn-primary" data-membro="${esc(t.discordId)}">Ver página do membro</button>
      </div>

      <div class="card">
        <div class="card-title">Funcionários</div>
        <div class="chasers">
          ${
            chasers.length
              ? chasers
                  .map(
                    (
                      m,
                      i,
                    ) => `<button class="chaser" data-membro="${esc(m.discordId)}">
              <span class="chaser-rank">${pad2(i + 2)}</span>
              <span style="display:flex;flex-direction:column;gap:2px">
                <span class="chaser-name">${esc(m.nome)}</span>
                <span class="chaser-role">${esc(m.cargo)}</span>
              </span>
              <span class="chaser-total">${money(m.total)}</span>
            </button>`,
                  )
                  .join("")
              : '<div class="muted" style="padding:12px 0">Sem outros membros com registro.</div>'
          }
        </div>
      </div>
    </div>

    <div class="grid-2-sm">
      <div class="card">
        <div class="card-title">Pagamentos pendentes</div>
        <div class="list">
          ${
            pendentes.length
              ? pendentes
                  .map(
                    (m) => `<div class="row-line row-pend">
              <span class="name-cell">${esc(m.nome)}</span>
              <span class="muted">${state.records.filter((r) => r.discordId === m.discordId && !r.pago).length} reg.</span>
              <span class="val-pay">${money(m.pendente)}</span>
            </div>`,
                  )
                  .join("")
              : '<div class="muted" style="padding:12px 0">Tudo pago. 🎉</div>'
          }
        </div>
      </div>

      <div class="card">
        <div class="card-title">Últimos registros</div>
        <div class="list">
          ${recentes
            .map(
              (r) => `<div class="row-line row-rec">
              <span class="muted">${esc(r.data)}</span>
              <span class="name-cell">${esc(r.nome)}</span>
              <span class="muted-2">${esc(r.tipo)}</span>
              <span class="val-total">${money(r.total)}</span>
            </div>`,
            )
            .join("")}
        </div>
      </div>
    </div>
  </section>`;
}

/* ---- registros ---- */

function viewRegistros() {
  const opcoes = ["Todos os tipos", ...tipos()];
  return `<section>
    <div class="filters">
      <div class="count-label" id="regCount"></div>
      <div class="filters-right">
        <input class="input" id="busca" placeholder="Buscar nome ou ID" value="${esc(state.busca)}">
        <select class="select" id="tipoSel">
          ${opcoes.map((t) => `<option value="${esc(t)}"${t === state.tipo ? " selected" : ""}>${esc(t)}</option>`).join("")}
        </select>
        <div class="segment" id="statusSeg">
          ${["Todos", "Pago", "Pendente"]
            .map(
              (s) =>
                `<button data-status="${s}" class="${state.status === s ? "on" : ""}">${s}</button>`,
            )
            .join("")}
        </div>
      </div>
    </div>

    <div class="table-wrap">
      <table class="t-registros">
        <thead><tr>
          <th>Discord ID</th><th>Nome</th><th>Tipo</th><th class="r">Quantidade</th>
          <th class="r">Total</th><th>Data</th><th>Aprovado por</th><th>Pago</th>
          <th>Cargo</th><th class="r">Pagamento</th><th class="r">% do cargo</th>
        </tr></thead>
        <tbody id="regBody"></tbody>
      </table>
    </div>
    <div class="totals" id="regTotals"></div>
  </section>`;
}

function updateRegistros() {
  const rows = filteredRecords();

  document.getElementById("regBody").innerHTML = rows.length
    ? rows
        .map(
          (r) => `<tr>
      <td class="id">${esc(r.discordId.startsWith("nome:") ? "—" : r.discordId)}</td>
      <td class="nowrap"><button class="link-name" data-membro="${esc(r.discordId)}">${esc(r.nome)}</button></td>
      <td>${esc(r.tipo)}</td>
      <td class="r num">${num(r.qtd)}</td>
      <td class="r num strong">${money(r.total)}</td>
      <td class="dim">${esc(r.data)}</td>
      <td class="dim">${esc(r.aprovadoPor)}</td>
      <td><span class="badge${r.pago ? " paid" : ""}">${r.pago ? "Pago" : "Pendente"}</span></td>
      <td class="nowrap" style="font-size:13px">${esc(r.cargo)}</td>
      <td class="r pay">${money(r.pagamento)}</td>
      <td class="r dim">${Math.round(r.pct * 100)}%</td>
    </tr>`,
        )
        .join("")
    : `<tr><td colspan="11" class="dim" style="padding:34px 0;text-align:center">Nenhum registro com esses filtros.</td></tr>`;

  document.getElementById("regCount").textContent =
    rows.length + " de " + state.records.length + " registros";

  document.getElementById("regTotals").innerHTML =
    `<span>Soma filtrada <strong>${money(rows.reduce((s, r) => s + r.total, 0))}</strong></span>
     <span class="pay">Pagamentos <strong>${money(rows.reduce((s, r) => s + r.pagamento, 0))}</strong></span>`;
}

/* ---- ranking ---- */

function viewRanking() {
  const list = aggregates().slice(0, CONFIG.RANKING_SIZE);
  const max = list[0].total || 1;
  return `<section class="ranking">
    ${list
      .map(
        (
          m,
          i,
        ) => `<button class="rank-card${i === 0 ? " first" : ""}" data-membro="${esc(m.discordId)}">
        <span class="rank-num">${pad2(i + 1)}</span>
        <span style="display:flex;flex-direction:column;gap:5px">
          <span class="rank-name">${esc(m.nome)}</span>
          <span class="rank-meta">${esc(m.cargo)} · ${Math.round(m.pct * 100)}% · ${m.count} registros</span>
        </span>
        <span class="bar"><span style="width:${Math.max(4, (m.total / max) * 100)}%"></span></span>
        <span class="rank-vals">
          <span class="rank-total">${money(m.total)}</span>
          <span class="rank-pay">recebe ${money(m.pagamento)}</span>
        </span>
      </button>`,
      )
      .join("")}
  </section>`;
}

/* ---- membro ---- */

function viewMembro() {
  const list = aggregates();
  const m = list.find((x) => x.discordId === state.membroId) || list[0];
  state.membroId = m.discordId;

  const rows = state.records
    .filter((r) => r.discordId === m.discordId)
    .sort((a, b) => b.ts - a.ts || b.key - a.key);

  const kpis = [
    ["Total farmado", money(m.total)],
    ["Vai receber", money(m.pagamento)],
    ["Já pago", money(m.pago)],
    ["A receber", money(m.pendente)],
  ];

  return `<section class="section">
    <div class="chips">
      ${list.map((x) => `<button class="chip${x.discordId === m.discordId ? " on" : ""}" data-membro="${esc(x.discordId)}">${esc(x.nome)}</button>`).join("")}
    </div>

    <div class="member-hero">
      <div class="member-hero-top">
        <div>
          <div class="member-name">${esc(m.nome)}</div>
          <div class="member-meta">${esc(m.cargo)} · ${Math.round(m.pct * 100)}% do cargo · ID ${esc(m.discordId.startsWith("nome:") ? "—" : m.discordId)}</div>
        </div>
        <span class="member-pos">#${pad2(list.indexOf(m) + 1)} no ranking</span>
      </div>
      <div class="member-kpis">
        ${kpis
          .map(
            ([l, v]) => `<div class="member-kpi">
            <div class="kpi-label">${esc(l)}</div>
            <div class="kpi-value">${esc(v)}</div>
          </div>`,
          )
          .join("")}
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Data</th><th>Tipo</th><th class="r">Quantidade</th><th class="r">Total</th>
          <th>Aprovado por</th><th>Pago</th><th class="r">Pagamento</th>
        </tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>
            <td class="dim">${esc(r.data)}</td>
            <td style="font-weight:600">${esc(r.tipo)}</td>
            <td class="r num">${num(r.qtd)}</td>
            <td class="r num strong">${money(r.total)}</td>
            <td class="dim">${esc(r.aprovadoPor)}</td>
            <td><span class="badge${r.pago ? " paid" : ""}">${r.pago ? "Pago" : "Pendente"}</span></td>
            <td class="r pay">${money(r.pagamento)}</td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  </section>`;
}

/* ---------------- eventos ---------------- */

document.getElementById("nav").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab]");
  if (!btn) return;
  goto(btn.dataset.tab, btn.dataset.tab === "membro" ? state.membroId : null);
  document.getElementById("nav").classList.remove("open");
  document.getElementById("navToggle").setAttribute("aria-expanded", "false");
});

document.getElementById("navToggle").addEventListener("click", (e) => {
  const nav = document.getElementById("nav");
  const open = nav.classList.toggle("open");
  e.currentTarget.setAttribute("aria-expanded", String(open));
});

$view.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-membro]");
  if (btn) {
    goto("membro", btn.dataset.membro);
    return;
  }
  const seg = e.target.closest("[data-status]");
  if (seg) {
    state.status = seg.dataset.status;
    document
      .querySelectorAll("#statusSeg button")
      .forEach((b) =>
        b.classList.toggle("on", b.dataset.status === state.status),
      );
    updateRegistros();
  }
});

$view.addEventListener("input", (e) => {
  if (e.target.id === "busca") {
    state.busca = e.target.value;
    updateRegistros();
  }
});

$view.addEventListener("change", (e) => {
  if (e.target.id === "tipoSel") {
    state.tipo = e.target.value;
    updateRegistros();
  }
});

window.addEventListener("hashchange", applyRoute);

document
  .getElementById("refreshBtn")
  .addEventListener("click", () => load(true));

// brilho que segue o cursor
const glow = document.getElementById("glow");
window.addEventListener(
  "pointermove",
  (e) => {
    glow.classList.add("on");
    glow.style.transform = `translate3d(${e.clientX}px,${e.clientY}px,0)`;
  },
  { passive: true },
);

/* ---------------- carregamento ---------------- */

function setStatus(html, isError) {
  if (!html) {
    $status.hidden = true;
    $status.innerHTML = "";
    return;
  }
  $status.hidden = false;
  $status.className = "status-bar" + (isError ? " error" : "");
  $status.innerHTML = html;
}

function stamp() {
  const d = new Date();
  document.getElementById("sheetLabel").textContent =
    CONFIG.SHEET_LABEL +
    " · atualizado " +
    pad2(d.getHours()) +
    ":" +
    pad2(d.getMinutes());
}

async function load(manual) {
  const btn = document.getElementById("refreshBtn");
  btn.disabled = true;
  btn.textContent = "Atualizando…";

  if (new URLSearchParams(location.search).has("demo")) {
    state.records = demoRecords();
    state.loading = false;
    state.error = null;
    setStatus(
      "Modo demonstração — dados de exemplo, não vindos da planilha. Remova <code>?demo=1</code> da URL para usar os dados reais.",
    );
    stamp();
    render();
    btn.disabled = false;
    btn.textContent = "Atualizar";
    return;
  }

  try {
    state.records = await fetchSheet();
    state.error = null;
    setStatus(null);
    stamp();
  } catch (err) {
    state.error = err;
    setStatus(
      `<strong>Não consegui ler a planilha.</strong> ${esc(err.message)}<br>
      Confira se ela está compartilhada como <em>“Qualquer pessoa com o link — Leitor”</em>
      e se a aba se chama <code>${esc(CONFIG.SHEET_NAME)}</code>.`,
      true,
    );
    document.getElementById("sheetLabel").textContent =
      CONFIG.SHEET_LABEL + " · falha ao ler";
  } finally {
    state.loading = false;
    btn.disabled = false;
    btn.textContent = "Atualizar";
    render();
  }
}

applyRoute();
load();

if (CONFIG.AUTO_REFRESH_MS > 0) {
  setInterval(() => {
    if (!document.hidden) load();
  }, CONFIG.AUTO_REFRESH_MS);
}
