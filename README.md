# AI评标前端联调工程

本工程用于在无法提前进入客户一体化前端仓库时，按照客户技术栈独立开发并与AI评标后端联调。驻场后将业务页面、接口层和组件代码迁入客户工程，并替换平台公共组件及环境配置。

## 技术栈

- Vue 3
- Vite 4
- TypeScript 5
- Ant Design Vue 3
- Pinia 2
- Vue Router 4
- Axios 1
- ESLint + Prettier

## 本地运行

```powershell
cd D:\projects\demo\ai-review-integration
Copy-Item .env.example .env.local
pnpm install
pnpm dev
```

打开宿主模拟页：

```text
http://127.0.0.1:4176/ecp-simulator.html
```

开发环境默认使用同正式接口结构的前端Mock。连接真实后端时设置：

```dotenv
VITE_USE_MOCK=false
VITE_AI_REVIEW_API_BASE=/ai-review-api/v1
VITE_API_PROXY_TARGET=https://后端联调地址
```

真实联调前还需在当前页面域名下设置客户提供的 `Access-Token` Cookie。Token不会放入URL或通过Loader传递。

## 正式页面路由

- `/ai-review/progress?reviewId=...`
- `/ai-review/page?reviewId=...&action=AI&reviewStage=...&reviewItemId=...&bidderId=...`
- `/ai-review/page?reviewId=...&action=AI_FEEDBACK&reviewStage=...&reviewItemId=...&bidderId=...`
- `/ai-review/page?reviewId=...&action=AI_FEEDBACK`

## Loader职责

`public/ai-review-loader.js`负责在宿主页面创建iframe、锁定宿主滚动、处理关闭和进度面板尺寸变化。业务参数通过页面URL传递；AI结果、专家结果、Token、文件内容和导航不通过 `postMessage` 传递。

## 目录

```text
src/api/          六个内部接口及统一业务响应处理
src/bridge/       Loader与AI页面的容器通信
src/components/   可替换的页面组件
src/mocks/        仅开发环境启用的同契约Mock
src/pages/        AI评审进度、AI评标抽屉
src/types/        接口和入口参数类型
src/utils/        Cookie及URL参数处理
public/           Loader、宿主模拟页、Mock预览页
```

## 校验

```powershell
pnpm typecheck
pnpm lint
pnpm build
```
