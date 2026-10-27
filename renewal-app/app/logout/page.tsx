'use client';
import {useEffect,useState} from 'react';
import {authClient} from '@/lib/auth/client';
export default function Logout(){const [error,setError]=useState('');useEffect(()=>{authClient.signOut().then(r=>{if(r.error)setError('Sign-out could not be completed. Please try again.');else window.location.replace('/login')}).catch(()=>setError('Sign-out could not be completed. Please try again.'))},[]);return <main className="logout-screen"><h1>{error||'Signing you out…'}</h1>{error&&<a href="/logout">Try again</a>}</main>}
