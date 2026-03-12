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

  // اسم البائع
  const sellerName = sale.sellerName
    || window.sessionManager?.getUser()?.username
    || '';

  const cur   = cfg.currency  || 'DA';
  const paper = cfg.paperSize || '80mm';

  // افتراضياً كل عنصر مُفعَّل ما لم يكن '0' صريحاً
  const show = (k) => cfg[k] !== '0';

  // ── تنسيق العملة: "1.234,50 DA" (رقم ثم رمز) ────────────
  const fmt = (n) => {
    const num = parseFloat(n || 0);
    if (isNaN(num)) return `0 ${cur}`;
    const parts = num.toFixed(2).split('.');
    const int   = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const dec   = parts[1] === '00' ? '' : `,${parts[1]}`;
    return `${int}${dec} ${cur}`;
  };

  // تنسيق السعر بدون رمز العملة (للعمود الأوسط في الجدول)
  const fmtNum = (n) => {
    const num = parseFloat(n || 0);
    if (isNaN(num)) return '0';
    const parts = num.toFixed(2).split('.');
    const int   = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return parts[1] === '00' ? int : `${int},${parts[1]}`;
  };

  // ── تنسيق التاريخ: YYYY/MM/DD HH:MM ─────────────────────
  const fmtDate = (iso) => {
    if (!iso) return '';
    try {
      const d   = new Date(iso);
      const pad = x => String(x).padStart(2, '0');
      return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ` +
             `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ''; }
  };

  const widthMM = paper === '58mm' ? 58 : 80;

  const html = _buildReceiptHTML({
    sale, items, cfg, cur, fmt, fmtNum, fmtDate, widthMM, show, sellerName
  });

  const sent = await _trySendToServer(html, cfg, 'invoice');
  if (!sent) _iframePrintInvoice(html);
}

/* ─────────────────────────────────────────────────────────────
   بناء HTML الفاتورة الحرارية — مطابق للنموذج الأصلي خطوة بخطوة

   الهيكل (RTL: أول عنصر = يمين، آخر عنصر = يسار):

   ┌──────────────────────────────────────────────────┐
   │ فاتورة #001                    2026/03/11 22:49 │
   │ البائع:                                   ADMIN │
   │ ══════════════════════════════════════════════ │
   │              اسم المتجر                         │
   │ ══════════════════════════════════════════════ │
   │ المنتج         ك      السعر        المجموع      │
   │ civitale        1        95          95 DA       │
   │ ·············································· │
   │ الإجمالي:                               95 DA   │
   │ المدفوع:                                95 DA   │
   │ ══════════════════════════════════════════════ │
   │               شكراً لزيارتكم                   │
   │           ||||  #001  ||||                     │
   │ - - - - - - - - - - - - - - - - - - - - - -   │
   └──────────────────────────────────────────────────┘

   قواعد الاتجاه:
   • الصفحة كلها dir="rtl"
   • flex row في RTL: الطفل الأوّل → يمين ، الطفل الأخير → يسار
   • لذلك: في كل صف نضع [التسمية أولاً] ثم [القيمة]
   ───────────────────────────────────────────────────── */
function _buildReceiptHTML({ sale, items, cfg, cur, fmt, fmtNum, fmtDate, widthMM, show, sellerName }) {

  // تعقيم النص
  const esc = (s) => {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  };

  const isDebt   = sale.isDebt === 1 || sale.isDebt === true;
  const discount = parseFloat(sale.discount || 0);
  const change   = parseFloat(sale.change   || 0);
  const paid     = parseFloat(sale.paid     || 0);
  const total    = parseFloat(sale.total    || 0);
  const debtAmt  = isDebt ? Math.max(0, total - paid) : 0;
  const safeItems = Array.isArray(items) ? items : [];

  // ── مساعد: صف معلومات (تسمية يمين — قيمة يسار) ──────────
  // في RTL flex: التسمية أولاً → يمين ✓ | القيمة ثانياً → يسار ✓
  const infoRow = (label, value, extraStyle = '') =>
    `<div style="display:flex;justify-content:space-between;align-items:baseline;
                 margin-bottom:2px;${extraStyle}">
       <span>${esc(label)}</span>
       <span style="direction:ltr;text-align:left;">${esc(value)}</span>
     </div>`;

  // ── مساعد: صف مجاميع (تسمية يمين — قيمة يسار) ───────────
  const totRow = (label, value, bold = false, color = '') =>
    `<div style="display:flex;justify-content:space-between;align-items:baseline;
                 padding:1px 0;${bold ? 'font-weight:900;font-size:1rem;' : ''}
                 ${color ? `color:${color};` : ''}">
       <span>${label}</span>
       <span style="direction:ltr;text-align:left;">${value}</span>
     </div>`;

  // ────────────────────────────────────────────────────────
  // ① رأس: رقم الفاتورة (يمين) — التاريخ (يسار)
  // ────────────────────────────────────────────────────────
  const invNum  = esc(sale.invoiceNumber || '');
  const invDate = esc(fmtDate(sale.date));

  // في RTL: أول span → يمين (رقم الفاتورة) ✓
  //         ثاني span → يسار (التاريخ) ✓
  let topBlock = `
  <div style="display:flex;justify-content:space-between;align-items:baseline;
               margin-bottom:2px;">
    <span style="font-weight:900;font-size:0.95rem;">فاتورة ${invNum}</span>
    <span style="font-size:0.82rem;direction:ltr;">${invDate}</span>
  </div>`;

  // البائع: التسمية يمين — الاسم يسار
  if (sellerName) {
    topBlock += infoRow('البائع:', sellerName);
  }

  // الزبون (إن وُجد)
  if (sale.customerName) {
    topBlock += infoRow('الزبون:', sale.customerName);
    if (sale.customerPhone) {
      topBlock += infoRow('الهاتف:', sale.customerPhone);
    }
  }

  // ────────────────────────────────────────────────────────
  // ② اسم المتجر ومعلوماته — مركّز
  // ────────────────────────────────────────────────────────
  let storeBlock = '';

  if (show('printLogo') && cfg.storeLogo) {
    storeBlock += `
  <div style="text-align:center;margin:3px 0 2px;">
    <img src="${cfg.storeLogo}" alt=""
         style="max-width:55px;max-height:45px;object-fit:contain;"/>
  </div>`;
  }

  if (show('printName') && cfg.storeName) {
    storeBlock += `
  <div style="text-align:center;font-size:1.2rem;font-weight:900;
               letter-spacing:1px;margin:2px 0;">${esc(cfg.storeName)}</div>`;
  }

  if (show('printPhone') && cfg.storePhone) {
    storeBlock += `
  <div style="text-align:center;font-size:0.78rem;">${esc(cfg.storePhone)}</div>`;
  }

  if (show('printAddress') && cfg.storeAddress) {
    storeBlock += `
  <div style="text-align:center;font-size:0.76rem;margin-bottom:1px;">
    ${esc(cfg.storeAddress)}</div>`;
  }

  // ────────────────────────────────────────────────────────
  // ③ جدول المنتجات
  //    الأعمدة في RTL (أول عمود = يمين):
  //    المنتج(يمين) | ك | السعر(بدون DA) | المجموع(يسار مع DA)
  // ────────────────────────────────────────────────────────
  let itemsRows = '';
  safeItems.forEach(item => {
    const name  = esc(item.name || item.productName || '');
    const size  = item.size ? ` ${esc(item.size)}` : '';
    const qty   = parseFloat(item.quantity  || 0);
    const price = parseFloat(item.unitPrice || 0);
    const itot  = parseFloat(item.total     || qty * price);

    // السعر بدون رمز العملة (كما في النموذج)
    const qtyStr = qty % 1 === 0 ? qty : qty.toFixed(2);

    itemsRows += `
      <tr>
        <td class="c-prod">${name}${size}</td>
        <td class="c-qty">${qtyStr}</td>
        <td class="c-price">${fmtNum(price)}</td>
        <td class="c-total">${fmt(itot)}</td>
      </tr>`;
  });

  // ────────────────────────────────────────────────────────
  // ④ المجاميع
  //    التسمية يمين — القيمة يسار (مع رمز العملة)
  // ────────────────────────────────────────────────────────
  let totBlock = '';

  if (discount > 0.004) {
    totBlock += totRow('الخصم:', `- ${fmt(discount)}`, false, '#c53030');
  }

  // الإجمالي: خط عريض وحجم أكبر
  totBlock += totRow('الإجمالي:', fmt(total), true);

  // المدفوع
  totBlock += totRow('المدفوع:', fmt(paid));

  // الباقي — يظهر فقط إذا دفع أكثر من الإجمالي
  if (change > 0.004) {
    totBlock += totRow('الباقي:', fmt(change), false, '#1a7a3c');
  }

  // الدين — خط عريض وأحمر
  if (isDebt && debtAmt > 0.004) {
    totBlock += totRow('الدين:', fmt(debtAmt), true, '#c53030');
  }

  // ────────────────────────────────────────────────────────
  // ⑤ رسالة الشكر
  // ────────────────────────────────────────────────────────
  let welcomeHtml = '';
  if (show('printWelcome') && cfg.storeWelcome) {
    welcomeHtml = `
  <div style="text-align:center;font-size:0.9rem;font-weight:700;
               margin:4px 0 2px;">${esc(cfg.storeWelcome)}</div>`;
  }

  // ────────────────────────────────────────────────────────
  // ⑥ باركود الفاتورة
  // ────────────────────────────────────────────────────────
  let barcodeBlock = '';
  if (show('printBarcode') && sale.invoiceNumber) {
    const bcode = String(sale.invoiceNumber).replace(/[^A-Za-z0-9#\-]/g, '');
    if (bcode) {
      barcodeBlock = `
  <div style="text-align:center;margin:3px 0 2px;">
    <svg id="_invBC" style="display:block;margin:0 auto;"></svg>
    <div style="font-size:0.78rem;font-family:'Courier New',monospace;
                letter-spacing:3px;margin-top:1px;">${esc(sale.invoiceNumber)}</div>
  </div>
  <script>
    (function(){
      if(typeof JsBarcode!=='undefined'){
        try{
          JsBarcode('#_invBC','${bcode}',{
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

  // ────────────────────────────────────────────────────────
  // ⑦ تجميع HTML الكامل
  // ────────────────────────────────────────────────────────
  const needBC = show('printBarcode');

  // الهامش: 2mm كل جانب → محتوى 76mm في ورق 80mm
  // top: 3mm  |  sides: 2mm  |  bottom: 5mm
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  ${needBC ? `<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>` : ''}
  <style>
    /* ── reset شامل ── */
    *, *::before, *::after {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    /* ── إعداد الصفحة ── */
    @page {
      size: ${widthMM}mm auto;
      margin: 0;
    }

    html, body {
      width: ${widthMM}mm;
      background: #fff;
      color: #000;
    }

    body {
      /* هامش 2mm كل جانب — محتوى 76mm */
      padding: 3mm 2mm 5mm 2mm;
      font-family: 'Tahoma', 'Arial', sans-serif;
      font-size: 0.83rem;
      direction: rtl;
      /* منع أي overflow */
      overflow: hidden;
    }

    /* ── فاصلات ── */
    .s1 {
      border: none;
      border-top: 1px dashed #444;
      margin: 4px 0;
    }
    .s2 {
      border: none;
      border-top: 2px solid #000;
      margin: 4px 0;
    }
    .sdash {
      border: none;
      border-top: 1px dashed #444;
      margin-top: 5px;
    }

    /* ── جدول المنتجات ── */
    table {
      width: 100%;
      border-collapse: collapse;
      direction: rtl;
    }
    th {
      font-size: 0.8rem;
      font-weight: 900;
      padding: 2px 0;
      border-bottom: 1px solid #000;
    }
    td {
      font-size: 0.8rem;
      padding: 2px 0;
      vertical-align: top;
    }
    /* أعمدة الجدول — RTL: أول عمود يمين */
    .c-prod  {
      text-align: right;
      width: 42%;
      word-break: break-word;
      padding-right: 0;
    }
    .c-qty   {
      text-align: center;
      width: 8%;
      white-space: nowrap;
    }
    .c-price {
      text-align: center;
      width: 22%;
      white-space: nowrap;
    }
    .c-total {
      text-align: left;
      width: 28%;
      white-space: nowrap;
      font-weight: 700;
      direction: ltr;
    }

    @media print {
      @page { size: ${widthMM}mm auto; margin: 0; }
      html, body { width: ${widthMM}mm; }
      body { padding: 2mm 2mm 4mm 2mm; }
    }
  </style>
</head>
<body>

  <!-- ① رأس: رقم الفاتورة (يمين) — التاريخ (يسار) + البائع + الزبون -->
  ${topBlock}

  <hr class="s2">

  <!-- ② اسم المتجر -->
  ${storeBlock}

  <hr class="s2">

  <!-- ③ جدول المنتجات -->
  <table>
    <thead>
      <tr>
        <th class="c-prod">المنتج</th>
        <th class="c-qty">ك</th>
        <th class="c-price">السعر</th>
        <th class="c-total">المجموع</th>
      </tr>
    </thead>
    <tbody>
      ${itemsRows}
    </tbody>
  </table>

  <hr class="s1">

  <!-- ④ المجاميع -->
  ${totBlock}

  <hr class="s2">

  <!-- ⑤ رسالة الشكر -->
  ${welcomeHtml}

  <!-- ⑥ باركود -->
  ${barcodeBlock}

  <!-- ⑦ فاصل سفلي -->
  <hr class="sdash">

  <script>
    window.addEventListener('load', function() {
      setTimeout(function() {
        window.print();
        window.onafterprint = function() { window.close(); };
        setTimeout(function() { window.close(); }, 25000);
      }, 450);
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
