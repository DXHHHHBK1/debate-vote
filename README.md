# 大学生辩论赛 · 辩题征集投票（自建 H5 版）

学生端和管理端在同一个网站：学生提交辩题 → 管理员审核 → 上榜 → 投票排行。
按钮文案全部自定义："提交辩题"，没有"选手"字样。

## 本地运行

需要 Node.js 22+（已验证 v24 可用），零第三方依赖。

```bash
cd debate-vote
node server.js
# 学生端：http://localhost:3000
# 管理端：http://localhost:3000/admin   （默认口令 debate2026，务必修改）
```

修改管理口令：`ADMIN_PASSWORD=你的口令 node server.js`
修改端口：`PORT=8080 node server.js`
数据存在同目录 `data.db`（SQLite，删文件即清空）。

## 规则

- 投稿字段：辩题（必填）、姓名（必填），提交后待审核
- 管理员在 /admin 通过/驳回，通过后上榜
- 每人每个辩题限投 1 票，可取消；按票数实时排行
- 投票身份用浏览器 Cookie 标识（同一浏览器算同一人），生产环境建议再加学号验证

## 部署到公网（给全校学生用）

### 方式一：Zeabur 免费托管（推荐，无需备案、国内免翻墙可访问）
1. 你注册 Zeabur 账号 + GitHub 账号（这一步必须你自己来），把本目录代码推到 GitHub 仓库
2. Zeabur 新建项目 → 从 GitHub 导入，会自动识别 Node 并运行 `npm start`
3. **关键**：服务设置 → Storage 添加持久卷，挂载路径填 `/data`（不挂卷的话重启会丢投票数据）
4. 环境变量：`DB_PATH=/data/data.db`、`ADMIN_PASSWORD=你的强口令`
5. Zeabur 会给一个 `*.zeabur.app` 免费域名（自动 HTTPS），直接可用；服务器在境外，不用 ICP 备案

### 方式二：国内云服务器
1. 一台云服务器（2核2G 足够），安装 Node.js 22+
2. 把本目录传上去，`ADMIN_PASSWORD=强口令 nohup node server.js &`
3. 用 nginx 反向代理 3000 端口并配 HTTPS
4. **国内公网访问需要 ICP 备案**（约 2~4 周，高校一般走学校统一备案）

备选：已有投票管家活动在跑（ID wrbtt2dd，10月16日中午12点截止），可直接用。
