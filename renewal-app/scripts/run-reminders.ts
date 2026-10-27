import {createDatabase} from '../lib/database.ts';
import {runReminders} from '../lib/email.ts';
if(!process.env.DATABASE_URL)throw new Error('The renewal database is not configured.');
const {db,close}=createDatabase(process.env.DATABASE_URL);
try{const result=await runReminders(db,{encryptionKey:process.env.EMAIL_SETTINGS_KEY,origin:process.env.SITE_ORIGIN||''},{registerSchedule:true});console.log(JSON.stringify(result));if(result.failed||(result as any).needsReview)process.exitCode=1}finally{await close()}
