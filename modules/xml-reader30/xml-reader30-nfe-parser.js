function parseXmlDocumentSafe(xmlString) {
  if (!xmlString) {
    return null;
  }

  try {
    if (typeof DOMParser === 'function') {
      const parser = new DOMParser();
      const document = parser.parseFromString(xmlString, 'application/xml');
      if (document.getElementsByTagName('parsererror').length) {
        return null;
      }
      return document;
    }

    if (typeof require === 'function') {
      const { DOMParser: NodeDOMParser } = require('@xmldom/xmldom');
      const parser = new NodeDOMParser();
      const document = parser.parseFromString(xmlString, 'application/xml');
      return document?.documentElement ? document : null;
    }
  } catch (error) {
    return null;
  }

  return null;
}

function findXmlElementsByLocalName(parent, localName) {
  if (!parent || !localName) {
    return [];
  }

  const withNamespace =
    typeof parent.getElementsByTagNameNS === 'function' ? Array.from(parent.getElementsByTagNameNS('*', localName) || []) : [];
  if (withNamespace.length) {
    return withNamespace;
  }

  return Array.from(parent.getElementsByTagName(localName) || []);
}

function getXmlText(parent, localName) {
  const node = findXmlElementsByLocalName(parent, localName)[0] || null;
  return String(node?.textContent || '').trim();
}

function getFirstXmlText(parents, localNames) {
  const nodes = (Array.isArray(parents) ? parents : []).filter(Boolean);
  const tags = Array.isArray(localNames) ? localNames : [];

  for (const parent of nodes) {
    for (const localName of tags) {
      const value = getXmlText(parent, localName);
      if (value) {
        return value;
      }
    }
  }

  return '';
}

function formatXmlReader30DecimalValue(value) {
  if (value === null || value === undefined || value === '') {
    return '0';
  }

  const normalizedValue = typeof value === 'string' ? value.replace(',', '.').trim() : value;
  const numericValue = Number(normalizedValue);
  if (!Number.isFinite(numericValue)) {
    return '0';
  }

  return numericValue
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}

function formatXmlReader30CurrencyValue(value) {
  if (value === null || value === undefined || value === '') {
    return '0';
  }

  const normalizedValue = typeof value === 'string' ? value.replace(',', '.').trim() : value;
  const numericValue = Number(normalizedValue);
  if (!Number.isFinite(numericValue)) {
    return '0';
  }

  return numericValue.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function extractNfeLineItems(xmlString) {
  const xml = parseXmlDocumentSafe(xmlString);
  if (!xml) {
    return [];
  }

  return findXmlElementsByLocalName(xml, 'det')
    .map((detNode, index) => {
      const prodNode = findXmlElementsByLocalName(detNode, 'prod')[0] || detNode;
      const taxValues = extractNfeLineItemTaxValues(detNode, prodNode);
      const quantity = getXmlText(prodNode, 'qCom');
      const unitValue = getXmlText(prodNode, 'vUnCom');
      const totalValue = getXmlText(prodNode, 'vProd');
      return {
        index: String(index + 1),
        code: getXmlText(prodNode, 'cProd') || '-',
        description: getXmlText(prodNode, 'xProd') || '-',
        ncm: getXmlText(prodNode, 'NCM') || '-',
        quantity: quantity || '-',
        unit: getXmlText(prodNode, 'uCom') || '-',
        unitValue: unitValue ? formatXmlReader30CurrencyValue(unitValue) : '-',
        unitValueRaw: unitValue || '-',
        totalValue: totalValue ? formatXmlReader30CurrencyValue(totalValue) : '-',
        totalValueRaw: totalValue || '-',
        ...taxValues
      };
    })
    .filter((item) => item.description !== '-' || item.code !== '-');
}

function extractNfeLineItemTaxValues(detNode, prodNode) {
  const impostoNode = findXmlElementsByLocalName(detNode, 'imposto')[0] || detNode;
  const icmsNode = findXmlElementsByLocalName(impostoNode, 'ICMS')[0] || null;
  const icmsGroupNode = icmsNode
    ? Array.from(icmsNode.children || []).find((node) => node && node.nodeType === 1) || null
    : null;
  const icmsTaxNode = icmsGroupNode || icmsNode;
  const icmsSourceNodes = [icmsTaxNode].filter(Boolean);
  const cstCsosn = getFirstXmlText(icmsSourceNodes, ['CST', 'CSOSN']) || '0';
  const icmsStRet = getFirstXmlText(icmsSourceNodes, ['vICMSSTRet', 'vICMSST', 'vBCSTRet']) || '0';
  const qBCMonoRet = getFirstXmlText(icmsSourceNodes, ['qBCMonoRet']) || '0';
  const adRemICMSRet = getFirstXmlText(icmsSourceNodes, ['adRemICMSRet']) || '0';
  const vICMSMonoRet = getFirstXmlText(icmsSourceNodes, ['vICMSMonoRet']) || '0';
  const baseCalculoIcms = getFirstXmlText(icmsSourceNodes, ['vBC', 'vBCST', 'vBCSTRet', 'vBCEfet', 'vBCUFDest']) || '0';
  const aliquotaIcms = getFirstXmlText(icmsSourceNodes, ['pICMS', 'pST', 'pICMSST', 'pICMSInter', 'pICMSInterPart', 'pICMSEfet']) || '0';
  const valorIcms = getFirstXmlText(icmsSourceNodes, ['vICMS', 'vICMSST', 'vICMSDif', 'vICMSDeson', 'vICMSEfet']) || '0';

  return {
    cstCsosn,
    cfop: getFirstXmlText([prodNode, icmsTaxNode, icmsNode, impostoNode, detNode], ['CFOP']) || '0',
    icmsStRet: formatXmlReader30CurrencyValue(icmsStRet),
    icmsStRetRaw: icmsStRet || '0',
    qBCMonoRet: formatXmlReader30DecimalValue(qBCMonoRet),
    qBCMonoRetRaw: qBCMonoRet || '0',
    adRemICMSRet: formatXmlReader30DecimalValue(adRemICMSRet),
    adRemICMSRetRaw: adRemICMSRet || '0',
    vICMSMonoRet: formatXmlReader30CurrencyValue(vICMSMonoRet),
    vICMSMonoRetRaw: vICMSMonoRet || '0',
    baseCalculoIcms: formatXmlReader30DecimalValue(baseCalculoIcms),
    baseCalculoIcmsRaw: baseCalculoIcms || '0',
    aliquotaIcms: formatXmlReader30DecimalValue(aliquotaIcms),
    aliquotaIcmsRaw: aliquotaIcms || '0',
    valorIcms: formatXmlReader30DecimalValue(valorIcms),
    valorIcmsRaw: valorIcms || '0'
  };
}

function extractCteServiceSummary(xmlString) {
  const xml = parseXmlDocumentSafe(xmlString);
  if (!xml) {
    return {
      productLabel: '',
      totalValue: null,
      components: []
    };
  }

  const components = findXmlElementsByLocalName(xml, 'Comp')
    .map((componentNode) => {
      const value = getXmlText(componentNode, 'vComp');
      return {
        name: getXmlText(componentNode, 'xNome') || '-',
        valueLabel: value ? formatXmlReader30CurrencyValue(value) : '-'
      };
    })
    .filter((item) => item.name !== '-');

  const totalValueText = getXmlText(xml, 'vTPrest');

  return {
    productLabel: getXmlText(xml, 'xProd') || '',
    totalValue: totalValueText ? Number(totalValueText) : null,
    components
  };
}

export {
  parseXmlDocumentSafe,
  findXmlElementsByLocalName,
  getXmlText,
  getFirstXmlText,
  extractNfeLineItems,
  extractNfeLineItemTaxValues,
  extractCteServiceSummary
};
