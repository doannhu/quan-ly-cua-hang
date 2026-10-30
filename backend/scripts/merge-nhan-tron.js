// Turn the small counters of "Quầy nhẫn tròn" (5 chỉ, 2 chỉ, …) into one small counter "Nhẫn tròn 9999"; the sizes are
// now rows (mục) of the report, see config/position-templates.json. Old reports keep their own counter names.
// Safe to run twice. Back up the data first. Usage: node --env-file=.env scripts/merge-nhan-tron.js
import { config } from '../src/config.js';
import { connectDb } from '../src/db/index.js';

const BIG = 'Quầy nhẫn tròn';
const SMALL = 'Nhẫn tròn 9999';

const { counters } = await connectDb(config);
const bigs = (await counters.find({})).filter((c) => !c.parentId && c.name === BIG);
for (const big of bigs) {
  const smalls = await counters.find({ parentId: big.id }, { sort: { createdAt: 1 } });
  if (!smalls.length) continue;
  const keep = smalls.find((c) => c.name === SMALL) || smalls[0];
  if (keep.name !== SMALL) await counters.update(keep.id, { name: SMALL });
  const extra = smalls.filter((c) => c.id !== keep.id);
  for (const c of extra) await counters.remove(c.id);
  console.log(`${BIG}: giữ «${SMALL}», gộp ${extra.length} quầy nhỏ (${extra.map((c) => c.name).join(', ') || 'không có'})`);
}
if (!bigs.length) console.log(`Không có quầy lớn «${BIG}»`);
process.exit(0);
