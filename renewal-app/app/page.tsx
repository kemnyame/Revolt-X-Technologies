import Tracker from './tracker';
import {auth} from '@/lib/auth/server';
import {viewer} from '@/lib/http';
import {InputError} from '@/lib/domain';
import {redirect} from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Page(){const {data}=await auth().getSession();if(!data?.user)redirect('/login');try{const user=await viewer();return <Tracker signedIn displayName={user.displayName} signInUrl="/login" signOutUrl="/logout"/>}catch(error){if(!(error instanceof InputError))throw error;return <main className="logout-screen"><h1>This account does not have access.</h1><p>Ask an admin to add your email under Users &amp; access.</p><a href="/logout">Sign out</a></main>}}
