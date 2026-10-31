import {createDatabase} from '../lib/database.ts';
import {seedSampleData} from '../lib/sample-data.ts';
const url=process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL;
if(!url)throw new Error('A database connection is required.');
const {db,close}=createDatabase(url);
try{const result=await seedSampleData(db);console.log(`ICDD labelled sample records: ${result.total}; newly inserted: ${result.inserted}. No users, licences or email queues changed.`)}finally{await close()}
