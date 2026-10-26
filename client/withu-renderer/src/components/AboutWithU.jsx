import Modal from './Modal';
import {WITHU_VERSION} from '../version';
import logo from '../../../withu-window/withu-icon.svg';
export default function AboutWithU({onClose}){
 return <Modal title="关于WithU" onClose={onClose} footer={<button className="primary" onClick={onClose}>确定</button>}>
  <div className="about-withu">
   <img src={logo} alt="WithU 标志" width="104" height="104"/>
   <h2>WithU</h2>
   <p>Powered by WithU</p>
   <p>版本 {WITHU_VERSION}</p>
   <p>发布于 2026年10月11日</p>
   <small>v3 开发预览版 · Alpha Demo</small>
  </div>
 </Modal>;
}
