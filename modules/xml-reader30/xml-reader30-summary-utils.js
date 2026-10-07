function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isXmlReader30DocumentCancelled(item) {
  if (!item) {
    return false;
  }

  const raw = item.raw && typeof item.raw === 'object' ? item.raw : {};
  const isMarkedCancelled =
    item.cancelada === true ||
    raw.cancelada === true ||
    normalizeSearchText(item.nfCancelada) === 'sim' ||
    normalizeSearchText(raw.nfCancelada) === 'sim' ||
    Boolean(item.dataCancelamento || raw.dataCancelamento);
  if (isMarkedCancelled) {
    return true;
  }

  const normalizedStatus = normalizeSearchText(
    [
      item.statusFiscal,
      item.statusLabel,
      item.status,
      raw.statusFiscal,
      raw.statusLabel,
      raw.status
    ]
      .filter(Boolean)
      .join(' ')
  );

  return normalizedStatus.includes('cancel');
}

function shouldIncludeDocumentValueInSum(item) {
  if (!item || isXmlReader30DocumentCancelled(item)) {
    return false;
  }

  const normalizedStatus = normalizeSearchText(item.statusFiscal || item.statusLabel || item.status || '');
  return normalizedStatus.includes('autoriz');
}

export {
  isXmlReader30DocumentCancelled,
  shouldIncludeDocumentValueInSum
};
