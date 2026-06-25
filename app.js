const STORAGE_KEY = 'daigou_pro_v2';
const OLD_KEY = 'daigou_stable_orders_v1';
let demands = [];
let purchases = [];
let receiptImages = [];
let pendingSolitaireRows = [];
let deferredPrompt = null;

const $ = id => document.getElementById(id);
const norm = (s='') => String(s ?? '').trim();
const low = s => norm(s).toLowerCase();
const num = (v,d=0) => { const n=Number(v); return Number.isFinite(n) ? n : d; };
const qty = v => Math.max(0, Math.floor(num(v,0)));
const money = n => '¥' + num(n).toFixed(2);
const escapeHtml = (s='') => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const uid = prefix => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2,7);

function parseLine(line){
  const raw = norm(line);
  if(!raw) return [];
  const delimiter = raw.includes('\t') ? '\t' : (raw.includes('，') ? '，' : ',');
  return raw.split(delimiter).map(norm);
}

function parseSolitaire(rawText){
  const lines = String(rawText || '').split(/\r?\n/).map(norm).filter(Boolean);
  const rows = [];
  for(const line of lines){
    // 支持：1. 张三 商品；1、张三 商品；1 张三 商品；① 张三 商品
    const m = line.match(/^(?:\d+|[①②③④⑤⑥⑦⑧⑨⑩])\s*[\.。．、\)]?\s*(.+)$/);
    if(!m) continue;
    let body = norm(m[1]);
    // 微信接龙常见尾部标记，先不处理；只解析序号行。
    if(!body) continue;
    const split = splitWechatNameAndItems(body);
    if(!split.customer) continue;
    const products = splitProductText(split.items);
    for(const prod of products){
      const q = extractQty(prod);
      rows.push({
        customerId: split.customer,
        customerName: split.customer,
        category: '',
        product: q.cleanProduct || prod,
        spec: q.spec || '',
        place: '',
        needQty: q.qty || 1,
        estimatePrice: 0,
        shipping: '',
        note: '从微信接龙导入；原文：' + line
      });
    }
  }
  return rows;
}
function splitWechatNameAndItems(body){
  // 默认把第一个空格前内容作为微信名。若昵称里有空格，可在预览区手动修正。
  const parts = body.split(/\s+/).filter(Boolean);
  if(parts.length === 1) return {customer: parts[0], items: ''};
  return {customer: parts[0], items: body.slice(body.indexOf(parts[1])).trim()};
}
function splitProductText(text){
  let t = norm(text);
  if(!t) return [];
  // 显式分隔符优先。中文逗号/顿号/分号/斜线两侧有空格时均视为分隔。
  t = t.replace(/[；;，,、]+/g, ' | ');
  // 常见接龙：中文商品之间用空格；英文品牌内部也有空格，所以只在“空格后像新商品开头”时拆。
  // 例如：too cool for school卧蚕笔09 medipeel撕拉面膜蓝色 -> 拆在 medipeel 前。
  t = t.replace(/\s+(?=(?:[\u4e00-\u9fa5]{2,}|[A-Za-z][A-Za-z0-9-]{2,}[\u4e00-\u9fa5]))/g, ' | ');
  return t.split('|').map(norm).filter(Boolean);
}
function extractQty(text){
  let product = norm(text);
  let qtyVal = 1;
  let spec = '';
  // 10片、1瓶、2盒、3个、一套 等默认视为需求数量；“10片”更常是规格/包装，但如果用户要做更精确单位，可在预览中改。
  const chineseNums = {一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
  const qtyMatch = product.match(/(?:×|x|X|\*)\s*(\d+)\s*$/) || product.match(/(\d+)\s*(?:个|件|瓶|盒|包|套|支|本|袋)\s*$/);
  const cnMatch = product.match(/([一二两三四五六七八九十])\s*(?:个|件|瓶|盒|包|套|支|本|袋)\s*$/);
  if(qtyMatch){ qtyVal = Math.max(1, parseInt(qtyMatch[1],10)); product = norm(product.slice(0, qtyMatch.index)); spec = qtyMatch[0].trim(); }
  else if(cnMatch){ qtyVal = chineseNums[cnMatch[1]] || 1; product = norm(product.slice(0, cnMatch.index)); spec = cnMatch[0].trim(); }
  return {cleanProduct: product || text, qty: qtyVal, spec};
}
function renderSolitairePreview(){
  const wrap = $('solitairePreviewWrap');
  const body = $('solitairePreviewRows');
  if(!pendingSolitaireRows.length){ wrap.hidden = true; body.innerHTML = ''; return; }
  wrap.hidden = false;
  body.innerHTML = pendingSolitaireRows.map((r,i)=>`<tr>
    <td><input value="${escapeHtml(r.customerId)}" data-sol="${i}" data-field="customerId"></td>
    <td><input value="${escapeHtml(r.category)}" data-sol="${i}" data-field="category" placeholder="可空"></td>
    <td><input value="${escapeHtml(r.product)}" data-sol="${i}" data-field="product"></td>
    <td><input value="${escapeHtml(r.spec)}" data-sol="${i}" data-field="spec" placeholder="可空"></td>
    <td><input value="${escapeHtml(r.place)}" data-sol="${i}" data-field="place" placeholder="可空"></td>
    <td><input type="number" min="1" value="${escapeHtml(r.needQty)}" data-sol="${i}" data-field="needQty"></td>
    <td><input type="number" min="0" step="0.01" value="${escapeHtml(r.estimatePrice)}" data-sol="${i}" data-field="estimatePrice"></td>
    <td><button onclick="deleteSolitairePreviewRow(${i})">删除</button></td>
  </tr>`).join('');
  body.querySelectorAll('input').forEach(inp=>{
    inp.addEventListener('input', e=>{
      const idx = Number(e.target.dataset.sol), field = e.target.dataset.field;
      pendingSolitaireRows[idx][field] = e.target.value;
      if(field === 'customerId') pendingSolitaireRows[idx].customerName = e.target.value;
    });
  });
}
window.deleteSolitairePreviewRow = i => { pendingSolitaireRows.splice(i,1); renderSolitairePreview(); };
function need(d){ return Math.max(1, qty(d.needQty || 1)); }
function estimatedSubtotal(d){ return need(d) * Math.max(0, num(d.estimatePrice,0)); }
function purchaseQty(p){ return qty(p.qty); }
function purchaseSubtotal(p){ return purchaseQty(p) * Math.max(0, num(p.unitPrice,0)); }
function demandMatchPurchase(d,p){
  if(!low(p.product)) return false;
  if(low(d.product) !== low(p.product)) return false;
  if(p.spec && low(d.spec) !== low(p.spec)) return false;
  if(p.place && low(d.place) !== low(p.place)) return false;
  if(p.category && low(d.category) !== low(p.category)) return false;
  return true;
}
function computeAllocations(){
  const allocation = Object.fromEntries(demands.map(d => [d.id, 0]));
  const sortedDemands = [...demands].sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
  const purchaseAlloc = {};
  purchases.forEach(p => {
    let remain = purchaseQty(p);
    purchaseAlloc[p.id] = [];
    for(const d of sortedDemands){
      if(remain <= 0) break;
      if(!demandMatchPurchase(d,p)) continue;
      const gap = Math.max(0, need(d) - allocation[d.id]);
      if(gap <= 0) continue;
      const take = Math.min(gap, remain);
      allocation[d.id] += take;
      purchaseAlloc[p.id].push({demandId:d.id, customerId:d.customerId, product:d.product, qty:take});
      remain -= take;
    }
  });
  return { allocation, purchaseAlloc };
}
function boughtFor(d, allocation){ return Math.min(need(d), qty(allocation[d.id])); }
function pendingFor(d, allocation){ return Math.max(0, need(d) - boughtFor(d, allocation)); }
function statusFor(d, allocation){
  const b = boughtFor(d, allocation), p = pendingFor(d, allocation);
  if(p===0 && b>0) return ['已买齐','status-ok'];
  if(b>0) return ['部分买到','status-warn'];
  return ['待购买','status-bad'];
}
function load(){
  try{
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if(data){ demands = data.demands || []; purchases = data.purchases || []; return render(); }
  }catch{}
  try{
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || '[]');
    if(Array.isArray(old) && old.length){
      demands = old.map(o => ({
        id:o.id || uid('D'), customerId:o.customerId||'', customerName:o.customerName||'', category:o.category||'', product:o.product||'', spec:o.spec||'', place:o.place||'',
        needQty:o.needQty||1, estimatePrice:o.unitPrice||0, shipping:o.shipping||'', tracking:o.tracking||'', note:o.note||'', createdAt:o.updatedAt||new Date().toISOString(), updatedAt:o.updatedAt||new Date().toISOString()
      }));
      purchases = old.filter(o=>qty(o.boughtQty)>0).map(o => ({id:uid('P'), product:o.product||'', category:o.category||'', spec:o.spec||'', place:o.place||'', qty:o.boughtQty||0, unitPrice:o.unitPrice||0, note:'从旧版数据迁移', receiptImages:[], createdAt:o.updatedAt||new Date().toISOString()}));
    }
  }catch{}
  render();
}
function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify({version:2,demands,purchases,updatedAt:new Date().toISOString()})); render(); }

function compressImage(file, maxSide=1200, quality=0.72){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let {width, height} = img;
        const scale = Math.min(1, maxSide / Math.max(width,height));
        width = Math.round(width*scale); height = Math.round(height*scale);
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img,0,0,width,height);
        resolve({name:file.name, dataUrl:canvas.toDataURL('image/jpeg', quality), size:file.size, storedAt:new Date().toISOString()});
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}


$('parseSolitaireBtn').onclick = () => {
  const parsed = parseSolitaire($('solitaireText').value);
  if(!parsed.length){ alert('没有解析到有效接龙行。请确认每行类似：1. 微信名 商品内容'); return; }
  pendingSolitaireRows = parsed;
  renderSolitairePreview();
};
$('clearSolitaireBtn').onclick = () => { $('solitaireText').value = ''; pendingSolitaireRows = []; renderSolitairePreview(); };
$('confirmSolitaireBtn').onclick = () => {
  const now = new Date().toISOString();
  let added = 0, skipped = [];
  pendingSolitaireRows.forEach((r, idx)=>{
    const d = {
      id: uid('D'), customerId:norm(r.customerId), customerName:norm(r.customerId), category:norm(r.category), product:norm(r.product), spec:norm(r.spec), place:norm(r.place),
      needQty: Math.max(1, qty(r.needQty || 1)), estimatePrice: Math.max(0, num(r.estimatePrice,0)), shipping:norm(r.shipping), note:norm(r.note), tracking:'', createdAt:now, updatedAt:now
    };
    if(!d.customerId || !d.product){ skipped.push(idx+1); return; }
    demands.push(d); added++;
  });
  save();
  pendingSolitaireRows = []; $('solitaireText').value = ''; renderSolitairePreview();
  alert(`已从接龙加入 ${added} 条需求${skipped.length ? `；预览第 ${skipped.join('、')} 行缺少微信名或商品，已跳过` : ''}`);
};

$('receiptFile').addEventListener('change', async e => {
  const files = [...e.target.files];
  if(!files.length){ receiptImages = []; $('receiptInfo').textContent = '未选择图片'; return; }
  $('receiptInfo').textContent = '正在压缩小票图片...';
  try{
    receiptImages = [];
    for(const f of files) receiptImages.push(await compressImage(f));
    $('receiptInfo').textContent = `已选择 ${receiptImages.length} 张小票图片`;
  }catch{
    receiptImages = [];
    $('receiptInfo').textContent = '图片读取失败，请重新选择';
  }
});

$('addDemandsBtn').onclick = () => {
  const lines = $('demandBatch').value.split(/\r?\n/).map(norm).filter(Boolean);
  if(!lines.length){ alert('请先输入需求内容'); return; }
  const now = new Date().toISOString();
  let added = 0, skipped = [];
  lines.forEach((line, idx) => {
    const c = parseLine(line);
    const d = {
      id: uid('D'), customerId:c[0]||'', customerName:c[1]||'', category:c[2]||'', product:c[3]||'', spec:c[4]||'', place:c[5]||'',
      needQty: Math.max(1, qty(c[6] || 1)), estimatePrice: Math.max(0, num(c[7],0)), shipping:c[8]||'', note:c[9]||'', tracking:'', createdAt:now, updatedAt:now
    };
    if(!d.customerId || !d.product){ skipped.push(idx+1); return; }
    demands.push(d); added++;
  });
  save();
  $('demandBatch').value = '';
  alert(`已新增 ${added} 条需求${skipped.length ? `；第 ${skipped.join('、')} 行缺少顾客ID或商品，已跳过` : ''}`);
};
$('clearDemandBtn').onclick = () => { $('demandBatch').value = ''; };

$('addPurchasesBtn').onclick = () => {
  const lines = $('purchaseBatch').value.split(/\r?\n/).map(norm).filter(Boolean);
  if(!lines.length){ alert('请先输入已购买内容'); return; }
  const now = new Date().toISOString();
  let added = 0, skipped = [];
  lines.forEach((line, idx) => {
    const c = parseLine(line);
    const p = { id: uid('P'), product:c[0]||'', qty:qty(c[1]||0), unitPrice:Math.max(0,num(c[2],0)), spec:c[3]||'', place:c[4]||'', category:c[5]||'', note:c[6]||'', receiptImages, createdAt:now };
    if(!p.product || p.qty <= 0){ skipped.push(idx+1); return; }
    purchases.push(p); added++;
  });
  save();
  $('purchaseBatch').value = ''; $('receiptFile').value = ''; receiptImages = []; $('receiptInfo').textContent = '未选择图片';
  alert(`已登记 ${added} 条购买记录${skipped.length ? `；第 ${skipped.join('、')} 行缺少商品或数量，已跳过` : ''}`);
};
$('clearPurchaseBtn').onclick = () => { $('purchaseBatch').value = ''; $('receiptFile').value = ''; receiptImages = []; $('receiptInfo').textContent='未选择图片'; };
$('searchBox').addEventListener('input', render);
$('placeFilter').addEventListener('change', renderShoppingSummary);

function groupBy(arr, fn){ return arr.reduce((m,o)=>{ const k=fn(o); (m[k] ||= []).push(o); return m; },{}); }
function render(){ const alloc = computeAllocations(); renderStats(alloc); renderRows(alloc); renderCustomerSummary(alloc); renderPlaceOptions(alloc); renderShoppingSummary(alloc); renderPurchases(alloc); }
function filteredDemands(){
  const q = low($('searchBox').value);
  if(!q) return demands;
  return demands.filter(d => [d.customerId,d.customerName,d.category,d.product,d.spec,d.place,d.shipping,d.note].join(' ').toLowerCase().includes(q));
}
function renderStats({allocation}){
  const tn = demands.reduce((s,d)=>s+need(d),0);
  const tb = demands.reduce((s,d)=>s+boughtFor(d, allocation),0);
  const tp = demands.reduce((s,d)=>s+pendingFor(d, allocation),0);
  const pay = purchases.reduce((s,p)=>s+purchaseSubtotal(p),0);
  $('totalNeed').textContent = tn; $('totalBought').textContent = tb; $('totalPending').textContent = tp; $('totalPaid').textContent = money(pay);
}
function renderRows({allocation}){
  const html = filteredDemands().map(d => {
    const [st,cls] = statusFor(d, allocation);
    return `<tr><td>${escapeHtml(d.customerId)}</td><td>${escapeHtml(d.customerName)}</td><td>${escapeHtml(d.category)}</td><td>${escapeHtml(d.product)}</td><td>${escapeHtml(d.spec)}</td><td>${escapeHtml(d.place)}</td><td>${need(d)}</td><td>${boughtFor(d, allocation)}</td><td>${pendingFor(d, allocation)}</td><td>${money(d.estimatePrice)}</td><td>${money(estimatedSubtotal(d))}</td><td class="${cls}">${st}</td><td><div class="op"><button onclick="deleteDemand('${d.id}')">删除</button></div></td></tr>`;
  }).join('');
  $('demandRows').innerHTML = html || '<tr><td colspan="13">暂无需求。可以在上方批量新增。</td></tr>';
}
window.deleteDemand = id => { if(confirm('确认删除这条顾客需求？对应购买记录不会删除，但会重新分配。')){ demands = demands.filter(d=>d.id!==id); save(); } };
window.deletePurchase = id => { if(confirm('确认删除这条购买批次？已买数量会重新计算。')){ purchases = purchases.filter(p=>p.id!==id); save(); } };
function renderCustomerSummary({allocation}){
  const groups = groupBy(demands, d => d.customerId || '未填ID');
  const html = Object.entries(groups).sort().map(([cid, list]) => {
    const name = list.find(d=>d.customerName)?.customerName || '';
    const ship = list.find(d=>d.shipping)?.shipping || '';
    const items = list.map(d => `${d.category?d.category+'｜':''}${d.product}${d.spec?'（'+d.spec+'）':''} ×${need(d)}，已买${boughtFor(d,allocation)}，待买${pendingFor(d,allocation)}`).join('\n');
    const tn=list.reduce((s,d)=>s+need(d),0), tb=list.reduce((s,d)=>s+boughtFor(d,allocation),0), tp=list.reduce((s,d)=>s+pendingFor(d,allocation),0), est=list.reduce((s,d)=>s+estimatedSubtotal(d),0);
    return `<div class="card"><h3>${escapeHtml(cid)} ${escapeHtml(name)}</h3><div class="items">${escapeHtml(items)}</div><p>总需求 ${tn}｜已买 ${tb}｜待买 ${tp}｜应收预估 ${money(est)}</p>${ship?`<p>收货信息：${escapeHtml(ship)}</p>`:''}</div>`;
  }).join('');
  $('customerSummary').innerHTML = html || '<p>暂无顾客汇总。</p>';
}
function renderPlaceOptions({allocation}){
  const selected = $('placeFilter').value;
  const places = [...new Set(demands.filter(d=>pendingFor(d,allocation)>0).map(d=>d.place).filter(Boolean))].sort();
  $('placeFilter').innerHTML = '<option value="">全部购买地</option>' + places.map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  if(places.includes(selected)) $('placeFilter').value = selected;
}
function renderShoppingSummary(state){
  const {allocation} = state || computeAllocations();
  const place = $('placeFilter').value;
  let active = demands.filter(d => pendingFor(d,allocation)>0);
  if(place) active = active.filter(d => d.place === place);
  const groups = groupBy(active, d => [d.category,d.product,d.spec,d.place].map(norm).join('||'));
  const rows = Object.values(groups).sort((a,b)=> (a[0].place+a[0].category+a[0].product).localeCompare(b[0].place+b[0].category+b[0].product,'zh-CN')).map(list => {
    const d = list[0];
    const tn=list.reduce((s,x)=>s+need(x),0), tb=list.reduce((s,x)=>s+boughtFor(x,allocation),0), tp=list.reduce((s,x)=>s+pendingFor(x,allocation),0);
    return `<tr><td>${escapeHtml(d.category)}</td><td>${escapeHtml(d.product)}</td><td>${escapeHtml(d.spec)}</td><td>${escapeHtml(d.place)}</td><td>${tn}</td><td>${tb}</td><td><strong>${tp}</strong></td></tr>`;
  }).join('');
  $('shoppingSummary').innerHTML = rows || '<tr><td colspan="7">当前筛选下没有待买商品。</td></tr>';
}
function renderPurchases({purchaseAlloc}){
  const html = [...purchases].reverse().map(p => {
    const alloc = purchaseAlloc[p.id] || [];
    const allocText = alloc.length ? alloc.map(a=>`${a.customerId} ${a.product} ×${a.qty}`).join('；') : '暂未匹配到待买需求';
    const imgs = (p.receiptImages||[]).map((img,i)=>`<a href="${img.dataUrl}" target="_blank">小票${i+1}</a>`).join(' ');
    return `<div class="card"><h3>${escapeHtml(p.product)} ×${purchaseQty(p)} ｜${money(p.unitPrice)}/件</h3><p>类目：${escapeHtml(p.category || '-')}｜规格：${escapeHtml(p.spec || '-')}｜购买地：${escapeHtml(p.place || '-')}｜小计：${money(purchaseSubtotal(p))}</p><p>分配：${escapeHtml(allocText)}</p>${p.note?`<p>备注：${escapeHtml(p.note)}</p>`:''}${imgs?`<p>小票：${imgs}</p>`:''}<p><button onclick="deletePurchase('${p.id}')">删除这条购买记录</button></p></div>`;
  }).join('');
  $('purchaseCards').innerHTML = html || '<p>暂无购买批次记录。</p>';
}

$('backupBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({version:2,exportedAt:new Date().toISOString(),demands,purchases},null,2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '代购Pro备份_' + new Date().toISOString().slice(0,10) + '.json'; a.click(); URL.revokeObjectURL(a.href);
};
$('importFile').addEventListener('change', async e => {
  const file = e.target.files[0]; if(!file) return;
  try{
    const data = JSON.parse(await file.text());
    if(!Array.isArray(data.demands)) throw new Error();
    if(confirm('导入后会覆盖当前数据。确认继续？')){ demands = data.demands || []; purchases = data.purchases || []; save(); }
  }catch{ alert('导入失败：请使用本工具导出的 JSON 备份文件。'); }
  e.target.value = '';
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt=e; $('installBtn').hidden=false; });
$('installBtn').onclick = async () => { if(!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $('installBtn').hidden=true; };
if('serviceWorker' in navigator){ window.addEventListener('load', ()=>navigator.serviceWorker.register('./sw.js').catch(()=>{})); }
load();
