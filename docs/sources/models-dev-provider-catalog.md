# models.dev Provider Catalog

The provider choices and model metadata in this update are based on the public
`https://models.dev/api.json` catalog retrieved on 2026-10-11. The checked-in
catalog retains Withu's existing entries and refreshes these provider records:

| models.dev ID | Provider | Models in source catalog | Withu connection method |
|---|---|---:|---|
| `perplexity` | Perplexity | 4 | OpenAI-compatible API Key |
| `nvidia` | NVIDIA NIM | 106 | OpenAI-compatible API Key |
| `opencode` | OpenCode Zen | 120 | OpenAI-compatible API Key |
| `opencode-go` | OpenCode Go | 36 | OpenAI-compatible API Key |
| `azure` | Azure AI Foundry | 97 | User endpoint and `api-key` header |
| `amazon-bedrock` | Amazon Bedrock | 199 | AWS Access Key, Secret Access Key, Region; AWS SDK |
| `openrouter` | OpenRouter | 379 | Existing OpenAI-compatible API Key preset |

The source also supplies provider logos from `https://models.dev/logos/` for
Perplexity, NVIDIA, OpenCode, Azure, and Amazon Bedrock. These remain provider
trademarks; their inclusion does not imply endorsement.

Model metadata is a static capability reference, not a statement that a model
is enabled for a user's account or region. Live model discovery is used when a
provider offers it. Bedrock's regional foundation-model catalog may include
models that still require account access or explicit enablement. Azure requires
an Azure OpenAI-compatible `/openai/v1` endpoint; other Azure endpoint families
are not inferred or auto-rewritten.

OpenRouter was already present and is not duplicated. OpenCode Zen and Go are
separate models.dev services with distinct model inventories and endpoints.
