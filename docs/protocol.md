# Flyme PC 互联 协议笔记

本文记录 `flyme-link-linux` 所依赖的协议细节，来源是对官方
`pc-link-app 1.0.10`（Electron 客户端，`https://linkpc.flyme.com`）的静态分析，
以及真机（Flyme 1.9.3）联调验证。非官方文档，随时可能随官方更新而变化。

## 1. 架构

配对依赖魅族云端的 **信令服务器**，连接建立后电脑与手机之间走 **DEVICE WebSocket**：

```
PC ──SIGNAL(wss://socket.flyme.com/socket)──► 云端
 │                                              ▲
 │  二维码 {"starryKey":"SIG_..."}              │ 手机扫码
 ▼                                              │
手机 ────────────── 扫码后 tellMyId ────────────┘
 │
 └──DEVICE(ws://<phone-ip>:<port>/starryshare?userId=client)──► PC
```

## 2. 握手 token

SIGNAL 连接的 WebSocket 子协议携带一个 token，算法（官方客户端 `getToken()`）：

```
token = URLSAFE_BASE64( AES-256-ECB-PKCS7( "starryshare*" + Date.now(), KEY ) )
KEY   = "starryshare000000000000000000000"   // 32 字节，硬编码
```

- 替换：`/` → `_`，`+` → `-`，去掉 `=`。
- 不包含账号信息，因此 Linux 客户端无需登录 Flyme。
- 黄金测试向量（毫秒时间戳 `1794640290745`）：

  ```
  mnJzhqhjmBLvKSz1Y1--9GS5Ko7ZUzNVM1mmMNSV6LQ
  ```

实现见 `src/protocol/token.js`，与官方 CryptoJS 输出逐字节一致。

## 3. SIGNAL 会话与二维码

连接：

```
wss://socket.flyme.com/socket?userId=SIG_<毫秒时间戳>_<随机4位>
Sec-WebSocket-Protocol: <token>
```

二维码内容为 JSON：

```json
{"starryKey":"SIG_...","source":"pc","tips":"请使用Flyme系统扫一扫或者Flyme系统“设置-更多连接-PC 互联”进行扫码连接"}
```

服务端连接成功后推送：

```json
{"action":"welcome","value":""}
```

手机扫码后推送（PC 端据此直连手机）：

```json
{"action":"tellMyId","signal":"ws://192.168.1.7:45593/starryshare","url":"http://192.168.1.7:45593","app_version":1009003}
```

- `signal`：手机侧 WebSocket 地址；PC 以 `?userId=client` 追加后连接。
- `url`：手机侧 HTTP 地址（官方用于文件上传等，本项目暂不使用）。
- `app_version`：手机版本号（`1.9.3` → `1009003`）。

## 4. 消息信封

所有消息都是双重编码的 JSON：

```json
{"sender":"client","receiver":"server","content":"{\"action\":\"clipboard_changed\",\"value\":\"文本\"}","type":0}
```

- `sender`：SIGNAL 阶段为会话 id；DEVICE 阶段为 `client`。
- `receiver`：发给手机为 `server`，其他为空字符串。
- `type`：普通消息为 `0`。

## 5. DEVICE 握手与心跳

连接建立后手机可能先发：

```json
{"action":"peerInfo","value":"{\"peerName\":\"phone\",\"peerVersion\":1009003}"}
```

PC 必须回复（官方 PC 1.0.10 的形式）：

```json
{"action":"peerInfo","value":"{\"peerName\":\"pc\",\"peerVersion\":1000010}","contentType":""}
```

版本号编码：`major*1e6 + minor*1e3 + patch`。

心跳：每 10 秒发送 `{"action":"ping"}`，3 秒内未收到任何消息记为一次失败，
连续 2 次失败断开。任何收到的消息都会重置失败计数。

## 6. 剪贴板

- 手机 → PC：

  ```json
  {"action":"clipboard_changed","value":"<文本>"}
  ```

- PC → 手机：同样的 `clipboard_changed`，`receiver` 为 `"server"`：

  ```json
  {"sender":"client","receiver":"server","content":"{\"action\":\"clipboard_changed\",\"value\":\"<文本>\"}","type":0}
  ```

官方 PC 端只同步文本；图片/文件走其他 action，本项目未实现。
为避免回环，两端都应记录最近一次本地发送/远端写入的文本并去重。

## 7. 其他观察到的 action

手机还会主动发送以下消息，本项目仅记录/忽略：

- `notification_changed`：通知变化（含 `key`/`contentType`）
- `file_changed` / `images_changed` / `audio_changed` / `video_changed` / `document_changed`
- `orientation_changed`、`navigation_mode_changed`
- `close_rtc`（投屏结束）
- `profile_change`、`notification_read_permission_changed`

## 8. 官方客户端限制

- 手机端最低版本：`1.8.8`（`1008008`）。
- 官方 Windows/macOS 客户端会登录 Flyme 账号以拉取「已连接设备」列表
  （`POST https://socket.flyme.com/connection/list`，签名
  `MD5(timestamp + userId + serverKey)`，`serverKey = "Jz29y7tucqcayIILZ74JRg=="`）。
  本项目走的是**扫码直连**路径，不需要该接口和账号。
- 协议没有应用层加密；剪贴板文本为明文 JSON。请勿同步敏感内容。

## 9. 分析来源

- 安装包：`https://linkpc.mzres.com/pkg/win/1.0.10/pc-link-app-1.0.10-setup.exe`
  （NSIS，可用 `bsdtar` 解开；Electron 应用）。
- 关键代码位置：
  - `resources/app.asar/out/main/index.js`：SIGNAL/DEVICE WebSocket、剪贴板、心跳
  - `resources/app.asar/out/main/api-*.js`：云端设备列表接口
  - `resources/app.asar/out/renderer/assets/*.js`：token 生成、二维码载荷、消息分发
- 真机验证：Flyme 1.9.3 手机扫码后成功建立 DEVICE 连接并双向同步文本。
