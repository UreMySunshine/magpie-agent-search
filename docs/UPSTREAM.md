# 上游参考与取舍（0.2.0）

2026-10-29 通过 GitHub 只读接口检查默认分支最新提交：

- 仓库：https://github.com/DDDMUC/dsh-free-search
- commit：`7bd37aaf472bcd9768a02e6b8cf50e402f4ac0fb`
- 提交时间：2026-10-28T10:35:35Z；上游包版本 0.9.19。
- 主要研究文件：[lib/index.js](https://github.com/DDDMUC/dsh-free-search/blob/7bd37aaf472bcd9768a02e6b8cf50e402f4ac0fb/lib/index.js)。只读取，没有运行、安装或 import。

## 借鉴内容

1. `searchExaMCP` / `searchExa`：匿名 Exa 远程 MCP 与 key REST 分开。
2. `searchParallelMCP` / `searchParallel`：匿名 MCP 用 objective/search_queries/session_id；key REST 用 v1/search。条数是匿名 MCP 软限制/本地截断，认证 REST 可用 advanced_settings.max_results。
3. `searchYoucom`：上游匿名 GET api.you.com/v1/agents/search（query/count）和 key REST ydc-index.io/v1/search。当前保留已验证的 key POST，新补匿名 GET。
4. `languagePool` / `routeEngines`：按文字脚本分池，再考虑显式顺序与能力；本项目限制为六家，结合 Agent taskType 和配置 priority 重写。
5. 失败分类、冷却和顺序回退思路。本项目不重试同一家，不轮换 key，不按代理指纹重置冷却，不用匿名绕过已配置账号的错误。

## 没有照搬

- 上游中文默认池 Bing/Baidu/Aliyun/AnySearch 不在用户选择的六家中，因此不能原样套用，也不据此宣称六家中文质量高低。
- 上游支持 DSH、UI、多源并发、research、更多引擎、复杂时间范围与密钥池；这些不在本项目范围内。
- 上游部分匿名实现直接 tools/call 并用简易文本解析。本项目按官方 Streamable HTTP 生命周期重写握手、协议协商、ID匹配、JSON/SSE、tool error、超时/字节限制，不复制脆弱的逐行 first-data 解析。
- 上游 Parallel 仍用 search.parallel.ai/mcp；当前官方推荐 mcp.parallel.ai/mcp，本项目用后者，实测 initialize/initialized/tools-call 成功。
- 其他三家匿名 REST 之前已成功，不无理由改为 MCP。

本工程代码为独立实现，API 地址、请求结构和上述设计取舍参考该固定提交。为保留来源归属，无论是否构成实质复制，都附上上游完整 MIT 许可，见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

## 0.3 正文迁移

进一步直接阅读同一提交的 [fetch_provider.js](https://github.com/DDDMUC/dsh-free-search/blob/7bd37aaf472bcd9768a02e6b8cf50e402f4ac0fb/lib/fetch_provider.js) 及 [fetch_upstream.js](https://github.com/DDDMUC/dsh-free-search/blob/7bd37aaf472bcd9768a02e6b8cf50e402f4ac0fb/lib/fetch_upstream.js)。上游本来是统一质量链：直连、系统浏览器、Exa contents、Firecrawl、crawl4ai，而不是六家各自都有匿名正文 API。

本版本移植其 T1 安全直抓与 T2/T3 统一回退思路，并直接改编 fetch_upstream.htmlToText，保留 MIT。沿用本项目已有的公开 URL/DNS 固定/逐跳验证/字节上限，避免照搬上游缺少这些边界的底层连接。为了保持小版本，不启动系统浏览器，不新增 crawl4ai/其他托管服务，不装依赖；压缩和非 UTF-8 在此版明确拒绝，而不是假称完整移植了上游所有格式能力。

自动 fetch 先按配置进入 Exa/Firecrawl 等已有提供方链，全部失败后才安全直抓；显式 Exa/Parallel 用本轮核实的官方匿名正文工具。You 免费档无 contents，You 的匿名 fetch 是标注明确的直抓别名，不声称 You 返回了正文。各层实际 provider/transport、失败尝试、部分内容与截断均在结果中说明。

## 0.4 AnySearch 最小迁移

直接参考同一提交的 lib/index.js searchAnysearch：REST 匿名与可选 Bearer 的请求/结果包络。没有迁移 ignoredAnysearchKey 或无效 key 降匿名重试。本轮将 AnySearch 加为末尾兜底，保持既有六家相对顺序，不照搬上游中文池或重新排名。原生 extract 根据官方现有合同补充，不引入其他服务。
