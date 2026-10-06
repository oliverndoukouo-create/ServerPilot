# ServerPilot

Add these variables to the root `.env` file:

```env
DISCORD_TOKEN=your-bot-token
DISCORD_GUILD_ID=your-test-server-id
```

Copy the test server ID from Discord with Developer Mode enabled. In the Discord Developer Portal, open the application, go to **Installation**, enable **Guild Install**, and include both the `bot` and `applications.commands` OAuth2 scopes in the install link. Use that link to install the application into the test server, then run the commands below.

Register the test-server command and start the bot:

```bash
npm run deploy
npm start
```

Use `/ping` in the test server. ServerPilot responds with `🏓 Pong! ServerPilot is online.`

The `/setup` command is administrator-only. Select a community type, describe the server in the modal, review the generated preview, and click **Confirm Setup** to create the planned structure. Cancelling the preview makes no server changes.

The planner uses deterministic logic by default: it uses the description first, asks only relevant optional questions, supports **Yes**, **No**, and **Decide for me**, and keeps the approved request in memory until confirmation. No AI provider is configured by default.

Setup previews also include least-privilege roles. Existing matching roles are reused unchanged, permission differences are reported, and the bot requires `Manage Roles` before any setup changes are made.

AI planning is optional. Without `AI_API_KEY`, ServerPilot uses the existing deterministic planner. To enable the OpenRouter free model, configure these variables in the root `.env` file locally (never commit the key):

```env
AI_API_KEY=<your OpenRouter key>
AI_MODEL=nvidia/nemotron-3-super-120b-a12b:free
AI_BASE_URL=https://openrouter.ai/api/v1
```

`AI_MODEL` and `AI_BASE_URL` default to the values above, so only `AI_API_KEY` is required to enable it. The selected OpenRouter model advertises `response_format` support in OpenRouter's public model catalog. AI output is treated as untrusted JSON, validated against strict size and permission limits, and discarded in favor of the deterministic fallback if validation or the provider request fails.