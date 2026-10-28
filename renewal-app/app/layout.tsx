import type { Metadata } from 'next';
import './globals.css';
import './management.css';
export const metadata:Metadata={title:'ICDD Management Portal',description:'Internal controls, changes, exceptions, risks and license renewals across IT, head office and branches.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
