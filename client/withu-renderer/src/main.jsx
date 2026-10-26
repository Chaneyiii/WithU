import {installPreviewBridge} from "./desktop-bridge";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./source-tokens.css";
import "./styles.css";
import "./interactions.css";
import "./desktop.css";
import './refinements.css';
installPreviewBridge();
// 渲染错误兜底：任何组件抛错时给出可恢复的提示，而不是整棵树卸载成白屏。
// 数据都在本地 Server，重载即回到原地（与 main 进程 render-process-gone 的处理一致）。
class RootErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('[withu] renderer error', error); }
  render() {
    if (this.state.failed) return <div className="source-null-state" role="alert">
      <p>界面遇到错误。数据没有丢失，点击下方按钮恢复。</p>
      <button className="intelligent-primary" onClick={() => location.reload()}>恢复界面</button>
    </div>;
    return this.props.children;
  }
}
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);

import "./withu.css";

import "./ui-polish.css";
