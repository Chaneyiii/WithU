import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {desktopBridge} from '../desktop-bridge';
import './MarkdownMessage.css';
export default function MarkdownMessage({text=''}){
 return <div className="markdown-message"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
  a:({href,children})=>/^https?:\/\//i.test(href||'')?<a href={href} onClick={e=>{e.preventDefault();void desktopBridge()?.openExternal(href).catch(()=>{});}}>{children}</a>:<span>{children}</span>,
  // No remote media loading/tracking from model output.
  img:({alt})=><span>{alt||'[图片]'}</span>,
 }}>{text}</ReactMarkdown></div>;
}
