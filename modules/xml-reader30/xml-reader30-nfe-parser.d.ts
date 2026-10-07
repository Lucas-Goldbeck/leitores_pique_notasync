export type XmlReader30ComponentSummary = {
  name: string;
  valueLabel: string;
};

export type XmlReader30NfeLineItem = {
  index: string;
  code: string;
  description: string;
  quantity: string;
  unit: string;
  unitValue: string;
  unitValueRaw: string;
  totalValue: string;
  totalValueRaw: string;
  cstCsosn: string;
  cfop: string;
  icmsStRet: string;
  icmsStRetRaw: string;
  qBCMonoRet: string;
  qBCMonoRetRaw: string;
  adRemICMSRet: string;
  adRemICMSRetRaw: string;
  vICMSMonoRet: string;
  vICMSMonoRetRaw: string;
  baseCalculoIcms: string;
  baseCalculoIcmsRaw: string;
  aliquotaIcms: string;
  aliquotaIcmsRaw: string;
  valorIcms: string;
  valorIcmsRaw: string;
};

export type XmlReader30CteServiceSummary = {
  productLabel: string;
  totalValue: number | null;
  components: XmlReader30ComponentSummary[];
};

export function parseXmlDocumentSafe(xmlString: string): Document | null;
export function findXmlElementsByLocalName(parent: ParentNode | null | undefined, localName: string): Element[];
export function getXmlText(parent: ParentNode | null | undefined, localName: string): string;
export function getFirstXmlText(parents: ArrayLike<ParentNode | null | undefined> | ParentNode[] | null | undefined, localNames: string[]): string;
export function extractNfeLineItems(xmlString: string): XmlReader30NfeLineItem[];
export function extractNfeLineItemTaxValues(detNode: ParentNode, prodNode: ParentNode): Omit<XmlReader30NfeLineItem, 'index' | 'code' | 'description' | 'quantity' | 'unit' | 'unitValue' | 'unitValueRaw' | 'totalValue' | 'totalValueRaw'>;
export function extractCteServiceSummary(xmlString: string): XmlReader30CteServiceSummary;
