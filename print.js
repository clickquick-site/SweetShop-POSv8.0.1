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
 * يطبع فاتورة مبيعات حرارية — هيكل مطابق للنموذج الأصلي
 * ورق 80mm — محتوى 76mm — هامش 2mm كل جانب
/**
 * يطبع فاتورة مبيعات حرارية
 * ورق 80mm — هامش 2mm كل جانب — محتوى 76mm
 */
async function printInvoice(sale, items) {
  if (!sale) return;

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

  const sellerName = sale.sellerName
    || window.sessionManager?.getUser()?.username
    || '';

  const cur   = cfg.currency  || 'DA';
  const paper = cfg.paperSize || '80mm';
  const show  = (k) => cfg[k] !== '0';

  // "85 DA" — رقم صحيح بلا كسر  |  "85,50 DA" — مع كسر
  const fmt = (n) => {
    const v = parseFloat(n || 0);
    if (isNaN(v)) return `0 ${cur}`;
    if (v % 1 === 0) {
      return v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ' + cur;
    }
    const [i, d] = v.toFixed(2).split('.');
    return i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d + ' ' + cur;
  };

  // سعر بدون رمز عملة للعمود الأوسط
  const fmtN = (n) => {
    const v = parseFloat(n || 0);
    if (isNaN(v)) return '0';
    if (v % 1 === 0) return v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const [i, d] = v.toFixed(2).split('.');
    return i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
  };

  // YYYY/MM/DD HH:MM
  const fmtD = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const p = x => String(x).padStart(2, '0');
      return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch { return ''; }
  };

  const widthMM = paper === '58mm' ? 58 : 80;
  const html    = _buildReceiptHTML({ sale, items, cfg, cur, fmt, fmtN, fmtD, widthMM, show, sellerName });
  const sent    = await _trySendToServer(html, cfg, 'invoice');
  if (!sent) _iframePrintInvoice(html);
}

/**
 * بناء HTML الفاتورة — تخطيط جداول فقط، لا flexbox
 *
 * قواعد صارمة:
 *  ① كل صف ذو عمودين: TABLE + colgroup بنسب صريحة
 *     col أول (50%) → text-align:right → التسمية/يمين
 *     col ثاني(50%) → text-align:left  → القيمة/يسار
 *  ② جدول المنتجات: 4 أعمدة بنسب ثابتة (42/8/22/28)
 *  ③ لا direction:ltr على أي عنصر منفرد
 *  ④ word-break:break-word على خلايا القيم الطويلة
 *  ⑤ overflow:visible على body — لا قطع
 */
function _buildReceiptHTML({ sale, items, cfg, cur, fmt, fmtN, fmtD, widthMM, show, sellerName }) {

  const esc = (s) => {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  };

  const isDebt  = sale.isDebt === 1 || sale.isDebt === true;
  const discount= parseFloat(sale.discount || 0);
  const change  = parseFloat(sale.change   || 0);
  const paid    = parseFloat(sale.paid     || 0);
  const total   = parseFloat(sale.total    || 0);
  const debtAmt = isDebt ? Math.max(0, total - paid) : 0;
  const safeItems = Array.isArray(items) ? items : [];

  // ── مساعد: صف جدول ذو عمودين ─────────────────────────────
  // col أول = يمين (تسمية) | col ثاني = يسار (قيمة)
  const row2 = (right, left, rightStyle = '', leftStyle = '') =>
    `<tr>
      <td style="text-align:right;padding:1px 0;${rightStyle}">${right}</td>
      <td style="text-align:left;padding:1px 0;word-break:break-word;${leftStyle}">${left}</td>
    </tr>`;

  // ════════════════════════════════════════
  // ① رأس الفاتورة
  // ════════════════════════════════════════
  let headRows = row2(
    `<strong style="font-size:1.1em;">فاتورة ${esc(sale.invoiceNumber||'')}</strong>`,
    `<span style="font-size:0.92em;">${esc(fmtD(sale.date))}</span>`
  );
  if (sellerName)        headRows += row2('البائع:',  esc(sellerName));
  if (sale.customerName) headRows += row2('الزبون:',  esc(sale.customerName));
  if (sale.customerPhone)headRows += row2('الهاتف:',  esc(sale.customerPhone));

  // ════════════════════════════════════════
  // ② اسم المتجر
  // ════════════════════════════════════════
  let storeBlock = '';
  if (show('printLogo') && cfg.storeLogo) {
    storeBlock += `<div style="text-align:center;margin:3px 0;">
      <img src="${cfg.storeLogo}" alt=""
           style="max-width:55px;max-height:45px;object-fit:contain;display:block;margin:0 auto;"/>
    </div>`;
  }
  if (show('printName') && cfg.storeName) {
    storeBlock += `<div style="text-align:center;font-size:1.25em;font-weight:900;
                               letter-spacing:1px;margin:2px 0;">${esc(cfg.storeName)}</div>`;
  }
  if (show('printPhone') && cfg.storePhone) {
    storeBlock += `<div style="text-align:center;font-size:0.88em;margin-bottom:1px;">${esc(cfg.storePhone)}</div>`;
  }
  if (show('printAddress') && cfg.storeAddress) {
    storeBlock += `<div style="text-align:center;font-size:0.85em;">${esc(cfg.storeAddress)}</div>`;
  }

  // ════════════════════════════════════════
  // ③ بنود الفاتورة
  // ════════════════════════════════════════
  let itemRows = '';
  safeItems.forEach(it => {
    const name  = esc((it.name || it.productName || '').trim());
    const size  = it.size ? ` ${esc(it.size)}` : '';
    const qty   = parseFloat(it.quantity  || 0);
    const price = parseFloat(it.unitPrice || 0);
    const itot  = parseFloat(it.total     || qty * price);
    const qStr  = qty % 1 === 0 ? String(qty) : qty.toFixed(2);

    itemRows += `<tr>
      <td style="text-align:right;padding:2px 0;word-break:break-word;">${name}${size}</td>
      <td style="text-align:center;padding:2px 0;white-space:nowrap;">${qStr}</td>
      <td style="text-align:center;padding:2px 0;white-space:nowrap;">${fmtN(price)}</td>
      <td style="text-align:left;padding:2px 0;white-space:nowrap;font-weight:700;">${fmt(itot)}</td>
    </tr>`;
  });

  // ════════════════════════════════════════
  // ④ المجاميع
  // ════════════════════════════════════════
  let totRows = '';
  if (discount > 0.004) {
    totRows += row2('الخصم:', `<span style="color:#c53030;">- ${fmt(discount)}</span>`);
  }
  totRows += `<tr>
    <td style="text-align:right;padding:2px 0;font-weight:900;font-size:1.08em;">الإجمالي:</td>
    <td style="text-align:left;padding:2px 0;font-weight:900;font-size:1.08em;word-break:break-word;">${fmt(total)}</td>
  </tr>`;
  totRows += row2('المدفوع:', fmt(paid));
  if (change > 0.004) {
    totRows += row2('الباقي:', `<span style="color:#1a6b2e;font-weight:700;">${fmt(change)}</span>`);
  }
  if (isDebt && debtAmt > 0.004) {
    totRows += `<tr>
      <td style="text-align:right;padding:2px 0;font-weight:900;color:#c53030;">الدين:</td>
      <td style="text-align:left;padding:2px 0;font-weight:900;color:#c53030;word-break:break-word;">${fmt(debtAmt)}</td>
    </tr>`;
  }

  // ════════════════════════════════════════
  // ⑤ رسالة الشكر
  // ════════════════════════════════════════
  let welcome = '';
  if (show('printWelcome') && cfg.storeWelcome) {
    welcome = `<div style="text-align:center;font-weight:700;margin:4px 0 2px;">
                 ${esc(cfg.storeWelcome)}
               </div>`;
  }

  // ════════════════════════════════════════
  // ⑥ باركود
  // ════════════════════════════════════════
  let barcode = '';
  if (show('printBarcode') && sale.invoiceNumber) {
    const bc = String(sale.invoiceNumber).replace(/[^A-Za-z0-9#\-]/g, '');
    if (bc) {
      barcode = `<div style="text-align:center;margin:3px 0 2px;">
    <svg id="_invBC" style="display:block;margin:0 auto;"></svg>
    <div style="font-family:'Courier New',monospace;font-size:0.82em;
                letter-spacing:3px;margin-top:1px;">${esc(sale.invoiceNumber)}</div>
  </div>
  <script>
    (function(){
      if(typeof JsBarcode!=='undefined'){
        try{
          JsBarcode('#_invBC','${bc}',{
            format:'CODE128',width:1.6,height:42,
            displayValue:false,margin:0,
            background:'#fff',lineColor:'#000'
          });
        }catch(e){}
      }
    })();
  <\/script>`;
    }
  }

  // ════════════════════════════════════════
  // ⑦ HTML الكامل
  // ════════════════════════════════════════
  const needBC = show('printBarcode');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
${needBC ? `<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>` : ''}
<style>
*, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
@page { size:${widthMM}mm auto; margin:0; }
html, body { width:${widthMM}mm; background:#fff; color:#000; }
body {
  padding: 3mm 2mm 5mm 2mm;
  font-family: 'Tahoma','Arial',sans-serif;
  font-size: 12px;
  direction: rtl;
}
/* جداول التخطيط */
.t2 {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
/* جدول المنتجات */
.ti {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.ti th, .ti td { font-size:11.5px; padding:2px 0; vertical-align:top; }
.ti th { font-weight:900; }
/* فاصلات */
.d1 { border:none; border-top:1px dashed #555; margin:4px 0; }
.d2 { border:none; border-top:2px solid  #000; margin:4px 0; }
.db { border:none; border-top:1px dashed #555; margin-top:6px; }
@media print {
  @page { size:${widthMM}mm auto; margin:0; }
  body  { padding:2mm 2mm 4mm 2mm; }
}
</style>
</head>
<body>

<!-- ① رأس الفاتورة -->
<table class="t2">
  <colgroup><col style="width:50%;"><col style="width:50%;"></colgroup>
  <tbody>${headRows}</tbody>
</table>

<hr class="d2">

<!-- ② اسم المتجر -->
${storeBlock}

<hr class="d2">

<!-- ③ جدول المنتجات -->
<table class="ti">
  <colgroup>
    <col style="width:42%;">
    <col style="width:8%;">
    <col style="width:22%;">
    <col style="width:28%;">
  </colgroup>
  <thead>
    <tr style="border-bottom:1px solid #000;">
      <th style="text-align:right;">المنتج</th>
      <th style="text-align:center;">ك</th>
      <th style="text-align:center;">السعر</th>
      <th style="text-align:left;">المجموع</th>
    </tr>
  </thead>
  <tbody>${itemRows}</tbody>
</table>

<hr class="d1">

<!-- ④ المجاميع -->
<table class="t2">
  <colgroup><col style="width:50%;"><col style="width:50%;"></colgroup>
  <tbody>${totRows}</tbody>
</table>

<hr class="d2">

<!-- ⑤ رسالة الشكر -->
${welcome}

<!-- ⑥ باركود -->
${barcode}

<!-- ⑦ فاصل سفلي -->
<hr class="db">

<script>
window.addEventListener('load',function(){
  setTimeout(function(){
    window.print();
    window.onafterprint=function(){window.close();};
    setTimeout(function(){window.close();},25000);
  },450);
});
<\/script>
</body>
</html>`;
}

/**
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
