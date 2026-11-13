import { createHash } from 'node:crypto';
import { z } from 'zod';
import { audit, dateInZone, fail, first, id, transaction } from './db.mjs';
import { currency, effectiveDate, email, integer, isoDate, label, minor, optional, paymentMethod, paymentReference, positiveMinor, quantity, role, timezone, totalOf, uuid, why } from './validation.mjs';

const productForm = z.object({
  sku: label(48).transform(v => v.toUpperCase()), name: label(), category: label(80), unit: label(24),
  location: label(60), reorderPoint: integer, costMinor: minor, priceMinor: minor
});
const receiptForm = z.object({
  supplier: label(), shipment: optional(), date: isoDate, notes: optional(500),
  lines: z.array(z.object({productId: uuid, quantity, costMinor: minor})).min(1).max(40)
});
const saleForm = z.object({
  customer: label(), date: isoDate, dueOn: isoDate.nullish(), method: z.enum(['cash','credit','cheque','momo']),
  reference: optional(), notes: optional(500),
  lines: z.array(z.object({productId: uuid, quantity, priceMinor: positiveMinor})).min(1).max(40)
});
const paymentForm = z.object({date: isoDate, method: paymentMethod, amountMinor: positiveMinor, reference: optional()});
const expenseForm = z.object({
  payee: label(), category: label(80), description: label(500), date: isoDate,
  method: z.enum(['cash','cheque','momo','transfer']), amountMinor: positiveMinor, reference: optional()
});
const adjustForm = z.object({delta: z.number().int().min(-1000000).max(1000000).refine(n => n !== 0,'Enter a non-zero stock change.'), reason: label(240)});
const businessForm = z.object({name: label(), currency, timezone});
const documentRef = (prefix, docId) => prefix + '-' + docId.replaceAll('-','').slice(0,12).toUpperCase();

export const abilities = {
  admin: ['inventory','stock','sales','finance','users','audit'],
  warehouse: ['inventory','stock'],
  sales: ['inventory','sales'],
  finance: ['inventory','salesRead','finance'],
  viewer: ['inventory']
};

export const can = (context, permission) => abilities[context.role].includes(permission);

async function once(client, context, request, operation) {
  const key = uuid.parse(request.headers['idempotency-key']);
  const fingerprint = createHash('sha256').update(JSON.stringify([request.method, request.url, request.body])).digest('hex');
  const params = [context.workspace_id, context.member_id, key];
  const inserted = await first(client, 'INSERT INTO request_keys(workspace_id,member_id,key,fingerprint) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING key',
    [...params,fingerprint]);
  if (!inserted) {
    const saved = await first(client, 'SELECT fingerprint,result FROM request_keys WHERE workspace_id=$1 AND member_id=$2 AND key=$3', params);
    if (saved.fingerprint !== fingerprint) fail(409,'This request identifier has already been used.');
    return saved.result;
  }
  const result = await operation();
  await client.query('UPDATE request_keys SET result=$4::jsonb WHERE workspace_id=$1 AND member_id=$2 AND key=$3', [...params,JSON.stringify(result)]);
  return result;
}

async function lockProducts(db, context, lines, includeArchived = false) {
  const ids = [...new Set(lines.map(line => line.productId))];
  if (ids.length !== lines.length) fail(400,'Add each product to a document only once.');
  const {rows} = await db.query('SELECT * FROM products WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND (archived=false OR $3) ORDER BY id FOR UPDATE',
    [context.workspace_id,ids,includeArchived]);
  if (rows.length !== lines.length) fail(400,'Select active products from this warehouse.');
  return new Map(rows.map(row => [row.id,row]));
}

async function move(db, context, product, delta, document, effectiveOn, kind) {
  const next = product.quantity + delta;
  if (next < 0) fail(409,product.name + ' has only ' + product.quantity + ' ' + product.unit + ' available.');
  if (next > 1000000000) fail(409,product.name + ' exceeds the stock quantity limit.');
  await db.query('UPDATE products SET quantity=$3 WHERE workspace_id=$1 AND id=$2',[context.workspace_id,product.id,next]);
  await db.query('INSERT INTO movements(id,workspace_id,product_id,source_id,reference,kind,delta,balance_after,effective_on) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id(),context.workspace_id,product.id,document.id,document.reference,kind,delta,next,effectiveOn]);
}

export async function createProduct(db, context, data) {
  const item = productForm.parse(data);
  const productId = id();
  await db.query('INSERT INTO products(id,workspace_id,sku,name,category,unit,location,reorder_point,cost_minor,price_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [productId,context.workspace_id,item.sku,item.name,item.category,item.unit,item.location,item.reorderPoint,item.costMinor,item.priceMinor]);
  await audit(db,context,'Product created',item.sku,item.name);
  return {id:productId};
}

async function updateProduct(db, context, productId, data) {
  const item = productForm.extend({archived:z.boolean()}).parse(data);
  const current = await first(db,'SELECT quantity FROM products WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[context.workspace_id,productId]);
  if (!current) fail(404,'Product not found.');
  if (item.archived && current.quantity > 0) fail(409,'Move remaining stock out before archiving this product.');
  await db.query('UPDATE products SET sku=$3,name=$4,category=$5,unit=$6,location=$7,reorder_point=$8,cost_minor=$9,price_minor=$10,archived=$11 WHERE workspace_id=$1 AND id=$2',
    [context.workspace_id,productId,item.sku,item.name,item.category,item.unit,item.location,item.reorderPoint,item.costMinor,item.priceMinor,item.archived]);
  await audit(db,context,item.archived?'Product archived':'Product updated',item.sku,item.name);
  return {id:productId};
}

export async function receiveStock(db, context, data) {
  const body = receiptForm.parse(data);
  const date = effectiveDate(body.date,context);
  const products = await lockProducts(db,context,body.lines);
  const receiptId = id(), reference = documentRef('IN',receiptId);
  await db.query('INSERT INTO inbound(id,workspace_id,reference,supplier,shipment,received_on,notes,total_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [receiptId,context.workspace_id,reference,body.supplier,body.shipment,date,body.notes,totalOf(body.lines,'costMinor')]);
  for (const line of body.lines) {
    const product=products.get(line.productId);
    await db.query('INSERT INTO inbound_lines(workspace_id,receipt_id,product_id,quantity,cost_minor,sku,name,unit) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [context.workspace_id,receiptId,line.productId,line.quantity,line.costMinor,product.sku,product.name,product.unit]);
    await move(db,context,product,line.quantity,{id:receiptId,reference},date,'inbound');
  }
  await audit(db,context,'Stock received',reference,body.supplier);
  return {id:receiptId,reference};
}

export async function createSale(db, context, data) {
  const body = saleForm.parse(data);
  const date = effectiveDate(body.date,context);
  const dueOn = body.method === 'credit' ? body.dueOn : null;
  if (body.method === 'credit' && !dueOn) fail(400,'Enter a due date for this credit sale.');
  if (dueOn && dueOn < date) fail(400,'The due date must be on or after the sale date.');
  const total = totalOf(body.lines,'priceMinor');
  const referenceNumber = body.method === 'credit' ? null : paymentReference(body.method,body.reference);
  const products = await lockProducts(db,context,body.lines);
  const saleId = id(), reference = documentRef('SL',saleId);
  await db.query('INSERT INTO sales(id,workspace_id,reference,customer,sold_on,due_on,method,total_minor,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [saleId,context.workspace_id,reference,body.customer,date,dueOn,body.method,total,body.notes]);
  for (const line of body.lines) {
    const product=products.get(line.productId);
    await db.query('INSERT INTO sale_lines(workspace_id,sale_id,product_id,quantity,price_minor,sku,name,unit) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [context.workspace_id,saleId,line.productId,line.quantity,line.priceMinor,product.sku,product.name,product.unit]);
    await move(db,context,product,-line.quantity,{id:saleId,reference},date,'sale');
  }
  if (body.method !== 'credit') await insertPayment(db,context,saleId,total,body.method,referenceNumber,date);
  await audit(db,context,'Sale posted',reference,body.customer);
  return {id:saleId,reference};
}

async function insertPayment(db, context, saleId, amount, method, reference, date) {
  const paymentId = id(), settled = method !== 'cheque';
  await db.query('INSERT INTO payments(id,workspace_id,sale_id,amount_minor,method,reference,received_on,settled_on,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [paymentId,context.workspace_id,saleId,amount,method,reference,date,settled?date:null,settled?'settled':'pending']);
  return paymentId;
}

async function getDocument(db, context, table, recordId, lock = false) {
  const row = await first(db,'SELECT * FROM '+table+' WHERE workspace_id=$1 AND id=$2'+(lock?' FOR UPDATE':''),[context.workspace_id,recordId]);
  if (!row) fail(404,'Document not found.');
  return row;
}

async function recordPayment(db, context, saleId, data) {
  const body = paymentForm.parse(data);
  const date = effectiveDate(body.date,context);
  const reference = paymentReference(body.method,body.reference);
  const sale = await getDocument(db,context,'sales',saleId,true);
  if (sale.voided_at) fail(409,'This sale was reversed.');
  if (date < sale.sold_on) fail(400,'The payment date cannot be earlier than the sale date.');
  const {amount} = await first(db,"SELECT COALESCE(sum(amount_minor),0) amount FROM payments WHERE workspace_id=$1 AND sale_id=$2 AND status IN ('pending','settled')",
    [context.workspace_id,saleId]);
  if (body.amountMinor > Number(sale.total_minor)-Number(amount)) fail(409,'This amount exceeds the balance available for payment. Review any pending cheques.');
  const paymentId = await insertPayment(db,context,saleId,body.amountMinor,body.method,reference,date);
  await audit(db,context,body.method==='cheque'?'Cheque recorded':'Payment recorded',sale.reference,body.method);
  return {id:paymentId,reference:sale.reference};
}

async function settleCheque(db, context, saleId, paymentId, data) {
  const body = z.object({action:z.enum(['clear','reject']),date:isoDate,reason:optional(240)}).parse(data);
  const date = effectiveDate(body.date,context);
  const sale = await getDocument(db,context,'sales',saleId,true);
  const cheque = await first(db,'SELECT * FROM payments WHERE workspace_id=$1 AND sale_id=$2 AND id=$3 FOR UPDATE',[context.workspace_id,saleId,paymentId]);
  if (!cheque) fail(404,'Cheque not found.');
  if (sale.voided_at || cheque.method !== 'cheque' || cheque.status !== 'pending') fail(409,'Only pending cheques can be cleared or rejected.');
  if (date < cheque.received_on) fail(400,'The decision date cannot precede the cheque receipt.');
  if (body.action === 'reject' && !body.reason) fail(400,'Enter the reason the cheque was rejected.');
  await db.query('UPDATE payments SET status=$4,settled_on=$5 WHERE workspace_id=$1 AND sale_id=$2 AND id=$3',
    [context.workspace_id,saleId,paymentId,body.action==='clear'?'settled':'rejected',date]);
  await audit(db,context,body.action==='clear'?'Cheque cleared':'Cheque rejected',sale.reference,body.reason||cheque.reference);
  return {id:paymentId};
}

async function reverseStockDocument(db, context, isSale, recordId, data) {
  const {reason} = why.parse(data);
  const table = isSale?'sales':'inbound', lineTable = isSale?'sale_lines':'inbound_lines', link = isSale?'sale_id':'receipt_id';
  const row = await getDocument(db,context,table,recordId,true);
  if (row.voided_at) fail(409,'This document was already reversed.');
  const {rows} = await db.query('SELECT product_id "productId",quantity FROM '+lineTable+' WHERE workspace_id=$1 AND '+link+'=$2',[context.workspace_id,recordId]);
  const products = await lockProducts(db,context,rows,true);
  const date = dateInZone(context.timezone);
  for (const line of rows) {
    const product = products.get(line.productId);
    await move(db,context,product,line.quantity*(isSale?1:-1),row,date,isSale?'sale reversal':'inbound reversal');
    if (isSale && product.archived) await db.query('UPDATE products SET archived=false WHERE workspace_id=$1 AND id=$2',[context.workspace_id,product.id]);
  }
  if (isSale) await db.query("UPDATE payments SET status='reversed' WHERE workspace_id=$1 AND sale_id=$2 AND status IN ('settled','pending')",[context.workspace_id,recordId]);
  await db.query('UPDATE '+table+' SET voided_at=now(),void_reason=$3 WHERE workspace_id=$1 AND id=$2',[context.workspace_id,recordId,reason]);
  await audit(db,context,isSale?'Sale reversed':'Receipt reversed',row.reference,reason);
  return {id:recordId,reference:row.reference};
}

async function adjustStock(db, context, productId, data) {
  const body = adjustForm.parse(data);
  const products = await lockProducts(db,context,[{productId}]);
  const adjustmentId = id(),reference = documentRef('ADJ',adjustmentId);
  await move(db,context,products.get(productId),body.delta,{id:adjustmentId,reference},dateInZone(context.timezone),'adjustment');
  await audit(db,context,'Stock adjusted',reference,body.reason);
  return {id:adjustmentId,reference};
}

export async function addExpense(db, context, data) {
  const body = expenseForm.parse(data);
  const date = effectiveDate(body.date,context);
  if (body.method !== 'cash' && !body.reference) fail(400,'Enter the payment reference for this expense.');
  const expenseId = id(),reference = documentRef('EX',expenseId);
  await db.query('INSERT INTO expenses(id,workspace_id,reference,payee,category,description,paid_on,method,payment_reference,amount_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [expenseId,context.workspace_id,reference,body.payee,body.category,body.description,date,body.method,body.reference,body.amountMinor]);
  await audit(db,context,'Expense recorded',reference,body.category);
  return {id:expenseId,reference};
}

async function reverseExpense(db, context, recordId, data) {
  const {reason} = why.parse(data);
  const expense = await first(db,'UPDATE expenses SET voided_at=now(),void_reason=$3 WHERE workspace_id=$1 AND id=$2 AND voided_at IS NULL RETURNING reference',
    [context.workspace_id,recordId,reason]);
  if (!expense) fail(409,'This expense could not be reversed.');
  await audit(db,context,'Expense reversed',expense.reference,reason);
  return {id:recordId,reference:expense.reference};
}

const salesSummary = "SELECT s.*,COALESCE(p.paid,0) paid_minor,COALESCE(p.pending,0) pending_minor,\n    CASE WHEN s.voided_at IS NOT NULL THEN 0 ELSE s.total_minor-COALESCE(p.paid,0) END balance_minor,\n    (s.voided_at IS NULL AND COALESCE(s.due_on<$2::date,false) AND COALESCE(p.paid,0)<s.total_minor) overdue,\n    CASE WHEN s.voided_at IS NOT NULL THEN 'Reversed' WHEN COALESCE(p.paid,0)>=s.total_minor THEN 'Paid'\n      WHEN COALESCE(p.pending,0)>0 THEN 'Cheque pending' WHEN COALESCE(p.paid,0)>0 THEN 'Part paid'\n      WHEN s.due_on < $2::date THEN 'Overdue' ELSE 'Outstanding' END status\n  FROM sales s LEFT JOIN LATERAL (\n    SELECT sum(amount_minor) FILTER(WHERE status='settled') paid,sum(amount_minor) FILTER(WHERE status='pending') pending\n    FROM payments WHERE workspace_id=s.workspace_id AND sale_id=s.id\n  ) p ON true WHERE s.workspace_id=$1";

async function summary(db, context) {
  const ws = context.workspace_id, today = dateInZone(context.timezone), start = today.slice(0,7)+'-01';
  const hasSales = can(context,'sales') || can(context,'salesRead');
  const [stock, categories, low, finance, activity, paymentBreakdown, trend] = await Promise.all([
    first(db,'SELECT count(*)::int skus, COALESCE(sum(quantity),0) units, count(*) FILTER(WHERE quantity<=reorder_point)::int low, COALESCE(sum(quantity::numeric*cost_minor),0) stock_value FROM products WHERE workspace_id=$1 AND NOT archived',[ws]),
    db.query('SELECT category, sum(quantity)::bigint units FROM products WHERE workspace_id=$1 AND NOT archived GROUP BY category ORDER BY units DESC LIMIT 6',[ws]),
    db.query('SELECT sku,name,quantity,reorder_point,unit FROM products WHERE workspace_id=$1 AND NOT archived AND quantity<=reorder_point ORDER BY quantity,sku LIMIT 5',[ws]),
    hasSales ? first(db,"WITH current_sales AS ("+salesSummary+") SELECT COALESCE(sum(total_minor) FILTER(WHERE sold_on >= $3 AND voided_at IS NULL),0) sales, COALESCE(sum(balance_minor),0) outstanding, COALESCE(sum(pending_minor),0) pending, (SELECT COALESCE(sum(amount_minor),0) FROM payments WHERE workspace_id=$1 AND status='settled' AND settled_on >= $3) collected, (SELECT COALESCE(sum(amount_minor),0) FROM expenses WHERE workspace_id=$1 AND voided_at IS NULL AND paid_on >= $3) expenses FROM current_sales",[ws,today,start]) : null,
    db.query('SELECT m.reference,m.kind,m.delta,m.effective_on,m.created_at,p.name,p.sku FROM movements m JOIN products p ON p.workspace_id=m.workspace_id AND p.id=m.product_id WHERE m.workspace_id=$1 ORDER BY m.created_at DESC,m.id LIMIT 7',[ws]),
    hasSales ? db.query('SELECT method,count(*)::int transactions,sum(total_minor) amount FROM sales WHERE workspace_id=$1 AND sold_on>=$2 AND voided_at IS NULL GROUP BY method',[ws,start]) : null,
    hasSales ? db.query("SELECT d::date AS day,COALESCE(sum(s.total_minor),0) amount FROM generate_series(($2::date-6)::timestamp,$2::date::timestamp,interval '1 day') d LEFT JOIN sales s ON s.workspace_id=$1 AND s.sold_on=d::date AND s.voided_at IS NULL GROUP BY d ORDER BY d",[ws,today]) : null
  ]);
  if (finance && !can(context,'finance')) delete finance.expenses;
  if (!can(context,'finance') && !can(context,'stock')) delete stock.stock_value;
  return {stock,categories:categories.rows,low:low.rows,activity:activity.rows,finance,trend:trend?.rows??[],paymentBreakdown:paymentBreakdown?.rows??[],today};
}

const listQuery = z.object({
  q:z.string().trim().max(120).default(''), filter:z.string().trim().max(80).default(''),
  page:z.coerce.number().int().min(1).max(10000).default(1)
});
const datasets = {
  inventory:{
    table:'products', filter:"($3='' OR ($3='low' AND quantity<=reorder_point AND NOT archived) OR ($3='active' AND NOT archived) OR ($3='archived' AND archived))",
    search:"concat_ws(' ',sku,name,category,location)", order:'archived,name,sku',
    fields:'id,sku,name,category,unit,location,quantity,reorder_point,cost_minor,price_minor,archived',
    export:['sku','name','category','unit','location','quantity','reorder_point','cost_minor','price_minor','archived']
  },
  inbound:{
    table:'inbound', filter:"($3='' OR ($3='posted' AND voided_at IS NULL) OR ($3='reversed' AND voided_at IS NOT NULL))",
    search:"concat_ws(' ',reference,supplier,shipment)",order:'received_on DESC,created_at DESC,id',
    export:['reference','supplier','shipment','received_on','total_minor','voided_at']
  },
  sales:{
    filter:"($3='' OR lower(status)=lower($3) OR method=$3 OR ($3='overdue' AND overdue))",search:"concat_ws(' ',reference,customer,method,status)",
    order:'sold_on DESC,created_at DESC,id',export:['reference','customer','sold_on','due_on','method','total_minor','paid_minor','pending_minor','balance_minor','status']
  },
  expenses:{
    table:'expenses',filter:"($3='' OR category=$3 OR ($3='posted' AND voided_at IS NULL) OR ($3='reversed' AND voided_at IS NOT NULL))",
    search:"concat_ws(' ',reference,payee,category,description,payment_reference)",order:'paid_on DESC,created_at DESC,id',
    export:['reference','payee','category','description','paid_on','method','payment_reference','amount_minor','voided_at']
  },
  movements:{
    select:'SELECT m.*,p.name,p.sku,p.unit FROM movements m JOIN products p ON p.workspace_id=m.workspace_id AND p.id=m.product_id WHERE m.workspace_id=$1',
    filter:"($3='' OR kind=$3)",search:"concat_ws(' ',reference,sku,name,kind)",
    order:'created_at DESC,id',export:['reference','sku','name','kind','delta','balance_after','effective_on']
  },
  audit:{
    table:'audit_log',filter:"($3='' OR action=$3)",search:"concat_ws(' ',reference,actor_name,action,detail)",
    order:'created_at DESC,id',export:['created_at','actor_name','action','reference','detail']
  },
  users:{
    table:'members', fields:'id,name,email,role,status,created_at',filter:"($3='' OR role=$3 OR status=$3)",
    search:"concat_ws(' ',name,email,role)",order:'name,id',export:['name','email','role','status','created_at']
  }
};
function csvEscape(value) {
  let cell = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[\s]*[=+@-]/.test(cell) && !/^-?\d+(\.\d+)?$/.test(cell)) cell = "'"+cell;
  return '"' + cell.replaceAll('"','""') + '"';
}
async function list(db, context, dataset, query, exportRows) {
  const q = listQuery.parse(query), cfg = datasets[dataset];
  const params = [context.workspace_id,q.q,q.filter];
  const base = dataset === 'sales' ? salesSummary.replaceAll('$2::date','$4::date') :
    cfg.select || 'SELECT '+(cfg.fields||'*')+' FROM '+cfg.table+' WHERE workspace_id=$1';
  if (dataset === 'sales') params.push(dateInZone(context.timezone));
  const predicate = '('+cfg.search+" ILIKE '%' || $2 || '%') AND "+cfg.filter;
  const head = 'WITH data AS ('+base+') ';
  const result = await db.query(head+'SELECT *,count(*) OVER() total_count FROM data WHERE '+predicate+' ORDER BY '+cfg.order+
    ' LIMIT '+(exportRows?10001:25)+' OFFSET '+(exportRows?0:(q.page-1)*25),params);
  const rows=result.rows;
  const total=rows.length?Number(rows[0].total_count):q.page>1&&!exportRows?
    Number((await first(db,head+'SELECT count(*) total FROM data WHERE '+predicate,params)).total):0;
  if (exportRows && total > 10000) fail(400,'Narrow the report to fewer than 10,001 records before exporting.');
  const hideCost = dataset==='inventory' && !can(context,'stock') && !can(context,'finance');
  const columns = cfg.export.filter(column => !hideCost || column!=='cost_minor');
  for (const row of rows) {
    delete row.total_count;
    if (hideCost) delete row.cost_minor;
  }
  if (exportRows) return '\ufeff'+[columns.map(c=>c.replace(/_minor$/,'').replaceAll('_',' ')),...rows.map(row=>columns.map(c=>c.endsWith('_minor')?(Number(row[c])/100).toFixed(2):row[c]))].map(r=>r.map(csvEscape).join(',')).join('\r\n');
  return {rows,total,page:q.page,pageSize:25};
}

async function detail(db, context, table, recordId) {
  if (table==='expenses') return getDocument(db,context,table,recordId);
  const isSale = table==='sales', ws=context.workspace_id;
  const row = isSale ? await first(db,salesSummary+' AND s.id=$3',[ws,dateInZone(context.timezone),recordId]) : await getDocument(db,context,table,recordId);
  if (!row) fail(404,'Document not found.');
  const tableName=isSale?'sale_lines':'inbound_lines',link=isSale?'sale_id':'receipt_id';
  row.lines=(await db.query('SELECT * FROM '+tableName+' WHERE workspace_id=$1 AND '+link+'=$2 ORDER BY name',[ws,recordId])).rows;
  if(isSale) row.payments=(await db.query('SELECT * FROM payments WHERE workspace_id=$1 AND sale_id=$2 ORDER BY created_at,id',[ws,recordId])).rows;
  return row;
}

export function registerOperations(app, db, { access, inviteMember, refreshInvite, editMember, invitationUrl }) {
  const authorize = (context, permissions) => {
    if (!permissions.some(permission=>can(context,permission))) fail(403,'Your role does not allow this action.');
    return context;
  };
  const read = (url, permissions, run) => app.get(url,async (request,reply)=>{
    const context=authorize(await access(request),permissions);
    return run(context,request,reply);
  });
  const write = (method,url,permissions,run) => app.route({method,url,handler:async request=>{
    const before=authorize(await access(request),permissions);
    const result=await transaction(db,async client=>{
      await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[before.workspace_id]);
      const context=authorize(await access(request,client),permissions);
      if(context.workspace_id!==before.workspace_id)fail(409,'The active workspace changed. Sign in again.');
      return once(client,context,request,()=>run(client,context,request));
    });
    return result.inviteId?{id:result.id,invitationUrl:invitationUrl(result.inviteId)}:result;
  }});
  const getId = req => uuid.parse(req.params.id);
  read('/api/dashboard',['inventory'],c=>summary(db,c));
  const accessByDataset = {inventory:['inventory'],inbound:['stock'],sales:['sales','salesRead'],expenses:['finance'],movements:['stock','finance'],audit:['audit'],users:['users']};
  for (const [name,permissions] of Object.entries(accessByDataset)) {
    read('/api/'+name,permissions,(c,req)=>list(db,c,name,req.query,false));
    read('/api/'+name+'/export',permissions,async (c,req,reply)=>{
      const contents=await list(db,c,name,req.query,true);
      return reply.type('text/csv; charset=utf-8').header('content-disposition','attachment; filename="warehouse-'+name+'.csv"').send(contents);
    });
  }
  read('/api/products/options',['stock','sales'],async (c,req)=>{
    const q=z.object({q:z.string().trim().max(120).default(''),id:uuid.optional()}).parse(req.query);
    const {rows}=await db.query("SELECT id,sku,name,quantity,unit,cost_minor,price_minor FROM products WHERE workspace_id=$1 AND NOT archived AND ($3::uuid IS NULL OR id=$3) AND concat_ws(' ',sku,name) ILIKE '%'||$2||'%' ORDER BY name,sku LIMIT 100",[c.workspace_id,q.q,q.id??null]);
    if(!can(c,'stock'))for(const row of rows)delete row.cost_minor;
    return rows;
  });
  for (const table of ['inbound','sales','expenses']) read('/api/'+table+'/:id',accessByDataset[table],(c,req)=>detail(db,c,table,getId(req)));
  write('POST','/api/inventory',['stock'],(d,c,r)=>createProduct(d,c,r.body));
  write('PUT','/api/inventory/:id',['stock'],(d,c,r)=>updateProduct(d,c,getId(r),r.body));
  write('POST','/api/inventory/:id/adjust',['users'],(d,c,r)=>adjustStock(d,c,getId(r),r.body));
  write('POST','/api/inbound',['stock'],(d,c,r)=>receiveStock(d,c,r.body));
  write('POST','/api/inbound/:id/reverse',['users'],(d,c,r)=>reverseStockDocument(d,c,false,getId(r),r.body));
  write('POST','/api/sales',['sales'],(d,c,r)=>createSale(d,c,r.body));
  write('POST','/api/sales/:id/reverse',['users'],(d,c,r)=>reverseStockDocument(d,c,true,getId(r),r.body));
  write('POST','/api/sales/:id/payments',['finance'],(d,c,r)=>recordPayment(d,c,getId(r),r.body));
  write('POST','/api/sales/:id/payments/:paymentId/decision',['finance'],(d,c,r)=>settleCheque(d,c,getId(r),uuid.parse(r.params.paymentId),r.body));
  write('POST','/api/expenses',['finance'],(d,c,r)=>addExpense(d,c,r.body));
  write('POST','/api/expenses/:id/reverse',['finance'],(d,c,r)=>reverseExpense(d,c,getId(r),r.body));
  write('POST','/api/users',['users'],(d,c,r)=>inviteMember(d,c,z.object({name:label(),email,role}).parse(r.body)));
  write('POST','/api/users/:id/invite',['users'],(d,c,r)=>refreshInvite(d,c,getId(r)));
  write('PUT','/api/users/:id',['users'],(d,c,r)=>editMember(d,c,getId(r),z.object({role,status:z.enum(['active','disabled','invited'])}).parse(r.body)));
  write('PUT','/api/workspace',['users'],async (d,c,r)=>{
    const form=businessForm.parse(r.body);
    if(c.currency!==form.currency) {
      const used=await first(d,'SELECT (EXISTS(SELECT 1 FROM products WHERE workspace_id=$1) OR EXISTS(SELECT 1 FROM expenses WHERE workspace_id=$1)) used',[c.workspace_id]);
      if(used.used)fail(409,'The currency can be changed before recording products or expenses.');
    }
    await d.query('UPDATE workspaces SET name=$2,currency=$3,timezone=$4 WHERE id=$1',[c.workspace_id,form.name,form.currency,form.timezone]);
    await audit(d,c,'Workspace settings updated',c.slug,form.name);
    return {updated:true};
  });
}
