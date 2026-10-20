import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { init,startAutoSync } from './lib';
import './styles.css';
class ErrorBoundary extends React.Component<{children:React.ReactNode},{error:string}>{state={error:''};static getDerivedStateFromError(error:Error){return {error:error.message};}render(){if(this.state.error)return <div dir="rtl" style={{padding:32,fontFamily:'sans-serif'}}><h1>تعذر عرض الشاشة</h1><p>بياناتك لم تُحذف. جرّب إعادة فتح التطبيق.</p><pre>{this.state.error}</pre><button onClick={()=>location.reload()}>إعادة المحاولة</button></div>;return this.props.children;}}
init().then(()=>{createRoot(document.getElementById('root')!).render(<ErrorBoundary><App/></ErrorBoundary>);startAutoSync();}).catch((error)=>{document.getElementById('root')!.textContent=`تعذر فتح قاعدة البيانات: ${error.message}. لا تمسح بيانات المتصفح قبل استخراج نسخة احتياطية.`;});
