# 协议来源（2026-10-29）

来源声明与实测分开：文档支持不代表本机已验证。上游固定提交的证据见 [UPSTREAM.md](UPSTREAM.md)。

| 引擎/协议 | 依据与本项目选择 |
|---|---|
| Firecrawl | [Search](https://docs.firecrawl.dev/features/search)、[REST Search](https://docs.firecrawl.dev/api-reference/endpoint/search)、[Scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape)：REST 有/无 key；无 key 不发 Authorization。 |
| Tavily | [Keyless](https://docs.tavily.com/documentation/keyless)、[Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)：匿名 REST 专用 X-Tavily-Access-Mode。 |
| Keenable | [API reference](https://docs.keenable.ai/api-reference)、[Search](https://docs.keenable.ai/api-reference/search)、[Fetch](https://docs.keenable.ai/api-reference/fetch)：匿名 public 双路径、应用标识和 live。 |
| Exa | [REST Search](https://exa.ai/docs/reference/search)、[Contents](https://exa.ai/docs/reference/get-contents) 要求 key；[官方 MCP](https://exa.ai/docs/get-started/exa-mcp) 允许 mcp.exa.ai/mcp 无 key。0.2 匿名 search 实测成功。 |
| Parallel | [REST Search](https://docs.parallel.ai/api-reference/search/search)、[Extract](https://docs.parallel.ai/api-reference/extract/extract) 要求 key；[当前 MCP](https://docs.parallel.ai/integrations/mcp/quickstart) 推荐 mcp.parallel.ai/mcp、允许匿名 search，0.2 实测成功。[旧 MCP](https://docs.parallel.ai/integrations/mcp/search-mcp) 保留运行，上游仍用旧地址。 |
| You | [REST Search](https://you.com/docs/api-reference/search/v1-search)、[Contents](https://you.com/docs/api-reference/contents) 要求 key；匿名 GET api.you.com/v1/agents/search 来自固定上游 searchYoucom 实现，本次连接超时，尚未实测证实可用。当前[官方免费入口文档](https://you.com/docs/agents/mcp-server) 主要描述 MCP profile，本项目不混淆两者，也不额外添加自动协议重试。 |
| MCP transport | [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)：JSON/SSE、initialize、协议版本与 session 处理的依据。 |

0.1 的严格纯 REST 限制已被用户新要求更新；0.2 允许内部远端 MCP HTTP 协议。没有 MCP 服务器安装或宿主配置写入。

## 0.3 匿名正文依据

历史只读 tools/list 核对：Exa 实际提供 web_fetch_exa，参数 urls/maxCharacters；Parallel 提供 web_fetch，参数 urls/full_content/allow_live_fetch，session_id 要求首次省略、后续复用服务端返回值。Exa 当前 search 的 objective 为必填，已离线修正适配器。

You 官方免费 profile 只含 search/discover，正文不在免费工具集中；本轮 You tools/list 连接超时，未据此伪造匿名 contents。其公开 URL 直抓路径来自上游统一 fetch 链的 T1，实际提供方 direct-http，非 You 服务。

## 0.4 AnySearch

以固定上游 lib/index.js 的 searchAnysearch 为适配依据：POST https://api.anysearch.com/v1/search，query/max_results，可选 Bearer，成功 code=0、data.results。未迁移其 401/403 忽略 key 并重试匿名的行为。

官方 [Search](https://www.anysearch.com/docs/api-endpoints/v1-search) 明确匿名 REST 可用、max_results 1–10；[Extract](https://www.anysearch.com/docs/api-endpoints/v1-extract) 为原生单 URL 正文入口，POST /v1/extract 严格只传 url，成功 code=0、data.url/title/content。本轮 native extract 只做 mock，不增加实网正文请求。官方说明匿名 402 message 可能包含自动生成凭据；实现不记录错误体、不采用凭据、不发注册或重试请求。

## 0.5 腾讯云元宝搜索（只读官方文档，无实网 API 调用）

- [服务 API KEY 方式](https://cloud.tencent.com/document/product/1806/130615)：Bearer 专用域名 api.wsa.cloud.tencent.com、POST /SearchPro、JSON Content-Type，示例只用服务 key，无标准云 API 签名或版本头。
- [两种接入方式](https://cloud.tencent.com/document/product/1806/130616)：服务 API KEY 与 AK/SK 签名域名/认证体系不同，不混用。
- [SearchPro 参数](https://cloud.tencent.com/document/product/1806/121811)：Query、合法 Cnt 10/20/30/40/50，news 对应 Industry；Pages 为 JSON 字符串数组，passage/content 都是摘要；极速版部分可选参数不支持。当前没有统一日期/站点 schema，所以未映射 Freshness/Site。

标准 API 的 Version=2025-05-08 属于标准参数描述，不据此向服务 key 兼容通道虚构额外 X-TC-* 或 body Version。实现仅采用官方服务 key 示例所需 headers，并按参数合同传 Query/Cnt/可选 news。ResourceUnavailable 官方提示检查欠费，归额度/资源不可用类别，不声称已检查实际余额。

## 0.6 腾讯云 API 3.0 TC3 双字段

[元宝公共参数](https://cloud.tencent.com/document/api/1806/121815) 明确 TC3 service=wsa，Action/Timestamp/Version/Authorization 放在 HTTP headers；[SearchPro](https://cloud.tencent.com/document/api/1806/121811) 规定标准域名 wsa.tencentcloudapi.com、Action=SearchPro、Version=2025-05-08，无需 Region。[签名 v3](https://cloud.tencent.com/document/api/213/30654) 作为 CanonicalRequest、UTC 日期、SHA256/HMAC 派生及 SignedHeaders 的依据。

离线测试完整匹配文档公开 2019-02-25 示例的 payload hash、canonical hash 和最终签名（使用文档中的 32 星号公开占位凭据，不是真实用户密钥）。另以固定时间 WSA 中文 UTF-8 正文，与独立 Python HMAC 计算的黄金签名交叉验证。只移植算法和协议，不运行或安装 SDK/官方示例网络调用。

可选 X-TC-Token 只适用于 STS 临时凭据，本小版本未实现临时 Token 字段；明确只支持长期 SecretId/SecretKey，避免隐瞒缺失条件。

## 0.7 日期与域名

Exa REST Search 的 startPublishedDate/endPublishedDate/includeDomains/excludeDomains；Tavily Search 的 start_date/end_date/include_published_date/filter_by_published_date/include_domains/exclude_domains 为映射依据。其余档位严格日期尚未接入；域名仅本地后过滤，不宣称服务端限制。

## Magpie 插件 0.3.0 搜索接口与数量

- TinyFish 带密钥模式使用 [Search API](https://docs.tinyfish.ai/search-api) 的 GET 入口，匿名模式按 [参考插件的 TinyFish 实现](https://github.com/guotree/magpie-websearch/blob/3ff2a8deec6742d1f74e3a65c3b006405ac27615/src/providers/tinyfish.mjs) 单次调用 `search` 工具。两种入口均按返回的一页结果在本地限制数量。
- Querit 使用 [官方集成](https://github.com/querit-ai/querit-plugins) 的 Bearer 鉴权和 `POST /v1/search`，响应结构参考 [Magpie 适配器](https://github.com/guotree/magpie-websearch/blob/3ff2a8deec6742d1f74e3a65c3b006405ac27615/src/providers/querit.mjs)。此版本以模拟响应验证。
- 每次搜索取请求数、配置的 `resultLimit` 和引擎上限的最小值。特别是 [AnySearch](https://www.anysearch.com/docs/api-endpoints/v1-search) 上限 10，[Tavily](https://docs.tavily.com/documentation/api-reference/endpoint/search) 上限 20。旧匿名 You 入口保留 10 条上限。
