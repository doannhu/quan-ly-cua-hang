// Machine-readable description so AI agents can discover the read-only query API.
const auth = [{ ApiKey: [] }, { Bearer: [] }];
const filters = [
  { name: 'from', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Start date YYYY-MM-DD (inclusive)' },
  { name: 'to', in: 'query', schema: { type: 'string', format: 'date' }, description: 'End date YYYY-MM-DD (inclusive)' },
  { name: 'storeId', in: 'query', schema: { type: 'string' } },
  { name: 'shift', in: 'query', schema: { type: 'integer', enum: [1, 2, 3] }, description: '1 = Ca 1, 2 = Ca 2, 3 = Giao ca 1-2 (handover count)' },
  { name: 'smallCounterId', in: 'query', schema: { type: 'string' }, description: 'Only one small counter (quầy nhỏ)' },
];
const reportShape =
  'Each report is one small counter (quầy nhỏ) counted in one submission: ' +
  '{id, submissionId, date, time, shift, userName, partnerName (who counted together at a shift-3 handover, else null), ' +
  'storeId, storeName, bigCounterId, bigCounterName, ' +
  'smallCounterId, smallCounterName, note, total, weight (total TL entered by staff, or null), positions: [{no, note, quantity, photos[]}]}. ' +
  'The report-level note is a free-text comment for the whole small counter. positions[] are the rows (mục) of the ' +
  'small counter from config/position-templates.json: no is the row label (e.g. "Mâm 1", "Trong tủ 2", "Khách cọc", ' +
  '"Lí do khác"; older reports: a position number) and quantity may be 0; positions[].note is the typed reason of ' +
  '"Lí do khác". Reports sharing a submissionId were submitted together. ' +
  'Staff may edit their own submission on the same day; edited reports carry editedAt and editCount (>0).';

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Store inventory reporting API',
    version: '1.0.0',
    description:
      'Staff submit physical stock counts each shift: one store, one or more counters, ' +
      'and for each small counter a list of positions (vị trí hàng) with a count. ' +
      'AI agents: send header X-API-Key (value of AI_API_KEY) to use the read-only /api/admin/reports* and /api/ai/* endpoints.',
  },
  components: {
    securitySchemes: {
      ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      Bearer: { type: 'http', scheme: 'bearer' },
    },
  },
  paths: {
    '/api/admin/reports': {
      get: { summary: 'List full reports (with positions and photo URLs)', security: auth, parameters: filters, responses: { 200: { description: `Array of reports. ${reportShape}` } } },
    },
    '/api/admin/comparison': {
      get: {
        summary: 'Counted stock vs system stock (PMV BC008) per PMV small counter for one store/day/shift. System stock = BC008 "Đầu ngày" for shift 1 ("Còn lại" when the file was uploaded ahead of that day), "Còn lại" for shifts 2 and 3 (see systemSource).',
        security: auth,
        parameters: [
          { name: 'storeId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'shift', in: 'query', required: true, schema: { type: 'integer', enum: [1, 2, 3] } },
        ],
        responses: { 200: { description: '{ snapshot (null if no PMV file uploaded for that day), rows: [{pmvName (group label, e.g. "Bông 980 + Bông 995"), pmvNames, pmvBigName, goldCodes, system, actual, diff, counted, counters: [{counterId, bigName, name, actual, pmvNames, auto}]}] — one row per group of linked PMV products; an app counter can link to several products and several counters to one product, unmatched: [app counters not linked to PMV], totals: {system, actual, diff} }. diff = actual - system; negative = missing goods. auto=true means the link is a name-based suggestion not yet confirmed by admin.' } },
      },
    },
    '/api/admin/system-stock': {
      get: { summary: 'Days with uploaded PMV system stock for a store', security: auth, parameters: [{ name: 'storeId', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: '[{id, date (day the file is used for), fileDate (day of its numbers), shift, name, uploadedAt, uploadedBy, lines}]' } } },
    },
    '/api/admin/reports/by-counter': {
      get: { summary: 'Total goods per day / shift / small counter (quầy nhỏ)', security: auth, parameters: filters, responses: { 200: { description: '{ rows: [{date, shift, storeId, storeName, bigCounterId, bigCounterName, smallCounterId, smallCounterName, total, reportCount}], grandTotal }' } } },
    },
    '/api/admin/reports/summary': {
      get: { summary: 'Total goods per day / shift / store', security: auth, parameters: filters, responses: { 200: { description: '{ rows: [{date, shift, storeId, storeName, total, reportCount}], grandTotal }' } } },
    },
    '/api/admin/reports/{id}': {
      get: { summary: 'One report', security: auth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: reportShape }, 404: { description: 'Not found' } } },
    },
    '/api/ai/stores': {
      get: { summary: 'Stores with big counters (Quầy lớn) and small counters (Quầy nhỏ)', security: auth, responses: { 200: { description: 'Catalog tree' } } },
    },
    '/api/ai/staff': {
      get: { summary: 'Staff list (names and status only)', security: auth, responses: { 200: { description: 'Array of staff' } } },
    },
  },
};
