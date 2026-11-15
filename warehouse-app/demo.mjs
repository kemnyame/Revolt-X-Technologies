import { dateInZone, id } from './db.mjs';
import { addExpense, createProduct, createSale, receiveStock, recordPayment, settleCheque } from './operations.mjs';

const products=[
  ['FR-1001','Rose Mist Body Spray 150 ml','Fragrance','A-01',24,2800,4800,190,12,6],
  ['FR-1002','Citrus Splash Body Spray 150 ml','Fragrance','A-02',18,2600,4500,76,12,6],
  ['FR-1003','Vanilla Eau de Parfum 50 ml','Fragrance','A-03',30,7500,11900,160,6,4],
  ['FR-1004','Amber Roll-on Perfume 12 ml','Fragrance','A-04',10,1950,3300,8,12,4],
  ['SC-2001','Shea Body Lotion 400 ml','Skin care','B-01',50,2800,5100,130,6,4],
  ['SC-2002','Vitamin C Face Serum 30 ml','Skin care','B-02',20,5250,7900,14,6,6],
  ['SC-2003','Aloe Soothing Gel 200 ml','Skin care','B-03',25,2900,4900,84,12,4],
  ['SC-2004','SPF 50 Sun Cream 50 ml','Skin care','B-04',20,5600,8900,115,12,4],
  ['MK-3001','Matte Lipstick · Cocoa','Makeup','C-01',30,1500,2950,155,12,8],
  ['MK-3002','Clear Lip Gloss 8 ml','Makeup','C-02',15,1100,2000,17,12,6],
  ['MK-3003','Pressed Powder · Deep','Makeup','C-03',12,3200,4900,68,6,4],
  ['MK-3004','Waterproof Mascara 10 ml','Makeup','C-04',12,2900,4800,63,12,4],
  ['HC-4001','Moisture Shampoo 300 ml','Hair care','D-01',15,3400,5900,42,6,4],
  ['HC-4002','Leave-in Conditioner 250 ml','Hair care','D-02',40,3600,6200,127,6,4],
  ['BT-5001','Coconut Shower Gel 500 ml','Bath & body','E-01',20,2700,4700,76,6,4],
  ['BT-5002','Oat Cleansing Bar 100 g','Bath & body','E-02',20,950,1800,82,12,6]
];
const suppliers=['Meridian Beauty Imports','Atlas Cosmetics Trading','Coastline Personal Care'];
const customers=['Cedar Beauty Studio','Aster Cosmetics Shop','Bluebay Beauty Mart','Northstar Retail','Crownpoint Salon','Coral Beauty Supplies','Oakfield Pharmacy','Parkside Beauty Shop'];
const team=[['Sam Mensah','warehouse','active'],['Alex Boateng','sales','active'],['Jordan Osei','finance','active'],['Morgan Owusu','viewer','invited']];
const expenses=[
  ['Harbour Freight Services','Freight','Container handling and inland transport','transfer',252000],
  ['Warehouse Support Co.','Utilities','Warehouse utilities','momo',46500],
  ['Axis Packaging Supply','Packaging','Packing supplies for retail orders','cash',18500],
  ['Bayline Logistics','Transport','Local customer deliveries','transfer',74000],
  ['Vertex Facility Care','Maintenance','Quarterly warehouse equipment service','cheque',96000],
  ['Horizon Packaging','Operations','Packaging material replenishment','cash',21500]
];

export async function seedDemo(db,context){
  const base=new Date();
  const daysAgo=n=>dateInZone(context.timezone,new Date(base.getTime()-n*86400000));
  const items=[];
  for(const [sku,name,category,location,reorderPoint,costMinor,priceMinor,quantity,unitsPerBox,boxesPerCarton] of products){
    const {id:productId}=await createProduct(db,context,{sku,name,category,unit:'pcs',location,reorderPoint,costMinor,priceMinor,unitsPerBox,boxesPerCarton});
    items.push({productId,quantity,costMinor,priceMinor});
  }
  for(let shipment=0;shipment<3;shipment++){
    await receiveStock(db,context,{supplier:suppliers[shipment],shipment:'TEMA-DEMO-10'+(shipment+1),
      date:daysAgo(7-shipment),notes:'Fictional imported stock',lines:items.slice(shipment*6,shipment*6+6).map(({productId,quantity,costMinor})=>({productId,quantity,costMinor}))});
  }
  for(let i=0;i<customers.length;i++){
    const method=['momo','credit','cash','cheque'][i%4], date=daysAgo([0,0,0,2,2,3,4,6][i]);
    const choices=[items[i],items[(i+8)%items.length]];
    const sale=await createSale(db,context,{customer:customers[i],date,method,dueOn:method==='credit'?daysAgo(i===5?1:-4):null,
      reference:method==='momo'||method==='cheque'?'DEMO-'+method.toUpperCase()+'-10'+i:undefined,
      lines:choices.map(({productId,priceMinor,quantity},index)=>({productId,priceMinor,quantity:Math.min(quantity,7+i+index*3)}))
    });
    if (i===5) await recordPayment(db,context,sale.id,{date:daysAgo(0),method:'cash',amountMinor:12000});
    if (i===7) {
      const payment=(await db.query('SELECT id FROM payments WHERE workspace_id=$1 AND sale_id=$2',[context.workspace_id,sale.id])).rows[0];
      await settleCheque(db,context,sale.id,payment.id,{action:'clear',date:daysAgo(0)});
    }
  }
  for(let i=0;i<expenses.length;i++){
    const [payee,category,description,method,amountMinor]=expenses[i];
    await addExpense(db,context,{payee,category,description,method,amountMinor,date:daysAgo(i===2?0:Math.floor(i/2)),reference:'DEMO-EXP-10'+i});
  }
  for(const [name,role,status] of team){
    await db.query('INSERT INTO members(id,workspace_id,name,email,role,status) VALUES($1,$2,$3,$4,$5,$6)',
      [id(),context.workspace_id,name,role+'@example.test',role,status]);
  }
}
