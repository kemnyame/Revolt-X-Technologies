import { dateInZone, id } from './db.mjs';
import { addExpense, createProduct, createSale, receiveStock } from './operations.mjs';

const products=[
  ['EL-1001','LED Panel 24W','Electrical','pcs','A-01',24,2800,4800,190],
  ['EL-1002','Surge Protector 6-Way','Electrical','pcs','A-02',18,5600,8500,76],
  ['EL-1003','PVC Conduit 25mm','Electrical','lengths','A-03',30,450,950,160],
  ['EL-1004','Solar Floodlight 100W','Electrical','pcs','A-04',10,15500,23000,8],
  ['PL-2001','PPR Elbow 20mm','Plumbing','pcs','B-01',50,250,650,130],
  ['PL-2002','Brass Ball Valve 1 Inch','Plumbing','pcs','B-02',20,1250,2200,14],
  ['PL-2003','Flexible Hose ½ Inch','Plumbing','pcs','B-03',25,800,1550,84],
  ['SF-3001','Reflective Safety Vest','Safety','pcs','C-01',20,1600,2900,115],
  ['SF-3002','Cut-resistant Work Gloves','Safety','pairs','C-02',30,950,1850,155],
  ['SF-3003','Industrial Safety Helmet','Safety','pcs','C-03',15,3200,4900,17],
  ['HD-4001','Stainless Steel Padlock','Hardware','pcs','D-01',12,2600,4750,68],
  ['HD-4002','Galvanised Roofing Screws','Hardware','boxes','D-02',12,2100,3650,63],
  ['HD-4003','Quick-set Epoxy 50ml','Hardware','pcs','D-03',15,1250,2200,42],
  ['PK-5001','Carton Sealing Tape 48mm','Packaging','rolls','E-01',40,700,1250,127],
  ['PK-5002','Stretch Wrap 500mm','Packaging','rolls','E-02',20,3200,5200,76],
  ['PK-5003','Heavy-duty Shipping Carton','Packaging','pcs','E-03',20,800,1400,82]
];
const suppliers=['Meridian Industrial Supply','Atlas Trade Partners','Coastline Imports'];
const customers=['Cedar Works Ltd','Aster Facilities','Bluebay Builders','Northstar Retail','Crownpoint Electrical','Coral Estates','Oakfield Services','Parkside Hardware'];
const team=[['Sam Mensah','warehouse','active'],['Alex Boateng','sales','active'],['Jordan Osei','finance','active'],['Morgan Owusu','viewer','invited']];
const expenses=[
  ['Harbour Freight Services','Freight','Container handling and inland transport','transfer',252000],
  ['Warehouse Support Co.','Utilities','Warehouse utilities','momo',46500],
  ['Axis Safety Supply','Operations','Pallet straps and handling supplies','cash',18500],
  ['Bayline Logistics','Transport','Local customer deliveries','transfer',74000],
  ['Vertex Facility Care','Maintenance','Quarterly warehouse equipment service','cheque',96000],
  ['Horizon Packaging','Operations','Packaging material replenishment','cash',21500]
];

export async function seedDemo(db,context){
  const base=new Date();
  const daysAgo=n=>dateInZone(context.timezone,new Date(base.getTime()-n*86400000));
  const items=[];
  for(const [sku,name,category,unit,location,reorderPoint,costMinor,priceMinor,quantity] of products){
    const {id:productId}=await createProduct(db,context,{sku,name,category,unit,location,reorderPoint,costMinor,priceMinor});
    items.push({productId,quantity,costMinor,priceMinor});
  }
  for(let shipment=0;shipment<3;shipment++){
    await receiveStock(db,context,{supplier:suppliers[shipment],shipment:'TEMA-DEMO-10'+(shipment+1),
      date:daysAgo(7-shipment),notes:'Fictional imported stock',lines:items.slice(shipment*6,shipment*6+6).map(({productId,quantity,costMinor})=>({productId,quantity,costMinor}))});
  }
  for(let i=0;i<customers.length;i++){
    const method=['momo','credit','cash','cheque'][i%4], date=daysAgo([0,0,1,2,2,3,4,6][i]);
    const choices=[items[i],items[(i+8)%items.length]];
    await createSale(db,context,{customer:customers[i],date,method,dueOn:method==='credit'?daysAgo(-5+i):null,
      reference:method==='momo'||method==='cheque'?'DEMO-'+method.toUpperCase()+'-10'+i:undefined,
      lines:choices.map(({productId,priceMinor,quantity},index)=>({productId,priceMinor,quantity:Math.min(quantity,7+i+index*3)}))
    });
  }
  for(let i=0;i<expenses.length;i++){
    const [payee,category,description,method,amountMinor]=expenses[i];
    await addExpense(db,context,{payee,category,description,method,amountMinor,date:daysAgo(Math.floor(i/2)),reference:'DEMO-EXP-10'+i});
  }
  for(const [name,role,status] of team){
    await db.query('INSERT INTO members(id,workspace_id,name,email,role,status) VALUES($1,$2,$3,$4,$5,$6)',
      [id(),context.workspace_id,name,role+'@example.test',role,status]);
  }
}
