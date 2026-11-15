export function createReports(ui) {
  const {
    request, go, el, esc, money, count, date, methods, actions, pageHeader, button, primary,
    panelHead, table, empty, metric, field, input, select, dateField, amountField, note, detailCell,
    cents, mark, paymentTone, openDialog, formDialog, printDocument, writer, toast, viewDocument,
    viewPayment, downloadCsv, user
  }=ui;
  let range, businessDate, selected, options;

  function reset() {
    range={q:'',page:1};
    businessDate='';
    selected='inventory';
    options=null;
  }
  async function load(page) {
    if(page==='end-of-day') {
      return request('/api/end-of-day'+(businessDate?'?date='+businessDate:''));
    }
    if(!options)options=await request('/api/reports');
    const report=options.find(row=>row.key===selected) || options[0];
    if(!report)return null;
    selected=report.key;
    const query={q:range.q,page:range.page};
    if(report.period!=='current'&&range.to)query.to=range.to;
    if(report.period==='range'&&range.from)query.from=range.from;
    const result=await request('/api/reports/'+selected+'?'+new URLSearchParams(query));
    return {result,report,query};
  }
  const setPage = page => { range.page=page;void go('reports'); };
  const exportButton = button('Export CSV','','download','id="report-export"');
  const printable = button('Print / Save PDF','','','id="report-print"');
  const reportSummary = summary => summary.length?'<div class="report-totals">'+summary.map(item=>
    '<div class="report-total"><span>'+esc(item.label)+'</span><strong>'+esc(item.format==='money'?money(item.value):count(item.value))+'</strong></div>'
  ).join('')+'</div>':'';

  function reportValue(value,format) {
    if(value===undefined||value===null||value==='')return '—';
    if(format==='money')return money(value);
    if(format==='date')return date(value);
    if(format==='method')return methods[value]||value;
    if(format==='number')return count(value);
    return value;
  }
  function reportColumns(result,links) {
    return result.columns.map(col=>[
      col.label,row=>{
        const value=reportValue(row[col.key],col.format);
        if(col.key==='status'&&links)return mark(value,paymentTone(value)|| (value==='Posted'||value==='Cleared'?'good':''));
        if(links&&col.key==='receipt_number'&&row.paymentId) {
          return '<button type="button" class="link-button reference" data-report-sale="'+esc(row.id)+'" data-payment="'+esc(row.paymentId)+'">'+esc(value)+'</button>';
        }
        if(links&&col.key==='reference'&&result.document&&row.id) {
          return '<button type="button" class="link-button reference" data-report-sale="'+esc(row.id)+'">'+esc(value)+'</button>';
        }
        return esc(col.key==='kind'?actions[value]||value:value);
      },['money','number'].includes(col.format)?'num':''
    ]);
  }
  function showPrint(heading,sub,body) {
    openDialog(heading,sub,body+'<div class="form-footer no-print">'+button('Print / Save PDF','primary','','data-print-report')+'</div>',true);
    document.querySelector('[data-print-report]').onclick=printDocument;
    printDocument();
  }
  function renderReports(model) {
    if(!model) {
      el('workspace-content').innerHTML=pageHeader('Reports','')+empty('No reports are available for your role.');
      return;
    }
    const {result,report,query}=model;
    const showing=result.rows.length?count((result.page-1)*result.pageSize+1)+'–'+
      count((result.page-1)*result.pageSize+result.rows.length)+' of '+count(result.records)+' records':count(result.records)+' records';
    const periodText=result.period==='current'?'Current stock':
      result.period==='asof'?'As at '+date(result.to):date(result.from)+' to '+date(result.to);
    const rangeFields=result.period==='current'?'':(result.period==='range'?field('From',dateField('from',result.from)): '')+
      field(result.period==='asof'?'As at':'To',dateField('to',result.to));
    el('workspace-content').innerHTML=pageHeader('Reports','View and export stock, sales and finance records.',
      exportButton+button('Print page','','','id="report-print"'))+
      '<section class="panel report-filter"><form id="report-filters" class="report-controls">'+
      field('Report',select('report',options.map(item=>[item.key,item.label]),selected))+
      rangeFields+field('Search',input('q',range.q,'maxlength="120" placeholder="Search this report"'))+
      '<button type="submit" class="btn primary">Apply filters</button><p class="form-error" id="report-error" role="alert"></p></form></section>'+
      '<section class="panel report-preview">'+panelHead(result.label,report.description+' '+periodText+'.')+
      reportSummary(result.summary)+table(reportColumns(result,true),result.rows)+
      '<div class="page-nav"><span>'+esc(showing)+'</span><div class="inline">'+
      button('Previous','small','','id="report-previous"'+(result.page<=1?' disabled':''))+
      button('Next','small','','id="report-next"'+(result.page*result.pageSize>=result.records?' disabled':''))+
      '</div></div></section>';
    const form=el('report-filters');
    form.elements.report.onchange=()=>{
      selected=form.elements.report.value;
      range={q:'',page:1};
      void go('reports');
    };
    form.onsubmit=event=>{
      event.preventDefault();
      const values=Object.fromEntries(new FormData(form));
      const span=Date.parse(values.to)-Date.parse(values.from);
      if(values.to<'1900-01-01'||(values.from&&(span<0||span>366*86400000||values.from<'1900-01-01'))) {
        el('report-error').textContent='Choose a valid date range of 367 days or fewer.';
        return;
      }
      range={...range,...values,q:values.q.trim(),page:1};
      void go('reports');
    };
    el('report-previous').onclick=()=>setPage(result.page-1);
    el('report-next').onclick=()=>setPage(result.page+1);
    el('report-export').onclick=()=>{void downloadCsv('/api/reports/'+selected+'/export?'+new URLSearchParams(query),'warehouse-'+selected+'.csv').catch(e=>toast(e.message,true));};
    el('report-print').onclick=()=>showPrint(result.label,user().workspace_name+' · '+periodText,
      reportSummary(result.summary)+table(reportColumns(result,false),result.rows)+'<p class="muted print-records">'+esc(showing)+'</p>');
    el('workspace-content').querySelectorAll('[data-report-sale]').forEach(link=>link.onclick=()=>{
      const action=link.dataset.payment?viewPayment(link.dataset.reportSale,link.dataset.payment):viewDocument(result.document,link.dataset.reportSale);
      void action.catch(e=>toast(e.message,true));
    });
  }
  const sum = rows => rows.reduce((value,row)=>value+BigInt(row.amount),0n);
  const entries = rows => rows.reduce((value,row)=>value+row.count,0);

  function tenderTable(report) {
    const groups = [report.sales,report.collections,report.expenses].map(rows=>new Map(rows.map(row=>[row.method,row])));
    const labels=['cash','credit','momo','cheque','transfer'].filter(key=>groups.some(group=>group.has(key)));
    const rows=labels.map(method=>({method,sales:groups[0].get(method),collections:groups[1].get(method),expenses:groups[2].get(method)}));
    const amounts=(row,group)=>row[group]?'<strong>'+esc(money(row[group].amount))+'</strong><small>'+count(row[group].count)+' records</small>':'—';
    return rows.length?table([
      ['Payment method',r=>esc(methods[r.method])],['Sales',r=>amounts(r,'sales'),'num'],
      ['Collected',r=>amounts(r,'collections'),'num'],['Expenses',r=>amounts(r,'expenses'),'num']
    ],rows):empty('No sales, collections or expenses on this date.','report');
  }
  function cashSummary(report,record) {
    return '<div class="detail-grid reconciliation-grid">'+[
      ['Cash collected',money(report.cashIn)],['Cash expenses',money(report.cashOut)],['Net recorded cash',money(report.netCash)],
      ...(record?[
        ['Opening cash',money(record.opening_minor)],['Expected cash',money(record.expected_minor)],
        ['Counted cash',money(record.counted_minor)],['Cash difference',money(record.variance_minor)],
        ['Recorded by',record.recorded_by],['Saved on',date(record.created_at)]
      ]:[])
    ].map(([label,value])=>detailCell(label,value)).join('')+'</div>';
  }
  function stockTable(report) {
    if(!report.movements.length)return empty('No stock movements on this date.','arrows');
    return table([
      ['Movement',r=>esc(actions[r.kind]||r.kind)],['Records',r=>count(r.records),'num'],
      ['Unit change',r=>count(r.units),'num']
    ],report.movements);
  }
  function balances(report) {
    return '<div class="detail-grid">'+[
      ['Pending cheques at day end',money(report.pending.amount)],['Overdue receivables at day end',money(report.overdue.amount)],
      ['Sales reversed on this date',count(report.reversed_sales.count)+' · '+money(report.reversed_sales.amount)],
      ['Expenses reversed on this date',count(report.reversed_expenses.count)+' · '+money(report.reversed_expenses.amount)]
    ].map(([label,value])=>detailCell(label,value)).join('')+'</div>';
  }
  const subhead=(heading,content)=>'<section class="detail-section"><h3>'+esc(heading)+'</h3>'+content+'</section>';
  function printDaily(report,record) {
    const body=subhead('Sales, collections and expenses',tenderTable(report))+
      subhead('Cash reconciliation',cashSummary(report,record))+
      (record?.notes?'<p class="muted">'+esc(record.notes)+'</p>':'')+
      subhead('Balances and reversals',balances(report))+subhead('Stock activity',stockTable(report));
    showPrint(record?'Saved end-of-day cash count':'End-of-day report',user().workspace_name+' · '+date(report.date),body);
  }
  function reconcile(report) {
    const write=writer('/api/end-of-day/reconcile');
    const form=formDialog('Record cash count',date(report.date),
      field('Opening cash',amountField('opening'))+field('Counted cash',amountField('counted'))+
      '<div id="cash-estimate" class="notice full" role="status"></div>'+
      field('Notes',note('notes','','maxlength="500" placeholder="Record the cause of any difference"'),true),
      'Save cash count',async values=>{
        const result=await write({date:report.date,openingMinor:cents(values.opening),countedMinor:cents(values.counted),notes:values.notes});
        toast('Cash count saved. Difference '+money(result.varianceMinor)+'.');
        document.querySelector('#dialog').close();
        void go('end-of-day');
      });
    const update=()=>{
      const expected=cents(form.elements.opening.value)+Number(report.netCash);
      el('cash-estimate').textContent='Expected cash '+money(expected)+
        (form.elements.counted.value?' · Difference '+money(cents(form.elements.counted.value)-expected):'');
    };
    form.oninput=update;
    update();
  }
  function renderDaily({report,reconciliations}) {
    businessDate=report.date;
    const shortAmount=(rows,label,glyph,tone)=>metric(label,money(sum(rows)),count(entries(rows))+' records',glyph,tone);
    const cards=shortAmount(report.sales,'Posted sales','receipt','blue')+
      shortAmount(report.collections,'Payments collected','wallet','')+
      shortAmount(report.expenses,'Posted expenses','out','amber')+
      metric('Net recorded cash',money(report.netCash),'Cash collected less cash expenses','wallet','slate');
    el('workspace-content').innerHTML=pageHeader('End of day','Review daily transactions and reconcile cash at closing.',
      exportButton+printable+primary('Record cash count','reconcile','check'))+
      '<section class="panel report-filter"><form id="day-filter" class="report-controls">'+
      field('Business date',dateField('date',report.date))+'<button type="submit" class="btn">View date</button>'+
      '<span class="muted">'+esc(user().timezone)+'</span></form></section>'+
      '<div class="metric-grid">'+cards+'</div>'+
      '<div class="report-stack"><section class="panel">'+panelHead('Sales, collections and expenses','Sales use the sale date. Collections use the date the money cleared.')+
      tenderTable(report)+'</section>'+
      '<section class="panel">'+panelHead('Cash reconciliation','Expected cash equals opening cash plus cash collected less cash expenses. Same-day reversed cash sales are excluded. Record cash refunds for earlier sales as cash expenses.')+
      '<div class="panel-body">'+cashSummary(report,null)+'</div></section>'+
      '<div class="dashboard-row"><section class="panel">'+panelHead('Stock activity','Movements posted for the selected business date.')+stockTable(report)+'</section>'+
      '<section class="panel">'+panelHead('Balances and reversals','Pending and overdue amounts at the end of the selected day.')+
      '<div class="panel-body">'+balances(report)+'</div></section></div>'+
      '<section class="panel">'+panelHead('Saved cash counts','Each count keeps a copy of the report at the time of saving.')+
      (reconciliations.length?table([
        ['Saved',r=>'<strong>'+esc(date(r.created_at))+'</strong><small>'+esc(r.recorded_by)+'</small>'],
        ['Opening',r=>esc(money(r.opening_minor)),'num'],['Expected',r=>esc(money(r.expected_minor)),'num'],
        ['Counted',r=>esc(money(r.counted_minor)),'num'],['Difference',r=>esc(money(r.variance_minor)),'num'],
        ['Report',r=>button('View count','small','','data-count-id="'+esc(r.id)+'"')]
      ],reconciliations):empty('No cash count saved for this date.','clock'))+'</section></div>';
    const form=el('day-filter');
    form.onsubmit=event=>{event.preventDefault();businessDate=form.elements.date.value;void go('end-of-day');};
    el('workspace-content').querySelector('[data-action=reconcile]').onclick=()=>reconcile(report);
    el('report-export').onclick=()=>{void downloadCsv('/api/end-of-day/export?date='+report.date,'warehouse-end-of-day-'+report.date+'.csv').catch(e=>toast(e.message,true));};
    el('report-print').onclick=()=>printDaily(report,null);
    el('workspace-content').querySelectorAll('[data-count-id]').forEach(link=>link.onclick=async()=>{
      try {
        const record=await request('/api/end-of-day/reconciliations/'+link.dataset.countId);
        const body=cashSummary(record.snapshot,record)+
          (record.notes?'<p class="muted">'+esc(record.notes)+'</p>':'')+
          '<div class="form-footer no-print">'+button('Export CSV','','download','data-count-export')+
          button('Print / Save PDF','primary','','data-print-count')+'</div>';
        openDialog('Saved end-of-day cash count',user().workspace_name+' · '+date(record.business_date),body,true);
        document.querySelector('[data-print-count]').onclick=()=>printDaily(record.snapshot,record);
        document.querySelector('[data-count-export]').onclick=()=>{void downloadCsv('/api/end-of-day/export?id='+record.id,'warehouse-end-of-day-'+record.business_date+'.csv').catch(e=>toast(e.message,true));};
      } catch(error){toast(error.message,true);}
    });
  }
  function render(page,result) {
    if (page==='end-of-day')renderDaily(result);
    else renderReports(result);
  }
  reset();
  return {reset,load,render};
}
