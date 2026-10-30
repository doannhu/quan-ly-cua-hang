// Turn the small counters of "Quầy nhẫn tròn" (5 chỉ, 2 chỉ, …) into one small counter "Nhẫn tròn 9999"; the sizes are
// now rows (mục) of the report, see config/position-templates.json. Old reports keep their own counter names.
// Creates the small counter if the big one has none. Safe to run twice. Back up the data first.
// Usage: node --env-file=.env scripts/merge-nhan-tron.js
import { config } from '../src/config.js';
import { connectDb } from '../src/db/index.js';
import { key } from '../src/routes/templates.js';

const BIGS = ['Quầy nhẫn tròn', 'Quầy nhẫn tròn 9999'].map(key);
const SMALL = 'Nhẫn tròn 9999';

const { counters } = await connectDb(config);
const bigs = (await counters.find({})).filter((c) => !c.parentId && BIGS.includes(key(c.name)));
for (const big of bigs) {
  const smalls = await counters.find({ parentId: big.id }, { sort: { createdAt: 1 } });
  const keep = smalls.find((c) => key(c.name) === key(SMALL)) || smalls[0];
  if (!keep) await counters.insert({ storeId: big.storeId, parentId: big.id, name: SMALL });
  else if (keep.name !== SMALL) await counters.update(keep.id, { name: SMALL });
  const extra = smalls.filter((c) => c.id !== keep?.id);
  for (const c of extra) await counters.remove(c.id);
  console.log(`${big.name}: giữ «${SMALL}»${keep ? '' : ' (tạo mới)'}, gộp ${extra.length} quầy nhỏ (${extra.map((c) => c.name).join(', ') || 'không có'})`);
}
if (!bigs.length) console.log(`Không có quầy lớn nào tên «${BIGS.join('» hoặc «')}»`);
process.exit(0);
