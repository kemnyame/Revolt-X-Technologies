import { z } from 'zod';
import { audit, dateInZone, fail, first, id } from './db.mjs';
import { isoDate, minor, optional, uuid } from './validation.mjs';

const rangeForm = z.object({
  from: isoDate.optional(), to: isoDate.optional(),
  q: z.string().trim().max(120).default(''), page: z.coerce.number().int().min(1).max(10000).default(1)
});
const reconciliationForm = z.object({
  date: isoDate, openingMinor: minor, countedMinor: minor, notes: optional(500)
});
const params = 'parameters AS (SELECT $1::uuid ws,$2::date from_on,$3::date to_on,$4::text tz)';
const salesAsOf = `active_sales AS (
  SELECT s.* FROM sales s CROSS JOIN parameters r WHERE s.workspace_id=r.ws AND s.sold_on<=r.to_on
  AND (s.voided_at IS NULL OR (s.voided_at AT TIME ZONE r.tz)::date>r.to_on)
)`;
const expensesAsOf = `active_expenses AS (
  SELECT e.* FROM expenses e CROSS JOIN parameters r WHERE e.workspace_id=r.ws AND e.paid_on<=r.to_on
  AND (e.voided_at IS NULL OR (e.voided_at AT TIME ZONE r.tz)::date>r.to_on)
)`;
const paidAsOf = "p.status IN ('settled','reversed') AND p.settled_on<=r.to_on";
const pendingAsOf = "(p.settled_on IS NULL OR p.settled_on>r.to_on)";

const column = (key,label,format='text') => ({key,label,format});
const units = (key,label) => column(key,label,'number');
const amount = (key,label) => column(key,label,'money');
const dateColumn = (key,label) => column(key,label,'date');
const methodColumn = (key='method',label='Method') => column(key,label,'method');
const commonStockColumns = [
  column('sku','SKU'),column('name','Product'),column('category','Category'),column('location','Bin'),
  units('quantity','Total units'),units('cartons','Cartons'),units('boxes','Boxes'),units('loose','Loose units'),
  units('units_per_box','Units / box'),units('boxes_per_carton','Boxes / carton'),units('reorder_point','Reorder at'),
  units('reorder_gap','Units to reorder level')
];
const packUnits = 'NULLIF(p.units_per_box * p.boxes_per_carton,0)';
const onHand = `SELECT p.sku,p.name,p.category,p.location,p.quantity,p.units_per_box,p.boxes_per_carton,p.reorder_point,
  GREATEST(p.reorder_point-p.quantity,0) reorder_gap,
  CASE WHEN p.boxes_per_carton IS NOT NULL THEN p.quantity/${packUnits} END cartons,
  CASE WHEN p.units_per_box IS NOT NULL THEN COALESCE(p.quantity%${packUnits},p.quantity)/p.units_per_box END boxes,
  COALESCE(p.quantity%p.units_per_box,p.quantity) loose,`;
const currentStock = {
  labels:commonStockColumns, period:'current', permission:['inventory'], order:'name,sku', totals:['quantity','reorder_gap'],
  query: (_format, allowCost) => onHand+(allowCost
    ? ' p.cost_minor,(p.quantity::numeric*p.cost_minor) stock_value_minor'
    : ' NULL::bigint cost_minor,NULL::numeric stock_value_minor')+
    ' FROM products p CROSS JOIN parameters r WHERE p.workspace_id=r.ws AND NOT p.archived'
};
const reports = {
  inventory: {...currentStock,label:'Inventory on hand',description:'Available stock, pack sizes and catalogue-cost valuation.'},
  'low-stock': {
    ...currentStock,label:'Low stock & reorder',description:'Products at or below their reorder levels.',
    order:'quantity,name,sku',query:(format,allowCost)=>currentStock.query(format,allowCost)+' AND p.quantity<=p.reorder_point'
  },
  movements: {
    label:'Stock movements',description:'Receipts, sales, adjustments and reversals by effective date.',
    permission:['stock','finance'],order:'effective_on DESC,reference,sku',totals:['delta'],
    labels:[dateColumn('effective_on','Date'),column('reference','Reference'),column('sku','SKU'),column('name','Product'),
      column('kind','Movement'),units('delta','Unit change'),units('balance_after','Balance after')],
    query:`SELECT m.effective_on,m.reference,p.sku,p.name,m.kind,m.delta,m.balance_after FROM movements m
      JOIN products p ON p.workspace_id=m.workspace_id AND p.id=m.product_id CROSS JOIN parameters r
      WHERE m.workspace_id=r.ws AND m.effective_on BETWEEN r.from_on AND r.to_on`
  },
  inbound: {
    label:'Inbound shipments',description:'Supplier receipts, received quantities and purchase costs.',
    permission:['stock'],order:'received_on DESC,reference',document:'inbound',totals:['quantity','amount_minor'],
    labels:[dateColumn('received_on','Received'),column('reference','Receipt'),column('supplier','Supplier'),column('shipment','Shipment'),
      units('quantity','Posted units'),amount('amount_minor','Posted cost'),column('status','Status')],
    query:`SELECT i.id,i.received_on,i.reference,i.supplier,i.shipment,
      CASE WHEN i.voided_at IS NULL OR (i.voided_at AT TIME ZONE r.tz)::date>r.to_on THEN lines.quantity ELSE 0 END quantity,
      CASE WHEN i.voided_at IS NULL OR (i.voided_at AT TIME ZONE r.tz)::date>r.to_on THEN i.total_minor ELSE 0 END amount_minor,
      CASE WHEN i.voided_at IS NULL OR (i.voided_at AT TIME ZONE r.tz)::date>r.to_on THEN 'Posted' ELSE 'Reversed' END status
      FROM inbound i CROSS JOIN parameters r LEFT JOIN LATERAL (
        SELECT COALESCE(sum(l.quantity),0) quantity FROM inbound_lines l WHERE l.workspace_id=i.workspace_id AND l.receipt_id=i.id
      ) lines ON true WHERE i.workspace_id=r.ws AND i.received_on BETWEEN r.from_on AND r.to_on`
  },
  sales: {
    label:'Sales register',description:'Sales by customer, transaction date and payment method.',
    permission:['sales','salesRead'],order:'sold_on DESC,reference',document:'sales',totals:['amount_minor'],
    labels:[dateColumn('sold_on','Sale date'),column('reference','Sale'),column('customer','Customer'),methodColumn(),
      dateColumn('due_on','Due date'),amount('amount_minor','Posted sale'),column('status','Status')],
    query:`SELECT s.id,s.sold_on,s.reference,s.customer,s.method,s.due_on,
      CASE WHEN s.voided_at IS NULL OR (s.voided_at AT TIME ZONE r.tz)::date>r.to_on THEN s.total_minor ELSE 0 END amount_minor,
      CASE WHEN s.voided_at IS NULL OR (s.voided_at AT TIME ZONE r.tz)::date>r.to_on THEN 'Posted' ELSE 'Reversed' END status
      FROM sales s CROSS JOIN parameters r WHERE s.workspace_id=r.ws AND s.sold_on BETWEEN r.from_on AND r.to_on`
  },
  'sales-method': {
    label:'Sales by payment method',description:'Compare cash, credit, cheque and Mobile Money sales.',
    permission:['sales','salesRead'],order:'amount_minor DESC,method',totals:['transactions','amount_minor'],with:salesAsOf,
    labels:[methodColumn(),units('transactions','Sales'),amount('amount_minor','Sales amount')],
    query:`SELECT s.method,count(*) transactions,sum(s.total_minor) amount_minor FROM active_sales s CROSS JOIN parameters r
      WHERE s.sold_on BETWEEN r.from_on AND r.to_on GROUP BY s.method`
  },
  'sales-product': {
    label:'Sales by product',description:'Units sold and sales value for each SKU.',
    permission:['sales','salesRead'],order:'amount_minor DESC,sku',totals:['quantity','amount_minor'],with:salesAsOf,
    labels:[column('sku','SKU'),column('name','Product'),units('quantity','Units sold'),amount('amount_minor','Sales amount')],
    query:`SELECT p.sku,p.name,sum(l.quantity) quantity,sum(l.quantity::numeric*l.price_minor) amount_minor
      FROM sale_lines l JOIN active_sales s ON s.workspace_id=l.workspace_id AND s.id=l.sale_id
      JOIN products p ON p.workspace_id=l.workspace_id AND p.id=l.product_id CROSS JOIN parameters r
      WHERE s.sold_on BETWEEN r.from_on AND r.to_on GROUP BY p.id,p.sku,p.name`
  },
  collections: {
    label:'Payment collections',description:'Cleared payments, including amounts collected against earlier sales.',
    permission:['finance'],order:'settled_on DESC,receipt_number',document:'sales',totals:['amount_minor'],with:salesAsOf,
    labels:[dateColumn('settled_on','Collected'),column('receipt_number','Receipt'),column('reference','Sale'),
      column('customer','Customer'),methodColumn(),column('payment_reference','Payment reference'),amount('amount_minor','Collected amount')],
    query:`SELECT s.id,p.id payment_id,'PAY-'||upper(left(replace(p.id::text,'-',''),12)) receipt_number,
      p.settled_on,s.reference,s.customer,p.method,p.reference payment_reference,p.amount_minor
      FROM payments p JOIN active_sales s ON s.workspace_id=p.workspace_id AND s.id=p.sale_id
      CROSS JOIN parameters r WHERE ${paidAsOf} AND p.settled_on>=r.from_on`
  },
  receivables: {
    label:'Outstanding credit & receivables',description:'Unpaid and part-paid sales, due dates and overdue aging.',
    permission:['finance'],period:'asof',order:'overdue_days DESC,due_on NULLS LAST,sold_on,reference',document:'sales',
    totals:['balance_minor','pending_minor'],with:salesAsOf,
    labels:[column('reference','Sale'),column('customer','Customer'),methodColumn(),dateColumn('sold_on','Sale date'),
      dateColumn('due_on','Due date'),amount('total_minor','Sale amount'),amount('paid_minor','Collected'),
      amount('pending_minor','Pending cheques'),amount('balance_minor','Outstanding'),units('overdue_days','Days overdue'),column('aging','Aging')],
    query:`SELECT s.id,s.reference,s.customer,s.method,s.sold_on,s.due_on,s.total_minor,
      b.paid_minor,b.pending_minor,(s.total_minor-b.paid_minor) balance_minor,
      CASE WHEN s.due_on IS NOT NULL THEN greatest(r.to_on-s.due_on,0) END overdue_days,
      CASE WHEN s.due_on IS NULL THEN 'No due date' WHEN s.due_on>=r.to_on THEN 'Current'
        WHEN r.to_on-s.due_on<=30 THEN '1–30 days' WHEN r.to_on-s.due_on<=60 THEN '31–60 days'
        WHEN r.to_on-s.due_on<=90 THEN '61–90 days' ELSE '91+ days' END aging
      FROM active_sales s CROSS JOIN parameters r CROSS JOIN LATERAL (
        SELECT COALESCE(sum(p.amount_minor) FILTER (WHERE ${paidAsOf}),0) paid_minor,
          COALESCE(sum(p.amount_minor) FILTER (WHERE p.method='cheque' AND ${pendingAsOf}),0) pending_minor
        FROM payments p WHERE p.workspace_id=s.workspace_id AND p.sale_id=s.id AND p.received_on<=r.to_on
      ) b WHERE s.total_minor>b.paid_minor`
  },
  cheques: {
    label:'Cheque register',description:'Pending, cleared, rejected and reversed cheques by date received.',
    permission:['finance'],order:'received_on DESC,reference,cheque',document:'sales',
    labels:[dateColumn('received_on','Received'),column('cheque','Cheque no.'),column('reference','Sale'),column('customer','Customer'),
      amount('amount_minor','Amount'),column('status','Status'),dateColumn('decision_on','Decision date')],
    query:`SELECT s.id,p.received_on,p.reference cheque,s.reference,s.customer,p.amount_minor,
      CASE WHEN s.voided_at IS NOT NULL AND (s.voided_at AT TIME ZONE r.tz)::date<=r.to_on AND p.status='reversed' THEN 'Reversed'
        WHEN ${pendingAsOf} THEN 'Pending' WHEN p.status='rejected' THEN 'Rejected' ELSE 'Cleared' END status,
      CASE WHEN s.voided_at IS NOT NULL AND (s.voided_at AT TIME ZONE r.tz)::date<=r.to_on AND p.status='reversed'
        THEN (s.voided_at AT TIME ZONE r.tz)::date WHEN p.settled_on<=r.to_on THEN p.settled_on END decision_on
      FROM payments p JOIN sales s ON s.workspace_id=p.workspace_id AND s.id=p.sale_id
      CROSS JOIN parameters r WHERE p.workspace_id=r.ws AND p.method='cheque' AND p.received_on BETWEEN r.from_on AND r.to_on`
  },
  expenses: {
    label:'Expense register',description:'Operating expenses by payee, category and payment method.',
    permission:['finance'],order:'paid_on DESC,reference',document:'expenses',totals:['amount_minor'],
    labels:[dateColumn('paid_on','Date'),column('reference','Reference'),column('payee','Payee'),column('category','Category'),
      methodColumn(),column('payment_reference','Payment reference'),amount('amount_minor','Posted expense'),column('status','Status')],
    query:`SELECT e.id,e.paid_on,e.reference,e.payee,e.category,e.method,e.payment_reference,
      CASE WHEN e.voided_at IS NULL OR (e.voided_at AT TIME ZONE r.tz)::date>r.to_on THEN e.amount_minor ELSE 0 END amount_minor,
      CASE WHEN e.voided_at IS NULL OR (e.voided_at AT TIME ZONE r.tz)::date>r.to_on THEN 'Posted' ELSE 'Reversed' END status
      FROM expenses e CROSS JOIN parameters r WHERE e.workspace_id=r.ws AND e.paid_on BETWEEN r.from_on AND r.to_on`
  },
  'expense-category': {
    label:'Expenses by category',description:'Expense totals grouped by category.',
    permission:['finance'],order:'amount_minor DESC,category',totals:['transactions','amount_minor'],with:expensesAsOf,
    labels:[column('category','Category'),units('transactions','Transactions'),amount('amount_minor','Total expense')],
    query:`SELECT e.category,count(*) transactions,sum(e.amount_minor) amount_minor FROM active_expenses e CROSS JOIN parameters r
      WHERE e.paid_on BETWEEN r.from_on AND r.to_on GROUP BY e.category`
  }
};
const methodNames = {cash:'Cash',credit:'Credit',cheque:'Cheque',momo:'Mobile Money',transfer:'Bank transfer'};

function validatePeriod(context, from, to) {
  const today = dateInZone(context.timezone);
  const end = to || today;
  const start = from || end.slice(0,7)+'-01';
  if (start < '1900-01-01' || end > today || start > end) fail(400,'Choose a valid date range ending today or earlier.');
  if (Date.parse(end)-Date.parse(start) > 366*86400000) fail(400,'Choose a date range of 367 days or fewer.');
  return [start,end];
}

const decimal = value => {
  const v = BigInt(value || 0);
  const absolute = v < 0n ? -v : v;
  return (v<0n?'-':'')+absolute/100n+'.'+String(absolute%100n).padStart(2,'0');
};
function csvValue(value, format) {
  if (format==='money' && value != null) return decimal(value);
  if (format==='method') return methodNames[value] || value;
  return value;
}

async function dataset(db,context,name,query,exportRows,can) {
  if (!Object.hasOwn(reports,name)) fail(404,'Report not found.');
  const config=reports[name];
  if (!config.permission.some(permission=>can(context,permission))) fail(403,'Your role does not allow this report.');
  const q=rangeForm.parse(query);
  const period=config.period || 'range';
  const [from,to]=validatePeriod(context,period==='asof'?undefined:q.from,q.to);
  const allowCost=can(context,'stock') || can(context,'finance');
  const isInventory=period==='current';
  const columns=config.labels.slice();
  const totals=(config.totals || []).slice();
  if (isInventory && allowCost) {
    columns.push(amount('cost_minor','Unit cost'),amount('stock_value_minor','Stock value'));
    totals.push('stock_value_minor');
  }
  const source=typeof config.query==='function'?config.query(period,allowCost):config.query;
  const search=columns.map(col=>col.key).join(',');
  const totalsSql=totals.map(key=>',coalesce(sum('+key+') OVER(),0)::text "'+key+'_total"').join('');
  const pageSize=40;
  const offset=exportRows?0:(q.page-1)*pageSize;
  const cte='WITH '+params+(config.with?', '+config.with:'')+', report_rows AS ('+source+')';
  const where=" WHERE concat_ws(' ',"+search+") ILIKE '%' || $5 || '%'";
  const values=[context.workspace_id,from,to,context.timezone,q.q];
  const {rows}=await db.query(cte+' SELECT *,count(*) OVER() records'+totalsSql+' FROM report_rows'+where
    +' ORDER BY '+config.order+' LIMIT '+(exportRows?10001:pageSize)+' OFFSET '+offset,values);
  const records=rows.length?Number(rows[0].records):offset?
    Number((await first(db,cte+' SELECT count(*) records FROM report_rows'+where,values)).records):0;
  if (exportRows && records>10000) fail(400,'Narrow the report to 10,000 records or fewer before exporting.');
  const summary = totals.map(key=>({
    ...columns.find(col=>col.key===key),value:rows[0]?.[key+'_total'] || '0'
  }));
  const projected=rows.map(row=> {
    const cells=Object.fromEntries(columns.map(col=>[col.key,row[col.key]]));
    return config.document?{...cells,id:row.id,paymentId:row.payment_id}:cells;
  });
  return {columns,rows:projected,records,page:q.page,pageSize,summary,document:config.document,
    from,to,period,label:config.label};
}

const dailySummary = `WITH ${params},${salesAsOf},${expensesAsOf},
  day_sales AS (
    SELECT s.method,count(*)::int count,COALESCE(sum(s.total_minor),0)::text amount
    FROM active_sales s CROSS JOIN parameters r WHERE s.sold_on=r.to_on GROUP BY s.method
  ), day_collections AS (
    SELECT p.method,count(*)::int count,COALESCE(sum(p.amount_minor),0)::text amount
    FROM payments p JOIN active_sales s ON s.workspace_id=p.workspace_id AND s.id=p.sale_id
    CROSS JOIN parameters r WHERE ${paidAsOf} AND p.settled_on=r.to_on GROUP BY p.method
  ), day_expenses AS (
    SELECT e.method,count(*)::int count,COALESCE(sum(e.amount_minor),0)::text amount
    FROM active_expenses e CROSS JOIN parameters r WHERE e.paid_on=r.to_on GROUP BY e.method
  ), overdue_sales AS (
    SELECT s.id,s.total_minor-COALESCE(sum(p.amount_minor),0) balance
    FROM active_sales s CROSS JOIN parameters r LEFT JOIN payments p
      ON p.workspace_id=s.workspace_id AND p.sale_id=s.id AND ${paidAsOf}
    WHERE s.due_on<r.to_on GROUP BY s.id,s.total_minor HAVING s.total_minor>COALESCE(sum(p.amount_minor),0)
  ), day_movements AS (
    SELECT m.kind,count(DISTINCT m.source_id)::int records,COALESCE(sum(m.delta),0)::text units
    FROM movements m CROSS JOIN parameters r WHERE m.workspace_id=r.ws AND m.effective_on=r.to_on GROUP BY m.kind
  )
  SELECT
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.method) FROM day_sales x),'[]'::jsonb) sales,
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.method) FROM day_collections x),'[]'::jsonb) collections,
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.method) FROM day_expenses x),'[]'::jsonb) expenses,
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.kind) FROM day_movements x),'[]'::jsonb) movements,
    (SELECT jsonb_build_object('count',count(*)::int,'amount',COALESCE(sum(p.amount_minor),0)::text)
      FROM payments p JOIN active_sales s ON s.workspace_id=p.workspace_id AND s.id=p.sale_id CROSS JOIN parameters r
      WHERE p.method='cheque' AND p.received_on<=r.to_on AND ${pendingAsOf}) pending,
    (SELECT jsonb_build_object('count',count(*)::int,'amount',COALESCE(sum(balance),0)::text) FROM overdue_sales) overdue,
    (SELECT jsonb_build_object('count',count(*)::int,'amount',COALESCE(sum(s.total_minor),0)::text)
      FROM sales s CROSS JOIN parameters r WHERE s.workspace_id=r.ws AND (s.voided_at AT TIME ZONE r.tz)::date=r.to_on) reversed_sales,
    (SELECT jsonb_build_object('count',count(*)::int,'amount',COALESCE(sum(e.amount_minor),0)::text)
      FROM expenses e CROSS JOIN parameters r WHERE e.workspace_id=r.ws AND (e.voided_at AT TIME ZONE r.tz)::date=r.to_on) reversed_expenses`;

async function daily(db,context,date) {
  const requested=date || dateInZone(context.timezone);
  const [day] = validatePeriod(context,requested,requested);
  const data = await first(db,dailySummary,[context.workspace_id,day,day,context.timezone]);
  const cashIn=BigInt(data.collections.find(row=>row.method==='cash')?.amount || 0);
  const cashOut=BigInt(data.expenses.find(row=>row.method==='cash')?.amount || 0);
  return {...data,date:day,cashIn:String(cashIn),cashOut:String(cashOut),netCash:String(cashIn-cashOut)};
}

const reconciliationColumns = 'id,business_date,opening_minor,counted_minor,expected_minor,variance_minor,notes,recorded_by,created_at';
function receiptCsv(reply,toCsv,name,rows) {
  return reply.type('text/csv; charset=utf-8')
    .header('content-disposition','attachment; filename="warehouse-'+name+'.csv"').send(toCsv(rows));
}

function dailyRows(context,report,record) {
  const rows = [
    ['End of day',report.date],['Business',context.workspace_name],['Currency',context.currency],[],
    ['Section','Method or metric','Count','Amount or units']
  ];
  for (const group of ['sales','collections','expenses']) {
    for (const row of report[group]) rows.push([group,methodNames[row.method],row.count,decimal(row.amount)]);
  }
  rows.push(['Balances','Pending cheques',report.pending.count,decimal(report.pending.amount)],
    ['Balances','Overdue receivables',report.overdue.count,decimal(report.overdue.amount)],
    ['Reversals','Sales',report.reversed_sales.count,decimal(report.reversed_sales.amount)],
    ['Reversals','Expenses',report.reversed_expenses.count,decimal(report.reversed_expenses.amount)],
    ['Cash','Cash collected','',decimal(report.cashIn)],['Cash','Cash expenses','',decimal(report.cashOut)],
    ['Cash','Net recorded cash','',decimal(report.netCash)]);
  for (const row of report.movements) rows.push(['Stock movements',row.kind,row.records,row.units]);
  if (record) rows.push([],['Counted at',record.created_at],['Recorded by',record.recorded_by],
    ['Opening cash',decimal(record.opening_minor)],['Expected cash',decimal(record.expected_minor)],
    ['Counted cash',decimal(record.counted_minor)],['Variance',decimal(record.variance_minor)],['Notes',record.notes]);
  return rows;
}

export function registerReports(db,{read,write,can,toCsv}) {
  read('/api/reports',['inventory'],c=>Object.entries(reports).filter(([,config])=>config.permission.some(p=>can(c,p)))
    .map(([key,{label,description,period}])=>({key,label,description,period:period || 'range'})));
  read('/api/reports/:name',['inventory'],(c,r)=>dataset(db,c,r.params.name,r.query,false,can));
  read('/api/reports/:name/export',['inventory'],async(c,r,reply)=>{
    const report=await dataset(db,c,r.params.name,r.query,true,can);
    return receiptCsv(reply,toCsv,r.params.name,[report.columns.map(col=>col.label),
      ...report.rows.map(row=>report.columns.map(col=>csvValue(row[col.key],col.format)))]);
  });
  read('/api/end-of-day',['finance'],async(c,r)=>{
    const date=z.object({date:isoDate.optional()}).parse(r.query).date;
    const report=await daily(db,c,date);
    const {rows:reconciliations}=await db.query('SELECT '+reconciliationColumns+
      ' FROM daily_reconciliations WHERE workspace_id=$1 AND business_date=$2 ORDER BY created_at DESC,id LIMIT 25',
      [c.workspace_id,report.date]);
    return {report,reconciliations};
  });
  async function saved(db,c,recordId) {
    const record=await first(db,'SELECT '+reconciliationColumns+',snapshot FROM daily_reconciliations WHERE workspace_id=$1 AND id=$2',
      [c.workspace_id,recordId]);
    if (!record) fail(404,'Cash count not found.');
    return record;
  }
  read('/api/end-of-day/reconciliations/:id',['finance'],(c,r)=>saved(db,c,uuid.parse(r.params.id)));
  read('/api/end-of-day/export',['finance'],async(c,r,reply)=>{
    const q=z.object({date:isoDate.optional(),id:uuid.optional()}).parse(r.query);
    const record=q.id?await saved(db,c,q.id):null;
    const report=record?.snapshot || await daily(db,c,q.date);
    return receiptCsv(reply,toCsv,'end-of-day-'+report.date,dailyRows(c,report,record));
  });
  write('POST','/api/end-of-day/reconcile',['finance'],async(d,c,r)=>{
    const form=reconciliationForm.parse(r.body);
    const snapshot=await daily(d,c,form.date);
    const expected=BigInt(form.openingMinor)+BigInt(snapshot.netCash);
    const variance=BigInt(form.countedMinor)-expected;
    const recordId=id();
    await d.query(`INSERT INTO daily_reconciliations(id,workspace_id,business_date,opening_minor,counted_minor,expected_minor,
      variance_minor,notes,snapshot,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [recordId,c.workspace_id,form.date,form.openingMinor,form.countedMinor,String(expected),String(variance),form.notes,snapshot,c.member_name]);
    await audit(d,c,'Cash count saved',form.date,'Variance in minor units '+variance);
    return {id:recordId,expectedMinor:String(expected),varianceMinor:String(variance)};
  });
}
