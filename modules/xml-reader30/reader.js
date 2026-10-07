import { extractCteServiceSummary, extractNfeLineItems, findXmlElementsByLocalName, getXmlText } from './xml-reader30-nfe-parser.js';
import { isXmlReader30DocumentCancelled } from './xml-reader30-summary-utils.js';

const tabLabels = [
  ['nfe', 'NF-e'],
  ['cte', 'CT-e'],
  ['nfse', 'NFS-e fiscal'],
  ['difal', 'DIFAL'],
  ['cst060', 'CST 060']
];

const dashboardStorageKey = 'notasync:xml-reader30:dashboard:v1';
const readerLabels = {
  nfe: 'Leitor NF-e',
  cte: 'Leitor CT-e',
  nfse: 'Leitor NFS-e fiscal',
  difal: 'Cálculo DIFAL',
  cst060: 'Conferência CST 060'
};

const state = {
  activeView: 'dashboard',
  sessionAnalyzed: 0,
  dashboard: loadDashboardStore(),
  activeTab: 'nfe',
  files: [],
  errors: [],
  search: { nfe: '', cte: '', nfse: '' },
  difal: null,
  cst060: null,
  modalXml: null
};

let nextFileId = 1;

export function mountXmlReader30(root) {
  if (!root) return;
  document.querySelectorAll('[data-app-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeView = button.dataset.appView;
      render(root);
    });
  });
  root.addEventListener('click', handleClick);
  root.addEventListener('change', handleChange);
  root.addEventListener('input', handleInput);
  root.addEventListener('submit', handleSubmit);
  root.addEventListener('dragover', (event) => {
    if (event.target.closest('.upload-dropzone')) event.preventDefault();
  });
  root.addEventListener('drop', (event) => {
    if (!event.target.closest('.upload-dropzone')) return;
    event.preventDefault();
    void importFiles(event.dataTransfer?.files);
  });
  render(root);

  async function handleClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;

    if (action === 'go-reader') {
      state.activeView = 'reader';
      render(root);
    } else if (action === 'switch-tab') {
      state.activeTab = button.dataset.tab;
      render(root);
    } else if (action === 'clear-files') {
      const removed = state.files.length;
      state.files = [];
      state.errors = [];
      state.difal = null;
      state.cst060 = null;
      if (removed) recordOperation('Arquivos removidos', `${removed} arquivo(s) retirado(s) da lista`, 'info');
      render(root);
    } else if (action === 'remove-file') {
      const removed = state.files.find((file) => file.id === Number(button.dataset.id));
      state.files = state.files.filter((file) => file.id !== Number(button.dataset.id));
      if (removed) recordOperation('Arquivo removido', 'Um arquivo foi retirado da lista', 'info');
      render(root);
    } else if (action === 'view-xml') {
      const document = getDocuments().find((item) => item.id === button.dataset.id);
      if (document) {
        state.modalXml = { title: `${document.number || 'Documento'} · ${document.fileName}`, xml: document.xml };
        render(root);
      }
    } else if (action === 'close-xml') {
      state.modalXml = null;
      render(root);
    } else if (action === 'download-xml') {
      const document = getDocuments().find((item) => item.id === button.dataset.id);
      if (document) downloadText(document.fileName, document.xml, 'application/xml;charset=utf-8');
    } else if (action === 'export-current') {
      exportCurrentTab();
    } else if (action === 'go-dashboard') {
      state.activeView = 'dashboard';
      render(root);
    }
  }

  async function handleChange(event) {
    if (event.target.id === 'xmlFileInput') {
      await importFiles(event.target.files);
      event.target.value = '';
    }
  }

  function handleInput(event) {
    const field = event.target.dataset.searchTab;
    if (!field) return;
    state.search[field] = event.target.value;
    const caret = event.target.selectionStart;
    render(root);
    const next = root.querySelector(`[data-search-tab="${field}"]`);
    next?.focus();
    if (caret !== null) next?.setSelectionRange(caret, caret);
  }

  function handleSubmit(event) {
    if (event.target.id === 'difalForm') {
      event.preventDefault();
      calculateDifal(new FormData(event.target));
      if (!state.errors.length) {
        recordReaderCheck('difal');
        recordOperation('DIFAL calculado', `${state.difal.rows.length} item(ns) conferido(s)`);
      }
      render(root);
    }
    if (event.target.id === 'cst060Form') {
      event.preventDefault();
      calculateCst060(new FormData(event.target));
      if (!state.errors.length) {
        recordReaderCheck('cst060');
        recordOperation('CST 060 conferido', `${state.cst060.rows.length} item(ns) analisado(s)`);
      }
      render(root);
    }
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => /\.xml$/i.test(file.name) || /xml/i.test(file.type));
    if (!files.length) {
      state.errors = ['Selecione arquivos XML para importar.'];
      recordOperation('Importação não iniciada', 'Nenhum arquivo XML válido foi selecionado', 'warning');
      render(root);
      return;
    }

    state.errors = [];
    let analyzed = 0;
    const detectedReaders = new Set();
    for (const file of files) {
      try {
        const xml = await file.text();
        const parsed = parseUploadedXml(xml, file.name);
        if (parsed.kind === 'event') {
          state.files.push({ id: nextFileId++, name: file.name, size: file.size, document: null, event: parsed });
        } else {
          state.files.push({ id: nextFileId++, name: file.name, size: file.size, document: { ...parsed, fileName: file.name, xml } });
          detectedReaders.add(parsed.kind);
        }
        analyzed += 1;
      } catch (error) {
        state.errors.push(`${file.name}: ${error.message || 'não foi possível ler o XML.'}`);
      }
    }
    state.sessionAnalyzed += analyzed;
    state.dashboard.totalAnalyzed += analyzed;
    for (const readerId of detectedReaders) recordReaderCheck(readerId, false);
    if (analyzed) {
      recordOperation('XMLs analisados', `${analyzed} XML(s) lido(s)${state.errors.length ? ` · ${state.errors.length} com erro` : ''}`, state.errors.length ? 'warning' : 'success', false);
    } else {
      recordOperation('Falha na leitura de XML', `${state.errors.length} arquivo(s) não puderam ser interpretados`, 'warning', false);
    }
    saveDashboardStore();
    state.difal = null;
    state.cst060 = null;
    render(root);
  }
}

function render(root) {
  updateNavigation();
  if (state.activeView === 'dashboard') {
    root.innerHTML = renderDashboard(getDocuments());
    return;
  }
  renderReaderPage(root);
}

function renderReaderPage(root) {
  const docs = getDocuments();
  const events = state.files.filter((file) => file.event).length;
  root.innerHTML = `
    <section class="reader-page">
      <header class="reader-heading">
        <div class="reader-kicker">LEITORES FISCAIS · NOTASYNC</div>
        <h1>Leitor XML 3.0</h1>
        <p>Carregue seus XMLs para conferir documentos, itens e valores fiscais. Os arquivos são processados localmente no navegador.</p>
      </header>
      ${renderUploadPanel(events)}
      <nav class="reader-tabs" aria-label="Leitores XML">
        ${tabLabels.map(([key, label]) => `<button type="button" class="reader-tab ${state.activeTab === key ? 'active' : ''}" data-action="switch-tab" data-tab="${key}" aria-selected="${state.activeTab === key}">${label}${key === 'nfe' ? `<span>${docs.filter((item) => item.kind === 'nfe').length}</span>` : ''}</button>`).join('')}
      </nav>
      <section class="reader-panel">${renderActiveTab(docs)}</section>
      ${renderErrors()}
      ${state.modalXml ? renderXmlModal() : ''}
    </section>
  `;
}

function renderDashboard(docs) {
  const recent = state.dashboard.operations.slice(0, 6);
  const readyCount = Object.keys(state.dashboard.readerChecks).filter((key) => readerLabels[key]).length;
  const readers = Object.entries(readerLabels).map(([id, label]) => {
    const checkedAt = state.dashboard.readerChecks[id];
    return `<article class="dashboard-reader-card ${checkedAt ? 'is-working' : ''}">
      <span class="dashboard-reader-indicator" aria-hidden="true"></span>
      <div><strong>${escapeHtml(label)}</strong><small>${checkedAt ? `Funcionando · usado em ${escapeHtml(dateTimeLabel(checkedAt))}` : 'Pronto para uso · aguardando primeiro arquivo'}</small></div>
      ${badge(checkedAt ? 'Funcionando' : 'Pronto', checkedAt ? 'success' : 'neutral')}
    </article>`;
  }).join('');
  return `<section class="dashboard-page">
    <header class="reader-heading dashboard-heading">
      <div class="reader-kicker">VISÃO GERAL · NOTASYNC</div>
      <h1>Dashboard</h1>
      <p>Acompanhe os XMLs analisados, as operações recentes e o estado dos leitores fiscais.</p>
    </header>
    <section class="dashboard-metrics" aria-label="Resumo de atividade">
      <article class="dashboard-stat-card dashboard-stat-highlight"><span>Total de XMLs analisados</span><strong>${state.dashboard.totalAnalyzed.toLocaleString('pt-BR')}</strong><small>Acumulado neste navegador</small></article>
      <article class="dashboard-stat-card"><span>Analisados nesta sessão</span><strong>${state.sessionAnalyzed.toLocaleString('pt-BR')}</strong><small>Desde que esta página foi aberta</small></article>
      <article class="dashboard-stat-card"><span>Documentos carregados</span><strong>${docs.length.toLocaleString('pt-BR')}</strong><small>Únicos na lista atual</small></article>
      <article class="dashboard-stat-card"><span>Leitores já utilizados</span><strong>${readyCount} / ${Object.keys(readerLabels).length}</strong><small>Confirmados por uma leitura ou cálculo</small></article>
    </section>
    <section class="dashboard-columns">
      <section class="dashboard-panel dashboard-operations-panel" aria-labelledby="operationsTitle">
        <header class="dashboard-panel-heading"><div><h2 id="operationsTitle">Últimas operações</h2><p>Atividade recente neste navegador</p></div><span class="dashboard-live-dot">Atualizado</span></header>
        ${recent.length ? `<ol class="operation-list">${recent.map((operation) => `<li class="operation-item"><span class="operation-marker ${escapeHtml(operation.status)}" aria-hidden="true"></span><div class="operation-copy"><strong>${escapeHtml(operation.title)}</strong><span>${escapeHtml(operation.detail)}</span></div><time datetime="${escapeHtml(operation.at)}">${escapeHtml(dateTimeLabel(operation.at))}</time></li>`).join('')}</ol>` : emptyState('Nenhuma operação registrada.', 'Importe XMLs ou execute um cálculo para começar a acompanhar a atividade.')}
      </section>
      <section class="dashboard-panel dashboard-readers-panel" aria-labelledby="readersTitle">
        <header class="dashboard-panel-heading"><div><h2 id="readersTitle">Estado dos leitores</h2><p>Confirmação baseada no uso bem-sucedido</p></div></header>
        <div class="dashboard-reader-list">${readers}</div>
      </section>
    </section>
    <button type="button" class="primary-button dashboard-open-reader" data-action="go-reader">Abrir Leitor XML 3.0</button>
  </section>`;
}

function updateNavigation() {
  document.querySelectorAll('[data-app-view]').forEach((button) => {
    const active = button.dataset.appView === state.activeView;
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function loadDashboardStore() {
  const fallback = { totalAnalyzed: 0, operations: [], readerChecks: {} };
  try {
    const value = JSON.parse(localStorage.getItem(dashboardStorageKey) || 'null');
    if (!value || typeof value !== 'object') return fallback;
    return {
      totalAnalyzed: Math.max(0, Number(value.totalAnalyzed) || 0),
      operations: Array.isArray(value.operations) ? value.operations.slice(0, 10) : [],
      readerChecks: value.readerChecks && typeof value.readerChecks === 'object' ? value.readerChecks : {}
    };
  } catch {
    return fallback;
  }
}

function saveDashboardStore() {
  try {
    localStorage.setItem(dashboardStorageKey, JSON.stringify(state.dashboard));
  } catch {}
}

function recordOperation(title, detail, status = 'success', save = true) {
  state.dashboard.operations.unshift({ at: new Date().toISOString(), title, detail, status });
  state.dashboard.operations = state.dashboard.operations.slice(0, 10);
  if (save) saveDashboardStore();
}

function recordReaderCheck(readerId, save = true) {
  if (!readerLabels[readerId]) return;
  state.dashboard.readerChecks[readerId] = new Date().toISOString();
  if (save) saveDashboardStore();
}

function renderUploadPanel(eventCount) {
  const docs = getDocuments();
  const countByType = ['nfe', 'cte', 'nfse'].map((kind) => docs.filter((document) => document.kind === kind).length);
  return `
    <section class="upload-panel" aria-label="Importação de XML">
      <label class="upload-dropzone" for="xmlFileInput">
        <span class="upload-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span class="upload-copy"><strong>Solte os arquivos XML aqui</strong><span>ou clique para procurar · você pode selecionar vários arquivos</span></span>
        <span class="upload-cta">Selecionar XMLs</span>
        <input id="xmlFileInput" type="file" accept=".xml,text/xml,application/xml" multiple />
      </label>
      <div class="upload-footer">
        <span class="upload-count"><strong>${state.files.length}</strong> arquivo(s) · ${countByType[0]} NF-e · ${countByType[1]} CT-e · ${countByType[2]} NFS-e${eventCount ? ` · ${eventCount} evento(s)` : ''}</span>
        <button class="text-button" type="button" data-action="clear-files" ${state.files.length ? '' : 'disabled'}>Limpar arquivos</button>
      </div>
      ${state.files.length ? `<ul class="upload-file-list">${state.files.map((file) => `<li><span class="file-type-dot ${file.event ? 'event' : file.document?.kind || ''}"></span><span class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span><span class="file-size">${formatBytes(file.size)}</span><button type="button" class="file-remove" data-action="remove-file" data-id="${file.id}" aria-label="Remover ${escapeHtml(file.name)}">×</button></li>`).join('')}</ul>` : ''}
    </section>
  `;
}

function renderErrors() {
  if (!state.errors.length) return '';
  return `<div class="reader-errors" role="status"><strong>${state.errors.length} arquivo(s) não puderam ser lidos</strong><ul>${state.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul></div>`;
}

function renderActiveTab(docs) {
  if (state.activeTab === 'nfe') return renderNfeTab(docs.filter((item) => item.kind === 'nfe'));
  if (state.activeTab === 'cte') return renderCteTab(docs.filter((item) => item.kind === 'cte'));
  if (state.activeTab === 'nfse') return renderNfseTab(docs.filter((item) => item.kind === 'nfse'));
  if (state.activeTab === 'difal') return renderDifalTab(docs.filter((item) => item.kind === 'nfe'));
  return renderCst060Tab(docs.filter((item) => item.kind === 'nfe'));
}

function renderNfeTab(docs) {
  const rows = filterRows(docs.flatMap((doc) => nfeRows(doc)), 'nfe', (row) => `${row.number} ${row.issuer} ${row.product} ${row.ncm} ${row.cst} ${row.cfop} ${row.key}`);
  const total = docs.filter((doc) => !isCancelled(doc)).reduce((sum, doc) => sum + doc.total, 0);
  return `
    ${renderToolbar('nfe', 'NF-e', `${rows.length} item(ns)`, docs.length)}
    <div class="reader-metrics">${metric('Documentos', docs.length)}${metric('Itens', docs.reduce((sum, doc) => sum + doc.items.length, 0))}${metric('Valor das notas', money(total))}${metric('Canceladas', docs.filter((doc) => isCancelled(doc)).length)}</div>
    ${rows.length ? `<div class="reader-table-wrap"><table class="reader-table wide"><thead><tr><th>NF-e</th><th>Situação</th><th>Emissão</th><th>Emitente</th><th>Produto</th><th>NCM</th><th>CFOP</th><th>CST</th><th>Qtd.</th><th>V. produto</th><th>Base ICMS</th><th>Alíq.</th><th>ICMS</th><th>ICMS ST retido</th><th>Mono retido</th><th>Abrir</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${escapeHtml(row.number)}</strong><small>${escapeHtml(row.key || row.fileName)}</small></td><td>${badge(isCancelled(row.doc) ? 'Cancelada' : 'Ativa', isCancelled(row.doc) ? 'danger' : 'success')}</td><td>${escapeHtml(dateLabel(row.doc.issuedAt))}</td><td>${escapeHtml(row.issuer || '-')}<small>${escapeHtml(row.issuerCnpj || '')}</small></td><td class="product-cell">${escapeHtml(row.product)}</td><td>${escapeHtml(row.ncm)}</td><td>${escapeHtml(row.cfop)}</td><td>${escapeHtml(row.cst)}</td><td>${escapeHtml(row.quantity)}</td><td class="money">${money(row.productValue)}</td><td class="money">${money(row.baseIcms)}</td><td>${escapeHtml(row.aliquota)}%</td><td class="money">${money(row.icms)}</td><td class="money">${money(row.icmsSt)}</td><td class="money">${money(row.icmsMono)}</td><td><button class="icon-button" type="button" data-action="view-xml" data-id="${row.doc.id}" aria-label="Abrir XML ${escapeHtml(row.number)}">XML</button></td></tr>`).join('')}</tbody></table></div>` : emptyState(docs.length ? 'Nenhum item corresponde à busca.' : 'Carregue XMLs de NF-e para começar.', 'Cada produto aparece em uma linha para facilitar a conferência.')}
  `;
}

function renderCteTab(docs) {
  const rows = filterRows(docs, 'cte', (doc) => `${doc.number} ${doc.issuer} ${doc.key} ${doc.service.productLabel}`);
  return `
    ${renderToolbar('cte', 'CT-e', `${rows.length} documento(s)`, docs.length)}
    <div class="reader-metrics">${metric('Documentos', docs.length)}${metric('Valor dos serviços', money(docs.reduce((sum, doc) => sum + (doc.service.totalValue || 0), 0)))}${metric('Cancelados', docs.filter(isCancelled).length)}</div>
    ${rows.length ? `<div class="reader-table-wrap"><table class="reader-table"><thead><tr><th>CT-e</th><th>Situação</th><th>Emissão</th><th>Emitente</th><th>Serviço</th><th>Valor</th><th>Componentes</th><th>XML</th></tr></thead><tbody>${rows.map((doc) => `<tr><td><strong>${escapeHtml(doc.number)}</strong><small>${escapeHtml(doc.key || doc.fileName)}</small></td><td>${badge(isCancelled(doc) ? 'Cancelado' : 'Ativo', isCancelled(doc) ? 'danger' : 'success')}</td><td>${escapeHtml(dateLabel(doc.issuedAt))}</td><td>${escapeHtml(doc.issuer || '-')}<small>${escapeHtml(doc.issuerCnpj || '')}</small></td><td>${escapeHtml(doc.service.productLabel || '-')}</td><td class="money">${money(doc.service.totalValue)}</td><td>${escapeHtml(doc.service.components.map((item) => `${item.name}: ${item.valueLabel}`).join(' · ') || '-')}</td><td><button class="icon-button" type="button" data-action="view-xml" data-id="${doc.id}">XML</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('Carregue XMLs de CT-e para começar.', 'O leitor identifica o documento e resume os componentes do serviço.')}
  `;
}

function renderNfseTab(docs) {
  const rows = filterRows(docs, 'nfse', (doc) => `${doc.number} ${doc.issuer} ${doc.taker} ${doc.issuerCnpj} ${doc.serviceCode} ${doc.serviceDescription} ${doc.key}`);
  const activeDocs = docs.filter((doc) => !isCancelled(doc));
  const totalWithheld = activeDocs.reduce((sum, doc) => sum + doc.withheldValue, 0);
  return `
    ${renderToolbar('nfse', 'NFS-e fiscal', `${rows.length} documento(s)`, docs.length)}
    <div class="reader-metrics">${metric('NFS-e', docs.length)}${metric('Valor dos serviços', money(activeDocs.reduce((sum, doc) => sum + doc.serviceValue, 0)))}${metric('ISS', money(activeDocs.reduce((sum, doc) => sum + doc.issValue, 0)))}${metric('Retenções identificadas', money(totalWithheld))}</div>
    ${rows.length ? `<div class="reader-table-wrap"><table class="reader-table wide"><thead><tr><th>NFS-e</th><th>Status</th><th>Emissão</th><th>Local da prestação</th><th>Incidência ISS</th><th>Prestador</th><th>CNPJ prestador</th><th>Tomador</th><th>Município tomador</th><th>CNPJ tomador</th><th>Valor líquido</th><th>Retenções</th><th>Serviço</th><th>ISS</th><th>PIS</th><th>COFINS</th><th>INSS</th><th>IRRF</th><th>CSLL</th><th>ISS retido</th><th>Alíquota</th><th>XML</th></tr></thead><tbody>${rows.map((doc) => `<tr><td><strong>${escapeHtml(doc.number)}</strong><small>${escapeHtml(doc.key || doc.fileName)}</small></td><td>${badge(doc.status || (doc.cancelled ? 'Cancelada' : 'Lida'), doc.cancelled ? 'danger' : 'success')}</td><td>${escapeHtml(dateLabel(doc.issuedAt))}</td><td>${escapeHtml(doc.serviceLocation || '-')}</td><td>${escapeHtml(doc.issIncidence || '-')}</td><td>${escapeHtml(doc.issuer || '-')}</td><td>${escapeHtml(doc.issuerCnpj || '-')}</td><td>${escapeHtml(doc.taker || '-')}</td><td>${escapeHtml(doc.takerMunicipality || '-')}</td><td>${escapeHtml(doc.takerCnpj || '-')}</td><td class="money">${money(doc.netValue)}</td><td class="money">${money(doc.withheldValue)}</td><td class="money">${money(doc.serviceValue)}</td><td class="money">${money(doc.issValue)}</td><td class="money">${money(doc.pisValue)}</td><td class="money">${money(doc.cofinsValue)}</td><td class="money">${money(doc.inssValue)}</td><td class="money">${money(doc.irrfValue)}</td><td class="money">${money(doc.csllValue)}</td><td>${escapeHtml(doc.issRetention || '-')}</td><td>${escapeHtml(doc.issRate ? `${doc.issRate}%` : '-')}</td><td><button class="icon-button" type="button" data-action="view-xml" data-id="${doc.id}">XML</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('Carregue XMLs de NFS-e para começar.', 'Suporta estruturas do padrão nacional e ABRASF.')}
  `;
}

function renderDifalTab(docs) {
  const recipients = [...new Set(docs.map((doc) => doc.recipientCnpj).filter(Boolean))];
  const report = state.difal;
  return `
    <div class="panel-heading"><div><h2>DIFAL das NF-e</h2><p>Analisa compras interestaduais com ICMS a 4%, usando a fórmula por dentro do Leitor XML 3.0.</p></div></div>
    <form class="analysis-form" id="difalForm">
      <label>Destinatário / CNPJ comprador<select name="recipient" required><option value="">Selecione o CNPJ da empresa</option>${recipients.map((cnpj) => `<option value="${escapeHtml(cnpj)}">${escapeHtml(cnpj)}</option>`).join('')}</select></label>
      <label>Alíquota interna (%)<input name="rate" type="number" min="0.01" max="99.99" step="0.01" placeholder="Ex.: 18" required /></label>
      <label>Emissão inicial<input name="start" type="date" /></label>
      <label>Emissão final<input name="end" type="date" /></label>
      <button class="primary-button" type="submit" ${docs.length ? '' : 'disabled'}>Calcular DIFAL</button>
    </form>
    ${!recipients.length && docs.length ? `<p class="inline-note">Não encontrei CNPJ de destinatário nos XMLs carregados.</p>` : ''}
    ${report ? renderDifalReport(report) : emptyState('Informe o CNPJ comprador e a alíquota interna.', 'Somente itens com ICMS interestadual de 4% entram no DIFAL. Notas canceladas ficam fora das somas.')}
  `;
}

function renderDifalReport(report) {
  return `<div class="reader-metrics">${metric('NF-e consideradas', report.notes)}${metric('Itens analisados', report.rows.length)}${metric('ICMS próprio', money(report.icmsOwn))}${metric('ICMS 4%', money(report.icms4))}${metric('ICMS mono no XML', money(report.mono))}${metric('DIFAL', money(report.difal), 'highlight')}</div><p class="inline-note">O ICMS monofásico exibido é o valor informado no XML. A tabela de alíquotas vigentes do sistema original não acompanha esta versão de leitura local.</p>${report.rows.length ? `<div class="reader-table-wrap"><table class="reader-table wide"><thead><tr><th>NF-e</th><th>Emissão</th><th>Produto</th><th>CST</th><th>Base ICMS</th><th>Alíq. interestadual</th><th>ICMS</th><th>ICMS mono XML</th><th>DIFAL</th><th>Situação</th></tr></thead><tbody>${report.rows.map((row) => `<tr><td>${escapeHtml(row.doc.number)}</td><td>${escapeHtml(dateLabel(row.doc.issuedAt))}</td><td class="product-cell">${escapeHtml(row.item.description)}</td><td>${escapeHtml(row.item.cstCsosn)}</td><td class="money">${money(row.base)}</td><td>${escapeHtml(row.rate)}%</td><td class="money">${money(row.icms)}</td><td class="money">${money(row.mono)}</td><td class="money">${row.difal === null ? '—' : money(row.difal)}</td><td>${badge(isCancelled(row.doc) ? 'Cancelada' : row.rate === 4 ? 'ICMS 4%' : 'Fora do cálculo', isCancelled(row.doc) ? 'danger' : row.rate === 4 ? 'success' : 'neutral')}</td></tr>`).join('')}</tbody></table></div>` : emptyState('Nenhuma NF-e encontrada para esse destinatário e período.', '')}`;
}

function renderCst060Tab(docs) {
  const report = state.cst060;
  return `
    <div class="panel-heading"><div><h2>Conferência CST 060</h2><p>Compara o ICMS ST retido no XML com o recálculo por item, preservando a regra de 4% para pneus.</p></div></div>
    <form class="analysis-form compact-form" id="cst060Form">
      <label>Alíquota interna (%)<input name="rate" type="number" min="0.01" max="100" step="0.01" placeholder="Ex.: 18" required /></label>
      <button class="primary-button" type="submit" ${docs.length ? '' : 'disabled'}>Conferir CST 060</button>
    </form>
    ${report ? renderCst060Report(report) : emptyState('Informe a alíquota interna para iniciar a conferência.', 'Pneus aplicam a alíquota fixa de 4%, conforme a regra do módulo original.')}
  `;
}

function renderCst060Report(report) {
  return `<div class="reader-metrics">${metric('NF-e analisadas', report.notes)}${metric('NF-e com CST 060', report.notesWithItems)}${metric('Itens CST 060', report.rows.length)}${metric('ICMS ST no XML', money(sum(report.rows, (row) => row.retained)))}${metric('ICMS recalculado', money(sum(report.rows, (row) => row.calculated)))}${metric('Diferença', money(sum(report.rows, (row) => row.difference)), 'highlight')}</div>${report.rows.length ? `<div class="reader-table-wrap"><table class="reader-table wide"><thead><tr><th>Emissão</th><th>NF-e</th><th>Item</th><th>Emitente</th><th>Produto</th><th>NCM</th><th>CFOP</th><th>Valor produto</th><th>Desconto</th><th>Base</th><th>Alíquota</th><th>ICMS ST XML</th><th>ICMS calculado</th><th>Diferença</th><th>Status</th></tr></thead><tbody>${report.rows.map((row) => `<tr><td>${escapeHtml(dateLabel(row.doc.issuedAt))}</td><td>${escapeHtml(row.doc.number)}</td><td>${escapeHtml(row.item.index)}</td><td>${escapeHtml(row.doc.issuer || '-')}</td><td class="product-cell">${escapeHtml(row.item.description)}</td><td>${escapeHtml(row.item.ncm)}</td><td>${escapeHtml(row.item.cfop)}</td><td class="money">${money(row.productValue)}</td><td class="money">${money(row.discount)}</td><td class="money">${money(row.base)}</td><td>${row.rate}%${row.tire ? ' · pneu' : ''}</td><td class="money">${money(row.retained)}</td><td class="money">${money(row.calculated)}</td><td class="money">${money(row.difference)}</td><td>${badge(row.status, row.status === 'OK' ? 'success' : 'warning')}</td></tr>`).join('')}</tbody></table></div>` : emptyState('Nenhum item com CST 060 foi encontrado.', 'Os XMLs carregados continuam disponíveis nas outras abas.')}`;
}

function renderToolbar(key, title, resultLabel, total) {
  return `<div class="panel-heading"><div><h2>${title}</h2><p>${resultLabel} · ${total} documento(s) carregado(s)</p></div><div class="toolbar-actions"><label class="reader-search"><span aria-hidden="true">⌕</span><input type="search" data-search-tab="${key}" value="${escapeHtml(state.search[key] || '')}" placeholder="Buscar documento, produto, CNPJ..." /></label><button type="button" class="secondary-button" data-action="export-current" ${total ? '' : 'disabled'}>Exportar Excel</button></div></div>`;
}

function renderXmlModal() {
  return `<div class="xml-modal-backdrop" data-action="close-xml"><section class="xml-modal" role="dialog" aria-modal="true" aria-label="Visualizador XML"><header><strong>${escapeHtml(state.modalXml.title)}</strong><button type="button" data-action="close-xml" aria-label="Fechar">×</button></header><pre>${escapeHtml(state.modalXml.xml)}</pre></section></div>`;
}

function parseUploadedXml(xml, fileName) {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  if (parsed.querySelector('parsererror')) throw new Error('XML inválido ou malformado.');
  const infNfe = findXmlElementsByLocalName(parsed, 'infNFe')[0];
  if (infNfe) return parseNfe(parsed, infNfe, fileName, xml);
  const infCte = findXmlElementsByLocalName(parsed, 'infCte')[0];
  if (infCte) return parseCte(parsed, infCte, fileName, xml);
  if (isEventDocument(parsed)) return parseEvent(parsed, fileName);
  if (isNfseDocument(parsed)) return parseNfse(parsed, fileName, xml);
  throw new Error('tipo de documento não reconhecido (aceitos: NF-e, CT-e, NFS-e e eventos NF-e).');
}

function parseNfe(document, infNfe, fileName, xml) {
  const ide = first(document, ['ide']);
  const emit = first(document, ['emit']);
  const dest = first(document, ['dest']);
  const total = first(document, ['ICMSTot']);
  const prot = first(document, ['infProt']);
  const key = extractAccessKey(infNfe.getAttribute('Id') || text(document, ['chNFe']), 44);
  const statusCode = text(prot, ['cStat']);
  return {
    kind: 'nfe', id: `nfe-${key || nextFileId}`, fileName, xml, key,
    number: text(ide, ['nNF']) || '-', serie: text(ide, ['serie']) || '-',
    issuedAt: text(ide, ['dhEmi', 'dEmi']), issuer: text(emit, ['xNome']), issuerCnpj: digits(text(emit, ['CNPJ', 'CPF'])),
    recipient: text(dest, ['xNome']), recipientCnpj: digits(text(dest, ['CNPJ', 'CPF'])),
    total: numeric(text(total, ['vNF'])), productsTotal: numeric(text(total, ['vProd'])),
    statusCode, cancelled: ['101', '151'].includes(statusCode),
    items: extractNfeLineItems(xml), events: []
  };
}

function parseCte(document, infCte, fileName, xml) {
  const ide = first(document, ['ide']);
  const emit = first(document, ['emit']);
  const key = extractAccessKey(infCte.getAttribute('Id') || text(document, ['chCTe']), 44);
  const service = extractCteServiceSummary(xml);
  return {
    kind: 'cte', id: `cte-${key || nextFileId}`, fileName, xml, key,
    number: text(ide, ['nCT']) || '-', serie: text(ide, ['serie']) || '-', issuedAt: text(ide, ['dhEmi', 'dEmi']),
    issuer: text(emit, ['xNome']), issuerCnpj: digits(text(emit, ['CNPJ', 'CPF'])),
    total: numeric(text(document, ['vTPrest'])), service, cancelled: false
  };
}

function isEventDocument(document) {
  const hasEvent = findXmlElementsByLocalName(document, 'infEvento').length > 0 || findXmlElementsByLocalName(document, 'procEventoNFe').length > 0;
  return hasEvent && (findXmlElementsByLocalName(document, 'chNFe').length > 0 || findXmlElementsByLocalName(document, 'tpEvento').length > 0);
}

function parseEvent(document, fileName) {
  const info = first(document, ['infEvento']);
  const eventId = info?.getAttribute('Id') || '';
  const idMatch = digits(eventId).match(/^\d{6}(\d{44})\d{2}$/);
  const key = extractAccessKey(text(info, ['chNFe']), 44) || idMatch?.[1] || '';
  const type = text(info, ['tpEvento']) || '';
  const description = text(info, ['descEvento', 'xEvento', 'xMotivo']);
  const code = text(info, ['cStat']);
  const cancelled = type === '110111' || /cancelamento|cancelada/i.test(description) || code === '101';
  if (!key) throw new Error('evento sem chave de acesso da NF-e.');
  return { kind: 'event', key, fileName, cancelled, description };
}

function isNfseDocument(document) {
  return ['infNFSe', 'InfNfse', 'CompNfse', 'InfDeclaracaoPrestacaoServico', 'NFSe'].some((tag) => findXmlElementsByLocalName(document, tag).length > 0);
}

function parseNfse(document, fileName, xml) {
  const issuer = first(document, ['emit', 'prestador', 'PrestadorServico', 'Prestador']);
  const taker = first(document, ['toma', 'tomador', 'TomadorServico', 'Tomador']);
  const service = first(document, ['serv', 'Servico', 'Valores', 'valores']);
  const serviceValues = first(document, ['vServPrest', 'Valores', 'valores']);
  const key = extractAccessKey(text(document, ['chaveAcesso', 'ChaveAcesso', 'chNFSe']) || attribute(document, ['infNFSe', 'infNfse'], 'Id'), 50);
  const pisValue = numeric(text(document, ['vRetPIS', 'vPIS', 'ValorPIS']));
  const cofinsValue = numeric(text(document, ['vRetCOFINS', 'vCOFINS', 'ValorCOFINS']));
  const inssValue = numeric(text(document, ['vRetINSS', 'vINSS', 'ValorINSS']));
  const irrfValue = numeric(text(document, ['vRetIRRF', 'vIRRF', 'ValorIR']));
  const csllValue = numeric(text(document, ['vRetCSLL', 'vCSLL', 'ValorCSLL']));
  const withheldValue = pisValue + cofinsValue + inssValue + irrfValue + csllValue;
  const status = text(document, ['status', 'Situacao', 'cStat']);
  const serviceValue = numeric(text(serviceValues, ['vServ', 'ValorServicos', 'valorServico']) || text(document, ['vServ', 'ValorServicos', 'valorServico']));
  const netValue = numeric(text(document, ['vLiq', 'ValorLiquidoNfse', 'ValorLiquido'])) || Math.max(0, serviceValue - withheldValue - numeric(text(document, ['vISSRet', 'ValorIssRetido'])));
  const rawRetention = text(document, ['tpRetISSQN', 'IssRetido', 'issRetido']);
  const issRetention = ['1', 'true', 'sim'].includes(normalize(rawRetention)) ? 'Retido' : ['2', 'false', 'nao'].includes(normalize(rawRetention)) ? 'Não retido' : rawRetention;
  return {
    kind: 'nfse', id: `nfse-${key || nextFileId}`, fileName, xml, key,
    number: text(document, ['numeroNFSe', 'numeroNfse', 'nNFSe', 'Numero', 'NumeroNfse']) || '-',
    issuedAt: text(document, ['dataEmissao', 'DataEmissao', 'dhEmi', 'dhProc']),
    issuer: text(issuer, ['xNome', 'razaoSocial', 'RazaoSocial', 'Nome']), issuerCnpj: digits(text(issuer, ['CNPJ', 'cnpj', 'CpfCnpj', 'CPF'])),
    taker: text(taker, ['xNome', 'razaoSocial', 'RazaoSocial', 'Nome']), takerCnpj: digits(text(taker, ['CNPJ', 'cnpj', 'CpfCnpj', 'CPF'])),
    serviceLocation: text(document, ['xLocPrestacao', 'localPrestacao']), issIncidence: text(document, ['xLocIncid', 'localIncidenciaIss']),
    takerMunicipality: text(taker, ['xMun', 'xMunicipio', 'Municipio']),
    serviceCode: text(document, ['cTribNac', 'cTribMun', 'ItemListaServico', 'itemListaServico']),
    serviceDescription: text(service, ['xDescServ', 'Discriminacao', 'descricaoServico']) || text(document, ['xDescServ', 'Discriminacao', 'descricaoServico']),
    serviceValue, netValue,
    issValue: numeric(text(document, ['vISSQN', 'vISS', 'valorIss', 'ValorIss', 'ValorISS'])),
    pisValue, cofinsValue, inssValue, irrfValue, csllValue,
    issRetention,
    issRate: numeric(text(document, ['pAliqAplic', 'pAliq', 'aliquotaIss', 'aliquotaISS'])),
    withheldValue, status, cancelled: /cancel/i.test(status)
  };
}

function getDocuments() {
  const docs = state.files.map((file) => file.document).filter(Boolean);
  const cancellations = new Set(state.files.filter((file) => file.event?.cancelled).map((file) => file.event.key));
  const unique = new Map();
  for (const doc of docs) {
    const key = doc.key ? `${doc.kind}:${doc.key}` : `${doc.kind}:${doc.fileName}`;
    const previous = unique.get(key);
    if (!previous || doc.xml.length > previous.xml.length) unique.set(key, doc);
  }
  return [...unique.values()].map((doc) => ({ ...doc, cancelled: Boolean(doc.cancelled || (doc.key && cancellations.has(doc.key))) }));
}

function nfeRows(doc) {
  return doc.items.map((item) => ({
    doc, id: doc.id, fileName: doc.fileName, key: doc.key, number: doc.number, issuer: doc.issuer, issuerCnpj: doc.issuerCnpj,
    product: item.description, ncm: item.ncm, cfop: item.cfop, cst: item.cstCsosn, quantity: item.quantity,
    productValue: numeric(item.totalValueRaw), baseIcms: numeric(item.baseCalculoIcmsRaw), aliquota: numeric(item.aliquotaIcmsRaw),
    icms: numeric(item.valorIcmsRaw), icmsSt: numeric(item.icmsStRetRaw), icmsMono: numeric(item.vICMSMonoRetRaw), item
  }));
}

function filterRows(rows, key, getText) {
  const query = normalize(state.search[key] || '');
  return query ? rows.filter((row) => normalize(getText(row)).includes(query)) : rows;
}

function calculateDifal(form) {
  const recipient = String(form.get('recipient') || '');
  const rate = numeric(form.get('rate'));
  const start = String(form.get('start') || '');
  const end = String(form.get('end') || '');
  if (!recipient || !(rate > 0 && rate < 100) || (start && end && start > end)) {
    state.errors = ['Informe um CNPJ destinatário, uma alíquota entre 0 e 100% e um período válido.'];
    return;
  }
  const docs = getDocuments().filter((doc) => doc.kind === 'nfe' && doc.recipientCnpj === digits(recipient) && isInRange(doc.issuedAt, start, end));
  const rows = docs.flatMap((doc) => doc.items.map((item) => {
    const base = numeric(item.baseCalculoIcmsRaw);
    const aliquota = numeric(item.aliquotaIcmsRaw);
    const icms = numeric(item.valorIcmsRaw);
    const mono = numeric(item.vICMSMonoRetRaw);
    const difal = Math.abs(aliquota - 4) < 0.005 && !isCancelled(doc) ? calculateDifalPorDentro(base, aliquota, rate) : null;
    return { doc, item, base, rate: aliquota, icms, mono, difal };
  }));
  state.difal = {
    notes: docs.length,
    rows,
    icmsOwn: sum(rows.filter((row) => !isCancelled(row.doc)), (row) => row.icms),
    icms4: sum(rows.filter((row) => !isCancelled(row.doc) && Math.abs(row.rate - 4) < 0.005), (row) => row.icms),
    mono: sum(rows.filter((row) => !isCancelled(row.doc)), (row) => row.mono),
    difal: sum(rows, (row) => row.difal || 0)
  };
  state.errors = [];
}

function calculateDifalPorDentro(base, interstateRate, internalRate) {
  const internal = internalRate / 100;
  if (!(internal < 1)) return 0;
  const interstateIcms = base * (interstateRate / 100);
  const regrossedBase = (base - interstateIcms) / (1 - internal);
  return roundMoney(regrossedBase * internal - interstateIcms);
}

function calculateCst060(form) {
  const rate = numeric(form.get('rate'));
  if (!(rate > 0 && rate <= 100)) {
    state.errors = ['Informe uma alíquota interna válida.'];
    return;
  }
  const docs = getDocuments().filter((doc) => doc.kind === 'nfe');
  const rows = docs.flatMap((doc) => doc.items.filter((item) => String(item.cstCsosn).trim() === '60').map((item) => {
    const tire = /\bPNEU(?:S|MATICO|MATICOS)?\b/i.test(item.description.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    const appliedRate = tire ? 4 : rate;
    const productValue = numeric(item.totalValueRaw);
    const discount = numeric(findItemValue(doc.xml, item.index, 'vDesc'));
    const base = roundMoney(productValue - discount);
    const retained = numeric(item.icmsStRetRaw);
    const calculated = retained === 0 ? 0 : roundMoney(base * appliedRate / 100);
    const difference = roundMoney(retained - calculated);
    return { doc, item, tire, rate: appliedRate, productValue, discount, base, retained, calculated, difference, status: Math.abs(difference) <= 0.01 ? 'OK' : 'Divergente' };
  }));
  state.cst060 = { notes: docs.length, notesWithItems: new Set(rows.map((row) => row.doc.id)).size, rows };
  state.errors = [];
}

function findItemValue(xml, itemIndex, tag) {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const detail = findXmlElementsByLocalName(document, 'det')[Number(itemIndex) - 1];
  return getXmlText(detail, tag);
}

function exportCurrentTab() {
  const docs = getDocuments();
  let headers = [];
  let rows = [];
  if (state.activeTab === 'nfe') {
    headers = ['NF-e', 'Status', 'Emissão', 'Emitente', 'CNPJ', 'Produto', 'NCM', 'CFOP', 'CST', 'Quantidade', 'Valor produto', 'Base ICMS', 'Alíquota', 'ICMS', 'ICMS ST retido', 'ICMS monofásico'];
    rows = docs.filter((doc) => doc.kind === 'nfe').flatMap(nfeRows).map((row) => [row.number, isCancelled(row.doc) ? 'Cancelada' : 'Ativa', row.doc.issuedAt, row.issuer, row.issuerCnpj, row.product, row.ncm, row.cfop, row.cst, row.quantity, row.productValue, row.baseIcms, row.aliquota, row.icms, row.icmsSt, row.icmsMono]);
  } else if (state.activeTab === 'cte') {
    headers = ['CT-e', 'Emissão', 'Chave', 'Emitente', 'Serviço', 'Valor'];
    rows = docs.filter((doc) => doc.kind === 'cte').map((doc) => [doc.number, doc.issuedAt, doc.key, doc.issuer, doc.service.productLabel, doc.total]);
  } else if (state.activeTab === 'nfse') {
    headers = ['NFS-e', 'Status', 'Emissão', 'Local prestação', 'Incidência ISS', 'Prestador', 'CNPJ prestador', 'Tomador', 'Município tomador', 'CNPJ tomador', 'Valor líquido', 'Retenções', 'Serviço', 'ISS', 'PIS', 'COFINS', 'INSS', 'IRRF', 'CSLL', 'ISS retido', 'Alíquota ISS', 'Código', 'Descrição'];
    rows = docs.filter((doc) => doc.kind === 'nfse').map((doc) => [doc.number, doc.status || (doc.cancelled ? 'Cancelada' : 'Lida'), doc.issuedAt, doc.serviceLocation, doc.issIncidence, doc.issuer, doc.issuerCnpj, doc.taker, doc.takerMunicipality, doc.takerCnpj, doc.netValue, doc.withheldValue, doc.serviceValue, doc.issValue, doc.pisValue, doc.cofinsValue, doc.inssValue, doc.irrfValue, doc.csllValue, doc.issRetention, doc.issRate, doc.serviceCode, doc.serviceDescription]);
  } else if (state.activeTab === 'difal' && state.difal) {
    headers = ['NF-e', 'Emissão', 'Produto', 'CST', 'Base ICMS', 'Alíquota', 'ICMS', 'ICMS mono XML', 'DIFAL', 'Situação'];
    rows = state.difal.rows.map((row) => [row.doc.number, row.doc.issuedAt, row.item.description, row.item.cstCsosn, row.base, row.rate, row.icms, row.mono, row.difal ?? '', isCancelled(row.doc) ? 'Cancelada' : 'Ativa']);
  } else if (state.activeTab === 'cst060' && state.cst060) {
    headers = ['Emissão', 'NF-e', 'Item', 'Emitente', 'Produto', 'NCM', 'CFOP', 'Valor produto', 'Desconto', 'Base', 'Alíquota', 'ICMS ST XML', 'ICMS calculado', 'Diferença', 'Status'];
    rows = state.cst060.rows.map((row) => [row.doc.issuedAt, row.doc.number, row.item.index, row.doc.issuer, row.item.description, row.item.ncm, row.item.cfop, row.productValue, row.discount, row.base, row.rate, row.retained, row.calculated, row.difference, row.status]);
  }
  if (!rows.length) return;
  const table = `<table><thead><tr>${headers.map((value) => `<th>${escapeHtml(value)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  downloadText(`leitor-xml-3-${state.activeTab}.xls`, `\ufeff<html><head><meta charset="utf-8"></head><body>${table}</body></html>`, 'application/vnd.ms-excel;charset=utf-8');
  recordOperation('Planilha exportada', `Aba ${tabLabels.find(([key]) => key === state.activeTab)?.[1] || state.activeTab}`);
}

function sum(rows, getValue) { return rows.reduce((total, row) => total + (Number(getValue(row)) || 0), 0); }
function roundMoney(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function numeric(value) { const parsed = Number(String(value ?? '0').replace(',', '.').trim()); return Number.isFinite(parsed) ? parsed : 0; }
function money(value) { return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function dateLabel(value) { if (!value) return '—'; const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-BR').format(date); }
function dateTimeLabel(value) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date) : '—'; }
function digits(value) { return String(value || '').replace(/\D/g, ''); }
function normalize(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function isCancelled(doc) { return isXmlReader30DocumentCancelled({ ...doc, status: doc.cancelled ? 'cancelada' : 'ativa' }); }
function isInRange(value, start, end) { const day = dateKey(value); return (!start && !end) || (Boolean(day) && (!start || day >= start) && (!end || day <= end)); }
function dateKey(value) { const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/); if (match) return match[1]; const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : ''; }
function extractAccessKey(value, length) { const found = digits(value).match(new RegExp(`\\d{${length}}`)); return found?.[0] || ''; }
function formatBytes(value) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
function emptyState(title, subtitle) { return `<div class="reader-empty"><span class="empty-mark" aria-hidden="true">XML</span><strong>${escapeHtml(title)}</strong>${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ''}</div>`; }
function metric(label, value, tone = '') { return `<article class="metric-card ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`; }
function badge(label, tone) { return `<span class="reader-badge ${tone}">${escapeHtml(label)}</span>`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function downloadText(fileName, content, type) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url); }
function first(root, names) { for (const name of names) { const node = findXmlElementsByLocalName(root, name)[0]; if (node) return node; } return root; }
function text(root, names) { for (const name of names) { const value = getXmlText(root, name); if (value) return value; } return ''; }
function attribute(root, names, key) { for (const name of names) { const node = findXmlElementsByLocalName(root, name)[0]; const value = node?.getAttribute(key); if (value) return value; } return ''; }

