import { extractCteServiceSummary, extractNfeLineItems, findXmlElementsByLocalName, getXmlText } from './xml-reader30-nfe-parser.js';
import { isXmlReader30DocumentCancelled } from './xml-reader30-summary-utils.js';

const readerMenuItems = [
  ['nfe', 'NF-e'],
  ['nfse', 'NFS-e fiscal'],
  ['difal', 'DIFAL'],
  ['cst060', 'CST 060']
];

const nfseDefaultColumnOrder = [
  'number', 'serviceLocation', 'issIncidence', 'issuer', 'issuerCnpj', 'taker',
  'takerMunicipality', 'takerCnpj', 'discountValue', 'netValue', 'withheldValue',
  'serviceValue', 'issValue', 'pisValue', 'cofinsValue', 'inssValue', 'irrfValue',
  'csllValue', 'issuedAt', 'issRetention', 'federalRetention', 'issRate',
  'issRetainedValue', 'actualIssRate', 'processingStatus', 'processingError'
];

const readerDefaultColumnOrders = {
  nfe: ['check', 'number', 'status', 'issuedAt', 'issuer', 'product', 'ncm', 'cfop', 'cst', 'quantity', 'productValue', 'baseIcms', 'aliquota', 'icms', 'icmsSt', 'icmsMono', 'openXml'],
  cte: ['number', 'status', 'issuedAt', 'issuer', 'service', 'value', 'components', 'openXml'],
  difal: ['number', 'issuedAt', 'product', 'cst', 'base', 'rate', 'icms', 'mono', 'difal', 'status'],
  cst060: ['issuedAt', 'number', 'item', 'issuer', 'product', 'ncm', 'cfop', 'productValue', 'discount', 'base', 'rate', 'retained', 'calculated', 'difference', 'status']
};

const state = {
  activeReader: 'nfe',
  files: [],
  errors: [],
  search: { nfe: '', cte: '', nfse: '' },
  difal: null,
  difalChartPeriod: 'day',
  cst060: null,
  modalXml: null,
  selectedNfeItems: new Set(),
  confirmedNfeItems: new Set(),
  nfeFullscreen: false,
  readerColumnOrders: Object.fromEntries(Object.entries(readerDefaultColumnOrders).map(([reader, columns]) => [reader, [...columns]])),
  readerColumnDrag: null,
  nfseTable: {
    columnOrder: [...nfseDefaultColumnOrder],
    hiddenColumns: new Set(),
    sortKey: 'issuedAt',
    sortDirection: 'desc',
    columnMenuKey: null,
    columnMenuAnchor: null,
    dragKey: null
  },
  readerFilters: {
    nfe: { hasSearched: false, text: '' },
    nfse: { hasSearched: false, text: '' },
    difal: { hasSearched: false, text: '', rate: '' },
    cst060: { hasSearched: false, text: '', rate: '' }
  }
};

let nextFileId = 1;

export function mountXmlReader30(root, requestApi) {
  if (!root) return;
  document.querySelectorAll('[data-reader]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeReader = button.dataset.reader;
      render(root);
    });
  });
  root.addEventListener('click', handleClick);
  root.addEventListener('change', handleChange);
  root.addEventListener('input', handleInput);
  root.addEventListener('submit', handleSubmit);
  root.addEventListener('pointerover', handleDifalChartPointerOver);
  root.addEventListener('pointermove', handleDifalChartPointerMove);
  root.addEventListener('pointerout', handleDifalChartPointerOut);
  root.addEventListener('focusin', handleDifalChartFocusIn);
  root.addEventListener('focusout', handleDifalChartFocusOut);
  root.addEventListener('keydown', handleDifalChartKeydown);
  root.addEventListener('dragstart', handleNfseColumnDragStart);
  root.addEventListener('dragover', handleNfseColumnDragOver);
  root.addEventListener('drop', handleNfseColumnDrop);
  root.addEventListener('dragend', handleNfseColumnDragEnd);
  root.addEventListener('dragstart', handleReaderColumnDragStart);
  root.addEventListener('dragover', handleReaderColumnDragOver);
  root.addEventListener('drop', handleReaderColumnDrop);
  root.addEventListener('dragend', handleReaderColumnDragEnd);
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
    const chartPoint = event.target.closest('[data-difal-point]');
    if (chartPoint) {
      const wasPinned = chartPoint.hasAttribute('data-pinned');
      root.querySelectorAll('[data-difal-point][data-pinned]').forEach((point) => point.removeAttribute('data-pinned'));
      if (!wasPinned) {
        chartPoint.setAttribute('data-pinned', '');
        showDifalChartTooltip(chartPoint);
      } else {
        hideDifalChartTooltip(chartPoint.closest('.difal-chart-visual'));
      }
      return;
    }
    root.querySelectorAll('[data-difal-point][data-pinned]').forEach((point) => point.removeAttribute('data-pinned'));
    root.querySelectorAll('.difal-chart-visual').forEach(hideDifalChartTooltip);

    const button = event.target.closest('[data-action]');
    if (!button) {
      if (state.nfseTable.columnMenuKey) {
        state.nfseTable.columnMenuKey = null;
        render(root);
      }
      return;
    }
    const action = button.dataset.action;
    if (state.nfseTable.columnMenuKey && !button.closest('[data-nfse-column-menu-wrap]')) {
      state.nfseTable.columnMenuKey = null;
    }

    if (action === 'clear-files') {
      state.files = [];
      state.errors = [];
      state.difal = null;
      state.cst060 = null;
      state.readerFilters.nfe = { hasSearched: false, text: '' };
      state.readerFilters.nfse = { hasSearched: false, text: '' };
      state.readerFilters.difal = { hasSearched: false, text: '', rate: '' };
      state.readerFilters.cst060 = { hasSearched: false, text: '', rate: '' };
      state.nfeFullscreen = false;
      state.selectedNfeItems.clear();
      state.confirmedNfeItems.clear();
      render(root);
    } else if (action === 'remove-file') {
      state.files = state.files.filter((file) => file.id !== Number(button.dataset.id));
      render(root);
    } else if (action === 'view-xml') {
      const document = getDocuments().find((item) => item.id === button.dataset.id);
      if (document) {
        state.modalXml = { title: `${document.number || 'Documento'} · ${document.fileName}`, xml: document.xml };
        render(root);
      }
    } else if (action === 'view-nfe-pdf') {
      const document = getDocuments().find((item) => item.id === button.dataset.id && item.kind === 'nfe');
      if (document) void downloadNfeDanfe(document, requestApi, button);
    } else if (action === 'close-xml') {
      state.modalXml = null;
      render(root);
    } else if (action === 'download-xml') {
      const document = getDocuments().find((item) => item.id === button.dataset.id);
      if (document) downloadText(document.fileName, document.xml, 'application/xml;charset=utf-8');
    } else if (action === 'export-current') {
      exportCurrentReader();
    } else if (action === 'nfse-sort') {
      const key = button.dataset.sortKey;
      if (!key) return;
      state.nfseTable.sortDirection = state.nfseTable.sortKey === key && state.nfseTable.sortDirection === 'asc' ? 'desc' : 'asc';
      state.nfseTable.sortKey = key;
      state.nfseTable.columnMenuKey = null;
      render(root);
    } else if (action === 'nfse-column-menu') {
      const key = button.dataset.columnKey;
      state.nfseTable.columnMenuKey = state.nfseTable.columnMenuKey === key ? null : key;
      const rect = button.getBoundingClientRect();
      state.nfseTable.columnMenuAnchor = state.nfseTable.columnMenuKey
        ? { top: Math.min(rect.bottom + 4, window.innerHeight - 70), left: Math.min(rect.left, window.innerWidth - 168) }
        : null;
      render(root);
    } else if (action === 'nfse-column-hide') {
      const key = button.dataset.columnKey;
      const visibleCount = state.nfseTable.columnOrder.filter((column) => !state.nfseTable.hiddenColumns.has(column)).length;
      if (key && visibleCount > 1) state.nfseTable.hiddenColumns.add(key);
      state.nfseTable.columnMenuKey = null;
      state.nfseTable.columnMenuAnchor = null;
      render(root);
    } else if (action === 'nfse-columns-restore') {
      state.nfseTable.hiddenColumns.clear();
      state.nfseTable.columnMenuKey = null;
      state.nfseTable.columnMenuAnchor = null;
      render(root);
    } else if (action === 'nfse-clear-search') {
      state.readerFilters.nfse = { hasSearched: false, text: '' };
      state.nfseTable.columnMenuKey = null;
      state.nfseTable.columnMenuAnchor = null;
      render(root);
    } else if (action === 'save-nfe-checks') {
      const visibleKeys = new Set(getNfeVisibleRows().map(getNfeItemKey));
      const pendingKeys = [...state.selectedNfeItems].filter((key) => visibleKeys.has(key));
      for (const key of pendingKeys) {
        state.confirmedNfeItems.add(key);
        state.selectedNfeItems.delete(key);
      }
      render(root);
    } else if (action === 'toggle-reader-fullscreen' || action === 'close-reader-fullscreen') {
      state.nfeFullscreen = action === 'toggle-reader-fullscreen';
      render(root);
    }
  }

  function handleDifalChartPointerOver(event) {
    const point = event.target.closest('[data-difal-point]');
    if (point) showDifalChartTooltip(point);
  }

  function handleDifalChartPointerOut(event) {
    const visual = event.target.closest('.difal-chart-visual');
    if (!visual || event.relatedTarget?.closest?.('.difal-chart-visual') === visual) return;
    if (visual.querySelector('[data-difal-point][data-pinned]') || visual.contains(document.activeElement)) return;
    hideDifalChartTooltip(visual);
  }

  function handleDifalChartPointerMove(event) {
    const svg = event.target.closest('.difal-chart');
    if (!svg) return;
    const visual = svg.closest('.difal-chart-visual');
    if (visual?.querySelector('[data-difal-point][data-pinned]')) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((event.clientX - rect.left) / rect.width) * 700;
    const y = ((event.clientY - rect.top) / rect.height) * 230;
    const left = Number(svg.dataset.plotLeft || 72);
    const right = Number(svg.dataset.plotRight || 658);
    if (x < left || x > right || y < 40 || y > 178) {
      if (!visual?.contains(document.activeElement)) hideDifalChartTooltip(visual);
      return;
    }
    const points = [...svg.querySelectorAll('[data-difal-point]')];
    const nearest = points.reduce((best, point) => {
      const distance = Math.abs(Number(point.getAttribute('cx')) - x);
      return !best || distance < best.distance ? { point, distance } : best;
    }, null);
    if (nearest) showDifalChartTooltip(nearest.point);
  }

  function handleDifalChartFocusIn(event) {
    const point = event.target.closest('[data-difal-point]');
    if (point) showDifalChartTooltip(point);
  }

  function handleDifalChartFocusOut(event) {
    const point = event.target.closest('[data-difal-point]');
    if (point && !point.hasAttribute('data-pinned')) hideDifalChartTooltip(point.closest('.difal-chart-visual'));
  }

  function handleDifalChartKeydown(event) {
    const point = event.target.closest('[data-difal-point]');
    if (!point || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    point.click();
  }

  function showDifalChartTooltip(point) {
    const visual = point.closest('.difal-chart-visual');
    const tooltip = visual?.querySelector('.difal-chart-tooltip');
    if (!visual || !tooltip) return;
    const pointRect = point.getBoundingClientRect();
    const visualRect = visual.getBoundingClientRect();
    const x = pointRect.left + pointRect.width / 2 - visualRect.left;
    const svg = visual.querySelector('.difal-chart');
    const svgRect = svg?.getBoundingClientRect();
    const crosshair = svg?.querySelector('[data-difal-crosshair]');
    const date = tooltip.querySelector('[data-tooltip-date]');
    const value = tooltip.querySelector('[data-tooltip-value]');
    if (!svgRect || !date || !value) return;
    date.textContent = point.dataset.label;
    value.textContent = point.dataset.value;
    if (crosshair) {
      crosshair.setAttribute('x1', point.getAttribute('cx'));
      crosshair.setAttribute('x2', point.getAttribute('cx'));
      crosshair.style.display = 'block';
    }
    tooltip.hidden = false;
    const tooltipWidth = tooltip.getBoundingClientRect().width;
    const showRight = x + tooltipWidth + 10 <= visualRect.width;
    tooltip.style.left = `${showRight ? x + 8 : x - 8}px`;
    tooltip.style.top = `${svgRect.top - visualRect.top + (40 / 230) * svgRect.height}px`;
    tooltip.style.transform = showRight ? 'none' : 'translateX(-100%)';
  }

  function hideDifalChartTooltip(visual) {
    const tooltip = visual?.querySelector('.difal-chart-tooltip');
    if (tooltip) tooltip.hidden = true;
    const crosshair = visual?.querySelector('[data-difal-crosshair]');
    if (crosshair) crosshair.style.display = 'none';
  }

  function handleNfseColumnDragStart(event) {
    const header = event.target.closest('[data-nfse-column-key]');
    if (!header || event.target.closest('button')) return;
    const key = header.dataset.nfseColumnKey;
    if (!key) return;
    state.nfseTable.dragKey = key;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', key);
    header.classList.add('is-dragging');
  }

  function handleNfseColumnDragOver(event) {
    const header = event.target.closest('[data-nfse-column-key]');
    if (!header || !state.nfseTable.dragKey || header.dataset.nfseColumnKey === state.nfseTable.dragKey) return;
    event.preventDefault();
    const rect = header.getBoundingClientRect();
    const insertAfter = event.clientX > rect.left + rect.width / 2;
    header.classList.toggle('drop-after', insertAfter);
    header.classList.toggle('drop-before', !insertAfter);
  }

  function handleNfseColumnDrop(event) {
    const header = event.target.closest('[data-nfse-column-key]');
    if (!header || !state.nfseTable.dragKey) return;
    event.preventDefault();
    const sourceKey = state.nfseTable.dragKey;
    const targetKey = header.dataset.nfseColumnKey;
    if (targetKey && targetKey !== sourceKey) {
      const nextOrder = state.nfseTable.columnOrder.filter((key) => key !== sourceKey);
      const targetIndex = nextOrder.indexOf(targetKey);
      const rect = header.getBoundingClientRect();
      const insertAfter = event.clientX > rect.left + rect.width / 2;
      nextOrder.splice(targetIndex + (insertAfter ? 1 : 0), 0, sourceKey);
      state.nfseTable.columnOrder = nextOrder;
      render(root);
    }
    state.nfseTable.dragKey = null;
  }

  function handleNfseColumnDragEnd() {
    state.nfseTable.dragKey = null;
    root.querySelectorAll('[data-nfse-column-key]').forEach((header) => header.classList.remove('is-dragging', 'drop-before', 'drop-after'));
  }

  function handleReaderColumnDragStart(event) {
    const header = event.target.closest('.reader-column-header');
    const table = header?.closest('[data-reader-table]');
    if (!header || !table) return;
    state.readerColumnDrag = { table: table.dataset.readerTable, key: header.dataset.readerColumnKey };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', header.dataset.readerColumnKey);
    header.classList.add('is-dragging');
  }

  function handleReaderColumnDragOver(event) {
    const header = event.target.closest('.reader-column-header');
    const table = header?.closest('[data-reader-table]');
    const drag = state.readerColumnDrag;
    if (!header || !table || !drag || table.dataset.readerTable !== drag.table || header.dataset.readerColumnKey === drag.key) return;
    event.preventDefault();
    const rect = header.getBoundingClientRect();
    const insertAfter = event.clientX > rect.left + rect.width / 2;
    header.classList.toggle('drop-after', insertAfter);
    header.classList.toggle('drop-before', !insertAfter);
  }

  function handleReaderColumnDrop(event) {
    const header = event.target.closest('.reader-column-header');
    const table = header?.closest('[data-reader-table]');
    const drag = state.readerColumnDrag;
    if (!header || !table || !drag || table.dataset.readerTable !== drag.table) return;
    event.preventDefault();
    const order = [...state.readerColumnOrders[drag.table]];
    const nextOrder = order.filter((key) => key !== drag.key);
    const targetIndex = nextOrder.indexOf(header.dataset.readerColumnKey);
    if (targetIndex >= 0) {
      const rect = header.getBoundingClientRect();
      const insertAfter = event.clientX > rect.left + rect.width / 2;
      nextOrder.splice(targetIndex + (insertAfter ? 1 : 0), 0, drag.key);
      state.readerColumnOrders[drag.table] = nextOrder;
      render(root);
    }
    state.readerColumnDrag = null;
  }

  function handleReaderColumnDragEnd() {
    state.readerColumnDrag = null;
    root.querySelectorAll('.reader-column-header').forEach((header) => header.classList.remove('is-dragging', 'drop-before', 'drop-after'));
  }

  async function handleChange(event) {
    const action = event.target.dataset.action;
    const cst060RateInput = event.target.closest('[data-cst060-rate]');
    if (cst060RateInput) {
      const rowIndex = cst060RateInput.dataset.rowIndex;
      const row = state.cst060?.rows[Number(rowIndex)];
      if (!updateCst060RowRate(rowIndex, cst060RateInput.value)) {
        if (row) cst060RateInput.value = String(row.rate);
        return;
      }
      render(root);
      root.querySelector(`[data-cst060-rate][data-row-index="${rowIndex}"]`)?.focus();
      return;
    }
    if (event.target.matches('[data-difal-chart-period]')) {
      state.difalChartPeriod = event.target.value === 'month' ? 'month' : 'day';
      render(root);
      return;
    }
    if (action === 'nfe-item-check') {
      const key = event.target.dataset.itemKey;
      if (event.target.checked) state.selectedNfeItems.add(key);
      else state.selectedNfeItems.delete(key);
      state.confirmedNfeItems.delete(key);
      render(root);
      return;
    }
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
    if (event.target.id === 'nfeReaderFilterForm') {
      event.preventDefault();
      const data = new FormData(event.target);
      state.readerFilters.nfe = {
        hasSearched: true,
        text: String(data.get('text') || '')
      };
      render(root);
    }
    if (event.target.id === 'nfseReaderFilterForm') {
      event.preventDefault();
      const data = new FormData(event.target);
      state.readerFilters.nfse = {
        hasSearched: true,
        text: String(data.get('text') || '')
      };
      render(root);
    }
    if (event.target.id === 'difalForm') {
      event.preventDefault();
      const data = new FormData(event.target);
      state.readerFilters.difal = { hasSearched: true, text: String(data.get('text') || ''), rate: String(data.get('rate') || '') };
      calculateDifal(data);
      render(root);
    }
    if (event.target.id === 'cst060Form') {
      event.preventDefault();
      const data = new FormData(event.target);
      state.readerFilters.cst060 = {
        hasSearched: true,
        text: String(data.get('text') || ''),
        rate: String(data.get('rate') || '')
      };
      calculateCst060(data);
      render(root);
    }
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => /\.xml$/i.test(file.name) || /xml/i.test(file.type));
    if (!files.length) {
      state.errors = ['Selecione arquivos XML para importar.'];
      render(root);
      return;
    }

    if (state.files.length) {
      const replace = window.confirm(`Já existem ${state.files.length} arquivo(s) carregado(s). Deseja substituir por ${files.length} arquivo(s) selecionado(s)?`);
      if (!replace) return;
      state.files = [];
    }

    state.errors = [];
    for (const file of files) {
      try {
        const xml = await file.text();
        const parsed = parseUploadedXml(xml, file.name);
        const uploadedAt = new Date().toISOString();
        if (parsed.kind === 'event') {
          state.files.push({ id: nextFileId++, name: file.name, size: file.size, uploadedAt, document: null, event: parsed });
        } else {
          state.files.push({ id: nextFileId++, name: file.name, size: file.size, uploadedAt, document: { ...parsed, fileName: file.name, xml, uploadedAt } });
        }
      } catch (error) {
        state.errors.push(`${file.name}: ${error.message || 'não foi possível ler o XML.'}`);
      }
    }
    // Keep completed reader reports available until the user clears the session.
    render(root);
  }
}

function render(root) {
  updateNavigation();
  renderReaderPage(root);
}

function renderReaderPage(root) {
  const docs = getDocuments();
  const events = state.files.filter((file) => file.event).length;
  const activeReaderLabel = readerMenuItems.find(([key]) => key === state.activeReader)?.[1] || 'NF-e';
  const readerPageDescriptions = {
    nfe: 'Carregue XMLs de NF-e e pesquise notas, itens e valores fiscais nesta sessão.',
    nfse: 'Carregue XMLs de NFS-e e consulte os dados fiscais dos serviços.',
    difal: 'Carregue XMLs de NF-e para pesquisar e calcular o diferencial de alíquotas.',
    cst060: 'Carregue XMLs de NF-e para pesquisar itens e conferir o CST 060.'
  };
  root.innerHTML = `
    <section class="reader-page">
      <header class="reader-heading">
        <span class="reader-kicker">CONFERÊNCIA FISCAL · LEITOR XML 3.0</span>
        <div class="reader-title-line"><h1>${escapeHtml(activeReaderLabel)}</h1><span class="reader-functional-badge">Funcional</span></div>
        <p>${escapeHtml(readerPageDescriptions[state.activeReader] || readerPageDescriptions.nfe)} Os XMLs são processados neste computador; a geração da DANFE usa o servidor local.</p>
      </header>
      ${renderUploadPanel(events)}
      <section class="reader-panel">${renderActiveTab(docs)}</section>
      ${renderErrors()}
      ${state.modalXml ? renderXmlModal() : ''}
    </section>
  `;
  configureReaderColumnDragging(root);
}

function configureReaderColumnDragging(root) {
  const reader = state.activeReader;
  const baseOrder = readerDefaultColumnOrders[reader];
  if (!baseOrder) return;
  const table = [...root.querySelectorAll('.reader-table')].find((entry) => !entry.classList.contains('nfse-fiscal-table'));
  if (!table) return;
  table.dataset.readerTable = reader;
  for (const row of table.rows) {
    const cells = [...row.cells];
    if (cells.length !== baseOrder.length) continue;
    cells.forEach((cell, index) => {
      cell.dataset.readerColumnKey = baseOrder[index];
      if (row.parentElement.tagName === 'THEAD') {
        cell.classList.add('reader-column-header');
        cell.draggable = true;
        cell.title = 'Arraste para reorganizar esta coluna';
      }
    });
  }
  const order = state.readerColumnOrders[reader];
  for (const row of table.rows) {
    const cells = new Map([...row.cells].map((cell) => [cell.dataset.readerColumnKey, cell]));
    for (const key of order) {
      const cell = cells.get(key);
      if (cell) row.append(cell);
    }
  }
}

function updateNavigation() {
  document.querySelectorAll('[data-reader]').forEach((button) => {
    const active = button.dataset.reader === state.activeReader;
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function renderUploadPanel(eventCount) {
  const docs = getDocuments();
  const countByType = ['nfe', 'cte', 'nfse'].map((kind) => docs.filter((document) => document.kind === kind).length);
  return `
    <section class="upload-panel upload-panel-compact" aria-label="Importação de XML">
      <label class="upload-dropzone" for="xmlFileInput">
        <span class="upload-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span class="upload-copy"><strong>Adicionar XMLs</strong><span>Selecione um ou vários arquivos do computador</span></span>
        <span class="upload-cta">Procurar arquivos</span>
        <input id="xmlFileInput" type="file" accept=".xml,text/xml,application/xml" multiple />
      </label>
      <div class="upload-footer">
        <span class="upload-count"><strong>${state.files.length}</strong> arquivo(s) carregado(s) · ${countByType[0]} NF-e · ${countByType[1]} CT-e · ${countByType[2]} NFS-e${eventCount ? ` · ${eventCount} evento(s)` : ''}</span>
        <button class="text-button" type="button" data-action="clear-files" ${state.files.length ? '' : 'disabled'}>Limpar</button>
      </div>
    </section>
  `;
}

function renderErrors() {
  if (!state.errors.length) return '';
  return `<div class="reader-errors" role="status"><strong>${state.errors.length} arquivo(s) não puderam ser lidos</strong><ul>${state.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul></div>`;
}

function renderActiveTab(docs) {
  if (state.activeReader === 'nfe') return renderNfeReaderSection(docs.filter((item) => item.kind === 'nfe'));
  if (state.activeReader === 'nfse') return renderNfseReaderSection(docs.filter((item) => item.kind === 'nfse'));
  if (state.activeReader === 'difal') return renderDifalTab(docs.filter((item) => item.kind === 'nfe'));
  return renderCst060Tab(docs.filter((item) => item.kind === 'nfe'));
}

function renderNfeReaderSection(allDocs) {
  const filter = state.readerFilters.nfe;
  const docs = filter.hasSearched ? filterNfeDocs(allDocs, filter) : [];
  const totalFromDocsOrItems = (valueKey, rawKey, rowKey) => docs.reduce((total, doc) => {
    if (doc[rawKey]) return total + doc[valueKey];
    return total + nfeRows(doc).reduce((itemTotal, row) => itemTotal + row[rowKey], 0);
  }, 0);
  const totalIpi = totalFromDocsOrItems('totalIpi', 'totalIpiRaw', 'ipi');
  const totalIcms = totalFromDocsOrItems('totalIcms', 'totalIcmsRaw', 'icms');
  const totalIcmsMono = totalFromDocsOrItems('totalIcmsMono', 'totalIcmsMonoRaw', 'icmsMonoTotal');
  const totalIcmsStRet = totalFromDocsOrItems('totalIcmsStRet', 'totalIcmsStRetRaw', 'icmsSt');
  return `<section class="reference-reader-section">
    <header class="reference-module-heading"><div><h2>Leitor de NF-e</h2><p>Leia e confira os XMLs de NF-e carregados nesta sessão.</p></div><div class="reference-module-actions">${statusPill(`${sum(docs, (doc) => doc.items.length)} item(ns)`, docs.length ? 'success' : 'neutral')}<button type="button" class="secondary-button" data-action="export-current" ${docs.length ? '' : 'disabled'}>Exportar Excel</button></div></header>
    <form class="reference-form" id="nfeReaderFilterForm">
      <label class="reference-field span-4">Buscar nota<input name="text" value="${escapeHtml(filter.text)}" placeholder="Número, chave, CNPJ, cliente ou produto..." /></label>
      <div class="reference-hint span-4"><span aria-hidden="true"></span>Exibe as notas e os itens do XML com emissão, emitente, NCM, CFOP, CST e valores de ICMS para conferência.</div>
      <div class="reference-form-actions span-4"><button class="primary-button" type="submit" ${allDocs.length ? '' : 'disabled'}>Buscar nota</button></div>
    </form>
    ${filter.hasSearched ? `<div class="reference-summary-strip"><span>Valor Total IPI: <strong>${money(totalIpi)}</strong></span><span>Total de notas no período: <strong>${docs.length} nota(s)</strong></span><span>Valor Total das notas: <strong>${money(sum(docs, (doc) => doc.total))}</strong></span><span>Valor Total ICMS: <strong>${money(totalIcms)}</strong></span><span>Valor ICMS Monofásico: <strong>${money(totalIcmsMono)}</strong></span><span>Valor ICMS ST RET: <strong>${money(totalIcmsStRet)}</strong></span></div>${renderNfeTab(docs)}` : emptyState(allDocs.length ? 'XMLs prontos para consulta' : 'Carregue XMLs de NF-e para começar.', 'Pesquise pelo número, chave, CNPJ, cliente ou produto.')}
  </section>`;
}
function renderNfseReaderSection(allDocs) {
  const filter = state.readerFilters.nfse;
  const docs = filter.hasSearched ? filterNfseDocs(allDocs, filter) : [];
  const lastImported = docs.map((doc) => doc.uploadedAt).filter(Boolean).sort().at(-1);
  return `<section class="reference-reader-section">
    <header class="reference-module-heading"><div><h2>Leitura fiscal de NFS-e</h2><p>Consulte as NFS-e carregadas nesta sessão e confira os dados fiscais consolidados.</p></div>${statusPill(`${docs.length} linha(s)`, docs.length ? 'success' : 'neutral')}</header>
    <form class="reference-form reference-form-wide nfse-reader-search-form" id="nfseReaderFilterForm">
      <label class="reference-field span-4">Buscar nota<input name="text" value="${escapeHtml(filter.text)}" placeholder="Número, chave, CNPJ, prestador, tomador ou serviço..." /></label>
      <div class="reference-hint span-4"><span aria-hidden="true"></span>Consolida prestador, tomador, serviços, valores, ISS e retenções declarados nos XMLs de NFS-e.</div>
      <div class="reference-form-actions span-4"><button class="primary-button" type="submit" ${allDocs.length ? '' : 'disabled'}>Buscar NFS-e</button><button class="secondary-button" type="button" data-action="nfse-clear-search" ${filter.hasSearched || filter.text ? '' : 'disabled'}>Limpar</button></div>
    </form>
    ${filter.hasSearched ? `<div class="reference-summary-strip nfse-source-summary"><span>Fonte: <strong>Upload local</strong></span><span>Resultado: <strong>${docs.length} XML(s)</strong></span><span>Valor somado: <strong>${money(sum(docs.filter((doc) => !isCancelled(doc)), (doc) => doc.serviceValue))}</strong></span><span>Atualizado: <strong>${lastImported ? escapeHtml(dateTimeLabel(lastImported)) : '—'}</strong></span></div>${renderNfseTab(docs)}` : emptyState(allDocs.length ? 'XMLs prontos para consulta' : 'Carregue XMLs de NFS-e para começar.', 'Pesquise pelo número, chave, CNPJ, prestador, tomador ou serviço.')}
  </section>`;
}
function filterNfeDocs(docs, filter) {
  const query = normalize(filter.text);
  if (!query) return docs;
  return docs.filter((doc) => {
    const searchable = `${doc.fileName} ${doc.key} ${doc.number} ${doc.issuer} ${doc.recipient} ${doc.issuerCnpj} ${doc.recipientCnpj} ${doc.statusCode} ${doc.cancelled ? 'cancelada' : 'ativa'} ${doc.items.map((item) => `${item.description} ${item.ncm} ${item.cfop} ${item.cstCsosn}`).join(' ')}`;
    return normalize(searchable).includes(query);
  });
}

function filterNfseDocs(docs, filter) {
  const query = normalize(filter.text);
  if (!query) return docs;
  return docs.filter((doc) => {
    const searchable = `${doc.fileName} ${doc.key} ${doc.number} ${doc.issuer} ${doc.issuerCnpj} ${doc.taker} ${doc.takerCnpj} ${doc.takerMunicipality} ${doc.serviceLocation} ${doc.issIncidence} ${doc.serviceCode} ${doc.serviceDescription} ${doc.status} ${doc.issRetention} ${doc.federalRetention} ${doc.serviceValue} ${doc.netValue} ${doc.withheldValue} ${doc.issValue} ${doc.irrfValue} ${doc.csllValue}`;
    return normalize(searchable).includes(query);
  });
}

function statusPill(label, tone = 'neutral') {
  return `<span class="reference-status-pill ${tone}">${escapeHtml(label)}</span>`;
}

function renderNfeTab(docs) {
  const allRows = filterRows(docs.flatMap((doc) => nfeRows(doc)), 'nfe', (row) => `${row.number} ${row.issuer} ${row.product} ${row.ncm} ${row.cst} ${row.cfop} ${row.key}`);
  const rows = allRows;
  const total = docs.filter((doc) => !isCancelled(doc)).reduce((sum, doc) => sum + doc.total, 0);
  return `
    <div class="reader-metrics">${metric('Documentos', docs.length)}${metric('Itens', docs.reduce((sum, doc) => sum + doc.items.length, 0))}${metric('Valor das notas', money(total))}${metric('Canceladas', docs.filter((doc) => isCancelled(doc)).length)}</div>
    ${renderNfeResultsTools(rows)}
    ${rows.length ? `<div class="reader-table-wrap ${state.nfeFullscreen ? 'reader-fullscreen' : ''}">${state.nfeFullscreen ? `<div class="reader-fullscreen-bar"><strong>XMLs encontrados · NF-e</strong><button class="secondary-button" type="button" data-action="close-reader-fullscreen">Fechar tela cheia</button></div>` : ''}<table class="reader-table wide"><thead><tr><th>Conferido</th><th>NF-e</th><th>Status</th><th>Emissão</th><th>Emitente</th><th>Produto</th><th>NCM</th><th>CFOP</th><th>CST</th><th>Qtd.</th><th>V. produto</th><th>Base ICMS</th><th>Alíq.</th><th>ICMS</th><th>ICMS ST retido</th><th>Mono retido</th><th>Abrir</th></tr></thead><tbody>${rows.map((row) => { const key = getNfeItemKey(row); const checked = state.selectedNfeItems.has(key) || state.confirmedNfeItems.has(key); return `<tr><td><label class="nfe-item-check"><input type="checkbox" data-action="nfe-item-check" data-item-key="${escapeHtml(key)}" ${checked ? 'checked' : ''} aria-label="Marcar NF-e ${escapeHtml(row.number)} item ${escapeHtml(row.item.index)} como conferido" /><span></span></label></td><td><strong>${escapeHtml(row.number)}</strong></td><td>${badge(isCancelled(row.doc) ? 'Cancelada' : row.doc.statusCode === '100' ? 'Autorizada' : 'Lida', isCancelled(row.doc) ? 'danger' : 'success')}</td><td>${escapeHtml(dateLabel(row.doc.issuedAt))}</td><td><span class="issuer-name" title="${escapeHtml(row.issuer || '-')}">${escapeHtml(limitDisplayText(row.issuer || '-', 21))}</span><small>${escapeHtml(row.issuerCnpj || '')}</small></td><td class="product-cell">${escapeHtml(row.product)}</td><td>${escapeHtml(row.ncm)}</td><td>${escapeHtml(row.cfop)}</td><td>${escapeHtml(row.cst)}</td><td>${escapeHtml(row.quantity)}</td><td class="money">${money(row.productValue)}</td><td class="money">${money(row.baseIcms)}</td><td>${escapeHtml(row.aliquota)}%</td><td class="money">${money(row.icms)}</td><td class="money">${money(row.icmsSt)}</td><td class="money">${money(row.icmsMono)}</td><td><div class="nfe-document-actions"><button class="icon-button" type="button" data-action="view-xml" data-id="${row.doc.id}" aria-label="Abrir XML ${escapeHtml(row.number)}">XML</button><button class="icon-button" type="button" data-action="view-nfe-pdf" data-id="${row.doc.id}" aria-label="Baixar DANFE da NF-e ${escapeHtml(row.number)} em PDF" title="Baixar DANFE em PDF">PDF</button></div></td></tr>`; }).join('')}</tbody></table></div>` : emptyState(docs.length ? 'Nenhum item corresponde à consulta.' : 'Nenhuma NF-e encontrada com esse termo de busca.', 'Confira o texto digitado ou envie outros arquivos XML.')}
  `;
}

function renderNfeResultsTools(visibleRows) {
  const confirmedVisible = visibleRows.filter((row) => state.confirmedNfeItems.has(getNfeItemKey(row))).length;
  const selectedVisible = visibleRows.filter((row) => state.selectedNfeItems.has(getNfeItemKey(row))).length;
  return `<div class="nfe-results-toolbar">
    <div><h3>XMLs encontrados</h3><p>Mostrando ${visibleRows.length} linha(s) itemizada(s) das NF-e encontradas.</p></div>
    <div class="nfe-results-controls">
      ${statusPill(`${confirmedVisible} conferido(s)`, confirmedVisible ? 'success' : 'neutral')}
      <button type="button" class="primary-button nfe-save-checks" data-action="save-nfe-checks" ${selectedVisible ? '' : 'disabled'}>Salvar${selectedVisible ? ` (${selectedVisible})` : ''}</button>
      <button type="button" class="reader-fullscreen-button" data-action="toggle-reader-fullscreen" aria-label="Abrir tabela em tela cheia" title="Tela cheia" ${visibleRows.length ? '' : 'disabled'}>⛶</button>
    </div>
    <small>Marque as linhas conferidas ou abra o XML original.</small>
  </div>`;
}
function getNfeItemKey(row) {
  return `${row.doc.id}:${row.item.index}`;
}

function getNfeVisibleRows() {
  if (!state.readerFilters.nfe.hasSearched) return [];
  const docs = filterNfeDocs(getDocuments().filter((doc) => doc.kind === 'nfe'), state.readerFilters.nfe);
  return docs.flatMap((doc) => nfeRows(doc));
}
function renderCteTab(docs) {
  const rows = filterRows(docs, 'cte', (doc) => `${doc.number} ${doc.issuer} ${doc.key} ${doc.service.productLabel}`);
  return `
    ${renderToolbar('cte', 'CT-e', `${rows.length} documento(s)`, docs.length)}
    <div class="reader-metrics">${metric('Documentos', docs.length)}${metric('Valor dos serviços', money(docs.reduce((sum, doc) => sum + (doc.service.totalValue || 0), 0)))}${metric('Cancelados', docs.filter(isCancelled).length)}</div>
    ${rows.length ? `<div class="reader-table-wrap"><table class="reader-table"><thead><tr><th>CT-e</th><th>Situação</th><th>Emissão</th><th>Emitente</th><th>Serviço</th><th>Valor</th><th>Componentes</th><th>XML</th></tr></thead><tbody>${rows.map((doc) => `<tr><td><strong>${escapeHtml(doc.number)}</strong></td><td>${badge(isCancelled(doc) ? 'Cancelado' : 'Ativo', isCancelled(doc) ? 'danger' : 'success')}</td><td>${escapeHtml(dateLabel(doc.issuedAt))}</td><td>${escapeHtml(doc.issuer || '-')}<small>${escapeHtml(doc.issuerCnpj || '')}</small></td><td>${escapeHtml(doc.service.productLabel || '-')}</td><td class="money">${money(doc.service.totalValue)}</td><td>${escapeHtml(doc.service.components.map((item) => `${item.name}: ${item.valueLabel}`).join(' · ') || '-')}</td><td><button class="icon-button" type="button" data-action="view-xml" data-id="${doc.id}">XML</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('Carregue XMLs de CT-e para começar.', 'O leitor identifica o documento e resume os componentes do serviço.')}
  `;
}

function renderNfseTab(docs) {
  const activeDocs = docs.filter((doc) => !isCancelled(doc));
  const columns = getNfseFiscalColumns();
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const visibleColumns = state.nfseTable.columnOrder.map((key) => byKey.get(key)).filter((column) => column && !state.nfseTable.hiddenColumns.has(column.key));
  const hiddenCount = state.nfseTable.hiddenColumns.size;
  const errorCount = docs.filter((doc) => doc.processingError).length;
  const lastImported = docs.map((doc) => doc.uploadedAt).filter(Boolean).sort().at(-1);
  const orderedDocs = sortNfseFiscalDocuments(docs);
  const menuAnchor = state.nfseTable.columnMenuAnchor || { top: 8, left: 8 };
  const summary = `<div class="reader-metrics nfse-fiscal-summary">
    ${metric('Filtradas', docs.length)}${metric('Lidas', docs.length - errorCount)}${metric('Com erro', errorCount)}${metric('Sem XML', 0)}
    ${metric('Valor serviço', money(sum(activeDocs, (doc) => doc.serviceValue)))}${metric('ISS retido real', money(sum(activeDocs, (doc) => doc.issRetainedValue)))}${metric('ISS total', money(sum(activeDocs, (doc) => doc.issValue)))}${metric('Valor retido', money(sum(activeDocs, (doc) => doc.withheldValue)))}
    ${metric('Valor líquido', money(sum(activeDocs, (doc) => doc.netValue)))}${metric('IRRF', money(sum(activeDocs, (doc) => doc.irrfValue)))}${metric('Retenções federais', money(sum(activeDocs, (doc) => doc.federalWithheldValue)))}${metric('CSLL', money(sum(activeDocs, (doc) => doc.csllValue)))}
  </div>`;
  const table = visibleColumns.length && orderedDocs.length
    ? `<div class="reader-table-wrap nfse-fiscal-table-wrap">
        <table class="reader-table wide nfse-fiscal-table" style="min-width:${Math.max(1480, visibleColumns.length * 138)}px">
          <thead><tr>${visibleColumns.map((column) => `<th class="nfse-fiscal-column-header" data-nfse-column-key="${column.key}" draggable="true" title="Arraste para reorganizar esta coluna"><div class="nfse-fiscal-column-head">
            <button class="nfse-fiscal-sort" type="button" data-action="nfse-sort" data-sort-key="${column.key}" aria-label="Ordenar por ${escapeHtml(column.label)}">${escapeHtml(column.label)} <span aria-hidden="true">${state.nfseTable.sortKey === column.key ? state.nfseTable.sortDirection === 'asc' ? '↑' : '↓' : '↕'}</span></button>
            <span class="nfse-column-menu-wrap" data-nfse-column-menu-wrap><button class="nfse-column-menu-button" type="button" data-action="nfse-column-menu" data-column-key="${column.key}" aria-label="Opções da coluna ${escapeHtml(column.label)}" aria-expanded="${state.nfseTable.columnMenuKey === column.key}">&#8942;</button>
              ${state.nfseTable.columnMenuKey === column.key ? `<span class="nfse-column-menu-panel" role="menu" style="top:${escapeHtml(String(menuAnchor.top))}px;left:${escapeHtml(String(menuAnchor.left))}px"><button type="button" data-action="nfse-column-hide" data-column-key="${column.key}" role="menuitem" ${visibleColumns.length <= 1 ? 'disabled' : ''}>Ocultar coluna</button></span>` : ''}
            </span>
          </div></th>`).join('')}</tr></thead>
          <tbody>${orderedDocs.map((doc) => `<tr>${visibleColumns.map((column) => renderNfseFiscalCell(column, doc)).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>`
    : emptyState(orderedDocs.length ? 'Reative ao menos uma coluna para visualizar a tabela.' : 'Nenhuma NFS-e encontrada com esse termo de busca.', orderedDocs.length ? '' : 'Confira o texto digitado ou envie outros arquivos XML.');
  return `<article class="reader-panel nfse-fiscal-results-panel">
    <header class="nfse-fiscal-results-heading"><div><h3>Leitura fiscal das NFS-e filtradas</h3><p>Tabela consolidada no estilo do LeitorXML, usando as NFS-e carregadas nesta sessão. Arraste os cabeçalhos para reorganizar, ordene pelos títulos ou oculte colunas para focar na conferência.</p></div><div class="reference-module-actions">${statusPill(`${docs.length} linha(s)`, docs.length ? 'success' : 'neutral')}<button type="button" class="secondary-button" data-action="export-current" ${docs.length ? '' : 'disabled'}>Exportar Excel</button></div></header>
    <div class="nfse-fiscal-meta"><span>Fonte: <strong>Upload local</strong></span><span>Resultado: <strong>${docs.length} XML(s)</strong></span><span>Colunas visíveis: <strong>${visibleColumns.length}</strong></span><span>Atualizado: <strong>${lastImported ? escapeHtml(dateTimeLabel(lastImported)) : '—'}</strong></span></div>
    ${summary}
    <div class="nfse-fiscal-table-heading"><div><h4>Notas fiscais do período</h4><p>Dados fiscais e retenções informados nos XMLs enviados.</p></div><button type="button" class="secondary-button" data-action="nfse-columns-restore" ${hiddenCount ? '' : 'disabled'}>Restaurar colunas${hiddenCount ? ` (${hiddenCount})` : ''}</button></div>
    <p class="nfse-fiscal-table-hint">Clique em XML para abrir o arquivo original. Use o menu de cada cabeçalho para ocultar colunas; arraste para reorganizar.</p>
    ${table}
    ${renderNfseMunicipalitySummaries(activeDocs)}
  </article>`;
}

function getNfseFiscalColumns() {
  return [
    { key: 'number', label: 'Número', kind: 'text', value: (doc) => doc.number || '—' },
    { key: 'serviceLocation', label: 'Local prestação', kind: 'text', value: (doc) => doc.serviceLocation || '—' },
    { key: 'issIncidence', label: 'Local ISS', kind: 'text', value: (doc) => doc.issIncidence || '—' },
    { key: 'issuer', label: 'Prestador', kind: 'text', value: (doc) => doc.issuer || '—' },
    { key: 'issuerCnpj', label: 'CNPJ prestador', kind: 'cnpj', value: (doc) => doc.issuerCnpj || '' },
    { key: 'taker', label: 'Tomador', kind: 'text', value: (doc) => doc.taker || '—' },
    { key: 'takerMunicipality', label: 'Município tomador', kind: 'text', value: (doc) => doc.takerMunicipality || '—' },
    { key: 'takerCnpj', label: 'CNPJ tomador', kind: 'cnpj', value: (doc) => doc.takerCnpj || '' },
    { key: 'discountValue', label: 'Desconto', kind: 'money', value: (doc) => doc.discountValue },
    { key: 'netValue', label: 'Valor líquido', kind: 'money', value: (doc) => doc.netValue },
    { key: 'withheldValue', label: 'Valor retido', kind: 'money', value: (doc) => doc.withheldValue },
    { key: 'serviceValue', label: 'Valor serviço', kind: 'money', value: (doc) => doc.serviceValue },
    { key: 'issValue', label: 'ISS', kind: 'money', value: (doc) => doc.issValue },
    { key: 'pisValue', label: 'PIS', kind: 'money', value: (doc) => doc.pisValue },
    { key: 'cofinsValue', label: 'COFINS', kind: 'money', value: (doc) => doc.cofinsValue },
    { key: 'inssValue', label: 'INSS', kind: 'money', value: (doc) => doc.inssValue },
    { key: 'irrfValue', label: 'IRRF', kind: 'money', value: (doc) => doc.irrfValue },
    { key: 'csllValue', label: 'CSLL', kind: 'money', value: (doc) => doc.csllValue },
    { key: 'issuedAt', label: 'Data emissão', kind: 'date', value: (doc) => doc.issuedAt || '' },
    { key: 'issRetention', label: 'ISS RET', kind: 'text', value: (doc) => doc.issRetention || '—' },
    { key: 'federalRetention', label: 'Federal RET', kind: 'text', value: (doc) => doc.federalRetention || '—' },
    { key: 'issRate', label: 'Alíq ISS', kind: 'percent', value: (doc) => doc.issRate },
    { key: 'issRetainedValue', label: 'ISS retido real', kind: 'money', value: (doc) => doc.issRetainedValue },
    { key: 'actualIssRate', label: 'Alíq real ISS', kind: 'percent', value: (doc) => doc.actualIssRate },
    { key: 'processingStatus', label: 'Status', kind: 'status', value: getNfseProcessingStatus },
    { key: 'processingError', label: 'Erro', kind: 'text', value: (doc) => doc.processingError || '—' }
  ];
}

function renderNfseFiscalCell(column, doc) {
  const rawValue = column.value(doc);
  let displayValue = rawValue ?? '—';
  if (column.kind === 'money') displayValue = money(rawValue);
  if (column.kind === 'percent') displayValue = rawValue ? `${numeric(rawValue).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : '—';
  if (column.kind === 'date') displayValue = dateLabel(rawValue);
  if (column.kind === 'cnpj') displayValue = formatNfseDocumentId(rawValue);
  if (column.kind === 'status') {
    const status = getNfseProcessingStatus(doc);
    return `<td class="nfse-cell-${column.key}">${badge(status, status === 'OK' ? 'success' : status === 'ERRO' ? 'danger' : 'warning')}</td>`;
  }
  if (column.key === 'number') {
    return `<td class="nfse-cell-${column.key} nfse-fiscal-number-cell"><strong>${escapeHtml(String(displayValue))}</strong><button type="button" class="nfse-xml-link" data-action="view-xml" data-id="${escapeHtml(doc.id)}">XML</button></td>`;
  }
  const title = ['issuer', 'taker', 'serviceLocation', 'issIncidence', 'takerMunicipality', 'processingError'].includes(column.key) ? ` title="${escapeHtml(String(displayValue))}"` : '';
  return `<td class="nfse-cell-${column.key} ${column.kind === 'money' ? 'money' : ''}"${title}>${escapeHtml(String(displayValue))}</td>`;
}

function getNfseProcessingStatus(doc) {
  if (doc.cancelled || /cancel/i.test(String(doc.status || ''))) return 'Cancelada';
  if (doc.processingError) return 'ERRO';
  return 'OK';
}

function formatNfseDocumentId(value) {
  const raw = digits(value);
  if (raw.length === 14) return raw.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (raw.length === 11) return raw.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return raw || '—';
}

function sortNfseFiscalDocuments(docs) {
  const column = getNfseFiscalColumns().find((item) => item.key === state.nfseTable.sortKey);
  if (!column) return [...docs];
  const direction = state.nfseTable.sortDirection === 'asc' ? 1 : -1;
  return [...docs].sort((left, right) => {
    const a = column.value(left);
    const b = column.value(right);
    let result;
    if (column.kind === 'money' || column.kind === 'percent') result = numeric(a) - numeric(b);
    else if (column.kind === 'date') result = new Date(a || 0).getTime() - new Date(b || 0).getTime();
    else result = normalize(a).localeCompare(normalize(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
    return result ? result * direction : String(left.id).localeCompare(String(right.id));
  });
}

function renderNfseMunicipalitySummaries(docs) {
  const groupBy = (municipalitySelector, amountSelector) => {
    const groups = new Map();
    docs.forEach((doc) => {
      const name = String(municipalitySelector(doc) || '').trim() || 'Não informado';
      const row = groups.get(name) || { name, count: 0, total: 0 };
      row.count += 1;
      row.total += numeric(amountSelector(doc));
      groups.set(name, row);
    });
    return [...groups.values()].sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, 'pt-BR'));
  };
  const summaries = [
    { title: 'Somatório por município - Local prestação', amountLabel: 'Valor total de serviço', rows: groupBy((doc) => doc.serviceLocation, (doc) => doc.serviceValue) },
    { title: 'Somatório por município - Local ISS', amountLabel: 'Valor total de ISS', rows: groupBy((doc) => doc.issIncidence, (doc) => doc.issValue) }
  ];
  if (!docs.length) return '';
  return `<div class="nfse-municipality-grid">${summaries.map(({ title, amountLabel, rows }) => `<section class="nfse-municipality-card"><h4>${escapeHtml(title)}</h4><div class="nfse-municipality-scroll"><table><thead><tr><th>Município</th><th>Notas</th><th>${escapeHtml(amountLabel)}</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.count}</td><td class="money">${money(row.total)}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>`;
}
function renderDifalTab(docs) {
  const query = state.readerFilters.difal || {};
  const report = state.difal;
  return `
    <header class="reference-module-heading"><div><h2>DIFAL das NF-e</h2><p>Busque uma NF-e carregada para conferir o DIFAL.</p></div>${statusPill(report ? `${report.rows.length} item(ns)` : '0 item(ns)', report?.rows.length ? 'success' : 'neutral')}</header>
    <form class="reference-form" id="difalForm">
      <label class="reference-field span-4">Buscar nota<input name="text" value="${escapeHtml(query.text || '')}" placeholder="Número, chave, CNPJ, cliente ou produto..." /></label>
      <label class="reference-field span-2">Alíquota interna para o cálculo (%)<input name="rate" type="number" min="0.01" max="99.99" step="0.01" placeholder="Ex.: 18" value="${escapeHtml(query.rate || '')}" required /></label>
      <div class="reference-hint span-4"><span aria-hidden="true"></span>Calcula o DIFAL com a alíquota interna informada e considera itens de NF-e com ICMS interestadual de 4%.</div>
      <div class="reference-form-actions span-4"><button class="primary-button" type="submit" ${docs.length ? '' : 'disabled'}>Buscar nota e calcular DIFAL</button></div>
    </form>
    ${report ? renderDifalReport(report) : emptyState('Busque uma nota para iniciar.', 'O cálculo usa as NF-e enviadas por upload e exige a alíquota interna.')}
  `;
}
function renderDifalReport(report) {
  const rate = numeric(state.readerFilters.difal?.rate);
  return `<div class="difal-report-grid">
    <section class="difal-period-summary"><h3>Resumo das NF-e</h3>
      <article><span class="difal-summary-icon" aria-hidden="true">▤</span><div><small>Notas fiscais analisadas</small><strong>${report.notes} nota(s)</strong></div></article>
      <article><span class="difal-summary-icon" aria-hidden="true">◷</span><div><small>Alíquota interna usada</small><strong>${rate}%</strong></div></article>
      <article><span class="difal-summary-icon" aria-hidden="true">＄</span><div><small>Valor total do DIFAL</small><strong>${money(report.difal)}</strong></div></article>
    </section>
    <section class="difal-chart-panel"><header><h3>Evolução do DIFAL nos XMLs</h3><label class="difal-chart-period"><select data-difal-chart-period aria-label="Agrupar evolução do DIFAL"><option value="day" ${state.difalChartPeriod === 'day' ? 'selected' : ''}>Por dia</option><option value="month" ${state.difalChartPeriod === 'month' ? 'selected' : ''}>Por mês</option></select></label></header>${renderDifalChart(report.rows, state.difalChartPeriod)}</section>
  </div>
  <div class="reference-summary-strip"><span>Itens analisados: <strong>${report.rows.length} item(ns)</strong></span><span>Soma ICMS monofásico: <strong>${money(report.mono)}</strong></span><span>Soma ICMS próprio: <strong>${money(report.icmsOwn)}</strong></span><span>Soma ICMS 4%: <strong>${money(report.icms4)}</strong></span></div>
  <p class="inline-note">O ICMS monofásico exibido é o valor informado nos XMLs. Somente itens com ICMS interestadual de 4% entram no cálculo do DIFAL.</p>
  ${report.rows.length ? `<div class="reader-table-wrap"><table class="reader-table wide"><thead><tr><th>NF-e</th><th>Emissão</th><th>Produto</th><th>CST</th><th>Base ICMS</th><th>Alíq. interestadual</th><th>ICMS</th><th>ICMS mono XML</th><th>DIFAL</th><th>Situação</th></tr></thead><tbody>${report.rows.map((row) => `<tr class="${row.difal !== null && !isCancelled(row.doc) ? 'difal-eligible-row' : ''}"><td>${escapeHtml(row.doc.number)}</td><td>${escapeHtml(dateLabel(row.doc.issuedAt))}</td><td class="product-cell">${escapeHtml(row.item.description)}</td><td>${escapeHtml(row.item.cstCsosn)}</td><td class="money">${money(row.base)}</td><td>${escapeHtml(row.rate)}%</td><td class="money">${money(row.icms)}</td><td class="money">${money(row.mono)}</td><td class="money">${row.difal === null ? '—' : money(row.difal)}</td><td>${badge(isCancelled(row.doc) ? 'Cancelada' : row.rate === 4 ? 'ICMS 4%' : 'Fora do cálculo', isCancelled(row.doc) ? 'danger' : row.rate === 4 ? 'success' : 'neutral')}</td></tr>`).join('')}</tbody></table></div>` : emptyState('Nenhum item elegível para o DIFAL foi encontrado nos XMLs carregados.', '')}`;
}

function renderDifalChart(rows, period = 'day') {
  const grouped = new Map();
  const datedKeys = [];
  let undatedTotal = 0;
  for (const row of rows) {
    if (isCancelled(row.doc)) continue;
    const key = dateKey(row.doc.issuedAt);
    if (key) {
      datedKeys.push(key);
      if (!grouped.has(key)) grouped.set(key, 0);
      if (row.difal !== null) grouped.set(key, grouped.get(key) + numeric(row.difal));
    } else if (row.difal !== null) {
      undatedTotal += numeric(row.difal);
    }
  }

  const uniqueDates = [...new Set(datedKeys)].sort();
  let entries = [];
  if (uniqueDates.length && period === 'month') {
    const monthTotals = new Map();
    const [firstYear, firstMonth] = uniqueDates[0].slice(0, 7).split('-').map(Number);
    const [lastYear, lastMonth] = uniqueDates[uniqueDates.length - 1].slice(0, 7).split('-').map(Number);
    let year = firstYear;
    let month = firstMonth;
    while (year < lastYear || (year === lastYear && month <= lastMonth)) {
      monthTotals.set(`${year}-${String(month).padStart(2, '0')}`, 0);
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    for (const [key, value] of grouped) {
      const monthKey = key.slice(0, 7);
      monthTotals.set(monthKey, (monthTotals.get(monthKey) || 0) + value);
    }
    entries = [...monthTotals.entries()];
  } else if (uniqueDates.length) {
    const start = Date.parse(`${uniqueDates[0]}T00:00:00Z`);
    const end = Date.parse(`${uniqueDates[uniqueDates.length - 1]}T00:00:00Z`);
    for (let cursor = start; cursor <= end; cursor += 86400000) {
      const key = new Date(cursor).toISOString().slice(0, 10);
      entries.push([key, grouped.get(key) || 0]);
    }
  }
  if (undatedTotal) entries.push(['sem-data', undatedTotal]);
  if (!entries.length) return `<div class="difal-chart-empty">O gráfico aparecerá quando houver XMLs com data para exibir.</div>`;

  const maxValue = Math.max(0, ...entries.map(([, value]) => value));
  const tickStep = niceChartStep(maxValue || 1);
  const chartMax = Math.max(tickStep * 4, Math.ceil(maxValue / tickStep) * tickStep);
  const chartLeft = 72;
  const chartRight = 658;
  const points = entries.map(([key, value], index) => ({
    key,
    value,
    x: entries.length === 1 ? (chartLeft + chartRight) / 2 : chartLeft + index * ((chartRight - chartLeft) / (entries.length - 1)),
    y: 178 - (value / chartMax) * 138
  }));
  const pointText = points.map((point) => `${point.x},${point.y}`).join(' ');
  const areaText = `${points[0].x},178 ${pointText} ${points[points.length - 1].x},178`;
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  const markerEvery = Math.max(1, Math.ceil((points.length - 1) / 12));
  const periodLabel = (key) => {
    if (key === 'sem-data') return 'Sem data';
    if (period === 'month') {
      const [year, month] = key.split('-').map(Number);
      const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })
        .format(new Date(Date.UTC(year, month - 1, 1))).replace('.', '');
      return `${monthName}/${year}`;
    }
    return dateLabel(key);
  };
  const pointLabel = (key) => key === 'sem-data' ? 'Sem data' : period === 'month' ? periodLabel(key) : `${key.slice(8, 10)}/${key.slice(5, 7)}`;
  const ticks = Array.from({ length: 5 }, (_, index) => chartMax - index * (chartMax / 4));
  return `<div class="difal-chart-visual"><svg class="difal-chart" viewBox="0 0 700 230" data-plot-left="${chartLeft}" data-plot-right="${chartRight}" role="img" aria-label="Evolução ${period === 'month' ? 'mensal' : 'diária'} do DIFAL calculado">
    <defs><linearGradient id="difal-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02"/></linearGradient></defs>
    ${ticks.map((tick, index) => `<line x1="${chartLeft}" y1="${40 + index * 34.5}" x2="${chartRight}" y2="${40 + index * 34.5}"/><text x="4" y="${44 + index * 34.5}">${escapeHtml(money(tick))}</text>`).join('')}
    <polygon class="difal-chart-area" points="${areaText}"/><polyline points="${pointText}"/><line class="difal-chart-crosshair" data-difal-crosshair x1="0" y1="40" x2="0" y2="178" style="display:none"/>
    ${points.map((point, index) => `${index % markerEvery === 0 || index === points.length - 1 || point.value !== 0 ? `<circle cx="${point.x}" cy="${point.y}" r="4" data-difal-point data-label="${escapeHtml(pointLabel(point.key))}" data-value="${escapeHtml(money(point.value))}" tabindex="0" role="button" aria-label="${escapeHtml(pointLabel(point.key) + ': ' + money(point.value))}"><title>${escapeHtml(pointLabel(point.key))}: ${escapeHtml(money(point.value))}</title></circle>` : ''}${index % labelEvery === 0 || index === points.length - 1 ? `<text class="chart-date" x="${point.x}" y="210" text-anchor="middle">${escapeHtml(point.key === 'sem-data' ? '—' : period === 'month' ? periodLabel(point.key) : pointLabel(point.key))}</text>` : ''}`).join('')}
  </svg><div class="difal-chart-tooltip" role="status" aria-live="polite" hidden><span data-tooltip-date></span><strong data-tooltip-value></strong></div></div><details class="difal-chart-data"><summary>Ver dados em tabela</summary><div class="difal-chart-table-wrap"><table><thead><tr><th>Período</th><th>DIFAL</th></tr></thead><tbody>${entries.map(([key, value]) => `<tr><td>${escapeHtml(periodLabel(key))}</td><td class="money">${money(value)}</td></tr>`).join('')}</tbody></table></div></details>`;
}

function niceChartStep(maxValue) {
  const roughStep = maxValue / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}
function renderCst060Tab(docs) {
  const report = state.cst060;
  const filter = state.readerFilters.cst060;
  return `
    <header class="reference-module-heading"><div><h2>Conferência CST 060</h2><p>Busque uma NF-e carregada para conferir o ICMS ST retido.</p></div><div class="reference-module-actions">${statusPill(`${report?.rows.length || 0} item(ns)`, report?.rows.length ? 'success' : 'neutral')}<button type="button" class="secondary-button" data-action="export-current" ${report?.rows.length ? '' : 'disabled'}>Exportar Excel</button></div></header>
    <form class="reference-form" id="cst060Form">
      <label class="reference-field span-4">Buscar nota<input name="text" value="${escapeHtml(filter.text || '')}" placeholder="Número, chave, CNPJ, cliente ou produto..." /></label>
      <label class="reference-field span-2">Alíquota interna para o cálculo (%)<input name="rate" type="number" min="0.01" max="100" step="0.01" placeholder="Ex.: 18" value="${escapeHtml(filter.rate || '')}" required /></label>
      <div class="reference-hint span-4"><span aria-hidden="true"></span>Localiza itens com CST 060, compara o ICMS ST do XML com o valor recalculado e permite ajustar a alíquota por produto.</div>
      <div class="reference-form-actions span-4"><button class="primary-button" type="submit" ${docs.length ? '' : 'disabled'}>Buscar nota e conferir CST 060</button></div>
    </form>
    ${report ? renderCst060Report(report) : emptyState('Busque uma nota para iniciar a conferência.', 'Defina uma alíquota inicial; depois você pode ajustar cada produto. Pneus começam em 4%.')}
  `;
}
function renderCst060Report(report) {
  const metrics = `<div class="reader-metrics">${metric('NF-e analisadas', report.notes)}${metric('NF-e com CST 060', report.notesWithItems)}${metric('Itens CST 060', report.rows.length)}${metric('ICMS ST no XML', money(sum(report.rows, (row) => row.retained)))}${metric('ICMS recalculado', money(sum(report.rows, (row) => row.calculated)))}${metric('Diferença', money(sum(report.rows, (row) => row.difference)), 'highlight')}</div>`;
  const table = report.rows.length
    ? `<div class="reader-table-wrap"><table class="reader-table wide cst060-table"><thead><tr><th>Emissão</th><th>NF-e</th><th>Item</th><th>Emitente</th><th>Produto</th><th>NCM</th><th>CFOP</th><th>Valor produto</th><th>Desconto</th><th>Base</th><th>Alíquota aplicada</th><th>ICMS ST XML</th><th>ICMS recalculado</th><th>Diferença</th><th>Status</th></tr></thead><tbody>${report.rows.map((row, index) => `<tr><td>${escapeHtml(dateLabel(row.doc.issuedAt))}</td><td>${escapeHtml(row.doc.number)}</td><td>${escapeHtml(row.item.index)}</td><td>${escapeHtml(row.doc.issuer || '-')}</td><td class="product-cell">${escapeHtml(row.item.description)}</td><td>${escapeHtml(row.item.ncm)}</td><td>${escapeHtml(row.item.cfop)}</td><td class="money">${money(row.productValue)}</td><td class="money">${money(row.discount)}</td><td class="money">${money(row.base)}</td><td class="cst060-rate-cell"><label class="cst060-rate-control"><input type="number" min="0.01" max="100" step="0.01" value="${escapeHtml(String(row.rate))}" data-cst060-rate data-row-index="${index}" aria-label="Alíquota aplicada ao produto ${escapeHtml(row.item.description)}"><span>%</span></label>${row.tire ? '<small class="cst060-rate-note">Pneu · padrão 4%</small>' : ''}</td><td class="money">${money(row.retained)}</td><td class="money">${money(row.calculated)}</td><td class="money">${money(row.difference)}</td><td>${badge(row.status, row.status === 'OK' ? 'success' : 'warning')}</td></tr>`).join('')}</tbody></table></div>`
    : emptyState('Nenhum item com CST 060 foi encontrado.', 'Os XMLs carregados continuam disponíveis nos outros leitores.');
  return `${metrics}<p class="cst060-rate-hint">Altere a alíquota diretamente em cada produto. O ICMS recalculado, a diferença e o resumo são atualizados automaticamente.</p>${table}`;
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
  const totalIpiRaw = text(total, ['vIPI']);
  const totalIcmsRaw = text(total, ['vICMS']);
  const totalIcmsMonoValues = ['vICMSMono', 'vICMSMonoReten', 'vICMSMonoRet'].map((tag) => text(total, [tag])).filter(Boolean);
  const totalIcmsMonoRaw = totalIcmsMonoValues.length ? String(totalIcmsMonoValues.reduce((value, item) => value + numeric(item), 0)) : '';
  const totalIcmsStRetRaw = text(total, ['vICMSSTRet']);
  const prot = first(document, ['infProt']);
  const key = extractAccessKey(infNfe.getAttribute('Id') || text(document, ['chNFe']), 44);
  const statusCode = text(prot, ['cStat']);
  return {
    kind: 'nfe', id: `nfe-${key || nextFileId}`, fileName, xml, key,
    number: text(ide, ['nNF']) || '-', serie: text(ide, ['serie']) || '-',
    issuedAt: text(ide, ['dhEmi', 'dEmi']), issuer: text(emit, ['xNome']), issuerCnpj: digits(text(emit, ['CNPJ', 'CPF'])),
    recipient: text(dest, ['xNome']), recipientCnpj: digits(text(dest, ['CNPJ', 'CPF'])),
    total: numeric(text(total, ['vNF'])), productsTotal: numeric(text(total, ['vProd'])),
    totalIpi: numeric(totalIpiRaw), totalIpiRaw,
    totalIcms: numeric(totalIcmsRaw), totalIcmsRaw,
    totalIcmsMono: numeric(totalIcmsMonoRaw), totalIcmsMonoRaw,
    totalIcmsStRet: numeric(totalIcmsStRetRaw), totalIcmsStRetRaw,
    statusCode, cancelled: ['101', '151'].includes(statusCode),
    items: extractNfeLineItems(xml), events: []
  };
}

async function downloadNfeDanfe(doc, requestApi, triggerButton) {
  if (typeof requestApi !== 'function') {
    window.alert('A sessão não está pronta para gerar a DANFE. Entre novamente no sistema.');
    return;
  }

  const previousText = triggerButton?.textContent;
  const previousTitle = triggerButton?.title;
  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.setAttribute('aria-busy', 'true');
    triggerButton.textContent = '...';
    triggerButton.title = 'Gerando DANFE';
  }

  try {
    const pdf = await requestApi('/nfe/danfe', {
      method: 'POST',
      body: { xml: doc.xml },
      responseType: 'blob'
    });
    if (!(pdf instanceof Blob) || !pdf.size) throw new Error('O gerador não retornou um PDF válido.');

    const fileNumber = String(doc.number || 'nota').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'nota';
    const objectUrl = URL.createObjectURL(pdf);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `DANFE-NF-e-${fileNumber}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  } catch (error) {
    window.alert(error?.message || 'Não foi possível gerar a DANFE em PDF.');
  } finally {
    if (triggerButton?.isConnected) {
      triggerButton.disabled = false;
      triggerButton.removeAttribute('aria-busy');
      triggerButton.textContent = previousText || 'PDF';
      triggerButton.title = previousTitle || 'Baixar DANFE em PDF';
    }
  }
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
  const pisRetainedValue = numeric(text(document, ['vRetPIS', 'ValorPISRetido']));
  const cofinsRetainedValue = numeric(text(document, ['vRetCOFINS', 'ValorCOFINSRetido']));
  const inssRetainedValue = numeric(text(document, ['vRetINSS', 'ValorINSSRetido']));
  const irrfRetainedValue = numeric(text(document, ['vRetIRRF', 'ValorIRRetido']));
  const csllRetainedValue = numeric(text(document, ['vRetCSLL', 'ValorCSLLRetido']));
  const pisValue = numeric(text(document, ['vPIS', 'ValorPIS'])) || pisRetainedValue;
  const cofinsValue = numeric(text(document, ['vCOFINS', 'ValorCOFINS'])) || cofinsRetainedValue;
  const inssValue = numeric(text(document, ['vINSS', 'ValorINSS'])) || inssRetainedValue;
  const irrfValue = numeric(text(document, ['vIRRF', 'ValorIR'])) || irrfRetainedValue;
  const csllValue = numeric(text(document, ['vCSLL', 'ValorCSLL'])) || csllRetainedValue;
  const federalWithheldValue = pisRetainedValue + cofinsRetainedValue + inssRetainedValue + irrfRetainedValue + csllRetainedValue;
  const status = text(document, ['status', 'Situacao', 'cStat']);
  const serviceValue = numeric(text(serviceValues, ['vServ', 'ValorServicos', 'valorServico']) || text(document, ['vServ', 'ValorServicos', 'valorServico']));
  const issValue = numeric(text(document, ['vISSQN', 'vISS', 'valorIss', 'ValorIss', 'ValorISS']));
  const issRetainedValue = numeric(text(document, ['vISSRet', 'vISSRetido', 'ValorIssRetido', 'ValorISSRetido', 'ValorISSQNRetido']));
  const discountValue = numeric(text(document, ['vDescIncond', 'ValorDescontoIncondicionado'])) + numeric(text(document, ['vDescCond', 'ValorDescontoCondicionado', 'vDeducao', 'ValorDeducoes']));
  const withheldValue = federalWithheldValue + issRetainedValue;
  const netValue = numeric(text(document, ['vLiq', 'ValorLiquidoNfse', 'ValorLiquido'])) || Math.max(0, serviceValue - withheldValue);
  const rawRetention = text(document, ['tpRetISSQN', 'IssRetido', 'issRetido']);
  const issRetention = ['1', 'true', 'sim'].includes(normalize(rawRetention)) || issRetainedValue > 0 ? 'Retido' : ['2', 'false', 'nao'].includes(normalize(rawRetention)) || rawRetention ? 'Não retido' : '—';
  const issRate = numeric(text(document, ['pAliqAplic', 'pAliq', 'aliquotaIss', 'aliquotaISS']));
  return {
    kind: 'nfse', id: `nfse-${key || nextFileId}`, fileName, xml, key,
    number: text(document, ['numeroNFSe', 'numeroNfse', 'nNFSe', 'Numero', 'NumeroNfse']) || '-',
    issuedAt: text(document, ['dataEmissao', 'DataEmissao', 'dhEmi', 'dhProc']),
    issuer: text(issuer, ['xNome', 'razaoSocial', 'RazaoSocial', 'Nome']), issuerCnpj: digits(text(issuer, ['CNPJ', 'cnpj', 'CpfCnpj', 'CPF'])),
    taker: text(taker, ['xNome', 'razaoSocial', 'RazaoSocial', 'Nome']), takerCnpj: digits(text(taker, ['CNPJ', 'cnpj', 'CpfCnpj', 'CPF'])),
    serviceLocation: text(document, ['xLocPrestacao', 'xMunLocPrestacao', 'localPrestacao', 'cLocPrestacao']), issIncidence: text(document, ['xLocIncid', 'localIncidenciaIss', 'cLocIncid']),
    takerMunicipality: text(taker, ['xMun', 'xMunicipio', 'Municipio']),
    serviceCode: text(document, ['cTribNac', 'cTribMun', 'ItemListaServico', 'itemListaServico']),
    serviceDescription: text(service, ['xDescServ', 'Discriminacao', 'descricaoServico']) || text(document, ['xDescServ', 'Discriminacao', 'descricaoServico']),
    serviceValue, netValue, discountValue,
    issValue, issRetainedValue,
    pisValue, cofinsValue, inssValue, irrfValue, csllValue,
    issRetention, federalRetention: federalWithheldValue > 0 ? 'Retido' : 'Não retido',
    issRate, actualIssRate: serviceValue ? issRetainedValue / serviceValue * 100 : issRate,
    federalWithheldValue, withheldValue, status, cancelled: /cancel/i.test(status),
    processingError: !text(document, ['numeroNFSe', 'numeroNfse', 'nNFSe', 'Numero', 'NumeroNfse']) && !key ? 'Número/chave não identificados' : ''
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
    ipi: numeric(item.ipiRaw), icms: numeric(item.valorIcmsRaw), icmsSt: numeric(item.icmsStRetRaw),
    icmsMono: numeric(item.vICMSMonoRetRaw), icmsMonoTotal: numeric(item.vICMSMonoTotalRaw || item.vICMSMonoRetRaw), item
  }));
}

function filterRows(rows, key, getText) {
  const query = normalize(state.search[key] || '');
  return query ? rows.filter((row) => normalize(getText(row)).includes(query)) : rows;
}

function calculateDifal(form) {
  const rate = numeric(form.get('rate'));
  if (!(rate > 0 && rate < 100)) {
    state.errors = ['Informe uma alíquota interna entre 0 e 100%.'];
    return;
  }
  const docs = filterNfeDocs(getDocuments().filter((doc) => doc.kind === 'nfe'), { text: String(form.get('text') || '') });
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

function updateCst060RowRate(rowIndex, rawRate) {
  const row = state.cst060?.rows[Number(rowIndex)];
  const rate = numeric(rawRate);
  if (!row || !(rate > 0 && rate <= 100)) return false;
  row.rate = roundMoney(rate);
  row.calculated = row.retained === 0 ? 0 : roundMoney(row.base * row.rate / 100);
  row.difference = roundMoney(row.retained - row.calculated);
  row.status = Math.abs(row.difference) <= 0.01 ? 'OK' : 'Divergente';
  return true;
}

function calculateCst060(form) {
  const rate = numeric(form.get('rate'));
  if (!(rate > 0 && rate <= 100)) {
    state.errors = ['Informe uma alíquota interna válida.'];
    return;
  }
  const docs = filterNfeDocs(getDocuments().filter((doc) => doc.kind === 'nfe'), { text: String(form.get('text') || '') });
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

function exportCurrentReader() {
  const allDocs = getDocuments();
  const docs = state.activeReader === 'nfe' && state.readerFilters.nfe.hasSearched
    ? filterNfeDocs(allDocs.filter((doc) => doc.kind === 'nfe'), state.readerFilters.nfe)
    : state.activeReader === 'nfse' && state.readerFilters.nfse.hasSearched
      ? filterNfseDocs(allDocs.filter((doc) => doc.kind === 'nfse'), state.readerFilters.nfse)
      : allDocs;
  let headers = [];
  let rows = [];
  if (state.activeReader === 'nfe') {
    headers = ['NF-e', 'Status', 'Emissão', 'Emitente', 'CNPJ', 'Produto', 'NCM', 'CFOP', 'CST', 'Quantidade', 'Valor produto', 'Base ICMS', 'Alíquota', 'ICMS', 'ICMS ST retido', 'ICMS monofásico'];
    let itemRows = docs.filter((doc) => doc.kind === 'nfe').flatMap(nfeRows);
    rows = itemRows.map((row) => [row.number, isCancelled(row.doc) ? 'Cancelada' : 'Ativa', row.doc.issuedAt, row.issuer, row.issuerCnpj, row.product, row.ncm, row.cfop, row.cst, row.quantity, row.productValue, row.baseIcms, row.aliquota, row.icms, row.icmsSt, row.icmsMono]);
  } else if (state.activeReader === 'cte') {
    headers = ['CT-e', 'Emissão', 'Chave', 'Emitente', 'Serviço', 'Valor'];
    rows = docs.filter((doc) => doc.kind === 'cte').map((doc) => [doc.number, doc.issuedAt, doc.key, doc.issuer, doc.service.productLabel, doc.total]);
  } else if (state.activeReader === 'nfse') {
    const definitions = new Map(getNfseFiscalColumns().map((column) => [column.key, column]));
    const columns = state.nfseTable.columnOrder.map((key) => definitions.get(key)).filter((column) => column && !state.nfseTable.hiddenColumns.has(column.key));
    const nfseDocs = sortNfseFiscalDocuments(docs.filter((doc) => doc.kind === 'nfse'));
    headers = columns.map((column) => column.label);
    rows = nfseDocs.map((doc) => columns.map((column) => column.value(doc)));
  } else if (state.activeReader === 'difal' && state.difal) {
    headers = ['NF-e', 'Emissão', 'Produto', 'CST', 'Base ICMS', 'Alíquota', 'ICMS', 'ICMS mono XML', 'DIFAL', 'Situação'];
    rows = state.difal.rows.map((row) => [row.doc.number, row.doc.issuedAt, row.item.description, row.item.cstCsosn, row.base, row.rate, row.icms, row.mono, row.difal ?? '', isCancelled(row.doc) ? 'Cancelada' : 'Ativa']);
  } else if (state.activeReader === 'cst060' && state.cst060) {
    headers = ['Emissão', 'NF-e', 'Item', 'Emitente', 'Produto', 'NCM', 'CFOP', 'Valor produto', 'Desconto', 'Base', 'Alíquota', 'ICMS ST XML', 'ICMS calculado', 'Diferença', 'Status'];
    rows = state.cst060.rows.map((row) => [row.doc.issuedAt, row.doc.number, row.item.index, row.doc.issuer, row.item.description, row.item.ncm, row.item.cfop, row.productValue, row.discount, row.base, row.rate, row.retained, row.calculated, row.difference, row.status]);
  }
  if (!rows.length) return;
  const table = `<table><thead><tr>${headers.map((value) => `<th>${escapeHtml(value)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  downloadText(`leitor-xml-3-${state.activeReader}.xls`, `\ufeff<html><head><meta charset="utf-8"></head><body>${table}</body></html>`, 'application/vnd.ms-excel;charset=utf-8');
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
function dateKey(value) { const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/); if (match) return match[1]; const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : ''; }
function extractAccessKey(value, length) { const found = digits(value).match(new RegExp(`\\d{${length}}`)); return found?.[0] || ''; }
function formatBytes(value) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
function emptyState(title, subtitle) { return `<div class="reader-empty"><span class="empty-mark" aria-hidden="true">XML</span><strong>${escapeHtml(title)}</strong>${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ''}</div>`; }
function metric(label, value, tone = '') { return `<article class="metric-card ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`; }
function badge(label, tone) { return `<span class="reader-badge ${tone}">${escapeHtml(label)}</span>`; }
function limitDisplayText(value, maxLength) { const characters = Array.from(String(value ?? '')); return characters.length > maxLength ? `${characters.slice(0, maxLength - 1).join('').trimEnd()}…` : characters.join(''); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function downloadText(fileName, content, type) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url); }
function first(root, names) { for (const name of names) { const node = findXmlElementsByLocalName(root, name)[0]; if (node) return node; } return root; }
function text(root, names) { for (const name of names) { const value = getXmlText(root, name); if (value) return value; } return ''; }
function attribute(root, names, key) { for (const name of names) { const node = findXmlElementsByLocalName(root, name)[0]; const value = node?.getAttribute(key); if (value) return value; } return ''; }

