# flyme-link-linux

[![ci](https://github.com/ABCDCreeper/flyme-link-linux/actions/workflows/ci.yml/badge.svg)](https://github.com/ABCDCreeper/flyme-link-linux/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

在 Linux 上使用魅族 **Flyme PC 互联**（Flyme Link）的**剪贴板双向同步**。

官方 PC 客户端只提供 Windows/macOS。本项目通过逆向 `pc-link-app 1.0.10` 的协议，
在 Linux 上实现了兼容客户端：**手机端无需安装任何 App**，用系统自带的
「设置 → 更多连接 → PC 互联」扫码即可。

> 非官方项目，与魅族/Flyme 无关联。仅用于设备互操作性的研究与个人使用。

## 功能

- ✅ 手机 ↔ 电脑 **文本剪贴板双向同步**
- ✅ GNOME：组合器内监听剪贴板，**不轮询外部进程、不闪任务栏**
- ✅ KDE Plasma / Sway / Hyprland 等 Wayland 桌面：`wl-paste --watch`
- ✅ X11 桌面：`xclip` / `xsel`
- ✅ 跨桌面 **StatusNotifier 托盘图标**（KDE 原生、GNOME 需 AppIndicator 扩展）
- ✅ **GTK4 二维码窗口**，显示扫码与连接状态
- ✅ 收到手机剪贴板时弹 **桌面通知**
- ✅ 无需 Flyme 账号，扫码配对
- ✅ systemd 用户服务，开机自启

## 支持环境

| 桌面 / 会话 | 剪贴板监听 | 托盘 | 备注 |
| --- | --- | --- | --- |
| GNOME 45–51 (Wayland) | 内置 Shell 扩展（推荐） | 扩展提供 | 首次安装需注销重登 |
| KDE Plasma (Wayland) | `wl-paste --watch` | StatusNotifier 原生 | 开箱即用 |
| Sway / Hyprland / river | `wl-paste --watch` | 需 SNI host | 开箱即用 |
| X11 (XFCE/LXQt/i3/…) | `xclip` 或 `xsel` 轮询 | 需 SNI host | 轮询间隔 1.2s |
| GNOME 无扩展 | `wl-paste` 轮询（有警告） | AppIndicator 扩展 | 建议装扩展 |

系统要求：Node.js ≥ 18（AppImage 已内置）、`wl-clipboard`（Wayland）或
`xclip`/`xsel`（X11）、`libnotify`（通知）、`python3-gobject + GTK4`（二维码窗口）。

## 安装

### Arch Linux（AUR）

```bash
yay -S flyme-link-linux
# 或使用仓库内 packaging/PKGBUILD 本地构建
```

### Debian / Ubuntu

```bash
sudo apt install ./flyme-link-linux_1.0.0_amd64.deb
```

### Fedora / RHEL

```bash
sudo dnf install ./flyme-link-linux-1.0.0-1.x86_64.rpm
```

### AppImage（内置 Node，免安装）

```bash
chmod +x flyme-link-linux-1.0.0-x86_64.AppImage
./flyme-link-linux-1.0.0-x86_64.AppImage
```

### 便携 tar.gz（需要系统 Node ≥ 18）

```bash
tar xzf flyme-link-linux-1.0.0-linux-x86_64.tar.gz
cd flyme-link-linux-1.0.0-linux-x86_64
./scripts/install.sh
```

### 从源码

```bash
git clone https://github.com/ABCDCreeper/flyme-link-linux.git
cd flyme-link-linux
./scripts/install.sh        # npm install + 用户级安装
```

### 安装后的两步

```bash
# 1) 启动并设为开机自启（deb/rpm/Arch 安装后需要手动启用）
systemctl --user enable --now flyme-link.service

# 2) GNOME 用户：注销并重新登录，然后启用扩展
gnome-extensions enable flyme-link@local
```

KDE/X11 用户无需扩展，服务启动后托盘图标会通过 StatusNotifier 出现。

卸载：`./scripts/uninstall.sh`，或者包管理器删除后手动清理用户级文件（见 `scripts/uninstall.sh`）。

## 配对与使用

1. 启动服务后，点击顶栏/托盘图标 →「显示二维码 / 状态」。
2. 手机上打开 **设置 → 更多连接 → PC 互联**（或 Flyme 扫一扫），扫描二维码。
3. 连接成功后：
   - 手机复制文本 → 电脑剪贴板同步，并弹出通知；
   - 电脑复制文本 → 手机剪贴板同步。
4. 断开后 30 秒自动生成新二维码，重新扫码即可。

手机端 Flyme 版本要求 ≥ 1.8.8（与官方 PC 客户端一致；开发时已在 1.9.3 真机验证）。

## 工作原理

```
┌──────────────── GNOME Shell 扩展 / 本地 watcher
│  剪贴板变化 ──JSON──┐
│  写入剪贴板 ←───────┤
└─────────────────────┼───────────────
                      ▼
             flyme-link 守护进程 ──WebSocket── 手机 (Flyme PC 互联)
                      ▲  ▲
        GTK4 二维码窗口 │  │ StatusNotifier 托盘
                      └──┴── unix socket ($XDG_RUNTIME_DIR/flyme-link.sock)
```

- 配对：向魅族信令服务器 `wss://socket.flyme.com/socket` 注册一次性会话，
  生成二维码；手机扫码后告知双方直连地址。
- 同步：电脑与手机通过 WebSocket 直连（同一局域网），文本以 JSON 消息传递。
- 桌面集成：GNOME 用 Shell 扩展在组合器内读写剪贴板；其他桌面按
  `wl-paste --watch` → 轮询 → `xclip` 的顺序自动选择。
- 详见 [docs/protocol.md](docs/protocol.md)。

## 常见问题

**GNOME 顶栏一直闪/任务栏抽搐？**
旧版使用每 400ms 派生 `wl-paste` 的轮询。现在 GNOME 上由 Shell 扩展在组合器进程内
监听，不再产生外部进程；请确认扩展已加载（`gnome-extensions info flyme-link@local`）。

**GNOME 报 `data-control protocol` 不支持？**
Mutter 不实现该协议，这是预期的。安装并使用内置 Shell 扩展即可。

**托盘图标不出现？**
- KDE：确认 StatusNotifier watcher 存在（Plasma 自带）。
- GNOME：需要 `gnome-shell-extension-appindicator`（AppIndicator 支持）。
- 托盘只在 GNOME 扩展**未连接**时启用，避免两个图标。

**没有通知？**
安装 `libnotify`（提供 `notify-send`）。GNOME 扩展连接时由扩展弹原生通知。

**扩展列表里没有 flyme-link？**
新安装的扩展必须注销并重新登录后才会被 GNOME Shell 扫描。

**手机连不上/提示版本过低？**
确认手机系统支持「PC 互联」，Flyme 版本 ≥ 1.8.8；二维码 30 秒后过期会自动刷新。

**日志**

```bash
journalctl --user -u flyme-link -f
# GNOME 扩展日志
journalctl -b /usr/bin/gnome-shell | grep -i flyme
```

## 隐私与安全

- **不需要 Flyme 账号**。配对 token 由客户端本地生成（密钥硬编码在官方客户端中）。
- 配对经魅族信令服务器撮合；剪贴板内容通过电脑与手机之间的 WebSocket 传输。
- 该协议**没有应用层加密**，剪贴板文本以 JSON 明文传输。请仅在可信网络中使用，
  不要用本工具同步密码、密钥等敏感内容。
- 仅同步**文本**，不读取图片、文件或密码管理器内容。

## 开发

```bash
npm ci --ignore-scripts
npm test               # 41 个单元 + 端到端测试
node bin/flyme-link.js -v
```

`npm ci` 使用 `--ignore-scripts` 是因为 `dbus-next → usocket` 的 node-gyp 步骤不必要：
dbus-next 在 usocket 不可用时自动回退到普通 UNIX socket。

目录结构：

```
bin/                 CLI 入口
src/protocol/        token / 消息信封 / 心跳
src/flyme/           SIGNAL 配对与手机直连
src/clipboard/       后端自动选择、轮询、wl-paste watch、写入
src/tray/            StatusNotifierItem + dbusmenu
src/ipc/             本地控制 socket
gui/                 GTK4 二维码窗口
gnome-extension/     GNOME Shell 扩展
packaging/           nfpm、PKGBUILD、AppRun
scripts/             安装/卸载/打包
tests/               单元 + 端到端模拟
```

## 打包

```bash
./scripts/build-packages.sh   # deb / rpm / Arch (.pkg.tar.zst)
./scripts/build-tarball.sh    # 便携 tar.gz
./scripts/build-appimage.sh   # 内置 Node 的 AppImage
```

推送到 `v*` tag 时，GitHub Actions 会为 amd64/arm64 构建以上全部格式并附加到 Release。

## 许可

[MIT](LICENSE)。第三方组件许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
