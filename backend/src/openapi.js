// Machine-readable description so AI agents can discover the read-only query API.
const auth = [{ ApiKey: [] }, { Bearer: [] }];
const filters = [
  { name: 'from', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Start date YYYY-MM-DD (inclusive)' },
  { name: 'to', in: 'query', schema: { type: 'string', format: 'date' }, description: 'End date YYYY-MM-DD (inclusive)' },
  { name: 'storeId', in: 'query', schema: { type: 'string' } },
  { name: 'shift', in: 'query', schema: { type: 'integer', enum: [1, 2] } },
];

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Store inventory reporting API',
    version: '1.0.0',
    description:
      'Staff submit physical stock counts per store / counter / tray each shift. ' +
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
      get: { summary: 'List full reports (with trays and photo URLs)', security: auth, parameters: filters, responses: { 200: { description: 'Array of reports' } } },
    },
    '/api/admin/reports/summary': {
      get: { summary: 'Total goods per day / shift / store', security: auth, parameters: filters, responses: { 200: { description: '{ rows: [{date, shift, storeId, storeName, total, reportCount}], grandTotal }' } } },
    },
    '/api/admin/reports/{id}': {
      get: { summary: 'One report', security: auth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Report' }, 404: { description: 'Not found' } } },
    },
    '/api/ai/stores': {
      get: { summary: 'Stores with big counters (Quầy lớn) and small counters (Quầy nhỏ)', security: auth, responses: { 200: { description: 'Catalog tree' } } },
    },
    '/api/ai/staff': {
      get: { summary: 'Staff list (names and status only)', security: auth, responses: { 200: { description: 'Array of staff' } } },
    },
  },
};
