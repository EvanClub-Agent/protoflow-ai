import type { ProtoStore } from '../store/useProtoStore';
import { encryptExportHtml } from '../utils/encryptedHtml';

export interface WebExportOptions {
  includeStickyNotes: boolean;
  includeDbSchema: boolean;
  enableInteractiveFlow: boolean;
  passwordProtected: boolean;
  accessPassword: string;
}
export type WebExportState = Pick<ProtoStore, 'currentProjectMeta' | 'suppliers' | 'purchaseOrderItems' | 'draftAcceptanceLines' | 'stickyNotes' | 'dbTables'>;
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function renderStandaloneHtml(input: WebExportState, options: WebExportOptions): string {
  const { currentProjectMeta, suppliers, purchaseOrderItems, draftAcceptanceLines, stickyNotes, dbTables } = input;
  const { includeStickyNotes, includeDbSchema, enableInteractiveFlow } = options;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(currentProjectMeta.projectName)} - Web 交互原型演示 (由 Alex 桌面端发布)</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; color: #0f172a; display: flex; flex-direction: column; height: 100vh; overflow: hidden; -webkit-font-smoothing: antialiased; }
    header { height: 48px; background: #ffffff; color: #0f172a; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; font-size: 13px; border-bottom: 1px solid #e2e8f0; box-shadow: 0 1px 2px rgba(15,23,42,0.03); z-index: 10; }
    .badge { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; margin-left: 8px; }
    .layout { flex: 1; display: flex; overflow: hidden; }
    aside { width: 256px; background: #fff; border-right: 1px solid #e2e8f0; padding: 14px 12px; overflow-y: auto; }
    .nav-title { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.02em; margin: 12px 6px 6px; }
    .nav-btn { display: block; width: 100%; text-align: left; padding: 8px 10px; border: 1px solid transparent; background: transparent; border-radius: 8px; font-size: 12px; color: #475569; cursor: pointer; margin-bottom: 3px; font-weight: 500; transition: all 0.15s; }
    .nav-btn:hover { background: #f8fafc; color: #0f172a; }
    .nav-btn.active { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; font-weight: 600; }
    main { flex: 1; padding: 20px; overflow-y: auto; background: #f1f5f9; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 1px 3px rgba(15,23,42,0.04); overflow: hidden; margin-bottom: 16px; max-width: 1440px; margin-left: auto; margin-right: auto; }
    .card-header { background: #f8fafc; padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-weight: 700; font-size: 13px; color: #0f172a; display: flex; justify-content: space-between; align-items: center; }
    .card-body { padding: 16px; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; }
    th { background: #f8fafc; font-weight: 600; color: #475569; }
    input[type="number"], select { padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; width: 95px; background: #fff; color: #0f172a; }
    .btn { padding: 6px 12px; border-radius: 8px; border: none; font-size: 12px; font-weight: 600; cursor: pointer; transition: opacity 0.15s; }
    .btn:hover { opacity: 0.92; }
    .btn-primary { background: #2563eb; color: #fff; }
    .btn-success { background: #059669; color: #fff; }
    .sticky-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 14px; color: #1e293b; font-size: 12px; line-height: 1.6; }
    .sticky-pin { display: inline-block; background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; font-weight: 600; font-size: 10px; padding: 1px 6px; border-radius: 99px; margin-left: 4px; }
  </style>
</head>
<body>
  <header>
    <div>
      <strong>🌐 ${escapeHtml(currentProjectMeta.projectName)}</strong>
      <span class="badge">Axure 级 Web 交互演示版 (零依赖单文件 HTML)</span>
    </div>
    <div style="display:flex; gap:10px; align-items:center;">
      ${includeStickyNotes ? `      <label style="cursor:pointer; display:flex; align-items:center; gap:5px;">
        <input type="checkbox" id="togglePins" checked onchange="render()" />
        <span>📌 显示黄色需求便签 (${stickyNotes.length})</span>
      </label>` : ''}
    </div>
  </header>
  <div class="layout">
    <aside>
      <div class="nav-title">模块菜单目录 (点击交互)</div>
      <button class="nav-btn" id="nav-sup" onclick="switchPage('sup')">1. 基础资料 → 供应商审批 (18/130)</button>
      <button class="nav-btn" id="nav-po" onclick="switchPage('po')">2. 采购管理 → 采购订单确认 (34/130)</button>
      <button class="nav-btn active" id="nav-acc" onclick="switchPage('acc')">3. 验收入库 → 新增到货验收 (57/130)</button>
      ${
        includeDbSchema
          ? `<div class="nav-title">共用数据库表结构 (${dbTables.length}张表)</div>
      <button class="nav-btn" id="nav-db" onclick="switchPage('db')">🗄️ 查看底层数据库表与ER字典</button>`
          : ''
      }
    </aside>
    <main id="app-main"></main>
  </div>
  <script>
    const interactive = ${enableInteractiveFlow};
    const esc = value => String(value).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
    const state = {
      page: 'acc',
      suppliers: ${scriptJson(suppliers)},
      poItems: ${scriptJson(purchaseOrderItems)},
      lines: ${scriptJson(draftAcceptanceLines)},
      ${includeStickyNotes ? `stickyNotes: ${scriptJson(stickyNotes)},` : ''}
      ${includeDbSchema ? `dbTables: ${scriptJson(dbTables)},` : ''}
      submittedToast: ''
    };

    function switchPage(p) {
      state.page = p;
      ['sup','po','acc','db'].forEach(id => {
        const el = document.getElementById('nav-' + id);
        if (el) el.className = 'nav-btn' + (id === p ? ' active' : '');
      });
      render();
    }

    function approveSup(id) {
      if (!interactive) return;
      const s = state.suppliers.find(x => x.id === id);
      if (s) s.status = 'qualified';
      render();
    }

    function updateQty(idx, val) {
      if (!interactive) return;
      state.lines[idx].currentAcceptQty = Math.max(1, Number(val) || 1);
      render();
    }

    function updatePrice(idx, val) {
      if (!interactive) return;
      state.lines[idx].unitPriceTaxIncluded = Math.max(0, Number(val) || 0);
      render();
    }

    function submitOrder() {
      if (!interactive) return;
      state.submittedToast = '✅ 验收单已正式提交！已自动扣减上游采购订单余量并写入验收台账。';
      render();
    }

    function render() {
      const showPins = ${includeStickyNotes} && document.getElementById('togglePins').checked;
      const main = document.getElementById('app-main');

      if (state.page === 'sup') {
        main.innerHTML = \`
          <div class="card">
            <div class="card-header">
              <span>基础资料管理 → 供应商审批 (跨模块流转源头)</span>
              <button class="btn btn-primary" onclick="switchPage('acc')">前往下游【新增到货验收】查看下拉框同步 →</button>
            </div>
            <div class="card-body">
              <table>
                <thead><tr><th>供应商编码</th><th>名称</th><th>联系人</th><th>默认税率</th><th>状态</th><th>交互操作</th></tr></thead>
                <tbody>
                  \${state.suppliers.map(s => \`
                    <tr>
                      <td>\${esc(s.code)}</td>
                      <td><strong>\${esc(s.name)}</strong></td>
                      <td>\${esc(s.contactPerson)} (\${esc(s.phone)})</td>
                      <td>\${esc(s.taxRateDefault)}%</td>
                      <td>\${s.status === 'qualified' ? '✅ 已准入合格供方' : '⏳ 待审批'}</td>
                      <td>\${s.status === 'pending' ? \`<button class="btn btn-success" data-id="\${esc(s.id)}" \${interactive ? '' : 'disabled'} onclick="approveSup(this.dataset.id)">✓ 点击审批通过 (流入验收单下拉框)</button>\` : '已同步至下游'}</td>
                    </tr>
                  \`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        \`;
        return;
      }

      if (state.page === 'po') {
        main.innerHTML = \`
          <div class="card">
            <div class="card-header">
              <span>采购管理 → 采购订单确认 (Page 34)</span>
              <button class="btn btn-primary" onclick="switchPage('acc')">返回【新增到货验收】 →</button>
            </div>
            <div class="card-body">
              <table>
                <thead><tr><th>采购单号</th><th>商品名称</th><th>供应商</th><th>采购数量</th><th>已到货数量</th><th>含税单价</th></tr></thead>
                <tbody>
                  \${state.poItems.map(p => \`
                    <tr>
                      <td><strong>\${esc(p.poNumber)}</strong></td>
                      <td>\${esc(p.materialName)} (\${esc(p.spec)})</td>
                      <td>\${esc(p.supplierName)}</td>
                      <td>\${esc(p.orderedQty)} \${esc(p.unit)}</td>
                      <td>\${esc(p.deliveredQty)} \${esc(p.unit)}</td>
                      <td>¥\${p.unitPriceTaxIncluded.toFixed(2)}</td>
                    </tr>
                  \`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        \`;
        return;
      }

      if (${includeDbSchema} && state.page === 'db') {
        main.innerHTML = state.dbTables.map(t => \`
          <div class="card">
            <div class="card-header">
              <span>🗄️ \${esc(t.tableName)} (\${esc(t.cnName)}) · \${esc(t.domain)}</span>
              <span style="font-size:11px; color:#059669;">共表菜单：\${t.sharedByMenus.map(m => esc(m.menuTitle)).join(' | ')}</span>
            </div>
            <div class="card-body">
              <table>
                <thead><tr><th>字段名</th><th>类型</th><th>主键/外键</th><th>说明</th></tr></thead>
                <tbody>
                  \${t.columns.map(c => \`
                    <tr>
                      <td><code>\${esc(c.name)}</code></td>
                      <td><code>\${esc(c.dataType)}</code></td>
                      <td>\${c.isPrimaryKey ? '🔑 PK' : c.isForeignKey ? '🔗 FK' : '-'}</td>
                      <td>\${esc(c.comment)}</td>
                    </tr>
                  \`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        \`).join('');
        return;
      }

      const qualified = state.suppliers.filter(s => s.status === 'qualified');
      const totalAmt = state.lines.reduce((sum, l) => sum + l.currentAcceptQty * l.unitPriceTaxIncluded, 0);

      main.innerHTML = \`
        \${state.submittedToast ? \`<div style="background:#059669;color:#fff;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:12px;font-weight:700;">\${state.submittedToast}</div>\` : ''}
        <div class="card">
          <div class="card-header">
            <span>验收入库管理 → 新增到货验收 (Page 57 of 130)</span>
            <div>
              <button class="btn btn-success" \${interactive ? '' : 'disabled'} onclick="submitOrder()">✓ 提交到货验收单 \${showPins ? '<span class="sticky-pin">📌 #5</span>' : ''}</button>
            </div>
          </div>
          <div class="card-body">
            <div style="display:flex; gap:18px; flex-wrap:wrap; margin-bottom:14px; align-items:center;">
              <div><strong>到货验收单号：</strong>DHY20250908001</div>
              <div>
                <strong>合格供应商 \${showPins ? '<span class="sticky-pin">📌 #1</span>' : ''}：</strong>
                <select \${interactive ? '' : 'disabled'} style="width:240px;">
                  \${qualified.map(q => \`<option>\${esc(q.name)} (\${esc(q.contactPerson)})</option>\`).join('')}
                </select>
              </div>
              <div><strong>价税合计总额：</strong><span style="color:#059669;font-weight:800;font-size:15px;">¥ \${totalAmt.toFixed(2)}</span></div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>物料编码 & 名称</th>
                  <th>采购数量</th>
                  <th>已到货数</th>
                  <th>本次到货数量 \${showPins ? '<span class="sticky-pin">📌 #4</span>' : ''}</th>
                  <th>含税单价</th>
                  <th>税率</th>
                  <th>不含税单价(6位小数) \${showPins ? '<span class="sticky-pin">📌 #3</span>' : ''}</th>
                  <th>不含税金额</th>
                  <th>税额</th>
                  <th>价税合计</th>
                </tr>
              </thead>
              <tbody>
                \${state.lines.map((l, idx) => {
                  const rate = l.taxRate / 100;
                  const noTaxPrice = (l.unitPriceTaxIncluded / (1 + rate)).toFixed(6);
                  const taxIncAmt = l.currentAcceptQty * l.unitPriceTaxIncluded;
                  const noTaxAmt = taxIncAmt / (1 + rate);
                  const taxAmt = taxIncAmt - noTaxAmt;
                  return \`
                    <tr>
                      <td><strong>\${esc(l.materialName)}</strong><br/><span style="color:#64748b;font-size:11px;">\${esc(l.materialCode)}</span></td>
                      <td>\${esc(l.orderedQty)}</td>
                      <td>\${esc(l.alreadyAcceptedQty)}</td>
                      <td><input \${interactive ? '' : 'disabled'} type="number" value="\${esc(l.currentAcceptQty)}" onchange="updateQty(\${idx}, this.value)" /></td>
                      <td><input \${interactive ? '' : 'disabled'} type="number" step="0.01" value="\${esc(l.unitPriceTaxIncluded)}" onchange="updatePrice(\${idx}, this.value)" /></td>
                      <td>\${esc(l.taxRate)}%</td>
                      <td style="font-family:monospace;color:#1d4ed8;font-weight:700;">\${noTaxPrice}</td>
                      <td style="font-family:monospace;">\${noTaxAmt.toFixed(2)}</td>
                      <td style="font-family:monospace;">\${taxAmt.toFixed(2)}</td>
                      <td style="font-family:monospace;font-weight:700;color:#059669;">¥\${taxIncAmt.toFixed(2)}</td>
                    </tr>
                  \`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
        \${showPins ? \`
          <div class="sticky-box">
            <div style="font-weight:800;margin-bottom:6px;">📌 页面需求说明便签汇总（共 \${state.stickyNotes.length} 条组件级规则）：</div>
            \${state.stickyNotes.map(n => \`<div><strong>#\${esc(n.index)} [\${esc(n.targetWidgetName)}]：</strong>\${esc(n.text)}</div>\`).join('')}
          </div>
        \` : ''}
      \`;
    }
    render();
  </script>
</body>
</html>`;

}

export async function createWebExport(input: WebExportState, options: WebExportOptions): Promise<string> {
  const html = renderStandaloneHtml(input, options);
  if (!options.passwordProtected) return html;
  if (!options.accessPassword.trim()) throw new Error('请输入访问密码');
  return encryptExportHtml(html, options.accessPassword);
}
