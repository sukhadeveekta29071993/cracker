// ─── Web Bluetooth ESC/POS printer for BTP-802 (and compatible) ───────────────

// Known BLE service/characteristic pairs for common thermal receipt printers
const KNOWN_PAIRS = [
  // BTP-802 / PT-series / many generic printers
  { svc: '000018f0-0000-1000-8000-00805f9b34fb', chr: '00002af1-0000-1000-8000-00805f9b34fb' },
  // Xprinter XP series / HPRT
  { svc: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', chr: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f' },
  // Generic 0xFF00 (most common Chinese printers)
  { svc: '0000ff00-0000-1000-8000-00805f9b34fb', chr: '0000ff02-0000-1000-8000-00805f9b34fb' },
  // Peripage / Paperang style
  { svc: '49535343-fe7d-4ae5-8fa9-9fafd205e455', chr: '49535343-8841-43f4-a8d4-ecbe34729bb3' },
  // SPP-over-BLE variant
  { svc: '00001101-0000-1000-8000-00805f9b34fb', chr: '00001101-0000-1000-8000-00805f9b34fb' },
];

let _device = null;
let _char = null;

export const isBTSupported = () =>
  typeof navigator !== 'undefined' && 'bluetooth' in navigator;

export const isConnected = () =>
  !!(_device?.gatt?.connected && _char);

export const getSavedPrinterName = () =>
  localStorage.getItem('bt_printer_name') || null;

export function disconnect() {
  try { if (_device?.gatt?.connected) _device.gatt.disconnect(); } catch (_) {}
  _device = null;
  _char = null;
  localStorage.removeItem('bt_printer_name');
}

// Connect to printer and auto-discover writable characteristic
export async function connectPrinter() {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ name: 'Printer001' }],
    optionalServices: KNOWN_PAIRS.map((p) => p.svc),
  });

  const server = await device.gatt.connect();
  device.addEventListener('gattserverdisconnected', () => {
    _device = null;
    _char = null;
  });

  // Try each known pair
  for (const { svc, chr } of KNOWN_PAIRS) {
    try {
      const service = await server.getPrimaryService(svc);
      const characteristic = await service.getCharacteristic(chr);
      _device = device;
      _char = characteristic;
      localStorage.setItem('bt_printer_name', device.name || 'Printer001');
      return device.name || 'Printer001';
    } catch (_) { /* try next */ }
  }

  device.gatt.disconnect();
  throw new Error(
    'Could not find a compatible print service on this printer.\n' +
    'Please try again or contact support.'
  );
}

// ─── ESC/POS byte builder ──────────────────────────────────────────────────────

const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;
const COLS = 48; // 80mm paper @ standard font = 48 chars

const cmd = {
  init:       () => [ESC, 0x40],
  align:      (a) => [ESC, 0x61, a],          // 0=left 1=center 2=right
  bold:       (on) => [ESC, 0x45, on ? 1 : 0],
  dblWidth:   (on) => [ESC, 0x0e, on ? 1 : 0],
  textSize:   (w, h) => [GS, 0x21, ((w - 1) << 4) | (h - 1)],
  feed:       (n) => [ESC, 0x64, n],
  cut:        () => [GS, 0x56, 0x42, 0x00],
};

function encodeText(text) {
  const out = [];
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c === 0x20b9) { out.push(82, 115); } // ₹ → Rs
    else if (c < 128)  { out.push(c); }
    else               { out.push(63); }      // ? for non-ASCII
  }
  return out;
}

const ln = (t) => [...encodeText(t), LF];
const emptyLn = () => [LF];
const dashes = (n = COLS) => ln('-'.repeat(n));
const equals = (n = COLS) => ln('='.repeat(n));

function pad(left, right, width = COLS) {
  const maxLeft = width - right.length - 1;
  const l = left.length > maxLeft ? left.slice(0, maxLeft) : left;
  const gap = width - l.length - right.length;
  return l + (gap > 0 ? ' '.repeat(gap) : ' ') + right;
}

function wrapText(text, width = COLS) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + (cur ? ' ' : '') + w).length > width) {
      if (cur) lines.push(cur);
      cur = w.slice(0, width);
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function buildReceiptBytes(order) {
  const bytes = [];
  const push = (...chunks) =>
    chunks.forEach((c) => (Array.isArray(c) ? bytes.push(...c) : bytes.push(c)));

  const dateStr = new Date(order.created_at).toLocaleString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // Init
  push(cmd.init());

  // ── Shop header ────────────────────────────────────────────────────────────
  push(cmd.align(1), cmd.bold(true), cmd.textSize(2, 2));
  push(ln('Balaji Fataka'));
  push(cmd.textSize(1, 1), cmd.bold(false));
  push(ln('Off Navidyam NorthStar ManglDham Soc'));
  push(ln('Nanda Koradi, Nagpur - 441111'));
  push(ln('Ph: 9637662411'));
  push(ln('GSTIN: 27BGPPA1777A1ZL'));
  push(ln('Explosives Lic: 108975582503'));
  push(emptyLn());
  push(cmd.bold(true));
  push(ln('========== INVOICE =========='));
  push(cmd.bold(false));
  push(emptyLn());

  // ── Order info ─────────────────────────────────────────────────────────────
  push(cmd.align(0));
  push(ln('Inv : ' + order.invoice_no));
  push(ln('Date: ' + dateStr));
  const custType = order.customer_type === 'wholesale' ? 'Wholesale' : 'Retail';
  push(ln('Cust: ' + order.customer_name + ' (' + custType + ')'));
  if (order.customer_phone) push(ln('Ph  : ' + order.customer_phone));
  if (order.salesperson_name) push(ln('By  : ' + order.salesperson_name));

  push(dashes());

  // ── Items header ───────────────────────────────────────────────────────────
  push(cmd.bold(true));
  push(ln(pad('ITEM', 'AMOUNT')));
  push(cmd.bold(false));
  push(dashes());

  // ── Items ──────────────────────────────────────────────────────────────────
  order.items.forEach((it) => {
    const amt = 'Rs ' + (it.price * it.qty).toFixed(2);
    const nameLines = wrapText(it.name, COLS - amt.length - 1);
    push(ln(pad(nameLines[0], amt)));
    nameLines.slice(1).forEach((l) => push(ln('  ' + l)));
    push(ln('  ' + it.qty + ' x Rs ' + it.price.toFixed(2) + '  HSN: ' + it.hsn));
  });

  push(dashes());

  // ── Totals ─────────────────────────────────────────────────────────────────
  push(ln(pad('Subtotal', 'Rs ' + order.subtotal.toFixed(2))));
  if (order.discount > 0)
    push(ln(pad('Discount', '-Rs ' + order.discount.toFixed(2))));
  if (order.round_off && order.round_off !== 0)
    push(ln(pad('Round off', order.round_off.toFixed(2))));

  push(equals());
  push(cmd.bold(true), cmd.textSize(1, 2));
  push(ln(pad('TOTAL', 'Rs ' + order.total.toFixed(2))));
  push(cmd.textSize(1, 1), cmd.bold(false));
  push(equals());

  // ── Payment ────────────────────────────────────────────────────────────────
  const modeLabel =
    order.payment_mode === 'upi' ? 'UPI' :
    order.payment_mode === 'cash' ? 'Cash' : 'Card';
  push(ln(pad('Paid by ' + modeLabel, 'Rs ' + order.total.toFixed(2))));
  if (order.utr) push(ln('UTR: ' + order.utr));
  const status = order.status === 'paid' ? 'PAID' : 'PENDING';
  push(ln(pad('Status', status)));

  // UPI payment details — always printed
  push(dashes());
  push(cmd.align(1));
  push(cmd.bold(true));
  push(ln('PAY VIA UPI'));
  push(cmd.bold(false));
  push(ln('paytm.d95113099@pty'));
  push(ln('Amount: Rs ' + order.total.toFixed(2)));
  push(ln('Ref: ' + order.invoice_no));
  push(cmd.align(0));

  push(dashes());

  // ── Footer ─────────────────────────────────────────────────────────────────
  push(cmd.align(1));
  push(emptyLn());
  push(ln('Thank you! Visit again.'));
  push(ln('Goods once sold will not be taken back.'));
  push(ln('Keep fireworks away from children.'));
  push(emptyLn());

  // Feed & cut
  push(cmd.feed(5));
  push(cmd.cut());

  return new Uint8Array(bytes);
}

// ─── Send bytes to printer over BLE ───────────────────────────────────────────

const CHUNK_SIZE = 20;
const CHUNK_DELAY_MS = 12;

export async function printOrder(order) {
  if (!isConnected()) throw new Error('Printer not connected');
  const bytes = buildReceiptBytes(order);
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const slice = bytes.slice(i, i + CHUNK_SIZE);
    if (_char.properties.writeWithoutResponse) {
      await _char.writeValueWithoutResponse(slice);
    } else {
      await _char.writeValueWithResponse(slice);
    }
    await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
  }
}
