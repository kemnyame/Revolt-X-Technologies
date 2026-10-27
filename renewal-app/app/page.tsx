import Tracker from './tracker';
import {auth,ownerAllowed} from '@/lib/auth/server';
import {redirect} from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Page(){const {data}=await auth().getSession();const user=data?.user;if(!user)redirect('/login');if(!ownerAllowed(user.email)||!user.emailVerified)return <main className="logout-screen"><h1>This account does not have access.</h1><a href="/logout">Sign out</a></main>;return <Tracker signedIn displayName={user.name||user.email} signInUrl="/login" signOutUrl="/logout"/>}
