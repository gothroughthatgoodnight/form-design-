# FORM 两站 · GitHub Pages

使用一个 GitHub 免费账号和一个公开仓库即可发布两个入口。
Pages 托管静态页面，GitHub Actions 执行每日抓取、生成色卡并重新发布；
关闭电脑不影响已上线网页访问。

## 首次发布

1. 将本目录的所有文件（包含隐藏的 .github 文件夹）放到自己的公开仓库根目录。
2. 仓库 Settings → Pages → Build and deployment → Source 选择 GitHub Actions。
3. 允许仓库 Actions 运行。工作流包含写入更新数据所需的 contents: write 权限。
4. 在 Actions 中打开 Update resources and publish Pages，点击 Run workflow。
5. 完成后使用该次运行返回的正式 Pages 域名；外饰情报入口为 /仓库名/news/，车型参考入口为 /仓库名/study/。
   用户主页仓库或自定义域名的路径以平台实际输出为准。

无需 Vercel、Blob、服务器、API 密钥或额外的付费服务。
仓库只包含两个资料站及更新脚本，不包含电脑日志、桌面工作进度或访问令牌。

## 每日与手动更新

- 每天 UTC 16:23（北京时间次日 00:23）运行一次抓取并发布，平台调度可能延迟。
- 资讯源与图片源失败时保留此前内容；网页仍可浏览。
- 顶部刷新和下拉刷新读取最新已发布的内容，不会直接在浏览器启动抓取。
- “更新资源”打开此仓库的工作流页面。仓库所有者登录 GitHub 后点击 Run workflow，即可提前抓取并发布。
- 页面中没有保存 GitHub 令牌，访客不能以你的身份启动工作流。
- 公开仓库连续 60 天无活动时，GitHub 可能停用定时工作流；可在 Actions 中重新启用。现有已发布页面仍可浏览。

## 更新脚本与发布文件

site/ 是 Pages 的唯一公开目录，lib/ 与 data/ 用于更新。
data/store/ 保存抓取状态和新图片，工作流会提交到仓库，供下次更新复用。
工作流只从默认分支发布，不运行拉取请求提供的代码。
图片有来源和许可记录，保留已确认的视角和五色色卡。

在本目录使用 pnpm install --prod --frozen-lockfile 安装锁定依赖。
执行 pnpm build 生成并验证已有内容；执行 pnpm refresh 抓取新资源。
