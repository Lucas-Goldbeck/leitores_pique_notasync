function normalizeXmlReader30Text(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isXmlReader30GasolineProduct(productLabel) {
  return normalizeXmlReader30Text(productLabel).includes('gasolina');
}

function resolveXmlReader30AliqVigenteForPeriods(dataEmissao, cstCsosn, periodos) {
  if (String(cstCsosn || '').trim() !== '61') {
    return 0;
  }

  const emissionTimestamp = Date.parse(dataEmissao || '');
  if (!Number.isFinite(emissionTimestamp)) {
    return 0;
  }

  const periodoVigente = (Array.isArray(periodos) ? periodos : []).find((periodo) => {
    const inicioTimestamp = Date.parse(`${periodo.dataInicio}T00:00:00`);
    if (!Number.isFinite(inicioTimestamp) || emissionTimestamp < inicioTimestamp) {
      return false;
    }

    if (!periodo.dataFim) {
      return true;
    }

    const fimTimestamp = Date.parse(`${periodo.dataFim}T23:59:59`);
    return Number.isFinite(fimTimestamp) && emissionTimestamp <= fimTimestamp;
  });

  return periodoVigente ? Number(periodoVigente.aliquota) || 0 : 0;
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

  return String(numericValue);
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

  return numericValue.toFixed(2);
}

function computeXmlReader30MonofasicValues(dataEmissao, cstCsosn, qBCMonoRet, productLabel = '', periodos = []) {
  const aliqVigente = resolveXmlReader30AliqVigenteForPeriods(dataEmissao, cstCsosn, periodos);
  const baseValue = toNumberSafe(qBCMonoRet);
  const isGasoline = isXmlReader30GasolineProduct(productLabel);
  const valorCorreto = !isGasoline && Number.isFinite(baseValue) ? baseValue * aliqVigente : 0;

  return {
    aliqVigente: formatXmlReader30DecimalValue(aliqVigente),
    aliqVigenteRaw: aliqVigente.toFixed(2),
    valorCorreto: formatXmlReader30CurrencyValue(valorCorreto),
    valorCorretoRaw: valorCorreto.toFixed(2)
  };
}

function toNumberSafe(value) {
  if (value === null || value === undefined || value === '') {
    return Number.NaN;
  }

  const normalizedValue = typeof value === 'string' ? value.replace(',', '.').trim() : value;
  return Number(normalizedValue);
}

export {
  computeXmlReader30MonofasicValues,
  isXmlReader30GasolineProduct,
  resolveXmlReader30AliqVigenteForPeriods
};
