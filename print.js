// ============================================================
//  POS DZ — print.js  v8.0.0
//  وحدة الطباعة الموحدة:
//    1) POSDZ_PRINT  — طباعة ملصقات الباركود (canvas → PNG → iframe)
//    2) printInvoice — طباعة فاتورة المبيعات الحرارية
//    3) _inputDialog — حوار إدخال نصي بسيط (مساعد للطباعة)
// ============================================================

/* ─────────────────────────────────────────────────────────────
   0)  دالة مساعدة: _inputDialog
   ───────────────────────────────────────────────────────────── */
/**
 * يعرض نافذة إدخال نصي مخصصة ويعيد Promise<string|null>
 * @param {string} label  - نص التسمية
 * @param {string} [defaultValue] - قيمة افتراضية
 * @returns {Promise<string|null>}
 */
function _inputDialog(label, defaultValue = '') {
  return new Promise((resolve) => {
    const id  = '_inp_' + Date.now();
    const esc = (s) => {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    };

    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'background:rgba(0,0,0,0.72)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:16px', 'font-family:var(--font-main,Cairo,sans-serif)'
    ].join(';');

    overlay.innerHTML = `
      <div style="background:#1a1040;border:2px solid #7c3aed;border-radius:14px;
                  padding:22px 20px;width:100%;max-width:360px;
                  box-shadow:0 0 48px rgba(124,58,237,0.45);">
        <p style="color:#a78bfa;font-weight:800;font-size:0.95rem;margin:0 0 12px;">
          ${esc(label)}
        </p>
        <input id="${id}_val" type="text" value="${esc(defaultValue)}"
          style="width:100%;padding:10px 12px;border-radius:8px;
                 border:1px solid #7c3aed;background:#0f0a2e;
                 color:#e2e8f0;font-size:0.92rem;outline:none;
                 font-family:inherit;box-sizing:border-box;"/>
        <div style="display:flex;gap:10px;margin-top:16px;justify-content:flex-end;">
          <button id="${id}_ok"
            style="background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;
                   border:none;border-radius:8px;padding:9px 22px;
                   font-size:0.9rem;font-weight:700;cursor:pointer;">
            ✅ تأكيد
          </button>
          <button id="${id}_no"
            style="background:rgba(255,255,255,0.07);color:#9ca3af;
                   border:1px solid #374151;border-radius:8px;padding:9px 16px;
                   font-size:0.9rem;cursor:pointer;">
            إلغاء
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const input  = document.getElementById(`${id}_val`);
    const okBtn  = document.getElementById(`${id}_ok`);
    const noBtn  = document.getElementById(`${id}_no`);

    input.focus();
    input.select();

    const finish = (val) => {
      overlay.remove();
      resolve(val);
    };

    okBtn.onclick = () => finish(input.value.trim() || null);
    noBtn.onclick = () => finish(null);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  finish(input.value.trim() || null);
      if (e.key === 'Escape') finish(null);
    });
  });
}

// نشرها عالمياً حتى يستطيع POSDZ_PRINT استخدامها
window._inputDialog = _inputDialog;


/* ─────────────────────────────────────────────────────────────
   1)  POSDZ_PRINT — طباعة ملصقات الباركود
   ───────────────────────────────────────────────────────────── */
const POSDZ_PRINT = (() => {

  const SIZE_MAP = {
    '58x38': { w: 58, h: 38 }, '58x30': { w: 58, h: 30 },
    '58x20': { w: 58, h: 20 }, '40x30': { w: 40, h: 30 },
    '40x25': { w: 40, h: 25 }, '40x20': { w: 40, h: 20 },
    '38x25': { w: 38, h: 25 }, '30x20': { w: 30, h: 20 },
  };

  const DPI      = 203;
  const MM2INCH  = 25.4;
  const mm2px    = mm => Math.round((mm / MM2INCH) * DPI);

  // ── تنسيق الباركود ────────────────────────────────────────
  function _fmt(code) {
    const s = String(code).replace(/\s/g, '');
    if (/^\d{13}$/.test(s)) return 'EAN13';
    if (/^\d{8}$/.test(s))  return 'EAN8';
    if (/^\d{12}$/.test(s)) return 'UPCA';
    return 'CODE128';
  }
  function _units(code, fmt) {
    if (fmt==='EAN13') return 95;
    if (fmt==='EAN8')  return 67;
    if (fmt==='UPCA')  return 95;
    return Math.max(40, (String(code).length + 3) * 11 + 35);
  }

  // ── تحميل JsBarcode مرة واحدة ─────────────────────────────
  function _loadBC() {
    return new Promise(res => {
      if (typeof JsBarcode !== 'undefined') { res(); return; }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';
      s.onload = res; s.onerror = res;
      document.head.appendChild(s);
    });
  }

  // ── قطع النص ──────────────────────────────────────────────
  function _clip(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '\u2026').width > maxW) t = t.slice(0,-1);
    return t + '\u2026';
  }

  // ── أشرطة احتياطية ────────────────────────────────────────
  function _fallbackBars(ctx, x, y, w, h, code) {
    const s  = String(code);
    const uw = Math.max(2, w / ((s.length + 4) * 9));
    ctx.fillStyle = '#000';
    let cx = x;
    ctx.fillRect(cx, y, uw, h); cx += uw*2;
    ctx.fillRect(cx, y, uw, h); cx += uw*2;
    for (let i=0; i<s.length; i++) {
      const c = s.charCodeAt(i);
      for (let j=6; j>=0; j--) {
        if ((c>>j)&1) ctx.fillRect(cx, y, uw, h);
        cx += uw*1.5;
      }
      cx += uw;
    }
    ctx.fillRect(cx, y, uw, h); cx += uw*2;
    ctx.fillRect(cx, y, uw, h);
  }

  // ── رسم الملصق على Canvas ─────────────────────────────────
  async function _drawLabel(product, opts) {
    const { sName, cur, bcFont, bcType, showStore, showName, showPrice, size, fs, bv } = opts;

    const W = mm2px(size.w);
    const H = mm2px(size.h);
    const P = mm2px(0.7);

    const baseFS = Math.round(H * 0.13);
    const FS  = Math.max(12, Math.min(40, baseFS));
    const FSS = Math.max(10, FS - 3);
    const FSP = Math.max(12, FS);
    const FSN = Math.max(9,  Math.round(FS*0.75));
    const FSR = Math.max(14, Math.round(FS*1.2));
    const font = '"'+(bcFont||'Arial')+'", Arial, sans-serif';

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';

    let y = P;

    if (showStore==='1' && sName) {
      ctx.font = '800 '+FSS+'px '+font;
      ctx.fillText(_clip(ctx, sName, W-P*2), W/2, y);
      y += FSS + Math.round(P*0.5);
    }

    if (showName!=='0') {
      const pn = product.name + (product.size?' \u2014 '+product.size:'');
      ctx.font = '900 '+FSP+'px '+font;
      ctx.fillText(_clip(ctx, pn, W-P*2), W/2, y);
      y += FSP + Math.round(P*0.5);
    }

    let bot = P + FSN + Math.round(P*0.5);
    if (showPrice!=='0') bot += FSR + Math.round(P*0.5);
    const bH = Math.max(mm2px(5), H - y - bot - P);
    const bW = W - P*2;

    if (bcType==='QR') {
      ctx.strokeStyle='#000'; ctx.lineWidth=1;
      ctx.strokeRect(P, y, bW, bH);
      ctx.font='700 '+FSN+'px monospace';
      ctx.fillText('[QR:'+bv+']', W/2, y+bH/2-FSN/2);
    } else {
      const fmt = _fmt(bv);
      const tmp = document.createElement('canvas');
      let ok = false;

      if (typeof JsBarcode !== 'undefined') {
        try {
          const units = _units(bv, fmt);
          const xd    = Math.max(1, Math.floor(bW / units));
          JsBarcode(tmp, String(bv), {
            format:       fmt,
            width:        xd,
            height:       bH,
            displayValue: false,
            margin:       0,
            background:   '#fff',
            lineColor:    '#000',
          });
          ok = true;
        } catch(e) {}
      }

      if (ok && tmp.width > 0 && tmp.height > 0) {
        ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, P, y, bW, bH);
      } else {
        _fallbackBars(ctx, P, y, bW, bH, bv);
      }
    }

    y += bH + Math.round(P*0.3);

    ctx.font = '700 '+FSN+'px "Courier New", monospace';
    ctx.fillText(String(bv), W/2, y);
    y += FSN + Math.round(P*0.4);

    if (showPrice!=='0') {
      const pr = (typeof formatDZ==='function')
        ? formatDZ(product.sellPrice||0)
        : parseFloat(product.sellPrice||0).toFixed(2)+' '+(cur||'DA');
      ctx.font = '900 '+FSR+'px '+font;
      ctx.fillText(pr, W/2, y);
    }

    // تدوير 90° مع عقارب الساعة
    const rotated = document.createElement('canvas');
    rotated.width  = H;
    rotated.height = W;
    const rctx = rotated.getContext('2d');
    rctx.fillStyle = '#fff';
    rctx.fillRect(0, 0, rotated.width, rotated.height);
    rctx.translate(H, 0);
    rctx.rotate(Math.PI / 2);
    rctx.drawImage(cv, 0, 0);

    return rotated;
  }

  // ── بناء HTML الطباعة ─────────────────────────────────────
  function _makeHTML(canvas, wMM, hMM) {
    const png     = canvas.toDataURL('image/png', 1.0);
    const pageSize = wMM+'mm '+hMM+'mm';

    return [
      '<!DOCTYPE html>',
      '<html>',
      '<head>',
      '<meta charset="UTF-8">',
      '<style>',
      '*, *::before, *::after {',
      '  margin: 0 !important;',
      '  padding: 0 !important;',
      '  border: 0 !important;',
      '  box-sizing: border-box !important;',
      '}',
      '@page {',
      '  size: '+pageSize+';',
      '  margin: 0mm !important;',
      '}',
      'html {',
      '  width: '+wMM+'mm;',
      '  height: '+hMM+'mm;',
      '  overflow: hidden;',
      '}',
      'body {',
      '  width: '+wMM+'mm;',
      '  height: '+hMM+'mm;',
      '  overflow: hidden;',
      '  background: #fff;',
      '  display: block;',
      '}',
      'img {',
      '  display: block;',
      '  width: '+wMM+'mm;',
      '  height: '+hMM+'mm;',
      '  max-width: none;',
      '  object-fit: fill;',
      '  -webkit-print-color-adjust: exact;',
      '  print-color-adjust: exact;',
      '}',
      '@media print {',
      '  @page {',
      '    size: '+pageSize+';',
      '    margin: 0 !important;',
      '  }',
      '  html, body {',
      '    width: '+wMM+'mm !important;',
      '    height: '+hMM+'mm !important;',
      '  }',
      '  img {',
      '    width: '+wMM+'mm !important;',
      '    height: '+hMM+'mm !important;',
      '  }',
      '}',
      '</style>',
      '</head>',
      '<body>',
      '<img src="'+png+'" alt="">',
      '<script>',
      'window.addEventListener("load", function() {',
      '  setTimeout(function() {',
      '    window.print();',
      '    window.onafterprint = function() { window.close(); };',
      '    setTimeout(function() { window.close(); }, 20000);',
      '  }, 200);',
      '});',
      '<\/script>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  // ── محرك الطباعة ──────────────────────────────────────────
  async function _printSmart(html, rawSize, size) {
    try {
      const en = await getSetting('syncEnabled');
      const ip = await getSetting('syncServerIP')  || '192.168.1.1';
      const pt = await getSetting('syncServerPort')|| '3000';
      if (en==='1') {
        const pn = await getSetting('printerBarcode')||'';
        const r = await fetch('http://'+ip+':'+pt+'/api/print', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({html, printerName:pn, labelSize:rawSize}),
          signal: AbortSignal.timeout(6000),
        });
        if (r.ok) {
          const j = await r.json();
          if (j.status==='ok') {
            if (typeof toast==='function') toast('🖨️ طباعة على: '+j.printer, 'success');
            return;
          }
        }
      }
    } catch(_) {}
    _iframePrint(html);
  }

  // ── iframe صامت ───────────────────────────────────────────
  function _iframePrint(html) {
    document.getElementById('_bcF')?.remove();
    const f  = document.createElement('iframe');
    f.id     = '_bcF';
    f.style.cssText = [
      'position:fixed', 'top:-9999px', 'left:-9999px',
      'width:0px', 'height:0px', 'border:none', 'visibility:hidden'
    ].join(';');
    document.body.appendChild(f);

    const doc = f.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    f.onload = function() {
      setTimeout(function() {
        try {
          f.contentWindow.focus();
          f.contentWindow.print();
        } catch(e) {
          const w = window.open('','_blank','width=600,height=400');
          if (w) { w.document.write(html); w.document.close(); }
        }
        setTimeout(function() {
          if (f && f.parentNode) f.remove();
        }, 15000);
      }, 300);
    };
  }

  // ── الدالة الرئيسية للباركود ──────────────────────────────
  async function barcode(product, qty) {
    if (!product) return;
    const copies = Math.max(1, Math.min(999, parseInt(qty)||1));

    const bv = (product.barcode || String(product.id||'')).trim();
    if (!bv) {
      if (typeof toast==='function') toast('لا يوجد باركود للمنتج', 'warning');
      return;
    }

    const [sName,cur,bcFont,bcType,showStore,showName,showPrice,rawSize,rawFs] =
      await Promise.all([
        'storeName','currency','barcodeFont','barcodeType',
        'barcodeShowStore','barcodeShowName','barcodeShowPrice',
        'barcodeLabelSize','barcodeFontSize'
      ].map(k => getSetting(k)));

    const size = SIZE_MAP[rawSize||'40x20'] || SIZE_MAP['40x20'];
    const fs   = Math.max(7, Math.min(24, parseInt(rawFs)||9));

    await _loadBC();

    const opts   = {sName,cur,bcFont,bcType,showStore,showName,showPrice,size,fs,bv};
    const canvas = await _drawLabel(product, opts);
    const html   = _makeHTML(canvas, size.h, size.w);

    for (let i=0; i<copies; i++) {
      if (i>0) await new Promise(r => setTimeout(r, 700));
      await _printSmart(html, rawSize||'40x20', size);
    }
    if (copies>1 && typeof toast==='function')
      toast('🖨️ تمت طباعة '+copies+' نسخة', 'success');
  }

  // ── اختيار الطابعة ────────────────────────────────────────
  async function choosePrinter(type) {
    const isBc = type==='barcode';
    const key  = isBc ? 'printerBarcode' : 'printerInvoice';
    const cur  = (await getSetting(key))||'';
    let printers = [];
    try {
      const en = await getSetting('syncEnabled');
      const ip = await getSetting('syncServerIP')  ||'192.168.1.1';
      const pt = await getSetting('syncServerPort')||'3000';
      if (en==='1') {
        const r = await fetch('http://'+ip+':'+pt+'/api/printers',
          {signal:AbortSignal.timeout(4000)});
        if (r.ok) printers = (await r.json()).printers||[];
      }
    } catch(_) {}

    if (printers.length>0) {
      _showPrinterModal(printers, cur, key, isBc);
    } else {
      // استخدام _inputDialog المُعرَّفة أعلاه
      const v = await _inputDialog(
        isBc ? 'اسم طابعة الباركود:' : 'اسم طابعة الفواتير:', cur);
      if (v && v.trim()) {
        await setSetting(key, v.trim());
        _updUI(isBc, v.trim());
        if (typeof toast==='function') toast('✅ تم حفظ: '+v.trim(), 'success');
      }
    }
  }

  function _showPrinterModal(printers, current, key, isBc) {
    document.getElementById('_pModal')?.remove();
    const m = document.createElement('div');
    m.id = '_pModal';
    m.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:16px;';
    const rows = printers.map(p => {
      const sel = p===current;
      return '<div class="_pi" data-n="'+p+'" style="padding:11px 14px;border-radius:8px;cursor:pointer;margin-bottom:6px;'+
        'border:2px solid '+(sel?'#7c3aed':'#2d1b69')+';'+
        'background:'+(sel?'rgba(124,58,237,0.2)':'rgba(255,255,255,0.04)')+';'+
        'color:#e2e8f0;font-size:0.88rem;display:flex;align-items:center;gap:10px;">'+
        '<span>'+(sel?'✅':'🖨️')+'</span><span>'+p+'</span></div>';
    }).join('');
    m.innerHTML = '<div style="background:#1a1040;border:2px solid #7c3aed;border-radius:14px;padding:20px;width:100%;max-width:420px;max-height:78vh;overflow-y:auto;box-shadow:0 0 50px rgba(124,58,237,0.5);">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'+
      '<h3 style="color:#a78bfa;font-size:1rem;font-weight:800;">🖨️ '+(isBc?'طابعة الباركود':'طابعة الفواتير')+'</h3>'+
      '<button onclick="document.getElementById(\'_pModal\').remove()" style="background:transparent;border:none;color:#888;font-size:1.4rem;cursor:pointer;">✕</button></div>'+
      '<p style="color:#888;font-size:0.78rem;margin-bottom:12px;">'+printers.length+' طابعة متاحة</p>'+
      '<div id="_pList">'+rows+'</div>'+
      '<div style="margin-top:16px;text-align:left;">'+
      '<button id="_pOk" disabled style="background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:0.9rem;font-weight:700;cursor:pointer;opacity:0.45;transition:opacity 0.2s;">✅ تأكيد</button>'+
      '</div></div>';
    document.body.appendChild(m);
    let chosen = current;
    m.querySelectorAll('._pi').forEach(el => {
      el.addEventListener('click', () => {
        chosen = el.dataset.n;
        m.querySelectorAll('._pi').forEach(x=>{
          x.style.borderColor='#2d1b69';
          x.style.background='rgba(255,255,255,0.04)';
          x.querySelector('span').textContent='🖨️';
        });
        el.style.borderColor='#7c3aed';
        el.style.background='rgba(124,58,237,0.2)';
        el.querySelector('span').textContent='✅';
        const b=document.getElementById('_pOk');
        b.disabled=false; b.style.opacity='1';
      });
    });
    document.getElementById('_pOk').addEventListener('click', async () => {
      await setSetting(key, chosen);
      _updUI(isBc, chosen);
      m.remove();
      if (typeof toast==='function') toast('✅ تم اختيار: '+chosen, 'success');
    });
    m.addEventListener('click', e => { if(e.target===m) m.remove(); });
  }

  function _updUI(isBc, name) {
    const n = document.getElementById(isBc?'printerBarcodeName':'printerInvoiceName');
    const c = document.getElementById(isBc?'printerBarcodeCard':'printerInvoiceCard');
    if(n) n.textContent = name;
    if(c) c.classList.add('selected');
  }

  return { barcode, choosePrinter, SIZE_MAP };
})();


/* ─────────────────────────────────────────────────────────────
   2)  printInvoice — طباعة فاتورة المبيعات
   ───────────────────────────────────────────────────────────── */
/**
 * يطبع فاتورة مبيعات حرارية
 * @param {Object} sale  - بيانات البيع {invoiceNumber, total, discount, paid, change, isDebt, date, customerName, customerPhone}
 * @param {Array}  items - عناصر البيع  [{name, size, quantity, unitPrice, total}, ...]
 */
async function printInvoice(sale, items) {
  if (!sale) return;

  // ── جلب الإعدادات دفعة واحدة ─────────────────────────────
  const keys = [
    'storeName','storePhone','storeAddress','storeWelcome','storeLogo',
    'currency','paperSize',
    'printLogo','printName','printPhone','printAddress','printWelcome','printBarcode',
    'printerInvoice','syncEnabled','syncServerIP','syncServerPort'
  ];
  const cfg = {};
  await Promise.all(keys.map(async k => {
    cfg[k] = (typeof getSetting === 'function') ? (await getSetting(k)) : null;
  }));

  const cur      = cfg.currency   || 'DA';
  const paper    = cfg.paperSize  || '80mm';
  const show     = (k) => cfg[k] !== '0'; // افتراضياً يظهر كل شيء

  // ── تنسيق العملة داخل الفاتورة ────────────────────────────
  const fmt = (n) => {
    const num = parseFloat(n || 0);
    if (isNaN(num)) return `0 ${cur}`;
    const parts = num.toFixed(2).split('.');
    const int   = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return parts[1] === '00' ? `${int} ${cur}` : `${int},${parts[1]} ${cur}`;
  };

  // ── تنسيق التاريخ والوقت ──────────────────────────────────
  const fmtDate = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const pad = n => String(n).padStart(2,'0');
      return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ` +
             `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ''; }
  };

  // ── حساب العرض بالـ mm ────────────────────────────────────
  const widthMM = paper === '58mm' ? 58 : 80;

  // ── إنشاء HTML الفاتورة ────────────────────────────────────
  let html = _buildReceiptHTML({
    sale, items, cfg, cur, fmt, fmtDate, widthMM, show
  });

  // ── إرسال للسيرفر أو iframe ───────────────────────────────
  const sent = await _trySendToServer(html, cfg, 'invoice');
  if (!sent) {
    _iframePrintInvoice(html);
  }
}

/**
 * بناء HTML الفاتورة الحرارية
 */
function _buildReceiptHTML({ sale, items, cfg, cur, fmt, fmtDate, widthMM, show }) {
  const esc = (s) => {
    if (!s) return '';
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  };

  const isDebt   = sale.isDebt === 1 || sale.isDebt === true;
  const discount = parseFloat(sale.discount || 0);

  // ── رأس الفاتورة ──────────────────────────────────────────
  let header = '';

  if (show('printLogo') && cfg.storeLogo) {
    header += `<div style="text-align:center;margin-bottom:6px;">
      <img src="${cfg.storeLogo}" alt="logo"
           style="max-width:80px;max-height:60px;object-fit:contain;"/>
    </div>`;
  }

  if (show('printName') && cfg.storeName) {
    header += `<div style="text-align:center;font-size:1.05rem;font-weight:900;
                            margin-bottom:2px;">${esc(cfg.storeName)}</div>`;
  }

  if (show('printPhone') && cfg.storePhone) {
    header += `<div style="text-align:center;font-size:0.82rem;">
                 📞 ${esc(cfg.storePhone)}</div>`;
  }

  if (show('printAddress') && cfg.storeAddress) {
    header += `<div style="text-align:center;font-size:0.78rem;margin-bottom:2px;">
                 📍 ${esc(cfg.storeAddress)}</div>`;
  }

  // ── معلومات الفاتورة ──────────────────────────────────────
  const infoRows = [
    ['رقم الفاتورة', esc(sale.invoiceNumber || '')],
    ['التاريخ',      esc(fmtDate(sale.date))],
    ...(sale.customerName ? [['الزبون', esc(sale.customerName)]] : []),
    ...(sale.customerPhone ? [['هاتف', esc(sale.customerPhone)]] : []),
  ];

  let infoHtml = infoRows.map(([k, v]) =>
    `<tr><td style="color:#555;padding:1px 4px;">${k}</td>
         <td style="font-weight:700;padding:1px 4px;">${v}</td></tr>`
  ).join('');

  // ── بنود الفاتورة ──────────────────────────────────────────
  let itemsHtml = '';
  const safeItems = Array.isArray(items) ? items : [];

  safeItems.forEach(item => {
    const name   = esc((item.name || item.productName || '') + (item.size ? ` — ${item.size}` : ''));
    const qty    = parseFloat(item.quantity  || 0);
    const price  = parseFloat(item.unitPrice || 0);
    const total  = parseFloat(item.total     || qty * price);

    itemsHtml += `
      <tr>
        <td style="padding:3px 2px;vertical-align:top;">${name}</td>
        <td style="text-align:center;padding:3px 2px;white-space:nowrap;">${qty}</td>
        <td style="text-align:left;padding:3px 2px;white-space:nowrap;">${fmt(price)}</td>
        <td style="text-align:left;padding:3px 2px;white-space:nowrap;font-weight:700;">${fmt(total)}</td>
      </tr>`;
  });

  // ── المجاميع ──────────────────────────────────────────────
  const subTotal = safeItems.reduce((s, i) => s + parseFloat(i.total || 0), 0);

  let totalsHtml = `
    <tr>
      <td colspan="3" style="text-align:right;padding:2px 4px;">المجموع:</td>
      <td style="text-align:left;padding:2px 4px;font-weight:700;">${fmt(subTotal)}</td>
    </tr>`;

  if (discount > 0) {
    totalsHtml += `
      <tr>
        <td colspan="3" style="text-align:right;padding:2px 4px;color:#e53e3e;">الخصم:</td>
        <td style="text-align:left;padding:2px 4px;color:#e53e3e;">- ${fmt(discount)}</td>
      </tr>`;
  }

  totalsHtml += `
    <tr style="border-top:2px solid #000;">
      <td colspan="3" style="text-align:right;padding:3px 4px;font-size:1rem;font-weight:900;">الإجمالي:</td>
      <td style="text-align:left;padding:3px 4px;font-size:1rem;font-weight:900;">${fmt(sale.total)}</td>
    </tr>
    <tr>
      <td colspan="3" style="text-align:right;padding:2px 4px;">المدفوع:</td>
      <td style="text-align:left;padding:2px 4px;">${fmt(sale.paid)}</td>
    </tr>`;

  if (parseFloat(sale.change || 0) > 0) {
    totalsHtml += `
      <tr>
        <td colspan="3" style="text-align:right;padding:2px 4px;">الباقي:</td>
        <td style="text-align:left;padding:2px 4px;color:#2d9b4e;font-weight:700;">${fmt(sale.change)}</td>
      </tr>`;
  }

  if (isDebt) {
    const debtAmt = parseFloat(sale.total) - parseFloat(sale.paid || 0);
    totalsHtml += `
      <tr>
        <td colspan="3" style="text-align:right;padding:2px 4px;color:#c53030;font-weight:800;">دين:</td>
        <td style="text-align:left;padding:2px 4px;color:#c53030;font-weight:900;">${fmt(debtAmt)}</td>
      </tr>`;
  }

  // ── باركود الفاتورة ───────────────────────────────────────
  let barcodeHtml = '';
  if (show('printBarcode') && sale.invoiceNumber) {
    const bcode = String(sale.invoiceNumber).replace(/[^a-zA-Z0-9\-]/g, '');
    if (bcode) {
      barcodeHtml = `
        <div style="text-align:center;margin:8px 0 4px;">
          <svg id="_invBC"></svg>
          <div style="font-size:0.75rem;font-family:monospace;margin-top:2px;">${esc(sale.invoiceNumber)}</div>
        </div>
        <script>
          (function() {
            if (typeof JsBarcode !== 'undefined') {
              try {
                JsBarcode('#_invBC', '${bcode}', {
                  format: 'CODE128', width: 1.5, height: 40,
                  displayValue: false, margin: 0, background: '#fff', lineColor: '#000'
                });
              } catch(e) {}
            }
          })();
        <\/script>`;
    }
  }

  // ── رسالة الشكر ───────────────────────────────────────────
  let footer = '';
  if (show('printWelcome') && cfg.storeWelcome) {
    footer = `<div style="text-align:center;font-size:0.85rem;font-weight:700;
                          margin-top:8px;padding-top:6px;border-top:1px dashed #999;">
                ${esc(cfg.storeWelcome)}
              </div>`;
  }

  // ── تجميع HTML الكامل ──────────────────────────────────────
  const needJsBarcode = show('printBarcode');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  ${needJsBarcode ? '<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>' : ''}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: ${widthMM}mm auto; margin: 0; }
    body {
      width: ${widthMM}mm;
      font-family: 'Cairo', 'Arial', sans-serif;
      font-size: 0.85rem;
      color: #000;
      background: #fff;
      padding: 4mm 3mm 6mm;
    }
    table { width: 100%; border-collapse: collapse; }
    .sep  { border-top: 1px dashed #999; margin: 6px 0; }
    .sep2 { border-top: 2px solid #000;  margin: 6px 0; }
    @media print {
      @page { size: ${widthMM}mm auto; margin: 0; }
      body  { padding: 2mm 2mm 4mm; }
    }
  </style>
</head>
<body>
  ${header}
  <div class="sep2"></div>

  <table style="font-size:0.78rem;margin-bottom:4px;">
    ${infoHtml}
  </table>

  <div class="sep"></div>

  <!-- عناوين الأعمدة -->
  <table style="font-size:0.78rem;">
    <thead>
      <tr style="border-bottom:1px solid #000;">
        <th style="text-align:right;padding:2px 2px;font-weight:900;">المنتج</th>
        <th style="text-align:center;padding:2px 2px;font-weight:900;">الكمية</th>
        <th style="text-align:left;padding:2px 2px;font-weight:900;">السعر</th>
        <th style="text-align:left;padding:2px 2px;font-weight:900;">المجموع</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  <div class="sep"></div>

  <!-- المجاميع -->
  <table style="font-size:0.82rem;">
    <tbody>
      ${totalsHtml}
    </tbody>
  </table>

  ${barcodeHtml}
  ${footer}

  <script>
    window.addEventListener('load', function() {
      setTimeout(function() {
        window.print();
        window.onafterprint = function() { window.close(); };
        setTimeout(function() { window.close(); }, 25000);
      }, 350);
    });
  <\/script>
</body>
</html>`;
}

/**
 * محاولة إرسال الفاتورة للسيرفر
 * @returns {boolean} true إذا نجح الإرسال
 */
async function _trySendToServer(html, cfg, type) {
  try {
    if (cfg.syncEnabled !== '1') return false;
    const ip = cfg.syncServerIP  || '192.168.1.1';
    const pt = cfg.syncServerPort|| '3000';
    const pn = cfg.printerInvoice|| '';

    const r = await fetch(`http://${ip}:${pt}/api/print`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ html, printerName: pn, type }),
      signal:  AbortSignal.timeout(6000),
    });

    if (r.ok) {
      const j = await r.json();
      if (j.status === 'ok') {
        if (typeof toast === 'function') toast('🖨️ طباعة على: ' + j.printer, 'success');
        return true;
      }
    }
  } catch (_) {}
  return false;
}

/**
 * طباعة الفاتورة عبر iframe صامت
 */
function _iframePrintInvoice(html) {
  // إزالة أي iframe سابق للفواتير
  document.getElementById('_invF')?.remove();

  const f = document.createElement('iframe');
  f.id    = '_invF';
  f.style.cssText = [
    'position:fixed','top:-9999px','left:-9999px',
    'width:0','height:0','border:none','visibility:hidden'
  ].join(';');
  document.body.appendChild(f);

  const doc = f.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  f.onload = function() {
    setTimeout(function() {
      try {
        f.contentWindow.focus();
        f.contentWindow.print();
      } catch (e) {
        // fallback: popup
        const w = window.open('', '_blank', 'width=400,height=600');
        if (w) { w.document.write(html); w.document.close(); }
      }
      setTimeout(function() {
        if (f && f.parentNode) f.remove();
      }, 20000);
    }, 350);
  };
}

// ── تصدير عالمي حتى تستطيع reports.html استخدامها ─────────
window.printInvoice = printInvoice;
window.POSDZ_PRINT  = POSDZ_PRINT;
