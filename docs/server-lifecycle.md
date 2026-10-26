# Server 生命周期与 shutdown handshake v1

来源：R13、§4.2、§4.4、§7.1、§8.4。Withu Client 的主进程拥有一个本地 server 子进程。
renderer 重载、window 隐藏/关闭、Comfort/Cowork 切换不拥有 server 控制管道，也不发送 shutdown。
完全退出由 Client main 发起，等待 server 完成后退出。该所有权禁止退出后 OS 常驻模式。

状态机：starting -> ready -> draining -> stopped；启动/运行/清理失败可进入 failed。
stopped 是终态；同一进程不能恢复 ready。ready 才接受新任务。

握手契约：
1. main 持有 client_session_id、server_id、request_id，发送 withu:server:shutdown。
2. server 标记 draining、拒绝新任务和派发，记录 shutdown_requested_at。
3. 取消运行中任务并传播到 specialist；未提交候选/中间产物作废；明确接受的可恢复状态先持久化。
4. 取消未完成合成/播放、清空音频队列、关闭音频设备、停止子进程、释放模型句柄和端口。
5. 审计只记操作/对象/时间/操作者/schema_version/结果；释放全部成功后返回 complete，再进程退出。
   完成报文不得比资源释放更早，不能声称取消撤销了已有副作用。
6. 重复请求复用同一结果，main 侧重复 quit 复用同一 Promise；父进程管道 EOF 走同一清理路径。

P0 采用 loopback 动态空闲端口、stdio owner 控制与 stdout JSON 诊断。端口仅用于资源租约验收，
尚未提供 HTTP 路由。P0 没有实际 task/音频/model 资源，complete 只证实已安装的端口租约释放；
真实设备的关闭、Windows 进程树和不可恢复清理错误必须在 §6.3/§6.5 验收。

checks/lifecycle.mjs 从真实 Rust binary 启动两个进程：测试 ready、端口占用、rendererReload/windowHide
之后 PID 不变、重复 quit 幂等、server 自行退出且端口可重新绑定；第二进程测试 owner EOF 清理。
这些是 main 边界模拟，不是已运行 Electron GUI 的证明。退出 timeout 只报警，不把超时当作成功。
生产中有界退出失败、强制终止和持久恢复策略尚待实测，不能宣传退出后仍运行。
