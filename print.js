// ══════════════════════════════════════════════════════════════
//  POSDZ_PRINT — v11.0
//  الحل الصحيح لمشكلة التدوير 90°:
//  - الملصق 40x20mm هو landscape (عرض > ارتفاع)
//  - Chrome عند @page يقرر الاتجاه بناء على size
//  - نُصرّح بـ landscape أو portrait حسب أبعاد الملصق
//  - نرسم Canvas بـ DPI الطابعة (203) ثم نطبع PNG
// ══════════════════════════════════════════════════════════════

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

    // أبعاد الملصق بالبكسل (203 DPI)
    const W = mm2px(size.w);
    const H = mm2px(size.h);
    const P = mm2px(0.7);  // padding

    // أحجام الخطوط
    // حجم الخط متناسب مع ارتفاع الملصق الفعلي بالبكسل
    const baseFS = Math.round(H * 0.13);          // 13% من ارتفاع الملصق
    const FS  = Math.max(12, Math.min(40, baseFS));
    const FSS = Math.max(10, FS - 3);             // اسم المتجر
    const FSP = Math.max(12, FS);                 // اسم المنتج
    const FSN = Math.max(9,  Math.round(FS*0.75));// رقم الباركود
    const FSR = Math.max(14, Math.round(FS*1.2)); // السعر
    const font = '"'+(bcFont||'Arial')+'", Arial, sans-serif';

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';

    let y = P;

    // اسم المتجر
    if (showStore==='1' && sName) {
      ctx.font = '800 '+FSS+'px '+font;
      ctx.fillText(_clip(ctx, sName, W-P*2), W/2, y);
      y += FSS + Math.round(P*0.5);
    }

    // اسم المنتج
    if (showName!=='0') {
      const pn = product.name + (product.size?' \u2014 '+product.size:'');
      ctx.font = '900 '+FSP+'px '+font;
      ctx.fillText(_clip(ctx, pn, W-P*2), W/2, y);
      y += FSP + Math.round(P*0.5);
    }

    // حساب المساحة المتاحة للباركود
    let bot = P + FSN + Math.round(P*0.5);
    if (showPrice!=='0') bot += FSR + Math.round(P*0.5);
    const bH = Math.max(mm2px(5), H - y - bot - P);
    const bW = W - P*2;

    // رسم الباركود
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
          // نحسب xd بحيث يكون الباركود بعرض bW بالضبط
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
        // نرسم الباركود ممتداً ليملأ bW×bH بالكامل
        ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, P, y, bW, bH);
      } else {
        _fallbackBars(ctx, P, y, bW, bH, bv);
      }
    }

    y += bH + Math.round(P*0.3);

    // رقم الباركود
    ctx.font = '700 '+FSN+'px "Courier New", monospace';
    ctx.fillText(String(bv), W/2, y);
    y += FSN + Math.round(P*0.4);

    // السعر
    if (showPrice!=='0') {
      const pr = (typeof formatDZ==='function')
        ? formatDZ(product.sellPrice||0)
        : parseFloat(product.sellPrice||0).toFixed(2)+' '+(cur||'DA');
      ctx.font = '900 '+FSR+'px '+font;
      ctx.fillText(pr, W/2, y);
    }

    // ── تدوير الملصق 90° عكس عقارب الساعة ──────────────────
    // الملصق 40x20 يُطبع على لاصق مفرود أفقياً
    // الطابعة تسحب الورق عمودياً → يجب تدوير المحتوى 90°
    // عند 90°: العرض والارتفاع يتبادلان
    const rotated = document.createElement('canvas');
    rotated.width  = H;
    rotated.height = W;
    const rctx = rotated.getContext('2d');
    rctx.fillStyle = '#fff';
    rctx.fillRect(0, 0, rotated.width, rotated.height);
    // عند 90° عكس عقارب الساعة: translate(0, W)
    rctx.translate(0, W);
    rctx.rotate(-Math.PI / 2);
    rctx.drawImage(cv, 0, 0);

    return rotated;
  }

  // ── بناء HTML الطباعة ──────────────────────────────────────
  // الحل الجوهري لمشكلة التدوير:
  // - نُصرّح بـ landscape لملصقات W>H (مثل 40x20)
  // - نُصرّح بـ portrait لملصقات H>=W (مثل 58x38)
  // - نعطي HTML/body أبعاد المم مباشرة
  // - نجعل الصورة تملأ 100% بدون margins
  function _makeHTML(canvas, wMM, hMM) {
    const png  = canvas.toDataURL('image/png', 1.0);
    const isLS = wMM > hMM;  // landscape إذا العرض أكبر من الارتفاع
    const orientation = isLS ? 'landscape' : 'portrait';

    // لـ @page: إذا landscape نضع العرض أولاً، إذا portrait نضع الارتفاع أولاً
    // لكن المتصفح يتوقع دائماً: size: عرض ارتفاع
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

  // ── الدالة الرئيسية ────────────────────────────────────────
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
    // الصورة مدوّرة 90° → نبادل العرض والارتفاع
    const html   = _makeHTML(canvas, size.h, size.w);

    for (let i=0; i<copies; i++) {
      if (i>0) await new Promise(r => setTimeout(r, 700));
      await _printSmart(html, rawSize||'40x20', size);
    }
    if (copies>1 && typeof toast==='function')
      toast('🖨️ تمت طباعة '+copies+' نسخة', 'success');
  }

  // ── محرك الطباعة ──────────────────────────────────────────
  async function _printSmart(html, rawSize, size) {
    // محاولة السيرفر أولاً
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

    // Fallback: iframe صامت — الأكثر توافقاً مع Chrome
    _iframePrint(html);
  }

  // ── iframe صامت ───────────────────────────────────────────
  // نستخدم iframe وليس popup لأن popup يفتح نافذة بحجم مختلف
  // مما يجعل Chrome يعيد حساب layout وقد يدور الصفحة
  function _iframePrint(html) {
    document.getElementById('_bcF')?.remove();
    const f  = document.createElement('iframe');
    f.id     = '_bcF';
    // نعطيه حجم الشاشة لكن نخفيه - Chrome يطبع بـ @page وليس بحجم iframe
    f.style.cssText = [
      'position:fixed',
      'top:-9999px',
      'left:-9999px',
      'width:0px',
      'height:0px',
      'border:none',
      'visibility:hidden',
    ].join(';');
    document.body.appendChild(f);

    const doc = f.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    f.onload = function() {
      // نعطي المتصفح 300ms ليُطبّق @page CSS
      setTimeout(function() {
        try {
          f.contentWindow.focus();
          f.contentWindow.print();
        } catch(e) {
          // إذا فشل iframe، نفتح popup
          const w = window.open('','_blank','width=600,height=400');
          if (w) { w.document.write(html); w.document.close(); }
        }
        setTimeout(function() {
          if (f && f.parentNode) f.remove();
        }, 15000);
      }, 300);
    };
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
      _showModal(printers, cur, key, isBc);
    } else if (typeof _inputDialog==='function') {
      const v = await _inputDialog(
        isBc?'اسم طابعة الباركود:':'اسم طابعة الفواتير:', cur);
      if (v&&v.trim()) {
        await setSetting(key, v.trim());
        _updUI(isBc, v.trim());
        if (typeof toast==='function') toast('✅ تم حفظ: '+v.trim(), 'success');
      }
    } else {
      if (typeof toast==='function')
        toast('⚠️ شغّل server.js لجلب قائمة الطابعات', 'warning');
    }
  }

  function _showModal(printers, current, key, isBc) {
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
