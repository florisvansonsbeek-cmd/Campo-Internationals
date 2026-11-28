// A small zip writer for the archive and the back-up: folders as paths, files deflated, nothing from outside.
// Enough for a year of papers; the zip is built in memory (a year of demo papers is a few megabytes).
import zlib from 'node:zlib';

const enc = new TextEncoder();
// dos date and time, as zip wants them
function dos(d = new Date()) {
  const t = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { t, day };
}
// names stay readable on Windows and macOS: no slashes or odd characters inside one part
export const safeName = s => String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'bestand';

export function makeZip(files) {
  const parts = [], central = [];
  let offset = 0;
  const seen = new Set();
  for (const f of files) {
    let name = String(f.naam).replace(/^\/+/, '');
    // the same name twice gets a number, so nothing is overwritten when unpacking
    if (seen.has(name)) { const m = name.match(/^(.*?)(\.[^./]+)?$/); let i = 2; while (seen.has(`${m[1]} (${i})${m[2] || ''}`)) i++; name = `${m[1]} (${i})${m[2] || ''}`; }
    seen.add(name);
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data instanceof Uint8Array ? f.data : enc.encode(String(f.data ?? '')));
    const packed = zlib.deflateRawSync(data, { level: 6 });
    const store = packed.length >= data.length;
    const body = store ? data : packed;
    const crc = zlib.crc32(data) >>> 0;
    const nm = Buffer.from(name, 'utf8');
    const { t, day } = dos(f.datum ? new Date(f.datum) : new Date());
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt16LE(t, 10); local.writeUInt16LE(day, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nm.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nm, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(store ? 0 : 8, 10);
    c.writeUInt16LE(t, 12); c.writeUInt16LE(day, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nm.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36); c.writeUInt32LE(0, 38); c.writeUInt32LE(offset, 42);
    central.push(c, nm);
    offset += local.length + nm.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cd, end]);
}
