import {spawnSync} from 'node:child_process';
function run(args,env){const result=spawnSync(process.execPath,args,{stdio:'inherit',env:{...process.env,...env}});if(result.status!==0)process.exit(result.status||1)}
if(!process.env.TEST_DATABASE_URL)throw new Error('The isolated development database is required for release checks.');
run(['--experimental-strip-types','scripts/migrate.ts'],{DATABASE_URL:process.env.TEST_DATABASE_URL,DATABASE_URL_UNPOOLED:process.env.TEST_DATABASE_URL});
run(['--experimental-strip-types','--test','tests/tracker.test.ts','tests/management.test.ts']);
run(['--experimental-strip-types','scripts/migrate.ts']);
